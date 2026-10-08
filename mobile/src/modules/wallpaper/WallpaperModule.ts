/**
 * The native image-validation/wallpaper bridge (Android & iOS).
 *
 * The app ships a tiny Expo Module (`modules/wallpaper`) that talks to the Android
 * `WallpaperManager`. iOS implements image validation but explicitly refuses setting;
 * Photos/manual application is a separate flow. Expo Go/web lack this custom module and
 * support browsing, not image save/apply actions.
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
  /** Bounded validation of a private-cache image, available on Android AND iOS. */
  validateImage(uri: string): Promise<{ valid: boolean; width: number; height: number }>;
  /** Applies `uri` (a `file://` path) to the requested screen(s). */
  setWallpaper(uri: string, mode: WallpaperMode): Promise<SetWallpaperResult>;
}

/**
 * `null` when the native module is not part of the running binary
 * (web, Expo Go, or a build predating the module).
 */
export const nativeWallpaper =
  requireOptionalNativeModule<WallpaperNativeModule>('SpotlightWallpaper') ?? null;

export const isNativeWallpaperAvailable = nativeWallpaper !== null;
