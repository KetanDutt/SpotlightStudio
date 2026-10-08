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
import { getCapabilities } from '../core/platform';
import type { RawWallpaper, RotationSettings } from '../core/types';
import { buildCatalog } from '../core/utils';
import { bundledCatalog } from '../data';
import { withDownloadedWallpaper } from './media';
import { WallpaperCanceled, wallpaperIntent, nativeSetterSupported, setNativeWallpaper } from './wallpaper-controller';
import { KEYS, getJson, setJson, storageRevision } from './storage';
import { normalizeFavorites } from '../core/storage-utils';
import { readCachedCatalog } from './catalog-cache';
import { cacheActivity } from './cache';

export { ROTATION_DEFAULTS, ROTATION_TASK, buildRotationPool, coerceRotation, pickNext };
export type { RotationRunResult };

export async function readRotationSettings(): Promise<RotationSettings> {
  return coerceRotation(await getJson<unknown>(KEYS.rotation, ROTATION_DEFAULTS));
}

/** The catalog a headless run can rely on: the cached file, or the bundled fallback. */
export async function loadRowsOffline(): Promise<RawWallpaper[]> {
  const cached = await readCachedCatalog();
  return cached ?? buildCatalog(bundledCatalog).items.map((item) => item.raw);
}

function rotationPlan(settings: RotationSettings): string {
  return JSON.stringify([settings.intervalMinutes, settings.mode, settings.highResOnly, settings.favoritesOnly, [...settings.tags].sort()]);
}

let currentRun: Promise<RotationRunResult> | null = null;

/**
 * Run one rotation step.  Called by the background task *and* by the "Rotate now" button in
 * Settings, so what the user tests is exactly what the scheduler will do.
 */
export function runRotationOnce(options: { force?: boolean; settings?: RotationSettings } = {}): Promise<RotationRunResult> {
  if (currentRun) return currentRun;
  let done: () => void;
  try { done = cacheActivity(); } catch {
    return Promise.resolve({ status: 'skipped', message: 'App data is being reset. Retry rotation after startup.' });
  }
  const promise = executeRotation(options).finally(() => { currentRun = null; done(); });
  currentRun = promise;
  return promise;
}

async function executeRotation(options: { force?: boolean; settings?: RotationSettings }): Promise<RotationRunResult> {
  const intent = wallpaperIntent();
  const settings = coerceRotation(options.settings ?? (await readRotationSettings()));

  if (!settings.enabled && !options.force) {
    return { status: 'skipped', message: 'Automatic rotation is switched off.' };
  }
  if (!getCapabilities().canRotateAutomatically || !nativeSetterSupported()) {
    return {
      status: 'skipped',
      message: getCapabilities().canRotateAutomatically
        ? 'An updated native build and an unrestricted device are required for rotation.'
        : 'This platform does not let apps change the wallpaper in the background.',
    };
  }

  const elapsed = Date.now() - settings.lastRunAt;
  if (!options.force && settings.lastRunAt && elapsed >= 0 && elapsed < settings.intervalMinutes * 60000) {
    return { status: 'skipped', message: 'The rotation interval has not elapsed yet.' };
  }
  // Preserve settings changed by the user while a download was in flight.
  const record = async (patch: Partial<RotationSettings>) => {
    const latest = await readRotationSettings();
    return setJson(KEYS.rotation, { ...latest, ...patch });
  };

  try {
    const rows = await loadRowsOffline();
    if (!rows.length) return { status: 'failed', message: 'No catalog available yet.' };
    const catalog = buildCatalog(rows);

    const favorites = new Set(normalizeFavorites(await getJson<unknown>(KEYS.favorites, [])));
    const pool = buildRotationPool(catalog, settings, favorites);

    const next = pickNext(pool, settings.lastWallpaperId);
    if (!next) return { status: 'skipped', message: 'No wallpaper matches the rotation filters. Update your favorites, tags or resolution filter.' };

    const applied = await withDownloadedWallpaper(next, {}, async downloaded => {
      try {
        let rotationRevision = storageRevision(KEYS.rotation);
        let favoritesRevision = storageRevision(KEYS.favorites);
        const stillCurrent = () => rotationRevision === storageRevision(KEYS.rotation) && favoritesRevision === storageRevision(KEYS.favorites);
        await setNativeWallpaper(downloaded.uri, settings.mode, { intent, stillCurrent, stillAllowed: async () => {
          rotationRevision = storageRevision(KEYS.rotation);
          favoritesRevision = storageRevision(KEYS.favorites);
          const latest = await readRotationSettings();
          if ((!options.force || settings.enabled) && !latest.enabled) return false;
          // Reconfiguration during a transfer must not apply a stale target/filter.
          if (rotationPlan(latest) !== rotationPlan(settings)) return false;
          const favoritesNow = new Set(normalizeFavorites(await getJson<unknown>(KEYS.favorites, [])));
          return stillCurrent() && buildRotationPool(catalog, latest, favoritesNow).some(item => item.id === next.id);
        } });
        return { ok: true as const, value: true };
      } catch (error) {
        if (error instanceof WallpaperCanceled) return { ok: true as const, value: false };
        throw error;
      }
    });
    if (!applied.ok) {
      await record({ lastRunError: applied.error });
      return { status: 'failed', message: applied.error };
    }
    if (!applied.value) return { status: 'skipped', message: 'Rotation canceled: settings changed or a manual wallpaper action took precedence.' };

    const latest = await readRotationSettings();
    const bookkeeping = {
      lastRunAt: Date.now(), lastWallpaperId: next.id, lastRunError: '',
      runCount: Math.max(latest.runCount, settings.runCount) + 1,
    };
    const saved = await record(bookkeeping);
    return { status: 'applied', wallpaperId: next.id, bookkeeping,
      message: saved ? `Wallpaper ${next.id} applied.` : `Wallpaper ${next.id} applied, but rotation history could not be saved.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record({ lastRunError: message });
    return { status: 'failed', message };
  }
}

/** Register the headless task.  Must run at module scope, on every app start. */
export function defineRotationTask(): void {
  if (!getCapabilities().canRotateAutomatically) return;
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
  /** Whether the OS registration state was confirmed (errors must not imply stopped). */
  confirmed: boolean;
  message: string;
}

let scheduleState: RotationSyncResult = { registered: false, confirmed: false, message: 'Checking background scheduling…' };
const scheduleListeners = new Set<() => void>();
export function getRotationSchedule(): RotationSyncResult { return scheduleState; }
export function watchRotationSchedule(listener: () => void): () => void {
  scheduleListeners.add(listener);
  return () => { scheduleListeners.delete(listener); };
}

/**
 * Make the OS state match the settings.  Safe to call on every change: registering an
 * already registered task just updates its interval.
 */
let scheduleQueue: Promise<RotationSyncResult> = Promise.resolve({ registered: false, confirmed: false, message: '' });
const schedules = new Map<string, Promise<RotationSyncResult>>();
let lastScheduleKey = '';

export function syncRotationTask(settings: RotationSettings): Promise<RotationSyncResult> {
  const key = JSON.stringify([settings.enabled, settings.intervalMinutes]);
  const pending = schedules.get(key);
  if (pending && key === lastScheduleKey) return pending;
  const promise = scheduleQueue.then(() => applyRotationSchedule(settings)).then(result => {
    scheduleState = result;
    for (const listener of scheduleListeners) {
      try { listener(); } catch { /* One subscriber must not poison the scheduling queue. */ }
    }
    return result;
  }).finally(() => {
    if (schedules.get(key) === promise) schedules.delete(key);
  });
  lastScheduleKey = key;
  schedules.set(key, promise);
  scheduleQueue = promise;
  return promise;
}

async function applyRotationSchedule(settings: RotationSettings): Promise<RotationSyncResult> {
  if (!getCapabilities().canRotateAutomatically) {
    return { registered: false, confirmed: true, message: 'Automatic wallpaper rotation is Android-only.' };
  }
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(ROTATION_TASK);
    const supported = nativeSetterSupported();
    if (!settings.enabled || !supported) {
      if (registered) await BackgroundTask.unregisterTaskAsync(ROTATION_TASK);
      return { registered: false, confirmed: true, message: supported
        ? 'Automatic rotation is off.' : 'An updated native build and an unrestricted device are required for rotation.' };
    }
    if (!registered) defineRotationTask();
    await BackgroundTask.registerTaskAsync(ROTATION_TASK, { minimumInterval: Math.max(15, settings.intervalMinutes) });
    const status = await BackgroundTask.getStatusAsync();
    return {
      registered: true, confirmed: true,
      message: status === BackgroundTask.BackgroundTaskStatus.Restricted
        ? 'Registered – the system currently restricts background work (battery or data saver).'
        : `Registered – the system refreshes the wallpaper about every ${settings.intervalMinutes} minutes (it decides the exact moment).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An unregister/status error must not falsely tell Reset that the task has stopped.
    try {
      const registered = await TaskManager.isTaskRegisteredAsync(ROTATION_TASK);
      return { registered, confirmed: true, message };
    } catch {
      return { registered: false, confirmed: false, message: `Could not confirm background scheduling. ${message}` };
    }
  }
}
