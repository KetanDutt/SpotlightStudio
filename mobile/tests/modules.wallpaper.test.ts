/**
 * The native bridge has to survive being absent: iOS, the web and Expo Go all ship without
 * `SpotlightWallpaper`, and the app must degrade to the "save to Photos" flow instead of
 * crashing at import time.  `requireOptionalNativeModule` is therefore mocked with a value
 * the tests can flip, and the module is re-imported in isolation for each case.
 */
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: jest.fn((name: string) =>
    name === 'SpotlightWallpaper' ? (globalThis as { __wallpaperNative?: unknown }).__wallpaperNative ?? null : null,
  ),
}));

type WallpaperModule = typeof import('../src/modules/wallpaper');

function loadModule(present: boolean): WallpaperModule {
  let loaded: WallpaperModule | undefined;
  (
    globalThis as { __wallpaperNative?: unknown }
  ).__wallpaperNative = present
    ? {
        isSupported: () => true,
        supportsSeparateLockScreen: () => true,
        setWallpaper: async () => ({ success: true, target: 'home', width: 1, height: 1 }),
      }
    : null;

  jest.isolateModules(() => {
    loaded = require('../src/modules/wallpaper') as WallpaperModule;
  });

  if (!loaded) throw new Error('the module could not be loaded');
  return loaded;
}

afterEach(() => {
  delete (globalThis as { __wallpaperNative?: unknown }).__wallpaperNative;
  jest.resetModules();
});

describe('when the native module is missing', () => {
  it('exposes a null module and the unavailable flag', () => {
    const mod = loadModule(false);
    expect(mod.nativeWallpaper).toBeNull();
    expect(mod.isNativeWallpaperAvailable).toBe(false);
  });

  it('does not throw while importing', () => {
    expect(() => loadModule(false)).not.toThrow();
  });
});

describe('when the native module is present', () => {
  it('exposes it together with the available flag', () => {
    const mod = loadModule(true);
    expect(mod.isNativeWallpaperAvailable).toBe(true);
    expect(mod.nativeWallpaper?.isSupported()).toBe(true);
  });

  it('forwards the wallpaper mode to the native side', async () => {
    const mod = loadModule(true);
    await expect(mod.nativeWallpaper?.setWallpaper('file:///cache/a.jpg', 'lock')).resolves.toMatchObject({
      success: true,
      target: 'home',
    });
  });
});
