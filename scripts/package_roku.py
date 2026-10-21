#!/usr/bin/env python3
"""
Package the Roku channels and run the certification pre-flight checks.

Two variants can be built from this repository:

``channel`` (default)
    ``roku/`` - the Spotlight Studio app.  Pure BrightScript 2D canvas, no
    screensaver entry point, no ``screensaver_title``.

``screensaver``
    ``roku-screensaver/`` - a standalone screensaver app assembled from its own
    ``manifest`` + ``main.brs`` plus the shared modules it needs from
    ``roku/source``.  Roku only allows standalone screensaver apps to ship a
    screensaver, which is why this is a second package rather than a flag on the
    first one.

The script always writes a clean tree into ``dist/`` containing only what Roku
should see (``manifest``, ``source/``, ``images/``, ``assets/``), zips it, and
then runs the checks that Roku's Static Analysis and certification criteria
care about.  Use ``--check`` in CI to run the checks without producing a
package.

    python3 scripts/package_roku.py                       # build the channel
    python3 scripts/package_roku.py --variant screensaver # build the screensaver
    python3 scripts/package_roku.py --check               # CI gate, no artifacts
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROKU_DIR = ROOT / "roku"
SAVER_DIR = ROOT / "roku-screensaver"
DIST_DIR = ROOT / "dist"

#: Certification requirement 3.7 - the app package must be 4 MB or less.
PACKAGE_LIMIT = 4 * 1024 * 1024

#: Modules the screensaver links from the channel source tree.
SAVER_SHARED_MODULES = (
    "utils.brs",
    "constants.brs",
    "gfx_cache.brs",
    "theme.brs",
    "catalog.brs",
    "image_loader.brs",
)

#: APIs Roku has deprecated.  Static Analysis reports these and, after the
#: documented sunset dates, blocks publishing outright.
DEPRECATED_APIS = {
    "InitClientCertificates": "deprecated in Roku OS 16.0; blocked from 1 Apr 2027",
    "enableFreshConnection": "removed in Roku OS 11.5",
    "ShowChannelStoreSpringboard": "deprecated Feb 2025; blocked by Static Analysis",
    "Eval(": "sunset in Roku OS 9.3",
    "roKeyboardScreen": "removed from the Roku OS in 2019",
    "roListScreen": "removed from the Roku OS in 2019",
    "roPosterScreen": "removed from the Roku OS in 2019",
    "roGridScreen": "removed from the Roku OS in 2019",
    "roImageCanvas": "removed from the Roku OS in 2019",
    "roParagraphScreen": "removed from the Roku OS in 2019",
    "roSpringboardScreen": "removed from the Roku OS in 2019",
    "file://": "must be a pkg:/ URL since Roku OS 10.0",
}

#: Artwork Roku requires, with the exact pixel dimensions from cert test 6.4.
REQUIRED_ART = {
    "images/splash_fhd.png": (1920, 1080),
    "images/splash_hd.png": (1280, 720),
    "images/icon_fhd.png": (540, 405),
    "images/icon_hd.png": (290, 218),
}


# ──────────────────────────────────────────────────────────────────────────
# Manifest helpers
# ──────────────────────────────────────────────────────────────────────────

def strip_comments(source: str) -> str:
    """Drop full-line and trailing BrightScript comments before keyword scans."""
    lines = []
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("'"):
            continue
        quote = None
        cut = len(line)
        for index, char in enumerate(line):
            if quote:
                if char == quote:
                    quote = None
            elif char in ('"', "'"):
                quote = char
            elif char == "'" and quote is None:
                cut = index
                break
        lines.append(line[:cut])
    return "\n".join(lines)


def parse_manifest(path: Path) -> dict[str, str]:
    """Parse a Roku manifest (``name=value`` lines, ``#`` comments)."""
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def channel_version(manifest: dict[str, str]) -> str:
    return "{}.{}.{}".format(
        manifest.get("major_version", "0"),
        manifest.get("minor_version", "0"),
        manifest.get("build_version", "0"),
    )


# ──────────────────────────────────────────────────────────────────────────
# Packaging
# ──────────────────────────────────────────────────────────────────────────

def build_channel(dest: Path) -> None:
    """Copy the channel package into a clean tree."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    shutil.copy2(ROKU_DIR / "manifest", dest / "manifest")
    for folder in ("source", "images", "assets"):
        shutil.copytree(ROKU_DIR / folder, dest / folder)


def build_screensaver(dest: Path) -> None:
    """Assemble the standalone screensaver from its own files plus shared modules."""
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "source").mkdir(parents=True)
    shutil.copy2(SAVER_DIR / "manifest", dest / "manifest")
    shutil.copy2(SAVER_DIR / "source" / "main.brs", dest / "source" / "main.brs")
    for name in SAVER_SHARED_MODULES:
        shutil.copy2(ROKU_DIR / "source" / name, dest / "source" / name)
    shutil.copytree(ROKU_DIR / "images", dest / "images")
    (dest / "assets").mkdir()
    shutil.copy2(ROKU_DIR / "assets" / "catalog.json", dest / "assets" / "catalog.json")


def zip_package(tree: Path, archive: Path) -> None:
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(tree.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(tree).as_posix())


def raw_size(tree: Path) -> int:
    return sum(p.stat().st_size for p in tree.rglob("*") if p.is_file())


# ──────────────────────────────────────────────────────────────────────────
# Checks
# ──────────────────────────────────────────────────────────────────────────

def png_info(path: Path) -> tuple[int, int, int]:
    """Return (width, height, colour type) from a PNG IHDR chunk."""
    with path.open("rb") as fh:
        header = fh.read(33)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")
    width, height = struct.unpack(">II", header[16:24])
    return width, height, header[25]


def has_transparency(path: Path) -> bool | None:
    """
    True when the artwork has any semi-transparent pixel, False when it is a
    fully opaque truecolour image, None when the PNG cannot be inspected
    (interlaced or not 8-bit - both of which are flagged separately).

    Uses the dependency-free decoder in flatten_roku_art.py so the check runs
    everywhere, including CI images without Pillow.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from flatten_roku_art import read_png

    try:
        _w, _h, colour, _ch, planes = read_png(path)
    except ValueError:
        return None
    rgb, alpha = planes
    if alpha is None:
        return False
    return min(alpha) < 255


def check(variant: str, tree: Path, problems: list[str], notes: list[str]) -> None:
    """Run every certification pre-flight check against a built package."""
    manifest_path = tree / "manifest"
    if not manifest_path.exists():
        problems.append("manifest is missing")
        return
    manifest = parse_manifest(manifest_path)
    source_dir = tree / "source"
    sources = {p.name: p.read_text(encoding="utf-8") for p in sorted(source_dir.glob("*.brs"))}

    # ── 6.1 non-zero version ───────────────────────────────────────────
    version = channel_version(manifest)
    if version.endswith(".0") or manifest.get("build_version", "0") == "0":
        problems.append(f"cert 6.1: build_version must be non-zero (found {version})")

    # ── required manifest keys ─────────────────────────────────────────
    if variant == "channel":
        if not manifest.get("title"):
            problems.append("manifest is missing title=")
        if "screensaver_title" in manifest:
            problems.append(
                "cert 4.5: screensaver_title blocks publishing for a non-screensaver app"
            )
        if "screensaver_private" in manifest:
            problems.append("cert 4.5: remove screensaver_private from the channel manifest")
        if manifest.get("supports_input_launch") != "1":
            problems.append("cert 5.2: supports_input_launch=1 is required for Direct to Play")
        entry_points = ("Main", "RunUserInterface")
        if not any(re.search(rf"^\s*sub\s+{ep}\s*\(", body, re.M) for body in sources.values() for ep in entry_points):
            problems.append("no Main() or RunUserInterface() entry point found")
        if any(re.search(r"^\s*sub\s+RunScreenSaver\s*\(", body, re.M) for body in sources.values()):
            problems.append("cert 4.5: RunScreenSaver() is prohibited in a non-screensaver app")
    else:
        if not manifest.get("screensaver_title"):
            problems.append("a screensaver manifest must declare screensaver_title=")
        if manifest.get("title"):
            problems.append(
                "a standalone screensaver must NOT declare title= - it makes Static Analysis "
                "classify the package as a channel shipping an in-channel screensaver"
            )
        joined = "\n".join(strip_comments(body) for body in sources.values())
        if re.search(r"^\s*sub\s+(Main|RunUserInterface)\s*\(", joined, re.M):
            problems.append("screensavers must not define Main() or RunUserInterface()")
        if not re.search(r"^\s*sub\s+RunScreenSaver\s*\(", joined, re.M):
            problems.append("a screensaver must define RunScreenSaver()")
        for banned in ("roChannelStore", "roAudioPlayer", "roVideoPlayer"):
            if banned in joined:
                problems.append(f"screensavers may not use {banned}")

    # ── 3.7 package size ───────────────────────────────────────────────
    size = raw_size(tree)
    if size > PACKAGE_LIMIT:
        problems.append(f"cert 3.7: package is {size / 1024 / 1024:.2f} MB, limit is 4 MB")

    # ── 6.4 artwork ────────────────────────────────────────────────────
    for relpath, (want_w, want_h) in REQUIRED_ART.items():
        art = tree / relpath
        if not art.exists():
            problems.append(f"cert 6.4: {relpath} is missing")
            continue
        try:
            width, height, colour = png_info(art)
        except ValueError as exc:
            problems.append(f"cert 6.4: {exc}")
            continue
        if (width, height) != (want_w, want_h):
            problems.append(f"cert 6.4: {relpath} is {width}x{height}, expected {want_w}x{want_h}")
        transparent = has_transparency(art)
        if transparent is True:
            problems.append(
                f"cert 6.4: {relpath} contains transparent pixels - "
                "run: python3 scripts/flatten_roku_art.py"
            )
        elif transparent is None:
            notes.append(f"{relpath} could not be decoded for the opacity check")
        elif colour not in (0, 2):
            problems.append(
                f"cert 6.4: {relpath} still carries an alpha channel - "
                "run: python3 scripts/flatten_roku_art.py"
            )
        declared = [v for v in manifest.values() if v == f"pkg:/{relpath}"]
        if not declared:
            problems.append(f"cert 6.4: {relpath} is not referenced by the manifest")

    # ── deprecated APIs ────────────────────────────────────────────────
    for name, body in sources.items():
        for needle, reason in DEPRECATED_APIS.items():
            for lineno, line in enumerate(strip_comments(body).splitlines(), 1):
                if needle in line:
                    problems.append(f"deprecated API {needle} in source/{name}:{lineno} - {reason}")

    # ── catalog freshness ──────────────────────────────────────────────
    catalog = tree / "assets" / "catalog.json"
    if catalog.exists():
        try:
            entries = json.loads(catalog.read_text(encoding="ascii"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            problems.append(f"catalog.json is not parseable ASCII JSON: {exc}")
            entries = []
        if isinstance(entries, list):
            if not entries:
                problems.append("catalog.json is empty")
            else:
                notes.append(f"catalog.json holds {len(entries):,} wallpapers ({catalog.stat().st_size / 1024:,.0f} KB)")
                required = {"id", "filename", "title", "tags", "date_spotted", "source", "quality"}
                missing = required - set(entries[0])
                if missing:
                    problems.append(f"catalog.json rows are missing fields: {sorted(missing)}")
    else:
        problems.append("assets/catalog.json is missing")

    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build_roku_catalog.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if result.returncode != 0:
        problems.append("roku/assets/catalog.json is out of date - run: make roku-catalog")


def lint() -> tuple[bool, str]:
    """Run the BrightScript compile gate (BrighterScript) over both packages."""
    tooling = ROOT / "scripts" / "roku"
    if not (tooling / "node_modules").exists():
        return True, "skipped (run: cd scripts/roku && npm install)"
    outputs = []
    ok = True
    for config in ("bsconfig.json", "bsconfig-screensaver.json"):
        proc = subprocess.run(
            ["npx", "--no-install", "bsc", "--project", config, "--diagnostic-level", "info"],
            capture_output=True,
            text=True,
            cwd=tooling,
        )
        lines = proc.stdout.splitlines()
        # BS1013 ("file is not referenced by any other file") is expected: Roku
        # compiles every .brs in source/ into one program, so no file imports
        # another.  Everything else is a real signal.
        errors = [ln for ln in lines if " - error " in ln]
        warnings = [ln for ln in lines if " - warning " in ln and "BS1013" not in ln]
        if errors:
            ok = False
            outputs.append(f"{config}: {len(errors)} error(s)")
            outputs.extend("    " + e for e in errors[:20])
        elif warnings:
            outputs.append(f"{config}: {len(warnings)} warning(s)")
            outputs.extend("    " + w for w in warnings[:20])
        else:
            outputs.append(f"{config}: clean")
    return ok, "\n".join(outputs)


# ──────────────────────────────────────────────────────────────────────────

def build(variant: str) -> tuple[Path, Path]:
    manifest = parse_manifest((ROKU_DIR if variant == "channel" else SAVER_DIR) / "manifest")
    version = channel_version(manifest)
    name = "spotlight-studio" if variant == "channel" else "spotlight-studio-screensaver"
    tree = DIST_DIR / f"{name}-{version}"
    archive = DIST_DIR / f"{name}-{version}.zip"

    if variant == "channel":
        build_channel(tree)
    else:
        build_screensaver(tree)
    zip_package(tree, archive)
    return tree, archive


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variant", choices=("channel", "screensaver"), default="channel")
    parser.add_argument("--check", action="store_true", help="run the checks without writing artifacts")
    parser.add_argument("--no-lint", action="store_true", help="skip the BrightScript compile gate")
    args = parser.parse_args(argv)

    if args.check:
        tree = DIST_DIR / f"_check-{args.variant}"
        if args.variant == "channel":
            build_channel(tree)
        else:
            build_screensaver(tree)
    else:
        tree, archive = build(args.variant)

    problems: list[str] = []
    notes: list[str] = []
    check(args.variant, tree, problems, notes)

    print(f"[roku-package] variant: {args.variant}")
    print(f"[roku-package] tree   : {tree.relative_to(ROOT)} ({raw_size(tree) / 1024 / 1024:.2f} MB unpacked)")
    if not args.check:
        print(f"[roku-package] zip    : {archive.relative_to(ROOT)} ({archive.stat().st_size / 1024:.0f} KB)")
    for note in notes:
        print(f"  note    : {note}")

    if not args.no_lint:
        lint_ok, lint_out = lint()
        print("[roku-package] brightscript compile gate:")
        for line in lint_out.splitlines():
            print("  " + line)
        if not lint_ok:
            problems.append("the BrightScript compile gate reported diagnostics")

    if args.check and tree.exists():
        shutil.rmtree(tree)

    if problems:
        print(f"\n[roku-package] FAILED - {len(problems)} problem(s):")
        for problem in problems:
            print(f"  error   : {problem}")
        return 1

    print("\n[roku-package] all certification pre-flight checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
