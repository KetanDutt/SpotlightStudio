/**
 * Domain types – the mobile mirror of the catalog rows produced by
 * `src/database.py` / `static/js/core.js`.
 *
 * A `RawWallpaper` is exactly what the backend (or the committed catalog file) sends;
 * everything derived (title, quality class, search blob) lives on `Wallpaper`.
 */

export type SourceId = 'peapix' | 'win10spotlight';

export type QualityClass = '4k' | '2k' | 'fhd' | 'hd' | 'sd';

export type SortKey = 'newest' | 'oldest' | 'added' | 'resolution' | 'size' | 'title' | 'title-desc';

export type ViewMode = 'grid' | 'list';

/** One row of `data/wallpapers.json` / `/api/catalog`. */
export interface RawWallpaper {
  id: number;
  filename: string;
  title: string;
  source: string;
  source_url?: string;
  page_url?: string;
  width: number;
  height: number;
  file_size: number;
  tags: string;
  date_spotted?: string;
  downloaded_at?: string;
  quality?: string;
}

/** A wallpaper enriched for rendering. `raw` is never mutated. */
export interface Wallpaper {
  raw: RawWallpaper;
  id: number;
  /** `filename` – favourites use it; a backend quality upgrade can change it. */
  key: string;
  tags: string[];
  source: string;
  title: string;
  /** True when the title had to be generated from tags (the source title was a hash). */
  generated: boolean;
  q: QualityClass;
  dateTs: number;
  addedTs: number;
  /** Folded search blob (title + tags + date + source). */
  search: string;
}

export interface Catalog {
  items: Wallpaper[];
  byId: Map<number, Wallpaper>;
  byKey: Map<string, Wallpaper>;
  tagCount: Map<string, number>;
  tagShare: Map<string, number>;
  qualityCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  newestAdded: number;
  total: number;
}

/** Filter/sort state, kept in the URL of the gallery screen. */
export interface CatalogState {
  q: string;
  source: string;
  quality: string;
  tag: string;
  sort: SortKey;
  /** `grid` or `list`. */
  view: ViewMode;
  fav: boolean;
  /** Column count in grid mode (1–3). */
  cols: 2 | 3;
}

export interface CatalogPage {
  items: Wallpaper[];
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
}

/** The way the catalog is loaded – shown in the UI so users know what they are browsing. */
export type DataOrigin =
  | 'bundled' // the catalog committed to the repository
  | 'remote' // data/wallpapers.json from the published repository
  | 'local-api' // a Spotlight Studio server on the local network
  | 'none';

export interface CatalogMeta {
  origin: DataOrigin;
  /** Base URL images are resolved against (may be ''). */
  baseUrl: string;
  loadedAt: number;
  count: number;
  error?: string;
}

/** Per-wallpaper local state. */
export interface WallpaperUserData {
  favorite: boolean;
  favoriteAt: number;
}

export type WallpaperMode = 'home' | 'lock' | 'both';

export type HistoryAction = 'download' | 'share' | 'copy-link' | 'open-source' | 'save';

export interface HistoryItem {
  id: number;
  action: HistoryAction;
  at: number;
}

export interface RotationSettings {
  enabled: boolean;
  /** Minimum minutes the OS should wait between runs (Android uses this verbatim). */
  intervalMinutes: number;
  /** `home`, `lock` or both – Android only (iOS cannot set the lock screen). */
  mode: WallpaperMode;
  /** Restrict the pool: any tag matches, empty = the whole library. */
  tags: string[];
  /** Only 4K/2K images (nicer on modern phones). */
  highResOnly: boolean;
  /** Favourites only. */
  favoritesOnly: boolean;
  lastRunAt: number;
  lastWallpaperId: number;
  lastRunError: string;
  /** Successful background runs so far (shown in Settings). */
  runCount: number;
}
