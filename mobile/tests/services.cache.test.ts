jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());

import { LIMITS } from '../src/core/config';
import { appCacheDirectory, cacheActivity, cacheGeneration, cacheUsage, clearAppCache, createExportFile,
  maintainCache, pinCacheFile, reserveWallpaperDownload, wallpaperCacheDirectory, withCacheMaintenance } from '../src/services/cache';
import { readCatalogSnapshot, writeCachedCatalog } from '../src/services/catalog-cache';
import { downloadWallpaper } from '../src/services/media';
import { exportFavorites } from '../src/services/favorites';
import { buildCatalog } from '../src/core/utils';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const originalLimits = { ...LIMITS };
const MiB = 1024 * 1024;
const item = buildCatalog(cloneRows()).items[0];

beforeEach(() => {
  fs.__reset();
  clearAppCache();
  fs.Paths.availableDiskSpace = 1024 * MiB;
  jest.clearAllMocks();
});
afterEach(() => { Object.assign(LIMITS, originalLimits); jest.useRealTimers(); });

function image(id: number, size: number, age: number) {
  const file = fs.__writeFile(`${wallpaperCacheDirectory().uri}/wallpaper-${id}-1234abcd.jpg`, 'image');
  file.entry.size = size;
  file.entry.modificationTime = Date.now() - age;
  return file;
}

it('evicts the oldest managed originals before reserving transfer space', () => {
  Object.assign(LIMITS, { wallpaperCacheBytes: 100 * MiB });
  const oldest = image(1, 30 * MiB, 30000);
  const middle = image(2, 30 * MiB, 20000);
  const newest = image(3, 30 * MiB, 10000);
  const release = reserveWallpaperDownload();
  expect(oldest.exists).toBe(false);
  expect(middle.exists && newest.exists).toBe(true);
  expect(cacheUsage().wallpaperBytes).toBe(60 * MiB);
  release(); release(); // Releasing twice must not subtract another reservation.
  expect(cacheUsage().busy).toBe(false);
});

it('protects consumer pins and never evicts unrecognized files to hide an over-budget cache', () => {
  Object.assign(LIMITS, { wallpaperCacheBytes: 80 * MiB });
  const active = image(10, 40 * MiB, 30000);
  const other = image(11, 40 * MiB, 20000);
  const unpin = pinCacheFile(active.uri);
  const release = reserveWallpaperDownload();
  expect(active.exists).toBe(true);
  expect(other.exists).toBe(false);
  release(); unpin();
  const unknown = fs.__writeFile(`${wallpaperCacheDirectory().uri}/not-owned.bin`, 'unknown');
  unknown.entry.size = 90 * MiB;
  expect(() => reserveWallpaperDownload()).toThrow(/busy or full/);
  expect(unknown.exists).toBe(true);
});

it('bounds concurrent worst-case reservations and includes them in free-disk checks', () => {
  Object.assign(LIMITS, { wallpaperCacheBytes: 80 * MiB });
  const one = reserveWallpaperDownload();
  const two = reserveWallpaperDownload();
  expect(() => reserveWallpaperDownload()).toThrow(/busy or full/);
  one(); one();
  const three = reserveWallpaperDownload();
  two(); three();
  fs.Paths.availableDiskSpace = 55 * MiB;
  expect(() => reserveWallpaperDownload()).toThrow(/free storage/);
  expect(cacheUsage().busy).toBe(false);
});

it('cleans only stale owned partials/exports, including legacy names, and respects pins', () => {
  const old = Date.now() - LIMITS.partialMaxAgeMs - 1;
  const root = appCacheDirectory().uri;
  const files = [
    `${root}/catalog-old.part`, `${wallpaperCacheDirectory().uri}/download-old.part`,
    `${root}/exports/spotlight-favorites-123-1.json`, `${root}/exports/spotlight_favorites.json`,
    'file:///cache/spotlight-studio-catalog-20261001-1230.csv',
  ].map(uri => { const file = fs.__writeFile(uri, 'old'); file.entry.modificationTime = old; return file; });
  new fs.Directory(root, 'exports').create();
  const unknown = fs.__writeFile(`${root}/exports/my-backup.json`, 'keep'); unknown.entry.modificationTime = old;
  const pinned = files[1];
  const unpin = pinCacheFile(pinned.uri);
  expect(maintainCache()).toBe(true);
  expect(pinned.exists).toBe(true);
  expect(files.filter(file => file.exists)).toEqual([pinned]);
  expect(unknown.exists).toBe(true);
  unpin();
  maintainCache();
  expect(pinned.exists).toBe(false);
});

it('refuses destructive clearing while an activity, file pin or reservation exists', () => {
  const end = cacheActivity();
  expect(() => clearAppCache()).toThrow(/Finish or cancel/); end(); end();
  const unpin = pinCacheFile(image(20, MiB, 1).uri);
  expect(() => clearAppCache()).toThrow(/Finish or cancel/); unpin();
  const release = reserveWallpaperDownload();
  expect(() => clearAppCache()).toThrow(/Finish or cancel/); release();
  clearAppCache();
  expect(cacheUsage().wallpaperBytes).toBe(0);
});

it('holds reset exclusion across awaits and returns media/export errors instead of rejections', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const maintenance = withCacheMaintenance(async clear => { await gate; clear(); });
  expect(cacheUsage().busy).toBe(true);
  expect(() => cacheActivity()).toThrow(/being reset/);
  expect(() => clearAppCache()).toThrow(/being reset/);
  expect(await readCatalogSnapshot()).toBeNull();
  expect((await downloadWallpaper(item)).ok).toBe(false);
  expect((await exportFavorites([])).ok).toBe(false);
  await expect(withCacheMaintenance(async () => {})).rejects.toThrow(/Finish or cancel/);
  finish(); await maintenance;
  expect(cacheUsage().busy).toBe(false);
  const end = cacheActivity(); end();
  await expect(withCacheMaintenance(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(cacheUsage().busy).toBe(false);
});

it('uses distinct share filenames even when two exports have the same date and contents', () => {
  const one = createExportFile('spotlight-studio-catalog-20261008-1230.json');
  const two = createExportFile('spotlight-studio-catalog-20261008-1230.json');
  expect(one.uri).not.toBe(two.uri);
  expect(one.uri).toContain('/spotlight-studio/exports/');
});

it('protects queued catalog writes and refuses stale network snapshots after an explicit clear', async () => {
  const original = fs.File.prototype.move;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const spy = jest.spyOn(fs.File.prototype, 'move').mockImplementation(async function (this: InstanceType<typeof fs.File>, destination) {
    await gate; return original.call(this, destination);
  });
  try {
    const generation = cacheGeneration();
    const write = writeCachedCatalog(cloneRows());
    expect(() => clearAppCache()).toThrow(/Finish or cancel/);
    release();
    expect(await write).toBe(true);
    expect((await readCatalogSnapshot())?.rows).toHaveLength(6);
    clearAppCache();
    expect(await writeCachedCatalog(cloneRows(), 'remote', undefined, generation)).toBe(false);
    expect(await readCatalogSnapshot()).toBeNull();
  } finally { spy.mockRestore(); }
});

it('falls back instead of hanging on a stalled native catalog read', async () => {
  jest.useFakeTimers();
  const file = fs.__writeFile(`${appCacheDirectory().uri}/wallpapers.json`, '[]');
  file.entry.text = () => new Promise<string>(() => {});
  const read = readCatalogSnapshot();
  await jest.advanceTimersByTimeAsync(LIMITS.catalogReadDeadlineMs + 1);
  expect(await read).toBeNull();
  expect(cacheUsage().busy).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});


it('bounds temporary export bytes, protects active shares and refuses invalid export paths', () => {
  Object.assign(LIMITS, { exportCacheBytes: 10 * MiB });
  const one = createExportFile('spotlight-favorites.json', 6 * MiB);
  one.write('first'); fs.__files.get(one.uri)!.size = 6 * MiB;
  const unpin = pinCacheFile(one.uri);
  expect(() => createExportFile('spotlight-favorites.json', 6 * MiB)).toThrow(/busy or full/);
  unpin();
  expect(() => createExportFile('spotlight-favorites.json', 6 * MiB)).not.toThrow();
  expect(one.exists).toBe(false);
  expect(() => createExportFile('../favorites.json')).toThrow(/filename/);
  expect(() => createExportFile('spotlight-favorites.json', 11 * MiB)).toThrow(/large/);
});
