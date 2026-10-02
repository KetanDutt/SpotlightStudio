# REST API

The backend serves the UI **and** a JSON API. Interactive OpenAPI documentation is built in:

* Swagger UI — `http://127.0.0.1:8765/api/docs`
* ReDoc — `http://127.0.0.1:8765/api/redoc`
* Schema — `http://127.0.0.1:8765/api/openapi.json`

> The API is designed for **local use**. It has no authentication; instead it answers only to known `Host` headers and refuses cross-origin state-changing requests (see [SECURITY.md](SECURITY.md)). Use `curl`, scripts or the bundled UI — a web page on another site cannot drive it.

Base URL: `http://127.0.0.1:8765` · All bodies are JSON (UTF-8) unless noted · Errors use FastAPI's `{"detail": …}` shape.

| Status | Meaning |
|---|---|
| `400` | invalid `Host` header (`Invalid host header`) or an invalid wallpaper path |
| `403` | cross-origin state-changing request blocked |
| `404` | wallpaper / image not found |
| `409` | conflict: the crawler is busy/shutting down, or the image is a Git-LFS pointer |
| `422` | invalid query parameter (the response lists the allowed values) |
| `501` | setting the wallpaper is not supported on this platform |

---

## System

### `GET /api/health`
Liveness probe.

```json
{
  "status": "healthy",
  "version": "2.2.0",
  "engine_status": "stopped",
  "library_count": 7458,
  "downloaded_count": 7458,
  "scrape_queue_size": 0,
  "download_queue_size": 0,
  "lfs_pointers_detected": false,
  "time": "2026-10-02T20:22:07.892228+00:00"
}
```
`lfs_pointers_detected` is `true` when the stored images are Git-LFS pointer files (the repository was cloned without `git lfs pull`).

### `GET /api/status`
Everything the UI polls: engine state, cumulative counters, the current run, queue sizes and per-source statistics.

```json
{
  "engine_status": "running",          // stopped | running | paused | stopping
  "active_source": "both",             // both | peapix | win10spotlight
  "mode": "quick",                     // quick | full | repair
  "phase": "Scraping & downloading",
  "progress_pct": 42,
  "rate_per_sec": 3.4,                 // wallpapers stored per second (10 s window)
  "breaker_active": false,             // true while waiting out a network outage
  "scraped_count": 7589, "downloaded_count": 7476,   // cumulative, all-time
  "duplicates_skipped": 17, "duplicates_replaced": 18, "errors": 0,
  "library_count": 7458,
  "library_signature": "12-7458",      // changes whenever any wallpaper row changes
  "scrape_queue_remaining": 0, "download_queue_remaining": 0,
  "run": { "mode": "quick", "pages_total": 6, "pages_done": 3, "items_total": 14, "items_done": 5,
           "downloaded": 4, "replaced": 0, "duplicates": 1, "errors": 0, "repaired": 0,
           "titles_enriched": 2, "elapsed_seconds": 8.2, "result": "" },
  "last_run": { "at": "2026-10-02T09:26:00+00:00", "mode": "full", "source": "both",
                "result": "completed", "downloaded": 14, "duplicates": 1, "errors": 0,
                "repaired": 0, "seconds": 41 },           // null before the first run
  "source_stats": { "total_available": 7458, "sources": {
      "peapix": { "available": 896, "queued": 0, "scrape_pages": 0, "total_discovered": 896, "pct_of_total": 12.0 },
      "win10spotlight": { "available": 6562, "queued": 0, "scrape_pages": 0, "total_discovered": 6562, "pct_of_total": 88.0 } } },
  "config": { "concurrent_downloads": 32, "concurrent_scrapers": 4, "max_connections": 128,
              "max_connections_per_host": 48, "quick_update_pages": 3 }
}
```

---

## Crawler control

### `POST /api/control/start`
Start a run, resume a paused one, or switch the source of a running one.

| Query | Values | Default | |
|---|---|---|---|
| `source` | `both`, `peapix`, `win10spotlight` | `both` | which site(s) |
| `mode` | `quick`, `full`, `repair` | `full` | see [ARCHITECTURE.md](ARCHITECTURE.md#modes) |

```bash
curl -X POST "http://127.0.0.1:8765/api/control/start?source=both&mode=quick"
```
```json
{ "action": "start", "result": "started", "status": "running", "active_source": "both", "mode": "quick" }
```
`result` is `started`, `resumed` (was paused) or `updated` (source switched while running). Returns `409` while the previous run is still shutting down.

### `POST /api/control/pause`
Stop dispatching new work; in-flight requests finish. `{"action":"pause","result":"paused","status":"paused",…}`

### `POST /api/control/stop`
Stop the run. Returns immediately with `status: "stopping"`; poll `/api/status` until it reads `stopped`. Unfinished work stays queued.

---

## Wallpapers

### `GET /api/wallpapers`
Paginated, filtered, **deterministically ordered** list (a unique tie-breaker keeps pages stable).

| Query | Type / values | Default | |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | |
| `per_page` | 1–200 | `48` | |
| `search` | text ≤ 200 | – | space separated terms; **all** must match title, a tag or the date (`2026-09` works) |
| `source` | `peapix`, `win10spotlight` | – | |
| `tag` | text | – | exact tag |
| `quality` | `4k`, `2k`, `fhd`, `hd`, `sd` | – | resolution class by width |
| `sort` | `downloaded_at`, `date_spotted`, `width`, `height`, `file_size`, `title` | `downloaded_at` | unknown dates always sort last; titles are case-insensitive |
| `order` | `ASC`, `DESC` | `DESC` | |

```bash
curl "http://127.0.0.1:8765/api/wallpapers?search=lavaredo&per_page=1"
```
```json
{
  "total": 9, "page": 1, "per_page": 1, "pages": 9,
  "wallpapers": [{
    "id": 7334,
    "phash": "788438c8739073987198149ce1a46cb46e3e0ee3490168396c31c5b2d9c658f3",
    "filename": "win10spotlight/8a88083e845a079cbd116cd65b7ad580.jpg",
    "title": "Three Peaks of Lavaredo (Tre Cime di Lavaredo), Dolomite Mountains, Italy",
    "source": "win10spotlight",
    "source_url": "https://windows10spotlight.com/wp-content/uploads/2026/10/105868f6….jpg",
    "page_url": "https://windows10spotlight.com/images/42141",
    "width": 1920, "height": 1080, "file_size": 561941,
    "tags": "clouds,italy,landmark,landscape,mountain range,mountains,nature,outdoors,…",
    "date_spotted": "2026-10-02",
    "downloaded_at": "2026-10-02T09:25:49.767033+00:00",
    "quality": "FHD (1080p)"
  }]
}
```

### `GET /api/wallpapers/random`
One random wallpaper; accepts `search`, `source`, `tag`, `quality`. `404` when nothing matches.

### `GET /api/wallpapers/{id}`
One wallpaper (same shape as above). `404` if unknown.

### `GET /api/wallpapers/{id}/image`
`302` redirect to `/images/<filename>`.
```bash
curl -L http://127.0.0.1:8765/api/wallpapers/7334/image -o wallpaper.jpg
```

### `GET /api/tags`
Most used tags: `?limit=50` (1–500), optional `source`.
```json
[{ "tag": "outdoors", "count": 5102 }, { "tag": "nature", "count": 4632 }]
```

### `POST /api/wallpapers/{id}/set-wallpaper`
Applies the image as the desktop background of the machine running the server — Windows (`SystemParametersInfoW`), macOS (AppleScript), GNOME/Cinnamon/MATE (`gsettings`), KDE (`plasma-apply-wallpaperimage`).
`200 {"success": true, "path": "…"}` · `404` unknown wallpaper or missing file · `409` the file is a Git-LFS pointer · `501` unsupported desktop · `400` the OS refused.

---

## Catalog & exports

### `GET /api/catalog`
The whole library as one compact JSON array (the **same shape as `data/wallpapers.json`**, i.e. without `phash`). It carries a weak `ETag` derived from the library signature and honours `If-None-Match` (`304`). This is what the UI loads in desktop mode. Compressed with gzip when the client accepts it.

### `GET /data/wallpapers.json`
The static catalog file. This is the **only** file of `data/` that is served — the database and the log never are.

### `POST /api/catalog/sync`
Regenerates `data/wallpapers.json` (it is only rewritten when the content changed).
```json
{ "success": true, "wallpapers_synced": 7458, "path": "data/wallpapers.json" }
```

### `GET /api/export/json` · `GET /api/export/csv`
Streamed downloads of **every column** of every row (constant memory). The CSV starts with a UTF-8 BOM (Excel friendly) and neutralises spreadsheet formulas: cells starting with `=`, `+`, `-` or `@` are prefixed with `'`.

---

## Maintenance

| Endpoint | |
|---|---|
| `GET /api/library/check` | read-only consistency report: missing images/thumbnails, orphan files, Git-LFS pointers, invalid hashes, duplicate pairs (`ok: true` when clean) |
| `POST /api/maintenance/dedupe` | sweep the library for near-duplicates → `{"removed": n}` |
| `POST /api/maintenance/thumbnails` | rebuild missing thumbnails → `{"created": n}` |

The two `POST` endpoints return `409` while the crawler is running.

---

## UI and static files

| Path | |
|---|---|
| `/` | `index.html` |
| `/static/*` | CSS, JS, icons (always revalidated) |
| `/images/*` | wallpapers and `thumbs/` (`Cache-Control: immutable` — file names are content-addressed) |
| `/sw.js`, `/manifest.webmanifest` | PWA files |

---

## Python example

```python
import requests

base = "http://127.0.0.1:8765"
requests.post(f"{base}/api/control/start", params={"mode": "quick"}).raise_for_status()
status = requests.get(f"{base}/api/status").json()
print(status["engine_status"], status["progress_pct"])

page = requests.get(f"{base}/api/wallpapers", params={"quality": "4k", "per_page": 5, "sort": "date_spotted"}).json()
for w in page["wallpapers"]:
    print(w["date_spotted"], w["title"], w["width"], "x", w["height"])
```
