# Architecture

Spotlight Studio has three parts that share one SQLite database and one set of image files:

```
┌───────────────────────────── Browser / PyWebView window ─────────────────────────────┐
│  index.html + static/css/app.css + static/js/{core,app}.js        (one UI, two modes) │
│   web mode     : data/wallpapers.json  (static catalog, GitHub Pages)                 │
│   desktop mode : /api/catalog + /api/status  (+ crawler controls, "set wallpaper")    │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ HTTP (same origin)
┌───────────────────────────────────────▼──────────────────────────────────────────────┐
│ FastAPI app  (src/api.py, src/security.py)                                           │
│   Host check → Origin check → CORS (opt-in) → gzip → routes + static files            │
└───────────────┬──────────────────────────────────────────────┬───────────────────────┘
                │ start / pause / stop / snapshot              │ queries
┌───────────────▼───────────────────────────────┐   ┌──────────▼───────────────────────┐
│ DownloadEngine (src/engine.py) – own thread   │   │ SQLite, WAL (src/database.py)    │
│  asyncio loop                                 │   │  wallpapers · scrape_queue ·     │
│   scrape dispatcher ─► scrapers.py            │◄─►│  download_queue · suppressed_urls│
│   download dispatcher ─► downloader.py        │   │  · stats                         │
│   supervisor (progress, phase, completion)    │   └──────────────────────────────────┘
│  ThreadPoolExecutor: decode · dHash · thumb   │   ┌──────────────────────────────────┐
└───────────────────────────────────────────────┘   │ images/<source>/…  thumbs/…      │
                                                    │ data/wallpapers.json (catalog)   │
                                                    └──────────────────────────────────┘
```

## Modules

| Module | Responsibility |
|---|---|
| `main.py` | CLI: desktop window, `--server`, `--crawl`, `--check`, `--sync-catalog`; rotating logs; graceful uvicorn lifecycle; reuses an already running instance |
| `src/config.py` | typed, validated settings from the environment / `.env`; no side effects at import |
| `src/database.py` | connections, transactions, **schema migrations**, queues with claims, search/sort/pagination, catalog export, stats |
| `src/scrapers.py` | pure HTML parsers (Peapix cards, Win10 articles, post titles, pagination) + thin network wrappers + page-count discovery |
| `src/downloader.py` | streamed fetch with resolution fallback, one-job image analysis, insert-time de-duplication, atomic storage |
| `src/engine.py` | the crawl orchestrator and its state machine (`stopped → running ⇄ paused → stopping → stopped`) |
| `src/maintenance.py` | start-up tasks, whole-library dedupe sweep, thumbnail repair, `verify_library`, legacy layout migration |
| `src/hashing.py` | 256-bit difference hash, Hamming distance, chunk keys |
| `src/storage.py` | file naming, safe path joins, atomic writes, Git-LFS pointer detection |
| `src/api.py` / `src/security.py` | routes, response models, middleware (Host, Origin, CSP, headers) |
| `src/wallpaper.py` | set the desktop wallpaper (Windows API, macOS AppleScript, GNOME/Cinnamon/MATE/KDE tools) |
| `src/utils.py` | pure helpers: date/tag/title normalisation, CSV safety, quality scoring |

## A crawl, step by step

1. **Seed.** `full` mode asks each site for its real page count (`discover_total_pages`: pagination markers on page 1, then a gallop + binary search to find the last page that really exists) and queues every gallery page. `quick` mode queues only the newest `QUICK_UPDATE_PAGES`. A non-empty backlog from an interrupted run is *resumed* instead of re-seeded.
2. **Scrape.** The scrape dispatcher claims pages (highest priority first), fetches and parses them in a worker thread (`asyncio.to_thread`), drops URLs that are already known (downloaded, queued or suppressed) and queues the rest. Windows10Spotlight lists most posts under their *file hash*; for those the real title is fetched from the post page before queuing.
3. **Download.** *At the same time*, the download dispatcher claims queued images (FIFO) and runs `process_download`:
   fetch (streamed, size-capped) → **analyse** (decode + dHash + 480×270 thumbnail in a single thread-pool job) → de-duplicate → write image and thumbnail atomically → insert the row.
4. **Finish.** When both queues are empty and nothing is in flight, the engine runs a de-duplication sweep over the library, repairs missing thumbnails, exports `data/wallpapers.json`, stores a run summary in the `stats` table and returns to `stopped`.

### Modes

| | seeds | downloads | typical use |
|---|---|---|---|
| `quick` | newest N pages per site | only items queued *during this run* (an old backlog is left alone) | daily update |
| `full` | all pages (auto-detected) | everything queued, including a backlog | first run, completeness |
| `repair` | – (own work list) | none | back-fill titles/tags: Peapix gallery pages are re-read and merged by `page_url`; every Win10 wallpaper with a placeholder title gets its post page fetched |

## Concurrency model

* One **engine thread** owns an asyncio loop. Two *dispatchers* (not N polling workers) claim work and spawn tasks, bounded by semaphores (`CONCURRENT_SCRAPERS`, `CONCURRENT_DOWNLOADS`), so an idle engine polls the DB only a few times per second.
* CPU work (decode, hash, resize, JPEG encode, file writes) runs in a shared `ThreadPoolExecutor`. Doing decode+hash+thumbnail as **one** job means at most *pool-size* decoded 4K bitmaps (~25 MB each) exist at the same time, instead of one per in-flight download.
* **SQLite**: one connection per thread (WAL, `busy_timeout` 30 s), autocommit mode with explicit transactions. Nested `get_db()` blocks join the outermost transaction; write paths use `BEGIN IMMEDIATE` to avoid lock-upgrade failures. Streaming exports use their own connection because a generator may resume on another worker thread.
* `start/pause/stop/snapshot` are thread-safe; they signal the loop via `call_soon_threadsafe`.

## Reliability

| Failure | Behaviour |
|---|---|
| Stop, window closed, crash | queue rows are **claimed**, not deleted, while in flight. Stop releases them; a crash leaves `claimed_at` set and the next start releases all claims. Nothing is lost. |
| Transient HTTP error (timeout, 5xx, 429) | the item is retried up to `MAX_RETRIES`, each time **at the back** of the queue. A Peapix UHD download is *not* silently replaced by a lower resolution — except on the very last retry, so slow links still get an image. |
| Permanent error (404/403/410, corrupt image, too small, too large) | dropped immediately and counted as an error |
| Network down / site down | a **circuit breaker** opens after 10 consecutive transient failures, pauses dispatching with back-off (15 s → 120 s) and does *not* consume retries |
| Failure between writing files and the DB row | handled failures clean new files; the original survives. Hard kills can leave orphans (`--check` reports them). Atomic writes avoid publishing partial JPEGs. |
| Page count drift | discovery falls back to `max(configured hint, marker read from page 1)` and never trusts an implausible result (e.g. a site that serves its last page for every number) |
| Stale state after a kill | `reset_runtime_state()` at start-up resets `status`/`phase` and releases claims |

## De-duplication

* **Hash**: 256-bit dHash — greyscale, resize to 17×16 (Lanczos), compare horizontal neighbours → 64 hex characters. The implementation in `src/hashing.py` is bit-identical to `imagehash.dhash(img, hash_size=16)` (a test compares them), so existing hashes stay valid while NumPy/SciPy (~50 MB) are no longer required.
* **Near-duplicates**: Hamming distance ≤ 4 (1.6 % of the bits). By the pigeonhole principle two such hashes share at least four of their eight 32-bit chunks, so candidate rows are found with one indexed-style `SUBSTR` query instead of comparing all 7,500 hashes.
* **Policy**: score = `width × height × 1000 + file size`. If the existing copy is at least as good the new one is skipped (its URL is suppressed so it is never fetched again) and its tags/title are merged into the survivor; if the new one is better it replaces the old files and *inherits* the union of tags and the more informative title.
* **Concurrency**: downloads run in parallel, and the Peapix and Windows10Spotlight copies of one picture are often in flight together. The duplicate check, the file writes and the row insert are therefore a single critical section (a per-event-loop `asyncio.Lock` in `downloader.py`); fetching and the CPU-heavy decode/hash/thumbnail step stay parallel. Which copy reaches the store first is timing-dependent: the worse one is then skipped (*duplicate*) or stored and superseded (*replaced*), and the library ends up identical either way.
* A library-wide sweep (`maintenance.deduplicate_downloaded_wallpapers`) repeats this offline: rows are visited best-first so the best copy always survives.

## Storage

```
images/peapix/<sha256(bytes)>.jpg          full image          (content-addressed → immutable)
images/win10spotlight/<…>.jpg
images/thumbs/<source>/<same name>.jpg        480×270 progressive JPEG
data/wallpapers.db                            SQLite (committed in DELETE journal mode; -wal/-shm are git-ignored)
data/wallpapers.json                          slim public catalog (no perceptual hash)
```

Schema, catalog format and migration rules: [DATA.md](DATA.md).

## The UI

One client-side data path serves both modes: the whole catalog (~4 MB JSON, ~7,500 rows) is fetched once, turned into a view model by `core.js` and filtered, sorted and paginated **in the browser** — instant feedback, identical behaviour in the static showcase and the desktop app, and features such as favorites that no server could know about. In desktop mode `/api/status` carries a `library_signature`; when it changes the catalog is re-fetched (throttled while crawling) and the page re-renders only if its content changed. Details: [FRONTEND.md](FRONTEND.md).

## Measured performance

Library of 7,458 wallpapers; headless Chromium 153 against a local server (so network time is ~0); numbers are indicative, not a benchmark.

| | 2.1.0 | 2.2.0 |
|---|---|---|
| Catalog on the wire (gzip) | 1,114 KB | **801 KB** (raw 4.72 → 4.17 MB) |
| Catalog → view model in the browser | – | ≈ 130 ms cold (≈ 15 MB JS heap) |
| Search + sort over all items | server round-trip per keystroke | **≈ 5 ms**, in memory |
| `DOMContentLoaded` / first 24 cards visible | – | 75 ms / ≈ 0.8 s |
| App shell | 1 file, 108 KB (22 KB gzip) | 5 cacheable files, 136 KB (37 KB gzip) — more features, versioned URLs, only changed files are re-fetched |
| Server: build + serialise the catalog | – | ≈ 75 ms |
| Server: open + migrate + export (`init_db`) | – | ≈ 0.15 s |

Rendering costs were cut by removing `backdrop-filter` from every card, replacing the animated 140 px blur layers by a static gradient, and skipping off-screen cards with `content-visibility`.

## Design decisions

| Decision | Why |
|---|---|
| Claims instead of "pop = delete" | an interrupted run must never lose queued work |
| Content-pattern HTML parsers | the old class-name selectors silently lost every Peapix title and tag when the site changed its markup |
| Client-side search/filter | one code path, instant, works on a static host; the server API still offers search for other clients |
| Slim public catalog | the 256-bit hash was 12 % of the file and incompressible; the UI never needs it |
| Titles generated from tags for placeholders | 57 % of Windows10Spotlight titles are file hashes; the *Repair* mode fixes the data, the generated title makes the UI readable before that |
| Images via `github.com/<owner>/<repo>/blob/…?raw=true` on Pages | GitHub Pages cannot serve Git-LFS objects; the base is derived from the Pages URL so forks work |
| No ORM, plain SQL | a handful of tables, full control over transactions, trivial to read |
| Local-first security | the API has no authentication by design; it protects itself with Host/Origin checks instead — see [SECURITY.md](SECURITY.md) |

## 2.3 consistency refinements

The replacement storage job writes new files, then swaps the row/suppression records/counters
in one SQLite transaction, preserves the original public ID, and removes old files only after
commit. Cancellation drains this executor job while retaining the dedupe lock. This does not
make the filesystem and database one crash-atomic transaction; see [REVIEW.md](REVIEW.md).

`DownloadEngine.maintenance_guard()` reserves the idle engine across maintenance work so
concurrent starts and repairs receive `EngineBusy`. It is an in-process guard, not a lock
against another server or CLI process. Automatic Pillow concurrency is capped at four workers.
Catalog serialization uses a process-local mutex and a consistent SQLite read snapshot; ETags
hash the actual bytes. Public HTTP read-only mode is enforced in middleware, not only the UI.
