/**
 * Automatic rotation: the filter/pick logic and one full headless run.
 * The background task must work with no React state, so these tests drive the service
 * directly against the storage and file-system doubles.
 */
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  getStatusAsync: jest.fn(async () => 2),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
}));

jest.mock('../src/data', () => ({ bundledCatalog: jest.requireActual('./fixtures').RAW_ROWS }));
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());
const platformState = { platform: 'android' as 'android' | 'ios' };
// `jest.mock` copies the factory result into a mock module, so live *getters* do not work –
// a function that reads the mutable state does.
jest.mock('../src/core/platform', () => {
  const actual = jest.requireActual('../src/core/platform');
  return {
    ...actual,
    getCapabilities: () => actual.capabilitiesFor(platformState.platform),
  };
});

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  ROTATION_DEFAULTS,
  buildRotationPool,
  coerceRotation,
  loadRowsOffline,
  pickNext,
  runRotationOnce,
  syncRotationTask,
} from '../src/services/rotation';
import { buildCatalog } from '../src/core/utils';
import { KEYS, setJson } from '../src/services/storage';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const native = jest.requireMock('../src/modules/wallpaper');
const catalog = buildCatalog(cloneRows());

beforeEach(async () => {
  fs.__reset();
  platformState.platform = 'android';
  jest.clearAllMocks();
  native.nativeWallpaper.setWallpaper.mockImplementation(async () => ({ success: true, target: 'home', width: 3840, height: 2160 }));
  (TaskManager.isTaskRegisteredAsync as jest.Mock).mockImplementation(async () => false);
  await setJson(KEYS.rotation, ROTATION_DEFAULTS);
  await setJson(KEYS.favorites, []);
});

describe('settings coercion', () => {
  it('clamps the interval to the platform minimum and maximum', () => {
    expect(coerceRotation({ intervalMinutes: 5 }).intervalMinutes).toBe(15);
    expect(coerceRotation({ intervalMinutes: 99_999 }).intervalMinutes).toBe(1440);
    expect(coerceRotation({ intervalMinutes: '180' }).intervalMinutes).toBe(180);
  });

  it('falls back to safe defaults for junk', () => {
    expect(coerceRotation(null)).toEqual(ROTATION_DEFAULTS);
    expect(coerceRotation({ mode: 'ceiling', tags: 'nope', enabled: 'yes' })).toMatchObject({
      mode: 'home',
      tags: [],
      enabled: true,
    });
  });
});

describe('the pool', () => {
  it('filters by tag, favourites and resolution', () => {
    const settings = { ...ROTATION_DEFAULTS, tags: ['japan'], highResOnly: false };
    expect(buildRotationPool(catalog, settings, new Set()).map((i) => i.id)).toEqual([102]);

    const favoriteSettings = { ...ROTATION_DEFAULTS, favoritesOnly: true, highResOnly: false };
    const pool = buildRotationPool(catalog, favoriteSettings, new Set(['peapix/five.jpg']));
    expect(pool.map((i) => i.id)).toEqual([105]);

    const hiRes = buildRotationPool(catalog, { ...ROTATION_DEFAULTS, highResOnly: true }, new Set());
    expect(hiRes.map((i) => i.id).sort()).toEqual([101, 102, 105]);
  });

  it('keeps everything when the high-resolution filter would empty the pool', () => {
    const tiny = buildCatalog(cloneRows().filter((row) => row.width < 2000));
    const pool = buildRotationPool(tiny, { ...ROTATION_DEFAULTS, highResOnly: true }, new Set());
    expect(pool).toHaveLength(tiny.total);
  });
});

describe('picking the next wallpaper', () => {
  it('walks the pool in id order and wraps around', () => {
    const pool = catalog.items;
    expect(pickNext(pool, 0)?.id).toBe(106); // highest id first
    expect(pickNext(pool, 106)?.id).toBe(105);
    expect(pickNext(pool, 101)?.id).toBe(106); // wrap
  });

  it('restarts from the top when the last wallpaper is gone', () => {
    expect(pickNext(catalog.items, 9999)?.id).toBe(106);
    expect(pickNext([], 5)).toBeUndefined();
  });

  it('never repeats the same wallpaper twice in a row', () => {
    const pool = catalog.items;
    expect(pickNext(pool, 106)?.id).not.toBe(106);
  });
});

describe('offline catalog', () => {
  it('uses the bundled catalog when nothing is cached', async () => {
    await expect(loadRowsOffline()).resolves.toHaveLength(6);
  });

  it('prefers the catalog cached on disk', async () => {
    fs.__writeFile('file:///cache/spotlight-studio/wallpapers.json', JSON.stringify(cloneRows().slice(0, 2)));
    await expect(loadRowsOffline()).resolves.toHaveLength(2);
  });

  it('falls back when the cached file is corrupt', async () => {
    fs.__writeFile('file:///cache/spotlight-studio/wallpapers.json', '{ not json');
    await expect(loadRowsOffline()).resolves.toHaveLength(6);
  });
});

describe('one rotation run', () => {
  it('applies the next wallpaper and records the bookkeeping', async () => {
    await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, lastWallpaperId: 106, highResOnly: false });
    const result = await runRotationOnce();
    expect(result.status).toBe('applied');
    expect(result.wallpaperId).toBe(105);
    expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(1);
  });

  it('does nothing while it is switched off', async () => {
    const result = await runRotationOnce();
    expect(result.status).toBe('skipped');
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });

  it('can be forced for a manual test', async () => {
    const result = await runRotationOnce({ force: true, settings: { ...ROTATION_DEFAULTS, enabled: false } });
    expect(result.status).toBe('applied');
  });

  it('records download failures instead of crashing the task', async () => {
    fs.DownloadTask.behaviour = 'throw';
    const result = await runRotationOnce({ force: true });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/network down/);
  });

  it('skips on iOS, where the OS forbids background wallpaper changes', async () => {
    platformState.platform = 'ios';
    const result = await runRotationOnce({ force: true });
    expect(result.status).toBe('skipped');
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });
});

describe('scheduler sync', () => {
  it('registers the task with the chosen interval', async () => {
    const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: true, intervalMinutes: 60 });
    expect(result.registered).toBe(true);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith('spotlight-studio-rotation', { minimumInterval: 60 });
  });

  it('unregisters when the user switches rotation off', async () => {
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockImplementation(async () => true);
    const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: false });
    expect(result.registered).toBe(false);
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalled();
  });

  it('reports restrictions instead of promising a schedule', async () => {
    (BackgroundTask.getStatusAsync as jest.Mock).mockImplementation(async () => BackgroundTask.BackgroundTaskStatus.Restricted);
    const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: true });
    expect(result.registered).toBe(true);
    expect(result.message).toMatch(/restricts/i);
  });

  it('never registers anything on iOS', async () => {
    platformState.platform = 'ios';
    const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: true });
    expect(result.registered).toBe(false);
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });
});
