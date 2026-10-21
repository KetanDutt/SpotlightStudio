# The packaged catalog

`roku/assets/catalog.json` is the channel's offline source of truth: the full
wallpaper archive, trimmed to the columns the TV client actually reads.

## Schema (7 475 rows)

| Field | Type | Used for |
|---|---|---|
| `id` | int | favourites, deep links, the Daily Spotlight |
| `filename` | string | `<source>/<hash>.jpg`; drives image and thumbnail URLs |
| `title` | string | cards, HUD copy, free-text search |
| `tags` | comma string | category / tag filtering and search |
| `date_spotted` | `YYYY-MM-DD` | metadata lines and the newest/oldest sort |
| `source` | string | the archive filter (`win10spotlight`, `peapix`) |
| `quality` | string | the 4K/FHD filter and the corner badge |

Rows are ordered by `id` descending (newest first), which is why the default
`newest` sort is a no-op fast path that returns the array by reference.

### Columns deliberately omitted

`width`, `height`, `file_size`, `source_url`, `page_url`, `downloaded_at` are
dropped by `scripts/build_roku_catalog.py`.  Dimensions are derived from
`quality` on device (`WallpaperDimensions()` in `utils.brs`), and the URL
columns were never read by any client.  The trim takes the payload from
**4.18 MB to 2.20 MB** — a 46 % cut in package size, ParseJson time and heap.

The JSON is serialised with `ensure_ascii=True`: BrightScript reads the file
with `ReadAsciiFile()`, which maps bytes to characters, so raw UTF-8 (a handful
of titles carry Romanian diacritics) would arrive as mojibake while `\uXXXX`
escapes are decoded correctly by `ParseJson()`.

## Regenerating

```bash
make roku-catalog          # rebuild from data/wallpapers.json
make roku-check            # CI also verifies the package is not stale
python3 scripts/build_roku_catalog.py --source data/wallpapers.json --dest roku/assets/catalog.json
```

`data/wallpapers.json` is the canonical export produced by
`src.database.export_catalog_json()`, so the TV, web, desktop and mobile
clients always agree.  Rows without a usable `id`/`filename` are dropped
instead of rendering broken cards.

## Images live in Git LFS, not in the package

The channel never ships image bytes.  `MakeImageUrl()` builds
`https://media.githubusercontent.com/media/KetanDutt/SpotlightStudio/main/images[/thumbs]/<filename>`.
`media.githubusercontent.com` (not `raw.githubusercontent.com`) is required
because the archive is Git-LFS: `raw` returns the 130-byte text pointer,
`media` returns the resolved JPEG.  Any custom base a user configures is
rewritten to the same CDN automatically.

Thumbnails (`images/thumbs/…`, 480×270, ~22 KB) back the grids; full frames
(`images/…`) back the viewer and Ambient Mode.  Both tiers are cached by
`image_loader.brs` (see [PERFORMANCE.md](PERFORMANCE.md)).
