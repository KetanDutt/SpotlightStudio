"""Validate the public static catalog and its referenced repository assets."""
from __future__ import annotations

import json
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
    for i, row in enumerate(rows):
        where = f"record {i}"
        if not isinstance(row, dict):
            errors.append(f"{where}: expected object")
            continue
        if not str(row.get("title", "")).strip():
            errors.append(f"{where}: title is empty")
        for field in URL_FIELDS:
            value = row.get(field, "")
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{where}: {field} is empty")
                continue
            parsed = urlparse(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append(f"{where}: {field} is not an absolute HTTP(S) URL")
        filename = row.get("filename")
        if (not isinstance(filename, str) or not filename or "\\" in filename
                or Path(filename).is_absolute() or any(part in {"", ".", ".."} for part in filename.split("/"))):
            errors.append(f"{where}: invalid filename")
            continue
        if filename in seen:
            errors.append(f"{where}: duplicate filename {filename}")
        seen.add(filename)
        if not (root / "images" / filename).is_file():
            errors.append(f"{where}: missing images/{filename}")
        if not isinstance(row.get("width"), int) or not isinstance(row.get("height"), int):
            errors.append(f"{where}: dimensions must be integers")
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
