jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { exportFavorites, importFavorites } from '../src/services/favorites';
import { KEYS, clearAll, getJson, setJson } from '../src/services/storage';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
beforeEach(async () => { fs.__reset(); await AsyncStorage.clear(); jest.clearAllMocks(); });

it('shares the portable backup and imports it without replacing current preferences', async () => {
  const result = await exportFavorites(['peapix/one.jpg', 'future/unknown.jpg']);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(Sharing.shareAsync).toHaveBeenCalledWith(result.value, expect.objectContaining({ mimeType: 'application/json' }));
  const file = new fs.File(result.value);
  expect(JSON.parse(await file.text())).toMatchObject({ format: 'spotlight-favorites', version: 1 });
  fs.File.pickFileAsync.mockResolvedValueOnce({ result: file });
  expect(await importFavorites()).toEqual({ ok: true, value: ['peapix/one.jpg', 'future/unknown.jpg'] });
});

it('handles picker cancellation, malformed paths and oversized backups', async () => {
  expect(await importFavorites()).toEqual({ ok: true, value: null });
  const file = fs.__writeFile('file:///cache/bad.json', JSON.stringify({ format: 'spotlight-favorites', version: 1, favorites: ['../bad'] }));
  fs.File.pickFileAsync.mockResolvedValueOnce({ result: file });
  expect((await importFavorites()).ok).toBe(false);
  file.entry.size = 3 * 1024 * 1024;
  fs.File.pickFileAsync.mockResolvedValueOnce({ result: file });
  const result = await importFavorites();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/2 MB/);
});

it('reports unavailable sharing without pretending a backup was delivered', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
  const result = await exportFavorites([]);
  expect(result.ok).toBe(false);
});

it('serializes slow preference writes and provides read-after-write consistency', async () => {
  const implementation = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    calls.push(value);
    if (value === '1') await gate;
    return implementation(key, value);
  });
  try {
    const first = setJson(KEYS.toastSeen, 1);
    const second = setJson(KEYS.toastSeen, 2);
    await Promise.resolve();
    expect(calls).toEqual(['1']);
    const read = getJson(KEYS.toastSeen, 0);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await read).toBe(2);
    expect(calls).toEqual(['1', '2']);
  } finally { jest.mocked(AsyncStorage.setItem).mockImplementation(implementation); }
});


it('drains prior writes before reset, refuses new stale writes and preserves other namespaces', async () => {
  await AsyncStorage.setItem('@spotlight-studio-other-app', 'keep');
  const implementation = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { await gate; return implementation(key, value); });
  try {
    const pending = setJson(KEYS.favorites, ['peapix/one.jpg']);
    const reset = clearAll();
    expect(clearAll()).toBe(reset);
    expect(await setJson(KEYS.theme, 'dark')).toBe(false);
    const read = getJson(KEYS.favorites, []);
    release();
    expect(await pending).toBe(true);
    expect(await reset).toBe(true);
    expect(await read).toEqual([]);
    expect(await AsyncStorage.getItem('@spotlight-studio-other-app')).toBe('keep');
    expect(await setJson(KEYS.theme, 'light')).toBe(true);
  } finally { jest.mocked(AsyncStorage.setItem).mockImplementation(implementation); }
});
