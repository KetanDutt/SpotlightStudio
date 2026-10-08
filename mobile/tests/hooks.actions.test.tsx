jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());
jest.mock('../src/core/platform', () => {
  const actual = jest.requireActual('../src/core/platform');
  return { ...actual, getCapabilities: () => actual.capabilitiesFor('android') };
});

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ToastProvider } from '../src/components/feedback/ToastProvider';
import { PreferencesProvider, usePreferences } from '../src/providers/PreferencesProvider';
import { useWallpaperActions } from '../src/hooks/useWallpaperActions';
import { buildCatalog } from '../src/core/utils';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const native = jest.requireMock('../src/modules/wallpaper') as ReturnType<typeof import('./mocks').nativeWallpaperMock>;
const media = jest.requireMock('expo-media-library') as ReturnType<typeof import('./mocks').mediaLibraryMock>;
const item = buildCatalog(cloneRows()).items[0];
function Wrapper({ children }: { children: React.ReactNode }) {
  return <React.StrictMode><ThemeProvider><ToastProvider><PreferencesProvider>{children}</PreferencesProvider></ToastProvider></ThemeProvider></React.StrictMode>;
}

beforeEach(async () => { await AsyncStorage.clear(); fs.__reset(); media.__reset(); jest.clearAllMocks(); });

it('Save uses the photo library, not Android wallpaper application, and ignores a double tap', async () => {
  const { result } = await renderHook(() => useWallpaperActions(item), { wrapper: Wrapper });
  await waitFor(() => expect(result.current).toBeTruthy());
  let answers: boolean[] = [];
  await act(async () => { answers = await Promise.all([result.current.save(), result.current.save()]); });
  expect(answers).toEqual([true, false]);
  expect(media.Asset.create).toHaveBeenCalledTimes(1);
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
});

it('unmount aborts a transfer before a late photo-library side effect', async () => {
  let release!: () => void;
  fs.DownloadTask.gate = new Promise<void>(resolve => { release = resolve; });
  const { result, unmount } = await renderHook(() => useWallpaperActions(item), { wrapper: Wrapper });
  await waitFor(() => expect(result.current).toBeTruthy());
  let pending!: Promise<boolean>;
  await act(async () => { pending = result.current.save(); });
  await unmount();
  release();
  expect(await pending).toBe(false);
  expect(media.Asset.create).not.toHaveBeenCalled();
  expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
});


it('changing the detail item cancels the old transfer before a Photos side effect', async () => {
  let release!: () => void;
  fs.DownloadTask.gate = new Promise<void>(resolve => { release = resolve; });
  const { result, rerender } = await renderHook(({ selected }: { selected: typeof item }) => useWallpaperActions(selected),
    { initialProps: { selected: item }, wrapper: Wrapper });
  await waitFor(() => expect(result.current).toBeTruthy());
  let pending!: Promise<boolean>;
  await act(async () => { pending = result.current.save(); });
  await rerender({ selected: buildCatalog(cloneRows()).items[1] });
  release();
  await act(async () => { expect(await pending).toBe(false); });
  expect(media.Asset.create).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
});

it('records a confirmed native completion even if Cancel was tapped after Android started', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  native.nativeWallpaper.setWallpaper.mockImplementationOnce(async () => {
    await gate; return { success: true, target: 'home', width: 3840, height: 2160 };
  });
  const { result } = await renderHook(() => ({ actions: useWallpaperActions(item), prefs: usePreferences() }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current).toBeTruthy());
  let pending!: Promise<boolean>;
  await act(async () => { pending = result.current.actions.apply('home'); });
  await waitFor(() => expect(native.nativeWallpaper.setWallpaper).toHaveBeenCalledTimes(1));
  await act(async () => { result.current.actions.cancel(); release(); expect(await pending).toBe(true); });
  expect(result.current.prefs.history).toHaveLength(1);
  expect(result.current.prefs.history[0]).toMatchObject({ id: item.id, action: 'download' });
  expect(result.current.actions.busy).toBe(false);
});
