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
