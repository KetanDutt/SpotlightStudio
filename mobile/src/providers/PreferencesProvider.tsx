/** Local user data: defensive reads, synchronous event snapshots and serialized writes. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryAction, HistoryItem, RotationSettings } from '../core/types';
import { ROTATION_DEFAULTS, coerceRotation } from '../core/rotation';
import { MAX_FAVORITES, asStringArray, normalizeFavorites, validFavoriteKey, withLimit } from '../core/storage-utils';
import { KEYS, getJson, setJson } from '../services/storage';

export { ROTATION_DEFAULTS };
export type { RotationSettings, HistoryItem };

interface PreferencesContextValue {
  favorites: Set<string>;
  favoriteCount: number;
  isFavorite: (key: string) => boolean;
  toggleFavorite: (key: string) => boolean | null;
  favoritesVersion: number;
  clearFavorites: () => void;
  /** Merge a portable backup without discarding existing/unknown catalog keys. */
  mergeFavorites: (keys: string[]) => number;
  recentSearches: string[];
  addRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;
  history: HistoryItem[];
  addHistory: (id: number, action: HistoryAction) => void;
  clearHistory: () => void;
  rotation: RotationSettings;
  updateRotation: (patch: Partial<RotationSettings>) => void;
  resetRotation: () => void;
  storageError: string | null;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);
const MAX_RECENT_SEARCHES = 8;
const MAX_HISTORY = 200;
const ACTIONS = new Set<HistoryAction>(['download', 'share', 'copy-link', 'open-source', 'save']);

function validHistory(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as HistoryItem;
  return Number.isSafeInteger(row.id) && row.id > 0 && ACTIONS.has(row.action) &&
    Number.isFinite(row.at) && row.at > 0 && row.at <= 8640000000000000;
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rotation, setRotation] = useState<RotationSettings>(ROTATION_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const favoriteSnapshot = useRef(favorites);
  const searchSnapshot = useRef(recentSearches);
  const historySnapshot = useRef(history);
  const rotationSnapshot = useRef(rotation);
  const failedKeys = useRef(new Set<string>());
  const mounted = useRef(true);

  const persist = useCallback((key: string, value: unknown) => {
    void setJson(key, value).then((saved) => {
      if (saved) failedKeys.current.delete(key);
      else failedKeys.current.add(key);
      if (mounted.current) setStorageError(failedKeys.current.size
        ? 'Some preferences could not be saved. Keep a favorites backup before closing the app.' : null);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void Promise.all([
      getJson<unknown>(KEYS.favorites, []), getJson<unknown>(KEYS.recentSearches, []),
      getJson<unknown>(KEYS.history, []), getJson<unknown>(KEYS.rotation, ROTATION_DEFAULTS),
    ]).then(([keys, searches, rows, settings]) => {
      if (!alive) return;
      favoriteSnapshot.current = new Set(normalizeFavorites(keys));
      searchSnapshot.current = withLimit(asStringArray(searches).map((term) => term.trim().slice(0, 120)), MAX_RECENT_SEARCHES);
      historySnapshot.current = Array.isArray(rows) ? rows.filter(validHistory).slice(0, MAX_HISTORY) : [];
      rotationSnapshot.current = coerceRotation(settings);
      setFavorites(favoriteSnapshot.current);
      setRecentSearches(searchSnapshot.current);
      setHistory(historySnapshot.current);
      setRotation(rotationSnapshot.current);
      setReady(true);
    });
    return () => { alive = false; mounted.current = false; };
  }, []);

  const publishFavorites = useCallback((next: Set<string>) => {
    favoriteSnapshot.current = next;
    setFavorites(next);
    setFavoritesVersion((version) => version + 1);
    persist(KEYS.favorites, [...next]);
  }, [persist]);

  const isFavorite = useCallback((key: string) => favoriteSnapshot.current.has(key), []);
  const toggleFavorite = useCallback((key: string) => {
    if (!validFavoriteKey(key)) return null;
    const next = new Set(favoriteSnapshot.current);
    const added = !next.has(key);
    if (added && next.size >= MAX_FAVORITES) return null;
    if (added) next.add(key);
    else next.delete(key);
    publishFavorites(next);
    return added;
  }, [publishFavorites]);
  const clearFavorites = useCallback(() => publishFavorites(new Set()), [publishFavorites]);
  const mergeFavorites = useCallback((keys: string[]) => {
    if (!keys.every(validFavoriteKey)) throw new Error('The backup contains invalid favorites.');
    const current = favoriteSnapshot.current;
    const next = new Set([...current, ...keys]);
    if (next.size > MAX_FAVORITES) throw new Error('The combined favorites exceed the 20,000-item backup limit.');
    publishFavorites(next);
    return next.size - current.size;
  }, [publishFavorites]);

  const publishSearches = useCallback((next: string[]) => {
    searchSnapshot.current = next;
    setRecentSearches(next);
    persist(KEYS.recentSearches, next);
  }, [persist]);
  const addRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim().slice(0, 120);
    if (trimmed.length < 2) return;
    publishSearches([trimmed, ...searchSnapshot.current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())]
      .slice(0, MAX_RECENT_SEARCHES));
  }, [publishSearches]);
  const clearRecentSearches = useCallback(() => publishSearches([]), [publishSearches]);

  const publishHistory = useCallback((next: HistoryItem[]) => {
    historySnapshot.current = next;
    setHistory(next);
    persist(KEYS.history, next);
  }, [persist]);
  const addHistory = useCallback((id: number, action: HistoryAction) => {
    const row = { id, action, at: Date.now() };
    if (validHistory(row)) publishHistory([row, ...historySnapshot.current].slice(0, MAX_HISTORY));
  }, [publishHistory]);
  const clearHistory = useCallback(() => publishHistory([]), [publishHistory]);

  const updateRotation = useCallback((patch: Partial<RotationSettings>) => {
    const next = coerceRotation({ ...rotationSnapshot.current, ...patch });
    rotationSnapshot.current = next;
    setRotation(next);
    persist(KEYS.rotation, next);
  }, [persist]);
  const resetRotation = useCallback(() => updateRotation({ ...ROTATION_DEFAULTS, tags: [] }), [updateRotation]);

  const value = useMemo<PreferencesContextValue>(() => ({
    favorites, favoriteCount: favorites.size, isFavorite, toggleFavorite, favoritesVersion, clearFavorites, mergeFavorites,
    recentSearches, addRecentSearch, clearRecentSearches, history, addHistory, clearHistory,
    rotation, updateRotation, resetRotation, storageError,
  }), [favorites, isFavorite, toggleFavorite, favoritesVersion, clearFavorites, mergeFavorites, recentSearches,
    addRecentSearch, clearRecentSearches, history, addHistory, clearHistory, rotation, updateRotation, resetRotation, storageError]);

  if (!ready) return null;
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences() must be used inside <PreferencesProvider>.');
  return context;
}
