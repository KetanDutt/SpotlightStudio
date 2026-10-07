/**
 * Automatic wallpaper rotation (Android) – the I/O half.
 *
 * The *rules* (defaults, validation, filtering, picking the next wallpaper) live in
 * `src/core/rotation.ts`; this module owns the file system, the background task and the
 * native module.  iOS is deliberately excluded: the OS never lets an app replace the
 * wallpaper, so a scheduled run there would only fill the photo library.
 *
 * The task must not depend on React state: it runs headless, possibly with the app killed,
 * so everything it needs comes from AsyncStorage and the catalog cached on disk.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  ROTATION_DEFAULTS,
  ROTATION_TASK,
  buildRotationPool,
  coerceRotation,
  pickNext,
  type RotationRunResult,
} from '../core/rotation';
import { getCapabilities, platform } from '../core/platform';
import type { RawWallpaper, RotationSettings } from '../core/types';
import { buildCatalog } from '../core/utils';
import { bundledCatalog } from '../data';
import { nativeWallpaper } from '../modules/wallpaper';
import { downloadWallpaper } from './media';
import { KEYS, asStringArray, getJson, setJson } from './storage';

export { ROTATION_DEFAULTS, ROTATION_TASK, buildRotationPool, coerceRotation, pickNext };
export type { RotationRunResult };

export async function readRotationSettings(): Promise<RotationSettings> {
  return coerceRotation(await getJson<unknown>(KEYS.rotation, ROTATION_DEFAULTS));
}

/** The catalog a headless run can rely on: the cached file, or the bundled fallback. */
export async function loadRowsOffline(): Promise<RawWallpaper[]> {
  try {
    const file = new File(new Directory(Paths.cache, 'spotlight-studio'), 'wallpapers.json');
    if (file.exists) {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed) && parsed.length) return parsed as RawWallpaper[];
    }
  } catch {
    /* fall through to the bundled catalog */
  }
  return bundledCatalog as RawWallpaper[];
}

/**
 * Run one rotation step.  Called by the background task *and* by the "Rotate now" button in
 * Settings, so what the user tests is exactly what the scheduler will do.
 */
export async function runRotationOnce(
  options: { force?: boolean; settings?: RotationSettings } = {},
): Promise<RotationRunResult> {
  const settings = options.settings ?? (await readRotationSettings());

  if (!settings.enabled && !options.force) {
    return { status: 'skipped', message: 'Automatic rotation is switched off.' };
  }
  if (!getCapabilities().canRotateAutomatically || !nativeWallpaper) {
    return {
      status: 'skipped',
      message: getCapabilities().canRotateAutomatically
        ? 'The native wallpaper module is not available in this build.'
        : 'This platform does not let apps change the wallpaper in the background.',
    };
  }

  try {
    const rows = await loadRowsOffline();
    if (!rows.length) return { status: 'failed', message: 'No catalog available yet.' };
    const catalog = buildCatalog(rows);

    const favorites = new Set(asStringArray(await getJson<string[]>(KEYS.favorites, [])));
    let pool = buildRotationPool(catalog, settings, favorites);
    // Over-strict filters would mean "never rotates" – fall back to the whole library and
    // say so in Settings instead of silently doing nothing.
    if (!pool.length) pool = catalog.items;

    const next = pickNext(pool, settings.lastWallpaperId);
    if (!next) return { status: 'failed', message: 'No wallpaper matched the rotation filters.' };

    const downloaded = await downloadWallpaper(next);
    if (!downloaded.ok) {
      await setJson(KEYS.rotation, { ...settings, lastRunError: downloaded.error });
      return { status: 'failed', message: downloaded.error };
    }

    try {
      await nativeWallpaper.setWallpaper(downloaded.value.uri, settings.mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setJson(KEYS.rotation, { ...settings, lastRunError: message });
      return { status: 'failed', message };
    }

    await setJson(KEYS.rotation, {
      ...settings,
      lastRunAt: Date.now(),
      lastWallpaperId: next.id,
      lastRunError: '',
      runCount: settings.runCount + 1,
    } satisfies RotationSettings);
    return { status: 'applied', wallpaperId: next.id, message: `Wallpaper ${next.id} applied.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setJson(KEYS.rotation, { ...settings, lastRunError: message });
    return { status: 'failed', message };
  }
}

/** Register the headless task.  Must run at module scope, on every app start. */
export function defineRotationTask(): void {
  if (platform === 'web') return;
  if (TaskManager.isTaskDefined(ROTATION_TASK)) return;
  TaskManager.defineTask(ROTATION_TASK, async () => {
    const result = await runRotationOnce();
    return result.status === 'failed'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  });
}

export interface RotationSyncResult {
  registered: boolean;
  message: string;
}

/**
 * Make the OS state match the settings.  Safe to call on every change: registering an
 * already registered task just updates its interval.
 */
export async function syncRotationTask(settings: RotationSettings): Promise<RotationSyncResult> {
  if (!getCapabilities().canRotateAutomatically || !nativeWallpaper) {
    try {
      await BackgroundTask.unregisterTaskAsync(ROTATION_TASK);
    } catch {
      /* nothing was registered */
    }
    return {
      registered: false,
      message: getCapabilities().canRotateAutomatically
        ? 'The native wallpaper module is missing in this build.'
        : 'iOS does not allow background wallpaper changes.',
    };
  }

  try {
    const registered = await TaskManager.isTaskRegisteredAsync(ROTATION_TASK);
    if (!settings.enabled) {
      if (registered) await BackgroundTask.unregisterTaskAsync(ROTATION_TASK);
      return { registered: false, message: 'Automatic rotation is off.' };
    }

    if (!registered) defineRotationTask();
    await BackgroundTask.registerTaskAsync(ROTATION_TASK, {
      minimumInterval: Math.max(15, settings.intervalMinutes),
    });
    const status = await BackgroundTask.getStatusAsync();
    return {
      registered: true,
      message:
        status === BackgroundTask.BackgroundTaskStatus.Restricted
          ? 'Registered – the system currently restricts background work (battery or data saver).'
          : `Registered – the system refreshes the wallpaper about every ${settings.intervalMinutes} minutes (it decides the exact moment).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { registered: false, message };
  }
}
