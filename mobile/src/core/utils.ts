/**
 * Pure helpers – the TypeScript twin of `static/js/core.js`.
 *
 * Everything in this file is deterministic and free of React Native APIs so it can be
 * unit-tested with plain Jest (`npm test`).  Behaviour mirrors the web client on purpose:
 * the same search, the same filters, the same generated titles, the same formatting.
 */
import type {
  Catalog,
  CatalogPage,
  CatalogState,
  QualityClass,
  RawWallpaper,
  SortKey,
  Wallpaper,
} from './types';

/* ───────────────────────────── constants ───────────────────────────── */

export const HASH_TITLE = /^[0-9a-f]{32,64}$/i;

export const GENERIC_TITLES = new Set([
  '',
  'untitled',
  'windows spotlight',
  'windows spotlight wallpaper',
  'windows spotlight image',
  'windows spotlight images',
  'windows10spotlight',
  'spotlight wallpaper',
  'spotlight gallery',
]);

/** Tags used by more than this share of the library say nothing about a picture. */
export const GENERIC_TAG_SHARE = 0.12;

export const SORTS: Record<SortKey, { label: string }> = {
  newest: { label: 'Newest first' },
  oldest: { label: 'Oldest first' },
  added: { label: 'Recently added' },
  resolution: { label: 'Highest resolution' },
  size: { label: 'Largest file' },
  title: { label: 'Title A–Z' },
  'title-desc': { label: 'Title Z–A' },
};

export const QUALITIES: QualityClass[] = ['4k', '2k', 'fhd', 'hd', 'sd'];

export const QUALITY_LABELS: Record<string, string> = {
  '4k': '4K / UHD',
  '2k': '2K / QHD',
  fhd: 'Full HD',
  hd: 'HD',
  sd: 'SD',
};

export const SOURCES = ['peapix', 'win10spotlight'] as const;

export const SOURCE_LABELS: Record<string, string> = {
  peapix: 'Peapix',
  win10spotlight: 'Windows 10 Spotlight',
};

export const DEFAULT_STATE: CatalogState = {
  q: '',
  source: '',
  quality: '',
  tag: '',
  sort: 'newest',
  view: 'grid',
  fav: false,
  cols: 2,
};

/* ───────────────────────────── text helpers ───────────────────────────── */

/** True for titles that carry no information (file hashes, generic site names). */
export function isPlaceholderTitle(title: unknown): boolean {
  const text = String(title == null ? '' : title).trim();
  return HASH_TITLE.test(text) || GENERIC_TITLES.has(text.toLowerCase());
}

/** Lower-case and strip diacritics so "Galápagos" matches "galapagos". */
export function foldText(value: unknown): string {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Search query → unique folded terms (all of them must match). */
export function tokenize(query: unknown, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of foldText(query).split(/\s+/)) {
    if (part && !seen.has(part)) {
      seen.add(part);
      out.push(part);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** `"animals, Chile ,sky"` → `['animals', 'chile', 'sky']` (de-duplicated, lower-case). */
export function splitTags(raw: unknown): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of String(raw).split(',')) {
    const tag = piece.replace(/\s+/g, ' ').trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export function titleCase(text: string): string {
  return String(text).replace(/(^|[\s\-/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function slugify(text: string, maxLength = 60): string {
  const slug = foldText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/, '') || 'wallpaper';
}

/* ───────────────────────────── formatting ───────────────────────────── */

export function fmtInt(n: unknown): string {
  const value = Number(n || 0);
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '0';
}

export function fmtBytes(bytes: unknown): string {
  const n = Number(bytes);
  if (!n || n < 0 || !Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtDuration(totalSeconds: unknown): string {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function fmtWallpaperSize(width: unknown, height: unknown): string {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return 'Unknown size';
  const megapixels = (w * h) / 1_000_000;
  const mp = megapixels >= 10 ? megapixels.toFixed(1) : megapixels.toFixed(2);
  return `${w} × ${h} · ${mp} MP`;
}

/** `YYYY-MM-DD` → timestamp (UTC midnight); 0 when unknown / invalid. */
export function parseDateTs(value: unknown): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return 0;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ts) ? 0 : ts;
}

/** `2025-05-14` → "May 14, 2025" (timezone safe). Unknown formats are returned as-is. */
export function fmtDate(value: unknown, locale = 'en-US'): string {
  const ts = parseDateTs(value);
  if (!ts) return value ? String(value) : '';
  return new Date(ts).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "3 minutes ago" style text (falls back to a date for very old timestamps). */
export function fmtRelative(iso: unknown, now = Date.now()): string {
  const then = Date.parse(String(iso || ''));
  if (!then) return '';
  const seconds = Math.round((now - then) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ];
  let chosen = units[0];
  for (const unit of units) if (abs >= unit[1]) chosen = unit;
  return `${Math.round(abs / chosen[1])} ${chosen[0]}${Math.round(abs / chosen[1]) === 1 ? '' : 's'} ago`;
}

/** Wallpaper resolution → quality bucket (identical boundaries to the web app). */
export function qualityClass(width: unknown): QualityClass {
  const w = Number(width) || 0;
  if (w >= 3840) return '4k';
  if (w >= 2560) return '2k';
  if (w >= 1920) return 'fhd';
  if (w >= 1280) return 'hd';
  return 'sd';
}

export function qualityLabel(width: unknown): string {
  return QUALITY_LABELS[qualityClass(width)] || 'SD';
}

/** Name a downloaded file like the web client does: `title-id.jpg`. */
export function downloadFilename(item: Wallpaper): string {
  const ext = /\.(jpe?g|png|webp)$/i.exec(item.raw.filename)?.[1]?.toLowerCase() || 'jpg';
  return `${slugify(item.title)}-${item.id}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

/* ───────────────────────────── catalog model ───────────────────────────── */

/**
 * Human title built from the most *informative* tags when the real title is a placeholder.
 * Tags are selected by rarity (generic ones like "nature" say nothing) but displayed in
 * their original order, which reads more naturally ("Chile · Mammal · Silhouette").
 */
export function generatedTitle(item: Pick<Wallpaper, 'tags' | 'raw'>, tagShare: Map<string, number>): string {
  const picks = item.tags
    .filter((t) => (tagShare.get(t) || 0) < GENERIC_TAG_SHARE)
    .sort((a, b) => (tagShare.get(a) || 0) - (tagShare.get(b) || 0))
    .slice(0, 3)
    .sort((a, b) => item.tags.indexOf(a) - item.tags.indexOf(b))
    .map(titleCase);
  if (picks.length) return picks.join(' · ');
  const date = fmtDate(item.raw.date_spotted);
  return date ? `Spotlight wallpaper · ${date}` : 'Spotlight wallpaper';
}

/**
 * Turn raw catalog rows into the view model used by the UI.
 * Raw rows are never mutated, so exports stay faithful to the source data.
 */
export function buildCatalog(rawItems: unknown): Catalog {
  const rows: RawWallpaper[] = Array.isArray(rawItems) ? (rawItems as RawWallpaper[]) : [];
  const tagCount = new Map<string, number>();
  const items: Wallpaper[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const tags = splitTags(raw.tags);
    for (const tag of tags) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    items[i] = {
      raw,
      id: raw.id,
      key: raw.filename,
      tags,
      source: raw.source || '',
      title: '',
      generated: false,
      q: 'sd',
      dateTs: 0,
      addedTs: 0,
      search: '',
    };
  }

  const total = items.length || 1;
  const tagShare = new Map<string, number>();
  for (const [tag, count] of tagCount) tagShare.set(tag, count / total);

  const qualityCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let newestAdded = 0;

  for (const item of items) {
    const raw = item.raw;
    item.source = raw.source || '';
    const placeholder = isPlaceholderTitle(raw.title);
    item.title = placeholder ? generatedTitle(item, tagShare) : String(raw.title).trim();
    item.generated = placeholder;
    item.q = qualityClass(raw.width);
    item.dateTs = parseDateTs(raw.date_spotted);
    item.addedTs = Date.parse(String(raw.downloaded_at || '')) || 0;
    item.search = foldText(
      [
        placeholder ? '' : raw.title,
        item.tags.join(' '),
        raw.date_spotted,
        raw.source === 'peapix' ? 'peapix' : 'windows 10 spotlight win10',
      ].join(' '),
    );
    qualityCounts[item.q] = (qualityCounts[item.q] || 0) + 1;
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    if (item.addedTs > newestAdded) newestAdded = item.addedTs;
  }

  const byId = new Map<number, Wallpaper>();
  const byKey = new Map<string, Wallpaper>();
  for (const item of items) {
    byId.set(item.id, item);
    byKey.set(item.key, item);
  }

  return {
    items,
    byId,
    byKey,
    tagCount,
    tagShare,
    qualityCounts,
    sourceCounts,
    newestAdded,
    total: items.length,
  };
}

/** Most used tags as `[tag, count]` pairs – library wide, or within `pool` (a filtered list). */
export function topTags(catalog: Catalog, limit = 24, pool?: Wallpaper[]): [string, number][] {
  let counts = catalog.tagCount;
  if (pool) {
    counts = new Map<string, number>();
    for (const item of pool) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

/* ───────────────────────────── filtering & sorting ───────────────────────────── */

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Comparator for a `SortKey`.  Unknown dates / generated titles always sort last. */
export function comparator(sortKey: SortKey): (a: Wallpaper, b: Wallpaper) => number {
  const key: SortKey = SORTS[sortKey] ? sortKey : DEFAULT_STATE.sort;
  const dir = key === 'oldest' || key === 'title' ? 1 : -1;
  const tie = (a: Wallpaper, b: Wallpaper) => b.id - a.id;

  switch (key) {
    case 'newest':
    case 'oldest':
      return (a, b) => {
        if (!a.dateTs !== !b.dateTs) return a.dateTs ? -1 : 1;
        return (a.dateTs - b.dateTs) * dir || tie(a, b);
      };
    case 'added':
      return (a, b) => (a.addedTs - b.addedTs) * -1 || tie(a, b);
    case 'resolution':
      return (a, b) => (a.raw.width - b.raw.width) * -1 || (a.raw.file_size - b.raw.file_size) * -1 || tie(a, b);
    case 'size':
      return (a, b) => (a.raw.file_size - b.raw.file_size) * -1 || tie(a, b);
    case 'title':
    case 'title-desc':
      return (a, b) => {
        if (a.generated !== b.generated) return a.generated ? 1 : -1;
        return compareText(a.title, b.title) * dir || tie(a, b);
      };
    default:
      return tie;
  }
}

export interface FilterInput {
  q?: string;
  source?: string;
  quality?: string;
  tag?: string;
  fav?: boolean;
}

/** Indices of the items matching `state` (favourites are a set of `filename` keys). */
export function applyFilters(catalog: Catalog, state: FilterInput, favorites?: Set<string>): number[] {
  const terms = tokenize(state.q);
  const out: number[] = [];
  for (let i = 0; i < catalog.items.length; i++) {
    const item = catalog.items[i];
    if (state.source && item.source !== state.source) continue;
    if (state.quality && item.q !== state.quality) continue;
    if (state.tag && !item.tags.includes(state.tag)) continue;
    if (state.fav && !(favorites && favorites.has(item.key))) continue;
    if (terms.length && !terms.every((t) => item.search.includes(t))) continue;
    out.push(i);
  }
  return out;
}

export function filterAndSort(catalog: Catalog, state: CatalogState, favorites?: Set<string>): Wallpaper[] {
  const indices = applyFilters(catalog, state, favorites);
  const out = indices.map((i) => catalog.items[i]);
  out.sort(comparator(state.sort));
  return out;
}

/** Key identifying the *filter* part of the state (pagination does not change the list). */
export function filterKey(state: CatalogState, favVersion: number): string {
  return JSON.stringify([
    state.q,
    state.source,
    state.quality,
    state.tag,
    state.sort,
    state.fav ? 1 : 0,
    state.fav ? favVersion : 0,
  ]);
}

export function paginate<T>(list: T[], page: number, perPage: number): { items: T[]; page: number; pages: number; total: number; from: number; to: number } {
  const per = Math.max(1, Math.floor(perPage) || 1);
  const pages = Math.max(1, Math.ceil(list.length / per));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * per;
  return {
    items: list.slice(start, start + per),
    page: current,
    pages,
    total: list.length,
    from: list.length ? start + 1 : 0,
    to: Math.min(list.length, start + per),
  };
}

/* ───────────────────────────── URL state ───────────────────────────── */

/** Serialise only the non-default parts of the state (short, shareable links). */
export function encodeState(state: Partial<CatalogState>): Record<string, string> {
  const s = { ...DEFAULT_STATE, ...state };
  const params: Record<string, string> = {};
  if (s.q) params.q = s.q;
  if (s.source) params.source = s.source;
  if (s.quality) params.quality = s.quality;
  if (s.tag) params.tag = s.tag;
  if (s.sort !== DEFAULT_STATE.sort) params.sort = s.sort;
  if (s.view !== DEFAULT_STATE.view) params.view = s.view;
  if (s.fav) params.fav = '1';
  if (s.cols !== DEFAULT_STATE.cols) params.cols = String(s.cols);
  return params;
}

/** Parse + validate query params; unknown / malicious values fall back to defaults. */
export function decodeState(params: Record<string, string | string[] | undefined>): CatalogState {
  const pick = (key: string): string => {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first : '';
  };
  const state: CatalogState = { ...DEFAULT_STATE };
  state.q = pick('q').slice(0, 120);
  const source = pick('source');
  if ((SOURCES as readonly string[]).includes(source)) state.source = source;
  const quality = pick('quality');
  if (QUALITIES.includes(quality as QualityClass)) state.quality = quality;
  state.tag = pick('tag').slice(0, 60).toLowerCase();
  const sort = pick('sort');
  if (Object.prototype.hasOwnProperty.call(SORTS, sort)) state.sort = sort as SortKey;
  const view = pick('view');
  if (view === 'list' || view === 'grid') state.view = view;
  const cols = Number(pick('cols'));
  if (cols === 2 || cols === 3) state.cols = cols as 2 | 3;
  state.fav = pick('fav') === '1';
  return state;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Compact rendering of a catalog page ("1–48 of 7,412"). */
export function fmtRange(page: CatalogPage): string {
  if (!page.total) return 'No wallpapers';
  return `${fmtInt(page.from)}–${fmtInt(page.to)} of ${fmtInt(page.total)}`;
}
