jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());

import { WallpaperCanceled, beginManualWallpaperIntent, nativeSetterSupported, setNativeWallpaper, wallpaperIntent } from '../src/services/wallpaper-controller';

const native = jest.requireMock('../src/modules/wallpaper') as ReturnType<typeof import('./mocks').nativeWallpaperMock>;
const confirmed = { success: true, target: 'home', width: 3840, height: 2160 };
const uri = 'file:///cache/spotlight-studio/wallpapers/image.jpg';

beforeEach(() => {
  beginManualWallpaperIntent();
  native.nativeWallpaper.setWallpaper.mockReset().mockResolvedValue(confirmed);
  native.nativeWallpaper.isSupported.mockReset().mockReturnValue(true);
});

it('serializes OS writers and keeps an already started system operation unabortable', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  native.nativeWallpaper.setWallpaper.mockImplementationOnce(async () => { await gate; return confirmed; });
  const controller = new AbortController();
  const intent = wallpaperIntent();
  const first = setNativeWallpaper(uri, 'home', { intent, signal: controller.signal });
  const second = setNativeWallpaper(uri, 'home', { intent });
  await Promise.resolve();
  expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(1);
  controller.abort(); release();
  expect(await first).toEqual(confirmed); // Must not lie: Android already started this write.
  expect(await second).toEqual(confirmed);
  expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(2);
});

it('gives a newer manual intent priority over queued background/stale manual work', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  native.nativeWallpaper.setWallpaper.mockImplementationOnce(async () => { await gate; return confirmed; });
  const old = wallpaperIntent();
  const active = setNativeWallpaper(uri, 'home', { intent: old });
  const stale = setNativeWallpaper(uri, 'home', { intent: old }).catch(error => error as Error);
  await Promise.resolve();
  const latest = setNativeWallpaper(uri, 'home', { intent: beginManualWallpaperIntent() });
  release();
  await active;
  expect(await stale).toBeInstanceOf(WallpaperCanceled);
  expect(await latest).toEqual(confirmed);
  expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(2);
});

it('rechecks a pending async policy guard and cancellation before touching Android', async () => {
  const controller = new AbortController();
  const stillAllowed = jest.fn(async () => { controller.abort(); return true; });
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent(), signal: controller.signal, stillAllowed })).rejects.toBeInstanceOf(WallpaperCanceled);
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent(), stillAllowed: async () => false })).rejects.toBeInstanceOf(WallpaperCanceled);
});

it('requires a confirmed outcome with valid dimensions and recovers its queue after rejection', async () => {
  native.nativeWallpaper.setWallpaper.mockResolvedValueOnce({ ...confirmed, success: false });
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent() })).rejects.toThrow(/confirm/);
  native.nativeWallpaper.setWallpaper.mockResolvedValueOnce({ ...confirmed, target: 'ceiling' });
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent() })).rejects.toThrow(/confirm/);
  native.nativeWallpaper.setWallpaper.mockResolvedValueOnce({ ...confirmed, width: 0 });
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent() })).rejects.toThrow(/confirm/);
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent() })).resolves.toEqual(confirmed);
});

it('reports native policy/context failures without throwing during a render-time capability check', async () => {
  native.nativeWallpaper.isSupported.mockImplementation(() => { throw new Error('context lost'); });
  expect(nativeSetterSupported()).toBe(false);
  await expect(setNativeWallpaper(uri, 'home', { intent: wallpaperIntent() })).rejects.toThrow(/work profile/);
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
});
