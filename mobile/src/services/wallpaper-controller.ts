/** One JS-side OS writer. Latest manual intent takes precedence over background work. */
import type { WallpaperMode } from '../core/types';
import { nativeWallpaper, type SetWallpaperResult } from '../modules/wallpaper';

let queue: Promise<unknown> = Promise.resolve();
let manualEpoch = 0;

export class WallpaperCanceled extends Error {
  constructor(message = 'Wallpaper action canceled or superseded.') { super(message); this.name = 'WallpaperCanceled'; }
}

export function nativeSetterSupported(): boolean {
  try { return Boolean(nativeWallpaper?.validateImage && nativeWallpaper.isSupported()); }
  catch { return false; }
}

export function beginManualWallpaperIntent(): number { return ++manualEpoch; }
export function wallpaperIntent(): number { return manualEpoch; }

export function setNativeWallpaper(uri: string, mode: WallpaperMode, options: {
  signal?: AbortSignal;
  intent: number;
  stillAllowed?: () => Promise<boolean>;
  stillCurrent?: () => boolean;
}): Promise<SetWallpaperResult> {
  const job = queue.then(async () => {
    const canceled = () => options.signal?.aborted || options.intent !== manualEpoch || (options.stillCurrent && !options.stillCurrent());
    if (canceled() || (options.stillAllowed && !(await options.stillAllowed())) || canceled()) throw new WallpaperCanceled();
    if (!nativeWallpaper || !nativeSetterSupported()) throw new Error('The system or work profile does not allow wallpaper changes.');
    const result = await nativeWallpaper.setWallpaper(uri, mode);
    // Once the OS call starts it is not abortable. Never claim success without confirmation.
    if (result?.success !== true || !['home', 'lock', 'both'].includes(result.target) ||
        !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width <= 0 || result.height <= 0) {
      throw new Error('The system did not confirm a wallpaper change.');
    }
    return result;
  });
  // A rejected operation must not poison subsequent attempts.
  queue = job.then(() => undefined, () => undefined);
  return job;
}
