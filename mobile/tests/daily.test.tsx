import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { buildCatalog, dailyWallpaper } from '../src/core/utils';
import { useDailyWallpaper } from '../src/hooks/useDailyWallpaper';
import { DailySpotlight } from '../src/components/wallpaper/DailySpotlight';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { cloneRows } from './fixtures';

const catalog = buildCatalog(Array.from({ length: 100 }, (_, index) => ({ ...cloneRows()[0], id: index + 1, filename: `peapix/${index}.jpg` })));
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('advances the UTC daily pick at midnight and clears its timer on unmount', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-08T23:59:59Z'));
  const scheduled = jest.spyOn(global, 'setTimeout');
  const cleared = jest.spyOn(global, 'clearTimeout');
  const { result, unmount } = await renderHook(() => useDailyWallpaper(catalog));
  expect(result.current?.id).toBe(dailyWallpaper(catalog, new Date('2026-10-08T00:00:00Z'))?.id);
  await act(async () => { await jest.advanceTimersByTimeAsync(1100); });
  expect(result.current?.id).toBe(dailyWallpaper(catalog, new Date('2026-10-09T00:00:00Z'))?.id);
  const index = scheduled.mock.calls.map(([, delay]) => typeof delay === 'number' && delay > 60_000).lastIndexOf(true);
  expect(index).toBeGreaterThanOrEqual(0);
  const midnightTimer = scheduled.mock.results[index].value;
  await unmount();
  // React Native/test-renderer owns other timers; assert OUR timer is cleared.
  expect(cleared).toHaveBeenCalledWith(midnightTimer);
});

it('refreshes after suspension across several days, not just from a foreground timer', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  let resumed!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { resumed = listener; return { remove }; });
  const { result, unmount } = await renderHook(() => useDailyWallpaper(catalog));
  jest.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  await act(async () => { resumed('active'); });
  expect(result.current?.id).toBe(dailyWallpaper(catalog, new Date('2026-10-12T00:00:00Z'))?.id);
  await unmount();
  expect(remove).toHaveBeenCalled();
});

it('offers accessible open/favorite actions using the selected wallpaper, without applying it', async () => {
  await AsyncStorage.clear();
  const item = catalog.items[0];
  const open = jest.fn(), favorite = jest.fn();
  const { rerender } = await render(<ThemeProvider><DailySpotlight item={item} favorite={false} onOpen={open} onToggleFavorite={favorite} /></ThemeProvider>);
  await fireEvent.press(screen.getByRole('button', { name: `Daily spotlight: ${item.title}` }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add daily wallpaper to favourites' }));
  expect(open).toHaveBeenCalledWith(item);
  expect(favorite).toHaveBeenCalledWith(item);
  await rerender(<ThemeProvider><DailySpotlight item={item} favorite onOpen={open} onToggleFavorite={favorite} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: 'Remove daily wallpaper from favourites' }).props.accessibilityState.selected).toBe(true);
});
