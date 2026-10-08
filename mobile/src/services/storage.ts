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

const writes = new Map<string, Promise<boolean>>();
const revisions = new Map<string, number>();
export function storageRevision(key: string): number { return revisions.get(key) ?? 0; }
let reset: Promise<boolean> | null = null;

function enqueue(key: string, operation: () => Promise<unknown>): Promise<boolean> {
  if (reset) return Promise.resolve(false);
  revisions.set(key, storageRevision(key) + 1);
  const job = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
    try { await operation(); return true; } catch { return false; }
  });
  writes.set(key, job);
  void job.then(() => { if (writes.get(key) === job) writes.delete(key); });
  return job;
}

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    await reset;
    await writes.get(key);
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Per-key serialization prevents slow earlier writes from overwriting a newer choice. */
export function setJson(key: string, value: unknown): Promise<boolean> {
  try {
    const text = JSON.stringify(value);
    return enqueue(key, () => AsyncStorage.setItem(key, text));
  } catch {
    return Promise.resolve(false);
  }
}

export async function removeKey(key: string): Promise<void> {
  await enqueue(key, () => AsyncStorage.removeItem(key));
}

/** Wipes every key this app owns (used by Settings → "Reset app data"). */
export function clearAll(): Promise<boolean> {
  if (reset) return reset;
  for (const key of Object.values(KEYS)) revisions.set(key, storageRevision(key) + 1);
  const job = (async () => {
    try {
      await Promise.all([...writes.values()]);
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter(key => key.startsWith(`${STORAGE_PREFIX}:`));
      if (ours.length) await AsyncStorage.multiRemove([...ours]);
      return true;
    } catch { return false; }
  })().finally(() => { if (reset === job) reset = null; });
  reset = job;
  return job;
}

export { asStringArray, withLimit };
