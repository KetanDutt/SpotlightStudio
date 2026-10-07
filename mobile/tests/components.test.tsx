/**
 * Component-level tests.
 *
 * They run the real providers and the real services, replacing only the platform edges
 * (file system, photo library, native wallpaper module) – so a passing test means the whole
 * chain from a tap to the native call works.
 */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('expo-media-library', () => jest.requireActual('./mocks').mediaLibraryMock());
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  getStatusAsync: jest.fn(async () => 2),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
}));
jest.mock('../src/modules/wallpaper', () => jest.requireActual('./mocks').nativeWallpaperMock());
jest.mock('../src/data', () => ({ bundledCatalog: jest.requireActual('./fixtures').RAW_ROWS }));

const platformState = { platform: 'android' as 'android' | 'ios' };
jest.mock('../src/core/platform', () => {
  const actual = jest.requireActual('../src/core/platform');
  return {
    ...actual,
    getCapabilities: () => actual.capabilitiesFor(platformState.platform),
  };
});

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

import { ToastProvider } from '../src/components/feedback/ToastProvider';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { Chip } from '../src/components/ui/Chip';
import { Row, SectionCard, SwitchRow } from '../src/components/ui/SectionCard';
import { EmptyState, ProgressBar } from '../src/components/ui/States';
import { SetWallpaperSheet } from '../src/components/wallpaper/SetWallpaperSheet';
import { TagRail } from '../src/components/wallpaper/TagRail';
import { WallpaperCard } from '../src/components/wallpaper/WallpaperCard';
import { WallpaperRow } from '../src/components/wallpaper/WallpaperRow';
import { buildCatalog, downloadFilename } from '../src/core/utils';
import { PreferencesProvider } from '../src/providers/PreferencesProvider';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const native = jest.requireMock('../src/modules/wallpaper') as ReturnType<typeof import('./mocks').nativeWallpaperMock>;
const catalog = buildCatalog(cloneRows());
const item = catalog.byId.get(101)!;

async function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <PreferencesProvider>{ui}</PreferencesProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  fs.__reset();
  jest.clearAllMocks();
  platformState.platform = 'android';
  native.nativeWallpaper.setWallpaper.mockImplementation(async () => ({ success: true, target: 'home', width: 3840, height: 2160 }));
  native.nativeWallpaper.isSupported.mockImplementation(() => true);
  native.nativeWallpaper.supportsSeparateLockScreen.mockImplementation(() => true);
});

describe('WallpaperCard', () => {
  it('renders the title, the resolution badge and reacts to taps', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const onToggleFavorite = jest.fn();
    const view = await renderWithProviders(
      <WallpaperCard
        item={item}
        thumb="https://example.test/thumb.jpg"
        width={180}
        favorite={false}
        onPress={onPress}
        onLongPress={onLongPress}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    expect(view.getByText('Matterhorn at Sunrise')).toBeTruthy();
    expect(view.getByText('4K')).toBeTruthy();

    await fireEvent.press(view.getByLabelText(/Matterhorn at Sunrise, 4K/));
    expect(onPress).toHaveBeenCalledWith(item);

    await fireEvent(view.getByLabelText(/Matterhorn at Sunrise, 4K/), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(item);

    await fireEvent.press(view.getByLabelText(/Add Matterhorn at Sunrise to favourites/));
    expect(onToggleFavorite).toHaveBeenCalledWith(item);
  });

  it('shows a filled heart when the wallpaper is a favourite', async () => {
    const view = await renderWithProviders(
      <WallpaperCard item={item} thumb="t" width={180} favorite onPress={jest.fn()} onToggleFavorite={jest.fn()} />,
    );
    expect(view.getByLabelText(/Remove Matterhorn at Sunrise from favourites/)).toBeTruthy();
  });
});

describe('WallpaperRow', () => {
  it('shows resolution, size and date', async () => {
    const view = await renderWithProviders(<WallpaperRow item={item} thumb="t" favorite={false} onPress={jest.fn()} />);
    expect(view.getByText('Matterhorn at Sunrise')).toBeTruthy();
    expect(view.getByText(/4K \/ UHD · 3840 × 2160 · 4\.01 MB/)).toBeTruthy();
    expect(view.getByText(/Jan 15, 2024/)).toBeTruthy();
  });
});

describe('primitives', () => {
  it('renders a selected chip with its count and removes it on request', async () => {
    const onRemove = jest.fn();
    const view = await renderWithProviders(<Chip label="norway" count={12} selected onRemove={onRemove} />);
    expect(view.getByText('norway')).toBeTruthy();
    expect(view.getByText('12')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Remove norway filter'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('ignores presses while a button is loading', async () => {
    const onPress = jest.fn();
    const view = await renderWithProviders(<Button title="Set" onPress={onPress} loading testID="btn" />);
    await fireEvent.press(view.getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders badges, progress and empty states', async () => {
    const view = await renderWithProviders(
      <View>
        <Badge label="4K / UHD" gradient />
        <ProgressBar value={0.5} label="Download progress" />
        <EmptyState title="Nothing here" body="Try again later" actionLabel="Retry" onAction={jest.fn()} />
      </View>,
    );
    expect(view.getByText('4K / UHD')).toBeTruthy();
    expect(view.getByText('Nothing here')).toBeTruthy();
    expect(view.getByText('Retry')).toBeTruthy();
    expect(view.getByLabelText('Download progress')).toBeTruthy();
  });

  it('renders settings rows and switch rows', async () => {
    const onToggle = jest.fn();
    const view = await renderWithProviders(
      <SectionCard title="Rotation">
        <Row icon="sync-outline" title="Interval" value="3h" />
        <SwitchRow title="High resolution only" value={false} onValueChange={onToggle} testID="sw" />
      </SectionCard>,
    );
    expect(view.getByText('Interval')).toBeTruthy();
    await fireEvent(view.getByTestId('sw'), 'valueChange', true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders the tag rail and reports selections', async () => {
    const onSelect = jest.fn();
    const view = await renderWithProviders(
      <TagRail
        tags={[
          { tag: 'nature', count: 4 },
          { tag: 'japan', count: 1 },
        ]}
        selected="japan"
        onSelect={onSelect}
      />,
    );
    await fireEvent.press(view.getByLabelText(/^nature/));
    expect(onSelect).toHaveBeenCalledWith('nature');
  });
});

describe('SetWallpaperSheet (Android)', () => {
  it('applies the wallpaper natively with the chosen target', async () => {
    const view = await renderWithProviders(<SetWallpaperSheet item={item} visible onClose={jest.fn()} />);

    expect(view.getByText('APPLY TO')).toBeTruthy();
    await fireEvent.press(view.getByTestId('confirm-set-wallpaper'));

    await waitForCall(native.nativeWallpaper.setWallpaper);
    const [uri, mode] = native.nativeWallpaper.setWallpaper.mock.calls[0] as unknown as [string, string];
    expect(uri).toContain(`file:///cache/spotlight-studio/wallpapers/${downloadFilename(item)}`);
    expect(mode).toBe('home');
  });

  it('lets the user pick the lock screen', async () => {
    const view = await renderWithProviders(<SetWallpaperSheet item={item} visible onClose={jest.fn()} />);
    await fireEvent.press(view.getByLabelText('Lock'));
    await fireEvent.press(view.getByTestId('confirm-set-wallpaper'));
    await waitForCall(native.nativeWallpaper.setWallpaper, 'lock');
  });
});

describe('SetWallpaperSheet (iOS)', () => {
  it('explains the Shortcuts flow and saves instead of applying', async () => {
    platformState.platform = 'ios';
    const view = await renderWithProviders(<SetWallpaperSheet item={item} visible onClose={jest.fn()} />);

    expect(view.getByText(/One-time setup in Shortcuts/)).toBeTruthy();
    expect(view.queryByText('APPLY TO')).toBeNull();
    // The one-tap escape hatch into the Shortcuts app, and the exact steps, are on screen.
    expect(view.getByTestId('open-shortcuts')).toBeTruthy();
    expect(view.getByText(/new shortcut → action “Set Wallpaper”/)).toBeTruthy();

    await fireEvent.press(view.getByTestId('confirm-set-wallpaper'));
    await waitForCall(native.nativeWallpaper.setWallpaper, undefined, 1, false);
    expect(native.nativeWallpaper.setWallpaper).not.toHaveBeenCalled();
  });
});

/** Wait until the mocked native call happened (or, with `expectCall = false`, until the UI settled). */
async function waitForCall(mock: jest.Mock, mode?: string, times = 1, expectCall = true) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const calls = mock.mock.calls;
    const matches = expectCall
      ? calls.length >= times && (mode === undefined || calls.some((call) => call[1] === mode))
      : calls.length === 0;
    if (matches) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    expectCall ? `Expected ${times} native call(s) with mode ${mode}` : 'Expected no native call',
  );
}
