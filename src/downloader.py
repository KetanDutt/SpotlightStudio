"""
downloader.py – high-throughput async image downloader.

Key design decisions
--------------------
1. All *network* work uses aiohttp (non-blocking I/O, up to CONCURRENT_DOWNLOADS
   simultaneous in-flight requests).

2. All *CPU* work — Pillow decode, dHash computation, thumbnail resize — is
   offloaded to a ThreadPoolExecutor via `loop.run_in_executor()`.  This keeps
   the asyncio event loop free to fire more HTTP requests while one worker thread
   is computing a hash or resizing an image.  Without this, every download blocks
   the loop for ~50–200 ms of CPU time, effectively serialising what should be
   32 concurrent downloads.

3. File I/O (writing JPEGs) is also wrapped in run_in_executor so disk writes
   don't stall the event loop either.

Thread pool size is controlled by CPU_THREADS in .env (0 = Python default).

Quality fallback chain (peapix)
--------------------------------
  _UHD.jpg  (3840 × 2160, ~2–5 MB)
  → _1920.jpg (1920 × 1080, ~500 KB–1 MB)
  → _1280.jpg
  → _640.jpg
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp
import imagehash
from PIL import Image

from src.config import settings
from src.database import (
    add_suppressed_url,
    delete_wallpaper,
    get_db,
    get_wallpaper_by_phash,
    increment_stat,
    re_enqueue_with_retry,
    upsert_wallpaper,
)

log = logging.getLogger("downloader")

# ── Thread pool for CPU-bound Pillow / imagehash work ────────────────────────
# A single shared pool is reused across the whole application lifetime.
_cpu_pool = ThreadPoolExecutor(
    max_workers=settings.CPU_THREADS or None,   # None → Python default
    thread_name_prefix="cpu-worker",
)

# ── Thumbnail directory ───────────────────────────────────────────────────────
THUMBS_DIR: Path = settings.IMAGES_DIR / "thumbs"
THUMBS_DIR.mkdir(parents=True, exist_ok=True)

THUMB_SIZE = (480, 270)   # 16 : 9 @ 480 px


# ── Pure (CPU-bound) helpers — run in thread pool ─────────────────────────────

def _decode_image(data: bytes) -> Image.Image:
    """Decode raw bytes → RGB PIL Image.  Runs in thread pool."""
    return Image.open(io.BytesIO(data)).convert("RGB")


def _compute_phash(img: Image.Image) -> str:
    """Compute dHash(16).  Runs in thread pool."""
    return str(imagehash.dhash(img, hash_size=16))


def _write_thumbnail(img: Image.Image, dest: Path) -> None:
    """
    Centre-crop to 16 : 9 then resize to THUMB_SIZE.
    Runs in thread pool so disk I/O doesn't stall the event loop.
    """
    target_ratio = 16 / 9
    w, h = img.size
    actual_ratio = w / h

    if actual_ratio > target_ratio:
        new_w = int(h * target_ratio)
        offset = (w - new_w) // 2
        img = img.crop((offset, 0, offset + new_w, h))
    elif actual_ratio < target_ratio:
        new_h = int(w / target_ratio)
        offset = (h - new_h) // 2
        img = img.crop((0, offset, w, offset + new_h))

    dest.parent.mkdir(parents=True, exist_ok=True)
    thumb = img.resize(THUMB_SIZE, Image.LANCZOS)
    thumb.save(dest, "JPEG", quality=82, optimize=True, progressive=True)


def _write_full_image(data: bytes, dest: Path) -> None:
    """Write raw bytes to disk.  Runs in thread pool."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)


# ── Network helpers ───────────────────────────────────────────────────────────

def _url_to_filename(source: str, url: str) -> str:
    clean_source = re.sub(r"[^a-zA-Z0-9_-]", "", source) or "other"
    hashed_name = hashlib.sha256(url.encode()).hexdigest()[:32] + ".jpg"
    return f"{clean_source}/{hashed_name}"


def _quality_label(width: int) -> str:
    if width >= 3840: return "4K / UHD"
    if width >= 2560: return "2K / QHD"
    if width >= 1920: return "FHD (1080p)"
    if width >= 1280: return "HD (720p)"
    return "SD"


def _quality_score(width: int, height: int, file_size: int) -> int:
    """Higher is better — pixel count first, byte count as tiebreaker."""
    return width * height * 1_000 + file_size


async def _fetch_bytes(
    session: aiohttp.ClientSession, url: str
) -> Optional[tuple[bytes, str]]:
    """
    Download image bytes.  Returns (data, actual_url) or None on failure.

    For peapix UHD URLs automatically falls back through the quality chain
    if the server returns a non-200.  Each attempt is a separate HTTP request
    — all issued from the same asyncio task so they share the caller's semaphore
    slot without blocking other concurrent downloads.
    """
    urls_to_try: list[str] = [url]

    if "img.peapix.com" in url and "_UHD.jpg" in url:
        base = re.sub(r"_UHD\.jpg$", "", url)
        urls_to_try += [
            f"{base}_1920.jpg",
            f"{base}_1280.jpg",
            f"{base}_640.jpg",
        ]

    for attempt_url in urls_to_try:
        try:
            async with session.get(attempt_url, allow_redirects=True) as resp:
                if resp.status == 200:
                    ct = resp.headers.get("Content-Type", "")
                    if "image" in ct or attempt_url.lower().endswith(
                        (".jpg", ".jpeg", ".png", ".webp")
                    ):
                        data = await resp.read()
                        if len(data) > 5_000:         # sanity: > 5 KB
                            if attempt_url != url:
                                log.debug("Used fallback URL: %s", attempt_url)
                            return data, attempt_url
                elif resp.status in (404, 410, 403):
                    continue                           # permanent; try next variant
        except asyncio.TimeoutError:
            log.debug("Timeout: %s", attempt_url)
        except Exception as exc:
            log.debug("Fetch error %s: %s", attempt_url, exc)

    return None


# ── Main pipeline ─────────────────────────────────────────────────────────────

async def process_download(
    session: aiohttp.ClientSession,
    item: dict,
) -> bool:
    """
    Download and store one wallpaper image.

    Returns True  on success, or when the existing copy is already optimal.
    Returns False on transient network failure (item is re-queued).

    CPU-intensive steps (decode, hash, thumbnail) are run in a shared
    ThreadPoolExecutor so the event loop stays free for more HTTP I/O.
    """
    url = item["image_url"]
    loop = asyncio.get_running_loop()

    # ── 1. Fetch ──────────────────────────────────────────────────────────
    result = await _fetch_bytes(session, url)
    if result is None:
        log.warning("✗ Failed: %s", url)
        re_enqueue_with_retry(item, settings.MAX_RETRIES)
        increment_stat("errors")
        return False

    data, actual_url = result

    # ── 2. Decode (CPU → thread pool) ────────────────────────────────────
    try:
        img: Image.Image = await loop.run_in_executor(_cpu_pool, _decode_image, data)
    except Exception as exc:
        log.warning("✗ Cannot decode %s: %s", url, exc)
        increment_stat("errors")
        return False

    width, height = img.size
    file_size = len(data)

    # ── 3. Perceptual hash (CPU → thread pool) ────────────────────────────
    phash: str = await loop.run_in_executor(_cpu_pool, _compute_phash, img)

    # ── 4. Deduplication check ────────────────────────────────────────────
    existing = get_wallpaper_by_phash(phash)
    if existing:
        new_score = _quality_score(width, height, file_size)
        old_score = _quality_score(
            existing["width"], existing["height"], existing["file_size"]
        )
        if new_score <= old_score:
            log.debug("⊘ Duplicate (kept existing): %s", url)
            increment_stat("duplicates_skipped")
            add_suppressed_url(actual_url, reason="duplicate_lower_quality")
            if url != actual_url:
                add_suppressed_url(url, reason="duplicate_lower_quality")
            return True                               # not a failure

        # New copy is strictly better — remove old files (both nested and legacy flat)
        for base_dir in (settings.IMAGES_DIR, THUMBS_DIR):
            target = base_dir / existing["filename"]
            if target.exists() and not target.is_dir():
                target.unlink()
            legacy_target = base_dir / Path(existing["filename"]).name
            if legacy_target.exists() and legacy_target != target and not legacy_target.is_dir():
                legacy_target.unlink()

        if existing.get("source_url"):
            add_suppressed_url(existing["source_url"], reason="duplicate_lower_quality")
        if existing.get("page_url"):
            add_suppressed_url(existing["page_url"], reason="duplicate_lower_quality")

        delete_wallpaper(phash)
        increment_stat("duplicates_replaced")
        log.info("↑ Replaced with higher quality: %s", existing["filename"])

    # ── 5. Write full image (I/O → thread pool) ───────────────────────────
    source = item.get("source", "unknown")
    filename = _url_to_filename(source, actual_url)
    await loop.run_in_executor(
        _cpu_pool, _write_full_image, data, settings.IMAGES_DIR / filename
    )

    # ── 6. Generate thumbnail (CPU + I/O → thread pool) ───────────────────
    try:
        await loop.run_in_executor(
            _cpu_pool, _write_thumbnail, img, THUMBS_DIR / filename
        )
    except Exception as exc:
        log.warning("Thumbnail failed for %s: %s", filename, exc)

    # ── 7. Persist metadata ───────────────────────────────────────────────
    record = {
        "phash":        phash,
        "filename":     filename,
        "title":        (item.get("title") or "Windows Spotlight Wallpaper").strip(),
        "source":       item.get("source", "unknown"),
        "source_url":   actual_url,
        "page_url":     item.get("page_url", ""),
        "width":        width,
        "height":       height,
        "file_size":    file_size,
        "tags":         item.get("tags", ""),
        "date_spotted": item.get("date_spotted", ""),
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "quality":      _quality_label(width),
    }
    upsert_wallpaper(record)
    increment_stat("downloaded_count")

    log.info(
        "✓ %s  %dx%d  %s  %.2f MB",
        filename[:16],
        width, height,
        record["quality"],
        file_size / 1_048_576,
    )
    return True


async def create_missing_thumbs() -> int:
    """Finds downloaded wallpapers without a thumbnail and generates them."""
    with get_db() as conn:
        rows = conn.execute("SELECT filename FROM wallpapers").fetchall()

    missing = []
    for row in rows:
        filename = row["filename"]
        thumb_path = THUMBS_DIR / filename
        if not thumb_path.exists():
            full_path = settings.IMAGES_DIR / filename
            if full_path.exists():
                missing.append((full_path, thumb_path))

    if not missing:
        return 0

    log.info("Found %d missing thumbnails. Generating...", len(missing))
    loop = asyncio.get_running_loop()

    def _gen(src: Path, dst: Path):
        try:
            with open(src, "rb") as f:
                data = f.read()
            img = _decode_image(data)
            _write_thumbnail(img, dst)
        except Exception as e:
            log.error("Failed to generate thumb for %s: %s", src, e)

    tasks = []
    for src, dst in missing:
        tasks.append(loop.run_in_executor(_cpu_pool, _gen, src, dst))

    if tasks:
        await asyncio.gather(*tasks)

    log.info("Finished generating missing thumbnails.")
    return len(missing)
