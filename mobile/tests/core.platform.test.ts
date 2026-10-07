/** The platform rule table – the contract every screen and service relies on. */
import { CAPABILITIES_NOTE, PLATFORM_COPY, capabilitiesFor } from '../src/core/platform';

describe('android', () => {
  const caps = capabilitiesFor('android');

  it('can set wallpapers, address both screens and rotate in the background', () => {
    expect(caps.canSetWallpaper).toBe(true);
    expect(caps.canSetHomeAndLockSeparately).toBe(true);
    expect(caps.canRotateAutomatically).toBe(true);
    expect(caps.canSaveToPhotos).toBe(true);
    expect(caps.fallbackKind).toBe('none');
    expect(caps.name).toBe('Android');
  });
});

describe('ios', () => {
  const caps = capabilitiesFor('ios');

  it('is honest: no wallpaper API, so no direct set and no rotation', () => {
    expect(caps.canSetWallpaper).toBe(false);
    expect(caps.canSetHomeAndLockSeparately).toBe(false);
    expect(caps.canRotateAutomatically).toBe(false);
    expect(caps.canSaveToPhotos).toBe(true);
    expect(caps.fallbackKind).toBe('ios-shortcut');
    expect(caps.name).toBe('iOS');
  });
});

describe('unknown platforms', () => {
  it('degrades to "cannot do anything native" instead of guessing', () => {
    const caps = capabilitiesFor('web');
    expect(caps.canSetWallpaper).toBe(false);
    expect(caps.canRotateAutomatically).toBe(false);
    expect(caps.canSaveToPhotos).toBe(false);
    expect(capabilitiesFor('tizen').name).toBe('tizen');
  });
});

describe('user-facing copy', () => {
  it('explains every fallback', () => {
    expect(PLATFORM_COPY.iosShortcut.title).toMatch(/Shortcuts/);
    expect(PLATFORM_COPY.iosRotationBlocked.body).toMatch(/iOS/);
    expect(CAPABILITIES_NOTE).toMatch(/WallpaperManager/);
  });
});
