#!/usr/bin/env python3
"""
Generate the app icons in ``static/icons`` (only Pillow required).

The artwork mirrors the in-app brand mark: a cyan→indigo rounded square, a bright
"spotlight" sun and two mountain silhouettes.  Run ``python scripts/make_icons.py``
after changing the design; the output is committed so nobody needs to run it.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "static" / "icons"
TOP, BOTTOM = (56, 189, 248), (99, 102, 241)  # #38bdf8 → #6366f1
SUN = (344, 176, 58)  # cx, cy, r  (512 px design grid)
MOUNTAINS = [(0, 400), (128, 256), (216, 336), (312, 224), (512, 416), (512, 512), (0, 512)]
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
    <clipPath id="c"><rect width="512" height="512" rx="116"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="512" height="512" fill="url(#g)"/>
    <circle cx="344" cy="176" r="58" fill="#fff" fill-opacity=".96"/>
    <path d="M0 400 128 256l88 80 96-112L512 416v96H0z" fill="#0b1226" fill-opacity=".72"/>
  </g>
</svg>
"""


def gradient(size: int) -> Image.Image:
    ramp = Image.linear_gradient("L").resize((size, size))
    diagonal = ImageChops.add(ramp, ramp.rotate(90), scale=2)  # top-left dark → bottom-right light
    return Image.composite(Image.new("RGB", (size, size), BOTTOM), Image.new("RGB", (size, size), TOP), diagonal)


def artwork(size: int, scale: float = 1.0, rounded: bool = True) -> Image.Image:
    """
    Render at 4× and downsample for smooth edges.

    ``scale`` < 1 pulls the sun and the peaks towards the centre (the *safe zone* of a
    maskable icon) while the mountain silhouette stays full-bleed to the bottom edge.
    """
    big = size * 4
    k = big / 512

    def to_safe(x: float, y: float) -> tuple[float, float]:
        return (x - 256) * scale + 256, (y - 256) * scale + 256

    base = gradient(big).convert("RGBA")
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    cx, cy, r = SUN
    scx, scy = to_safe(cx, cy)
    sr = r * scale
    ImageDraw.Draw(layer).ellipse([(scx - sr) * k, (scy - sr) * k, (scx + sr) * k, (scy + sr) * k], fill=(255, 255, 255, 245))

    pts = [to_safe(x, y) for x, y in MOUNTAINS]
    if scale != 1.0:  # first/last ridge points reach the side edges, the base the bottom edge
        pts[0], pts[4] = (0, pts[0][1]), (512, pts[4][1])
        pts[5], pts[6] = (512, 512), (0, 512)
    mountain = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(mountain).polygon([(x * k, y * k) for x, y in pts], fill=(11, 18, 38, 184))
    art = Image.alpha_composite(base, Image.alpha_composite(layer, mountain))
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(116 * k), fill=255)
        art.putalpha(mask)
    return art.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "favicon.svg").write_text(SVG, encoding="utf-8")
    artwork(512).save(OUT / "icon-512.png", optimize=True)
    artwork(192).save(OUT / "icon-192.png", optimize=True)
    artwork(512, scale=0.78, rounded=False).convert("RGB").save(OUT / "icon-maskable-512.png", optimize=True)
    artwork(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    for path in sorted(OUT.iterdir()):
        print(f"{path.relative_to(OUT.parents[1])}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
