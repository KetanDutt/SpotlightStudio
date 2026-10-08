/**
 * Provider behaviour: catalog loading (remote → cache → bundled fallback) and the
 * preferences that survive a restart.
 */
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
jest.mock('../src/data', () => ({ bundledCatalog: jest.requireActual('./fixtures').RAW_ROWS }));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  getStatusAsync: jest.fn(async () => 2),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

import { act, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from 'react-native';

import { CatalogProvider, useCatalog } from '../src/providers/CatalogProvider';
import { PreferencesProvider, usePreferences } from '../src/providers/PreferencesProvider';
import { KEYS } from '../src/services/storage';
import { CACHE_POLICY } from '../src/core/config';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;

const originalFetch = global.fetch;

function mockFetchOnce(rows: unknown, ok = true, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(rows),
  })) as unknown as typeof fetch;
}

function CatalogProbe() {
  const { catalog, meta, loading, error, refresh } = useCatalog();
  return (
    <View>
      <Text testID="count">{String(catalog?.total ?? -1)}</Text>
      <Text testID="origin">{meta.origin}</Text>
      <Text testID="loading">{String(loading)}</Text>
      <Text testID="error">{error ?? ''}</Text>
      <Text testID="refresh" onPress={refresh}>Refresh</Text>
    </View>
  );
}

function FavoriteProbe() {
  const { favoriteCount, toggleFavorite, isFavorite, rotation, updateRotation } = usePreferences();
  return (
    <View>
      <Text testID="fav-count">{String(favoriteCount)}</Text>
      <Text testID="fav-state">{String(isFavorite('peapix/one.jpg'))}</Text>
      <Text testID="rotation-interval">{String(rotation.intervalMinutes)}</Text>
      <Text
        testID="actions"
        onPress={() => {
          toggleFavorite('peapix/one.jpg');
          updateRotation({ enabled: true, intervalMinutes: 30 });
        }}
      >
        act
      </Text>
    </View>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  fs.__reset();
  jest.clearAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('CatalogProvider', () => {
  it('loads the published catalog and reports its origin', async () => {
    mockFetchOnce(require('./fixtures').RAW_ROWS);
    await render(
      <CatalogProvider>
        <CatalogProbe />
      </CatalogProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('6'));
    expect(screen.getByTestId('origin').props.children).toBe('remote');
    expect(screen.getByTestId('loading').props.children).toBe('false');
  });

  it('falls back to the bundled catalog when the network fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await render(
      <CatalogProvider>
        <CatalogProbe />
      </CatalogProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('6'));
    expect(screen.getByTestId('origin').props.children).toBe('bundled');
  });

  it('rejects a catalog that is not a list of wallpapers', async () => {
    mockFetchOnce({ nope: true });
    await render(
      <CatalogProvider>
        <CatalogProbe />
      </CatalogProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('6'));
    expect(screen.getByTestId('origin').props.children).toBe('bundled');
  });

  it('uses a fresh disk cache after a cold launch without fetching', async () => {
    const file = new fs.File(new fs.Directory(fs.Paths.cache, 'spotlight-studio'), 'wallpapers.json');
    file.write(JSON.stringify(require('./fixtures').RAW_ROWS.slice(0, 2)));
    await AsyncStorage.setItem(KEYS.lastCatalogAt, JSON.stringify(Date.now()));
    mockFetchOnce(require('./fixtures').RAW_ROWS);
    await render(<CatalogProvider><CatalogProbe /></CatalogProvider>);
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('2'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes an expired disk cache instead of treating it as fresh', async () => {
    const file = new fs.File(new fs.Directory(fs.Paths.cache, 'spotlight-studio'), 'wallpapers.json');
    file.write(JSON.stringify(require('./fixtures').RAW_ROWS.slice(0, 2)));
    await AsyncStorage.setItem(KEYS.lastCatalogAt, JSON.stringify(Date.now() - CACHE_POLICY.catalogMaxAgeMs - 1000));
    mockFetchOnce(require('./fixtures').RAW_ROWS);
    await render(<CatalogProvider><CatalogProbe /></CatalogProvider>);
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('6'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces simultaneous manual refreshes', async () => {
    mockFetchOnce(require('./fixtures').RAW_ROWS);
    await render(<CatalogProvider><CatalogProbe /></CatalogProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
    jest.mocked(global.fetch).mockClear();
    await act(async () => {
      await Promise.all([screen.getByTestId('refresh').props.onPress(), screen.getByTestId('refresh').props.onPress()]);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('drops malformed rows instead of rendering blank cards', async () => {
    mockFetchOnce([
      ...require('./fixtures').RAW_ROWS,
      { id: 'nope', filename: '' },
      null,
      { id: 900, filename: 'peapix/one.jpg', title: 'duplicate', width: 1920, height: 1080, file_size: 1, tags: '' },
    ]);
    await render(
      <CatalogProvider>
        <CatalogProbe />
      </CatalogProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('6'));
  });
});

describe('PreferencesProvider', () => {
  it('toggles favourites and persists rotation settings', async () => {
    await render(
      <PreferencesProvider>
        <FavoriteProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('fav-count').props.children).toBe('0'));
    await act(async () => {
      screen.getByTestId('actions').props.onPress();
    });

    await waitFor(() => expect(screen.getByTestId('fav-count').props.children).toBe('1'));
    expect(screen.getByTestId('fav-state').props.children).toBe('true');
    // The interval is clamped to the platform floor while being stored.
    expect(screen.getByTestId('rotation-interval').props.children).toBe('30');
  });
});

describe('ThemeProvider', () => {
  it('renders children once the stored preference is read', async () => {
    await render(
      <ThemeProvider>
        <Text testID="child">hello</Text>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
  });
});

function PreferenceRegressionProbe() {
  const { favorites, toggleFavorite, mergeFavorites, addHistory, history, storageError } = usePreferences();
  return <View>
    <Text testID="regression-favorites">{JSON.stringify([...favorites])}</Text>
    <Text testID="regression-history">{JSON.stringify(history)}</Text>
    <Text testID="regression-error">{storageError || ''}</Text>
    <Text testID="regression-actions" onPress={() => {
      const first = toggleFavorite('peapix/one.jpg');
      const second = toggleFavorite('peapix/one.jpg');
      if (first !== true || second !== false) throw new Error('stale toggle result');
      mergeFavorites(['future/unknown.jpg']);
      addHistory(101, 'save');
      addHistory(102, 'share');
    }}>Act</Text>
  </View>;
}

it('StrictMode preferences return accurate same-tick toggles and do not duplicate history writes', async () => {
  await render(<React.StrictMode><PreferencesProvider><PreferenceRegressionProbe /></PreferencesProvider></React.StrictMode>);
  await waitFor(() => expect(screen.getByTestId('regression-actions')).toBeTruthy());
  await act(async () => { screen.getByTestId('regression-actions').props.onPress(); });
  expect(screen.getByTestId('regression-favorites').props.children).toBe('["future/unknown.jpg"]');
  expect(JSON.parse(screen.getByTestId('regression-history').props.children).map((row: { id: number }) => row.id)).toEqual([102, 101]);
});

it('invalid stored history is dropped and failed preference persistence is visible', async () => {
  await AsyncStorage.setItem(KEYS.history, JSON.stringify([{ id: 101, action: 'made-up', at: 1 }, { id: 102, action: 'save', at: 1e99 }]));
  await render(<PreferencesProvider><PreferenceRegressionProbe /></PreferencesProvider>);
  await waitFor(() => expect(screen.getByTestId('regression-actions')).toBeTruthy());
  expect(screen.getByTestId('regression-history').props.children).toBe('[]');
  const implementation = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk full'));
  try {
    await act(async () => { screen.getByTestId('regression-actions').props.onPress(); });
    await waitFor(() => expect(screen.getByTestId('regression-error').props.children).toContain('could not be saved'));
  } finally { jest.mocked(AsyncStorage.setItem).mockImplementation(implementation); }
});

it('intentionally empty network catalogs stay empty instead of showing the bundled library', async () => {
  mockFetchOnce([]);
  await render(<CatalogProvider><CatalogProbe /></CatalogProvider>);
  await waitFor(() => expect(screen.getByTestId('origin').props.children).toBe('remote'));
  expect(screen.getByTestId('count').props.children).toBe('0');
});
