/**
 * Downloading, saving, sharing and copying – the parts that touch the file system and the
 * photo library.  `expo-file-system` and `expo-media-library` are replaced by in-memory
 * doubles so the tests describe behaviour, not platform quirks.
 */
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());

jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());

import { Platform } from 'react-native';
import { clearAppCache } from '../src/services/cache';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

import {
  ALBUM_NAME,
  copyShareLink,
  downloadWallpaper,
  ensureMediaPermission,
  fullImageUrl,
  localFileFor,
  saveToLibrary,
  shareWallpaper,
  shareWebUrl,
  sourcePageUrl,
  thumbnailUrl,
} from '../src/services/media';
import { buildCatalog } from '../src/core/utils';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const native = jest.requireMock('../src/modules/wallpaper') as ReturnType<typeof import('./mocks').nativeWallpaperMock>;
const media = jest.requireMock('expo-media-library') as ReturnType<typeof import('./mocks').mediaLibraryMock>;
const item = buildCatalog(cloneRows()).byId.get(101)!;

beforeEach(() => {
  fs.__reset();
  media.__reset();
  jest.clearAllMocks();
  native.nativeWallpaper.validateImage.mockReset().mockResolvedValue({ valid: true, width: 3840, height: 2160 });
});

describe('urls', () => {
  it('respects the configured image base for originals and thumbnails', () => {
    expect(fullImageUrl(item)).toContain('/images/peapix/one.jpg?raw=true');
    expect(fullImageUrl(item, 'https://images.example')).toBe('https://images.example/images/peapix/one.jpg');
    const withoutSource = { ...item, raw: { ...item.raw, source_url: undefined } };
    expect(fullImageUrl(withoutSource)).toContain('/images/peapix/one.jpg?raw=true');
    expect(thumbnailUrl(item)).toContain('/images/thumbs/peapix/one.jpg?raw=true');
  });

  it('builds a shareable web link and validates source pages', () => {
    expect(shareWebUrl(item)).toBe('https://ketandutt.github.io/SpotlightStudio/#w=101');
    expect(sourcePageUrl(item)).toBe('https://peapix.example/one');
    expect(sourcePageUrl({ ...item, raw: { ...item.raw, page_url: 'javascript:alert(1)' } })).toBe('');
  });
});

describe('downloadWallpaper', () => {
  it('downloads into the cache directory and reports progress', async () => {
    const progress: number[] = [];
    const result = await downloadWallpaper(item, { onProgress: (received, total) => progress.push(received / total) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cached).toBe(false);
    expect(result.value.filename).toBe('matterhorn-at-sunrise-101.jpg');
    expect(result.value.uri).toBe(localFileFor(item).uri);
    expect(progress).toEqual([1]);
    expect(fs.DownloadTask.calls[0].released).toBe(true);
  });

  it('re-uses a file that is already on the device', async () => {
    fs.__writeFile(localFileFor(item).uri, '\xff\xd8\xff' + 'x'.repeat(50_000));
    const result = await downloadWallpaper(item);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cached).toBe(true);
    expect(fs.DownloadTask.calls).toHaveLength(0);
  });

  it('refuses a tiny (broken or HTML) response and cleans up', async () => {
    fs.DownloadTask.bytes = 20;
    const result = await downloadWallpaper(item);
    expect(result.ok).toBe(false);
    expect(localFileFor(item).exists).toBe(false);
    expect(fs.__files.get(fs.DownloadTask.calls[0].destination)?.exists).toBe(false);
  });

  it('reports a paused download and a network error', async () => {
    fs.DownloadTask.behaviour = 'paused';
    const paused = await downloadWallpaper(item);
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.error).toMatch(/stopped/i);

    fs.DownloadTask.behaviour = 'throw';
    const failed = await downloadWallpaper(item);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/network down/);
  });

  it('ignores a non-http source URL and uses the safe image base instead', async () => {
    const hostile = { ...item, raw: { ...item.raw, source_url: 'file:///etc/passwd' } };
    const result = await downloadWallpaper(hostile);
    expect(result.ok).toBe(true);
    expect(fs.DownloadTask.calls[0].url).toContain('github.com');
    expect(fs.DownloadTask.calls[0].url).not.toContain('passwd');
  });

  it('refuses an absurdly large file', async () => {
    fs.DownloadTask.bytes = 64 * 1024 * 1024;
    const result = await downloadWallpaper(item);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/large/i);
  });
});

describe('saveToLibrary', () => {
  it('creates the album and the asset', async () => {
    const result = await saveToLibrary(item);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assetId).toBe('asset-1');
    expect(MediaLibrary.Album.create).toHaveBeenCalledWith(ALBUM_NAME, []);
    expect(MediaLibrary.Asset.create).toHaveBeenCalledWith(expect.stringContaining('file://'), expect.objectContaining({ id: 'album-1' }));
  });

  it('reports a denied permission instead of failing silently', async () => {
    (MediaLibrary.getPermissionsAsync as jest.Mock).mockImplementation(async () => ({ granted: false, status: 'denied' }));
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockImplementation(async () => ({ granted: false, status: 'denied', accessPrivileges: 'none' }));
    expect(await ensureMediaPermission()).toBe(false);
    const result = await saveToLibrary(item);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/denied/i);
  });

  it('accepts the limited (add-only) permission', async () => {
    (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'undetermined' });
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'granted', accessPrivileges: 'limited' });
    expect(await ensureMediaPermission()).toBe(true);
  });

  it('survives an album that cannot be created', async () => {
    (MediaLibrary.Album.get as jest.Mock).mockRejectedValueOnce(new Error('no album'));
    (MediaLibrary.Album.create as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const result = await saveToLibrary(item);
    expect(result.ok).toBe(true);
  });
});

describe('share and copy', () => {
  it('shares the downloaded file', async () => {
    const result = await shareWallpaper(item);
    expect(result.ok).toBe(true);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('file://'), expect.objectContaining({ mimeType: 'image/jpeg' }));
  });

  it('reports unavailable sharing', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    const result = await shareWallpaper(item);
    expect(result.ok).toBe(false);
  });

  it('copies the deep link', async () => {
    const result = await copyShareLink(item);
    expect(result.ok).toBe(true);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('#w=101'));
  });
});

it('rejects HTML/LFS responses and re-downloads a corrupt cache entry', async () => {
  fs.DownloadTask.header = '<html>not an image';
  const response = await downloadWallpaper(item);
  expect(response.ok).toBe(false);
  expect(localFileFor(item).exists).toBe(false);
  expect(fs.DownloadTask.calls[0].released).toBe(true);
  fs.DownloadTask.header = '\xff\xd8\xff\xe0';
  fs.__writeFile(localFileFor(item).uri, 'version https://git-lfs.github.com/spec/v1\n' + 'x'.repeat(12000));
  const retried = await downloadWallpaper(item);
  expect(retried.ok).toBe(true);
  if (retried.ok) expect(retried.value.cached).toBe(false);
});

it('preserves a good cache on a failed forced transfer and cleans the partial file', async () => {
  const file = fs.__writeFile(localFileFor(item).uri, '\xff\xd8\xff' + 'old'.repeat(4000));
  const before = await file.text();
  fs.DownloadTask.behaviour = 'throw';
  expect((await downloadWallpaper(item, { force: true })).ok).toBe(false);
  expect(await file.text()).toBe(before);
  expect(fs.DownloadTask.calls[0].released).toBe(true);
  expect(fs.__files.get(fs.DownloadTask.calls[0].destination)?.exists).toBe(false);
});

it('uses stable content identity and coalesces concurrent plain downloads', async () => {
  const renamed = { ...item, title: 'A better title', raw: { ...item.raw, title: 'A better title' } };
  expect(localFileFor(renamed).uri).toBe(localFileFor(item).uri);
  const upgraded = { ...item, raw: { ...item.raw, width: 7680, downloaded_at: '2026-10-08T00:00:00Z' } };
  expect(localFileFor(upgraded).uri).not.toBe(localFileFor(item).uri);
  const [one, two] = await Promise.all([downloadWallpaper(item), downloadWallpaper(item)]);
  expect(one).toEqual(two);
  expect(fs.DownloadTask.calls).toHaveLength(1);
});

it('honors pre-cancellation without creating a transfer or a completed cache entry', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await downloadWallpaper(item, { signal: controller.signal });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/canceled/);
  expect(fs.DownloadTask.calls).toHaveLength(0);
});

it('shares the validated PNG format instead of mislabeling every image as JPEG', async () => {
  fs.DownloadTask.header = '\x89PNG\r\n\x1a\n';
  const png = { ...item, key: item.key.replace(/\.jpg$/, '.png'), raw: { ...item.raw, filename: item.raw.filename.replace(/\.jpg$/, '.png') } };
  const result = await shareWallpaper(png);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.filename).toMatch(/\.png$/);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ mimeType: 'image/png', UTI: 'public.png' }));
});


it('rejects a truncated native-decoder response before promoting or saving it', async () => {
  native.nativeWallpaper.validateImage.mockResolvedValue({ valid: false, width: 0, height: 0 });
  const result = await saveToLibrary(item);
  expect(result.ok).toBe(false);
  expect(localFileFor(item).exists).toBe(false);
  expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
  expect(fs.DownloadTask.calls[0].released).toBe(true);
  expect(fs.__files.get(fs.DownloadTask.calls[0].destination)?.exists).toBe(false);
});

it('re-downloads a signature-valid but decoder-invalid cached image exactly once', async () => {
  fs.__writeFile(localFileFor(item).uri, '\xff\xd8\xff' + 'broken'.repeat(2000));
  native.nativeWallpaper.validateImage.mockResolvedValueOnce({ valid: false, width: 0, height: 0 });
  const result = await downloadWallpaper(item);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.cached).toBe(false);
  expect(native.nativeWallpaper.validateImage).toHaveBeenCalledTimes(2);
  expect(fs.DownloadTask.calls).toHaveLength(1);
});

it('keeps a previous complete file when native validation of a forced replacement fails', async () => {
  const file = fs.__writeFile(localFileFor(item).uri, '\xff\xd8\xff' + 'old'.repeat(4000));
  const before = await file.text();
  native.nativeWallpaper.validateImage.mockResolvedValue({ valid: false, width: 0, height: 0 });
  expect((await downloadWallpaper(item, { force: true })).ok).toBe(false);
  expect(await file.text()).toBe(before);
});

it('requires the updated native validator before downloading or asking Photos consent', async () => {
  const validate = native.nativeWallpaper.validateImage;
  try {
    Object.assign(native.nativeWallpaper, { validateImage: undefined });
    const result = await saveToLibrary(item);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/updated native build/);
    expect(fs.DownloadTask.calls).toHaveLength(0);
    expect(MediaLibrary.getPermissionsAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
  } finally { native.nativeWallpaper.validateImage = validate; }
});

it('does not widen denied/add-only permissions or consume bandwidth after a denial', async () => {
  (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
  expect((await saveToLibrary(item)).ok).toBe(false);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(MediaLibrary.getPermissionsAsync).toHaveBeenCalledWith(true, ['photo']);
  expect(fs.DownloadTask.calls).toHaveLength(0);
});

it('does not silently accept a failed permission query or retry it with read access', async () => {
  (MediaLibrary.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('permissions unavailable'));
  expect((await saveToLibrary(item)).ok).toBe(false);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(fs.DownloadTask.calls).toHaveLength(0);
});

it('uses add-only Photos without an album when full read consent does not already exist', async () => {
  (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true }).mockResolvedValueOnce({ granted: false });
  expect((await saveToLibrary(item)).ok).toBe(true);
  expect(MediaLibrary.Album.get).not.toHaveBeenCalled();
  expect(MediaLibrary.Album.create).not.toHaveBeenCalled();
  expect(MediaLibrary.Asset.create).toHaveBeenCalledWith(expect.any(String), undefined);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
});

it('does not ask runtime gallery consent or browse albums when saving on Android 11+', async () => {
  const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
  const version = Object.getOwnPropertyDescriptor(Platform, 'Version')!;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 35 });
  try {
    expect((await saveToLibrary(item)).ok).toBe(true);
    expect(MediaLibrary.getPermissionsAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.Album.get).not.toHaveBeenCalled();
    expect(MediaLibrary.Asset.create).toHaveBeenCalledWith(expect.any(String), undefined);
  } finally { Object.defineProperty(Platform, 'OS', os); Object.defineProperty(Platform, 'Version', version); }
});

it('pins files through the share consumer and queues forced overwrites until it returns', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(async () => { await gate; });
  const share = shareWallpaper(item);
  for (let tick = 0; tick < 50 && !jest.mocked(Sharing.shareAsync).mock.calls.length; tick++) await Promise.resolve();
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  expect(() => clearAppCache()).toThrow(/Finish or cancel/);
  const forced = downloadWallpaper(item, { force: true });
  for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  expect(fs.DownloadTask.calls).toHaveLength(1);
  release();
  expect((await share).ok).toBe(true);
  expect((await forced).ok).toBe(true);
  expect(fs.DownloadTask.calls).toHaveLength(2);
  expect(() => clearAppCache()).not.toThrow();
});

it('does not start a queued transfer canceled while waiting for another image consumer', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(async () => { await gate; });
  const share = shareWallpaper(item);
  const controller = new AbortController();
  const canceled = downloadWallpaper(item, { force: true, signal: controller.signal });
  controller.abort();
  release(); await share;
  expect((await canceled).ok).toBe(false);
  expect(fs.DownloadTask.calls).toHaveLength(1);
});
