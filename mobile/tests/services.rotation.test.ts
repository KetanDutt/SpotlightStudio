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
  defineRotationTask,
} from '../src/services/rotation';
import { buildCatalog } from '../src/core/utils';
import { KEYS, getJson, setJson } from '../src/services/storage';
import { cloneRows } from './fixtures';
import { applyWallpaper } from '../src/services/wallpaper';
import { clearAppCache } from '../src/services/cache';

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
      enabled: false,
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

  it('respects the high-resolution restriction even when it empties the pool', () => {
    const tiny = buildCatalog(cloneRows().filter((row) => row.width < 2000));
    const pool = buildRotationPool(tiny, { ...ROTATION_DEFAULTS, highResOnly: true }, new Set());
    expect(pool).toHaveLength(0);
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

it('never bypasses an empty favorites/tag filter and never downloads an unrelated wallpaper', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, favoritesOnly: true });
  const result = await runRotationOnce();
  expect(result.status).toBe('skipped');
  expect(result.message).toMatch(/filters/);
  expect(fs.DownloadTask.calls).toHaveLength(0);
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
});

it('enforces the interval except for manual runs; manual runs do not enable rotation', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, lastRunAt: Date.now(), highResOnly: false });
  expect((await runRotationOnce()).status).toBe('skipped');
  expect(fs.DownloadTask.calls).toHaveLength(0);
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: false, highResOnly: false });
  expect((await runRotationOnce({ force: true })).status).toBe('applied');
  const stored = await getJson<{ enabled: boolean }>(KEYS.rotation, { enabled: true });
  expect(stored.enabled).toBe(false);
});

it('coalesces overlapping rotations and preserves settings changed during a transfer', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, highResOnly: false });
  let release!: () => void;
  fs.DownloadTask.gate = new Promise<void>(resolve => { release = resolve; });
  const first = runRotationOnce();
  const second = runRotationOnce();
  expect(second).toBe(first);
  // Wait until the test double has reached the download, then emulate a user edit.
  for (let n = 0; n < 30 && !fs.DownloadTask.calls.length; n++) await Promise.resolve();
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: false, tags: ['lake'], highResOnly: false });
  release();
  expect((await first).status).toBe('skipped');
  const stored = await getJson<{ enabled: boolean; tags: string[]; runCount: number }>(KEYS.rotation, { enabled: true, tags: [], runCount: 0 });
  expect(stored.enabled).toBe(false);
  expect(stored.tags).toEqual(['lake']);
  expect(stored.runCount).toBe(0);
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
});

it('serializes enable/disable/enable scheduling without coalescing away the final intent', async () => {
  let registered = false;
  (TaskManager.isTaskRegisteredAsync as jest.Mock).mockImplementation(async () => registered);
  (BackgroundTask.registerTaskAsync as jest.Mock).mockImplementation(async () => { registered = true; });
  (BackgroundTask.unregisterTaskAsync as jest.Mock).mockImplementation(async () => { registered = false; });
  await Promise.all([
    syncRotationTask({ ...ROTATION_DEFAULTS, enabled: true }),
    syncRotationTask({ ...ROTATION_DEFAULTS, enabled: false }),
    syncRotationTask({ ...ROTATION_DEFAULTS, enabled: true }),
  ]);
  expect(registered).toBe(true);
  expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(2);
});


it('cancels a pending rotation when its selected favorite is removed', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, favoritesOnly: true, highResOnly: false });
  await setJson(KEYS.favorites, ['peapix/one.jpg']);
  let release!: () => void;
  fs.DownloadTask.gate = new Promise<void>(resolve => { release = resolve; });
  const run = runRotationOnce();
  for (let tick = 0; tick < 50 && !fs.DownloadTask.calls.length; tick++) await Promise.resolve();
  expect(() => clearAppCache()).toThrow(/Finish or cancel/);
  await setJson(KEYS.favorites, []);
  release();
  expect((await run).status).toBe('skipped');
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
});

it('lets a manual wallpaper apply preempt a background download before its OS write', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, highResOnly: false });
  let release!: () => void;
  fs.DownloadTask.gate = new Promise<void>(resolve => { release = resolve; });
  const background = runRotationOnce();
  for (let tick = 0; tick < 50 && !fs.DownloadTask.calls.length; tick++) await Promise.resolve();
  const manual = applyWallpaper(catalog.byId.get(101)!, 'home');
  release();
  expect((await background).status).toBe('skipped');
  expect((await manual).ok).toBe(true);
  expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(1);
  expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledWith(expect.stringContaining('wallpaper-101-'), 'home');
});

it('does not define iOS tasks and does not confuse unregister failures with stopped scheduling', async () => {
  platformState.platform = 'ios';
  defineRotationTask();
  expect(TaskManager.defineTask).not.toHaveBeenCalled();
  platformState.platform = 'android';
  (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
  (BackgroundTask.unregisterTaskAsync as jest.Mock).mockRejectedValueOnce(new Error('OS refused unregister'));
  const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: false });
  expect(result).toMatchObject({ registered: true, confirmed: true, message: 'OS refused unregister' });
});

it('exposes unknown scheduler state instead of asserting rotation is stopped', async () => {
  (TaskManager.isTaskRegisteredAsync as jest.Mock).mockRejectedValue(new Error('task manager unavailable'));
  const result = await syncRotationTask({ ...ROTATION_DEFAULTS, enabled: false });
  expect(result.confirmed).toBe(false);
  expect(result.message).toMatch(/Could not confirm/);
});
