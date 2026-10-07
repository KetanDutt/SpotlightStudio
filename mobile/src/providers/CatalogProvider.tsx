/**
 * Catalog provider – where the wallpapers come from.
 *
 * Resolution order (first one that works wins):
 *   1. a **Spotlight Studio server** on your network (`EXPO_PUBLIC_API_URL`) – fastest, always current;
 *   2. the **remote catalog** committed to the repository (`data/wallpapers.json`, ~4 MB), cached on
 *      disk so the gallery opens instantly and works offline afterwards;
 *   3. the **bundled catalog** shipped inside the app – guarantees a first-run experience with no
 *      network at all.
 *
 * The provider never throws: screens always get either a catalog or an `error` string to show.
 */
import { Directory, File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { API_BASE, CACHE_POLICY, GITHUB_CATALOG_URL, IMAGE_BASE, LIMITS, isFetchableUrl } from '../core/config';
import type { Catalog, CatalogMeta, RawWallpaper, Wallpaper } from '../core/types';
import { buildCatalog, topTags } from '../core/utils';
import { bundledCatalog } from '../data';
import { KEYS, getJson, setJson } from '../services/storage';

interface CatalogContextValue {
  catalog: Catalog | null;
  meta: CatalogMeta;
  /** True while the first catalog is being resolved. */
  loading: boolean;
  /** True while a manual/background refresh is in flight. */
  refreshing: boolean;
  error: string | null;
  /** Force a reload (pull-to-refresh, settings). */
  refresh: () => Promise<void>;
  getById: (id: number) => Wallpaper | undefined;
  getByKey: (key: string) => Wallpaper | undefined;
  /** Most used tags, computed once per catalog. */
  tags: { tag: string; count: number }[];
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

const EMPTY_META: CatalogMeta = { origin: 'none', baseUrl: '', loadedAt: 0, count: 0 };

let cacheDir: Directory | null = null;
function catalogCacheFile(): File | null {
  try {
    if (!cacheDir) cacheDir = new Directory(Paths.cache, 'spotlight-studio');
    if (!cacheDir.exists) cacheDir.create({ intermediates: true });
    return new File(cacheDir, 'wallpapers.json');
  } catch {
    return null; // web / restricted environments – the bundled catalog still works
  }
}

async function readCachedCatalog(): Promise<RawWallpaper[] | null> {
  const file = catalogCacheFile();
  if (!file) return null;
  try {
    if (!file.exists || file.size > LIMITS.catalogBytes) return null;
    const text = await file.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as RawWallpaper[]) : null;
  } catch {
    return null;
  }
}

async function writeCachedCatalog(payload: RawWallpaper[]): Promise<boolean> {
  const file = catalogCacheFile();
  if (!file) return false;
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(payload));
    return true;
  } catch {
    return false; // never mark a failed write fresh
  }
}

/** Fetch a JSON array with a hard size cap (phones have limited memory). */
async function fetchCatalog(url: string, timeoutMs = 20000): Promise<RawWallpaper[]> {
  if (!isFetchableUrl(url)) throw new Error(`Refused to fetch a non-http URL: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared && declared > LIMITS.catalogBytes) throw new Error('Catalog is unexpectedly large.');
    const text = await response.text();
    if (text.length > LIMITS.catalogBytes) throw new Error('Catalog is unexpectedly large.');
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed?.wallpapers;
    if (!Array.isArray(rows)) throw new Error('Catalog has an unexpected shape.');
    return rows as RawWallpaper[];
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRows(rows: RawWallpaper[]): RawWallpaper[] {
  // Guards against hand-edited catalogs: rows without an id/filename are dropped rather
  // than rendered as blank cards (and de-duplicated by filename, first one wins).
  const seen = new Set<string>();
  const out: RawWallpaper[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const filename = String(row.filename ?? '').trim();
    const id = Number(row.id);
    if (!filename || !Number.isFinite(id) || id <= 0) continue;
    if (seen.has(filename)) continue;
    seen.add(filename);
    out.push({
      ...row,
      id,
      filename,
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      file_size: Number(row.file_size) || 0,
      tags: typeof row.tags === 'string' ? row.tags : '',
      title: typeof row.title === 'string' ? row.title : '',
      source: String(row.source || ''),
    });
  }
  return out;
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [meta, setMeta] = useState<CatalogMeta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lastLoadedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((rows: RawWallpaper[], origin: CatalogMeta['origin'], baseUrl: string, message?: string) => {
    const next = buildCatalog(normalizeRows(rows));
    if (!mounted.current) return;
    setCatalog(next);
    lastLoadedAt.current = Date.now();
    setMeta({ origin, baseUrl, loadedAt: lastLoadedAt.current, count: next.total, error: message });
    setError(null);
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      let failure: string | undefined;
      // 1 ─ a local Spotlight Studio server (if configured)
      if (API_BASE) {
        try {
          const rows = await fetchCatalog(`${API_BASE}/api/catalog`, 8000);
          if (rows.length) {
            apply(rows, 'local-api', API_BASE);
            setLoading(false);
            setRefreshing(false);
            return;
          }
        } catch {
          /* fall through to the remote catalog */
        }
      }

      // 2 ─ the catalog cached on disk (fresh enough and no force refresh)
      if (!force) {
        const savedAt = await getJson<unknown>(KEYS.lastCatalogAt, 0);
        const cachedAge = typeof savedAt === 'number' && Number.isFinite(savedAt)
          ? Date.now() - savedAt : Infinity;
        if (cachedAge >= 0 && cachedAge < CACHE_POLICY.catalogMaxAgeMs) {
          const cached = await readCachedCatalog();
          if (cached && cached.length) {
            apply(cached, 'remote', IMAGE_BASE);
            lastLoadedAt.current = savedAt as number;
            setLoading(false);
            setRefreshing(false);
            return;
          }
        }
      }

      // 3 ─ the published catalog
      try {
        const rows = await fetchCatalog(GITHUB_CATALOG_URL);
        if (rows.length) {
          apply(rows, 'remote', IMAGE_BASE);
          if (await writeCachedCatalog(rows)) await setJson(KEYS.lastCatalogAt, Date.now());
          setLoading(false);
          setRefreshing(false);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failure = message;
        // 4 ─ the catalog cached from an earlier session
        const cached = await readCachedCatalog();
        if (cached && cached.length) {
          apply(cached, 'remote', IMAGE_BASE, `Offline – showing the catalog cached on this device (${message})`);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        if (mounted.current) setError(message);
      }

      // 5 ─ the catalog bundled with the app
      const bundled = normalizeRows(bundledCatalog as RawWallpaper[]);
      if (bundled.length) {
        apply(bundled, 'bundled', IMAGE_BASE, failure);
      } else if (mounted.current) {
        setError('No catalog available – check your internet connection and pull to refresh.');
      }
      setLoading(false);
      setRefreshing(false);
    },
    [apply],
  );

  // Pull-to-refresh and foreground events share one request, avoiding stale races.
  const loadOnce = useCallback((force: boolean): Promise<void> => {
    if (!inFlight.current) {
      inFlight.current = load(force).finally(() => { inFlight.current = null; });
    }
    return inFlight.current;
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadOnce(true);
  }, [loadOnce]);

  // First load.  Deferred by a tick so the effect body itself does not trigger a render
  // (the load sets state from asynchronous work anyway, this just keeps the rule honest).
  useEffect(() => {
    const timer = setTimeout(() => void loadOnce(false), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when the app comes back to the foreground after a while.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const age = Date.now() - lastLoadedAt.current;
      if (age > CACHE_POLICY.catalogMaxAgeMs) void loadOnce(true);
    });
    return () => sub.remove();
  }, [loadOnce]);

  const tags = useMemo(() => {
    if (!catalog) return [];
    return topTags(catalog, 120).map(([tag, count]) => ({ tag, count }));
  }, [catalog]);

  const value = useMemo<CatalogContextValue>(
    () => ({
      catalog,
      meta,
      loading,
      refreshing,
      error,
      refresh,
      getById: (id: number) => catalog?.byId.get(id),
      getByKey: (key: string) => catalog?.byKey.get(key),
      tags,
    }),
    [catalog, meta, loading, refreshing, error, refresh, tags],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog() must be used inside <CatalogProvider>.');
  return ctx;
}

/** Convenience: resolve a wallpaper or `undefined` (screens render a "not found" state). */
export function useWallpaper(id: number | undefined): Wallpaper | undefined {
  const { getById } = useCatalog();
  return id == null ? undefined : getById(id);
}
