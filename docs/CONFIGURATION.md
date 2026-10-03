# Configuration

Settings are read from environment variables and from a `.env` file in the project folder (copy [`.env.example`](../.env.example)). Command-line flags (`--host`, `--port`) override the file.

* Every setting is optional.
* **Invalid values never crash the app**: they log a warning and fall back to the default.
* Numbers are clamped to the range shown below.
* Relative paths are resolved against the project folder; absolute paths are used as they are.

## Server

| Variable | Default | Range | Description |
|---|---|---|---|
| `HOST` | `127.0.0.1` | – | Interface to bind. A non-loopback value (e.g. `0.0.0.0`) exposes the unauthenticated API to the network — read [SECURITY.md](SECURITY.md) first. |
| `PORT` | `8765` | 1–65535 | TCP port. |
| `ALLOWED_HOSTS` | *(empty)* | – | Comma separated `Host` header values the API answers to (DNS-rebinding protection); `*.lan` wildcards work. Empty = loopback names only, **or any host when `HOST` is not a loopback address**. |
| `CORS_ORIGINS` | *(empty)* | – | Extra browser origins allowed to call the API. Empty = same-origin only (the UI needs nothing else). |

## Paths

| Variable | Default | Description |
|---|---|---|
| `IMAGES_DIR` | `images` | Full images and `thumbs/`. |
| `DB_PATH` | `data/wallpapers.db` | SQLite database. |
| `LOG_PATH` | `data/downloader.log` | Rotating log file. |
| `CATALOG_PATH` | next to the database | The static catalog consumed by the GitHub Pages site (`wallpapers.json`). |

## Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`. |
| `LOG_MAX_BYTES` | `5242880` | Rotate the log at this size (min 65536). |
| `LOG_BACKUPS` | `3` | Rotated files to keep (0–50). |

## Concurrency

| Variable | Default | Range | Description |
|---|---|---|---|
| `CONCURRENT_DOWNLOADS` | `32` | 1–256 | Simultaneous image downloads. 64 is reasonable on 100+ Mbit/s lines. |
| `CONCURRENT_SCRAPERS` | `4` | 1–32 | Gallery pages scraped in parallel. |
| `MAX_CONNECTIONS` | `128` | 4–1024 | Open TCP connections in total. |
| `MAX_CONNECTIONS_PER_HOST` | `48` | 1–512 | Open connections per host. |
| `CPU_THREADS` | `0` | 0–128 | Threads for Pillow work. `0` = Python's default (`min(32, cpus + 4)`). |

## Reliability and politeness

| Variable | Default | Range | Description |
|---|---|---|---|
| `REQUEST_DELAY_SECONDS` | `0.1` | 0–60 | Pause after each scraped gallery page, per scraper. Raise it to be gentler with the source sites. |
| `MAX_RETRIES` | `3` | 0–20 | Attempts per page / image before giving up. |
| `REQUEST_TIMEOUT_SECONDS` | `30` | 3–600 | HTTP timeout. |
| `VERIFY_SSL` | `true` | bool | Verify TLS certificates. Only disable behind a broken corporate proxy. (The 2.1 engine disabled verification unconditionally.) |
| `MAX_IMAGE_BYTES` | `41943040` | ≥ 1 MiB | Hard cap for one download (40 MiB). |
| `MIN_IMAGE_WIDTH` | `320` | 1–8192 | Narrower images are rejected as junk. |
| `USER_AGENT` | a desktop Chrome string | – | HTTP `User-Agent` header. |

HTTP(S) proxies are honoured through the standard `HTTP_PROXY` / `HTTPS_PROXY` environment variables.

## Source sites

| Variable | Default | Range | Description |
|---|---|---|---|
| `PEAPIX_TOTAL_PAGES` | `30` | 1–100000 | *Hint* for the number of Peapix gallery pages. |
| `WIN10_TOTAL_PAGES` | `1320` | 1–100000 | *Hint* for the number of Windows10Spotlight pages. |
| `AUTO_DETECT_PAGES` | `true` | bool | Discover the real page counts before a full crawl (the sites grow daily). The hints are used as the fallback. |
| `QUICK_UPDATE_PAGES` | `3` | 1–100 | Pages per site scanned by a *quick update*. Windows10Spotlight lists 5 posts per page, so 3 pages cover about two weeks of new posts at its usual pace. |
| `PEAPIX_BASE_URL` | `https://peapix.com` | – | Change only for mirrors / tests. |
| `PEAPIX_IMAGE_BASE_URL` | `https://img.peapix.com` | – | Host of the Peapix image files. |
| `WIN10_BASE_URL` | `https://windows10spotlight.com` | – | Change only for mirrors / tests. |

## Front-end (static showcase) options

The GitHub Pages site needs no configuration. If you host the static files somewhere other than `<owner>.github.io/<repo>/`, tell it where the images are with a meta tag in `index.html`:

```html
<meta name="image-base" content="https://github.com/<owner>/<repo>/blob/<branch>" />
```

and extend the `img-src` directive of the Content-Security-Policy (the `<meta http-equiv>` tag in `index.html`, and `CONTENT_SECURITY_POLICY` in `src/security.py` for the desktop server) to allow that origin.
