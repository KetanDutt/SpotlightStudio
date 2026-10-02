"""
downloader.py – fetch one wallpaper, analyse it, de-duplicate it, store it.

Pipeline (``process_download``)
-------------------------------
1. **Fetch**   aiohttp, streamed with a hard size cap (``MAX_IMAGE_BYTES``).
2. **Analyse** *one* job in a thread pool: decode → 256-bit dHash → 480×270
   thumbnail.  Doing everything in a single job keeps at most ``pool-size``
   decoded 4K bitmaps (~25 MB each) alive instead of one per in-flight download.
3. **Dedupe**  near-duplicate look-up (Hamming distance ≤ 4) against the library.
   * the existing copy is at least as good  → skip (but merge its metadata);
   * the new copy is strictly better        → replace, keeping the union of tags.
4. **Store**   image + thumbnail written atomically, then the DB row.

Steps 3 and 4 are **one critical section** (a per-event-loop ``asyncio.Lock``): downloads run
concurrently and the copies of one picture from two sources are often in flight together, so
without it both would pass the duplicate check and both would be stored.

Peapix resolution fallback
--------------------------
  ``_UHD.jpg`` (3840×2160) → ``_1920`` → ``_1280`` → ``_640``

The chain is walked **only** when a variant is permanently missing (404/403/410).
A timeout or HTTP 5xx aborts the attempt instead, so the engine retries the *best*
variant rather than silently settling for a lower resolution.  On the very last
retry the fallback is allowed so that nothing is lost on a persistently slow link.

The function never touches the queue tables – it returns an *outcome* and the
engine owns the claim lifecycle.
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
import weakref
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import aiohttp
from PIL import Image

from src import storage
from src.config import settings
from src.database import (
    add_suppressed_url,
    delete_wallpaper,
    find_duplicate_wallpaper,
    increment_stat,
    merge_wallpaper_metadata,
    upsert_wallpaper,
)
from src.hashing import DEFAULT_MAX_DISTANCE, dhash_hex
from src.utils import (
    atomic_write_bytes,
    choose_title,
    merge_tags,
    quality_label,
    quality_score,
    utcnow_iso,
)

log = logging.getLogger("downloader")

THUMB_SIZE = (480, 270)  # 16 : 9 @ 480 px
THUMB_QUALITY = 82
MIN_IMAGE_BYTES = 5_000  # anything smaller is an error page / tracking pixel
MAX_PIXELS = 120_000_000  # decompression-bomb guard (~11k × 11k)
_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")  # noqa: B009

Outcome = Literal["downloaded", "replaced", "duplicate", "failed", "rejected"]

# ── Thread pool for CPU-bound Pillow work (created lazily, process-wide) ─────

_cpu_pool: ThreadPoolExecutor | None = None


def get_cpu_pool() -> ThreadPoolExecutor:
    """Shared pool for decode / hash / thumbnail work (``CPU_THREADS``, 0 = auto)."""
    global _cpu_pool
    if _cpu_pool is None:
        _cpu_pool = ThreadPoolExecutor(
            max_workers=settings.CPU_THREADS or None, thread_name_prefix="cpu-worker"
        )
    return _cpu_pool


def shutdown_cpu_pool(wait: bool = False) -> None:
    global _cpu_pool
    if _cpu_pool is not None:
        _cpu_pool.shutdown(wait=wait, cancel_futures=True)
        _cpu_pool = None


# ── Serialising "is there a duplicate?" + "insert the row" ────────────────────

# Several downloads run concurrently, and the Peapix and Windows10Spotlight copies of one picture are
# often in flight together.  If the duplicate check and the insert were not one critical section both
# copies would pass the check (neither row exists yet) and the picture would be stored twice.  Only that
# cheap last step is serialised – fetching and the CPU-heavy decode / hash / thumbnail work stay parallel.
# asyncio locks belong to the loop they are first used in and every engine run creates its own loop,
# hence one lock per loop.
_store_locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = (
    weakref.WeakKeyDictionary()
)


def _store_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _store_locks.get(loop)
    if lock is None:
        lock = _store_locks[loop] = asyncio.Lock()
    return lock


# ══════════════════════════════════════════════════════════════════════════
# CPU-bound helpers (run in the thread pool)
# ══════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ImageInfo:
    width: int
    height: int
    phash: str
    thumb: bytes
    fmt: str


def render_thumbnail(img: Image.Image) -> bytes:
    """Centre-crop to 16 : 9, resize to :data:`THUMB_SIZE`, return progressive JPEG bytes."""
    target_ratio = THUMB_SIZE[0] / THUMB_SIZE[1]
    w, h = img.size
    ratio = w / h
    if ratio > target_ratio:
        new_w = int(h * target_ratio)
        offset = (w - new_w) // 2
        img = img.crop((offset, 0, offset + new_w, h))
    elif ratio < target_ratio:
        new_h = int(w / target_ratio)
        offset = (h - new_h) // 2
        img = img.crop((0, offset, w, offset + new_h))
    thumb = img.resize(THUMB_SIZE, _LANCZOS, reducing_gap=3.0)
    buffer = io.BytesIO()
    thumb.save(buffer, "JPEG", quality=THUMB_QUALITY, optimize=True, progressive=True)
    return buffer.getvalue()


def analyze_image(data: bytes) -> ImageInfo:
    """
    Decode ``data`` once and derive everything the pipeline needs.

    Raises ``ValueError`` / ``OSError`` for corrupt or absurdly large images.
    """
    with Image.open(io.BytesIO(data)) as im:
        fmt = im.format or "JPEG"
        width, height = im.size
        if width < 1 or height < 1 or width * height > MAX_PIXELS:
            raise ValueError(f"unsupported image dimensions {width}x{height}")
        rgb = im.convert("RGB")
    try:
        return ImageInfo(width, height, dhash_hex(rgb), render_thumbnail(rgb), fmt)
    finally:
        rgb.close()


def regenerate_thumbnail(source_path: Path, dest_path: Path) -> None:
    """Rebuild a missing thumbnail from a stored full-size image (maintenance)."""
    with Image.open(source_path) as im:
        rgb = im.convert("RGB")
    try:
        atomic_write_bytes(dest_path, render_thumbnail(rgb))
    finally:
        rgb.close()


# ══════════════════════════════════════════════════════════════════════════
# Network
# ══════════════════════════════════════════════════════════════════════════


class FetchError(Exception):
    """Download failed.  ``permanent`` failures are not worth retrying."""

    def __init__(self, message: str, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


@dataclass(frozen=True)
class FetchResult:
    data: bytes
    url: str  # the URL variant that was actually downloaded


_UHD_URL = re.compile(r"^(?P<base>.*/[a-f0-9]{32})_UHD\.jpg$", re.IGNORECASE)
_IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")


def url_variants(url: str) -> list[str]:
    """The URL itself plus – for Peapix UHD images – its lower-resolution fallbacks."""
    match = _UHD_URL.match(url)
    if not match:
        return [url]
    base = match.group("base")
    return [url, f"{base}_1920.jpg", f"{base}_1280.jpg", f"{base}_640.jpg"]


async def _read_capped(resp: aiohttp.ClientResponse, limit: int) -> bytes:
    declared = resp.content_length
    if declared is not None and declared > limit:
        raise FetchError(f"image too large ({declared} bytes)", permanent=True)
    chunks: list[bytes] = []
    total = 0
    async for chunk in resp.content.iter_chunked(64 * 1024):
        total += len(chunk)
        if total > limit:
            raise FetchError(f"image exceeds {limit} bytes", permanent=True)
        chunks.append(chunk)
    return b"".join(chunks)


async def fetch_image(
    session: aiohttp.ClientSession, url: str, *, allow_degrade: bool = False
) -> FetchResult:
    """
    Download ``url`` (or its best available fallback variant).

    ``allow_degrade`` additionally permits falling back to a lower resolution
    after *transient* errors – used for the final retry only.
    """
    variants = url_variants(url)
    last_transient: FetchError | None = None
    for candidate in variants:
        try:
            async with session.get(candidate, allow_redirects=True) as resp:
                if resp.status in (404, 403, 410):
                    continue  # this variant does not exist → next (lower) one
                if resp.status != 200:
                    raise FetchError(f"HTTP {resp.status}")
                ctype = resp.headers.get("Content-Type", "").lower()
                if ctype and not ctype.startswith(("image/", "application/octet-stream")):
                    if not candidate.lower().endswith(_IMAGE_EXT):
                        continue  # an HTML error page served with 200
                data = await _read_capped(resp, settings.MAX_IMAGE_BYTES)
        except asyncio.CancelledError:
            raise
        except FetchError as exc:
            if exc.permanent:
                raise
            last_transient = exc
            if not allow_degrade:
                raise
            continue
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            last_transient = FetchError(f"{type(exc).__name__}: {exc}")
            if not allow_degrade:
                raise last_transient from exc
            continue
        if len(data) < MIN_IMAGE_BYTES:
            continue  # suspiciously small → treat like a missing variant
        if candidate != url:
            log.debug("Used fallback variant: %s", candidate)
        return FetchResult(data, candidate)
    if last_transient is not None:
        raise last_transient
    raise FetchError("not found", permanent=True)


# ══════════════════════════════════════════════════════════════════════════
# Main pipeline
# ══════════════════════════════════════════════════════════════════════════


async def process_download(
    session: aiohttp.ClientSession,
    item: dict,
    *,
    pool: ThreadPoolExecutor | None = None,
) -> Outcome:
    """
    Download and store one wallpaper.

    Returns
    -------
    ``downloaded``  new wallpaper stored
    ``replaced``    stored; an older, lower-quality duplicate was removed
    ``duplicate``   an equal or better copy already exists – nothing stored
    ``failed``      transient problem – the engine should retry the item later
    ``rejected``    permanent problem (corrupt / tiny / missing) – drop the item
    """
    loop = asyncio.get_running_loop()
    pool = pool or get_cpu_pool()
    url = item["image_url"]
    source = item.get("source", "unknown")

    # ── 1. fetch ──────────────────────────────────────────────────────────
    allow_degrade = int(item.get("retries", 0)) >= settings.MAX_RETRIES
    try:
        fetched = await fetch_image(session, url, allow_degrade=allow_degrade)
    except FetchError as exc:
        if exc.permanent:
            log.warning("✗ Gone: %s (%s)", url, exc)
            return "rejected"
        log.warning("✗ Failed (will retry): %s (%s)", url, exc)
        return "failed"

    # ── 2. analyse (decode + hash + thumbnail in ONE pool job) ────────────
    try:
        info: ImageInfo = await loop.run_in_executor(pool, analyze_image, fetched.data)
    except Exception as exc:  # noqa: BLE001 – any decode problem means "bad image"
        log.warning("✗ Cannot decode %s: %s", url, exc)
        return "rejected"
    if info.width < settings.MIN_IMAGE_WIDTH:
        log.warning("✗ Too small (%dx%d): %s", info.width, info.height, url)
        return "rejected"

    file_size = len(fetched.data)
    new_score = quality_score(info.width, info.height, file_size)

    # ── 3 + 4. de-duplicate, then store – ONE critical section (see _store_lock) ─────
    async with _store_lock():
        existing = find_duplicate_wallpaper(info.phash, DEFAULT_MAX_DISTANCE)
        title = item.get("title", "")
        tags = item.get("tags", "")
        date_spotted = item.get("date_spotted", "")
        replaced = False

        if existing:
            old_score = quality_score(existing["width"], existing["height"], existing["file_size"])
            if new_score <= old_score:
                merge_wallpaper_metadata(
                    existing["id"], title=title, tags=tags, date_spotted=date_spotted
                )
                add_suppressed_url(fetched.url, reason="duplicate_lower_quality")
                if url != fetched.url:
                    add_suppressed_url(url, reason="duplicate_lower_quality")
                increment_stat("duplicates_skipped")
                log.debug("⊘ Duplicate (kept existing): %s", url)
                return "duplicate"

            # The new copy is strictly better: carry the old metadata over, drop the old files.
            title = choose_title(existing["title"], title)
            tags = merge_tags(existing["tags"], tags)
            date_spotted = existing["date_spotted"] or date_spotted
            item = {**item, "page_url": item.get("page_url") or existing["page_url"]}
            storage.delete_wallpaper_files(existing["filename"])
            for old_url in (existing.get("source_url"), existing.get("page_url")):
                if old_url and old_url != fetched.url:
                    add_suppressed_url(old_url, reason="duplicate_lower_quality")
            delete_wallpaper(existing["phash"])
            increment_stat("duplicates_replaced")
            replaced = True
            log.info("↑ Replaced with higher quality: %s", existing["filename"])

        # ── 4. store files, then the DB row ───────────────────────────────────
        filename = storage.url_to_filename(source, fetched.url, storage.extension_for_format(info.fmt))
        try:
            await loop.run_in_executor(pool, storage.write_image, filename, fetched.data)
            await loop.run_in_executor(pool, storage.write_thumbnail, filename, info.thumb)
            upsert_wallpaper(
                {
                    "phash": info.phash,
                    "filename": filename,
                    "title": (title or "").strip(),
                    "source": source,
                    "source_url": fetched.url,
                    "page_url": item.get("page_url", ""),
                    "width": info.width,
                    "height": info.height,
                    "file_size": file_size,
                    "tags": tags,
                    "date_spotted": date_spotted,
                    "downloaded_at": utcnow_iso(),
                    "quality": quality_label(info.width),
                }
            )
        except BaseException:
            storage.delete_wallpaper_files(filename)  # never leave orphans behind
            raise
        increment_stat("downloaded_count")

    log.info(
        "✓ %s  %dx%d  %s  %.2f MB%s",
        filename.split("/")[-1][:12],
        info.width,
        info.height,
        quality_label(info.width),
        file_size / 1_048_576,
        "  (replaced lower quality)" if replaced else "",
    )
    return "replaced" if replaced else "downloaded"
