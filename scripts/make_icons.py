#!/usr/bin/env python3
"""
Generate the app icons (only Pillow required).

Two destinations, one design – a restrained sage rounded square, a soft "spotlight" sun and
two mountain silhouettes:

* ``static/icons/`` – the PWA (512/192 px, maskable, apple-touch, favicon);
* ``mobile/assets/`` – the Expo app (iOS/Android icons, splash, adaptive icon layers).

Run ``python scripts/make_icons.py`` (or ``make icons``) after changing the design; the
output is committed so nobody needs to run it.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "static" / "icons"
MOBILE = ROOT / "mobile" / "assets"
TOP, BOTTOM = (181, 213, 197), (140, 176, 157)  # Still Glass sage / shaded sage
SUN = (344, 176, 58)  # cx, cy, r  (512 px design grid)
MOUNTAINS = [(0, 400), (128, 256), (216, 336), (312, 224), (512, 416), (512, 512), (0, 512)]
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b5d5c5"/><stop offset="1" stop-color="#8cb09d"/></linearGradient>
    <clipPath id="c"><rect width="512" height="512" rx="116"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="512" height="512" fill="url(#g)"/>
    <circle cx="344" cy="176" r="58" fill="#fff" fill-opacity=".96"/>
    <path d="M0 400 128 256l88 80 96-112L512 416v96H0z" fill="#203e31" fill-opacity=".85"/>
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
    ImageDraw.Draw(mountain).polygon([(x * k, y * k) for x, y in pts], fill=(32, 62, 49, 217))
    art = Image.alpha_composite(base, Image.alpha_composite(layer, mountain))
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(116 * k), fill=255)
        art.putalpha(mask)
    return art.resize((size, size), Image.LANCZOS)


def mobile_assets() -> None:
    """
    The Expo app's icon set.

    * ``icon.png`` – the iOS/generic icon: a full-bleed square (Apple applies its own mask),
      opaque because the App Store rejects transparency.
    * ``splash-icon.png`` – the rounded tile with transparent corners, drawn on the dark
      splash background configured in ``app.json``.
    * ``android-icon-foreground.png`` – the adaptive-icon foreground: same artwork scaled
      into the 66 % safe zone so no launcher mask cuts the peaks off; the dark background
      colour (``android.adaptiveIcon.backgroundColor``) fills whatever is left.
    * ``android-icon-monochrome.png`` – themed icons: the logo as a white alpha mask.
    """
    MOBILE.mkdir(parents=True, exist_ok=True)
    artwork(1024, rounded=False).convert("RGB").save(MOBILE / "icon.png", optimize=True)
    artwork(1024).save(MOBILE / "splash-icon.png", optimize=True)
    artwork(64).save(MOBILE / "favicon.png", optimize=True)
    artwork(1024, scale=0.78, rounded=False).convert("RGB").save(
        MOBILE / "android-icon-foreground.png", optimize=True
    )
    monochrome(1024).save(MOBILE / "android-icon-monochrome.png", optimize=True)


def monochrome(size: int) -> Image.Image:
    """The sun and the peaks as opaque white on a transparent canvas (themed icons)."""
    big = size * 4
    k = big / 512
    scale = 0.78  # keep the shapes inside the adaptive-icon safe zone

    def to_safe(x: float, y: float) -> tuple[float, float]:
        return (x - 256) * scale + 256, (y - 256) * scale + 256

    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy, r = SUN
    scx, scy = to_safe(cx, cy)
    draw.ellipse([(scx - r) * k, (scy - r) * k, (scx + r) * k, (scy + r) * k], fill=(255, 255, 255, 255))
    pts = [to_safe(x, y) for x, y in MOUNTAINS]
    pts[0], pts[4] = (0, pts[0][1]), (512, pts[4][1])
    pts[5], pts[6] = (512, 512), (0, 512)
    draw.polygon([(x * k, y * k) for x, y in pts], fill=(255, 255, 255, 255))
    return layer.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "favicon.svg").write_text(SVG, encoding="utf-8")
    artwork(512).save(OUT / "icon-512.png", optimize=True)
    artwork(192).save(OUT / "icon-192.png", optimize=True)
    artwork(512, scale=0.78, rounded=False).convert("RGB").save(OUT / "icon-maskable-512.png", optimize=True)
    artwork(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    mobile_assets()
    for folder in (OUT, MOBILE):
        for path in sorted(folder.iterdir()):
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
