/**
 * Preferences provider – everything the user changes, in one place.
 *
 * Favourites are stored as a `Set` of wallpaper *filenames* (stable across catalog
 * refreshes), history keeps the last actions, and rotation settings drive the Android
 * background task.  All of it is persisted through `services/storage`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { HistoryAction, HistoryItem, RotationSettings } from '../core/types';
import { ROTATION_DEFAULTS, coerceRotation } from '../core/rotation';
import { KEYS, asStringArray, getJson, setJson } from '../services/storage';

export { ROTATION_DEFAULTS };
export type { RotationSettings };

export type { HistoryItem };

interface PreferencesContextValue {
  favorites: Set<string>;
  favoriteCount: number;
  isFavorite: (key: string) => boolean;
  toggleFavorite: (key: string) => boolean;
  /** Bumped on every favourite change – lets memoised lists know they must re-filter. */
  favoritesVersion: number;
  clearFavorites: () => void;

  recentSearches: string[];
  addRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;

  history: HistoryItem[];
  addHistory: (id: number, action: HistoryAction) => void;
  clearHistory: () => void;

  rotation: RotationSettings;
  updateRotation: (patch: Partial<RotationSettings>) => void;
  resetRotation: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const MAX_RECENT_SEARCHES = 8;
const MAX_HISTORY = 200;

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rotation, setRotation] = useState<RotationSettings>(ROTATION_DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getJson<string[]>(KEYS.favorites, []),
      getJson<string[]>(KEYS.recentSearches, []),
      getJson<HistoryItem[]>(KEYS.history, []),
      getJson<unknown>(KEYS.rotation, ROTATION_DEFAULTS),
    ]).then(([favoriteKeys, searches, historyRows, rotationValue]) => {
      if (!alive) return;
      setFavorites(new Set(asStringArray(favoriteKeys)));
      setRecentSearches(asStringArray(searches).slice(0, MAX_RECENT_SEARCHES));
      setHistory(Array.isArray(historyRows) ? historyRows.filter((h) => h && typeof h.id === 'number' && typeof h.action === 'string') : []);
      setRotation(coerceRotation(rotationValue));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── favourites ────────────────────────────────────────────────────────────
  const isFavorite = useCallback((key: string) => favorites.has(key), [favorites]);

  const toggleFavorite = useCallback((key: string) => {
    let added = false;
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        added = true;
      }
      void setJson(KEYS.favorites, [...next]);
      return next;
    });
    setFavoritesVersion((v) => v + 1);
    return added;
  }, []);

  const clearFavorites = useCallback(() => {
    setFavorites(new Set());
    setFavoritesVersion((v) => v + 1);
    void setJson(KEYS.favorites, []);
  }, []);

  // ── recent searches ───────────────────────────────────────────────────────
  const addRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) return;
    setRecentSearches((current) => {
      const next = [trimmed, ...current.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      void setJson(KEYS.recentSearches, next);
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    void setJson(KEYS.recentSearches, []);
  }, []);

  // ── history ───────────────────────────────────────────────────────────────
  const addHistory = useCallback((id: number, action: HistoryAction) => {
    setHistory((current) => {
      const next = [{ id, action, at: Date.now() }, ...current].slice(0, MAX_HISTORY);
      void setJson(KEYS.history, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void setJson(KEYS.history, []);
  }, []);

  // ── rotation ──────────────────────────────────────────────────────────────
  const updateRotation = useCallback((patch: Partial<RotationSettings>) => {
    setRotation((current) => {
      const next = coerceRotation({ ...current, ...patch });
      void setJson(KEYS.rotation, next);
      return next;
    });
  }, []);

  const resetRotation = useCallback(() => {
    setRotation(ROTATION_DEFAULTS);
    void setJson(KEYS.rotation, ROTATION_DEFAULTS);
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      favorites,
      favoriteCount: favorites.size,
      isFavorite,
      toggleFavorite,
      favoritesVersion,
      clearFavorites,
      recentSearches,
      addRecentSearch,
      clearRecentSearches,
      history,
      addHistory,
      clearHistory,
      rotation,
      updateRotation,
      resetRotation,
    }),
    [
      favorites,
      isFavorite,
      toggleFavorite,
      favoritesVersion,
      clearFavorites,
      recentSearches,
      addRecentSearch,
      clearRecentSearches,
      history,
      addHistory,
      clearHistory,
      rotation,
      updateRotation,
      resetRotation,
    ],
  );

  // Avoid rendering screens before the first preferences are loaded – otherwise a
  // favourite set could briefly look empty and flash the wrong "add to favourites" state.
  if (!ready) return null;

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences() must be used inside <PreferencesProvider>.');
  return ctx;
}
