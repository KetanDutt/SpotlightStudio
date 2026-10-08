# Project review and release readiness

Reviewed **2026-10-08**. Web/backend **2.5.0**; native client **1.2.0**, wallpaper bridge **0.3.0**.
This review hardens the existing Still Glass product; it is **not unconditional production certification**.

## Architecture and scope

- **Python:** `main.py` launches CLI/server/desktop; FastAPI serves the gallery and controls;
  the engine dispatches durable scrape/download queues; parsers discover metadata; a bounded
  CPU pool analyzes, hashes and stores images. SQLite/WAL is authoritative; JSON is a projection.
- **Browser/PWA:** dependency-free DOM UI and pure catalog logic; local favorites, shareable
  views, accessible viewer, desktop controls, and scope-specific offline shell/catalog caching.
- **Mobile:** Expo SDK 57, React Native 0.86.3 and React 19.2.3; offline-first catalog,
  local preferences/media cache, Android wallpaper bridge, OS-scheduled rotation, iOS Photos.
- **Delivery:** Python/Node/Chromium/Jest gates, allow-listed static publication, Windows
  launchers, native development/build profiles and operational documentation.

The tracked DB, catalog, bundled mobile catalog, images and LFS pointers were preserved.
No live crawl, full LFS retrieval, signed native build, device wallpaper change or deployment
was performed. This environment permits registries/GitHub, not the two source sites.

## Main improvements

| Area | Resolution |
|---|---|
| Process safety | OS advisory lock held for the entire API/desktop/CLI lifetime, before migrations or recovery. Competing instances fail; CLI exit code **3**. The sidecar is never unlinked. Factory paths must match process-wide storage settings. |
| Hash lookup | Schema **3** adds eight case-normalized expression indexes. Query-plan tests confirm index use; radius ≥8 uses a full scan, avoiding false negatives. Future schema versions fail without being downgraded. |
| Engine reliability | Supervise both dispatchers together, propagate failures, drain executor work before cancellation cleanup, synchronize snapshots, and reserve maintenance against concurrent starts. |
| File/DB consistency | Transactional deduplication/suppression/stat changes; preserve shared references, LFS placeholders and originals on handled write/commit failures. Delete redundant files only after commit. |
| Daily discovery | Same deterministic UTC daily selector in browser/mobile, independent of row order/title edits; open/favorite controls and midnight/resume updates. Identical valid catalogs are required for identical picks. This is not OS wallpaper automation. |
| Browser UI | Persistent image-error/retry state; modal-safe clipboard fallback; sensible share fallback; favorites-view refresh on viewer close; metadata-aware render invalidation; Data Saver/static thumbnail warm-up. Still Glass retained. |
| PWA | Scope-specific cleanup protects other apps; activation seeds the catalog so offline can work after one successful visit; await quota-safe cache writes and preserve legacy catalog fallback. Images are not bulk cached. |
| Mobile media | **Save** always saves to Photos rather than applying Android wallpaper. Metadata/URL-based cache identity; staging, cancellation/timeouts, coalescing, native decoder validation, private-path checks, quotas/reservations, pinned per-image leases, partial cleanup, and correct JPEG/PNG/WebP sharing metadata. Android errors never silently save. |
| Mobile catalog | Versioned origin/source/time envelope, source matching and defensively validated rows. Failed staged writes retain prior cache; intentional empty libraries remain empty; offline fallback is not reported as a successful refresh. |
| Preferences/backups | Serialized writes and read-after-write consistency; validated hydration/history/settings; accurate same-tick favorite toggles; visible persistence failures; portable, merge-only favorites backups retain unmatched keys. |
| Rotation | Strict filter pools, minimum elapsed interval, no arbitrary fallback on empty results, overlapping-run coalescing and ordered enable→disable→enable scheduling. Root-owned scheduling/foreground reconciliation, confirmed scheduler state, latest manual priority and plan/favorite/revision rechecks before native writes. |
| Native bridge | Replace a removed SDK 57 Gradle script with the current module plugin; Both platforms validate private-cache files; Android bounds/120 MP, 2 MP validation/12 MP apply decode, process lock, policy checks and OS confirmation. Swift ImageIO validation, shared lock and truthful unsupported setting. Native compilation/device behavior still unverified. |
| Hygiene/performance | Remove unused Expo application/device/gradient dependencies; direct Ionicons imports avoid app-level unrelated icon families (the SDK may ship its own UI fonts). Exact public-file build list excludes private/unreferenced files and rejects symlinks before replacing an artifact. Generated outputs stay ignored. |
| Input handling | Reject traversal, credentials/non-HTTP links, unpaired UTF-16 and ambiguous catalog paths; null-prototype source counts avoid prototype-key collisions. Existing CSP, Host/Origin, read-only, CSV and TLS protections retained. |

## Verification

Local release checks (re-run after changes):

| Gate | Result |
|---|---|
| Ruff | Clean |
| Python | **261 tests** |
| DOM-free core/service worker | **29 Node tests** |
| Real Chromium | **16 browser tests**, including first-visit/offline/scoped PWA behavior |
| Mobile | TypeScript/ESLint clean; **207 Jest tests** in 22 suites, coverage floor enforced (82.97% statements / 71.29% branches / 87.34% lines) |
| Metro | Web export and **Android/iOS Hermes JavaScript exports** succeeded |
| Native configuration | Both-platform prebuild and resolved HTTPS/permission/background/privacy/minify policy passed; SDK compatibility passed with Reanimated 4.5.1 |
| Module linking | Android and Apple resolvers discover the custom wallpaper class/pod |
| Static artifact | Exact allow-list generation and private-file/symlink regressions |

Browser tests use disposable synthetic data/images. Native services are mocked in Jest;
Hermes exports prove JS bundling, **not** Kotlin/Swift/Gradle compilation or OS permissions.
One upstream Starlette/httpx TestClient deprecation and a React Native StrictMode
`findNodeHandle` diagnostic remain non-failing. Hosted CI/Windows execution is separate.

```bash
python -m pip install --upgrade pip setuptools
python -m pip install -r requirements-dev.txt
ruff check . && pytest
npm ci && npm test
npx playwright install --with-deps chromium
npm run test:browser
python scripts/build_site.py
cd mobile
npm ci && npm run typecheck && npm run lint && npm run test:ci
APP_VARIANT=production npm run verify:config
EXPO_OFFLINE=1 npx expo install --check
APP_VARIANT=production EXPO_OFFLINE=1 npx expo export --platform all
npm audit
```

## Dependency audit — 2026-10-08

- Root npm development tooling: **0 vulnerabilities**.
- Mobile: **55 affected packages (48 high, 7 moderate)**, inheriting three advisory
  families: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
  [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
  Counts are affected dependency nodes, **not 55 independent vulnerabilities**.
- Compatible remediation removed the UUID and URI-decoder findings. Expo Router alone
  uses the scoped `query-string@9.3.1` / `decode-uri-component@0.5.0` override: valid
  parse/stringify/pick and long malformed-percent inputs are tested, and all-platform
  Metro exports pass. Recheck this override after every Expo Router update.
- Python: **no known vulnerabilities** in the installed Python 3.11/Linux environment,
  audited with pip-audit 2.10.1 (PyPI service) after updating pip 26.2.1/setuptools 84.0.0.
  This does not cover every version range or Windows-only packages. See the release checklist.

Checked published braces 3.0.3 / node-forge 1.4.0 / sprintf-js 1.1.3 still fall in their advisory ranges. Production verification and the EAS store hook fail audit without an automatic waiver.

Do **not** run `npm audit fix --force` blindly: suggestions include incompatible
Expo/Jest/React Native changes/downgrades. Before distributing native apps, classify
reachability of each advisory for build/test/runtime, resolve it or obtain explicit
owner risk acceptance, and rerun native builds/device tests. Passing tests is not a waiver.

## Durability and resource limits

- SQLite and image files do not share a power-loss transaction. Hard kills can leave
  orphans; `--check` reports them, but does not delete them. Back up stopped DB **and** images.
- Locks are advisory/local-filesystem only, not distributed locks. Use one server worker.
  External tools, aliases/hard links, network filesystems and different DBs sharing image
  folders are outside the ownership guarantee. Do not delete a `.db.lock` to bypass it.
- Favorites are filename-based: a quality upgrade/rebuilt archive can leave unmatched keys.
  Backups preserve them; automatic migration and account sync are not implemented.
- Native catalogs are capped at 100,000 rows / 32 MiB; transfers at 40 MiB per image;
  backups at 20,000 keys / 2 MiB. Originals/partials have a 256 MiB managed quota, exports 64 MiB,
  with free-disk checks/eviction and 24-hour stale cleanup. The display SDK cache is separate. Very long custom favorite
  keys may exceed the backup byte cap before the count cap.
- Streams are bounded where the platform exposes streaming/progress; fallback `text()`
  validation cannot prevent initial response buffering, and native cancellation may overshoot.
  Bounded native decoder validation is stronger than signatures, not proof against every codec/OS
  failure. Pins/revisions are per JS runtime and native locks process-local. Device interruption,
  headless/foreground races and low-memory tests remain.
- OS scheduling is best effort; intervals are minimums, not precise alarms. iOS cannot
  directly/automatically apply wallpaper through a public third-party API.

## Release gates and prioritized follow-up

1. **High:** triage remaining mobile advisories; signed Android/iOS builds; physical-device
   home/lock/both, photo permission/limited access, suspension, rotation, interruption and low-RAM tests.
2. **High:** real-library/LFS checks, backup restoration, live-source crawl/stop/resume;
   validate copyright/source terms, robots/rate rules and LFS storage/bandwidth budgets.
3. **High:** writable remote APIs require authenticated TLS reverse proxy/VPN and rate limits.
   Host/Origin checks are not authentication. Prefer an allow-listed static site for public browsing.
4. **Medium:** OS desktop tests (including Windows lock semantics), platform-specific Python
   dependency locks/SBOM and final aggregate SDK cache/codec behavior review on real devices.
5. **Later:** stable favorite identity/migration, smaller viewer previews, desktop rotation,
   duplicate review, localization and richer monitoring. See [ROADMAP.md](ROADMAP.md).

Deployment/rollback: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Design: [DESIGN.md](DESIGN.md).

## Native-focused 1.2 pass

Adds scoped permissions/networking, bounded managed caches, serialized image/native operations,
root scheduler/recovery, safe reset and startup watchdog, explicit failure/cancellation feedback,
offline privacy notice, and separate compiler/audit release gates. Kotlin/Swift compiler jobs are
configured but not executed in this sandbox. See [NATIVE_RELEASE.md](NATIVE_RELEASE.md) for
complete evidence, remaining blockers and device acceptance matrix; [PRIVACY.md](PRIVACY.md) for
publisher review. No signed binaries, credentials, real-device actions or store claims were produced.
