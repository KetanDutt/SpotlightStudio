/**
 * Typed facade of the local native module.
 *
 * Note: the app itself imports the *optional* loader
 * (`src/modules/wallpaper/WallpaperModule.ts`) so that a build without the native module –
 * Expo Go, or the web export – keeps working and falls back to the Photos flow.  This file
 * is the strict view, useful when you know the native module is present.
 */
import { NativeModule, requireNativeModule } from 'expo';

export type WallpaperMode = 'home' | 'lock' | 'both';

export interface SetWallpaperResult {
  success: boolean;
  target: WallpaperMode;
  width: number;
  height: number;
}

export declare class SpotlightWallpaperModule extends NativeModule {
  /** True when the OS lets an app change the wallpaper (Android only). */
  isSupported(): boolean;
  /** True on Android 7.0+ where the lock screen can be addressed separately. */
  supportsSeparateLockScreen(): boolean;
  /** Applies a `file://` image to the requested screen(s). */
  setWallpaper(uri: string, mode: WallpaperMode): Promise<SetWallpaperResult>;
}

export default requireNativeModule<SpotlightWallpaperModule>('SpotlightWallpaper');
