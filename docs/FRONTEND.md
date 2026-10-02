# Front-end

The UI is a dependency-free single-page app: **no framework, no bundler, no build step.**

```
index.html                 markup shell, CSP <meta>, version-stamped asset URLs
static/css/app.css         design tokens, components, responsive rules
static/js/theme-init.js    tiny blocking script: applies the saved theme before first paint
static/js/core.js          PURE logic (no DOM): catalog model, search, sort, paging, URL state, formatting
static/js/app.js           UI: DOM building, events, lightbox, crawler console, service worker
sw.js · manifest.webmanifest · static/icons/
tests/js/core.test.mjs     Node unit tests for core.js
```
The old 2,826-line `index.html` (CSS + HTML + JS inline) was split so that the browser can cache the parts separately, a strict CSP becomes possible, and the logic can be unit-tested.

## Modes

| | web | desktop |
|---|---|---|
| Where | GitHub Pages / any static host | served by the FastAPI backend (desktop window or `--server`) |
| Catalog | `data/wallpapers.json` | `/api/catalog` (live, ETag) |
| Images | `github.com/<owner>/<repo>/blob/main/images/…?raw=true` | `/images/…` |
| Crawler panel, *Set as wallpaper*, API docs link | hidden | shown (`body.is-desktop`) |
| Service worker | registered (offline shell) | **unregistered** and its caches deleted — the app is always online and must never be masked by a stale shell |

**Detection** (`detectMode` in `app.js`): `?app=web` forces web mode; non-`http(s)` pages and `*.github.io` hosts are web mode without any probing (the catalog download starts immediately); any other origin probes `/api/status` (1.8 s timeout) and switches to desktop mode if a Spotlight Studio backend answers. `?app=desktop` is accepted for backwards compatibility. Because of the probe, `python main.py --server` shows the crawler controls in a normal browser.

## State and URLs

The whole view is a small state object (`DEFAULT_STATE` in `core.js`), mirrored in the URL with `history.replaceState` so every view can be bookmarked or shared. Only non-default values are written.

| Parameter | Values | Default |
|---|---|---|
| `q` | search text (≤ 120 chars) | – |
| `source` | `peapix`, `win10spotlight` | all |
| `quality` | `4k`, `2k`, `fhd`, `hd`, `sd` | all |
| `tag` | an exact tag | – |
| `sort` | `newest`, `oldest`, `added`, `resolution`, `size`, `title`, `title-desc` | `newest` |
| `page` | integer ≥ 1 | `1` |
| `per` | `12`, `24`, `48`, `96` | `24` |
| `view` | `grid`, `list` | `grid` |
| `fav` | `1` | off |
| `app` | `web`, `desktop` | auto (kept in the URL when present) |
| `random` | `1` → open a random wallpaper on load (used by the PWA shortcut "Surprise me") | – |
| `#w=<id>` | opens that wallpaper in the viewer | – |

`decodeState` validates every value against allow-lists, so a malicious link can only select a legal view. Display preferences (`view`, `per`) are remembered in `localStorage` and overridden by the URL.

Browser storage: `spotlight:favorites` (list of filenames — stable across database rebuilds), `spotlight:prefs`, `spotlight:theme` (`auto|light|dark`, stored as a bare string because `theme-init.js` reads it before anything else), `spotlight:crawl` (last source/mode), `sessionStorage` `spotlight:lfs-dismissed`.

## Data model (`core.js`)

`buildCatalog(rows)` turns the raw catalog rows into **items** (the raw rows are never mutated — exports stay faithful):

`{ raw, id, key (filename), source, tags[], title, generated, placeholder, q (quality class), dateTs, addedTs, search }`

* **Search** — the query is split into folded terms (case and diacritics ignored: `galapagos` finds *Galápagos*); **all** terms must be substrings of `search` = non-placeholder title + tags + date + source name. Hashes never pollute the index.
* **Sorting** — one combined control. Unknown dates and placeholder titles always sort **last**, whichever direction; ties fall back to `id` so the order is stable.
* **Titles** — placeholders (file hashes, generic site names) get a *generated* title from the most informative tags: tags used by more than 12 % of the library (`nature`, `outdoors`…) are ignored, the three rarest remain, shown in their original order (`Chile · Mammal · Silhouette`), in italics. If no tag is left: `Spotlight wallpaper · Nov 27, 2018`.
* `filterAndSort` is memoised by `filterKey` (changing only the page, page size or view re-uses the sorted list).

## Rendering

* Cards are built with `createElement`/`textContent` (a tiny `h()` helper) and a single `replaceChildren`; the grid is **not rebuilt** when the visible page is identical (this matters while the crawler refreshes the catalog every few seconds).
* All events are delegated (`#gallery`, `#sidebar`, `#pagination`, …) — there are no inline handlers.
* Thumbnails: the first 8 load eagerly (4 with `fetchpriority=high`), the rest `loading=lazy`; `content-visibility: auto` skips off-screen cards. A missing thumbnail falls back to the full image once, then to a muted placeholder.
* Cards deliberately have **no `backdrop-filter`** and the ambient background has no animated blur layers — they were the biggest GPU costs of the previous design. Blur is used only on the top bar, sidebar, viewer panel and menus.

## Viewer (lightbox)

A native `<dialog>` (focus trap, `Esc`, inert background for free).

* **History-aware**: opening pushes `#w=<id>`; arrows replace it; **Back** closes the viewer; a deep link opens it on load; closing via `Esc` removes the hash.
* **Progressive**: the cached thumbnail is shown blurred instantly, the full image replaces it when loaded; the next/previous full images are preloaded.
* **Navigation crosses pages** — it walks the whole filtered list and keeps the gallery page in sync (applied when the viewer closes).
* Swipe left/right on touch screens, fullscreen (`Enter`), favorite, copy permalink / direct image URL, download (with a readable file name like `kirstenbosch-botanical-garden-1920x1080.jpg`; for cross-origin GitHub URLs the link opens in a new tab because browsers ignore `download` there).
* **Shuffle** picks from the *whole filtered result*, not only the visible page.

## Desktop crawler console

`applyStatus()` renders `/api/status`: state pill, phase, progress bar, counters of the **current run** (new / duplicates / errors), speed (the server computes the rolling rate — the old client-side meter spiked to thousands per second after every click), queue, pages left, last-run summary. Polling: 1.5 s while active, 4 s when idle, 8 s in a hidden tab. When `library_signature` changes the catalog is re-fetched (at most every 6 s while crawling) and the page re-renders only if its content changed. The *Start* button reads **Resume** while paused; switching the source while running switches live.

## Security rules for contributors

* **Never** assign scraped data to `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or an attribute that can carry script (`href` must pass `safeHttpUrl`). `ICONS` in `app.js` are the only strings fed to `innerHTML` — static constants.
* No inline `<script>`, `<style>`, `style=""` or `on…=` attributes: the CSP (`script-src 'self'; style-src 'self'`) blocks them. Setting `element.style.x` from JS is fine.
* Keep the CSP `<meta>` in `index.html` identical to `src/security.py::CONTENT_SECURITY_POLICY` (tested).

## Service worker (`sw.js`)

| Request | Strategy |
|---|---|
| shell: `index.html`, `static/**?v=…`, icons, manifest | pre-cached at install, **cache-first** (URLs are versioned) |
| `data/wallpapers.json` | **network-first**, last copy kept in `spotlight-data-v1` for offline use |
| navigations | network-first, one canonical cached `index.html` as the offline fallback (any `?query`/`#hash`) |
| `/api/*`, `/images/*`, `sw.js`, cross-origin (GitHub images) | not intercepted |

Old caches (`spotlight-shell-<other version>`, the 2.x `spotlight-studio-*`) are deleted on activation.

## Theming

CSS custom properties on `:root`; `[data-theme="light"]` overrides them. The theme button cycles *auto → light → dark*; `auto` follows `prefers-color-scheme` live. Text colours meet WCAG AA contrast on both themes.

## Accessibility

Skip link, landmarks (`header`, `nav`, `main`, `aside`, `footer`), real `<button>`s everywhere (cards are buttons, the favorite heart is a separate button), `aria-pressed` on toggles, `aria-live` for results/toasts/crawler phase, labelled controls, visible `:focus-visible` rings, a `<dialog>`-based viewer, `prefers-reduced-motion` support and a forced-colors fallback.

## Tests

`node --test tests/js/*.test.mjs` covers placeholder detection, folding/tokenising, formatting, catalog building and generated titles, all sort orders, every filter, the filter key (a regression test for a favorites-view bug), pagination and page-number lists, URL encode/decode (including hostile input), image URL derivation, safe URL checking, CSV injection, and a 7,500-item performance guard.
