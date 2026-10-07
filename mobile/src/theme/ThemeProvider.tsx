/**
 * Theme provider – light/dark/auto with a persisted preference.
 *
 * Resolution order: explicit user choice (`light`/`dark`) → the OS appearance (`auto`).
 * The palette is memoised so screens re-render only when the resolved theme changes.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive) setReduceMotion(Boolean(value));
    }).catch(() => {});
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then(value => {
      if (alive) setReduceTransparency(Boolean(value));
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const transparency = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { alive = false; motion?.remove(); transparency?.remove(); };
  }, []);

  useEffect(() => {
    let alive = true;
    getJson<ThemePreference>(KEYS.theme, 'auto').then((stored) => {
      if (!alive) return;
      if (stored === 'light' || stored === 'dark' || stored === 'auto') setPreferenceState(stored);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const scheme: ThemeName = preference === 'auto' ? (system === 'light' ? 'light' : 'dark') : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void setJson(KEYS.theme, next);
  }, []);

  const toggle = useCallback(() => {
    setPreferenceState((current) => {
      const next: ThemePreference = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
      void setJson(KEYS.theme, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: PALETTES[scheme], preference, scheme, setPreference, toggle, ready, reduceMotion, reduceTransparency }),
    [scheme, preference, setPreference, toggle, ready, reduceMotion, reduceTransparency],
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
