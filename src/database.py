"""
database.py – SQLite-backed persistent storage for all wallpaper metadata.

Tables
------
wallpapers      one row per unique wallpaper (keyed by perceptual hash)
scrape_queue    gallery pages still to be scraped         (claim based)
download_queue  image URLs still to be downloaded         (claim based)
suppressed_urls URLs that must never be downloaded again (lower-quality duplicates)
stats           key/value operational counters

Concurrency model
-----------------
* One SQLite connection **per thread** (``threading.local``), WAL journal mode.
* Connections run in *autocommit* mode and :func:`get_db` opens explicit
  transactions.  Nested ``get_db()`` blocks join the outermost transaction, so
  an inner helper can never commit half of its caller's work.
* Streaming readers (exports) open their own short-lived connection because a
  generator may be resumed on a different worker thread.

Queue semantics (crash safety)
------------------------------
Items are **claimed** (``claimed_at`` set) instead of deleted when a worker
starts on them and only removed once the work finished.  If the application is
stopped or killed mid-flight the claims are released on the next start, so no
URL is ever lost.  (Before v2.2 popped items were deleted immediately.)

Schema versions (``PRAGMA user_version``)
-----------------------------------------
1  original schema
2  queue claims + retry counters, page_url / title indexes, normalised dates,
   canonical quality labels, tz-aware timestamps
3  expression indexes for the eight perceptual-hash chunks
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from collections import Counter
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

from src.config import settings
from src.hashing import CHUNK_HEX_LEN, CHUNKS, chunk_keys, hamming_hex, is_valid_phash
from src.utils import (
    atomic_write_bytes,
    canonical_quality,
    choose_title,
    escape_like,
    merge_tags,
    normalize_date,
    normalize_tags,
    normalize_timestamp,
    utcnow_iso,
)

log = logging.getLogger("database")

SCHEMA_VERSION = 3

#: Columns published in the static catalog / ``/api/catalog`` (everything except ``phash``).
CATALOG_FIELDS: tuple[str, ...] = (
    "id",
    "filename",
    "title",
    "source",
    "source_url",
    "page_url",
    "width",
    "height",
    "file_size",
    "tags",
    "date_spotted",
    "downloaded_at",
    "quality",
)

#: Sort keys accepted by :func:`get_all_wallpapers`.  User input never reaches the
#: query string – :func:`_order_by` maps it onto these constants.
ALLOWED_SORTS = ("downloaded_at", "date_spotted", "width", "height", "file_size", "title")

# Quality filter → width predicate (labels are derived from the width).
_QUALITY_SQL = {
    "4k": "width >= 3840",
    "2k": "width >= 2560 AND width < 3840",
    "fhd": "width >= 1920 AND width < 2560",
    "hd": "width >= 1280 AND width < 1920",
    "sd": "width < 1280",
}
ALLOWED_QUALITIES = tuple(_QUALITY_SQL)

_local = threading.local()
_export_lock = threading.Lock()


# ══════════════════════════════════════════════════════════════════════════
# Connection management
# ══════════════════════════════════════════════════════════════════════════


def _new_connection(path: Path | str | None = None) -> sqlite3.Connection:
    """Open a configured connection (autocommit; explicit transactions via get_db)."""
    target = Path(path) if path else settings.DB_PATH
    conn = sqlite3.connect(str(target), timeout=30, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-32000")  # 32 MB page cache per connection
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _get_conn() -> sqlite3.Connection:
    """Thread-local connection; transparently re-opened when ``DB_PATH`` changes."""
    path = str(settings.DB_PATH)
    conn = getattr(_local, "conn", None)
    if conn is None or getattr(_local, "path", None) != path:
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass
        settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = _new_connection()
        _local.conn = conn
        _local.path = path
        _local.depth = 0
    return conn


def close_connection() -> None:
    """Close the current thread's connection (used by tests and on shutdown)."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    _local.conn = None
    _local.path = None
    _local.depth = 0


@contextmanager
def get_db(write: bool = False):
    """
    Yield the thread's connection inside a transaction.

    * commits when the block succeeds, rolls back when it raises;
    * nested use joins the outermost transaction;
    * ``write=True`` takes the write lock up-front (``BEGIN IMMEDIATE``) which
      avoids ``SQLITE_BUSY`` upgrade failures for read-then-write sequences.
    """
    conn = _get_conn()
    depth = getattr(_local, "depth", 0)
    outermost = depth == 0
    if outermost:
        conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
    _local.depth = depth + 1
    try:
        yield conn
    except BaseException:
        if outermost and conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    else:
        if outermost and conn.in_transaction:
            conn.execute("COMMIT")
    finally:
        _local.depth = depth


@contextmanager
def read_connection() -> Iterator[sqlite3.Connection]:
    """A private connection for streaming queries (a generator may hop worker threads)."""
    with closing(_new_connection()) as conn:
        yield conn


# ══════════════════════════════════════════════════════════════════════════
# Schema & migrations
# ══════════════════════════════════════════════════════════════════════════

_BASELINE_SQL = """
CREATE TABLE IF NOT EXISTS wallpapers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    phash         TEXT    UNIQUE NOT NULL,
    filename      TEXT    NOT NULL,
    title         TEXT    NOT NULL DEFAULT '',
    source        TEXT    NOT NULL,
    source_url    TEXT    NOT NULL,
    page_url      TEXT    NOT NULL DEFAULT '',
    width         INTEGER NOT NULL DEFAULT 0,
    height        INTEGER NOT NULL DEFAULT 0,
    file_size     INTEGER NOT NULL DEFAULT 0,
    tags          TEXT    NOT NULL DEFAULT '',
    date_spotted  TEXT    NOT NULL DEFAULT '',
    downloaded_at TEXT    NOT NULL,
    quality       TEXT    NOT NULL DEFAULT 'UHD'
);

CREATE TABLE IF NOT EXISTS scrape_queue (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    url      TEXT    UNIQUE NOT NULL,
    source   TEXT    NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    added_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS download_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url    TEXT    UNIQUE NOT NULL,
    page_url     TEXT    NOT NULL DEFAULT '',
    title        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL,
    tags         TEXT    NOT NULL DEFAULT '',
    date_spotted TEXT    NOT NULL DEFAULT '',
    added_at     TEXT    NOT NULL,
    retries      INTEGER NOT NULL DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_wallpapers_source       ON wallpapers(source);
CREATE INDEX IF NOT EXISTS idx_wallpapers_source_url   ON wallpapers(source_url);
CREATE INDEX IF NOT EXISTS idx_wallpapers_downloaded_at ON wallpapers(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_wallpapers_date_spotted ON wallpapers(date_spotted);
CREATE INDEX IF NOT EXISTS idx_wallpapers_quality      ON wallpapers(quality);
"""

_COUNTER_STATS = (
    "scraped_count",
    "downloaded_count",
    "duplicates_skipped",
    "duplicates_replaced",
    "errors",
)


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    if column not in _table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    """Queue claims, retry counters, extra indexes and one-off data clean-up."""
    _add_column(conn, "scrape_queue", "retries", "INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "scrape_queue", "claimed_at", "TEXT")
    _add_column(conn, "download_queue", "claimed_at", "TEXT")

    # Redundant with the UNIQUE / PRIMARY KEY auto-indexes.
    conn.execute("DROP INDEX IF EXISTS idx_wallpapers_phash")
    conn.execute("DROP INDEX IF EXISTS idx_suppressed_urls_url")
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_wallpapers_page_url ON wallpapers(page_url)",
        "CREATE INDEX IF NOT EXISTS idx_wallpapers_title_nocase "
        "ON wallpapers(title COLLATE NOCASE)",
        "CREATE INDEX IF NOT EXISTS idx_dq_claim ON download_queue(claimed_at, id)",
        "CREATE INDEX IF NOT EXISTS idx_dq_source ON download_queue(source, claimed_at, id)",
        "CREATE INDEX IF NOT EXISTS idx_sq_claim ON scrape_queue(claimed_at, priority DESC, id)",
        "CREATE INDEX IF NOT EXISTS idx_sq_source "
        "ON scrape_queue(source, claimed_at, priority DESC, id)",
    ):
        conn.execute(stmt)

    # Normalise legacy values.  Unparseable dates are left untouched (never lose data).
    updates = []
    for row in conn.execute(
        "SELECT id, date_spotted, quality, width, downloaded_at, tags FROM wallpapers"
    ).fetchall():
        date = normalize_date(row["date_spotted"]) or row["date_spotted"]
        quality = canonical_quality(row["quality"], row["width"])
        stamp = normalize_timestamp(row["downloaded_at"])
        tags = normalize_tags(row["tags"])
        if (date, quality, stamp, tags) != (
            row["date_spotted"],
            row["quality"],
            row["downloaded_at"],
            row["tags"],
        ):
            updates.append((date, quality, stamp, tags, row["id"]))
    if updates:
        conn.executemany(
            "UPDATE wallpapers SET date_spotted=?, quality=?, downloaded_at=?, tags=? WHERE id=?",
            updates,
        )
        log.info("Migration v2: normalised %d wallpaper rows.", len(updates))


# Fixed SQL expressions must match the predicates verbatim for SQLite to use
# expression indexes. Binding the SUBSTR offsets as query parameters forces a scan.
_HASH_CHUNKS_SQL = tuple(
    f"LOWER(SUBSTR(phash, {i * CHUNK_HEX_LEN + 1}, {CHUNK_HEX_LEN}))" for i in range(CHUNKS)
)


def _migrate_to_v3(conn: sqlite3.Connection) -> None:
    """Index candidates, not whole-image distances; no wallpaper data is rewritten."""
    for i, expression in enumerate(_HASH_CHUNKS_SQL):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_wallpapers_hash_{i} "
                     f"ON wallpapers({expression})")


_MIGRATIONS = {2: _migrate_to_v2, 3: _migrate_to_v3}


def init_db() -> None:
    """Create / upgrade the schema.  Safe to call repeatedly and from any thread."""
    settings.ensure_dirs()
    conn = _get_conn()
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current > SCHEMA_VERSION:
        raise RuntimeError(
            f"Database schema v{current} is newer than supported v{SCHEMA_VERSION}. "
            "Use a compatible app version or restore a pre-upgrade backup."
        )
    conn.executescript(_BASELINE_SQL)  # IF NOT EXISTS → no-op on existing databases
    for version in range(current + 1, SCHEMA_VERSION + 1):
        migrate = _MIGRATIONS.get(version)
        with get_db(write=True) as tx:
            if migrate:
                migrate(tx)
            tx.execute(f"PRAGMA user_version = {version}")
        log.info("Database schema upgraded to v%d.", version)

    with get_db(write=True) as tx:
        for key in _COUNTER_STATS:
            tx.execute("INSERT OR IGNORE INTO stats(key, value) VALUES (?, '0')", (key,))
        tx.execute("INSERT OR IGNORE INTO stats(key, value) VALUES ('status', 'stopped')")
        tx.execute("INSERT OR IGNORE INTO stats(key, value) VALUES ('phase', 'Idle')")
        tx.execute("INSERT OR IGNORE INTO stats(key, value) VALUES ('library_rev', '0')")


def reset_runtime_state() -> None:
    """
    Called once at process start: whatever a previous (killed) process left
    behind – ``status=running``, claimed queue rows – is stale.
    """
    with get_db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO stats(key, value) VALUES ('status', 'stopped')")
        conn.execute("INSERT OR REPLACE INTO stats(key, value) VALUES ('phase', 'Idle')")
        conn.execute("UPDATE scrape_queue SET claimed_at = NULL WHERE claimed_at IS NOT NULL")
        conn.execute("UPDATE download_queue SET claimed_at = NULL WHERE claimed_at IS NOT NULL")


# ══════════════════════════════════════════════════════════════════════════
# Change tracking & catalog export
# ══════════════════════════════════════════════════════════════════════════


def _bump_rev(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO stats(key, value) VALUES ('library_rev', '1') "
        "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
    )


def library_signature() -> str:
    """Cheap identifier that changes whenever any wallpaper row changes (ETag source)."""
    with get_db() as conn:
        rev = conn.execute("SELECT value FROM stats WHERE key = 'library_rev'").fetchone()
        count = conn.execute("SELECT COUNT(*) FROM wallpapers").fetchone()[0]
    return f"{rev[0] if rev else 0}-{count}"


def build_catalog() -> tuple[bytes, int]:
    """
    Serialise the public catalog (newest first, without the internal ``phash``).

    Returns ``(utf-8 json bytes, item count)``.  The output is deterministic –
    ``ORDER BY downloaded_at DESC, id DESC`` – so an unchanged library produces a
    byte-identical file and no spurious git diff.
    """
    cols = ", ".join(CATALOG_FIELDS)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT {cols} FROM wallpapers ORDER BY downloaded_at DESC, id DESC"
        ).fetchall()
    items = [dict(zip(CATALOG_FIELDS, tuple(r), strict=True)) for r in rows]
    payload = json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return payload, len(items)


def export_catalog_json(dest_path: Path | None = None) -> int:
    """
    Write the static catalog used by the GitHub-Pages showcase.

    The file is only rewritten when its content actually changed.  Returns the
    number of wallpapers in the catalog.
    """
    target = Path(dest_path) if dest_path else settings.CATALOG_PATH
    with _export_lock:
        payload, count = build_catalog()
        try:
            if target.exists() and target.stat().st_size == len(payload):
                if target.read_bytes() == payload:
                    return count
        except OSError:
            pass
        atomic_write_bytes(target, payload)
    return count


# ══════════════════════════════════════════════════════════════════════════
# Wallpapers
# ══════════════════════════════════════════════════════════════════════════


def upsert_wallpaper(data: dict[str, Any]) -> bool:
    """
    Insert a wallpaper, or refresh the file-related columns of an existing one
    with the same perceptual hash.  Returns ``True`` if a new row was created.
    """
    record = dict(data)
    record.setdefault("downloaded_at", utcnow_iso())
    record["date_spotted"] = normalize_date(record.get("date_spotted")) or (
        record.get("date_spotted") or ""
    )
    record["tags"] = normalize_tags(record.get("tags"))
    record["quality"] = canonical_quality(record.get("quality"), int(record.get("width") or 0))
    for key, default in (("title", ""), ("page_url", ""), ("width", 0), ("height", 0),
                         ("file_size", 0)):
        record.setdefault(key, default)

    with get_db(write=True) as conn:
        existed = conn.execute(
            "SELECT 1 FROM wallpapers WHERE phash = ?", (record["phash"],)
        ).fetchone()
        conn.execute(
            """
            INSERT INTO wallpapers
                (phash, filename, title, source, source_url, page_url,
                 width, height, file_size, tags, date_spotted, downloaded_at, quality)
            VALUES
                (:phash, :filename, :title, :source, :source_url, :page_url,
                 :width, :height, :file_size, :tags, :date_spotted, :downloaded_at, :quality)
            ON CONFLICT(phash) DO UPDATE SET
                filename      = excluded.filename,
                source_url    = excluded.source_url,
                width         = excluded.width,
                height        = excluded.height,
                file_size     = excluded.file_size,
                quality       = excluded.quality,
                downloaded_at = excluded.downloaded_at
            """,
            record,
        )
        _bump_rev(conn)
    return existed is None


def _search_terms(search: str, limit: int = 8) -> list[str]:
    return [t for t in (search or "").lower().split() if t][:limit]


def _build_filters(
    search: str = "", source: str = "", tag: str = "", quality: str = ""
) -> tuple[str, list[Any]]:
    wheres: list[str] = []
    params: list[Any] = []
    for term in _search_terms(search):
        like = f"%{escape_like(term)}%"
        wheres.append(
            "(title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' "
            "OR date_spotted LIKE ? ESCAPE '\\')"
        )
        params.extend([like, like, like])
    if source:
        wheres.append("source = ?")
        params.append(source)
    if tag:
        wheres.append("(',' || tags || ',') LIKE ? ESCAPE '\\'")
        params.append(f"%,{escape_like(tag.strip().lower())},%")
    if quality and quality.lower() in _QUALITY_SQL:
        wheres.append(f"({_QUALITY_SQL[quality.lower()]})")
    return (("WHERE " + " AND ".join(wheres)) if wheres else ""), params


def get_all_wallpapers(
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    source: str = "",
    sort: str = "downloaded_at",
    order: str = "DESC",
    tag: str = "",
    quality: str = "",
) -> tuple[list[dict], int]:
    """
    Paginated, filtered, *deterministically ordered* wallpaper list.

    ``search`` is tokenised: every whitespace separated term must match the
    title, a tag or the date (AND semantics).  A unique ``id`` tie-breaker is
    always appended so pages never overlap or skip rows.
    """
    where_clause, params = _build_filters(search, source, tag, quality)
    order_by = _order_by(sort, order)
    page = max(1, int(page))
    per_page = max(1, int(per_page))

    with get_db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM wallpapers {where_clause}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM wallpapers {where_clause} "
            f"ORDER BY {order_by} LIMIT ? OFFSET ?",
            [*params, per_page, (page - 1) * per_page],
        ).fetchall()
    return [dict(r) for r in rows], total


def _order_by(sort: str, order: str) -> str:
    """
    Build a safe, deterministic ``ORDER BY`` clause body.

    Rows whose ``date_spotted`` is unknown always sort last (in both directions)
    and the unique ``id`` is the final tie-breaker so pagination is stable.
    """
    direction = "ASC" if str(order).upper() == "ASC" else "DESC"
    if sort == "date_spotted":
        return f"(date_spotted = '') ASC, date_spotted {direction}, id {direction}"
    if sort == "title":
        return f"title COLLATE NOCASE {direction}, id {direction}"
    column = sort if sort in ALLOWED_SORTS else "downloaded_at"
    return f"{column} {direction}, id {direction}"


def get_wallpaper(wallpaper_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM wallpapers WHERE id = ?", (wallpaper_id,)).fetchone()
    return dict(row) if row else None


def get_wallpaper_by_phash(phash: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM wallpapers WHERE phash = ?", (phash,)).fetchone()
    return dict(row) if row else None


def get_wallpaper_by_page_url(page_url: str) -> dict | None:
    if not page_url:
        return None
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM wallpapers WHERE page_url = ? LIMIT 1", (page_url,)
        ).fetchone()
    return dict(row) if row else None


def get_random_wallpaper(
    search: str = "", source: str = "", tag: str = "", quality: str = ""
) -> dict | None:
    where_clause, params = _build_filters(search, source, tag, quality)
    with get_db() as conn:
        row = conn.execute(
            f"SELECT * FROM wallpapers {where_clause} ORDER BY RANDOM() LIMIT 1", params
        ).fetchone()
    return dict(row) if row else None


def count_wallpapers(source: str = "") -> int:
    with get_db() as conn:
        if source:
            return conn.execute(
                "SELECT COUNT(*) FROM wallpapers WHERE source = ?", (source,)
            ).fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM wallpapers").fetchone()[0]


def iter_wallpapers(batch_size: int = 500, fields: tuple[str, ...] | None = None) -> Iterator[dict]:
    """Stream every wallpaper (id order) using a private read-only connection."""
    cols = ", ".join(fields) if fields else "*"
    with read_connection() as conn:
        cursor = conn.execute(f"SELECT {cols} FROM wallpapers ORDER BY id")
        while True:
            rows = cursor.fetchmany(batch_size)
            if not rows:
                return
            for row in rows:
                yield dict(row)


def get_tag_counts(source: str = "") -> Counter:
    """Frequency of every tag (optionally restricted to one source)."""
    counts: Counter = Counter()
    with get_db() as conn:
        if source:
            cursor = conn.execute("SELECT tags FROM wallpapers WHERE source = ?", (source,))
        else:
            cursor = conn.execute("SELECT tags FROM wallpapers")
        for (tags,) in cursor:
            if tags:
                counts.update(t for t in tags.split(",") if t)
    return counts


def find_duplicate_wallpaper(phash: str, max_distance: int = 4) -> dict | None:
    """
    Closest existing wallpaper whose hash is within ``max_distance`` bits.

    Candidate selection uses the pigeonhole principle: with 8 chunks, any two
    hashes at distance ≤ 7 share at least one identical chunk, so comparing
    chunks first avoids computing 7 000+ full distances.
    """
    if not phash:
        return None
    exact = get_wallpaper_by_phash(phash)
    if exact:
        return exact
    if max_distance < 0 or not is_valid_phash(phash):
        return None

    # At distance >= CHUNKS two hashes need not share a chunk. Fall back to a
    # full scan rather than silently missing duplicates for a wider review radius.
    clauses = " OR ".join(f"{expression} = ?" for expression in _HASH_CHUNKS_SQL)
    with get_db() as conn:
        if max_distance < CHUNKS:
            candidates = conn.execute(
                f"SELECT * FROM wallpapers WHERE {clauses} ORDER BY id", chunk_keys(phash)
            ).fetchall()
        else:
            candidates = conn.execute("SELECT * FROM wallpapers ORDER BY id").fetchall()

    best: dict | None = None
    best_distance = max_distance + 1
    for cand in candidates:
        try:
            distance = hamming_hex(phash, cand["phash"])
        except ValueError:
            continue
        if distance < best_distance:
            best, best_distance = dict(cand), distance
    return best


def delete_wallpaper(phash: str) -> None:
    with get_db(write=True) as conn:
        conn.execute("DELETE FROM wallpapers WHERE phash = ?", (phash,))
        _bump_rev(conn)


def delete_wallpaper_by_id(wallpaper_id: int) -> None:
    with get_db(write=True) as conn:
        conn.execute("DELETE FROM wallpapers WHERE id = ?", (wallpaper_id,))
        _bump_rev(conn)


def update_wallpaper_metadata(
    wallpaper_id: int,
    *,
    title: str | None = None,
    tags: str | None = None,
    date_spotted: str | None = None,
) -> bool:
    """Overwrite the provided descriptive fields.  Returns True when a row changed."""
    sets, params = [], []
    if title is not None:
        sets.append("title = ?")
        params.append(title.strip())
    if tags is not None:
        sets.append("tags = ?")
        params.append(normalize_tags(tags))
    if date_spotted is not None:
        sets.append("date_spotted = ?")
        params.append(normalize_date(date_spotted) or date_spotted)
    if not sets:
        return False
    with get_db(write=True) as conn:
        cursor = conn.execute(
            f"UPDATE wallpapers SET {', '.join(sets)} WHERE id = ?", [*params, wallpaper_id]
        )
        changed = cursor.rowcount > 0
        if changed:
            _bump_rev(conn)
    return changed


def merge_wallpaper_metadata(
    wallpaper_id: int, *, title: str = "", tags: str = "", date_spotted: str = ""
) -> bool:
    """
    Enrich an existing row *without destroying information*: a real title replaces
    a placeholder, tags are unioned and an empty date is filled in.
    Returns True when anything changed.
    """
    with get_db(write=True) as conn:
        row = conn.execute(
            "SELECT title, tags, date_spotted FROM wallpapers WHERE id = ?", (wallpaper_id,)
        ).fetchone()
        if not row:
            return False
        new_title = choose_title(row["title"], title) if title else row["title"]
        new_tags = merge_tags(row["tags"], tags)
        new_date = row["date_spotted"] or normalize_date(date_spotted) or ""
        if (new_title, new_tags, new_date) == (row["title"], row["tags"], row["date_spotted"]):
            return False
        conn.execute(
            "UPDATE wallpapers SET title = ?, tags = ?, date_spotted = ? WHERE id = ?",
            (new_title, new_tags, new_date, wallpaper_id),
        )
        _bump_rev(conn)
    return True


# ══════════════════════════════════════════════════════════════════════════
# Scrape queue (claim based)
# ══════════════════════════════════════════════════════════════════════════


def enqueue_scrape_pages(rows: list[tuple[str, str, int]]) -> int:
    """
    Add ``(url, source, priority)`` gallery pages.  Existing pages are kept but
    their priority is raised to the new value when it is higher.  Returns the
    number of *new* pages.
    """
    if not rows:
        return 0
    now = utcnow_iso()
    with get_db(write=True) as conn:
        before = conn.execute("SELECT COUNT(*) FROM scrape_queue").fetchone()[0]
        conn.executemany(
            """
            INSERT INTO scrape_queue(url, source, priority, added_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET priority = MAX(priority, excluded.priority)
            """,
            [(url, source, priority, now) for url, source, priority in rows],
        )
        after = conn.execute("SELECT COUNT(*) FROM scrape_queue").fetchone()[0]
    return after - before


def claim_scrape_page(source: str | None = None, min_priority: int = 0) -> dict | None:
    """Atomically claim the highest-priority unclaimed page (``None`` when empty)."""
    where, params = ["claimed_at IS NULL", "priority >= ?"], [min_priority]
    if source and source != "both":
        where.append("source = ?")
        params.append(source)
    with get_db(write=True) as conn:
        row = conn.execute(
            f"SELECT * FROM scrape_queue WHERE {' AND '.join(where)} "
            "ORDER BY priority DESC, id ASC LIMIT 1",
            params,
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE scrape_queue SET claimed_at = ? WHERE id = ?", (utcnow_iso(), row["id"])
        )
        return dict(row)


def complete_scrape_page(page_id: int) -> None:
    with get_db(write=True) as conn:
        conn.execute("DELETE FROM scrape_queue WHERE id = ?", (page_id,))


def release_scrape_page(page_id: int) -> None:
    """Give a claimed page back (e.g. on shutdown) without counting a retry."""
    with get_db(write=True) as conn:
        conn.execute("UPDATE scrape_queue SET claimed_at = NULL WHERE id = ?", (page_id,))


def fail_scrape_page(page_id: int, max_retries: int) -> bool:
    """
    Record a failed attempt.  The page is re-queued **at the back** of its priority
    group (so a failing host is not hammered in a tight loop) until ``max_retries``
    is exceeded, then dropped.  Returns True while it will be retried.
    """
    with get_db(write=True) as conn:
        row = conn.execute("SELECT * FROM scrape_queue WHERE id = ?", (page_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM scrape_queue WHERE id = ?", (page_id,))
        if row["retries"] + 1 > max_retries:
            return False
        conn.execute(
            "INSERT INTO scrape_queue(url, source, priority, added_at, retries) "
            "VALUES (?, ?, ?, ?, ?)",
            (row["url"], row["source"], row["priority"], utcnow_iso(), row["retries"] + 1),
        )
        return True


def scrape_queue_size(source: str | None = None, min_priority: int = 0) -> int:
    """Pages remaining (claimed + unclaimed), optionally for one source."""
    where, params = ["priority >= ?"], [min_priority]
    if source and source != "both":
        where.append("source = ?")
        params.append(source)
    with get_db() as conn:
        return conn.execute(
            f"SELECT COUNT(*) FROM scrape_queue WHERE {' AND '.join(where)}", params
        ).fetchone()[0]


def clear_scrape_queue(source: str | None = None) -> int:
    with get_db(write=True) as conn:
        if source and source != "both":
            cursor = conn.execute("DELETE FROM scrape_queue WHERE source = ?", (source,))
        else:
            cursor = conn.execute("DELETE FROM scrape_queue")
        return cursor.rowcount


# ══════════════════════════════════════════════════════════════════════════
# Suppressed URLs
# ══════════════════════════════════════════════════════════════════════════


def add_suppressed_url(url: str, reason: str = "duplicate_lower_quality") -> None:
    """Record a URL so it is never enqueued or downloaded again."""
    if not url:
        return
    with get_db(write=True) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO suppressed_urls (url, reason, created_at) VALUES (?, ?, ?)",
            (url, reason, utcnow_iso()),
        )


def is_url_suppressed(url: str) -> bool:
    if not url:
        return False
    with get_db() as conn:
        return conn.execute("SELECT 1 FROM suppressed_urls WHERE url = ?", (url,)).fetchone() is not None


def is_url_known(image_url: str) -> bool:
    """True if the URL is already downloaded, queued or suppressed."""
    if not image_url:
        return False
    with get_db() as conn:
        return bool(
            conn.execute(
                "SELECT 1 WHERE EXISTS (SELECT 1 FROM suppressed_urls WHERE url = ?) "
                "OR EXISTS (SELECT 1 FROM download_queue WHERE image_url = ?) "
                "OR EXISTS (SELECT 1 FROM wallpapers WHERE source_url = ?)",
                (image_url, image_url, image_url),
            ).fetchone()
        )


# ══════════════════════════════════════════════════════════════════════════
# Download queue (claim based)
# ══════════════════════════════════════════════════════════════════════════

_QUEUE_COLUMNS = ("image_url", "page_url", "title", "source", "tags", "date_spotted")


def enqueue_download(item: dict[str, Any]) -> bool:
    """Queue an image.  Returns False if it is already known (downloaded/queued/suppressed)."""
    url = item.get("image_url")
    if not url or is_url_known(url):
        return False
    row = {col: item.get(col, "") or "" for col in _QUEUE_COLUMNS}
    row["tags"] = normalize_tags(row["tags"])
    row["date_spotted"] = normalize_date(row["date_spotted"]) or row["date_spotted"]
    row["added_at"] = item.get("added_at") or utcnow_iso()
    row["retries"] = int(item.get("retries", 0))
    with get_db(write=True) as conn:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO download_queue
                (image_url, page_url, title, source, tags, date_spotted, added_at, retries)
            VALUES (:image_url, :page_url, :title, :source, :tags, :date_spotted, :added_at, :retries)
            """,
            row,
        )
        return cursor.rowcount > 0


def claim_download_item(source: str | None = None, since: str | None = None) -> dict | None:
    """
    Atomically claim the oldest unclaimed image (FIFO).

    ``since`` (ISO timestamp) restricts the claim to items queued at or after that
    moment – used by "quick update" runs so an old backlog is left alone.
    """
    where: list[str] = ["claimed_at IS NULL"]
    params: list[Any] = []
    if source and source != "both":
        where.append("source = ?")
        params.append(source)
    if since:
        where.append("added_at >= ?")
        params.append(since)
    with get_db(write=True) as conn:
        row = conn.execute(
            f"SELECT * FROM download_queue WHERE {' AND '.join(where)} ORDER BY id ASC LIMIT 1",
            params,
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE download_queue SET claimed_at = ? WHERE id = ?", (utcnow_iso(), row["id"])
        )
        return dict(row)


def complete_download_item(item_id: int) -> None:
    with get_db(write=True) as conn:
        conn.execute("DELETE FROM download_queue WHERE id = ?", (item_id,))


def release_download_item(item_id: int) -> None:
    """Give a claimed image back without counting a retry (used on shutdown)."""
    with get_db(write=True) as conn:
        conn.execute("UPDATE download_queue SET claimed_at = NULL WHERE id = ?", (item_id,))


def fail_download_item(item_id: int, max_retries: int) -> bool:
    """
    Count a failed attempt.  The item goes **to the back** of the queue (spacing the
    retries out) until ``max_retries`` is exceeded, then it is dropped.
    Returns True while the item will be retried.
    """
    with get_db(write=True) as conn:
        row = conn.execute("SELECT * FROM download_queue WHERE id = ?", (item_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM download_queue WHERE id = ?", (item_id,))
        if row["retries"] + 1 > max_retries:
            return False
        conn.execute(
            """
            INSERT INTO download_queue
                (image_url, page_url, title, source, tags, date_spotted, added_at, retries)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (row["image_url"], row["page_url"], row["title"], row["source"], row["tags"],
             row["date_spotted"], utcnow_iso(), row["retries"] + 1),
        )
        return True


def download_queue_size(source: str | None = None, since: str | None = None) -> int:
    """Images remaining (claimed + unclaimed), optionally for one source / since a moment."""
    where: list[str] = []
    params: list[Any] = []
    if source and source != "both":
        where.append("source = ?")
        params.append(source)
    if since:
        where.append("added_at >= ?")
        params.append(since)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with get_db() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM download_queue {clause}", params).fetchone()[0]


def release_all_claims() -> int:
    """Return every in-flight queue row to the pending state; returns rows released."""
    with get_db(write=True) as conn:
        a = conn.execute("UPDATE scrape_queue SET claimed_at = NULL WHERE claimed_at IS NOT NULL")
        b = conn.execute(
            "UPDATE download_queue SET claimed_at = NULL WHERE claimed_at IS NOT NULL"
        )
        return a.rowcount + b.rowcount


def clean_download_queue() -> int:
    """Remove queued images that were downloaded or suppressed in the meantime."""
    with get_db(write=True) as conn:
        c1 = conn.execute(
            "DELETE FROM download_queue WHERE image_url IN "
            "(SELECT source_url FROM wallpapers WHERE source_url IS NOT NULL)"
        ).rowcount
        c2 = conn.execute(
            "DELETE FROM download_queue WHERE image_url IN (SELECT url FROM suppressed_urls)"
        ).rowcount
    if c1 + c2:
        log.info("Cleaned download queue: %d duplicate/suppressed items removed.", c1 + c2)
    return c1 + c2


# ══════════════════════════════════════════════════════════════════════════
# Stats
# ══════════════════════════════════════════════════════════════════════════


def get_stats() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM stats").fetchall()
    return {r["key"]: r["value"] for r in rows}


def get_stat(key: str, default: str = "") -> str:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM stats WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_stat(key: str, value: str | int) -> None:
    with get_db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO stats(key, value) VALUES (?, ?)", (key, str(value)))


def increment_stat(key: str, by: int = 1) -> int:
    with get_db(write=True) as conn:
        conn.execute(
            "INSERT INTO stats(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?",
            (key, str(by), by),
        )
        row = conn.execute("SELECT value FROM stats WHERE key = ?", (key,)).fetchone()
    return int(row["value"]) if row else 0


KNOWN_SOURCES = ("peapix", "win10spotlight")


def get_source_stats() -> dict:
    """Per-source library, queue and scrape-page counts (drives the dashboard)."""
    with get_db() as conn:
        wp = {r["source"]: r["cnt"] for r in conn.execute(
            "SELECT source, COUNT(*) AS cnt FROM wallpapers GROUP BY source")}
        dl = {r["source"]: r["cnt"] for r in conn.execute(
            "SELECT source, COUNT(*) AS cnt FROM download_queue GROUP BY source")}
        sq = {r["source"]: r["cnt"] for r in conn.execute(
            "SELECT source, COUNT(*) AS cnt FROM scrape_queue GROUP BY source")}
    total = sum(wp.values())
    sources = {}
    for src in sorted({*wp, *dl, *KNOWN_SOURCES}):
        available, queued = wp.get(src, 0), dl.get(src, 0)
        sources[src] = {
            "available": available,
            "queued": queued,
            "scrape_pages": sq.get(src, 0),
            "total_discovered": available + queued,
            "pct_of_total": round(available / total * 100, 1) if total else 0.0,
        }
    return {"total_available": total, "sources": sources}
