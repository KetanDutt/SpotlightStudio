/**
 * Theme provider – light/dark/auto with a persisted preference.
 *
 * Resolution order: explicit user choice (`light`/`dark`) → the OS appearance (`auto`).
 * The palette is memoised so screens re-render only when the resolved theme changes.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { getJson, KEYS, setJson } from '../services/storage';
import type { Palette, ThemeName } from './tokens';
import { PALETTES } from './tokens';

export type ThemePreference = ThemeName | 'auto';

interface ThemeContextValue {
  /** The palette currently in use. */
  colors: Palette;
  /** What the user asked for (`auto` follows the OS). */
  preference: ThemePreference;
  /** What is actually rendered. */
  scheme: ThemeName;
  setPreference: (preference: ThemePreference) => void;
  /** Cycles light → dark → auto, for a one-tap toggle in the header. */
  toggle: () => void;
  ready: boolean;
  storageError: string | null;
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const snapshot = useRef<ThemePreference>('auto');
  const changed = useRef(false);
  const mounted = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => AccessibilityInfo.isReduceMotionEnabled()).then(value => {
      if (alive && typeof value === 'boolean') setReduceMotion(value);
    }).catch(() => {});
    void Promise.resolve().then(() => AccessibilityInfo.isReduceTransparencyEnabled?.()).then(value => {
      if (alive && typeof value === 'boolean') setReduceTransparency(value);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const transparency = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { alive = false; motion?.remove(); transparency?.remove(); };
  }, []);

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    getJson<ThemePreference>(KEYS.theme, 'auto').then((stored) => {
      if (!alive) return;
      if (!changed.current && (stored === 'light' || stored === 'dark' || stored === 'auto')) {
        snapshot.current = stored;
        setPreferenceState(stored);
      }
      setReady(true);
    });
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, []);

  const scheme: ThemeName = preference === 'auto' ? (system === 'light' ? 'light' : 'dark') : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    changed.current = true;
    snapshot.current = next;
    setPreferenceState(next);
    void setJson(KEYS.theme, next).then(saved => {
      if (mounted.current) setStorageError(saved ? null : 'The theme could not be saved to this device.');
    });
  }, []);

  const toggle = useCallback(() => {
    const current = snapshot.current;
    setPreference(current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark');
  }, [setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: PALETTES[scheme], preference, scheme, setPreference, toggle, ready, storageError, reduceMotion, reduceTransparency }),
    [scheme, preference, setPreference, toggle, ready, storageError, reduceMotion, reduceTransparency],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return ctx;
}

/** Convenience hook for components that only need the palette. */
export function useColors(): Palette {
  return useTheme().colors;
}
