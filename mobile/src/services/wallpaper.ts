/**
 * Wallpaper service – the one place that decides *how* a picture becomes the wallpaper.
 *
 * Android  : the bundled native module calls `WallpaperManager` and can address the home
 *            screen, the lock screen or both.
 * iOS      : Apple does not allow third-party apps to change the wallpaper.  The honest
 *            behaviour is to save the image to the Photos library and tell
 *            the user how to finish with the Shortcuts "Set Wallpaper" action.
 *
 * Unsupported Android/native failures are explicit errors, not implicit Photos saves.
 */
import { nativeWallpaper } from '../modules/wallpaper';
import { getCapabilities } from '../core/platform';
import type { Wallpaper, WallpaperMode } from '../core/types';
import type { MediaResult } from './media';
import { withDownloadedWallpaper, saveToLibrary } from './media';
import { beginManualWallpaperIntent, nativeSetterSupported, setNativeWallpaper } from './wallpaper-controller';

export type ApplyStatus = 'applied' | 'saved';

export interface ApplyOutcome {
  status: ApplyStatus;
  /** What actually happened on the device (may differ from the request on old Androids). */
  mode: WallpaperMode;
  /** Why the image could not be applied directly (only for `status: 'saved'`). */
  reason?: 'unsupported-platform';
  message: string;
}

export function describeMode(mode: WallpaperMode): string {
  if (mode === 'lock') return 'Lock screen';
  if (mode === 'both') return 'Home & lock screen';
  return 'Home screen';
}

/** The modes the current device can actually apply, so the picker never offers a dead end. */
export function availableModes(): WallpaperMode[] {
  if (!getCapabilities().canSetWallpaper || !nativeWallpaper) return ['home'];
  try {
    if (!nativeWallpaper.isSupported()) return ['home'];
    return nativeWallpaper.supportsSeparateLockScreen() ? ['home', 'lock', 'both'] : ['home'];
  } catch {
    return ['home'];
  }
}

export interface ApplyOptions {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

/** Apply is explicit. An Android failure never requests Photos consent or saves silently. */
export async function applyWallpaper(item: Wallpaper, mode: WallpaperMode, options: ApplyOptions = {}): Promise<MediaResult<ApplyOutcome>> {
  if (options.signal?.aborted) return { ok: false, error: 'Wallpaper action canceled.' };
  if (!getCapabilities().canSetWallpaper) {
    if (!getCapabilities().canSaveToPhotos) return { ok: false, error: 'Use the native app to save or apply this image.' };
    const saved = await saveToLibrary(item, options);
    if (!saved.ok) return saved;
    return { ok: true, value: { status: 'saved', mode, reason: 'unsupported-platform',
      message: 'Saved to your photo library. iOS does not allow apps to set the wallpaper directly; finish in Photos, Settings or Shortcuts.' } };
  }
  if (!nativeWallpaper) return { ok: false, error: 'Wallpaper changes require a development or production Android build. Use Save for the manual Gallery flow.' };
  if (!nativeSetterSupported()) return { ok: false, error: 'Wallpaper changes are unavailable in this build or restricted by device policy. Use an updated native build; saving to Photos is a separate action.' };
  const bridge = nativeWallpaper;
  const intent = beginManualWallpaperIntent();
  return withDownloadedWallpaper(item, options, async downloaded => {
    const effectiveMode = mode !== 'home' && !bridge.supportsSeparateLockScreen() ? 'home' : mode;
    const result = await setNativeWallpaper(downloaded.uri, effectiveMode, { signal: options.signal, intent });
    const actualMode = result.target as WallpaperMode;
    return { ok: true, value: { status: 'applied', mode: actualMode,
      message: `Applied to ${describeMode(actualMode).toLowerCase()}.` } };
  });
}

/** Download the full-resolution image *without* touching the wallpaper (used by "Save"). */
export async function saveWallpaper(item: Wallpaper, options: ApplyOptions = {}): Promise<MediaResult<{ uri: string }>> {
  const saved = await saveToLibrary(item, options);
  if (!saved.ok) return saved;
  return { ok: true, value: { uri: saved.value.uri } };
}
