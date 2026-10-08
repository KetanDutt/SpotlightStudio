# Data formats

## Static catalog — `data/wallpapers.json`

A JSON **array** of objects, newest first (`downloaded_at DESC, id DESC`), written compactly and **deterministically** (an unchanged library produces a byte-identical file, so git diffs only show real changes). It is regenerated automatically after a crawl (and every 30 s while crawling), on `Pause`/`Stop`, at start-up, by `python main.py --sync-catalog` and by `POST /api/catalog/sync`.

| Field | Type | Notes |
|---|---|---|
| `id` | integer | database id; used by deep links (`#w=<id>`). Since 2.3, a quality replacement preserves the original id. |
| `filename` | string | relative path of the image: `peapix/<64 hex>.jpg` (legacy 32-hex paths remain valid); the thumbnail is `thumbs/<filename>` |
| `title` | string | may be a **placeholder** (a 32-character file hash or `Windows Spotlight`) — see below |
| `source` | string | `peapix` or `win10spotlight` |
| `source_url` | string | the original image URL that was downloaded |
| `page_url` | string | the post/detail page on the source site |
| `width`, `height`, `file_size` | integer | pixels / bytes of the stored original |
| `tags` | string | lower-case, unique, comma separated (`"lake,national park"`) |
| `date_spotted` | string | `YYYY-MM-DD`, or `""` when unknown |
| `downloaded_at` | string | ISO-8601 timestamp **with** UTC offset |
| `quality` | string | `4K / UHD`, `2K / QHD`, `FHD (1080p)`, `HD (720p)`, `SD` (derived from the width) |

The perceptual hash (`phash`) is deliberately **not** published: it made up 12 % of the file, does not compress, and the UI never needs it. `GET /api/export/*` and `GET /api/wallpapers` still include it.

### Placeholder titles

Windows10Spotlight lists most posts under their file name (`dfffe373d9c78e79e0d6a28ac186d8c5`) and the old Peapix parser fell back to the generic alt text `Windows Spotlight`. Both are *placeholders* (`is_placeholder_title` in `src/utils.py`, `isPlaceholderTitle` in `core.js` — the two implementations are kept identical).

* The crawler now fetches the **real title** from the post page before queuing a Windows10Spotlight image, and uses content-based Peapix parsing, so new wallpapers get proper titles and tags.
* For wallpapers stored earlier run **Repair metadata** (`python main.py --crawl --mode repair`).
* Until then the UI builds a readable title from the most informative tags (`Chile · Mammal · Silhouette`, shown in italics and flagged "Title generated from tags").

## Database — `data/wallpapers.db`

SQLite, WAL journal while the app runs (the committed file is in `DELETE` mode; `-wal`/`-shm` are git-ignored). The schema version is stored in `PRAGMA user_version` and upgraded automatically at start-up — **back up the stopped DB and images before any schema upgrade** (the app never downgrades).

### Tables

| Table | Columns (besides `id`) | Purpose |
|---|---|---|
| `wallpapers` | `phash` (unique), `filename`, `title`, `source`, `source_url`, `page_url`, `width`, `height`, `file_size`, `tags`, `date_spotted`, `downloaded_at`, `quality` | the library |
| `scrape_queue` | `url` (unique), `source`, `priority`, `added_at`, `retries`, `claimed_at` | gallery pages still to scrape (page 1 of a full crawl has priority 100) |
| `download_queue` | `image_url` (unique), `page_url`, `title`, `source`, `tags`, `date_spotted`, `added_at`, `retries`, `claimed_at` | images still to download |
| `suppressed_urls` | `url` (pk), `reason`, `created_at` | lower-quality duplicates that must never be fetched again |
| `stats` | `key` (pk), `value` | counters (`downloaded_count`, …), `status`/`phase`, `library_rev` (bumped on every wallpaper change; feeds the ETag), `last_run_*` |

`claimed_at` is set while a worker is on a row and cleared again when the work is given back; rows are deleted only when the work is *finished* (see [ARCHITECTURE.md](ARCHITECTURE.md#reliability)).

Indexes: `source`, `source_url`, `page_url`, `downloaded_at`, `date_spotted`, `quality`, `title COLLATE NOCASE` on `wallpapers`; `(claimed_at, id)` / `(source, claimed_at, id)` on `download_queue`; `(claimed_at, priority DESC, id)` / `(source, claimed_at, priority DESC, id)` on `scrape_queue`. (`phash` and `suppressed_urls.url` are covered by their unique/primary-key indexes.)

### Migrations

| Version | Changes |
|---|---|
| 1 | original schema (≤ 2.1.0) |
| 2 | `claimed_at` on both queues, `retries` on `scrape_queue`, new indexes, redundant indexes dropped; **data normalisation**: `date_spotted` → ISO, legacy quality labels (`FHD`, `UHD`) → canonical, naive timestamps → UTC-aware, tags → lower-case/unique. Unparseable dates are left untouched — nothing is ever discarded. |
| 3 | Eight `LOWER(SUBSTR(phash, …))` expression indexes for dHash candidate lookups; no wallpaper rows/files are rewritten. A newer unsupported schema is refused. |

Add a migration by writing `_migrate_to_vN(conn)`, registering it in `_MIGRATIONS` and bumping `SCHEMA_VERSION` in `src/database.py`; `tests/test_database.py::test_migration_from_v1_is_lossless_and_normalises` shows how to test it against a fixture of the old schema.

### Normalisation rules (applied on every insert)

| Field | Rule |
|---|---|
| `date_spotted` | `May 14, 2025`, `14 May 2025`, `2025/05/14`, ISO timestamps → `2025-05-14` (month names are parsed manually, independent of the OS locale) |
| `tags` | trim, collapse whitespace, lower-case, de-duplicate keeping order |
| `quality` | derived from the width: ≥3840 4K, ≥2560 2K, ≥1920 FHD, ≥1280 HD, else SD |
| `downloaded_at` | `datetime.now(UTC).isoformat()` |

## Images

* New names are content-addressed: `sha256(image_bytes)` (64 hex characters; legacy URL-derived paths are not renamed) + extension taken from the *decoded* format (`jpg`, `png`, `webp`). A file therefore never changes, which is what allows `Cache-Control: immutable`.
* Thumbnails: centre-cropped to 16:9, 480×270, progressive JPEG quality 82.
* Files are written to `*.part` and renamed, so a crash never leaves a truncated image.
* The repository tracks `images/**` with **Git LFS** (`.gitattributes`). Without LFS the files are 130-byte pointers; `python main.py --check` and the UI both report that.

## Portable browser/mobile favorites backup (version 1)

```json
{"format":"spotlight-favorites","version":1,"favorites":["peapix/example.jpg"]}
```

Exported from the browser More options menu or mobile Settings → Favorites backup. Import validates the entire document before
merging; existing favorites are never deleted. Relative keys must not contain traversal,
URL schemes, query/fragment delimiters or control characters. Unknown catalog keys survive
restore. At most 20,000 keys and a 2 MiB file are accepted. Image files and mobile preferences
are not included. This favorites format is interchangeable between browser and mobile. Catalog exports are different documents; they cannot be imported as favorites.

## Mobile private catalog cache (version 1)

`cache/spotlight-studio/wallpapers.json` is **not** the public catalog format. It wraps
`wallpapers` with `format: "spotlight-catalog"`, `version: 1`, `origin: "api" | "remote"`,
`source` (validated fetch URL), and `savedAt` (milliseconds since epoch). It is staged
before replacement, limited to 32 MiB / 100,000 rows and checked against build-time source
settings. An API cache must match the configured `/api/catalog` URL; a remote cache must
match the published catalog URL. Unknown/future envelopes are ignored, never interpreted
as the current format. Legacy plain-array caches are usable only without an API configured;
origin cannot be safely inferred from that array. Cache metadata is private to the device.
