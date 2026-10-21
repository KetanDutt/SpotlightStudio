#!/usr/bin/env python3
"""
Build the compact wallpaper catalog that ships inside the Roku channel package.

Why this script exists
----------------------
``data/wallpapers.json`` is the canonical export produced by
``src.database.export_catalog_json()``.  It carries every column of the database,
most of which the TV client never reads.  Roku certification requirement **3.7**
caps the whole app package at **4 MB**, and every extra byte also costs parse
time and heap on 512 MB streaming sticks, so the channel ships a trimmed copy:

====================  ==========================================================
Kept                  Reason
====================  ==========================================================
``id``                favourites, daily pick, deep links
``filename``          image + thumbnail URL (``images/<source>/<hash>.jpg``)
``title``             card / HUD copy and free-text search
``tags``              category, tag-preset and search filtering
``date_spotted``      "Spotted" metadata and the newest/oldest sort orders
``source``            the Peapix / Win10Spotlight archive filter
``quality``           the 4K UHD vs. FHD filter and the corner badge
====================  ==========================================================

``width``, ``height``, ``file_size``, ``source_url``, ``page_url`` and
``downloaded_at`` are dropped.  The two dimensions the UI prints are derived on
device from ``quality`` by ``WallpaperDimensions()`` in ``roku/source/utils.brs``.

Usage
-----
    python3 scripts/build_roku_catalog.py            # write roku/assets/catalog.json
    python3 scripts/build_roku_catalog.py --check     # CI: fail if out of date
    python3 scripts/build_roku_catalog.py --source data/wallpapers.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data" / "wallpapers.json"
DEFAULT_DEST = ROOT / "roku" / "assets" / "catalog.json"

#: Fields kept in the Roku payload, in the exact order they are written.
ROKU_FIELDS: tuple[str, ...] = (
    "id",
    "filename",
    "title",
    "tags",
    "date_spotted",
    "source",
    "quality",
)

#: Roku's certification limit for the whole app package (requirement 3.7).
PACKAGE_BUDGET_BYTES = 4 * 1024 * 1024


def load_source(path: Path) -> list[dict[str, Any]]:
    """Read the canonical catalog export."""
    if not path.exists():
        raise SystemExit(f"error: catalog source not found: {path}")
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = data.get("wallpapers") or data.get("items") or []
    if not isinstance(data, list):
        raise SystemExit(f"error: {path} does not contain a list of wallpapers")
    return data


def trim(item: dict[str, Any]) -> dict[str, Any] | None:
    """
    Reduce one wallpaper to the fields the Roku client uses.

    Rows without a usable ``id`` or ``filename`` cannot be rendered or fetched,
    so they are dropped instead of producing broken cards on the TV.
    """
    filename = str(item.get("filename") or "").strip()
    wallpaper_id = item.get("id")
    if not filename or wallpaper_id in (None, ""):
        return None

    record: dict[str, Any] = {
        "id": int(wallpaper_id),
        "filename": filename,
        "title": str(item.get("title") or "").strip(),
        "tags": str(item.get("tags") or "").strip(),
        "date_spotted": str(item.get("date_spotted") or "").strip()[:10],
        "source": str(item.get("source") or "").strip(),
        "quality": str(item.get("quality") or "").strip(),
    }
    # ``source`` is redundant with the filename prefix on every row today, but the
    # TV client reads it directly, so keep it authoritative rather than derived.
    if not record["source"]:
        record["source"] = filename.split("/", 1)[0] if "/" in filename else ""
    return record


def build(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Trim, de-duplicate and sort the catalog (highest ``id`` first)."""
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        record = trim(item)
        if record is None or record["id"] in seen:
            continue
        seen.add(record["id"])
        out.append(record)
    out.sort(key=lambda r: r["id"], reverse=True)
    # Re-key so the JSON field order matches ROKU_FIELDS exactly.
    return [{field: record[field] for field in ROKU_FIELDS} for record in out]


def serialise(records: list[dict[str, Any]]) -> bytes:
    r"""
    Compact, pure-ASCII JSON.

    ``ensure_ascii`` matters here: BrightScript reads the package with
    ``ReadAsciiFile()``, which maps every *byte* to one character.  Raw UTF-8
    (a handful of titles carry Romanian/Turkish diacritics) would therefore be
    mangled into mojibake, while ``\\uXXXX`` escapes are decoded correctly by
    ``ParseJson()``.  The escape form costs ~1.7 KB across the whole archive.
    """
    return json.dumps(records, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def report(records: list[dict[str, Any]], payload: bytes, source_bytes: int) -> str:
    sources: dict[str, int] = {}
    uhd = 0
    for record in records:
        sources[record["source"] or "unknown"] = sources.get(record["source"] or "unknown", 0) + 1
        if "4K" in record["quality"] or "UHD" in record["quality"]:
            uhd += 1
    source_label = ", ".join(f"{k}={v}" for k, v in sorted(sources.items()))
    saved = (1 - len(payload) / source_bytes) * 100 if source_bytes else 0.0
    return (
        f"  wallpapers : {len(records):,} ({source_label})\n"
        f"  4K / UHD   : {uhd:,}\n"
        f"  source     : {source_bytes / 1024:,.0f} KB\n"
        f"  roku json  : {len(payload) / 1024:,.0f} KB ({saved:.0f}% smaller)\n"
        f"  budget     : {len(payload) / PACKAGE_BUDGET_BYTES * 100:.0f}% of the "
        f"{PACKAGE_BUDGET_BYTES // (1024 * 1024)} MB package limit used by the catalog"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="canonical catalog JSON")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="Roku catalog JSON to write")
    parser.add_argument("--check", action="store_true", help="do not write; exit 1 if the output differs")
    args = parser.parse_args(argv)

    source_bytes = args.source.stat().st_size if args.source.exists() else 0
    records = build(load_source(args.source))
    if not records:
        raise SystemExit("error: no usable wallpapers found; refusing to write an empty catalog")

    payload = serialise(records)
    print("[roku-catalog] built from", args.source.relative_to(ROOT))
    print(report(records, payload, source_bytes))

    if args.check:
        current = args.dest.read_bytes() if args.dest.exists() else b""
        if current != payload:
            print(
                f"error: {args.dest.relative_to(ROOT)} is out of date "
                "(run: make roku-catalog)",
                file=sys.stderr,
            )
            return 1
        print("  status     : up to date")
        return 0

    if len(payload) > PACKAGE_BUDGET_BYTES:
        print("error: catalog alone exceeds the 4 MB Roku package limit", file=sys.stderr)
        return 1

    args.dest.parent.mkdir(parents=True, exist_ok=True)
    if args.dest.exists() and args.dest.read_bytes() == payload:
        print("  status     : unchanged")
        return 0
    args.dest.write_bytes(payload)
    print("  status     : wrote", args.dest.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
