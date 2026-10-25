# Changelog

All notable changes to Spotlight Studio are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [2.8.1] — 2026-10-25

### Reliability and performance
- Bound active image pipelines independently from network worker capacity with `MAX_INFLIGHT_IMAGES` (default 8). This limits retained download buffers and decoded images on memory-constrained hosts.
- Reject unsupported source image formats instead of preserving GIF/TIFF bytes under a misleading `.jpg` filename.
- Make preview maintenance replace Git LFS pointer files, parallelize work in bounded batches, avoid throwaway WebP encoding for palette-only repair, and report preview and metadata updates separately.

### CI and documentation
- Add blocking hermetic Chromium and mobile JavaScript checks; gate GitHub Pages deployment on those jobs plus Python/Node/catalog/site/Roku validation.
- Upload browser failure artifacts for seven days, and refresh architecture, configuration, release-risk and roadmap documentation to distinguish shipped features from open work.

---

## [2.8.0] — 2026-10-22

### Roku channel: a static gate for what the compiler cannot see
- New `scripts/roku_audit.py` (`make roku-audit`, also run first by
  `make roku-check`, and asserted by `tests/test_roku_audit.py`).  BrightScript
  compiles every `.brs` into one namespace and is forgiving in exactly the ways
  that break a canvas channel: a missing associative-array key returns
  `invalid`, a call to a method a component does not implement is a *runtime*
  error on the main thread, and a call to an undefined function is only found
  when execution reaches it.  The auditor checks all three, plus duplicate
  global definitions, deprecated APIs, manifest invariants and `bsconfig` glob
  coverage.
- **Found and fixed `roBitmap.DrawResizedObject()`** — it does not exist on any
  Roku component.  `ifDraw2D` offers `DrawObject`, `DrawScaledObject(x, y,
  scaleX, scaleY, src)`, `DrawRotatedObject` and `DrawTransformedObject`, with
  no pixel-dimension variant.  Every image in both packages was drawn with it,
  so the channel crashed on the first frame containing a picture.  All call
  sites now go through `DrawScaledTo()`.
- **Found and fixed `roFont.Copy()` / `roFont.SetSize()`** — `roFont` exposes
  only `GetOneLineWidth`, `GetOneLineHeight`, `GetAscent`, `GetDescent` and
  `GetMaxAdvance`.  Both channels were calling it from `BuildFonts()`, i.e.
  during `RunUserInterface()`, so neither started.  Sized fonts now come from
  `roFontRegistry.GetDefaultFont(size, bold, italic)`.
- **Found and fixed `roDateTime.FromISOString()`** (the real method is
  `FromISO8601String`) and **`roDeviceInfo.ConnectionType()`** (the documented
  method is `GetConnectionType()`).
- `roFont.GetOneLineWidth(text, maxWidth)` takes **two** arguments; 29 call
  sites were passing one.

### Roku channel: correctness
- **Theme Studio auto-rotation now rotates.**  The *Auto-switch* row persisted
  its settings but nothing ever acted on them.  `UpdateAutoRotation()` walks the
  rotation pool on schedule, assigns the Ambient wallpaper and/or the menu
  backdrop per `autoSwitchTarget`, drops the baked backdrop so it is rebuilt and
  pre-fetches the new thumbnail.  It is skipped while the viewer or Ambient Mode
  is on screen and the interval is floored at 60 s.
- **Split the two interval settings.**  `state.autoSwitchInterval` was doing
  double duty: changing Theme Studio's rotation interval silently rescheduled
  the Ambient slideshow.  The slideshow is now `state.ambientIntervalSec`.
- `StartAmbientFromGallery()` honours the wallpaper assigned by *Set as Ambient
  Wallpaper* instead of always starting at the top of the pool, and can no
  longer return to `viewer`/`ambient` (neither has a Back branch).
- The filter dialog's row count and search-row index are derived from one
  `FilterRowSpec()` list.  `FilterRowCount()` returned a literal `7` while the
  dialog had exactly 7 rows, so an eighth would have been unreachable, and the
  input handler kept its own literal `5` for the search row.
- Theme Studio's two assignment rows no longer print the same value in both
  columns; the rows show what is assigned and the panel hint says what OK would
  assign.
- `settings.brs` / `license.brs`: the trial and subscription boundary moved from
  milliseconds to epoch **seconds** (a millisecond epoch overflows a 32-bit
  Integer), and a restored subscription no longer clears `hasFullVersion`.
- `catalog.brs`: the `MergeSortByKey` locals shadowed the outer `source` array.
  Verified against a stable sort on 300 randomised trials.

### Roku channel: performance
- "Title A→Z" is a stable bottom-up merge sort instead of an insertion sort:
  ≈28 M comparisons → ≈97 K on the 7,475-row archive.  The old sort hung the
  channel for minutes and tripped Roku's response watchdog.
- Wallpaper-id lookups go through a memoised `CatalogIndex()` map instead of a
  linear scan per frame (~150 K comparisons/second at 20 fps).
- Solid rounded rects — card image slots, filter chips, tag pills, spinner dots,
  focus underlines, the active-tab pill — come from the shape cache.  A gallery
  page was issuing over 1 000 `DrawRect()` calls per frame before any thumbnail
  was drawn; it is ~23 blits now.
- Cache eviction is O(1) (the key list doubles as the LRU order) instead of
  scanning for the oldest stamp on every eviction.
- The fullscreen viewer no longer declares itself animating while a static image
  is on screen, which was re-scaling and re-blitting 1920×1080 twenty times a
  second, forever.

### Roku channel: docs
- New `docs/roku/STATE.md` — every one of the 78 `state` fields, the filter-state
  mirror, the two-interval trap and the persistence layout.
- New `docs/roku/AUDIT.md` — what the auditor checks, how it infers types, and
  the Roku API traps it caught (`nonexistent` table included).
- `PERFORMANCE.md`, `ARCHITECTURE.md`, `CONTROLS.md`, `DEEP_LINKING.md`,
  `RELEASE.md`, `TROUBLESHOOTING.md`, `CERTIFICATION.md` and the two package
  READMEs updated for the new timers, caches, budgets, deep-link actions and
  gates.  `docs/ROKU.md`'s stale links fixed.

### Roku channel: tooling
- Makefile: new `roku-audit` target; `roku-check` runs the audit first;
  `clean` also removes `scripts/roku/out/`.
- `tests/test_roku_audit.py`: 70 tests covering the audit itself, the manifest
  invariants and the source-level regressions (no withheld API calls, derived
  row counts, distinct intervals), plus negative tests that prove the
  entry-point and deprecated-API checks actually fire.
- Removed the generated BrighterScript staging directory `scripts/roku/out/`.
- `bsconfig-screensaver.json` now filters BS1013 for the screensaver's own
  `main.brs` and the six shared modules, so `make roku-lint` is genuinely
  clean.  Roku compiles every `.brs` in `source/` into one program, so
  "not referenced by any other file" is not a defect here; the filters are
  path-scoped, so an orphaned file anywhere else still reports.

### Repository
- **Fixed a broken release gate.**  `tests/test_consistency.py` asserts the
  newest CHANGELOG release equals `src/__version__`; 2.7.0 had been released
  without bumping it, so `make check` failed on a clean tree.  The app version
  is now 2.8.0 across `src/__init__.py`, `index.html`, `sw.js` and the README
  badge.
- `scripts/flatten_roku_art.py`: removed an unused local, so `make lint` is
  clean again.

---

## [2.7.0] — 2026-10-21

### Roku channel: certification and correctness
- **Fixed a first-frame crash**: the render loop dereferenced an animation
  clock that was never created.
- **Fixed dropped input**: the message loop discarded the value returned by
  `port.WaitMessage()` and then polled `GetMessage()`, silently swallowing the
  first key press after every idle period.
- **Fixed the Back button** (certification 4.6): it used to exit the channel
  from every screen; it now walks grid → tab bar → Roku home.
- **Fixed 4K playback**: `roBitmap` cannot decode above 2048×2048, so the 898
  Ultra-HD wallpapers could never display.  Full frames now arrive through
  `roTextureManager` with `SetSize(1920, 1080)`, with a download+`roBitmap`
  fallback for devices without a texture manager.
- **Fixed the viewer's aspect maths**: integer truncation made the fit scale 0
  for any source larger than the screen, then fell back to 1 and drew 4K frames
  at native size.  All of it is float now.
- **Fixed index-space bugs**: viewer and Ambient Mode used to index `filtered`
  while displaying the screensaver list or the daily pick; both now use an
  explicit `browseList` + `browseIdx`.
- **Fixed the Roku Pay flow**: `SetOrder()` now receives a list of
  `{code, qty}` items, `DoOrder()` takes no arguments, and the catalog is read
  from Roku instead of hardcoded prices.  Entitlements are re-synced with
  `GetPurchases()` on every launch and subscriptions honour `expirationDate`.
- **Fixed the screensaver gallery crash** on catalog fields that do not exist
  (`resolution`, `category`, `copyright`); resolution, category and attribution
  are derived instead.
- **Removed certification blockers**: `screensaver_title`/`screensaver_private`
  and `RunScreenSaver()` (4.5), `InitClientCertificates()` (deprecated OS 16.0),
  `build_version=0` (6.1), transparent artwork (6.4), and the 4.18 MB catalog
  that put the package over the 4 MB limit (3.7).
- **Removed production debug hooks**: trial reset/expiry shortcuts now require
  a sideloaded developer build.

### Roku channel: performance
- Dirty-frame rendering: the canvas repaints only when something changed, with
  20 fps budgets for breathing/spinner/drift and 60 fps for short transitions.
- Bounded LRU caches for rounded panels and resampled images (`gfx_cache.brs`),
  capped at ~12 MB of texture memory; full-frame cache reduced from four
  native-resolution bitmaps (up to 132 MB) to two screen-sized ones (~16 MB).
- Memoised theme palette, option lists and layout metrics; the device clock is
  refreshed at most once every 15 s; a negative disk cache stops per-frame
  `tmp:/` stats; a 30 s watchdog releases stalled network slots.
- Catalog trimmed to 2.20 MB with a generator script; the Daily Spotlight scan
  is cached per day in the registry and hashes the date prefix once per day.

### Roku channel: features
- On-screen QWERTY search keyboard (plus physical-keyboard input) over titles
  and tags.
- Theme Studio: six palettes applied live, ambient/backdrop wallpaper
  assignment, rotation pools (landscape / 4K / favourites / daily) and
  intervals.
- Menu backdrop wallpaper behind the gallery grid.
- Resume-last-position (tab, page, grid index, last wallpaper) across launches.
- System navigation sound effects that respect the device's audio setting.
- Direct-to-Play: ECP `/input` deep links handled while the channel runs.
- Ambience: dip-to-black cross-slides, Ken Burns drift, prefetch of the
  neighbouring wallpapers, honest empty/offline states everywhere.

### Roku channel: packaging, tooling and docs
- New standalone screensaver app `roku-screensaver/` (the only Roku-legal way
  to ship this feature), built from shared modules by
  `scripts/package_roku.py --variant screensaver`.
- New scripts: `build_roku_catalog.py`, `flatten_roku_art.py`,
  `package_roku.py` (certification pre-flight), and a BrighterScript compile
  gate in `scripts/roku/`.
- New Makefile targets: `roku-catalog`, `roku-art`, `roku-lint`, `roku-check`,
  `roku-zip`, `roku-screensaver`.
- Eleven new documents in `docs/roku/`: architecture, controls, certification,
  performance, Roku Pay, deep linking, catalog, screensaver, troubleshooting,
  release checklist and an index.
- Artwork flattened to opaque RGB so it passes certification 6.4.

## Native [1.2.0] — 2026-10-08 (bridge 0.3.0)

### Native reliability and UX
- Bounded originals/partials (256 MiB), exports (64 MiB), disk safety/reservations,
  last-used eviction, stale cleanup, consumer pins and serialized per-image operations.
- Private-cache JPEG/PNG/WebP native decoder/completeness validation; Android sampled,
  process-locked wallpaper writes with policy/target checks, confirmed ID and backup opt-out;
  Swift ImageIO validator with explicit unsupported iOS setting.
- Add-only Photos, no widening after denial, no Android 11+ gallery-read request/album browsing;
  Android Apply failures no longer silently save or request Photos.
- Cancel/navigation cleanup and truthful already-started system completion; root-owned rotation,
  foreground reconciliation, plan/favorite/revision rechecks and latest manual priority.
- Provider-independent recovery, splash watchdog, guarded/reset reload, serialized clearing,
  StrictMode-safe theme writes and lower-memory preview caching/resizing.

### Shipping policy and evidence
- HTTPS-only preview/production, separate explicit development IDs, scoped legacy write consent,
  blocked production overlay/read permissions and removed unused iOS background modes.
- Offline privacy notice and reason declarations, resolved-native-config validation, EAS profile/
  audit gate and native compiler CI jobs. Reanimated pinned to SDK expected 4.5.1.
- **207 Jest tests**, clean types/lint/SDK compatibility, all-platform JS/Hermes exports,
  Android/iOS prebuild and both autolinkers passed. Existing archive/design assets preserved.
- **Not store certification:** 55 inherited affected dependency nodes, native compilation/device
  QA, signing, hosting/content rights and publisher/privacy approvals remain release blockers.
  See `docs/NATIVE_RELEASE.md`; no automated audit waiver or signed artifact was produced.

## [2.6.0] — 2026-10-09

### Changed
- Web/PWA interface refined into the **Liquid Glass** design language: a four-strength
  glass material system (primary / secondary / tinted / floating) with controlled blur
  and saturation, a layered ambient background with fine grain, and a centralized token
  layer (`static/css/tokens.css`) for colour, materials, radii, spacing, type, motion and
  z-layers in both themes.
- Premium interaction pass across every surface: tactile buttons with press compression,
  spring-sliding segmented indicator, glass popovers/menus, spring dialogs, floating glass
  toasts, staggered card entrances, gentle photo elevation, refined list rows, pills,
  inputs with animated focus rings, semantic status tints, and polished skeleton, empty,
  error, offline and read-only states.
- Consistency fixes: all selection, chip and pagination accents now come from the accent
  tokens (a stray hard-coded blue is gone), select chevrons and status pills use semantic
  theme-aware tokens, and the API reference page shares the same materials and motion.
- Theme switches crossfade the base layer; `prefers-reduced-motion`,
  `prefers-reduced-transparency` and `forced-colors` remain first-class, and all motion
  stays GPU-friendly (transform/opacity/filter only).
- Versioned asset URLs, service-worker shell cache and API-docs cache busters bumped to
  2.6.0 together. No functionality, routes, APIs, data or user flows changed.

## [2.5.0] — 2026-10-08

### Added
- Shared UTC daily spotlight on the web and mobile Browse screen; stable selection for
  the same catalog, favorite/open actions, midnight and app-resume updates.
- Portable version-1 mobile favorites backups compatible with the browser; merge-only
  imports, unmatched-key retention, validation and size/count limits.
- OS-backed, non-blocking library ownership for server/desktop/CLI lifetimes; a competing
  process exits before migrations, claim recovery or maintenance (CLI exit code 3).
- Schema v3 expression indexes for eight dHash chunks; wide-radius searches fall back to
  a complete scan, and a future database schema is refused instead of downgraded.

### Fixed
- Engine dispatcher failures stop sibling dispatchers; cancellation drains executor work;
  maintenance transactions preserve shared/LFS files and original data on failed commits.
- API factories cannot claim a different library from the process-wide storage settings.
- Mobile **Save** saves to Photos, never changes Android wallpaper; staged, cancellable,
  coalesced transfers validate image headers, enforce completion/progress limits, clean
  partials and share the correct JPEG/PNG/WebP MIME type.
- Versioned mobile catalog cache records source/origin/freshness, rejects mismatched
  provenance and preserves the previous file on failed writes. Empty catalogs remain empty.
- Serialized preference writes, validated history/settings, synchronous favorite results,
  visible persistence failures and ordered enable/disable/enable rotation scheduling.
- Rotation respects interval and all filters; no arbitrary fallback when the pool is empty.
- Scoped PWA cleanup no longer removes another gallery; first-visit activation seeds an
  offline catalog; fallback/cache writes are awaited and quota-safe.
- Viewer favorites refresh on close, metadata changes invalidate gallery rendering,
  modal clipboard fallback works, and persistent image errors offer retry.
- Reject unpaired UTF-16 paths; prototype-like source names cannot corrupt count maps.
- KDE without its helper fails explicitly; an older GNOME's absent optional dark key
  no longer negates a successful main wallpaper change.
- Android bridge uses the current Expo module Gradle plugin (the old script was removed
  from SDK 57), bounds/pixel checks and bounded bitmap sampling; truthful iOS exception.

### Maintenance and release boundaries
- Native app version **1.1.0**, bridge **0.2.0**; unused Expo dependencies removed and
  direct Ionicons imports avoid bundling unrelated icon families.
- Scoped Expo Router query-string/decoder compatibility override; parser regressions and
  web/Android/iOS JavaScript exports verified. Remaining mobile advisories require triage.
- Static publication uses an exact public-file allow-list and refuses source/output symlinks;
  source validation runs before replacing an existing artifact.
- Expanded backend/browser/mobile regressions and updated architecture, data, mobile,
  operations and release-readiness documentation. Native compilation/hardware, live-source
  crawling, LFS archive verification, authenticated hosting and licensing remain release gates.

## [2.4.0] — 2026-10-07

### Changed
- Original Still Glass design across browser/PWA and Expo screens: semantic light/dark
  palettes, restrained structural materials, external photo captions, floating navigation,
  consistent typography, forms, lists, buttons, sheets and state surfaces.
- Centralized web/native design tokens; refreshed the existing icon family in muted sage.
- Styled the self-hosted API reference without modifying Swagger or relaxing CSP.
- Service-worker shell/cache version updated; includes the new token stylesheet.

### Accessibility and interaction
- Animated, cancellable dialog/menu/viewer closing; top-layer-aware toasts; a focus-contained
  mobile browser filter drawer with inert background and reliable focus return.
- Native motion/transparency preferences, 44dp shared controls, stable tag-rail height,
  floating-tab content clearance and small-width header/control wrapping.
- Reduced-motion CSS/native handling and semantic-text contrast regression checks.

### Fixed
- Expo web startup no longer eagerly evaluates the native-only photo-library module.
- Cross-platform stable animation values and guarded reduced-transparency capability checks.
- Native press feedback preserves caller opacity/transforms and applies layout to the press target.

### Documentation and checks
- Design specification and screen/component consistency audit; refreshed preview screenshots.
- Expanded browser coverage for themes, viewer/dialog flows, 320/390/768px layouts,
  focus containment, touch targets, reduced motion and contrast; native theme tests.
- Data, API contracts, routes, native wallpaper workflows and previous hardening preserved.
  Device/native, archive and dependency-advisory release gates still apply.

## [2.3.0] — 2026-10-07

### Fixed
- Keep the old wallpaper until its replacement files and metadata are safely committed;
  preserve the wallpaper ID/deep link, and wait for executor writes during cancellation.
- Persisted mobile catalog freshness now survives launches; overlapping refreshes share a request.
- Malformed browser favorites/preferences no longer prevent startup.
- Catalog ETags hash response bytes and support weak/list/wildcard validators.
- Starting during shutdown returns busy without a lock-blocking thread join.
- Maintenance reserves the idle engine; HTML reads are size-capped and automatic CPU workers capped at four.
- Origin checks compare scheme as well as host; reject non-finite numeric configuration.
- Service-worker writes are awaited and quota-safe; cached pages/catalogs survive HTTP 5xx.

### Added
- `READ_ONLY` server mode, capability-aware UI, and deployment guidance.
- Versioned favorites backup/restore (merge, validation, size limits), cross-tab synchronization,
  storage-failure notices, offline indicator, and keyboard navigation in the actions menu.
- Self-hosted, CSP-compatible API reference and a safe static-site build/Pages workflow.
- Chromium smoke tests in CI and a production-readiness review with explicit release blockers.

### Maintenance
- New downloads use content-addressed filenames; existing paths remain supported.
- Refreshed compatible mobile dependencies; unresolved upstream advisories remain documented.
- Removed generated mobile coverage reports from version control and ignored future reports.

## [Unreleased]

### Added
- **Mobile app** (`mobile/`): a production Expo (React Native) client for Android and iOS that browses and searches the same catalog offline, keeps favourites/history on the device, downloads, saves to Photos and shares. On Android it **sets the wallpaper** (home / lock / both) through a bundled Expo Module (`modules/wallpaper`, `WallpaperManager`) and rotates it periodically with `expo-background-task`; iOS has no public API to set a wallpaper, so there the app saves into a “Spotlight Studio” album and guides the user through the Shortcuts step instead.
- Mobile screens: gallery (masonry + list, tag rail, source/quality/sort filters, favourites-only, deep links), dedicated search with recent searches, directory (stats, sources, resolution classes, full tag index, JSON/CSV catalog export through the share sheet), wallpaper detail, tags, history, settings (theme, rotation, cache, reset) and about.
- `mobile/src/core/` ports the web UI's pure logic (filters, generated titles, quality classes, rotation rules) so both clients behave identically; Jest covers it, the media/rotation services (Android *and* iOS personalities), the export, the optional native module and the React providers/components — 114 tests, with a coverage floor enforced by `npm run test:ci`.
- `scripts/make_icons.py` now generates the Expo icon set (`mobile/assets/`) from the same brand mark as the PWA icons.

### Changed
- `docs/MOBILE.md` (build, store, environment variables, set-wallpaper capabilities, rotation, troubleshooting), a mobile section in `docs/DEVELOPMENT.md`/`docs/SECURITY.md`, a CI job running `npm ci && npm run verify`, and `mobile/eas.json` with development/preview/production profiles.

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
- Near-duplicate detection (Hamming ≤ 4) now runs **at insert time** (it only ran in a post-scrape sweep and never for new downloads); the surviving copy inherits the union of tags and the better title. Check and insert are one critical section, so two copies of a picture that are in flight together (typically the Peapix and the Windows10Spotlight version) cannot both be stored.
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