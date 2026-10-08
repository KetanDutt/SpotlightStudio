# Development guide

## Set-up

```bash
git clone https://github.com/KetanDutt/SpotlightStudio.git && cd SpotlightStudio     # `git lfs install` first if you want the images
python -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                    # runtime + pytest + httpx + ruff + imagehash (parity test)
cp .env.example .env                                   # optional
python main.py --server                                # http://127.0.0.1:8765/
```
`make help` lists shortcuts for Linux/macOS. The front-end unit tests need **Node ≥ 20**; prefer a maintained LTS. The Expo app in `mobile/`
requires its declared React Native-compatible Node range (Node **22.13+ LTS** recommended).
The web UI itself has no build step.

> **Do not run the app against the repository's own `data/` while testing changes** — the database and catalog are tracked in git and would be modified. Point `DB_PATH`, `IMAGES_DIR`, `CATALOG_PATH` and `LOG_PATH` at a scratch folder (the test-suite does this for you).

## Tests

| Command | What |
|---|---|
| `pytest` | 200+ Python tests, **fully offline** |
| `node --test tests/js/*.test.mjs` | unit tests of `static/js/core.js` (no dependencies) |
| `ruff check .` | lint (also CI) |
| `cd mobile && npm run verify` | the Expo app: `tsc --noEmit` + `eslint . --max-warnings 0` + Jest (see [MOBILE.md](MOBILE.md)) |
| `make check` | all of the above |

On Windows run the three commands directly. `node --test tests/js/*.test.mjs` works in PowerShell with Node ≥ 21 (which expands the glob itself); with Node 20 name the file instead: `node --test tests/js/core.test.mjs`.

The Python suite never touches the network or your data:

* `tests/conftest.py` — the `env` fixture points every setting at a temp folder and re-initialises the database; `site` additionally starts a **fake source site**.
* `tests/fake_site.py` — an aiohttp server that mimics Peapix and Windows10Spotlight: gallery pages with `Page n of N`, listings that show hashes as titles, post pages, deterministic synthetic JPEGs (the *same picture* at several resolutions to exercise cross-site de-duplication) and failure injection (`missing_uhd`, `flaky` 503s, `outage`, `corrupt`, `slow`, `page_delay`, `repeat_last`, `peapix_markup`).
* `test_engine.py` runs real crawls against it: overlap of scraping and downloading, quick/full/repair modes, stop & resume without loss, pause, outage + circuit breaker, retries and drops, source switching.
* `test_api.py` covers every endpoint plus the security behaviour (Host/Origin/CSP/CORS, CSV injection, traversal, `/data` exposure).
* `test_consistency.py` guards project-wide invariants: versions agree everywhere, the CSP meta equals the server policy, `index.html` has no inline script/style/handlers, every `$("id")` used by `app.js` exists, the service-worker precache list and manifest icons exist, every environment variable is documented, markdown links resolve.

### Testing the UI in a browser
The web client has no runtime framework dependency. Root `package.json` supplies
Playwright for real-browser tests: `npm ci`, `npx playwright install chromium`, then
`PYTHON=.venv/bin/python npm run test:browser`. The suite starts an isolated fixture
server and never writes to the real archive. Pure data behavior lives in `core.js`;
`app.js` also owns focus, history, dialog lifecycles and DOM/network integration.
See [DESIGN.md](DESIGN.md) for tokens and the visual regression checklist.

## Code map

See [ARCHITECTURE.md](ARCHITECTURE.md) for the modules and [FRONTEND.md](FRONTEND.md) for the UI. Conventions:

* Python ≥ 3.10, `from __future__ import annotations`, type hints on public functions, docstrings that explain *why*.
* **No import-time side effects** (no directories, no network, no threads): `settings.ensure_dirs()` and `startup_tasks()` are called explicitly.
* Read settings at call time (`settings.X`), never copy them into module constants — tests and `--host` rely on it.
* Database: use `get_db()` (never raw connections), `get_db(write=True)` for read-modify-write sequences, never nest a *different* connection inside a transaction, never build SQL from user input (see `_order_by`).
* UI: no `innerHTML` with data, no inline handlers/styles (CSP), pure logic goes into `core.js` with a test.

## Adding a source site

1. **Parser** in `src/scrapers.py`: `parse_<site>_page(html) -> list[dict]` returning `image_url, page_url, title, source, tags, date_spotted` (use `normalize_date`, `normalize_tags`; return `title=""` for placeholders). Keep it a *pure* function and rely on content patterns rather than class names.
2. Register it: constant `SOURCE_<X>`, `SOURCES`, `gallery_page_url`, `scrape_gallery_page`, and a page-count detector for `discover_total_pages`.
3. `src/database.py::KNOWN_SOURCES`, `src/storage.py` needs nothing (folders are created per source), `core.js` `SOURCES`/`SOURCE_LABELS` and the `source` options of the API/UI.
4. Tests: fixtures of the real markup in `test_scrapers.py` and a route in `tests/fake_site.py` for an engine test.

## Releasing

1. Update **`CHANGELOG.md`** (new `## [x.y.z] — date` section).
2. Bump the version in all of: `src/__init__.py`, `index.html` (`app-version` meta **and** the three `?v=` query strings), `sw.js` (`VERSION`), the README badge. `tests/test_consistency.py` fails if one is missed.
3. `make check`, then tag `vX.Y.Z`.
4. If you changed the schema, add the migration and its test first ([DATA.md](DATA.md#migrations)).

Regenerate the icons with `python scripts/make_icons.py` (Pillow only) — it writes both the
PWA icons in `static/icons/` and the Expo icons in `mobile/assets/`, so the two platforms can
never drift apart.

The mobile app is versioned independently of the Python package (`mobile/package.json`,
`mobile/app.json`); its own gate is `cd mobile && npm run verify`, run by CI as well.

## Style of commits and pull requests

Present-tense imperative subject (`Add retry back-off`), a body that explains *why*, tests with every behaviour change, docs updated for anything user-visible. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Browser smoke tests

Activate the Python virtualenv and install runtime requirements, then:

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

`playwright.config.cjs` starts `tests/browser/serve.py` on port 8877 with a temporary database
and synthetic images. It never writes the real library and does not require Git LFS. Stop
anything already using that port. Set `PYTHON` to your virtualenv interpreter if necessary
(`make browser` does this on POSIX). `CHROMIUM_PATH` optionally selects a preinstalled browser.
Failure traces are ignored under `test-results/`; CI uploads them for seven days. Root npm
packages are development-only, not gallery dependencies.

`node --test tests/js/*.test.mjs` includes favorites-validation and service-worker cache tests
without a browser installation. `make site` builds the allow-listed static artifact.

## Dependency hygiene

Upgrade pip/setuptools in new environments before installing/auditing dependencies.
Run `pip-audit --vulnerability-service pypi` with separately installed audit tooling, and
`npm audit` in both root and `mobile/`. Review advisories rather than forcing incompatible
Expo upgrades. Known outstanding findings are recorded in [REVIEW.md](REVIEW.md).

## New reliability contracts

- All API/CLI library lifecycles use `LibraryLock` before startup writes. Never unlink a
  sidecar, add a second server worker, or point an app factory at paths differing from
  process-wide storage. Set environment configuration before importing the app.
- Hash query expressions and schema-3 indexes must match exactly; query-plan regression
  guards prevent accidental full scans. Distance ≥8 deliberately scans all candidates.
- Web/mobile daily selection and portable favorites codecs have cross-client regressions.
  Daily identity is UTC date + catalog ID, not title/row order or local timezone.
- Preference functions return accurate synchronous results; keep writes serialized and
  avoid side effects inside React state updater functions. Preserve source cache provenance.
- Media operations stage before promotion, honor cancellation and suppress late UI actions;
  do not replace Save with Apply. Image headers are a cheap sanity check, not full validation.
- For native dependency changes, check `npx expo-modules-autolinking resolve --platform android`
  and `EXPO_OFFLINE=1 npx expo export --platform all`, **then** compile/test on real toolchains.
  Keep scoped dependency overrides justified by compatibility tests and current audit output.
- `scripts/build_site.py::PUBLIC_FILES` is an exact list; register new public assets explicitly.
  Never broaden it to publish entire source/data folders. Generated reports/builds remain ignored.


## Native release gates

The 1.2 native pass adds resolved-manifest checks (`npm run verify:config`), profile/audit
EAS hooks and `.github/workflows/mobile-native.yml` for Kotlin/Swift compilation. Keep those
separate from JS/Hermes export. `npm run verify:release` intentionally remains blocked by
inherited high-severity advisories; no automatic exception is granted. Use preview for device
QA, production for shipping only after [NATIVE_RELEASE.md](NATIVE_RELEASE.md) is complete.
