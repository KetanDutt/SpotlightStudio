"""Build an allow-listed static site; never publish the database, logs or source tree.

Run from any directory: python scripts/build_site.py
Output is dist/site (disposable, ignored). Images are served from GitHub LFS by the UI.
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_site(root: Path = ROOT) -> Path:
    destination = root / "dist" / "site"
    # Fixed output location: never accept an arbitrary path to recursively remove.
    if destination.is_symlink() or (root / "dist").is_symlink():
        raise ValueError("Refusing a symlinked build destination")
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in ("index.html", "manifest.webmanifest", "sw.js"):
        shutil.copy2(root / name, destination / name)
    for folder in ("css", "js", "icons"):
        shutil.copytree(root / "static" / folder, destination / "static" / folder)
    (destination / "static" / "js" / "api-docs.js").unlink(missing_ok=True)
    (destination / "data").mkdir()
    shutil.copy2(root / "data" / "wallpapers.json", destination / "data" / "wallpapers.json")
    (destination / ".nojekyll").touch()
    return destination


if __name__ == "__main__":
    print(f"Static site: {build_site()}")
