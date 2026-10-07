/**
 * Media service – download, save, share and copy.
 *
 * Downloads land in the app's cache directory (never in the user's photo library unless
 * they ask for it) and are de-duplicated by file name, so re-opening a wallpaper costs
 * nothing.  Every function returns a plain result object instead of throwing, because all
 * of them are called from UI code that must show a message either way.
 */
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
// `Asset`/`Album` are the current (non-deprecated) media-library API – the legacy
// `createAssetAsync`/`getAlbumAsync` functions throw at runtime in SDK 57.
import type { Album } from 'expo-media-library';
// SDK 57's Next module has no web implementation. Load it only when a native
// photo action is requested, never while mounting the cross-platform gallery.
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

import { GITHUB_OWNER, GITHUB_REPO, IMAGE_BASE, LIMITS, imageUrl, isFetchableUrl } from '../core/config';
import type { Wallpaper } from '../core/types';
import { downloadFilename } from '../core/utils';

export const ALBUM_NAME = 'Spotlight Studio';

function mediaLibrary(): typeof import('expo-media-library') {
  // Intentionally lazy: Metro and Jest both support this without evaluating the
  // native-only module when the web gallery first mounts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-media-library');
}

export interface DownloadedFile {
  uri: string;
  filename: string;
  /** True when the file was already on the device. */
  cached: boolean;
  size: number;
}

export type MediaResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): MediaResult<T> {
  return { ok: true, value };
}

function fail<T>(error: unknown): MediaResult<T> {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return { ok: false, error: message };
}

let downloadsDir: Directory | null = null;

function cacheDirectory(): Directory {
  if (!downloadsDir) downloadsDir = new Directory(Paths.cache, 'spotlight-studio', 'wallpapers');
  if (!downloadsDir.exists) downloadsDir.create({ intermediates: true });
  return downloadsDir;
}

/** Where the full-resolution copy of a wallpaper lives locally (`<slug>-<id>.jpg`). */
export function localFileFor(item: Wallpaper): File {
  return new File(cacheDirectory(), downloadFilename(item));
}

/** Absolute URL of the full-resolution image (GitHub LFS blob or the configured base). */
export function fullImageUrl(item: Wallpaper, base = IMAGE_BASE): string {
  return item.raw.source_url && /^https?:\/\//i.test(item.raw.source_url) ? item.raw.source_url : imageUrl(item.raw.filename, false, base);
}

export function thumbnailUrl(item: Wallpaper, base = IMAGE_BASE): string {
  return imageUrl(item.raw.filename, true, base);
}

/** Public web page of a wallpaper – the same deep link the showcase uses (`#w=<id>`). */
export function shareWebUrl(item: Wallpaper): string {
  return `https://${GITHUB_OWNER.toLowerCase()}.github.io/${GITHUB_REPO}/#w=${item.id}`;
}

export function sourcePageUrl(item: Wallpaper): string {
  const candidate = String(item.raw.page_url || item.raw.source_url || '');
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

export interface DownloadOptions {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
  /** Ignore an existing cached copy and fetch again. */
  force?: boolean;
}

/**
 * Download the full-resolution image into the cache directory.
 * A partially written download never becomes a `File` – `expo-file-system` moves the
 * finished download into place only on success.
 */
export async function downloadWallpaper(
  item: Wallpaper,
  options: DownloadOptions = {},
): Promise<MediaResult<DownloadedFile>> {
  try {
    const url = fullImageUrl(item);
    if (!isFetchableUrl(url)) return fail('This wallpaper has no downloadable URL.');

    const destination = localFileFor(item);
    if (!options.force && destination.exists && destination.size > 8 * 1024) {
      return ok({ uri: destination.uri, filename: destination.name, cached: true, size: destination.size });
    }

    const task = new DownloadTask(url, destination, {
      onProgress: (data) => {
        if (options.onProgress && data) options.onProgress(data.bytesWritten, data.totalBytes);
      },
      signal: options.signal,
      headers: { Accept: 'image/*' },
    });

    let file: File | null = null;
    try {
      file = await task.downloadAsync();
    } finally {
      task.release();
    }

    if (!file) return fail('Download stopped. Try again to resume it.');
    if (!file.exists || file.size < 8 * 1024) {
      try {
        file.delete();
      } catch {
        /* best effort */
      }
      return fail('The download was incomplete. Check your connection and try again.');
    }
    if (file.size > LIMITS.maxWallpaperBytes) {
      try {
        file.delete();
      } catch {
        /* best effort */
      }
      return fail('That image is unexpectedly large and was not saved.');
    }

    return ok({ uri: file.uri, filename: file.name, cached: false, size: file.size });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Media-library permission: ask for *add only* first (least privilege, and the only thing
 * Android 13+ needs) and widen the request only if the platform refuses it.
 */
export async function ensureMediaPermission(): Promise<boolean> {
  try {
    const { getPermissionsAsync, requestPermissionsAsync } = mediaLibrary();
    const current = await getPermissionsAsync(true, ['photo']);
    if (current.granted) return true;
    const asked = await requestPermissionsAsync(true, ['photo']);
    if (asked.granted || asked.accessPrivileges === 'limited') return true;
    const fallback = await requestPermissionsAsync(false, ['photo']);
    return Boolean(fallback.granted || fallback.accessPrivileges === 'limited');
  } catch {
    // Older/odd platforms: the save below will surface a useful error if it is missing.
    return true;
  }
}

/** The app's album, created on first use. */
export async function ensureAlbum(): Promise<Album | undefined> {
  const { Album } = mediaLibrary();
  try {
    const existing = await Album.get(ALBUM_NAME);
    if (existing) return existing;
  } catch {
    /* not found → create below */
  }
  try {
    return await Album.create(ALBUM_NAME, []);
  } catch {
    return undefined; // saving still works, the picture just lands in "Recent"
  }
}

/**
 * Save a wallpaper to the device photo library (creating the "Spotlight Studio" album).
 * This is the last step of the wallpaper flow on every platform.
 */
export async function saveToLibrary(item: Wallpaper): Promise<MediaResult<DownloadedFile & { assetId: string }>> {
  const downloaded = await downloadWallpaper(item);
  if (!downloaded.ok) return downloaded;

  if (!(await ensureMediaPermission())) {
    return fail('Permission to add photos was denied. You can enable it in Settings → Spotlight Studio.');
  }

  try {
    const { Asset } = mediaLibrary();
    const album = await ensureAlbum();
    const asset = await Asset.create(downloaded.value.uri, album);
    return ok({ ...downloaded.value, assetId: asset.id });
  } catch (error) {
    return fail(error);
  }
}

export async function shareWallpaper(item: Wallpaper): Promise<MediaResult<DownloadedFile>> {
  const downloaded = await downloadWallpaper(item);
  if (!downloaded.ok) return downloaded;
  try {
    if (!(await Sharing.isAvailableAsync())) return fail('Sharing is not available on this device.');
    await Sharing.shareAsync(downloaded.value.uri, {
      mimeType: 'image/jpeg',
      dialogTitle: item.title,
      UTI: 'public.jpeg',
    });
    return downloaded;
  } catch (error) {
    return fail(error);
  }
}

export async function copyShareLink(item: Wallpaper): Promise<MediaResult<string>> {
  const url = shareWebUrl(item);
  try {
    await Clipboard.setStringAsync(url);
    return ok(url);
  } catch (error) {
    return fail(error);
  }
}
