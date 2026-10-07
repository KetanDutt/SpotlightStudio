# Project review and release readiness

Reviewed: **2026-10-07**, release **2.4.0**. Includes the 2.3 hardening and the Still Glass redesign.
This is not a claim that every deployment or native platform is production-certified.
See [DESIGN.md](DESIGN.md) for the visual-system audit and platform boundaries.

## Project map and scope

- **Python application:** `main.py` owns CLI/desktop launch, `config.py` loads settings,
  `engine.py` dispatches claimed scrape/download queues, parsers in `scrapers.py`
  discover metadata, and `downloader.py` analyzes/deduplicates/stores images.
- **Persistence:** SQLite/WAL, schema v2, atomic file writes, generated JSON catalog.
  The DB, catalog and LFS image pointers in this checkout were intentionally preserved.
- **HTTP:** FastAPI serves a tightly scoped set of files and library/control endpoints;
  middleware protects Host, Origin and browser content policies. No built-in authentication.
- **Browser:** framework-free catalog search and pagination, accessible viewer, local
  favorites, PWA shell/catalog caching. No npm runtime dependency or bundling step.
- **Mobile:** Expo/React Native, bundled/remote/local-server catalog sources, persisted
  preferences, media downloads, Android wallpaper bridge and background rotation;
  iOS deliberately uses the save-to-Photos workflow.
- **Delivery:** Windows launchers, Python/Node/mobile tests, CI, documentation and Pages.

Review combined code inspection across these subsystems with unit/integration tests,
real Chromium smoke tests, dependency audits, and a disposable synthetic preview.
It did **not** crawl live source sites, retrieve the full LFS archive, run native builds,
or change wallpapers on real devices. The sandbox can reach package registries and
GitHub, not Peapix/Windows10Spotlight.

## Findings addressed

| Area | Finding | Resolution / regression coverage |
|---|---|---|
| Data safety | Better-quality downloads deleted the original before writing the replacement | Write new content-addressed files first; atomically replace DB metadata, suppression records and counters; only then remove old files. Disk/DB failure tests retain original bytes and metadata. |
| Cancellation | Cancelling an executor await could clean up a file while a worker still wrote it | Shield the commit and drain it before releasing the dedupe lock; cancellation regression test. |
| Deep links | Quality upgrades changed wallpaper IDs | Restore the original ID inside the replacement transaction. |
| Concurrency | Maintenance checked idle state without reserving it | Engine-owned maintenance guard excludes concurrent starts/repairs and releases on exceptions. |
| Engine shutdown | Restart joined a stopping thread while holding the lock that shutdown needed | Return busy immediately; publish completion under the same lock before another start. |
| Memory | Automatic CPU pool could decode up to 32 large images simultaneously | Automatic mode now caps at four CPU workers; explicit operator settings remain available. HTML reads cap decompressed responses at 8 MiB, including chunked bodies. |
| HTTP caching | Revision-based ETags could collide after restoring another database; concurrent cache misses repeated serialization | Hash catalog bytes, serialize under a single cache lock and database snapshot; support weak/list/wildcard validators. Stop the server before restoring its DB. |
| Configuration/security | Non-finite floats and scheme-insensitive Origin comparison | Reject NaN/infinity; compare scheme as well as host and reject malformed origins. |
| Deployment | Writable server lacked a public-gallery mode | `READ_ONLY=true` rejects every HTTP mutation, including future routes; UI hides unavailable controls. This is **not authentication** or filesystem read-only mode. |
| API reference | Default CDN/inline Swagger assets were blocked by the app's own CSP | Pinned self-hosted Swagger UI, external initialization, no external validator. `/api/redoc` redirects to the same reference. |
| Browser reliability | Malformed saved state/catalog rows could prevent rendering | Defensive favorites/preferences reads and catalog row validation; body-inclusive catalog timeout. |
| User data | Browser favorites could not be backed up or restored | Versioned export/import, merge-only restore, validation and limits, cross-tab sync and storage-failure notices. |
| UI | Missing offline/read-only feedback and incomplete menu keyboard navigation | Status banners, focus return, arrow/Home/End navigation and bounded menu height. |
| Offline caching | Unawaited cache writes; arbitrary same-origin URLs cached indefinitely | Await quota-safe writes; restrict caching to shell allow-list; fall back to cached content on HTTP 5xx. |
| Mobile cache | Persisted freshness timestamp was written but never read on cold start | Read and validate stored time; coalesce concurrent refreshes; preserve fallback error details. |
| Publication | Publishing the repository root could expose the DB/source/logs on a static host | `scripts/build_site.py` and Pages workflow publish an explicit file allow-list. |
| Repository hygiene | Generated mobile coverage HTML/JSON/XML was tracked | Removed reports; ignored coverage and browser traces. Source, fixtures, native modules and library assets retained. |

### Durability boundaries

SQLite and the filesystem do not share a transaction. A **hard process kill/power loss**
between file creation and DB commit can leave new orphan files; a kill after commit
but before cleanup can leave old orphan files. The old valid wallpaper is no longer
deleted before the replacement commits. Use `--check` and inspect reported orphans;
never promise zero orphan files after power loss. Graceful cancellation is tested.

Favorites are keyed by filename, not database ID. A quality upgrade can change that
filename, so a previous favorite may become unmatched even though its deep link
survives. Backup/restore retains unmatched keys; cross-device account sync and
filename migration are not implemented.

## Dependency audit (2026-10-07)

Commands and results in this environment:

- Python: `pip-audit --vulnerability-service pypi` initially found advisories in the
  environment's old **pip/setuptools**, not the installed application dependencies.
  After upgrading pip to 26.2.1 and setuptools to 84.0.0, the audit reported **no known
  vulnerabilities**. Audit tooling is not a runtime dependency. Results are a point-in-time
  check of the installed Python 3.11/Linux environment, not every allowed version/OS.
- Root browser-test tooling: `npm audit` reported **0 vulnerabilities**.
- Mobile: `npm audit fix` applied compatible lockfile updates. The resulting audit
  still reports **66 affected packages: 48 high, 18 moderate**. Underlying advisories
  include `braces`, `decode-uri-component`, `node-forge`, `sprintf-js` and `uuid`;
  transitive packages inherit those severities. The count is not 66 independent flaws.
  Proposed automatic fixes include incompatible Expo/Jest/React Native changes and
  even downgrades. **Do not use `npm audit fix --force` blindly.**

Mobile release requires an Expo-compatible dependency upgrade or documented advisory
triage/acceptance, followed by native builds and real-device testing. npm's severity
alone does not establish application exploitability, and passing unit tests does not
clear these advisories. Dependabot now covers both npm projects.

## Verification

Local verification: **241 pytest tests**, **21 Node tests**, **122 Jest tests** and
**10 Chromium tests** passed. Ruff, TypeScript, ESLint, `pip check` and static
artifact generation passed. Pytest emits one upstream Starlette/httpx deprecation warning;
the client still works. This does not represent hosted CI execution on every OS.

Re-run rather than relying on these historical results:

```bash
python -m pip install --upgrade pip setuptools
python -m pip install -r requirements-dev.txt
ruff check .
pytest
node --test tests/js/*.test.mjs
npm ci
npx playwright install --with-deps chromium
npm run test:browser
cd mobile
npm ci
npm run typecheck
npm run lint
npm run test:ci
npm audit
```

Browser tests use a temporary database and synthetic images; no LFS download or live
crawl is needed. They cover corrupt preference recovery, real favorites file round-trip,
search/empty states, mobile-width overflow, menu focus, cross-tab favorites and API-docs
CSP/network behavior. CI adds the same Chromium smoke job. Existing CI still tests Python
3.10–3.13; Windows remains non-blocking until validated by the owner.

## Release blockers and prioritized follow-up

1. **High:** resolve/triage mobile dependency advisories and produce signed Android/iOS
   builds on supported SDKs. Verify home/lock/both, permissions, app suspension, rotation,
   low-memory behavior and iOS Photos/Shortcuts on hardware.
2. **High:** writable network deployments require authenticated TLS reverse proxy/VPN and
   rate limits. `ALLOWED_HOSTS` prevents rebinding; anyone can send an allowed Host header.
   Read-only galleries still expose the catalog and require normal abuse protections.
3. **High:** validate image licensing, LFS quotas, source-site terms and robots/rate policies
   before publishing or scheduling bulk crawls. Run a real-library repair/check with access
   to the sources and real image files.
4. **Medium:** create platform-specific Python dependency locks with hashes, an SBOM and
   controlled update policy. Current requirements use version ranges, so CI success today
   does not guarantee a future fresh install has identical versions.
5. **Medium:** process-wide/machine-wide instance locking. Engine guards are in-process only:
   use one server worker and never run CLI crawls against a live server's database.
6. **Medium:** mobile download/catalog byte limits are not universally enforced during native
   streaming; add streaming limits and test interrupted file-cache writes on devices.
7. **Medium:** generate smaller viewer previews to reduce LFS bandwidth, then measure real
   low-memory device performance. Keep pagination instead of adding unneeded virtualization.
8. **Later:** stable favorite migration on upgrades, desktop rotation, duplicate review,
   internationalization and richer monitoring. See [ROADMAP.md](ROADMAP.md).

Deployment and rollback gates: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
