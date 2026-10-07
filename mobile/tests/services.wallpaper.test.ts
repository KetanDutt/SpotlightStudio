/**
 * The wallpaper flow.  Two platform personalities are simulated by mocking
 * `src/core/platform` and `src/modules/wallpaper`:
 *
 *  * Android with the native module → the picture is applied directly;
 *  * iOS (or Android without the module) → the picture is saved to Photos and the user is
 *    told exactly how to finish.
 */
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());

jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());

const platformState = { platform: 'android' as 'android' | 'ios' };
// `jest.mock` copies the factory result into a mock module, so live *getters* do not work –
// a function that reads the mutable state does.
jest.mock('../src/core/platform', () => {
  const actual = jest.requireActual('../src/core/platform');
  return {
    ...actual,
    getCapabilities: () => actual.capabilitiesFor(platformState.platform),
  };
});

import { applyWallpaper, availableModes, describeMode, saveWallpaper } from '../src/services/wallpaper';
import { buildCatalog } from '../src/core/utils';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const native = jest.requireMock('../src/modules/wallpaper') as ReturnType<typeof import('./mocks').nativeWallpaperMock>;
const item = buildCatalog(cloneRows()).byId.get(101)!;

beforeEach(() => {
  fs.__reset();
  jest.clearAllMocks();
  platformState.platform = 'android';
  native.nativeWallpaper.setWallpaper.mockImplementation(async () => ({ success: true, target: 'home', width: 3840, height: 2160 }));
  native.nativeWallpaper.isSupported.mockImplementation(() => true);
  native.nativeWallpaper.supportsSeparateLockScreen.mockImplementation(() => true);
});

describe('platform behaviour', () => {
  it('applies the wallpaper natively on Android', async () => {
    const result = await applyWallpaper(item, 'both');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('applied');
    expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledWith(expect.stringContaining('file://'), 'both');
  });

  it('falls back to the home screen on Android versions without a lock flag', async () => {
    native.nativeWallpaper.supportsSeparateLockScreen.mockImplementation(() => false);
    const result = await applyWallpaper(item, 'both');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe('home');
    expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledWith(expect.anything(), 'home');
  });

  it('saves to the photo library on iOS and explains the Shortcuts step', async () => {
    platformState.platform = 'ios';
    const result = await applyWallpaper(item, 'home');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('saved');
    expect(result.value.reason).toBe('unsupported-platform');
    expect(result.value.message).toMatch(/iOS does not allow apps to set the wallpaper/i);
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });

  it('saves to the photo library when the native module refuses', async () => {
    native.nativeWallpaper.setWallpaper.mockImplementation(async () => {
      throw new Error('Android refused the image');
    });
    const result = await applyWallpaper(item, 'home');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('saved');
    expect(result.value.reason).toBe('native-error');
  });

  it('does not pretend to work when the device cannot set wallpapers at all', async () => {
    native.nativeWallpaper.isSupported.mockImplementation(() => false);
    const result = await applyWallpaper(item, 'home');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('saved');
  });

  it('reports a failed download before touching the wallpaper', async () => {
    fs.DownloadTask.behaviour = 'throw';
    const result = await applyWallpaper(item, 'home');
    expect(result.ok).toBe(false);
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });
});

describe('capability reporting', () => {
  it('offers every target on modern Android', () => {
    expect(availableModes()).toEqual(['home', 'lock', 'both']);
  });

  it('offers only the home screen without lock-screen support', () => {
    native.nativeWallpaper.supportsSeparateLockScreen.mockImplementation(() => false);
    expect(availableModes()).toEqual(['home']);
  });

  it('offers a single option on iOS', () => {
    platformState.platform = 'ios';
    expect(availableModes()).toEqual(['home']);
  });

  it('describes the targets in plain language', () => {
    expect(describeMode('home')).toBe('Home screen');
    expect(describeMode('lock')).toBe('Lock screen');
    expect(describeMode('both')).toBe('Home & lock screen');
  });
});

describe('saveWallpaper', () => {
  it('saves without changing the wallpaper', async () => {
    const result = await saveWallpaper(item);
    expect(result.ok).toBe(true);
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });
});
