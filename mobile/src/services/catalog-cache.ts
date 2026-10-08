/** Shared, validated catalog I/O for the UI and Android's headless rotation task. */
import { File } from 'expo-file-system';
import { API_BASE, GITHUB_CATALOG_URL, LIMITS, isFetchableUrl } from '../core/config';
import type { RawWallpaper } from '../core/types';
import { MAX_CATALOG_ROWS, normalizeCatalogRows } from '../core/utils';
import { appCacheDirectory, cacheActivity, cacheGeneration, pinCacheFile } from './cache';

/** UTF-8 size without allocating a second full-size byte buffer on native runtimes. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function parseRows(parsed: unknown): RawWallpaper[] {
  const value = Array.isArray(parsed) ? parsed :
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).wallpapers : null;
  if (!Array.isArray(value) || value.length > MAX_CATALOG_ROWS) throw new Error('Catalog has an unexpected shape or too many rows.');
  const rows = normalizeCatalogRows(value);
  if (value.length && !rows.length) throw new Error('The catalog contains no valid wallpaper rows.');
  return rows;
}

function parseCatalog(text: string): RawWallpaper[] {
  if (utf8Bytes(text) > LIMITS.catalogBytes) throw new Error('Catalog is unexpectedly large.');
  return parseRows(JSON.parse(text));
}

export interface CatalogSnapshot {
  rows: RawWallpaper[];
  origin: 'remote' | 'local-api';
  source?: string; // legacy array caches have no source metadata
  savedAt?: number;
}

export function cacheMatchesSettings(snapshot: CatalogSnapshot): boolean {
  return snapshot.source === GITHUB_CATALOG_URL || Boolean(API_BASE && snapshot.source === `${API_BASE}/api/catalog`) ||
    (!snapshot.source && !API_BASE);
}

function cacheFile(): File | null {
  try {
    return new File(appCacheDirectory(), 'wallpapers.json');
  } catch {
    return null; // Native cache may be unavailable (notably Expo web).
  }
}

export async function readCatalogSnapshot(): Promise<CatalogSnapshot | null> {
  let done: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    done = cacheActivity();
    const file = cacheFile();
    if (!file?.exists || !Number.isFinite(file.size) || file.size > LIMITS.catalogBytes) return null;
    const text = await Promise.race([file.text(), new Promise<string>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Cache read timed out.')), LIMITS.catalogReadDeadlineMs);
    })]);
    if (utf8Bytes(text) > LIMITS.catalogBytes) return null;
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { rows: parseRows(parsed), origin: 'remote' };
    if (!parsed || parsed.format !== 'spotlight-catalog' || parsed.version !== 1 ||
        !['remote', 'local-api'].includes(parsed.origin) || !isFetchableUrl(parsed.source) ||
        typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt) || parsed.savedAt < 0) return null;
    return { rows: parseRows(parsed), origin: parsed.origin, source: parsed.source, savedAt: parsed.savedAt };
  } catch {
    return null;
  } finally { clearTimeout(timer); done?.(); }
}

export async function readCachedCatalog(): Promise<RawWallpaper[] | null> {
  const snapshot = await readCatalogSnapshot();
  return snapshot && cacheMatchesSettings(snapshot) ? snapshot.rows : null;
}

let sequence = 0;
let writeQueue: Promise<boolean> = Promise.resolve(true);

/** Never delete the last good catalog before the replacement has been written. */
export function writeCachedCatalog(rows: RawWallpaper[], origin: CatalogSnapshot['origin'] = 'remote', source = GITHUB_CATALOG_URL, expectedGeneration = cacheGeneration()): Promise<boolean> {
  if (expectedGeneration !== cacheGeneration()) return Promise.resolve(false);
  const text = JSON.stringify({ format: 'spotlight-catalog', version: 1, origin, source, savedAt: Date.now(), wallpapers: rows });
  if (utf8Bytes(text) > LIMITS.catalogBytes) return Promise.resolve(false);
  let done: () => void;
  try { done = cacheActivity(); } catch { return Promise.resolve(false); }
  const job = writeQueue.then(async () => {
    let staged: File | null = null;
    let promoted = false;
    let unpin: (() => void) | undefined;
    try {
      const destination = cacheFile();
      if (!destination) return false;
      staged = new File(destination.parentDirectory, `catalog-${Date.now()}-${++sequence}.part`);
      unpin = pinCacheFile(staged.uri);
      staged.create();
      staged.write(text);
      await staged.move(destination, { overwrite: true });
      promoted = true;
      return true;
    } catch {
      return false;
    } finally {
      // File.move updates the object's URI, so never delete it after promotion.
      try { if (!promoted && staged?.exists) staged.delete(); } catch { /* best effort */ }
      unpin?.();
    }
  }).finally(done);
  writeQueue = job;
  return job;
}

/** Size caps apply to decoded bytes; abort + timeout cover the entire response body. */
export async function fetchCatalog(url: string, timeoutMs = 20000, signal?: AbortSignal): Promise<RawWallpaper[]> {
  if (!isFetchableUrl(url)) throw new Error('The catalog URL must be an HTTP(S) URL without embedded credentials.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    if (controller.signal.aborted) throw new Error('Catalog request canceled.');
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Catalog request failed (HTTP ${response.status}).`);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > LIMITS.catalogBytes) throw new Error('Catalog is unexpectedly large.');
    const reader = typeof TextDecoder !== 'undefined' ? response.body?.getReader?.() : undefined;
    let text: string;
    if (reader) {
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > LIMITS.catalogBytes) {
            controller.abort();
            void reader.cancel().catch(() => undefined);
            throw new Error('Catalog is unexpectedly large.');
          }
          parts.push(decoder.decode(value, { stream: true }));
        }
        parts.push(decoder.decode());
        text = parts.join('');
      } finally {
        reader.releaseLock();
      }
    } else {
      // Some native fetch implementations do not expose a stream. The declared
      // length is checked first and the decoded UTF-8 size is checked afterwards.
      text = await response.text();
    }
    if (controller.signal.aborted) throw new Error('Catalog request canceled or timed out.');
    return parseCatalog(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
