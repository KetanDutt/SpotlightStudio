/**
 * The native wallpaper bridge (Android).
 *
 * The app ships a tiny Expo Module (`modules/wallpaper`) that talks to the Android
 * `WallpaperManager`.  On iOS – and in Expo Go, where no custom native code can exist –
 * `requireOptionalNativeModule` returns `null` and the UI falls back to the
 * "save to Photos + Shortcuts" flow.  Nothing here ever throws at import time.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { WallpaperMode } from '../../core/types';

export interface SetWallpaperResult {
  success: boolean;
  /** The screen(s) that were updated: `home`, `lock` or `both`. */
  target: string;
  width: number;
  height: number;
}

export interface WallpaperNativeModule {
  /** True when `WallpaperManager.isWallpaperSupported()`. */
  isSupported(): boolean;
  /** True on Android 7.0+ where `FLAG_LOCK` exists. */
  supportsSeparateLockScreen(): boolean;
  /** Applies `uri` (a `file://` path) to the requested screen(s). */
  setWallpaper(uri: string, mode: WallpaperMode): Promise<SetWallpaperResult>;
}

/**
 * `null` when the native module is not part of the running binary
 * (iOS, web, Expo Go, or a build predating the module).
 */
export const nativeWallpaper =
  requireOptionalNativeModule<WallpaperNativeModule>('SpotlightWallpaper') ?? null;

export const isNativeWallpaperAvailable = nativeWallpaper !== null;
