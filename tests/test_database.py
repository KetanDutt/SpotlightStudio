from __future__ import annotations

import json
import os
import sqlite3

import pytest

from src import database as db
from src.config import settings
from tests.conftest import add_wallpaper, random_phash

# The schema exactly as shipped in v2.1.0 (before claims / migrations).
V1_SCHEMA = """
CREATE TABLE wallpapers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, phash TEXT UNIQUE NOT NULL, filename TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, source_url TEXT NOT NULL,
    page_url TEXT NOT NULL DEFAULT '', width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0, file_size INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '', date_spotted TEXT NOT NULL DEFAULT '',
    downloaded_at TEXT NOT NULL, quality TEXT NOT NULL DEFAULT 'UHD');
CREATE TABLE scrape_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL);
CREATE TABLE download_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT UNIQUE NOT NULL,
    page_url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '', date_spotted TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL,
    retries INTEGER NOT NULL DEFAULT 0);
CREATE TABLE suppressed_urls (url TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE stats (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_wallpapers_phash ON wallpapers(phash);
CREATE INDEX idx_suppressed_urls_url ON suppressed_urls(url);
"""


def test_migration_from_v1_is_lossless_and_normalises(tmp_path, monkeypatch):
    path = tmp_path / "old" / "wallpapers.db"
    path.parent.mkdir()
    con = sqlite3.connect(path)
    con.executescript(V1_SCHEMA)
    con.executemany(
        "INSERT INTO wallpapers (phash, filename, title, source, source_url, page_url, width, height,"
        " file_size, tags, date_spotted, downloaded_at, quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            ("a" * 64, "peapix/a.jpg", "T1", "peapix", "u1", "p1", 3840, 2160, 10, "Sky, Lake", "May 14, 2025",
             "2026-10-01T10:08:17.213612", "UHD"),
            ("b" * 64, "win10spotlight/b.jpg", "T2", "win10spotlight", "u2", "p2", 1920, 1080, 10, "x", "2018-11-27",
             "2026-10-02T09:26:00.639698+00:00", "FHD"),
            ("c" * 64, "win10spotlight/c.jpg", "T3", "win10spotlight", "u3", "p3", 1920, 1080, 10, "", "weird date",
             "2026-10-02T09:26:00+00:00", "FHD (1080p)"),
        ],
    )
    con.execute("INSERT INTO stats VALUES ('downloaded_count', '3')")
    con.execute("INSERT INTO suppressed_urls VALUES ('http://x', 'duplicate_lower_quality', '2026-01-01')")
    con.commit()
    con.close()

    monkeypatch.setattr(settings, "DB_PATH", path)
    monkeypatch.setattr(settings, "IMAGES_DIR", tmp_path / "images")
    db.close_connection()
    db.init_db()
    try:
        with db.get_db() as conn:
            assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
            rows = {r["phash"][0]: dict(r) for r in conn.execute("SELECT * FROM wallpapers")}
            assert len(rows) == 3
            assert rows["a"]["date_spotted"] == "2025-05-14"          # normalised
            assert rows["a"]["quality"] == "4K / UHD"                  # canonical label
            assert rows["a"]["downloaded_at"].endswith("+00:00")       # tz-aware
            assert rows["a"]["tags"] == "sky,lake"                     # normalised
            assert rows["b"]["quality"] == "FHD (1080p)"
            assert rows["c"]["date_spotted"] == "weird date"           # unparseable → kept, never lost
            assert conn.execute("SELECT value FROM stats WHERE key='downloaded_count'").fetchone()[0] == "3"
            assert conn.execute("SELECT COUNT(*) FROM suppressed_urls").fetchone()[0] == 1
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(download_queue)")}
            assert "claimed_at" in cols
            indexes = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
            assert "idx_wallpapers_phash" not in indexes               # redundant index dropped
            assert "idx_wallpapers_page_url" in indexes
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        db.init_db()  # idempotent
    finally:
        db.close_connection()


def test_fresh_database_has_current_schema(env):
    with db.get_db() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
        stats = {r["key"] for r in conn.execute("SELECT key FROM stats")}
    assert {"status", "phase", "downloaded_count", "errors", "library_rev"} <= stats
    db.init_db()


def test_nested_transactions_join_the_outer_one(env):
    with pytest.raises(RuntimeError), db.get_db(write=True) as outer:
        outer.execute("INSERT INTO stats(key, value) VALUES ('t1', '1')")
        with db.get_db(write=True) as inner:
            inner.execute("INSERT INTO stats(key, value) VALUES ('t2', '2')")
        raise RuntimeError("boom")
    stats = db.get_stats()
    assert "t1" not in stats and "t2" not in stats  # the inner block did not commit early


def test_stats_helpers(env):
    assert db.increment_stat("brand_new", 3) == 3
    assert db.increment_stat("brand_new") == 4
    db.set_stat("phase", "Testing")
    assert db.get_stat("phase") == "Testing"
    assert db.get_stat("missing", "dflt") == "dflt"


# ── Queues ─────────────────────────────────────────────────────────────────


def _item(n: int, source: str = "peapix") -> dict:
    return {"image_url": f"https://img/{n}.jpg", "page_url": f"https://p/{n}", "title": f"T{n}",
            "source": source, "tags": "A, b", "date_spotted": "May 3, 2025"}


def test_download_claim_lifecycle(env):
    assert db.enqueue_download(_item(1)) is True
    assert db.enqueue_download(_item(1)) is False  # already queued
    db.enqueue_download(_item(2, "win10spotlight"))

    first = db.claim_download_item()
    assert first["image_url"].endswith("/1.jpg")
    assert first["tags"] == "a,b" and first["date_spotted"] == "2025-05-03"  # normalised on enqueue
    assert db.download_queue_size() == 2            # claimed items still count as remaining
    second = db.claim_download_item()
    assert second["source"] == "win10spotlight"
    assert db.claim_download_item() is None         # nothing unclaimed left

    db.release_download_item(first["id"])           # shutdown: give back, no retry counted
    again = db.claim_download_item()
    assert again["id"] == first["id"] and again["retries"] == 0

    db.complete_download_item(again["id"])
    assert db.download_queue_size() == 1


def test_download_claim_filters(env):
    db.enqueue_download(_item(1, "peapix"))
    db.enqueue_download(_item(2, "win10spotlight"))
    assert db.claim_download_item("win10spotlight")["source"] == "win10spotlight"
    assert db.claim_download_item("win10spotlight") is None
    assert db.download_queue_size("peapix") == 1
    since = "9999-01-01T00:00:00+00:00"
    assert db.claim_download_item("peapix", since=since) is None  # older than `since`
    assert db.download_queue_size("peapix", since=since) == 0
    assert db.claim_download_item("peapix", since="2000-01-01T00:00:00+00:00") is not None


def test_failed_items_go_to_the_back_then_are_dropped(env):
    db.enqueue_download(_item(1))
    db.enqueue_download(_item(2))
    a = db.claim_download_item()
    assert db.fail_download_item(a["id"], max_retries=2) is True      # retry 1
    nxt = db.claim_download_item()
    assert nxt["image_url"].endswith("/2.jpg")                          # item 2 is served first
    again = db.claim_download_item()
    assert again["image_url"].endswith("/1.jpg") and again["retries"] == 1
    assert db.fail_download_item(again["id"], 2) is True               # retry 2
    third = db.claim_download_item()
    assert third["retries"] == 2
    assert db.fail_download_item(third["id"], 2) is False              # over the limit → dropped
    assert db.download_queue_size() == 1                                # only item 2 (claimed) remains


def test_known_urls_are_not_enqueued(env):
    add_wallpaper(source_url="https://img/known.jpg")
    db.add_suppressed_url("https://img/suppressed.jpg")
    assert db.is_url_known("https://img/known.jpg")
    assert db.is_url_known("https://img/suppressed.jpg")
    assert not db.is_url_known("https://img/new.jpg")
    assert not db.enqueue_download({**_item(9), "image_url": "https://img/known.jpg"})
    assert not db.enqueue_download({**_item(9), "image_url": "https://img/suppressed.jpg"})
    assert db.enqueue_download({**_item(9), "image_url": "https://img/new.jpg"})
    assert not db.enqueue_download({"source": "peapix"})  # no URL


def test_scrape_queue_priority_claims_and_retry(env):
    rows = [("https://s/1", "peapix", 100), ("https://s/2", "peapix", 10), ("https://s/3", "win10spotlight", 10)]
    assert db.enqueue_scrape_pages(rows) == 3
    assert db.enqueue_scrape_pages(rows) == 0                      # idempotent
    assert db.enqueue_scrape_pages([("https://s/2", "peapix", 100)]) == 0
    assert db.scrape_queue_size(min_priority=100) == 2             # priority raised, not duplicated

    page = db.claim_scrape_page(min_priority=100)
    assert page["url"] in {"https://s/1", "https://s/2"}
    db.release_scrape_page(page["id"])
    claimed = db.claim_scrape_page("win10spotlight")
    assert claimed["url"] == "https://s/3"
    assert db.fail_scrape_page(claimed["id"], max_retries=1) is True
    claimed = db.claim_scrape_page("win10spotlight")
    assert claimed["retries"] == 1
    assert db.fail_scrape_page(claimed["id"], max_retries=1) is False
    assert db.scrape_queue_size("win10spotlight") == 0
    assert db.clear_scrape_queue() == 2


def test_reset_runtime_state_releases_stale_claims(env):
    db.enqueue_download(_item(1))
    db.enqueue_scrape_pages([("https://s/1", "peapix", 10)])
    db.claim_download_item()
    db.claim_scrape_page()
    db.set_stat("status", "running")
    assert db.release_all_claims() == 2
    db.claim_download_item()
    db.reset_runtime_state()
    assert db.get_stat("status") == "stopped"
    assert db.claim_download_item() is not None  # claim was released


# ── Listing: search / sort / pagination ────────────────────────────────────


def test_search_is_tokenised_case_insensitive_and_escaped(env):
    add_wallpaper(title="Lake Pehoe, Chile", tags="lake,chile")
    add_wallpaper(title="Chile desert", tags="desert")
    add_wallpaper(title="100% pure", tags="misc")
    add_wallpaper(title="a_b", tags="misc")
    count = lambda **kw: db.get_all_wallpapers(**kw)[1]  # noqa: E731
    assert count(search="chile") == 2
    assert count(search="LAKE chile") == 1                    # AND semantics, any order
    assert count(search="chile lake") == 1
    assert count(search="100%") == 1                          # '%' is literal
    assert count(search="%") == 1
    assert count(search="a_b") == 1 and count(search="a_") == 1
    assert count(search="_") == 1                             # '_' is literal, not a wildcard
    assert count(search="2026-01") == 4                       # matches date_spotted


def test_pagination_is_stable_even_with_ties(env):
    for i in range(23):
        add_wallpaper(width=3840 if i % 2 else 1920, file_size=5, title="same", date_spotted="2026-01-01")
    for sort in ("width", "file_size", "title", "date_spotted", "downloaded_at"):
        for order in ("ASC", "DESC"):
            seen = []
            for page in range(1, 6):
                rows, total = db.get_all_wallpapers(page=page, per_page=5, sort=sort, order=order)
                seen += [r["id"] for r in rows]
            assert len(seen) == len(set(seen)) == total == 23, (sort, order)


def test_sort_date_unknown_last_both_ways_and_title_nocase(env):
    add_wallpaper(title="banana", date_spotted="")
    add_wallpaper(title="Apple", date_spotted="2026-01-01")
    add_wallpaper(title="cherry", date_spotted="2026-03-01")
    for order in ("ASC", "DESC"):
        rows, _ = db.get_all_wallpapers(sort="date_spotted", order=order)
        assert rows[-1]["date_spotted"] == "", order
    rows, _ = db.get_all_wallpapers(sort="title", order="ASC")
    assert [r["title"] for r in rows] == ["Apple", "banana", "cherry"]
    rows, _ = db.get_all_wallpapers(sort="date_spotted", order="DESC")
    assert [r["date_spotted"] for r in rows[:2]] == ["2026-03-01", "2026-01-01"]


def test_filters_by_tag_quality_and_source(env):
    add_wallpaper(tags="lake,sky", width=3840, source="peapix")
    add_wallpaper(tags="lakeside", width=1920, source="win10spotlight")
    add_wallpaper(tags="national park,lake", width=1280, source="win10spotlight")
    assert db.get_all_wallpapers(tag="lake")[1] == 2              # exact tag, not 'lakeside'
    assert db.get_all_wallpapers(tag="National Park")[1] == 1
    assert db.get_all_wallpapers(quality="4k")[1] == 1
    assert db.get_all_wallpapers(quality="fhd")[1] == 1
    assert db.get_all_wallpapers(quality="hd")[1] == 1
    assert db.get_all_wallpapers(source="win10spotlight")[1] == 2
    assert db.get_all_wallpapers(source="win10spotlight", tag="lake")[1] == 1
    assert db.get_all_wallpapers(quality="bogus")[1] == 3        # unknown quality is ignored


def test_sql_injection_attempts_are_inert(env):
    add_wallpaper(title="safe")
    evil = "id; DROP TABLE wallpapers; --"
    rows, total = db.get_all_wallpapers(sort=evil, order="ASC; DROP TABLE wallpapers")
    assert total == 1 and rows
    assert db.get_all_wallpapers(search="' OR 1=1 --")[1] == 0
    assert db.get_all_wallpapers(source="x' OR '1'='1")[1] == 0
    assert db.get_all_wallpapers(tag="x%' OR '1'='1")[1] == 0
    assert db.count_wallpapers() == 1


def test_random_tags_and_iteration(env):
    for i in range(5):
        add_wallpaper(tags=f"common,t{i}", source="peapix" if i < 3 else "win10spotlight")
    assert db.get_random_wallpaper(source="win10spotlight")["source"] == "win10spotlight"
    assert db.get_random_wallpaper(search="nothing-matches-this") is None
    counts = db.get_tag_counts()
    assert counts["common"] == 5 and counts["t0"] == 1
    assert db.get_tag_counts("win10spotlight")["common"] == 2
    ids = [r["id"] for r in db.iter_wallpapers(batch_size=2)]
    assert ids == sorted(ids) and len(ids) == 5
    assert set(next(db.iter_wallpapers(fields=("id", "title")))) == {"id", "title"}


# ── Duplicates & metadata ──────────────────────────────────────────────────


def test_find_duplicate_wallpaper_uses_hamming_distance(env):
    base = random_phash()
    stored = add_wallpaper(phash=base)
    near = f"{int(base, 16) ^ 0b1011:064x}"          # 3 bits away
    far = f"{int(base, 16) ^ ((1 << 40) - 1):064x}"   # 40 bits away
    assert db.find_duplicate_wallpaper(base)["id"] == stored["id"]
    assert db.find_duplicate_wallpaper(near)["id"] == stored["id"]
    assert db.find_duplicate_wallpaper(near, max_distance=2) is None
    assert db.find_duplicate_wallpaper(far) is None
    assert db.find_duplicate_wallpaper("") is None
    assert db.find_duplicate_wallpaper("not-a-hash") is None


def test_merge_wallpaper_metadata_never_loses_information(env):
    row = add_wallpaper(title="dfffe373d9c78e79e0d6a28ac186d8c5", tags="a", date_spotted="")
    assert db.merge_wallpaper_metadata(row["id"], title="Real Title", tags="b,A", date_spotted="May 1, 2025")
    merged = db.get_wallpaper(row["id"])
    assert merged["title"] == "Real Title" and merged["tags"] == "a,b" and merged["date_spotted"] == "2025-05-01"
    assert not db.merge_wallpaper_metadata(row["id"], title="Another", tags="a", date_spotted="2030-01-01")
    assert db.get_wallpaper(row["id"])["title"] == "Real Title"   # an informative title is never overwritten
    assert not db.merge_wallpaper_metadata(999999, title="x")
    assert db.update_wallpaper_metadata(row["id"], title="Forced") and db.get_wallpaper(row["id"])["title"] == "Forced"
    assert not db.update_wallpaper_metadata(row["id"])


def test_upsert_refreshes_file_columns_but_keeps_metadata(env):
    first = add_wallpaper(phash="d" * 64, width=1920, file_size=10, title="Keep me")
    created = db.upsert_wallpaper({**first, "width": 3840, "file_size": 99, "title": "Ignored", "filename": "peapix/new.jpg"})
    assert created is False
    row = db.get_wallpaper_by_phash("d" * 64)
    assert (row["width"], row["file_size"], row["filename"], row["title"]) == (3840, 99, "peapix/new.jpg", "Keep me")
    assert db.get_wallpaper_by_page_url(first["page_url"])["id"] == first["id"]
    assert db.get_wallpaper_by_page_url("") is None


# ── Catalog ────────────────────────────────────────────────────────────────


def test_catalog_is_slim_deterministic_and_not_rewritten_when_unchanged(env):
    for i in range(5):
        add_wallpaper(title=f"Wallpaper é {i}", downloaded_at="2026-10-01T00:00:00+00:00")
    payload, count = db.build_catalog()
    items = json.loads(payload)
    assert count == len(items) == 5
    assert set(items[0]) == set(db.CATALOG_FIELDS) and "phash" not in items[0]
    assert [i["id"] for i in items] == sorted((i["id"] for i in items), reverse=True)  # ties → id DESC
    assert payload == db.build_catalog()[0]
    assert "é".encode() in payload                                   # ensure_ascii=False

    assert db.export_catalog_json() == 5
    os.utime(settings.CATALOG_PATH, (1_000_000_000, 1_000_000_000))   # back-date: robust to coarse mtimes
    assert db.export_catalog_json() == 5
    assert settings.CATALOG_PATH.stat().st_mtime == 1_000_000_000      # unchanged → not rewritten
    add_wallpaper()
    assert db.export_catalog_json() == 6
    assert settings.CATALOG_PATH.stat().st_mtime > 1_000_000_000       # changed → rewritten
    assert len(json.loads(settings.CATALOG_PATH.read_text(encoding="utf-8"))) == 6


def test_library_signature_tracks_every_mutation(env):
    sigs = [db.library_signature()]
    row = add_wallpaper()
    sigs.append(db.library_signature())
    db.update_wallpaper_metadata(row["id"], title="x")
    sigs.append(db.library_signature())
    db.delete_wallpaper_by_id(row["id"])
    sigs.append(db.library_signature())
    assert len(set(sigs)) == 4


def test_source_stats(env):
    add_wallpaper(source="peapix")
    add_wallpaper(source="win10spotlight")
    add_wallpaper(source="win10spotlight")
    db.enqueue_download(_item(1, "peapix"))
    stats = db.get_source_stats()
    assert stats["total_available"] == 3
    assert stats["sources"]["win10spotlight"]["available"] == 2
    assert stats["sources"]["peapix"]["queued"] == 1
    assert stats["sources"]["peapix"]["total_discovered"] == 2
    assert stats["sources"]["win10spotlight"]["pct_of_total"] == pytest.approx(66.7, abs=0.1)


def test_clean_download_queue_removes_stale_rows(env):
    db.enqueue_download(_item(1))
    db.enqueue_download(_item(2))
    add_wallpaper(source_url="https://img/1.jpg")
    db.add_suppressed_url("https://img/2.jpg")
    assert db.clean_download_queue() == 2
    assert db.download_queue_size() == 0


def test_hash_candidate_query_uses_all_eight_expression_indexes(env):
    clauses = " OR ".join(f"{expression} = ?" for expression in db._HASH_CHUNKS_SQL)
    with db.get_db() as conn:
        plan = conn.execute(f"EXPLAIN QUERY PLAN SELECT * FROM wallpapers WHERE {clauses}",
                            ["01234567"] * 8).fetchall()
    detail = " ".join(row["detail"] for row in plan)
    assert "MULTI-INDEX OR" in detail
    for i in range(8):
        assert f"idx_wallpapers_hash_{i}" in detail
    assert "SCAN wallpapers" not in detail


def test_wide_duplicate_radius_does_not_require_an_identical_chunk(env):
    # One flipped bit in EVERY chunk: within 8 bits, but no chunk matches.
    base = "1" * 64
    row = add_wallpaper(phash=base)
    query = f"{int(base, 16) ^ sum(1 << (i * 32) for i in range(8)):064x}"
    assert db.find_duplicate_wallpaper(query, max_distance=7) is None
    assert db.find_duplicate_wallpaper(query, max_distance=8)["id"] == row["id"]


def test_newer_schema_is_refused_without_rewriting_its_version(env):
    with db.get_db(write=True) as conn:
        conn.execute(f"PRAGMA user_version={db.SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer than supported"):
        db.init_db()
    with db.get_db() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION + 1


def test_indexed_candidates_include_legacy_uppercase_hashes(env, add):
    from src.database import find_duplicate_wallpaper, get_db
    row = add(phash='abcdef01' * 8)
    with get_db() as connection:
        connection.execute('UPDATE wallpapers SET phash = UPPER(phash) WHERE id = ?', (row['id'],))
    assert find_duplicate_wallpaper('abcdef01' * 8, max_distance=0)['id'] == row['id']
