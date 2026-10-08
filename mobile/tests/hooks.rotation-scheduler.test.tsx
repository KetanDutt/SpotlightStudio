jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(), isTaskDefined: jest.fn(() => false), isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined), unregisterTaskAsync: jest.fn(async () => undefined),
  getStatusAsync: jest.fn(async () => 2), BackgroundTaskStatus: { Restricted: 1, Available: 2 },
}));
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());
jest.mock('../src/data', () => ({ bundledCatalog: [] }));
jest.mock('../src/core/platform', () => {
  const actual = jest.requireActual('../src/core/platform');
  return { ...actual, getCapabilities: () => actual.capabilitiesFor('android') };
});

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useRotationScheduler } from '../src/hooks/useRotationScheduler';
import { PreferencesProvider, usePreferences } from '../src/providers/PreferencesProvider';
import { KEYS, getJson, setJson } from '../src/services/storage';
import { ROTATION_DEFAULTS } from '../src/services/rotation';
import type { RotationSettings } from '../src/core/types';

function Wrapper({ children }: { children: React.ReactNode }) { return <PreferencesProvider>{children}</PreferencesProvider>; }

beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  jest.mocked(TaskManager.isTaskRegisteredAsync).mockResolvedValue(false);
});

it('restores scheduling at root without opening Settings', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true, intervalMinutes: 60 });
  const screen = await renderHook(() => { useRotationScheduler(); return usePreferences(); }, { wrapper: Wrapper });
  await waitFor(() => expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith('spotlight-studio-rotation', { minimumInterval: 60 }));
  expect(screen.result.current.rotation.enabled).toBe(true);
});

it('keeps exactly one scheduler owner when the user disables rotation', async () => {
  await setJson(KEYS.rotation, { ...ROTATION_DEFAULTS, enabled: true });
  const { result } = await renderHook(() => { useRotationScheduler(); return usePreferences(); }, { wrapper: Wrapper });
  await waitFor(() => expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1));
  jest.mocked(TaskManager.isTaskRegisteredAsync).mockResolvedValue(true);
  await act(async () => { result.current.updateRotation({ enabled: false }); });
  await waitFor(() => expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledTimes(1));
  expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1);
});

it('reconciles headless bookkeeping and registration on foreground without replacing UI filters', async () => {
  let foreground: (state: AppStateStatus) => void = () => {};
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    foreground = callback; return { remove: jest.fn() };
  });
  try {
    const { result } = await renderHook(() => { useRotationScheduler(); return usePreferences(); }, { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());
    await act(async () => { result.current.updateRotation({ tags: ['alps'], enabled: false }); });
    const stored = await getJson(KEYS.rotation, ROTATION_DEFAULTS);
    await setJson(KEYS.rotation, { ...stored, runCount: 3, lastWallpaperId: 101, lastRunAt: Date.now() });
    await act(async () => { foreground('active'); });
    await waitFor(() => expect(result.current.rotation.runCount).toBe(3));
    expect(result.current.rotation.tags).toEqual(['alps']);
    const persisted = await getJson<RotationSettings>(KEYS.rotation, ROTATION_DEFAULTS);
    expect(persisted.runCount).toBe(3);
    expect(persisted.enabled).toBe(false);
  } finally { listener.mockRestore(); }
});
