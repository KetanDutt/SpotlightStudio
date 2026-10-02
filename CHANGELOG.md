# Changelog

All notable changes to Spotlight Studio are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [2.1.0] — 2026-10-01

### Added
- **Apple Liquid Glass UI redesign**: Translucent glass surfaces, staggered card entrance animations, scroll-reactive navigation island, mobile sidebar toggle, and image cross-fade in lightbox.
- **Brand subtitle** "4K Wallpaper Gallery" displayed below the app name in the navigation island.
- **Scroll-reactive nav**: Navigation island border brightens as gallery content scrolls beneath it.
- **Staggered card animations**: Each gallery card enters with a cascading 28ms delay.
- **Image fade transition** in lightbox: Images cross-fade when navigating between wallpapers.
- **Mobile collapsible sidebar**: A "Filters" pill toggle button on small screens.
- **Empty state breathing animation**: Icon gently pulses when no results are found.
- **Toast improvements**: Slide in from right, smooth fade-out before removal, `.toast-info` border color.
- **PWA support**: Added `manifest.webmanifest` for installable Progressive Web App.
- **New API endpoint**: `GET /api/wallpapers/{id}/image` redirects to the actual image file.
- **Performance improvements**: Additional SQLite indexes, WAL mode pragmas (NORMAL sync, 64MB cache), memory temp store.

### Fixed
- **Critical bug**: Removed duplicate `is_url_known()` definition in `database.py` that was missing the `suppressed_urls` check.
- **Memory efficiency**: `GET /api/export/json` now streams the pre-built catalog file instead of loading all records into memory.
- **Scraper robustness**: Added exponential backoff between retry attempts in `_fetch_html()`.
- **Config cleanup**: Removed unused `STATE_PATH` setting from `Settings`.
- **Import hygiene**: Moved `from collections import defaultdict` to module level.

### Changed
- Sidebar width increased from 250px to 260px for better readability.
- Card hover elevation reduced from −4px to −3px (more refined).
- Image hover scale reduced from 1.05× to 1.04× (more subtle).
- Toast slide direction changed from bottom to right (more iOS-native).
- Progress bar sheen animation slowed from 2.5s to 3.5s (less distracting).
- Pagination current-page uses glassy blue instead of solid fill.
- Scrollbars thinned to 5px with softer opacity.

### Removed
- `update.py` — one-off hardcoded migration script, no longer needed.
- Unused `STATE_PATH` config variable.

---

## [2.0.0] — 2026-10-01

### Added
- Dual-mode architecture: GitHub Pages static showcase + Desktop App (PyWebView).
- High-throughput async engine: 32 concurrent downloads + 4 parallel scrapers.
- Perceptual deduplication using 16-bit `dHash` with chunk-indexed candidate filtering.
- Source-partitioned image storage: `images/peapix/`, `images/win10spotlight/`.
- 480×270 Lanczos thumbnail generation with center-crop to 16:9.
- Peapix quality fallback chain: `_UHD` → `_1920` → `_1280` → `_640`.
- FastAPI REST API with OpenAPI docs at `/api/docs`.
- Windows desktop wallpaper integration via `SystemParametersInfoW`.
- Static catalog export (`data/wallpapers.json`) for GitHub Pages.
- Service worker for offline caching.

---

## [1.0.0] — 2026-09-15

### Added
- Initial release: single-source Peapix scraper and downloader.
- Basic SQLite storage.
- Simple HTML gallery viewer.