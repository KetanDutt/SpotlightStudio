/**
 * Media service – download, save, share and copy.
 *
 * Downloads land in the app's cache directory (never in the user's photo library unless
 * requested). Identity includes the catalog path, configured URL and image metadata;
 * staged, native-validated transfers keep damaged images out of the completed cache.
 * Per-image leases keep downloads from overwriting a file used by a native consumer.
 * Every function returns a plain result object instead of throwing, because all
 * of them are called from UI code that must show a message either way.
 */
import { DownloadTask, File } from 'expo-file-system';
import { Platform } from 'react-native';
import { getCapabilities } from '../core/platform';
import { nativeWallpaper } from '../modules/wallpaper';
import { cacheActivity, pinCacheFile, reserveWallpaperDownload, wallpaperCacheDirectory } from './cache';
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
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
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

/** Metadata-aware identity: title changes do not re-download; image upgrades do. */
function cacheFilename(item: Wallpaper): string {
  const key = JSON.stringify([item.id, item.key, fullImageUrl(item), item.raw.width, item.raw.height,
    item.raw.file_size, item.raw.downloaded_at]);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  const ext = downloadFilename(item).split('.').pop();
  return `wallpaper-${item.id}-${(hash >>> 0).toString(16).padStart(8, '0')}.${ext}`;
}

export function localFileFor(item: Wallpaper): File {
  return new File(wallpaperCacheDirectory(), cacheFilename(item));
}

/** Full images and thumbnails both respect the configured image host. */
export function fullImageUrl(item: Wallpaper, base = IMAGE_BASE): string {
  return imageUrl(item.raw.filename, false, base);
}

export function thumbnailUrl(item: Wallpaper, base = IMAGE_BASE): string {
  return imageUrl(item.raw.filename, true, base);
}

export function shareWebUrl(item: Wallpaper): string {
  return `https://${GITHUB_OWNER.toLowerCase()}.github.io/${GITHUB_REPO}/#w=${item.id}`;
}

export function sourcePageUrl(item: Wallpaper): string {
  const candidate = String(item.raw.page_url || item.raw.source_url || '');
  return isFetchableUrl(candidate) ? candidate : '';
}

export interface DownloadOptions {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
  force?: boolean;
}

/** Read only the header, not a multi-megabyte array. Refuse HTML, LFS pointers and SVG. */
function imageMime(file: File): DownloadedFile['mimeType'] | null {
  if (!file.exists || file.size < 32 || file.size > LIMITS.maxWallpaperBytes) return null;
  let handle: ReturnType<File['open']> | undefined;
  try {
    handle = file.open();
    const header = handle.readBytes(16);
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte);
    const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    return jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
  } catch {
    return null;
  } finally {
    try { handle?.close(); } catch { /* best effort */ }
  }
}

let sequence = 0;
const inFlight = new Map<string, Promise<MediaResult<DownloadedFile>>>();

async function transfer(item: Wallpaper, options: DownloadOptions): Promise<MediaResult<DownloadedFile>> {
  let staged: File | undefined;
  let task: DownloadTask | undefined;
  let promoted = false;
  let oversized = false;
  let timedOut = false;
  let endActivity: (() => void) | undefined;
  let unpin: (() => void) | undefined;
  let unpinStage: (() => void) | undefined;
  let releaseBudget: (() => void) | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); task?.cancel(); }, LIMITS.wallpaperTimeoutMs);
  try {
    endActivity = cacheActivity();
    if (controller.signal.aborted) return fail('Download canceled.');
    if (!nativeWallpaper?.validateImage) return fail(NATIVE_BUILD_MESSAGE);
    const url = fullImageUrl(item);
    if (!isFetchableUrl(url)) return fail('This wallpaper has no downloadable URL.');
    const destination = localFileFor(item);
    const filename = downloadFilename(item);
    unpin = pinCacheFile(destination.uri);
    const cachedMime = options.force ? null : imageMime(destination);
    if (cachedMime) {
      try {
        await validateNativeImage(destination);
        if (controller.signal.aborted) return fail('Download canceled.');
        options.onProgress?.(destination.size, destination.size);
        return ok({ uri: destination.uri, filename, mimeType: cachedMime, cached: true, size: destination.size });
      } catch (error) {
        if (!(error instanceof InvalidImage)) throw error;
        destination.delete(); // Reject old header-only caches and re-download once.
      }
    }
    releaseBudget = reserveWallpaperDownload();
    staged = new File(wallpaperCacheDirectory(), `download-${item.id}-${Date.now()}-${++sequence}.part`);
    unpinStage = pinCacheFile(staged.uri);
    task = new DownloadTask(url, staged, {
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (bytesWritten > LIMITS.maxWallpaperBytes || totalBytes > LIMITS.maxWallpaperBytes) {
          oversized = true;
          cancel();
          task?.cancel();
          return;
        }
        options.onProgress?.(bytesWritten, totalBytes);
      },
    });
    const file = await task.downloadAsync();
    if (oversized || (file && file.size > LIMITS.maxWallpaperBytes)) return fail('That image is unexpectedly large and was not saved.');
    if (controller.signal.aborted) return fail(timedOut ? 'Download timed out. Check your connection and try again.' : 'Download canceled.');
    if (!file) return fail('Download stopped. Try again.');
    const mimeType = imageMime(file);
    if (!mimeType) return fail('The response is not a complete supported image. It may be a Git LFS pointer; check the image host and retry.');
    await validateNativeImage(file);
    if (controller.signal.aborted) return fail('Download canceled.');
    await file.move(destination, { overwrite: true });
    promoted = true;
    return ok({ uri: destination.uri, filename, mimeType, cached: false, size: destination.size });
  } catch (error) {
    if (oversized) return fail('That image is unexpectedly large and was not saved.');
    if (controller.signal.aborted) return fail(timedOut ? 'Download timed out. Check your connection and try again.' : 'Download canceled.');
    return fail(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    try { task?.release(); } catch { /* best effort: preserve the operation result */ }
    try { if (!promoted && staged?.exists) staged.delete(); } catch { /* best effort */ }
    releaseBudget?.(); unpinStage?.(); unpin?.(); endActivity?.();
  }
}

/** Serialize transfers AND consumers for one image, including interactive/forced requests. */
const imageQueues = new Map<string, Promise<unknown>>();
function withImageAccess<T>(item: Wallpaper, operation: () => Promise<MediaResult<T>>): Promise<MediaResult<T>> {
  let done: () => void;
  try { done = cacheActivity(); } catch (error) { return Promise.resolve(fail(error)); }
  const key = cacheFilename(item);
  const job = (imageQueues.get(key) ?? Promise.resolve()).then(operation).catch(error => fail<T>(error)).finally(done);
  imageQueues.set(key, job);
  void job.then(() => { if (imageQueues.get(key) === job) imageQueues.delete(key); });
  return job;
}

/** Plain requests coalesce. Interactive requests keep their own progress/cancellation. */
export function downloadWallpaper(item: Wallpaper, options: DownloadOptions = {}): Promise<MediaResult<DownloadedFile>> {
  if (options.signal || options.onProgress || options.force) return withImageAccess(item, () => transfer(item, options));
  const key = cacheFilename(item);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = withImageAccess(item, () => transfer(item, options)).finally(() => { inFlight.delete(key); });
  inFlight.set(key, promise);
  return promise;
}

/** Native builds validate decoded image bounds/content before any promotion or side effect. */
class InvalidImage extends Error {}
const NATIVE_BUILD_MESSAGE = 'Image validation needs an updated native build. Expo Go can browse; use a development or production build to save/apply images.';

async function validateNativeImage(file: File): Promise<void> {
  if (!nativeWallpaper?.validateImage) {
    throw new Error(NATIVE_BUILD_MESSAGE);
  }
  const result = await nativeWallpaper.validateImage(file.uri);
  if (result?.valid !== true || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) ||
      result.width <= 0 || result.height <= 0 || result.width * result.height > 120_000_000) throw new InvalidImage('The downloaded image is damaged or unsupported. Retry the image download.');
}

/** Keep the image pinned across native calls/share sheets, not just the transfer itself. */
export function withDownloadedWallpaper<T>(item: Wallpaper, options: DownloadOptions,
  consume: (file: DownloadedFile) => Promise<MediaResult<T>>): Promise<MediaResult<T>> {
  return withImageAccess(item, async () => {
    let unpin: (() => void) | undefined;
    try {
      unpin = pinCacheFile(localFileFor(item).uri);
      const downloaded = await transfer(item, options);
      if (!downloaded.ok) return downloaded;
      if (options.signal?.aborted) return fail('Wallpaper action canceled.');
      return await consume(downloaded.value);
    } catch (error) { return fail(error); }
    finally { unpin?.(); }
  });
}

/** Add-only consent. Never widen to reading the user's gallery after a denial. */
export async function ensureMediaPermission(): Promise<boolean> {
  if (!getCapabilities().canSaveToPhotos) return false;
  // SDK 57 uses MediaStore insertion on Android 11+: no runtime read permission.
  if (Platform.OS === 'android' && Number(Platform.Version) >= 30) return true;
  try {
    const { getPermissionsAsync, requestPermissionsAsync } = mediaLibrary();
    const current = await getPermissionsAsync(true, ['photo']);
    if (current.granted || current.accessPrivileges === 'limited') return true;
    if (current.canAskAgain === false) return false;
    const asked = await requestPermissionsAsync(true, ['photo']);
    return Boolean(asked.granted || asked.accessPrivileges === 'limited');
  } catch { return false; }
}

/** Album lookup is optional and must not trigger a request to read the whole gallery. */
export async function ensureAlbum(): Promise<Album | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  try {
    const { Album, getPermissionsAsync } = mediaLibrary();
    const read = await getPermissionsAsync(false, ['photo']); // query only, never prompt
    if (!read.granted || read.accessPrivileges === 'limited') return undefined;
    return (await Album.get(ALBUM_NAME)) ?? (await Album.create(ALBUM_NAME, []));
  } catch { return undefined; } // Add-only saving still lands in Photos / Recent.
}

/** Ask consent BEFORE downloading; keep cancellation checks at every native boundary. */
export async function saveToLibrary(item: Wallpaper, options: DownloadOptions = {}): Promise<MediaResult<DownloadedFile & { assetId: string }>> {
  let done: (() => void) | undefined;
  try {
    done = cacheActivity();
    if (options.signal?.aborted) return fail('Save canceled.');
    if (!nativeWallpaper?.validateImage) return fail(NATIVE_BUILD_MESSAGE);
    if (!(await ensureMediaPermission())) return fail('Permission to add photos is unavailable or denied. Enable Photos access in Settings → Spotlight Studio; a native build is required.');
    if (options.signal?.aborted) return fail('Save canceled.');
    return await withDownloadedWallpaper(item, options, async downloaded => {
      const { Asset } = mediaLibrary();
      const album = await ensureAlbum();
      if (options.signal?.aborted) return fail('Save canceled.');
      const asset = await Asset.create(downloaded.uri, album);
      return ok({ ...downloaded, assetId: asset.id });
    });
  } catch (error) { return fail(error); }
  finally { done?.(); }
}

export async function shareWallpaper(item: Wallpaper, options: DownloadOptions = {}): Promise<MediaResult<DownloadedFile>> {
  return withDownloadedWallpaper(item, options, async downloaded => {
    if (!(await Sharing.isAvailableAsync())) return fail('Sharing is not available on this device.');
    if (options.signal?.aborted) return fail('Share canceled.');
    await Sharing.shareAsync(downloaded.uri, {
      mimeType: downloaded.mimeType, dialogTitle: item.title,
      UTI: downloaded.mimeType === 'image/jpeg' ? 'public.jpeg' : downloaded.mimeType === 'image/png' ? 'public.png' : 'public.image',
    });
    return ok(downloaded);
  });
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
