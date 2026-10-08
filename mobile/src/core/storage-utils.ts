/**
 * Tiny JSON helpers shared by the storage layer and the pure core modules.
 *
 * They live outside `services/storage.ts` so that pure logic (rotation rules, catalog
 * parsing) can use them without importing AsyncStorage.
 */

/** Coerce unknown JSON into a string array (defensive against older formats). */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** Keep a list bounded and de-duplicated, newest first. */
export function withLimit(list: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Move `value` to the front of a "recently used" list, de-duplicated and bounded.
 * Used for recent searches, so a repeated query does not appear twice.
 */
export function pushRecent(list: string[], value: string, limit: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) return withLimit(list, limit);
  return withLimit([trimmed, ...asStringArray(list).filter((item) => item !== trimmed)], limit);
}

/** Relative catalog identity, never a URL or an encoded traversal path. */
export function validFavoriteKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.length || key.length > 512 ||
      /[:\\%?#\x00-\x1f\x7f]/.test(key) || key.startsWith('/') ||
      !key.split('/').every((part) => part && part !== '.' && part !== '..')) return false;
  try { encodeURIComponent(key); return true; } catch { return false; }
}

export const MAX_FAVORITES = 20000;

export function normalizeFavorites(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(validFavoriteKey))].slice(0, MAX_FAVORITES) : [];
}

/** Portable version-1 format shared with the web gallery. */
export function favoritesBackup(favorites: Iterable<string>) {
  return { format: 'spotlight-favorites', version: 1, favorites: normalizeFavorites([...favorites]) };
}

export function parseFavoritesBackup(value: unknown): string[] {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!raw || raw.format !== 'spotlight-favorites' || raw.version !== 1 ||
      !Array.isArray(raw.favorites) || raw.favorites.length > MAX_FAVORITES ||
      !raw.favorites.every(validFavoriteKey)) {
    throw new Error('Choose a valid Spotlight Studio favorites backup (version 1).');
  }
  return normalizeFavorites(raw.favorites);
}
