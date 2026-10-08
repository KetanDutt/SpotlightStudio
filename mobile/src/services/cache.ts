/** Bounded app-owned cache. No Photos, documents or unrelated SDK caches are deleted. */
import { Directory, File, Paths } from 'expo-file-system';
import { LIMITS } from '../core/config';

const pins = new Map<string, number>();
const used = new Map<string, number>();
let activities = 0;
let reserved = 0;
let maintenance = false;
let exportSequence = 0;
let generation = 0;
export function cacheGeneration(): number { return generation; }
const originalName = /^wallpaper-\d+-[a-f0-9]{8}\.(jpg|png|webp)$/;

export function appCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'spotlight-studio');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function wallpaperCacheDirectory(): Directory {
  const directory = new Directory(appCacheDirectory(), 'wallpapers');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Start before awaits; clear-cache must not race a permission prompt, share sheet or writer. */
export function cacheActivity(): () => void {
  if (maintenance) throw new Error('App data is being reset. Please wait and retry.');
  activities++;
  let released = false;
  return () => { if (!released) { released = true; activities--; } };
}

/** Protect a path before downloading it and until its native consumer has finished. */
export function pinCacheFile(uri: string): () => void {
  pins.set(uri, (pins.get(uri) ?? 0) + 1);
  if (originalName.test(uri.split('/').pop() ?? '')) used.set(uri, Date.now());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (pins.get(uri) ?? 1) - 1;
    if (count) pins.set(uri, count);
    else {
      pins.delete(uri);
      if (originalName.test(uri.split('/').pop() ?? '')) used.set(uri, Date.now());
    }
  };
}

function files(directory: Directory): File[] {
  return directory.exists ? directory.list().filter((entry): entry is File => entry instanceof File) : [];
}

function timestamp(file: File): number {
  const value = file.modificationTime;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bytes(file: File): number {
  const value = file.size;
  if (!Number.isFinite(value) || value < 0) throw new Error('The cache size could not be measured.');
  return value;
}

function deleteFile(file: File): void {
  file.delete();
  used.delete(file.uri);
}

/** Only known temporary/export names, and never an in-flight/pinned file. */
function cleanTemporary(directory: Directory, now: number): void {
  for (const file of files(directory)) {
    if (pins.has(file.uri)) continue;
    const transient = /^(download|catalog)-.*\.part$/.test(file.name) ||
      /^spotlight(?:-studio)?-(favorites|catalog)-.*\.(json|csv)$/.test(file.name) ||
      file.name === 'spotlight_favorites.json';
    if (transient && timestamp(file) > 0 && now - timestamp(file) > LIMITS.partialMaxAgeMs) deleteFile(file);
  }
}

/** Oldest/last-used eviction. Unknown files are counted, not silently destroyed. */
function pruneTo(target: number): number {
  const directory = wallpaperCacheDirectory();
  cleanTemporary(directory, Date.now());
  const entries = files(directory);
  let total = entries.reduce((sum, file) => sum + bytes(file), 0);
  const victims = entries.filter(file => !pins.has(file.uri) && originalName.test(file.name))
    .sort((a, b) => (used.get(a.uri) ?? timestamp(a)) - (used.get(b.uri) ?? timestamp(b)) || a.name.localeCompare(b.name));
  for (const file of victims) {
    if (total <= target) break;
    const size = bytes(file);
    deleteFile(file);
    total -= size;
  }
  return total;
}

/** Reserve the worst-case transfer size BEFORE creating/downloading a partial. */
export function reserveWallpaperDownload(): () => void {
  const target = LIMITS.wallpaperCacheBytes - reserved - LIMITS.maxWallpaperBytes;
  if (target < 0 || pruneTo(target) > target) {
    throw new Error('The image cache is busy or full. Finish other actions or clear cached images and retry.');
  }
  const available = Paths.availableDiskSpace;
  if (typeof available === 'number' && available < reserved + LIMITS.maxWallpaperBytes + LIMITS.diskSafetyBytes) {
    throw new Error('Not enough free storage to safely download this wallpaper. Free some space and retry.');
  }
  reserved += LIMITS.maxWallpaperBytes;
  let released = false;
  return () => { if (!released) { released = true; reserved -= LIMITS.maxWallpaperBytes; } };
}

/** Best effort at launch; a failure must not prevent offline browsing. */
export function maintainCache(): boolean {
  if (maintenance) return false;
  try {
    const root = appCacheDirectory();
    cleanTemporary(root, Date.now());
    // Old versions exported catalogs directly to the SDK cache root.
    cleanTemporary(new Directory(Paths.cache), Date.now());
    // Export service has a dedicated child folder.
    cleanTemporary(new Directory(root, 'exports'), Date.now());
    pruneTo(Math.max(0, LIMITS.wallpaperCacheBytes - reserved));
    return true;
  } catch { return false; }
}

export function cacheUsage(): { wallpaperBytes: number; appBytes: number; busy: boolean } {
  const root = appCacheDirectory();
  const wallpaperBytes = files(wallpaperCacheDirectory()).reduce((sum, file) => sum + bytes(file), 0);
  return { wallpaperBytes, appBytes: root.size ?? 0, busy: maintenance || activities > 0 || pins.size > 0 || reserved > 0 };
}

/** Synchronous guard and deletion: no async gap for another action to enter. */
export function clearAppCache(): void {
  if (maintenance) throw new Error('App data is being reset. Please wait.');
  removeAppCache();
}

function removeAppCache(): void {
  if (activities || pins.size || reserved) throw new Error('Finish or cancel downloads, wallpaper actions and exports before clearing the cache.');
  const directory = appCacheDirectory();
  directory.delete();
  generation++;
  used.clear();
}

/** Hold the exclusion across scheduler/storage awaits; new cache work fails explicitly. */
export async function withCacheMaintenance<T>(operation: (clear: () => void) => Promise<T>): Promise<T> {
  if (maintenance || activities || pins.size || reserved) {
    throw new Error('Finish or cancel downloads, wallpaper actions and exports before resetting app data.');
  }
  maintenance = true;
  try { return await operation(removeAppCache); }
  finally { maintenance = false; }
}

/** Unique exports are never overwritten while another app is receiving a share. */
export function createExportFile(name: string, expectedBytes = 0): File {
  if (!/^spotlight(?:-studio)?-(favorites|catalog)(?:-[a-zA-Z0-9-]+)?\.(json|csv)$/.test(name) || name.length > 160) {
    throw new Error('Invalid export filename.');
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > LIMITS.exportCacheBytes) {
    throw new Error('The export is too large for the temporary cache.');
  }
  const directory = new Directory(appCacheDirectory(), 'exports');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  cleanTemporary(directory, Date.now());
  const entries = files(directory);
  let total = entries.reduce((sum, file) => sum + bytes(file), 0);
  const victims = entries.filter(file => !pins.has(file.uri) &&
    (/^spotlight(?:-studio)?-(favorites|catalog)-.*\.(json|csv)$/.test(file.name) || file.name === 'spotlight_favorites.json'))
    .sort((a, b) => timestamp(a) - timestamp(b) || a.name.localeCompare(b.name));
  for (const file of victims) {
    if (total + expectedBytes <= LIMITS.exportCacheBytes) break;
    const size = bytes(file); deleteFile(file); total -= size;
  }
  if (total + expectedBytes > LIMITS.exportCacheBytes) throw new Error('Temporary exports are busy or full. Finish sharing or clear the cache and retry.');
  const available = Paths.availableDiskSpace;
  if (typeof available === 'number' && available < reserved + expectedBytes + LIMITS.diskSafetyBytes) {
    throw new Error('Not enough free storage for this export. Free some space and retry.');
  }
  const unique = name.replace(/\.(json|csv)$/, `-${Date.now()}-${++exportSequence}.$1`);
  return new File(directory, unique);
}
