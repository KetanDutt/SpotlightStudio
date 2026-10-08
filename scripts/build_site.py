"""Build an allow-listed static site; never publish the database, logs or source tree.

Run from any directory: python scripts/build_site.py
Output is dist/site (disposable, ignored). Images are served from GitHub LFS by the UI.
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = (
    "index.html", "manifest.webmanifest", "sw.js", "data/wallpapers.json",
    "static/css/app.css", "static/css/tokens.css",
    "static/js/app.js", "static/js/core.js", "static/js/theme-init.js",
    "static/icons/favicon.svg", "static/icons/apple-touch-icon.png",
    "static/icons/icon-192.png", "static/icons/icon-512.png", "static/icons/icon-maskable-512.png",
)


def build_site(root: Path = ROOT) -> Path:
    root = root.resolve()
    destination = root / "dist" / "site"
    # Fixed output location: never accept an arbitrary path to recursively remove.
    if destination.is_symlink() or (root / "dist").is_symlink():
        raise ValueError("Refusing a symlinked build destination")
    # Validate sources BEFORE replacing a working artifact. Even a .css-named
    # symlink could point at credentials; copying entire asset folders is unsafe.
    for name in PUBLIC_FILES:
        source = root / name
        if any(part.is_symlink() for part in (source, *source.parents) if part != root):
            raise ValueError(f"Refusing a symlinked public source: {name}")
        if not source.is_file():
            raise FileNotFoundError(f"Missing public source: {name}")
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in PUBLIC_FILES:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
    (destination / ".nojekyll").touch()
    return destination


if __name__ == "__main__":
    print(f"Static site: {build_site()}")
