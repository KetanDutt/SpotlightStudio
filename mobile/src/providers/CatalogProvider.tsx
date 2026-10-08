/** Offline-first catalog resolution: device cache/bundle, optional API, then published JSON. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_BASE, CACHE_POLICY, GITHUB_CATALOG_URL, IMAGE_BASE } from '../core/config';
import type { Catalog, CatalogMeta, RawWallpaper, Wallpaper } from '../core/types';
import { buildCatalog, topTags } from '../core/utils';
import { bundledCatalog } from '../data';
import { cacheMatchesSettings, fetchCatalog, readCatalogSnapshot, writeCachedCatalog } from '../services/catalog-cache';
import { KEYS, getJson, setJson } from '../services/storage';
import { cacheGeneration } from '../services/cache';

interface CatalogContextValue {
  catalog: Catalog | null;
  meta: CatalogMeta;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** True only when a manual refresh obtained a network catalog. */
  refresh: () => Promise<boolean>;
  getById: (id: number) => Wallpaper | undefined;
  getByKey: (key: string) => Wallpaper | undefined;
  tags: { tag: string; count: number }[];
}

const CatalogContext = createContext<CatalogContextValue | null>(null);
const EMPTY_META: CatalogMeta = { origin: 'none', baseUrl: '', loadedAt: 0, count: 0 };

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [meta, setMeta] = useState<CatalogMeta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lastLoadedAt = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const apply = useCallback((rows: RawWallpaper[], origin: CatalogMeta['origin'], message?: string, loadedAt = Date.now()) => {
    if (!mounted.current) return;
    const next = buildCatalog(rows);
    setCatalog(next);
    lastLoadedAt.current = loadedAt;
    setMeta({ origin, baseUrl: IMAGE_BASE, loadedAt, count: next.total, error: message });
    setError(null);
    setLoading(false);
  }, []);

  const load = useCallback(async (force: boolean, signal: AbortSignal): Promise<boolean> => {
    const generation = cacheGeneration();
    const snapshot = await readCatalogSnapshot();
    const usable = snapshot && cacheMatchesSettings(snapshot) ? snapshot : null;
    const cached = usable?.rows;
    if (signal.aborted) return false;
    const savedAt = usable?.savedAt ?? await getJson<unknown>(KEYS.lastCatalogAt, 0);
    const timestamp = typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0;
    const age = Date.now() - timestamp;
    const cacheFresh = age >= 0 && age < CACHE_POLICY.catalogMaxAgeMs;
    const cacheOrigin = usable?.origin ?? 'remote';

    // Render useful data immediately; a slow/offline request must not hide the bundle.
    if (!force) {
      if (cached) apply(cached, cacheOrigin, undefined, timestamp);
      else apply(bundledCatalog, 'bundled');
      if (cached && cacheFresh && !API_BASE) return true;
    }

    const urls: [string, CatalogMeta['origin'], number][] = API_BASE
      ? [[`${API_BASE}/api/catalog`, 'local-api', 8000], [GITHUB_CATALOG_URL, 'remote', 20000]]
      : [[GITHUB_CATALOG_URL, 'remote', 20000]];
    let failure = 'No catalog available.';
    for (const [url, origin, timeout] of urls) {
      try {
        const rows = await fetchCatalog(url, timeout, signal);
        if (signal.aborted) return false;
        apply(rows, origin); // An intentionally empty library is valid, not a fallback trigger.
        if (await writeCachedCatalog(rows, origin === 'local-api' ? 'local-api' : 'remote', url, generation)) await setJson(KEYS.lastCatalogAt, Date.now());
        return true;
      } catch (cause) {
        if (signal.aborted) return false;
        failure = cause instanceof Error ? cause.message : String(cause);
      }
    }

    if (signal.aborted) return false;
    const message = `Offline – ${failure}`;
    if (cached) apply(cached, cacheOrigin, message, timestamp);
    else if (bundledCatalog.length) apply(bundledCatalog, 'bundled', message);
    else if (mounted.current) setError(failure);
    return false;
  }, [apply]);

  const loadOnce = useCallback((force: boolean): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const request = new AbortController();
    controller.current = request;
    const promise = load(force, request.signal).finally(() => {
      if (inFlight.current !== promise) return;
      inFlight.current = null;
      controller.current = null;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    inFlight.current = promise;
    return promise;
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    return loadOnce(true);
  }, [loadOnce]);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => void loadOnce(false), 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      controller.current?.abort();
      controller.current = null;
      inFlight.current = null;
    };
  }, [loadOnce]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastLoadedAt.current > CACHE_POLICY.catalogMaxAgeMs) void loadOnce(true);
    });
    return () => subscription.remove();
  }, [loadOnce]);

  const tags = useMemo(() => catalog ? topTags(catalog, 120).map(([tag, count]) => ({ tag, count })) : [], [catalog]);
  const value = useMemo<CatalogContextValue>(() => ({
    catalog, meta, loading, refreshing, error, refresh, tags,
    getById: (id) => catalog?.byId.get(id), getByKey: (key) => catalog?.byKey.get(key),
  }), [catalog, meta, loading, refreshing, error, refresh, tags]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) throw new Error('useCatalog() must be used inside <CatalogProvider>.');
  return context;
}

export function useWallpaper(id: number | undefined): Wallpaper | undefined {
  const { getById } = useCatalog();
  return id == null ? undefined : getById(id);
}
