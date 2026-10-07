/**
 * Platform helpers – the *only* place that branches on `Platform.OS`.
 *
 * Keeping the differences here means every screen and service is cross-platform by
 * construction, and the rules are unit-testable (pass a platform string, read the result).
 */
import { Platform } from 'react-native';

export type PlatformName = 'android' | 'ios' | 'web' | (string & {});

export interface PlatformCapabilities {
  /** True when the OS lets an app change the wallpaper (Android; iOS forbids it). */
  canSetWallpaper: boolean;
  /** True when the OS supports a *separate* home and lock screen image (Android 7+). */
  canSetHomeAndLockSeparately: boolean;
  /** True when the app can schedule automatic wallpaper rotation in the background. */
  canRotateAutomatically: boolean;
  /** True when a "save to photo library" flow is available. */
  canSaveToPhotos: boolean;
  /** How the user is expected to finish setting a wallpaper. */
  fallbackKind: 'android-manual' | 'ios-shortcut' | 'none';
  /** Human readable name used in copy. */
  name: string;
}

export function capabilitiesFor(platform: PlatformName): PlatformCapabilities {
  if (platform === 'android') {
    return {
      canSetWallpaper: true,
      canSetHomeAndLockSeparately: true,
      canRotateAutomatically: true,
      canSaveToPhotos: true,
      fallbackKind: 'none',
      name: 'Android',
    };
  }
  if (platform === 'ios') {
    return {
      canSetWallpaper: false,
      canSetHomeAndLockSeparately: false,
      // iOS background tasks exist, but the OS never lets an app replace the wallpaper,
      // so a "rotation" here would save pictures nobody sees.
      canRotateAutomatically: false,
      canSaveToPhotos: true,
      fallbackKind: 'ios-shortcut',
      name: 'iOS',
    };
  }
  return {
    canSetWallpaper: false,
    canSetHomeAndLockSeparately: false,
    canRotateAutomatically: false,
    canSaveToPhotos: false,
    fallbackKind: 'none',
    name: platform === 'web' ? 'Web' : platform,
  };
}

export const platform = Platform.OS as PlatformName;

/**
 * The rules for the platform the app is running on.
 *
 * A function (not a constant) on purpose: services ask for the capabilities *when they act*,
 * which keeps them testable and means a future "switch platform" feature needs no changes here.
 */
export function getCapabilities(): PlatformCapabilities {
  return capabilitiesFor(platform);
}

/** Snapshot of the current platform's rules – convenient for render-time UI decisions. */
export const capabilities: PlatformCapabilities = getCapabilities();

export const isAndroid = platform === 'android';
export const isIOS = platform === 'ios';
export const isWeb = platform === 'web';

/** What the platform can and cannot do – shown verbatim in Settings. */
export const CAPABILITIES_NOTE = [
  'Android: this app uses the system WallpaperManager, so it can set the home screen, the lock screen or both — and it can rotate them in the background.',
  'iOS: Apple does not expose a wallpaper API. Wallpapers are saved to your photo library; use the Shortcuts “Set Wallpaper” action (or Photos → Share → Use as Wallpaper) to apply them.',
].join('\n\n');

/** Ready-made copy so both platforms explain the same thing the same way. */
export const PLATFORM_COPY = {
  androidManual: {
    title: 'Set it from the Gallery',
    body: 'The image is saved to your photo library. Open it, tap ⋮ (more) and choose “Set as wallpaper”.',
  },
  iosShortcut: {
    title: 'One-time setup in Shortcuts',
    body: 'iOS does not let apps change the wallpaper directly. Save the picture, then use the Shortcuts app with a “Set Wallpaper” action — pick this app as the source.',
  },
  iosRotationBlocked: {
    title: 'Automatic rotation needs Android',
    body: 'iOS never lets an app replace the lock or home screen image in the background, so rotation is disabled here. Everything else works the same.',
  },
} as const;
