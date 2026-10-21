#!/usr/bin/env python3
"""
Flatten the Roku channel artwork so it contains no transparency.

Roku certification test **6.4** requires that Streaming Store artwork and splash
screens are *not* transparent.  ``scripts/make_icons.py`` builds the Roku tiles
and splashes as RGBA images (rounded emblem corners, soft halos), which leaves a
handful of semi-transparent pixels that fail that test.

This script composites every PNG under ``roku/images/`` onto the solid channel
backdrop (``#08090E``, the same colour as the manifest ``splash_color``) and
rewrites it as an 8-bit RGB PNG with no alpha channel at all.

It is deliberately dependency-free (``zlib`` + ``struct`` only) so it can run in
CI and on machines without Pillow; ``make icons`` already flattens at generation
time when Pillow is available.

    python3 scripts/flatten_roku_art.py            # fix in place
    python3 scripts/flatten_roku_art.py --check    # CI: fail if anything is transparent
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_DIRS = (ROOT / "roku" / "images",)

#: Matches splash_color in roku/manifest.
BACKDROP = (0x08, 0x09, 0x0E)

CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path: Path) -> tuple[int, int, int, int, bytes]:
    """Decode a non-interlaced 8-bit PNG.  Returns (w, h, colour type, bpp, rgb)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")

    pos = 8
    idat = b""
    plte: bytes = b""
    trns: bytes = b""
    width = height = colour = 0
    interlace = 0

    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8:
                raise ValueError(f"{path.name} is not 8-bit (depth={depth})")
            if interlace:
                raise ValueError(f"{path.name} is interlaced")
        elif kind == b"PLTE":
            plte = chunk
        elif kind == b"tRNS":
            trns = chunk
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
        pos += 12 + length

    if colour not in CHANNELS:
        raise ValueError(f"{path.name} has unsupported colour type {colour}")

    channels = CHANNELS[colour]
    stride = width * channels
    raw = zlib.decompress(idat)

    out = bytearray(height * stride)
    prev = bytearray(stride)
    cursor = 0
    for y in range(height):
        filter_type = raw[cursor]
        cursor += 1
        line = bytearray(raw[cursor : cursor + stride])
        cursor += stride

        if filter_type == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif filter_type == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                upleft = prev[i - channels] if i >= channels else 0
                predictor = left + up - upleft
                dl, du, dul = abs(predictor - left), abs(predictor - up), abs(predictor - upleft)
                if dl <= du and dl <= dul:
                    chosen = left
                elif du <= dul:
                    chosen = up
                else:
                    chosen = upleft
                line[i] = (line[i] + chosen) & 255
        elif filter_type != 0:
            raise ValueError(f"{path.name} uses unknown filter {filter_type}")

        out[y * stride : (y + 1) * stride] = line
        prev = line

    planes = to_rgb(bytes(out), width, height, colour, plte, trns)
    return width, height, colour, channels, planes


def to_rgb(pixels: bytes, width: int, height: int, colour: int, plte: bytes, trns: bytes) -> tuple[bytes, bytes | None]:
    """Return (rgb bytes, alpha bytes or None) for any of the five colour types."""
    channels = CHANNELS[colour]
    if colour == 2:
        return pixels, None
    if colour == 6:
        rgb = bytearray()
        alpha = bytearray()
        for i in range(0, len(pixels), 4):
            rgb += pixels[i : i + 3]
            alpha.append(pixels[i + 3])
        return bytes(rgb), bytes(alpha)
    if colour == 0:  # greyscale
        rgb = bytearray()
        for gray in pixels:
            rgb += bytes((gray, gray, gray))
        return bytes(rgb), None
    if colour == 4:  # greyscale + alpha
        rgb = bytearray()
        alpha = bytearray()
        for i in range(0, len(pixels), 2):
            gray = pixels[i]
            rgb += bytes((gray, gray, gray))
            alpha.append(pixels[i + 1])
        return bytes(rgb), bytes(alpha)
    # colour == 3: palette
    rgb = bytearray()
    alpha = bytearray()
    has_trns = len(trns) > 0
    for index in pixels:
        base = index * 3
        rgb += plte[base : base + 3] if base + 3 <= len(plte) else b"\x00\x00\x00"
        alpha.append(trns[index] if has_trns and index < len(trns) else 255)
    return bytes(rgb), bytes(alpha) if has_trns else None


def composite(rgb: bytes, alpha: bytes | None, width: int, height: int) -> bytes:
    """Alpha-composite onto the solid backdrop, returning opaque RGB bytes."""
    if alpha is None:
        return rgb
    out = bytearray(len(rgb))
    br, bg, bb = BACKDROP
    for i in range(width * height):
        a = alpha[i]
        if a == 255:
            out[i * 3 : i * 3 + 3] = rgb[i * 3 : i * 3 + 3]
            continue
        if a == 0:
            out[i * 3], out[i * 3 + 1], out[i * 3 + 2] = br, bg, bb
            continue
        src = i * 3
        dst = i * 3
        out[dst] = (rgb[src] * a + br * (255 - a)) // 255
        out[dst + 1] = (rgb[src + 1] * a + bg * (255 - a)) // 255
        out[dst + 2] = (rgb[src + 2] * a + bb * (255 - a)) // 255
    return bytes(out)


def write_png(path: Path, width: int, height: int, rgb: bytes) -> None:
    """Write an 8-bit truecolour PNG (colour type 2 - no alpha channel)."""
    stride = width * 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        raw += rgb[y * stride : (y + 1) * stride]

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def process(path: Path, check_only: bool) -> tuple[bool, str]:
    """Returns (needs_fixing, human readable detail)."""
    width, height, colour, _channels, result = read_png(path)
    rgb, alpha = result
    min_alpha = 255 if alpha is None else min(alpha)
    detail = f"{path.name} {width}x{height} colour-type={colour} min-alpha={min_alpha}"
    if min_alpha == 255 and colour in (0, 2):
        return False, detail + " (already opaque, no alpha channel)"

    reason = "opaque but still carries an alpha channel"
    if min_alpha < 255:
        reason = "TRANSPARENT - fails certification 6.4"
    if check_only:
        return True, detail + f" ({reason})"

    write_png(path, width, height, composite(rgb, alpha, width, height))
    backdrop = "#{:02X}{:02X}{:02X}".format(*BACKDROP)
    return True, detail + f" ({reason}) -> rewritten as opaque RGB on {backdrop}, {path.stat().st_size:,} bytes"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report only; exit 1 if any artwork is transparent")
    args = parser.parse_args(argv)

    targets: list[Path] = []
    for directory in TARGET_DIRS:
        if directory.exists():
            targets.extend(sorted(directory.glob("*.png")))
    if not targets:
        print("no Roku artwork found", file=sys.stderr)
        return 1

    failures = 0
    for path in targets:
        try:
            changed, detail = process(path, args.check)
        except ValueError as exc:
            print(f"  error   : {exc}", file=sys.stderr)
            failures += 1
            continue
        marker = "  fix     :" if changed else "  ok      :"
        if args.check and changed:
            marker = "  FAIL    :"
            failures += 1
        print(marker, detail)

    if args.check:
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
