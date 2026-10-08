jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());

import { TextDecoder } from 'node:util';
import { cacheMatchesSettings, fetchCatalog, readCachedCatalog, readCatalogSnapshot, utf8Bytes, writeCachedCatalog } from '../src/services/catalog-cache';
import { GITHUB_CATALOG_URL, LIMITS } from '../src/core/config';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;
const originalFetch = global.fetch;
const originalDecoder = global.TextDecoder;
const originalLimit = LIMITS.catalogBytes;

beforeEach(() => { fs.__reset(); global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder; });
afterEach(() => { global.fetch = originalFetch; global.TextDecoder = originalDecoder; Object.assign(LIMITS, { catalogBytes: originalLimit }); jest.useRealTimers(); });

it('measures UTF-8 bytes including emoji and lone surrogates', () => {
  expect(utf8Bytes('abc')).toBe(3);
  expect(utf8Bytes('日本😀')).toBe(10);
  expect(utf8Bytes('\ud800')).toBe(3);
});

it('retains the previous cache when writing or promoting a replacement fails', async () => {
  expect(await writeCachedCatalog(cloneRows())).toBe(true);
  const before = fs.__files.get('file:///cache/spotlight-studio/wallpapers.json')!.content;
  fs.File.failWrite = true;
  expect(await writeCachedCatalog([])).toBe(false);
  fs.File.failWrite = false;
  fs.File.failMove = true;
  expect(await writeCachedCatalog([])).toBe(false);
  fs.File.failMove = false;
  expect(fs.__files.get('file:///cache/spotlight-studio/wallpapers.json')!.content).toBe(before);
  expect((await readCachedCatalog())?.length).toBe(6);
  expect([...fs.__files.values()].filter(file => file.name.endsWith('.part') && file.exists)).toHaveLength(0);
});

it('preserves empty libraries and validates scope/future/corrupt cache snapshots', async () => {
  expect(await writeCachedCatalog([])).toBe(true);
  expect(await readCachedCatalog()).toEqual([]);
  expect((await readCatalogSnapshot())?.source).toBe(GITHUB_CATALOG_URL);
  expect(cacheMatchesSettings({ rows: [], origin: 'remote', source: 'https://other.example/catalog' })).toBe(false);
  const path = 'file:///cache/spotlight-studio/wallpapers.json';
  fs.__writeFile(path, 'not JSON');
  expect(await readCachedCatalog()).toBeNull();
  fs.__writeFile(path, JSON.stringify({ format: 'spotlight-catalog', version: 99, wallpapers: cloneRows() }));
  expect(await readCachedCatalog()).toBeNull();
});

it('enforces decoded UTF-8 size even without a content-length header', async () => {
  Object.assign(LIMITS, { catalogBytes: 20 });
  global.fetch = jest.fn(async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(['日本日本日本']) })) as unknown as typeof fetch;
  await expect(fetchCatalog('https://example.com/catalog')).rejects.toThrow(/large/);
});

it('cancels a chunked response as soon as its byte cap is exceeded', async () => {
  Object.assign(LIMITS, { catalogBytes: 10 });
  const reader = { read: jest.fn(async () => ({ done: false, value: new Uint8Array(11) })),
    cancel: jest.fn(async () => {}), releaseLock: jest.fn() };
  global.fetch = jest.fn(async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => reader } })) as unknown as typeof fetch;
  await expect(fetchCatalog('https://example.com/catalog')).rejects.toThrow(/large/);
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});

it('handles cancellation and timeouts without leaking a response-body timer', async () => {
  const controller = new AbortController();
  controller.abort();
  global.fetch = jest.fn() as unknown as typeof fetch;
  await expect(fetchCatalog('https://example.com/catalog', 20, controller.signal)).rejects.toThrow(/canceled/);
  expect(global.fetch).not.toHaveBeenCalled();
  jest.useFakeTimers();
  global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
  })) as typeof fetch;
  const result = fetchCatalog('https://example.com/catalog', 20).catch(error => error as Error);
  await jest.advanceTimersByTimeAsync(21);
  expect(((await result) as Error).message).toMatch(/timed out/);
  expect(jest.getTimerCount()).toBe(0);
});
