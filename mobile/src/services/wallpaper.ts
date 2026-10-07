/**
 * Wallpaper service – the one place that decides *how* a picture becomes the wallpaper.
 *
 * Android  : the bundled native module calls `WallpaperManager` and can address the home
 *            screen, the lock screen or both.
 * iOS      : Apple does not allow third-party apps to change the wallpaper.  The honest
 *            behaviour is to save the image to the Photos library, open the album and tell
 *            the user how to finish with the Shortcuts "Set Wallpaper" action.
 *
 * Every platform therefore ends up doing *something useful*; the UI only renders the result.
 */
import { nativeWallpaper } from '../modules/wallpaper';
import { getCapabilities } from '../core/platform';
import type { Wallpaper, WallpaperMode } from '../core/types';
import type { MediaResult } from './media';
import { downloadWallpaper, saveToLibrary } from './media';

export type ApplyStatus = 'applied' | 'saved';

export interface ApplyOutcome {
  status: ApplyStatus;
  /** What actually happened on the device (may differ from the request on old Androids). */
  mode: WallpaperMode;
  /** Why the image could not be applied directly (only for `status: 'saved'`). */
  reason?: 'unsupported-platform' | 'native-unavailable' | 'native-error';
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

function fallbackMessage(reason: 'unsupported-platform' | 'native-unavailable' | 'native-error'): string {
  if (reason === 'unsupported-platform') {
    return 'Saved to your photo library. iOS does not allow apps to set the wallpaper directly – open it in Photos (or the Shortcuts “Set Wallpaper” action) to finish.';
  }
  if (reason === 'native-unavailable') {
    return 'Saved to your photo library. Wallpapers can be applied directly in the Android build of this app – open it from a “Set as wallpaper” action in your Gallery for now.';
  }
  return 'Saved to your photo library. The system refused to set the wallpaper directly, so finish from the Gallery app.';
}

export interface ApplyOptions {
  /** Progress callback for the (possibly several hundred megabyte) download. */
  onProgress?: (received: number, total: number) => void;
  /** Stop a download when the user leaves the screen. */
  signal?: AbortSignal;
}

/**
 * Apply a wallpaper.  Returns `applied` on Android (native path) and `saved` when the
 * device cannot set it – in both cases the picture is on the device afterwards.
 */
export async function applyWallpaper(
  item: Wallpaper,
  mode: WallpaperMode,
  options: ApplyOptions = {},
): Promise<MediaResult<ApplyOutcome>> {
  const reason = !getCapabilities().canSetWallpaper
    ? ('unsupported-platform' as const)
    : nativeWallpaper
      ? null
      : ('native-unavailable' as const);

  if (reason === null && nativeWallpaper) {
    try {
      const supported = nativeWallpaper.isSupported();
      if (!supported) {
        const saved = await saveToLibrary(item);
        if (!saved.ok) return saved;
        return {
          ok: true,
          value: { status: 'saved', mode, reason: 'native-error', message: fallbackMessage('native-error') },
        };
      }

      const effectiveMode: WallpaperMode =
        mode !== 'home' && !nativeWallpaper.supportsSeparateLockScreen() ? 'home' : mode;

      const downloaded = await downloadWallpaper(item, {
        onProgress: options.onProgress,
        signal: options.signal,
      });
      if (!downloaded.ok) return downloaded;

      const result = await nativeWallpaper.setWallpaper(downloaded.value.uri, effectiveMode);
      return {
        ok: true,
        value: {
          status: 'applied',
          mode: effectiveMode,
          message:
            result?.target && result.target !== effectiveMode
              ? `Applied to ${describeMode(result.target as WallpaperMode).toLowerCase()}.`
              : `Applied to ${describeMode(effectiveMode).toLowerCase()}.`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const saved = await saveToLibrary(item);
      if (!saved.ok) return { ok: false, error: `${message} – and saving it also failed: ${saved.error}` };
      return {
        ok: true,
        value: { status: 'saved', mode, reason: 'native-error', message: fallbackMessage('native-error') },
      };
    }
  }

  const saved = await saveToLibrary(item);
  if (!saved.ok) return saved;
  return {
    ok: true,
    value: {
      status: 'saved',
      mode,
      reason: reason ?? 'unsupported-platform',
      message: fallbackMessage(reason ?? 'unsupported-platform'),
    },
  };
}

/** Download the full-resolution image *without* touching the wallpaper (used by "Save"). */
export async function saveWallpaper(item: Wallpaper): Promise<MediaResult<{ uri: string }>> {
  const saved = await saveToLibrary(item);
  if (!saved.ok) return saved;
  return { ok: true, value: { uri: saved.value.uri } };
}
