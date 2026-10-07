/**
 * Persistence layer – AsyncStorage behind a small typed façade.
 *
 * Rules:
 *  * every read is defensive (corrupt JSON or a half-written value must never crash a screen);
 *  * every write is awaited so callers can `void` it or chain it;
 *  * keys are namespaced and versioned so a future format change can be migrated.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { asStringArray, withLimit } from '../core/storage-utils';

export const STORAGE_PREFIX = '@spotlight-studio';

export const KEYS = {
  theme: `${STORAGE_PREFIX}:theme:v1`,
  favorites: `${STORAGE_PREFIX}:favorites:v1`,
  recentSearches: `${STORAGE_PREFIX}:recent-searches:v1`,
  history: `${STORAGE_PREFIX}:history:v1`,
  rotation: `${STORAGE_PREFIX}:rotation:v1`,
  toastSeen: `${STORAGE_PREFIX}:onboarding:v1`,
  lastCatalogAt: `${STORAGE_PREFIX}:catalog-at:v1`,
} as const;

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export async function setJson(key: string, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* nothing we can do – the app keeps working, only the preference is lost */
  }
}

/** Wipes every key this app owns (used by Settings → "Reset app data"). */
export async function clearAll(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ours.length) await AsyncStorage.multiRemove([...ours]);
  } catch {
    /* ignore */
  }
}

export { asStringArray, withLimit };
