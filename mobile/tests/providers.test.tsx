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
import { Text, View } from 'react-native';

import { CatalogProvider, useCatalog } from '../src/providers/CatalogProvider';
import { PreferencesProvider, usePreferences } from '../src/providers/PreferencesProvider';
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
  const { catalog, meta, loading, error } = useCatalog();
  return (
    <View>
      <Text testID="count">{String(catalog?.total ?? -1)}</Text>
      <Text testID="origin">{meta.origin}</Text>
      <Text testID="loading">{String(loading)}</Text>
      <Text testID="error">{error ?? ''}</Text>
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

beforeEach(() => {
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
