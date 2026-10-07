# Suggested improvements

Ideas still **not** implemented after 2.3.0 — either because they need decisions only the owner can make, access to real accounts/hardware, or simply more room than one release. Effort: **S** ≤ a day · **M** a few days · **L** a week or more.

Immediate release blockers and prioritized security work are in [REVIEW.md](REVIEW.md#release-blockers-and-prioritized-follow-up).

## High value, small effort

| Idea | Why | Effort |
|---|---|---|
| **Run "Repair metadata" once on the real library and commit the result** | 57 % of Windows10Spotlight titles are file hashes and every Peapix row lacks tags; the tooling is ready (`python main.py --crawl --mode repair`) but it needs the real sites. It makes search, tags and titles dramatically better for every visitor of the showcase. | S |
| **A scheduled GitHub Action that only *verifies* the catalog** (`--check`, JSON validity, link check) | catches broken pushes before they reach Pages without touching LFS quotas | S |
| **Preview tier for the viewer** — generate a ~1280 px WebP (≈ 100–150 KB) next to each full image and show *that* in the viewer; keep the original for *Download* | the viewer currently loads 1–2 MB per image from LFS; this cuts bandwidth by ~90 % and is the main lever against GitHub LFS quotas | M |
| **Daily "wallpaper of the day"** card on the home page (deterministic pick by date) | delight, no backend needed | S |
| **Colour palette per wallpaper** (3 dominant colours at download time, stored in the DB) and a *Browse by colour* filter | highly requested in wallpaper galleries; cheap with Pillow's `quantize` | M |

## Quality of the library

| Idea | Why | Effort |
|---|---|---|
| **Portrait / phone wallpapers** | every Windows10Spotlight post also has a 576×1024 variant that is ignored today | M |
| **Duplicate review screen** (side by side, "keep both") | the automatic policy is sound but some pairs are judgement calls; the distance can be derived from the stored hashes | M |
| **Additional sources** (Bing daily wallpaper, NASA APOD, Unsplash) via a small source-plugin interface | the scraper layer is already pure-parser + thin network wrapper | M–L |
| **FTS5 full-text index** for the server-side search | only matters if the library grows beyond ~100 k rows; today the UI searches in memory | M |
| **Verify downloads against the checksums Windows10Spotlight publishes** (`size`/`sha256` on post pages) | detect truncated or altered files | S |

## Desktop experience

| Idea | Why | Effort |
|---|---|---|
| **Wallpaper rotation** (change daily / hourly from favorites or a tag) with a system-tray icon | the natural next feature after "Set as wallpaper"; reuses `src/wallpaper.py` | M |
| **Multi-monitor and fit options** (fill/fit/span) for `set-wallpaper` | Windows exposes them via the registry/`IDesktopWallpaper` COM API | M |
| **Installer / single-file build** (PyInstaller or MSIX) with auto-update | removes the Python prerequisite for non-developers | L |
| **"Open images folder" / "Reveal in Explorer"** actions | tiny but loved | S |
| **Docker image** for headless NAS use | needs a decision about LFS and persistence | M |

## Operations & security

| Idea | Why | Effort |
|---|---|---|
| **Optional API token** (`API_TOKEN`) for LAN deployments, sent by the UI after a one-time prompt | closes the remaining gap of exposing the server beyond loopback without a reverse proxy | M |
| **Prometheus-style `/metrics`** | observability for long-running servers | S |
| **Per-host rate limiting** and `robots.txt` awareness | being a better citizen of the source sites | S–M |
| **Cursor-based pagination** in the API | stable paging while the crawler inserts rows | S |
| **Pin and lock dependencies** (`pip-compile`) in addition to ranges | reproducible builds | S |
| **Windows CI as a blocking job** | the CI workflow already runs the suite on Windows non-blocking; make it blocking once it has been green for a while | S |

## Front-end

| Idea | Why | Effort |
|---|---|---|
| **Virtualised grid / infinite scroll** option | pagination is fine at 24–96 per page; infinite scroll only pays off beyond that | M |
| **Image zoom / pan** in the viewer (pinch, wheel) | wallpapers are detailed | M |
| **Internationalisation** (the strings are already centralised in a few places) | wider audience | M |
| **Share targets**: Web Share API on mobile, "copy as markdown" | convenience | S |

## Deliberately out of scope

* **Re-hosting or redistributing images outside this repository's current model** — the wallpapers are third-party content.
* **Accounts, comments, uploads** — it is an archive, not a social site.
* **Tracking / analytics** — the privacy stance (no third-party requests) is a feature.
