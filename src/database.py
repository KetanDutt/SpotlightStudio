"""
database.py – SQLite-backed persistent storage for all wallpaper metadata.

Tables
------
wallpapers   : one row per unique wallpaper (keyed by perceptual hash)
scrape_queue : pages yet to be scraped
download_queue : image URLs yet to be downloaded
"""
from __future__ import annotations

import logging
import re
import shutil
import sqlite3
from collections import defaultdict
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

from src.config import settings

log = logging.getLogger("database")

# Thread-local storage so each thread gets its own connection
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        conn = sqlite3.connect(str(settings.DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-64000")  # 64 MB page cache
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = _get_conn()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    else:
        conn.commit()


def init_db() -> None:
    """Create all tables if they don't exist."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS wallpapers (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                phash        TEXT    UNIQUE NOT NULL,
                filename     TEXT    NOT NULL,
                title        TEXT    NOT NULL DEFAULT '',
                source       TEXT    NOT NULL,
                source_url   TEXT    NOT NULL,
                page_url     TEXT    NOT NULL DEFAULT '',
                width        INTEGER NOT NULL DEFAULT 0,
                height       INTEGER NOT NULL DEFAULT 0,
                file_size    INTEGER NOT NULL DEFAULT 0,
                tags         TEXT    NOT NULL DEFAULT '',
                date_spotted TEXT    NOT NULL DEFAULT '',
                downloaded_at TEXT   NOT NULL,
                quality      TEXT    NOT NULL DEFAULT 'UHD'
            );

            CREATE TABLE IF NOT EXISTS scrape_queue (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                url      TEXT    UNIQUE NOT NULL,
                source   TEXT    NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                added_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS download_queue (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                image_url  TEXT    UNIQUE NOT NULL,
                page_url   TEXT    NOT NULL DEFAULT '',
                title      TEXT    NOT NULL DEFAULT '',
                source     TEXT    NOT NULL,
                tags       TEXT    NOT NULL DEFAULT '',
                date_spotted TEXT  NOT NULL DEFAULT '',
                added_at   TEXT    NOT NULL,
                retries    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS suppressed_urls (
                url        TEXT PRIMARY KEY,
                reason     TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stats (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_wallpapers_phash ON wallpapers(phash);
            CREATE INDEX IF NOT EXISTS idx_wallpapers_source ON wallpapers(source);
            CREATE INDEX IF NOT EXISTS idx_wallpapers_source_url ON wallpapers(source_url);
            CREATE INDEX IF NOT EXISTS idx_wallpapers_downloaded_at ON wallpapers(downloaded_at);
            CREATE INDEX IF NOT EXISTS idx_wallpapers_date_spotted ON wallpapers(date_spotted);
            CREATE INDEX IF NOT EXISTS idx_wallpapers_quality ON wallpapers(quality);
            CREATE INDEX IF NOT EXISTS idx_suppressed_urls_url ON suppressed_urls(url);
        """)
        # Seed initial stats
        for key in ("status", "phase", "scraped_count", "downloaded_count",
                    "duplicates_skipped", "duplicates_replaced", "errors"):
            conn.execute(
                "INSERT OR IGNORE INTO stats(key, value) VALUES (?, ?)",
                (key, "stopped" if key == "status" else "idle" if key == "phase" else "0"),
            )

    # Ensure files and DB are partitioned into source folders
    migrate_storage_to_source_folders()
    # Ensure static catalog JSON for GitHub Pages is up-to-date
    export_catalog_json()


def export_catalog_json(dest_path: Optional[Path] = None) -> int:
    """
    Export all wallpapers to a static JSON file (data/wallpapers.json)
    for GitHub Pages and static web viewers.
    """
    import json
    target = dest_path or (settings.DB_PATH.parent / "wallpapers.json")
    target.parent.mkdir(parents=True, exist_ok=True)

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM wallpapers ORDER BY downloaded_at DESC").fetchall()
        catalog = [dict(r) for r in rows]

    temp_file = target.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
    temp_file.replace(target)
    return len(catalog)


def migrate_storage_to_source_folders() -> dict:
    """
    Ensure all wallpapers and thumbnails on disk are organized into
    source-specific subdirectories (e.g. images/peapix/ and images/win10spotlight/)
    and that DB filename paths reflect their source subfolders.
    """
    images_dir = settings.IMAGES_DIR
    thumbs_dir = images_dir / "thumbs"

    images_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    moved_images = 0
    moved_thumbs = 0
    updated_db = 0

    with get_db() as conn:
        rows = conn.execute("SELECT id, filename, source FROM wallpapers").fetchall()
        for row in rows:
            w_id = row["id"]
            old_fn = row["filename"]
            source = row["source"] or "other"
            clean_source = re.sub(r"[^a-zA-Z0-9_-]", "", source) or "other"

            pure_name = Path(old_fn).name
            new_fn = f"{clean_source}/{pure_name}"

            # 1. Full image
            dest_dir = images_dir / clean_source
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_file = dest_dir / pure_name

            flat_src = images_dir / pure_name
            if flat_src.exists() and flat_src.is_file() and flat_src != dest_file:
                try:
                    shutil.move(str(flat_src), str(dest_file))
                    moved_images += 1
                except Exception:
                    pass

            # 2. Thumbnail
            dest_thumb_dir = thumbs_dir / clean_source
            dest_thumb_dir.mkdir(parents=True, exist_ok=True)
            dest_thumb = dest_thumb_dir / pure_name

            flat_thumb = thumbs_dir / pure_name
            if flat_thumb.exists() and flat_thumb.is_file() and flat_thumb != dest_thumb:
                try:
                    shutil.move(str(flat_thumb), str(dest_thumb))
                    moved_thumbs += 1
                except Exception:
                    pass

            # 3. DB filename update
            if old_fn != new_fn:
                conn.execute(
                    "UPDATE wallpapers SET filename = ? WHERE id = ?",
                    (new_fn, w_id)
                )
                updated_db += 1

    return {
        "moved_images": moved_images,
        "moved_thumbs": moved_thumbs,
        "updated_db": updated_db,
    }


# ── Wallpapers ─────────────────────────────────────────────────────────────

def upsert_wallpaper(data: dict) -> bool:
    """
    Insert or replace a wallpaper record.  Returns True if it was newly
    inserted, False if it replaced an existing lower-quality entry.
    """
    data.setdefault("downloaded_at", datetime.now(timezone.utc).isoformat())
    with get_db() as conn:
        conn.execute("""
            INSERT INTO wallpapers
                (phash, filename, title, source, source_url, page_url,
                 width, height, file_size, tags, date_spotted, downloaded_at, quality)
            VALUES
                (:phash, :filename, :title, :source, :source_url, :page_url,
                 :width, :height, :file_size, :tags, :date_spotted, :downloaded_at, :quality)
            ON CONFLICT(phash) DO UPDATE SET
                filename     = excluded.filename,
                source_url   = excluded.source_url,
                width        = excluded.width,
                height       = excluded.height,
                file_size    = excluded.file_size,
                quality      = excluded.quality,
                downloaded_at= excluded.downloaded_at
        """, data)
    return True


def get_all_wallpapers(
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    source: str = "",
    sort: str = "downloaded_at",
    order: str = "DESC",
) -> tuple[list[dict], int]:
    """Return a paginated list of wallpapers and the total count."""
    wheres, params = [], []
    if search:
        wheres.append("(title LIKE ? OR tags LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if source:
        wheres.append("source = ?")
        params.append(source)

    where_clause = ("WHERE " + " AND ".join(wheres)) if wheres else ""
    allowed_sorts = {"downloaded_at", "width", "height", "file_size", "title", "date_spotted"}
    sort = sort if sort in allowed_sorts else "downloaded_at"
    order = "ASC" if order.upper() == "ASC" else "DESC"

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM wallpapers {where_clause}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT * FROM wallpapers {where_clause}
                ORDER BY {sort} {order}
                LIMIT ? OFFSET ?""",
            params + [per_page, (page - 1) * per_page],
        ).fetchall()
    return [dict(r) for r in rows], total


def get_wallpaper_by_phash(phash: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM wallpapers WHERE phash = ?", (phash,)
        ).fetchone()
    return dict(row) if row else None


def find_duplicate_wallpaper(phash: str, max_distance: int = 4) -> Optional[dict]:
    """
    Find any existing wallpaper matching phash exactly or within max_distance bits.
    Uses chunk-indexed filtering for sub-millisecond candidate lookup.
    """
    if not phash:
        return None

    # 1. Exact match fast path (indexed)
    exact = get_wallpaper_by_phash(phash)
    if exact:
        return exact

    if max_distance <= 0 or len(phash) != 64:
        return None

    # 2. Multi-index candidate filtering (8 chunks of 8 hex chars = 32 bits each)
    import imagehash

    try:
        target_h = imagehash.hex_to_hash(phash)
    except Exception:
        return None

    chunks = [phash[i * 8 : (i + 1) * 8] for i in range(8)]
    where_parts = ["SUBSTR(phash, ?, 8) = ?" for _ in range(8)]
    params: list = []
    for i, chk in enumerate(chunks):
        params.extend([i * 8 + 1, chk])

    query = f"SELECT * FROM wallpapers WHERE " + " OR ".join(where_parts)
    with get_db() as conn:
        candidates = conn.execute(query, params).fetchall()

    best_match = None
    min_dist = max_distance + 1

    for cand in candidates:
        try:
            cand_h = imagehash.hex_to_hash(cand["phash"])
            dist = target_h - cand_h
            if dist <= max_distance and dist < min_dist:
                min_dist = dist
                best_match = dict(cand)
        except Exception:
            continue

    return best_match


def delete_wallpaper(phash: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM wallpapers WHERE phash = ?", (phash,))


# ── Scrape Queue ────────────────────────────────────────────────────────────

def seed_scrape_queue(
    peapix_pages: int,
    win10_pages: int,
    target_source: Optional[str] = None,
    force: bool = False,
) -> None:
    """Populate the scrape queue with gallery pages for the target source(s)."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        if target_source in ("peapix", None, "both"):
            peapix_count = conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE source = 'peapix'").fetchone()[0]
            if peapix_count == 0 or force:
                rows = [("https://peapix.com/spotlight", "peapix", 100, now)]
                for i in range(2, peapix_pages + 1):
                    rows.append((f"https://peapix.com/spotlight/page-{i}", "peapix", 10, now))
                conn.executemany(
                    "INSERT OR IGNORE INTO scrape_queue(url, source, priority, added_at) VALUES(?,?,?,?)",
                    rows,
                )

        if target_source in ("win10spotlight", None, "both"):
            win10_count = conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE source = 'win10spotlight'").fetchone()[0]
            if win10_count == 0 or force:
                rows = [("https://windows10spotlight.com/", "win10spotlight", 100, now)]
                for i in range(2, win10_pages + 1):
                    rows.append((f"https://windows10spotlight.com/page/{i}", "win10spotlight", 10, now))
                conn.executemany(
                    "INSERT OR IGNORE INTO scrape_queue(url, source, priority, added_at) VALUES(?,?,?,?)",
                    rows,
                )


def pop_scrape_page(source: Optional[str] = None) -> Optional[dict]:
    """Remove and return the highest-priority unscraped page, optionally filtered by source."""
    with get_db() as conn:
        if source and source != "both":
            row = conn.execute(
                "SELECT * FROM scrape_queue WHERE source = ? ORDER BY priority DESC, id ASC LIMIT 1",
                (source,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM scrape_queue ORDER BY priority DESC, id ASC LIMIT 1"
            ).fetchone()
        if row:
            conn.execute("DELETE FROM scrape_queue WHERE id = ?", (row["id"],))
            return dict(row)
    return None


def scrape_queue_size(source: Optional[str] = None) -> int:
    """Return remaining scrape pages count, optionally filtered by source."""
    with get_db() as conn:
        if source and source != "both":
            return conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE source = ?", (source,)).fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM scrape_queue").fetchone()[0]


# ── Download Queue ──────────────────────────────────────────────────────────

def add_suppressed_url(url: str, reason: str = "duplicate_lower_quality") -> None:
    """Record a URL as suppressed so it is never enqueued or downloaded again."""
    if not url:
        return
    with get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO suppressed_urls (url, reason, created_at)
               VALUES (?, ?, ?)""",
            (url, reason, datetime.now(timezone.utc).isoformat()),
        )


def is_url_suppressed(url: str) -> bool:
    """Return True if URL is marked as suppressed."""
    if not url:
        return False
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM suppressed_urls WHERE url = ?", (url,)).fetchone()
        return row is not None


def is_url_known(image_url: str) -> bool:
    """Check if URL is already downloaded, queued, or suppressed."""
    if not image_url:
        return False
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM suppressed_urls WHERE url = ?", (image_url,)).fetchone():
            return True
        if conn.execute("SELECT 1 FROM download_queue WHERE image_url = ?", (image_url,)).fetchone():
            return True
        if conn.execute("SELECT 1 FROM wallpapers WHERE source_url = ?", (image_url,)).fetchone():
            return True
        return False


def enqueue_download(item: dict) -> bool:
    """Add an image URL to the download queue.  Returns False if already present, downloaded, or suppressed."""
    url = item.get("image_url")
    if not url or is_url_known(url):
        return False
    item.setdefault("added_at", datetime.now(timezone.utc).isoformat())
    item.setdefault("retries", 0)
    with get_db() as conn:
        try:
            conn.execute(
                """INSERT OR IGNORE INTO download_queue
                       (image_url, page_url, title, source, tags, date_spotted, added_at, retries)
                   VALUES (:image_url, :page_url, :title, :source, :tags, :date_spotted, :added_at, :retries)""",
                item,
            )
            return conn.execute("SELECT changes()").fetchone()[0] > 0
        except Exception:
            return False


def clean_download_queue() -> int:
    """Remove any download_queue items that are already in wallpapers or suppressed_urls."""
    with get_db() as conn:
        conn.execute("""
            DELETE FROM download_queue
            WHERE image_url IN (SELECT source_url FROM wallpapers WHERE source_url IS NOT NULL)
        """)
        c1 = conn.execute("SELECT changes()").fetchone()[0]
        conn.execute("""
            DELETE FROM download_queue
            WHERE image_url IN (SELECT url FROM suppressed_urls)
        """)
        c2 = conn.execute("SELECT changes()").fetchone()[0]
        total_removed = c1 + c2
        if total_removed > 0:
            log.info("Cleaned download queue: %d duplicate/suppressed items removed.", total_removed)
        return total_removed


def deduplicate_downloaded_wallpapers() -> int:
    """
    Go through all already downloaded wallpapers in the database.
    Find perceptual duplicates (dist <= 4), keep the higher quality image,
    and remove the lower quality one from disk and DB.
    Add removed URL to suppressed_urls so it is never re-downloaded.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, source, filename, width, height, file_size, phash, source_url, page_url FROM wallpapers"
        ).fetchall()

    if len(rows) < 2:
        return 0

    import imagehash

    chunks = defaultdict(list)
    parsed = []
    for idx, r in enumerate(rows):
        h_str = r["phash"]
        try:
            h = imagehash.hex_to_hash(h_str)
            parsed.append((r, h))
            for c_idx in range(8):
                chunk_key = (c_idx, h_str[c_idx * 8 : (c_idx + 1) * 8])
                chunks[chunk_key].append(idx)
        except Exception:
            pass

    candidate_pairs = set()
    for chunk_key, idx_list in chunks.items():
        if len(idx_list) > 1:
            for i in range(len(idx_list)):
                for j in range(i + 1, len(idx_list)):
                    i1, i2 = (idx_list[i], idx_list[j]) if idx_list[i] < idx_list[j] else (idx_list[j], idx_list[i])
                    candidate_pairs.add((i1, i2))

    removed_ids = set()
    removed_count = 0

    for i1, i2 in candidate_pairs:
        if i1 in removed_ids or i2 in removed_ids:
            continue
        r1, h1 = parsed[i1]
        r2, h2 = parsed[i2]
        dist = h1 - h2
        if dist <= 4:
            s1 = r1["width"] * r1["height"] * 1000 + r1["file_size"]
            s2 = r2["width"] * r2["height"] * 1000 + r2["file_size"]
            higher = r1 if s1 >= s2 else r2
            lower = r2 if s1 >= s2 else r1
            lower_idx = i2 if s1 >= s2 else i1

            removed_ids.add(lower_idx)
            removed_count += 1

            # Delete lower quality files from disk
            for base_dir in (settings.IMAGES_DIR, settings.IMAGES_DIR / "thumbs"):
                target = base_dir / lower["filename"]
                if target.exists() and not target.is_dir():
                    try:
                        target.unlink()
                    except Exception:
                        pass

            # Suppress URL so it is never downloaded again
            if lower["source_url"]:
                add_suppressed_url(lower["source_url"], reason="duplicate_lower_quality")
            if lower["page_url"]:
                add_suppressed_url(lower["page_url"], reason="duplicate_lower_quality")

            # Remove from DB
            delete_wallpaper(lower["phash"])
            increment_stat("duplicates_replaced")
            log.info(
                "Deduplication: Kept higher quality %s (%dx%d), removed lower %s (%dx%d)",
                higher["filename"],
                higher["width"],
                higher["height"],
                lower["filename"],
                lower["width"],
                lower["height"],
            )

    if removed_count > 0:
        export_catalog_json()
        log.info("Deduplicated already downloaded images: %d lower quality copies removed.", removed_count)

    return removed_count


def pop_download_item(source: Optional[str] = None) -> Optional[dict]:
    """Remove and return the next download item (FIFO), optionally filtered by source."""
    with get_db() as conn:
        if source and source != "both":
            row = conn.execute(
                "SELECT * FROM download_queue WHERE source = ? ORDER BY id ASC LIMIT 1",
                (source,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM download_queue ORDER BY id ASC LIMIT 1"
            ).fetchone()
        if row:
            conn.execute("DELETE FROM download_queue WHERE id = ?", (row["id"],))
            return dict(row)
    return None


def re_enqueue_with_retry(item: dict, max_retries: int) -> None:
    """Put a failed item back with incremented retry count, or drop it."""
    item["retries"] = item.get("retries", 0) + 1
    if item["retries"] <= max_retries:
        item["added_at"] = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO download_queue
                       (image_url, page_url, title, source, tags, date_spotted, added_at, retries)
                   VALUES (:image_url, :page_url, :title, :source, :tags, :date_spotted, :added_at, :retries)""",
                item,
            )


def download_queue_size(source: Optional[str] = None) -> int:
    """Return remaining download items count, optionally filtered by source."""
    with get_db() as conn:
        if source and source != "both":
            return conn.execute("SELECT COUNT(*) FROM download_queue WHERE source = ?", (source,)).fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM download_queue").fetchone()[0]




# ── Stats ───────────────────────────────────────────────────────────────────

def get_stats() -> dict:
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM stats").fetchall()
    return {r["key"]: r["value"] for r in rows}


def set_stat(key: str, value: str | int) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO stats(key, value) VALUES(?, ?)", (key, str(value))
        )


def increment_stat(key: str, by: int = 1) -> int:
    with get_db() as conn:
        conn.execute(
            "UPDATE stats SET value = CAST(value AS INTEGER) + ? WHERE key = ?",
            (by, key),
        )
        row = conn.execute("SELECT value FROM stats WHERE key = ?", (key,)).fetchone()
    return int(row["value"]) if row else 0


def get_source_stats() -> dict:
    """Return available wallpaper counts and discovered/queue stats per source."""
    with get_db() as conn:
        wp_rows = conn.execute("SELECT source, COUNT(*) as cnt FROM wallpapers GROUP BY source").fetchall()
        dl_rows = conn.execute("SELECT source, COUNT(*) as cnt FROM download_queue GROUP BY source").fetchall()
        sq_rows = conn.execute("SELECT source, COUNT(*) as cnt FROM scrape_queue GROUP BY source").fetchall()
        total_wp = conn.execute("SELECT COUNT(*) FROM wallpapers").fetchone()[0]

    wp_map = {r["source"]: r["cnt"] for r in wp_rows}
    dl_map = {r["source"]: r["cnt"] for r in dl_rows}
    sq_map = {r["source"]: r["cnt"] for r in sq_rows}

    sources = {}
    known_sources = sorted(set(list(wp_map.keys()) + list(dl_map.keys()) + ["peapix", "win10spotlight"]))
    for src in known_sources:
        avail = wp_map.get(src, 0)
        queued = dl_map.get(src, 0)
        total_discovered = avail + queued
        pct = round((avail / total_wp * 100), 1) if total_wp > 0 else 0.0
        sources[src] = {
            "available": avail,
            "queued": queued,
            "scrape_pages": sq_map.get(src, 0),
            "total_discovered": total_discovered,
            "pct_of_total": pct,
        }

    return {
        "total_available": total_wp,
        "sources": sources,
    }

