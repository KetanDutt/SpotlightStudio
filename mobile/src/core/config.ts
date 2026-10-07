/**
 * Build-time configuration.
 *
 * The app works out of the box: it ships with the catalog that is committed to the
 * Spotlight Studio repository, so there is no server to run and nothing to configure.
 * Two optional environment variables extend it:
 *
 * ```
 * EXPO_PUBLIC_CATALOG_URL   full URL of a catalog JSON file (e.g. your own /api/catalog)
 * EXPO_PUBLIC_API_URL       base URL of a Spotlight Studio server (adds live search + crawl status)
 * ```
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

/**
 * Expo replaces `process.env.EXPO_PUBLIC_*` at build time, but only for *static* member
 * access – a computed lookup would silently stay `undefined` in a release build.
 */
function clean(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim().replace(/\/+$/, '');
  return fallback;
}

const ENV_CATALOG_URL = process.env.EXPO_PUBLIC_CATALOG_URL;
const ENV_IMAGE_BASE = process.env.EXPO_PUBLIC_IMAGE_BASE;
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL;

export const APP_NAME = 'Spotlight Studio';
export const APP_TAGLINE = 'Windows Spotlight wallpapers for your phone';
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
export const API_VERSION = Number(extra.apiVersion ?? 1);

/** Owner/repo used to resolve images and the catalog when nothing else is configured. */
export const GITHUB_OWNER = 'KetanDutt';
export const GITHUB_REPO = 'SpotlightStudio';
export const GITHUB_BRANCH = 'main';

export const GITHUB_CATALOG_URL = clean(
  ENV_CATALOG_URL,
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/wallpapers.json`,
);

/**
 * Base URL images are resolved against.  GitHub serves Git-LFS objects through
 * `github.com/<owner>/<repo>/blob/<branch>/…?raw=true` and those URLs are stable,
 * which is what the web gallery uses too.
 *
 * `EXPO_PUBLIC_IMAGE_BASE` overrides it (e.g. `http://192.168.0.9:8765` for your own server).
 */
export const IMAGE_BASE = clean(
  ENV_IMAGE_BASE,
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}`,
);

/** Optional Spotlight Studio server (must be reachable from the phone/emulator). */
export const API_BASE = clean(ENV_API_URL, '');

/** http(s) + local-network hosts are fine; the app never fetches `file:` or `content:`. */
export function isFetchableUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** Remote image URL for a wallpaper row (`thumbs` are ~20× smaller). */
export function imageUrl(filename: string, thumb = false, base = IMAGE_BASE): string {
  const path = `images/${thumb ? 'thumbs/' : ''}${filename}`;
  if (!base) return '';
  return `${base.replace(/\/+$/, '')}/${path}?raw=true`;
}

/** Remote thumbnail URL used by the gallery grid. */
export function thumbUrl(filename: string, base = IMAGE_BASE): string {
  return imageUrl(filename, true, base);
}

export const CACHE_POLICY = {
  /** expo-image policy for thumbnails: keep them on disk, they are tiny. */
  thumb: 'disk' as const,
  /** expo-image policy for full images. */
  full: 'memory-disk' as const,
  /** Wallpapers are static files – 30 days is a good trade-off for phones on mobile data. */
  catalogMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
};

export const LIMITS = {
  /** Hard cap when reading a catalog from the network (the real file is ~4 MB). */
  catalogBytes: 32 * 1024 * 1024,
  /** Wallpapers above this size are refused instead of silently filling the phone. */
  maxWallpaperBytes: 40 * 1024 * 1024,
  /** How many history entries are kept. */
  history: 200,
  /** Toast/undo lifetime. */
  toastMs: 3200,
} as const;
