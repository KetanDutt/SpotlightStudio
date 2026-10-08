/**
 * Rotation rules – pure logic, no native imports.
 *
 * Kept separate from `src/services/rotation.ts` (which owns the file system, the background
 * task and the native module) so that UI providers can read and validate the settings
 * without pulling the whole scheduling stack into memory.
 */
import type { Catalog, RotationSettings, Wallpaper } from './types';
import { asStringArray } from './storage-utils';

export const ROTATION_TASK = 'spotlight-studio-rotation';

export const ROTATION_DEFAULTS: RotationSettings = {
  enabled: false,
  intervalMinutes: 180,
  mode: 'home',
  tags: [],
  highResOnly: true,
  favoritesOnly: false,
  lastRunAt: 0,
  lastWallpaperId: 0,
  lastRunError: '',
  runCount: 0,
};

/** The platform floor for background work (WorkManager / BGTaskScheduler). */
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 1440;

/** Normalise anything that came out of storage into valid settings. */
export function coerceRotation(value: unknown): RotationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...ROTATION_DEFAULTS, tags: [] };
  const raw = value as Record<string, unknown>;
  const interval = Number(raw.intervalMinutes);
  const nonnegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  const mode: RotationSettings['mode'] = raw.mode === 'lock' || raw.mode === 'both' ? raw.mode : 'home';
  return {
    enabled: raw.enabled === true,
    intervalMinutes: Number.isFinite(interval)
      ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(interval)))
      : ROTATION_DEFAULTS.intervalMinutes,
    mode,
    tags: [...new Set(asStringArray(raw.tags).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
    highResOnly: raw.highResOnly !== false,
    favoritesOnly: raw.favoritesOnly === true,
    lastRunAt: Math.min(8640000000000000, nonnegative(raw.lastRunAt)),
    lastWallpaperId: Number.isSafeInteger(raw.lastWallpaperId) ? nonnegative(raw.lastWallpaperId) : 0,
    lastRunError: typeof raw.lastRunError === 'string' ? raw.lastRunError : '',
    runCount: nonnegative(raw.runCount),
  };
}

/** Apply the user's rotation filters to the catalog. */
export function buildRotationPool(catalog: Catalog, settings: RotationSettings, favorites: Set<string>): Wallpaper[] {
  let pool = catalog.items;
  if (settings.tags.length) {
    const wanted = new Set(settings.tags.map((tag) => tag.toLowerCase()));
    pool = pool.filter((item) => item.tags.some((tag) => wanted.has(tag)));
  }
  if (settings.favoritesOnly) {
    pool = pool.filter((item) => favorites.has(item.key));
  }
  if (settings.highResOnly) {
    pool = pool.filter((item) => item.q === '4k' || item.q === '2k');
  }
  return pool;
}

/**
 * Pick the next wallpaper: the one after `lastId` in the (id-descending) pool, wrapping
 * around.  Deterministic and testable – no randomness, no repeats.
 */
export function pickNext(pool: Wallpaper[], lastId: number): Wallpaper | undefined {
  if (!pool.length) return undefined;
  const ordered = [...pool].sort((a, b) => b.id - a.id);
  if (!lastId) return ordered[0];
  const index = ordered.findIndex((item) => item.id === lastId);
  if (index < 0) return ordered[0];
  return ordered[(index + 1) % ordered.length];
}

export interface RotationRunResult {
  status: 'applied' | 'skipped' | 'failed';
  wallpaperId?: number;
  message: string;
  bookkeeping?: Pick<RotationSettings, 'lastRunAt' | 'lastWallpaperId' | 'lastRunError' | 'runCount'>;
}
