"""
storage.py – where wallpapers live on disk and how they are written / removed.

Layout (all paths relative to ``settings.IMAGES_DIR``)::

    peapix/<sha256(bytes)>.jpg            full resolution image
    win10spotlight/<sha256(bytes)>.jpg
    thumbs/peapix/<…>.jpg                    480×270 thumbnail (same relative name)
    thumbs/win10spotlight/<…>.jpg

New downloads are content addressed (SHA-256 of image bytes). Legacy URL-derived
32-character filenames remain supported and are not renamed.
"""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

from src.config import settings
from src.utils import atomic_write_bytes, is_lfs_pointer

log = logging.getLogger("storage")

_SOURCE_SAFE = re.compile(r"[^a-zA-Z0-9_-]")
_FORMAT_EXT = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


def clean_source(source: str | None) -> str:
    """Sanitise a source name so it is safe to use as a directory name."""
    return _SOURCE_SAFE.sub("", source or "") or "other"


def extension_for_format(fmt: str | None) -> str:
    """File extension for a Pillow image format (defaults to ``jpg``)."""
    return _FORMAT_EXT.get((fmt or "").upper(), "jpg")


def url_to_filename(source: str, url: str, ext: str = "jpg") -> str:
    """Deterministic relative filename (``source/hash.ext``) for a source URL."""
    digest = hashlib.sha256(url.encode()).hexdigest()[:32]
    return f"{clean_source(source)}/{digest}.{ext}"


def _safe_join(base: Path, relative: str) -> Path:
    """Join ``relative`` onto ``base`` refusing anything that escapes ``base``."""
    candidate = (base / relative).resolve()
    base_resolved = base.resolve()
    if candidate != base_resolved and base_resolved not in candidate.parents:
        raise ValueError(f"Path escapes storage root: {relative!r}")
    return candidate


def image_path(filename: str) -> Path:
    """Absolute path of a full-resolution wallpaper."""
    return _safe_join(settings.IMAGES_DIR, filename)


def thumb_path(filename: str) -> Path:
    """Absolute path of the thumbnail belonging to ``filename``."""
    return _safe_join(settings.THUMBS_DIR, filename)


def write_image(filename: str, data: bytes) -> Path:
    """Atomically store a full-resolution image."""
    dest = image_path(filename)
    atomic_write_bytes(dest, data)
    return dest


def write_thumbnail(filename: str, data: bytes) -> Path:
    """Atomically store a thumbnail."""
    dest = thumb_path(filename)
    atomic_write_bytes(dest, data)
    return dest


def delete_wallpaper_files(filename: str) -> int:
    """
    Remove the full image and its thumbnail (including legacy *flat* copies
    from the v1 layout).  Returns the number of files deleted; never raises.
    """
    removed = 0
    flat = Path(filename).name
    for base in (settings.IMAGES_DIR, settings.THUMBS_DIR):
        for rel in {filename, flat}:
            try:
                target = _safe_join(base, rel)
            except ValueError:
                continue
            try:
                if target.is_file():
                    target.unlink()
                    removed += 1
            except OSError as exc:
                log.warning("Could not delete %s: %s", target, exc)
    return removed


def count_lfs_pointers(sample: int = 40) -> tuple[int, int]:
    """
    Inspect up to ``sample`` stored images and return ``(pointers, inspected)``.

    The repository keeps images in **Git LFS**.  When a clone was made without
    ``git lfs pull`` every ``*.jpg`` is a ~130 byte text pointer, which makes the
    gallery look empty – this check lets the app explain that instead of failing
    silently.
    """
    root = settings.IMAGES_DIR
    if not root.exists():
        return 0, 0
    inspected = pointers = 0
    for source_dir in sorted(p for p in root.iterdir() if p.is_dir() and p.name != "thumbs"):
        for path in source_dir.iterdir():
            if not path.is_file():
                continue
            inspected += 1
            if is_lfs_pointer(path):
                pointers += 1
            if inspected >= sample:
                return pointers, inspected
    return pointers, inspected
