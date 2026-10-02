# Changelog

All notable changes to Spotlight Studio are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [2.2.0] — 2026-10-03

A reliability, security and quality release: the crawler no longer loses work, the Peapix/Win10 data is repairable, the UI was rebuilt on a testable, CSP-safe foundation and the project gained a real test-suite, CI and documentation.

### Added
- **Quick update / Full crawl / Repair metadata** modes (`POST /api/control/start?mode=…`, `--crawl --mode …`). *Quick* scans only the newest pages (`QUICK_UPDATE_PAGES`), *Repair* back-fills titles and tags of stored wallpapers without downloading anything.
- **Headless crawling**: `python main.py --crawl` (exit codes 0/1/130) and `start_update.bat` — the docs always recommended scheduled crawling, but nothing could start a crawl without the UI. Also `--check` (library health report) and `--sync-catalog`.
- **Automatic page discovery**: the real number of gallery pages is detected (Windows10Spotlight already had page 1320 while the config said 1319, so its oldest post was skipped).
- **Windows10Spotlight title enrichment**: the real title is fetched from the post page for listings that only show a file hash (57 % of the existing titles are hashes).
- **Network-outage circuit breaker**, retries that go to the back of the queue, run summary (`last_run_*`), live progress/phase/speed from the server.
- **UI**: favorites, tag and resolution filters, multi-term diacritic-insensitive search, shareable URLs for every view and wallpaper (`#w=<id>`), light/dark/auto theme, list view, real random shuffle over the whole result, cross-page viewer navigation with preloading and progressive loading, swipe, fullscreen, keyboard shortcuts help, About dialog, offline-capable PWA with real icons and a "Surprise me" shortcut, Git-LFS-pointer banner.
- **Desktop**: *Set as wallpaper* also on macOS (AppleScript) and Linux (GNOME/Cinnamon/MATE/KDE); the server is reused if already running; browser fallback when WebView2 is missing.
- **New API**: `GET /api/catalog` (ETag), `GET /api/wallpapers/random`, `GET /api/tags`, `GET /api/library/check`, `POST /api/maintenance/{dedupe,thumbnails}`; `tag` and `quality` filters; typed OpenAPI models.
- **Engineering**: 200+ pytest tests with a fake Peapix/Win10 site, Node unit tests for the front-end logic, a consistency test-suite, GitHub Actions CI, Dependabot, issue/PR templates, `Makefile`, `.env.example` covering every setting, six new guides in `docs/` (configuration, data formats, front-end, security, development, roadmap), a `SECURITY.md` policy and rewritten architecture, API, deployment and troubleshooting guides.

### Changed
- **Engine rewritten**: scraping and downloading now genuinely run concurrently (2.1 downloaded nothing until all ~1,350 pages were scraped, despite the docs); work is *claimed* rather than deleted, so **Stop/crash never loses queued items** and failed scrape pages are retried instead of silently dropped.
- Peapix resolution fallback (`UHD → 1920 → 1280 → 640`) happens only for permanent 404/403/410; a timeout or 5xx retries the best variant instead of silently storing a lower resolution (the last retry may still degrade).
- Near-duplicate detection (Hamming ≤ 4) now runs **at insert time** (it only ran in a post-scrape sweep and never for new downloads); the surviving copy inherits the union of tags and the better title.
- One CPU job per image (decode + hash + thumbnail) bounds memory; images and thumbnails are written atomically.
- Peapix parsing is content-based instead of class-name based (the old selectors lost 895 of 896 Peapix titles and all tags).
- `date_spotted` is normalised to `YYYY-MM-DD` (sorting by date was meaningless with mixed `May 14, 2025` / ISO values); default sort is now *Newest first*.
- Search is tokenised (all terms must match); `LIKE` wildcards are escaped; pagination is deterministic (unique tie-breaker) — sorting by a column with ties no longer repeats or skips rows.
- `POST /api/control/stop` reports `stopping` first; `/api/status` gained run/queue/phase/rate fields (all old fields remain); `progress_pct` is now meaningful.
- The static catalog omits the perceptual hash (−12 % raw, **−28 % over the wire**: 1,114 → 801 KB gzipped, because hex hashes do not compress) and is written only when its content changed (no spurious git diffs).
- Logging: rotating file at `LOG_PATH` (previously ignored), safe on non-UTF-8 consoles.
- Dependencies: `imagehash`, NumPy and SciPy (~50 MB) replaced by a 40-line dHash that produces identical hashes; `uvicorn[standard]` → `uvicorn`; ranges have upper bounds; launchers use the `py` launcher, reinstall only when `requirements.txt` changes, and are CRLF-safe.
- The UI is split into `index.html`, `static/css/app.css`, `static/js/core.js`, `static/js/app.js` (was one 2,826-line file); the desktop UI is detected automatically (no `?app=desktop` needed).

### Fixed
- **Desktop downloads**: PyWebView blocks downloads by default — *Download* and *Export* did nothing in the window.
- `--server` mode showed no crawler controls in a normal browser.
- Mobile layout could not scroll; broken `@keyframes` nesting killed toast animations; the speed meter spiked to thousands per second after every click; `sessionStorage` quota errors could leave the page loading forever; *Shuffle* only picked from the current page; exports leaked an internal `_search` field; gallery cards could not be reached with the keyboard.
- `--host 0.0.0.0` could not be used (the Host check now follows the setting per request).
- Race/crash windows: half-written files, orphaned files after DB errors, a second engine thread starting while the first was still stopping, `export_catalog_json` blocking the event loop.
- Wrong documentation: "pinned" dependencies, MIT badge next to an All-Rights-Reserved licence, a "16-bit" hash that is actually 256 bits, hard-coded `file:///c:/Users/…` links, indexes that were documented but never existed, stale counts.

### Security
- **`/data` no longer exposes `wallpapers.db` and `downloader.log`**; only `/data/wallpapers.json` is served.
- Host-header allow-list (DNS rebinding), Origin/`Sec-Fetch-Site` checks on state-changing requests (CSRF), CORS off by default (was `*`), CSP + `nosniff` + `X-Frame-Options` + `Referrer-Policy`.
- **XSS**: titles/tags/filenames from scraped sites were interpolated into `innerHTML` and inline `onclick` attributes; the UI now uses `textContent`/DOM APIs and delegated events, `javascript:` links are dropped, and a strict CSP is in force.
- TLS verification enabled for the crawler (was disabled globally); downloads are size-capped and decompression-bomb guarded; CSV exports neutralise formulas.
- SQL: sort/order/filters are whitelisted or parameterised (tests inject hostile values).

### Removed
- `templates/index.html` (byte-identical duplicate of `index.html`) and the stale `data/wallpapers.min.json`.
- `data/wallpapers.db-wal` / `-shm` from git (replaying a stale WAL onto a newer DB can corrupt it); the WAL content was folded into `wallpapers.db` first and verified row by row.
- Duplicated launcher logic (now shared in `scripts/setup_env.bat`).

### Migration
The database upgrades itself to schema v2 on first start (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#upgrading-from-21x)). Run **Repair metadata** once to fix old titles and tags.

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