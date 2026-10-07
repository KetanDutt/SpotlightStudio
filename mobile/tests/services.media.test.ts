/**
 * Downloading, saving, sharing and copying – the parts that touch the file system and the
 * photo library.  `expo-file-system` and `expo-media-library` are replaced by in-memory
 * doubles so the tests describe behaviour, not platform quirks.
 */
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());

jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());

import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

import {
  ALBUM_NAME,
  copyShareLink,
  downloadWallpaper,
  ensureMediaPermission,
  fullImageUrl,
  saveToLibrary,
  shareWallpaper,
  shareWebUrl,
  sourcePageUrl,
  thumbnailUrl,
} from '../src/services/media';
import { buildCatalog } from '../src/core/utils';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const media = jest.requireMock('expo-media-library') as ReturnType<typeof import('./mocks').mediaLibraryMock>;
const item = buildCatalog(cloneRows()).byId.get(101)!;

beforeEach(() => {
  fs.__reset();
  media.__reset();
  jest.clearAllMocks();
});

describe('urls', () => {
  it('prefers the original source URL and falls back to the image base', () => {
    expect(fullImageUrl(item)).toBe('https://peapix.example/one.jpg');
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
    expect(result.value.uri).toMatch(/spotlight-studio\/wallpapers\/matterhorn-at-sunrise-101\.jpg$/);
  });

  it('re-uses a file that is already on the device', async () => {
    fs.__writeFile('file:///cache/spotlight-studio/wallpapers/matterhorn-at-sunrise-101.jpg', 'x'.repeat(50_000));
    const result = await downloadWallpaper(item);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cached).toBe(true);
    expect(fs.DownloadTask.calls).toHaveLength(0);
  });

  it('refuses a tiny (broken or HTML) response and cleans up', async () => {
    fs.DownloadTask.bytes = 200;
    const result = await downloadWallpaper(item);
    expect(result.ok).toBe(false);
    const file = fs.__files.get('file:///cache/spotlight-studio/wallpapers/matterhorn-at-sunrise-101.jpg');
    expect(file?.exists).toBe(false);
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
