# Deployment & operation

Spotlight Studio runs in two complementary ways:

1. **Static showcase** on GitHub Pages — free, zero maintenance, read-only.
2. **Desktop / server** — runs on your machine, crawls the source sites, maintains the library.

The usual workflow is: crawl locally → commit the new data → GitHub Pages republishes.

---

## 1. GitHub Pages

### What is published

The allow-listed build in `dist/site/` contains: `index.html`, `static/`, `sw.js`, `manifest.webmanifest` and `data/wallpapers.json`. The UI detects that no backend exists and runs in **web mode** (search, filters, favorites, downloads — no crawler controls).

### Set-up

1. Push the repository to GitHub (images must be pushed through **Git LFS**: `git lfs install` first).
2. **Settings → Pages → Build and deployment**: select **GitHub Actions**.
3. Run `.github/workflows/pages.yml` manually, or push a site/catalog change to `main`.
   The workflow runs `python scripts/build_site.py` and publishes only `dist/site/`.
4. After successful deployment the site is live at `https://<user>.github.io/<repository>/`.

**Do not publish the repository root.** Generic static hosts do not apply the FastAPI
file allow-list and can expose `data/wallpapers.db`, logs and source files. For other
static hosts run `python scripts/build_site.py` and upload only `dist/site/`.
The build intentionally excludes local images: the static UI uses GitHub LFS URLs.

### Images and Git LFS

GitHub Pages cannot serve Git-LFS objects (it would deliver the 130-byte pointer files). The static UI therefore loads every image through

```
https://github.com/<owner>/<repo>/blob/main/images/<thumbs/>…?raw=true
```

which GitHub redirects to the real LFS object. The `<owner>/<repo>` part is **derived from the Pages URL** (`<owner>.github.io/<repo>/`), so forks work without code changes. Other hosting (custom domain, other branch) → add `<meta name="image-base" content="https://github.com/<owner>/<repo>/blob/<branch>">` to `index.html` (and extend `img-src` of the CSP, see [CONFIGURATION.md](CONFIGURATION.md#front-end-static-showcase-options)).

Be aware that **LFS storage and bandwidth are quota-limited** on GitHub (the free plan is small; large libraries need a paid data pack). Thumbnails (~4 KB) are cheap; every *full-resolution* view or download costs 1–2 MB of bandwidth.

### Updating the published data

```bash
python main.py --crawl --mode quick      # or use the Crawler panel
git add data/wallpapers.db data/wallpapers.json images
git commit -m "Add new Spotlight wallpapers"
git push
```
The service worker uses *network-first* for the catalog, so visitors see new wallpapers on their next visit.

### Caching & PWA

* HTML and `data/wallpapers.json` are fetched network-first; CSS/JS carry a `?v=<version>` query and are cache-first; images are cached by the browser's HTTP cache.
* Users can install the site as an app; it keeps working **offline** (catalog and shell from the service worker cache; images only if the browser still has them).
* After releasing a new version, bump the version everywhere ([DEVELOPMENT.md](DEVELOPMENT.md#releasing)); a test fails when they disagree.

---

## 2. Running it yourself

| Goal | Command |
|---|---|
| Desktop window | `python main.py` (Windows: `start_desktop.bat`) |
| Server (browser UI) | `python main.py --server` (Windows: `start_server.bat`) → <http://127.0.0.1:8765/> |
| Update without UI | `python main.py --crawl --mode quick` (Windows: `start_update.bat`) |

If the port is already served by a Spotlight Studio instance, the desktop launcher simply opens a window for it; if another program owns the port you get a clear message.

### As a service (Linux)

```ini
# /etc/systemd/system/spotlight-studio.service
[Unit]
Description=Spotlight Studio
After=network-online.target

[Service]
User=spotlight
WorkingDirectory=/opt/SpotlightStudio
ExecStart=/opt/SpotlightStudio/.venv/bin/python main.py --server
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Set `READ_ONLY=true` for a publicly accessible browse-only gallery. This rejects all
HTTP mutations, not CLI updates or startup migrations. Use explicit `ALLOWED_HOSTS`.

Binding anything other than `127.0.0.1` exposes an **unauthenticated** API. Put it behind a reverse proxy with authentication, or restrict access with a firewall, and set `ALLOWED_HOSTS` to the names you use. Read [SECURITY.md](SECURITY.md).

---

## Automatic updates

**One writer process at a time.** Do not schedule a CLI crawl while the server (or another
crawl) is using the same database. Stop the server first, or invoke its control API through
your secured administrative channel. Multiple uvicorn workers are unsupported.

`--crawl` runs one crawl without any UI and exits (`0` = completed, `1` = failed, `130` = interrupted). A *quick* update takes seconds and is safe to run daily.

**Windows Task Scheduler**

1. `taskschd.msc` → *Create Basic Task…* → name `Spotlight Studio update`.
2. Trigger: *Daily* (e.g. 03:00).
3. Action: *Start a program* → Program: the full path of **`start_update.bat`**; *Start in*: the project folder.
4. Optional: tick *Run whether user is logged on or not*. Output goes to `data\downloader.log`.

**cron (Linux/macOS)**

```cron
15 3 * * *  cd /opt/SpotlightStudio && .venv/bin/python main.py --crawl --mode quick >> /dev/null 2>&1
```

**systemd timer** — a `oneshot` service running `main.py --crawl --mode quick` plus a `.timer` with `OnCalendar=daily`.

Run a *full* crawl (`--mode full`) occasionally, and *repair* (`--mode repair`) once after upgrading from 2.1 to back-fill titles and tags.

---

## Backups

* The library is `data/wallpapers.db` plus `images/`. Stop the app (or use `sqlite3 data/wallpapers.db ".backup backup.db"`) and copy the file. **Never copy `-wal`/`-shm` files on their own.**
* `data/wallpapers.json` is regenerated from the database at any time (`python main.py --sync-catalog`).

## Upgrading from 2.1.x

1. Back up `data/wallpapers.db`.
2. Pull the new version; `pip install -r requirements.txt` (the launchers do this automatically). `imagehash`, NumPy and SciPy are no longer needed and can be uninstalled.
3. Start the app: the database is upgraded to schema v2 automatically (dates, labels and timestamps are normalised; nothing is deleted).
4. Recommended once: **Repair metadata** to back-fill the missing Peapix titles/tags and the hash-like Windows10Spotlight titles.

Behavioural changes to be aware of:

| Area | 2.1 | 2.2 |
|---|---|---|
| `POST /api/control/start` default mode | – | `full` (unchanged behaviour); `quick` and `repair` are new |
| `POST /api/control/stop` | `status: "stopped"` | `status: "stopping"`, then `stopped` |
| `GET /api/wallpapers` bad `sort`/`order`/`quality` | silently ignored | `422` with the allowed values; `per_page` max is 200 |
| `/data/*` | whole folder (incl. DB and log!) | only `/data/wallpapers.json` |
| CORS | `*` | off (same-origin); opt in with `CORS_ORIGINS` |
| Static catalog | list incl. `phash`, mixed date formats | slim list, ISO dates |
| `templates/index.html`, `data/wallpapers.min.json` | present | removed |
| Browser UI in `--server` mode | no crawler controls (needed `?app=desktop`) | auto-detected |

## Production gates

See [REVIEW.md](REVIEW.md) for verified changes and remaining limitations, and
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for deployment, monitoring and rollback.
