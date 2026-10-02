"""
utils.py – small, dependency-free helpers shared by the whole backend.

Everything in here is **pure** (no I/O except :func:`atomic_write_bytes`) which
makes it trivial to unit-test.
"""
from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────
# Time
# ──────────────────────────────────────────────────────────────────────────


def utcnow_iso() -> str:
    """Current UTC time as an ISO-8601 string with an explicit ``+00:00`` offset."""
    return datetime.now(timezone.utc).isoformat()


def normalize_timestamp(value: str) -> str:
    """
    Return ``value`` as a timezone-aware ISO string.

    Very old catalog rows were written as *naive* timestamps
    (``2026-10-01T10:08:17.213612``).  They were produced by the same code path
    that later switched to UTC, so naive values are interpreted as UTC.
    """
    value = (value or "").strip()
    if not value:
        return ""
    if re.search(r"(Z|[+-]\d{2}:?\d{2})$", value):
        return value
    return f"{value}+00:00"


# ──────────────────────────────────────────────────────────────────────────
# Dates ("May 14, 2025" → "2025-05-14")
# ──────────────────────────────────────────────────────────────────────────

_MONTHS = {
    name: idx
    for idx, names in enumerate(
        [
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}

_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$")
_YMD_SLASH = re.compile(r"^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$")
_MDY_TEXT = re.compile(r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$")
_DMY_TEXT = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$")


def _valid_ymd(year: int, month: int, day: int) -> str:
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def normalize_date(value: str | None) -> str:
    """
    Normalise the many date spellings used by the source sites to ``YYYY-MM-DD``.

    Peapix writes ``May 14, 2025`` while Windows10Spotlight writes ``2025-05-14``;
    mixing both in one column makes ``ORDER BY date_spotted`` meaningless.
    Month names are parsed manually so the result never depends on the OS locale.
    Unparseable input yields an empty string.
    """
    text = (value or "").strip()
    if not text:
        return ""
    if m := _ISO_DATE.match(text):
        return _valid_ymd(int(m[1]), int(m[2]), int(m[3]))
    if m := _YMD_SLASH.match(text):
        return _valid_ymd(int(m[1]), int(m[2]), int(m[3]))
    if m := _MDY_TEXT.match(text):
        month = _MONTHS.get(m[1].lower())
        return _valid_ymd(int(m[3]), month, int(m[2])) if month else ""
    if m := _DMY_TEXT.match(text):
        month = _MONTHS.get(m[2].lower())
        return _valid_ymd(int(m[3]), month, int(m[1])) if month else ""
    return ""


# ──────────────────────────────────────────────────────────────────────────
# Titles & tags
# ──────────────────────────────────────────────────────────────────────────

_HASH_TITLE = re.compile(r"^[0-9a-f]{32,64}$", re.IGNORECASE)
GENERIC_TITLES = frozenset(
    {
        "",
        "untitled",
        "windows spotlight",
        "windows spotlight wallpaper",
        "windows spotlight image",
        "windows spotlight images",
        "windows10spotlight",
        "spotlight wallpaper",
        "spotlight gallery",
    }
)
DEFAULT_TITLE = "Windows Spotlight Wallpaper"


def is_placeholder_title(title: str | None) -> bool:
    """
    True when ``title`` carries no information.

    Windows10Spotlight lists most posts under their file hash
    (``dfffe373d9c78e79e0d6a28ac186d8c5``) and Peapix falls back to the generic
    ``Windows Spotlight`` alt text; neither is worth showing to a human.
    """
    text = (title or "").strip()
    return bool(_HASH_TITLE.match(text)) or text.lower() in GENERIC_TITLES


def choose_title(old: str | None, new: str | None) -> str:
    """Pick the more informative of two titles (the existing one wins ties)."""
    old = (old or "").strip()
    new = (new or "").strip()
    if is_placeholder_title(old) and not is_placeholder_title(new):
        return new
    return old or new or DEFAULT_TITLE


def split_tags(raw: str | Iterable[str] | None) -> list[str]:
    """Split a comma separated tag string into a clean, de-duplicated list."""
    if raw is None:
        return []
    parts = raw.split(",") if isinstance(raw, str) else list(raw)
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        tag = re.sub(r"\s+", " ", str(part)).strip().lower()
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


def normalize_tags(raw: str | Iterable[str] | None) -> str:
    """Canonical storage form of tags: lower-case, unique, comma separated."""
    return ",".join(split_tags(raw))


def merge_tags(*groups: str | Iterable[str] | None) -> str:
    """Union of several tag collections, preserving first-seen order."""
    merged: list[str] = []
    for group in groups:
        merged.extend(split_tags(group))
    return normalize_tags(merged)


# ──────────────────────────────────────────────────────────────────────────
# Image quality
# ──────────────────────────────────────────────────────────────────────────

QUALITY_4K = "4K / UHD"
QUALITY_2K = "2K / QHD"
QUALITY_FHD = "FHD (1080p)"
QUALITY_HD = "HD (720p)"
QUALITY_SD = "SD"


def quality_label(width: int) -> str:
    """Human readable resolution class derived from the image width."""
    if width >= 3840:
        return QUALITY_4K
    if width >= 2560:
        return QUALITY_2K
    if width >= 1920:
        return QUALITY_FHD
    if width >= 1280:
        return QUALITY_HD
    return QUALITY_SD


_LEGACY_QUALITY = {"FHD": QUALITY_FHD, "UHD": QUALITY_4K, "4K": QUALITY_4K, "HD": QUALITY_HD}


def canonical_quality(label: str | None, width: int = 0) -> str:
    """Map legacy labels (``FHD``) onto the current vocabulary."""
    label = (label or "").strip()
    if label in {QUALITY_4K, QUALITY_2K, QUALITY_FHD, QUALITY_HD, QUALITY_SD}:
        return label
    if label in _LEGACY_QUALITY:
        return _LEGACY_QUALITY[label]
    return quality_label(width) if width else (label or QUALITY_SD)


def quality_score(width: int, height: int, file_size: int) -> int:
    """Higher is better – pixel count first, byte count as the tie-breaker."""
    return width * height * 1_000 + file_size


# ──────────────────────────────────────────────────────────────────────────
# SQL / CSV helpers
# ──────────────────────────────────────────────────────────────────────────


def escape_like(term: str) -> str:
    """Escape ``%``, ``_`` and the escape character itself for ``LIKE … ESCAPE '\\'``."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: object) -> str:
    """
    Neutralise spreadsheet formula injection (OWASP "CSV injection").

    Cells that start with ``= + - @`` are executed as formulas by Excel/Sheets;
    titles come from third-party websites, so we prefix such cells with ``'``.
    """
    text = "" if value is None else str(value)
    if text.startswith(_CSV_FORMULA_PREFIXES):
        return "'" + text
    return text


# ──────────────────────────────────────────────────────────────────────────
# Files
# ──────────────────────────────────────────────────────────────────────────

LFS_MAGIC = b"version https://git-lfs.github.com/spec/"


def is_lfs_pointer(path: Path) -> bool:
    """True when ``path`` is a Git-LFS *pointer file* instead of the real binary."""
    try:
        if path.stat().st_size > 1024:
            return False
        with open(path, "rb") as fh:
            return fh.read(len(LFS_MAGIC)) == LFS_MAGIC
    except OSError:
        return False


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """
    Write ``data`` to ``path`` atomically (temp file + ``os.replace``).

    A crash or power loss therefore never leaves a half-written JPEG behind.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        _replace_with_retry(Path(tmp_name), path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _replace_with_retry(src: Path, dst: Path, attempts: int = 5) -> None:
    """``os.replace`` with a short retry loop (Windows AV scanners hold files briefly)."""
    import time

    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * (attempt + 1))
