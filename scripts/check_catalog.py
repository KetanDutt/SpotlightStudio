"""Validate the public static catalog and its referenced repository assets."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
URL_FIELDS = ("source_url", "page_url")


def check_catalog(root: Path = ROOT) -> list[str]:
    path = root / "data" / "wallpapers.json"
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"Cannot read catalog: {exc}"]
    if not isinstance(rows, list):
        return ["Catalog root must be a JSON array"]
    errors: list[str] = []
    seen: set[str] = set()
    seen_ids: set[int] = set()
    image_root = (root / "images").resolve()
    for i, row in enumerate(rows):
        where = f"record {i}"
        if not isinstance(row, dict):
            errors.append(f"{where}: expected object")
            continue
        title = row.get("title")
        if not isinstance(title, str) or not title.strip():
            errors.append(f"{where}: title is empty or not text")
        ident = row.get("id")
        if not isinstance(ident, int) or isinstance(ident, bool) or ident < 1:
            errors.append(f"{where}: id must be a positive integer")
        elif ident in seen_ids:
            errors.append(f"{where}: duplicate id {ident}")
        else:
            seen_ids.add(ident)
        source = row.get("source")
        if not isinstance(source, str) or source not in {"peapix", "win10spotlight"}:
            errors.append(f"{where}: invalid source")
        for field in URL_FIELDS:
            value = row.get(field, "")
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{where}: {field} is empty")
                continue
            try:
                parsed = urlparse(value)
                hostname, _port = parsed.hostname, parsed.port
                safe = (parsed.scheme in {"http", "https"} and hostname
                        and parsed.username is None and parsed.password is None)
            except ValueError:
                safe = False
            if not safe:
                errors.append(f"{where}: {field} is not a safe absolute HTTP(S) URL")
        for field in ("width", "height"):
            value = row.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                errors.append(f"{where}: {field} must be a positive integer")
        raw_colors = row.get("colors", "[]")
        try:
            colors = json.loads(raw_colors) if isinstance(raw_colors, str) else raw_colors
        except json.JSONDecodeError:
            colors = None
        if (not isinstance(colors, list) or len(colors) > 5
                or any(not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)
                       for color in colors)):
            errors.append(f"{where}: colors must be a JSON array of up to five #rrggbb values")
        aspect = row.get("aspect_ratio", "")
        if not isinstance(aspect, str) or aspect not in {"", "portrait", "standard", "landscape", "ultrawide"}:
            errors.append(f"{where}: invalid aspect_ratio")

        filename = row.get("filename")
        if (not isinstance(filename, str) or not filename or "\\" in filename
                or Path(filename).is_absolute() or any(part in {"", ".", ".."} for part in filename.split("/"))):
            errors.append(f"{where}: invalid filename")
            continue
        if filename in seen:
            errors.append(f"{where}: duplicate filename {filename}")
        seen.add(filename)
        asset = (root / "images" / filename).resolve()
        if asset != image_root and image_root not in asset.parents:
            errors.append(f"{where}: image path escapes images/")
        elif not asset.is_file():
            errors.append(f"{where}: missing images/{filename}")
    return errors


def main() -> int:
    errors = check_catalog()
    if errors:
        print("Catalog health check failed:")
        print("\n".join(f" - {e}" for e in errors[:100]))
        if len(errors) > 100:
            print(f" ... and {len(errors) - 100} more")
        return 1
    rows = json.loads((ROOT / "data/wallpapers.json").read_text(encoding="utf-8"))
    print(f"Catalog healthy: {len(rows):,} wallpapers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
