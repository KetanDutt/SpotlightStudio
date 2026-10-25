# Project review and release readiness

**Reviewed:** 2026-10-25 · **Application version:** 2.8.1

This review covers the Python API/crawler, SQLite and media pipeline, desktop integration,
static/PWA frontend, Expo mobile client, Roku packages, CI, and user/developer documentation.
It records verified behavior separately from platform limitations; passing tests are not a
claim of store or OS certification.

## Architecture and boundaries

- **Python backend:** FastAPI serves a local gallery/API; SQLite WAL stores metadata and
  claim-based crawl queues. A single-process library lock protects startup/migrations and
  crawl ownership. Pillow analysis and media writes use a bounded CPU pool; downloads and
  scraping are async.
- **Web/PWA:** static HTML/CSS/JavaScript with pure catalog logic, progressively enhanced
  gallery interactions, service-worker shell/catalog caching, and an explicit allow-list
  for GitHub Pages output.
- **Mobile:** Expo/React Native client with offline catalog/preferences, validated media
  handling and platform-specific wallpaper behavior. Android can apply wallpapers; iOS
  saves images for user-driven application.
- **Roku:** a canvas-based channel and separate screensaver package, with BrightScript
  static-audit and packaging tools.

The browser backend is intentionally **local-first**, not a multi-user service. Host and
Origin checks mitigate browser-based attacks; they are not authentication. For remote writable
use, require a TLS-authenticated reverse proxy/VPN and firewall policy. For public browsing,
prefer the static Pages artifact.

## Verification

Checks run against this review:

| Gate | Result |
|---|---|
| Ruff | Clean |
| Python | **345 tests passed** |
| Root JavaScript | **31 tests passed** |
| Chromium browser suite | **16 hermetic tests configured**; executes in CI with synthetic assets and disposable storage |
| Mobile | TypeScript and ESLint clean; **209 Jest tests passed** in 22 suites |
| Catalog | **7,475 records** pass URL, metadata, path and asset-reference checks |
| Static site | Build succeeds from the explicit public-file allow-list |
| Roku | Static channel/screensaver audit reports **0 errors and 0 warnings** |
| Git hygiene | `git diff --check` clean |

The GitHub Actions workflow now runs Python/Ruff, Node, catalog/site, Roku-audit, browser and
mobile checks. A Pages deployment requires all verify/browser/mobile jobs to pass. Browser
failure artifacts are retained for seven days. Workflow execution is hosted and not implied by
local test results.

## Known release risks and limits

### Mobile dependency advisories

As of 2026-10-25, `npm audit` reports **5 high, 0 critical** findings in `mobile/` (the root
web-tooling package reports 0). The affected mobile dependency path includes Expo CLI,
`@expo/code-signing-certificates`, `node-forge` and `zod`. npm's suggested top-level fix would
downgrade Expo to 44.0.6, incompatible with this SDK 57 application. Do not apply that fix or
force an override without checking the Expo compatibility matrix and exercising native builds.
Re-run `npm audit` before releases and resolve through compatible upstream versions or an
explicitly documented risk decision. This is an outstanding release gate.

### Platform verification

- Windows `IDesktopWallpaper` COM behavior, per-monitor selection, tray behavior and shell
  policy have not been exercised on Windows in this environment.
- Mobile Kotlin/Swift compilation, signing, and real-device OS permissions, suspension,
  background rotation and low-memory behavior are not verified by TypeScript/Jest checks.
  See [NATIVE_RELEASE.md](NATIVE_RELEASE.md) for store-release gates.
- Existing repository image files may be Git LFS pointers in a clone without `git lfs pull`.
  Catalog checks can validate path references, but cannot decode or backfill previews from
  pointer text. Hydrate LFS originals before preview repair or desktop wallpaper use.
- Source-site markup, availability, copyright/license terms, rate limits and Git LFS quota
  remain external dependencies that need periodic owner review.

## Data and operational safeguards

- Back up the SQLite database and image tree together while the application is stopped.
  SQLite transactions and filesystem writes cannot form one power-loss-atomic transaction;
  `--check` reports inconsistencies but does not delete orphans automatically.
- Use one server process/worker per library on a local filesystem. The lock is advisory and
  not distributed; network filesystems and multiple writers outside Spotlight Studio are not
  covered.
- Keep `MAX_IMAGE_BYTES`, download concurrency and CPU threads within host memory limits.
  LFS pointers are not usable originals. Preview repair now runs in bounded batches and
  replaces pointer previews when valid originals are present.
- Public static-site output is allow-listed; never publish the database, logs, environment
  files, or the writable local API as a substitute for a static gallery.

## Recommended next steps

1. Resolve or explicitly accept the mobile dependency advisories before distributing native
   builds; compile and test the Android and iOS projects on supported toolchains.
2. Validate the Windows wallpaper/tray integration on real multi-monitor configurations.
3. Confirm source-site terms, attribution expectations, request politeness and LFS storage/
   bandwidth budgets before increasing crawl or publication scale.
4. For deployments beyond a single trusted machine, add authenticated access at a TLS reverse
   proxy and document a tested backup/restore drill.
5. Keep release notes, dependency audits and the [roadmap](ROADMAP.md) aligned with shipped
   features; do not duplicate already-implemented work as future proposals.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), [SECURITY.md](SECURITY.md),
[DEPLOYMENT.md](DEPLOYMENT.md), and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for operational
procedures.
