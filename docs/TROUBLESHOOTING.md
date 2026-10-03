# Troubleshooting & FAQ

First stop for any problem: **`python main.py --check`** (database ⇄ files report) and the log file `data/downloader.log` (set `LOG_LEVEL=DEBUG` for detail).

## Images

### Every image is broken / the gallery shows empty pictures
The repository stores images in **Git LFS**. A clone made without LFS contains 130-byte *pointer files* named `*.jpg`. The desktop UI shows a banner ("Images are Git LFS pointers") and `--check` reports `lfs_pointer_count`.
```bash
git lfs install
git lfs pull
```
Restart the app afterwards. (`Set as wallpaper` answers `409` for pointer files.)

### The GitHub Pages site shows no images
* Pages cannot serve LFS files — the UI loads them via `github.com/<owner>/<repo>/blob/main/images/…?raw=true`. Check that the repository really contains the LFS objects (push with `git lfs` installed) and that your **LFS bandwidth/storage quota** is not exhausted (GitHub then answers with errors for every image).
* Forks: the owner/repo are derived from `<owner>.github.io/<repo>`. With a **custom domain** add `<meta name="image-base" content="https://github.com/<owner>/<repo>/blob/main">` to `index.html` and extend `img-src` in the CSP ([CONFIGURATION.md](CONFIGURATION.md#front-end-static-showcase-options)).
* Open the browser console: a blocked image reports a CSP violation if the origin is not allowed.

### Thumbnails are missing but the full images exist
`python main.py --check` shows `missing_thumbnails_count`; the crawler rebuilds them at the end of every complete run, or call `POST /api/maintenance/thumbnails`.

## Starting the app

### The window does not open / "WebView2 runtime not found"
PyWebView needs the Microsoft Edge **WebView2 runtime** (preinstalled on Windows 11 and current Windows 10). If the window cannot be created the app **falls back to your default browser** automatically. Install the [Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/) to get the native window. On Linux/macOS use `python main.py --server`.

### "Port 8765 is already used"
* If it is another Spotlight Studio instance, `python main.py` just opens a window for it.
* If another program owns the port, pick a different one: `python main.py --port 8788` or `PORT=8788` in `.env`.

### Browser shows `400 Invalid host header`
The API only answers to `127.0.0.1`, `localhost` and `[::1]` by default (DNS-rebinding protection). Open the app through one of those names. To serve it under another name, set `HOST=0.0.0.0` (after reading [SECURITY.md](SECURITY.md)) and/or `ALLOWED_HOSTS=my.name.lan`.

### `403 Cross-origin request blocked`
A state-changing request (`POST`) came from another origin. The bundled UI never does that; for a custom dashboard add its origin to `CORS_ORIGINS`.

### The Download / Export buttons do nothing in the desktop window
PyWebView blocks file downloads unless `webview.settings["ALLOW_DOWNLOADS"]` is enabled. Spotlight Studio ≥ 2.2 does that. Make sure `pywebview>=5.0` is installed (`pip install -U -r requirements.txt`).

## Crawling

### "Crawler started" but nothing new arrived
* *Quick update* only scans the newest pages (default 3 per site). For a complete re-scan use **Full crawl**.
* Items that are already known — or were suppressed as lower-quality duplicates — are skipped by design.
* Look at `Last run` in the sidebar (`+0 new` is a normal result) and at the log.

### Everything fails with timeouts / the status says "Waiting for network"
After 10 consecutive network failures the **circuit breaker** pauses the crawl for 15 s (doubling up to 2 min) without burning retries; it resumes by itself when the connection is back. On slow links lower the load:
```dotenv
CONCURRENT_DOWNLOADS=12
REQUEST_TIMEOUT_SECONDS=60
REQUEST_DELAY_SECONDS=0.5
```
Behind a proxy set `HTTPS_PROXY`. **SSL errors**: fix the certificate store or proxy; as a last resort `VERIFY_SSL=false` (insecure).

### A crawl found fewer pages than expected
`AUTO_DETECT_PAGES` probes the site's pagination; when the site misbehaves (blocked, rate-limited) the configured hints (`PEAPIX_TOTAL_PAGES`, `WIN10_TOTAL_PAGES`) are used. The log line `Discovered N gallery pages…` tells you what happened.

### Titles look like `dfffe373d9c78e79e0d6a28ac186d8c5`, or are just "Windows Spotlight"
These are *placeholder titles* stored by earlier versions. Run **Repair metadata** (Crawler panel, or `python main.py --crawl --mode repair`) once; new downloads get real titles automatically. Until then the UI shows a title generated from the tags (in italics).

### The sites changed their markup and parsing broke
The parsers rely on content patterns (links to `/spotlight/<id>`, `tag-*` classes, `srcset`…) and are covered by fixture tests in `tests/test_scrapers.py`. Add a fixture of the new markup, adjust `src/scrapers.py` and see [DEVELOPMENT.md](DEVELOPMENT.md).

## Desktop integration

### "Set as wallpaper" fails
| Message | Meaning |
|---|---|
| `501` / *not supported* | Windows, macOS, GNOME/Cinnamon/MATE and KDE Plasma are supported. Use *Download* and set it in your desktop's settings. |
| `409` Git LFS pointer | `git lfs pull` (see above) |
| macOS permission prompt | allow *Automation* control of "System Events" for your terminal / Python |
| Windows refuses | the image must exist on the machine running the server; check `data/downloader.log` |

## Data & database

### `database is locked`
The app uses SQLite in WAL mode with a 30 s busy timeout, so this indicates a *second* process holding a write lock (DB Browser for SQLite with pending changes, another running copy of the app). Close it. Never copy only the `-wal`/`-shm` files.

### I want to start from scratch
Stop the app, then delete `data/wallpapers.db` (and optionally `images/`). A new empty library is created on the next start. (`data/wallpapers.json` is regenerated.)

### `--check` reports orphan images / missing images
* *orphan* — a file without a database row: safe to delete.
* *missing image* — a row whose file is gone: re-run a *full crawl*, or delete the row.
* *duplicate pairs* — `POST /api/maintenance/dedupe` removes near-duplicates, keeping the best copy.

## The web UI

### I still see the old version after an update (static site)
The service worker serves versioned assets from its cache; a new version installs in the background and takes over on the next load. Force it: DevTools → Application → Service Workers → *Unregister*, or hard-refresh (Ctrl+F5). The catalog itself is always fetched network-first.

### Filters/pages from a shared link look different
URLs encode the filters (`?q=lake&source=peapix&sort=oldest&page=2`) and an opened wallpaper (`#w=<id>`). A wallpaper that was *replaced* by a better copy gets a new id, so old deep links may say "no longer in the catalog".

### Reset the browser-side data
`localStorage` keys: `spotlight:favorites`, `spotlight:prefs`, `spotlight:theme`, `spotlight:crawl`. Clear them from DevTools → Application → Local Storage.
