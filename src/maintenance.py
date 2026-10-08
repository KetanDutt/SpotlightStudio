"""
maintenance.py – library upkeep that is independent of crawling.

* :func:`startup_tasks`                  – run once per process (schema, stale state, layout)
* :func:`deduplicate_downloaded_wallpapers` – sweep the whole library for near-duplicates
* :func:`create_missing_thumbnails`      – rebuild thumbnails that are missing on disk
* :func:`verify_library`                 – read-only health report (``main.py --check``)
* :func:`migrate_storage_to_source_folders` – upgrade the v1 flat folder layout
"""
from __future__ import annotations

import logging
import shutil
from collections import defaultdict
from pathlib import Path

from src import storage
from src.config import settings
from src.database import (
    add_suppressed_url,
    delete_wallpaper_by_id,
    export_catalog_json,
    get_db,
    increment_stat,
    init_db,
    merge_wallpaper_metadata,
    reset_runtime_state,
)
from src.downloader import get_cpu_pool, regenerate_thumbnail
from src.hashing import (
    DEFAULT_MAX_DISTANCE,
    chunk_keys,
    hamming_hex,
    is_valid_phash,
)
from src.utils import is_lfs_pointer, quality_score

log = logging.getLogger("maintenance")


# ══════════════════════════════════════════════════════════════════════════
# Start-up
# ══════════════════════════════════════════════════════════════════════════


def startup_tasks() -> None:
    """
    Prepare a process for use.  Safe to call more than once.

    1. create / upgrade the database schema,
    2. discard state left behind by a killed process (``status=running``, claims),
    3. upgrade the legacy flat image layout if any rows still use it,
    4. keep the static catalog in sync,
    5. warn when the images are Git-LFS pointers (a very common first-run problem).
    """
    init_db()
    reset_runtime_state()
    migrate_storage_to_source_folders()
    try:
        export_catalog_json()
    except OSError as exc:
        log.warning("Could not write the static catalog: %s", exc)
    warn_if_lfs_pointers()


def warn_if_lfs_pointers() -> bool:
    pointers, inspected = storage.count_lfs_pointers()
    if inspected and pointers:
        log.warning(
            "%d of %d sampled images are Git LFS pointer files, not real images. "
            "Run `git lfs install && git lfs pull` to download them.",
            pointers,
            inspected,
        )
        return True
    return False


# ══════════════════════════════════════════════════════════════════════════
# Legacy layout migration
# ══════════════════════════════════════════════════════════════════════════


def migrate_storage_to_source_folders() -> dict:
    """
    Move legacy *flat* files (``images/abc.jpg``) into ``images/<source>/`` and
    rewrite the DB filename.  A no-op (one cheap query) for current libraries.
    """
    result = {"moved_images": 0, "moved_thumbs": 0, "updated_db": 0}
    with get_db() as conn:
        legacy = conn.execute(
            "SELECT id, filename, source FROM wallpapers WHERE filename NOT LIKE '%/%'"
        ).fetchall()
    if not legacy:
        return result

    images_dir, thumbs_dir = settings.IMAGES_DIR, settings.THUMBS_DIR
    for row in legacy:
        pure_name = Path(row["filename"]).name
        new_fn = f"{storage.clean_source(row['source'])}/{pure_name}"
        for base, key in ((images_dir, "moved_images"), (thumbs_dir, "moved_thumbs")):
            flat = base / pure_name
            dest = base / new_fn
            if flat.is_file() and flat != dest:
                try:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(flat), str(dest))
                    result[key] += 1
                except OSError as exc:
                    log.warning("Could not move %s: %s", flat, exc)
        with get_db(write=True) as conn:
            conn.execute("UPDATE wallpapers SET filename = ? WHERE id = ?", (new_fn, row["id"]))
        result["updated_db"] += 1
    log.info("Storage migration: %s", result)
    return result


# ══════════════════════════════════════════════════════════════════════════
# De-duplication sweep
# ══════════════════════════════════════════════════════════════════════════


def deduplicate_downloaded_wallpapers(max_distance: int = DEFAULT_MAX_DISTANCE) -> int:
    """
    Remove perceptual duplicates from the whole library, keeping the best copy.

    Rows are visited from best to worst quality; a row is a duplicate when a
    *kept* row lies within ``max_distance`` bits.  The kept row absorbs the
    duplicate's tags/title, the duplicate's files are deleted and its URL is
    suppressed so it is never downloaded again.  Returns the number removed.
    """
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, phash, filename, title, tags, date_spotted, width, height, file_size, "
            "source_url FROM wallpapers"
        )]
    if len(rows) < 2:
        return 0

    def usable(row: dict) -> bool:
        try:
            path = storage.image_path(row["filename"])
            return path.is_file() and not is_lfs_pointer(path)
        except ValueError:
            return False

    # Never discard a real original in favour of a missing file/LFS pointer just
    # because its metadata claims a larger resolution.
    available = {row["id"]: usable(row) for row in rows}
    rows.sort(key=lambda r: (not available[r["id"]],
                            -quality_score(r["width"], r["height"], r["file_size"]), r["id"]))
    index: dict[tuple[int, str], list[dict]] = defaultdict(list)
    removed = 0

    for row in rows:
        phash = row["phash"]
        if not is_valid_phash(phash):
            continue
        keys = [(i, chunk) for i, chunk in enumerate(chunk_keys(phash))]
        keeper = None
        best = max_distance + 1
        # A candidate can share all eight chunks: compare it only once.
        candidates = {candidate["id"]: candidate for key in keys
                      for candidate in index.get(key, ())}
        if max_distance >= len(keys):
            candidates = {candidate["id"]: candidate for bucket in index.values()
                          for candidate in bucket}
        for candidate in candidates.values():
            distance = hamming_hex(phash, candidate["phash"])
            if distance < best:
                keeper, best = candidate, distance
        if keeper is None:
            if available[row["id"]]:
                for key in keys:
                    index[key].append(row)
            continue

        # Commit all metadata/suppression/counters together BEFORE deleting any
        # bytes. A DB failure must leave both originals and both rows recoverable.
        with get_db(write=True) as conn:
            merge_wallpaper_metadata(
                keeper["id"], title=row["title"], tags=row["tags"], date_spotted=row["date_spotted"]
            )
            if row["source_url"] and row["source_url"] != keeper["source_url"]:
                add_suppressed_url(row["source_url"], reason="duplicate_lower_quality")
            delete_wallpaper_by_id(row["id"])
            increment_stat("duplicates_replaced")
            shared_file = conn.execute(
                "SELECT 1 FROM wallpapers WHERE filename = ? LIMIT 1", (row["filename"],)
            ).fetchone()
        if not shared_file:
            storage.delete_wallpaper_files(row["filename"], legacy=False)
        removed += 1
        log.info(
            "Dedupe: kept %s (%dx%d), removed %s (%dx%d)",
            keeper["filename"], keeper["width"], keeper["height"],
            row["filename"], row["width"], row["height"],
        )

    if removed:
        log.info("Deduplication removed %d lower-quality copies.", removed)
    return removed


# ══════════════════════════════════════════════════════════════════════════
# Thumbnails
# ══════════════════════════════════════════════════════════════════════════


def create_missing_thumbnails() -> int:
    """Generate thumbnails that are missing on disk.  Returns how many were created."""
    with get_db() as conn:
        filenames = [r["filename"] for r in conn.execute("SELECT filename FROM wallpapers")]

    missing: list[tuple[Path, Path]] = []
    for filename in filenames:
        try:
            thumb, full = storage.thumb_path(filename), storage.image_path(filename)
        except ValueError:
            continue
        if (not thumb.is_file() or is_lfs_pointer(thumb)) and full.is_file() and not is_lfs_pointer(full):
            missing.append((full, thumb))
    if not missing:
        return 0

    log.info("Generating %d missing thumbnails…", len(missing))

    def _generate(pair: tuple[Path, Path]) -> bool:
        try:
            regenerate_thumbnail(*pair)
            return True
        except Exception as exc:  # noqa: BLE001
            log.error("Thumbnail failed for %s: %s", pair[0].name, exc)
            return False

    created = sum(get_cpu_pool().map(_generate, missing))
    log.info("Generated %d/%d thumbnails.", created, len(missing))
    return created


# ══════════════════════════════════════════════════════════════════════════
# Health check
# ══════════════════════════════════════════════════════════════════════════


def verify_library(sample_limit: int = 20) -> dict:
    """
    Read-only consistency report between the database and the files on disk.

    ``ok`` is True when nothing needs attention.  Lists are truncated to
    ``sample_limit`` entries; the ``*_count`` fields hold the full numbers.
    """
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT id, phash, filename FROM wallpapers")]

    known_images = {r["filename"] for r in rows}
    missing_images: list[str] = []
    missing_thumbs = lfs_pointers = lfs_thumbs = invalid_hashes = 0
    for row in rows:
        if not is_valid_phash(row["phash"]):
            invalid_hashes += 1
        try:
            full, thumb = storage.image_path(row["filename"]), storage.thumb_path(row["filename"])
        except ValueError:
            missing_images.append(row["filename"])
            continue
        if not full.is_file():
            missing_images.append(row["filename"])
        elif is_lfs_pointer(full):
            lfs_pointers += 1
        if not thumb.is_file():
            missing_thumbs += 1
        elif is_lfs_pointer(thumb):
            lfs_thumbs += 1
            missing_thumbs += 1

    orphans: list[str] = []
    root = settings.IMAGES_DIR
    if root.exists():
        for source_dir in (p for p in root.iterdir() if p.is_dir() and p.name != "thumbs"):
            for path in source_dir.iterdir():
                rel = f"{source_dir.name}/{path.name}"
                if path.is_file() and rel not in known_images and path.suffix != ".part":
                    orphans.append(rel)

    clusters = _count_duplicate_pairs(rows)
    report = {
        "wallpapers": len(rows),
        "missing_images_count": len(missing_images),
        "missing_images": missing_images[:sample_limit],
        "missing_thumbnails_count": missing_thumbs,
        "lfs_pointer_count": lfs_pointers,
        "lfs_thumbnail_count": lfs_thumbs,
        "orphan_images_count": len(orphans),
        "orphan_images": orphans[:sample_limit],
        "invalid_hash_count": invalid_hashes,
        "duplicate_pairs": clusters,
    }
    report["ok"] = not (
        missing_images or missing_thumbs or lfs_pointers or orphans or invalid_hashes or clusters
    )
    return report


def _count_duplicate_pairs(rows: list[dict], max_distance: int = DEFAULT_MAX_DISTANCE) -> int:
    index: dict[tuple[int, str], list[str]] = defaultdict(list)
    pairs: set[tuple[str, str]] = set()
    for row in rows:
        phash = row["phash"]
        if not is_valid_phash(phash):
            continue
        for key in enumerate(chunk_keys(phash)):
            for other in index[key]:
                if other != phash and hamming_hex(phash, other) <= max_distance:
                    pairs.add((min(phash, other), max(phash, other)))
            index[key].append(phash)
    return len(pairs)
