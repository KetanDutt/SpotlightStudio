#!/usr/bin/env python3
"""
Generate the app icons and splash images throughout the project (Pillow required).

Three destinations, one unified Archival Graphite & Sunlit Ochre identity:
* ``static/icons/``  - The web PWA & browser icons (512/192 px, maskable, apple-touch, favicon);
* ``mobile/assets/`` - The Expo mobile app (iOS/Android icons, splash, adaptive icon layers);
* ``roku/images/``   - The Roku TV channel (FHD/HD home screen tiles and full splash screens).

Run ``python scripts/make_icons.py`` (or ``--targets web,mobile``) after changing the design.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_STATIC = ROOT / "static" / "icons"
OUT_MOBILE = ROOT / "mobile" / "assets"
OUT_ROKU = ROOT / "roku" / "images"

# ── Color Palette (Archival Graphite & Sunlit Ochre) ──────────────────────────
BG_TOP = (25, 27, 31, 255)        # #191B1F elevated darkroom graphite
BG_BOT = (13, 14, 16, 255)        # #0D0E10 deep darkroom slate
BG_SOLID = (8, 9, 14, 255)        # #08090E Roku manifest splash_color backdrop
ACCENT_OCHRE = (226, 176, 94)     # #E2B05E sunlit ochre
ACCENT_WARM = (242, 207, 142)     # #F2CF8E warm horizon rim
MOUNT_BACK = (38, 41, 48, 255)    # #262930 distant slate ridge
MOUNT_FORE = (20, 22, 26, 255)    # #14161A foreground basalt ridge
RIM_SUBTLE = (255, 255, 255, 34)  # Crisp hairline border (no glass glare)

SUN_COORDS = (340, 172)           # cx, cy (512 px design grid)
SUN_RADIUS = 56

# ── Scalable Vector Favicon (SVG) ─────────────────────────────────────────────
SVG_CONTENT = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#191b1f"/>
      <stop offset="100%" stop-color="#101114"/>
    </linearGradient>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="108"/>
    </clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <circle cx="340" cy="172" r="58" fill="#e2b05e"/>
    <path d="M0 416 L132 264 L224 338 L322 236 L512 414 L512 512 L0 512 Z" fill="#262930"/>
    <path d="M0 416 L132 264 L224 338 L322 236 L512 414" fill="none" stroke="#e2b05e" stroke-width="2.5" stroke-opacity="0.32"/>
    <path d="M0 456 L182 322 L276 392 L404 298 L512 388 L512 512 L0 512 Z" fill="#14161a"/>
    <path d="M0 456 L182 322 L276 392 L404 298 L512 388" fill="none" stroke="#f0f1f3" stroke-width="2" stroke-opacity="0.16"/>
    <rect width="508" height="508" x="2" y="2" rx="106" fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.12"/>
  </g>
</svg>
"""


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load system font if available, fallback to default font."""
    candidates = (
        [
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "/System/Library/Fonts/SFPro-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
        if bold
        else [
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/System/Library/Fonts/SFPro-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    )
    for path_str in candidates:
        p = Path(path_str)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_vertical_gradient(width: int, height: int, top_color: tuple, bot_color: tuple) -> Image.Image:
    """Generate a subtle vertical darkroom slate gradient."""
    base = Image.new("RGBA", (width, height), bot_color)
    top = Image.new("RGBA", (width, height), top_color)
    mask = Image.linear_gradient("L").resize((width, height)).transpose(Image.FLIP_TOP_BOTTOM)
    return Image.composite(top, base, mask)


def draw_artwork(size: int = 512, scale: float = 1.0, rounded: bool = True) -> Image.Image:
    """
    Render clean architectural emblem at 4x supersampling and downsample with Lanczos.
    """
    big = size * 4
    k = big / 512.0

    def to_safe(x: float, y: float) -> tuple[float, float]:
        return (x - 256) * scale + 256, (y - 256) * scale + 256

    # 1. Neutral Graphite Base
    art = make_vertical_gradient(big, big, BG_TOP, BG_BOT)

    # 2. Sunlit Ochre Disc (flat, crisp optical disc — no neon bloom)
    sun_cx, sun_cy = to_safe(SUN_COORDS[0], SUN_COORDS[1])
    sun_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(sun_layer)
    core_r = SUN_RADIUS * scale * k
    s_draw.ellipse(
        [
            (sun_cx * k) - core_r,
            (sun_cy * k) - core_r,
            (sun_cx * k) + core_r,
            (sun_cy * k) + core_r,
        ],
        fill=(ACCENT_OCHRE[0], ACCENT_OCHRE[1], ACCENT_OCHRE[2], 255),
    )
    art = Image.alpha_composite(art, sun_layer)

    # 3A. Back Mountain Ridge
    mount_back_pts = [
        (0, 416),
        (132, 264),
        (224, 338),
        (322, 236),
        (512, 414),
        (512, 512),
        (0, 512),
    ]
    mb_scaled = [to_safe(x, y) for x, y in mount_back_pts]
    if scale != 1.0:
        mb_scaled[0] = (0, mb_scaled[0][1])
        mb_scaled[4] = (512, mb_scaled[4][1])
        mb_scaled[5] = (512, 512)
        mb_scaled[6] = (0, 512)

    mb_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    mb_draw = ImageDraw.Draw(mb_layer)
    mb_poly = [(x * k, y * k) for x, y in mb_scaled]
    mb_draw.polygon(mb_poly, fill=MOUNT_BACK)
    for i in range(len(mb_scaled) - 3):
        p1 = (mb_scaled[i][0] * k, mb_scaled[i][1] * k)
        p2 = (mb_scaled[i + 1][0] * k, mb_scaled[i + 1][1] * k)
        mb_draw.line(
            [p1, p2],
            fill=(ACCENT_WARM[0], ACCENT_WARM[1], ACCENT_WARM[2], 84),
            width=int(2.5 * k),
        )
    art = Image.alpha_composite(art, mb_layer)

    # 3B. Fore Mountain Ridge
    mount_fore_pts = [
        (0, 456),
        (182, 322),
        (276, 392),
        (404, 298),
        (512, 388),
        (512, 512),
        (0, 512),
    ]
    mf_scaled = [to_safe(x, y) for x, y in mount_fore_pts]
    if scale != 1.0:
        mf_scaled[0] = (0, mf_scaled[0][1])
        mf_scaled[4] = (512, mf_scaled[4][1])
        mf_scaled[5] = (512, 512)
        mf_scaled[6] = (0, 512)

    mf_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    mf_draw = ImageDraw.Draw(mf_layer)
    mf_poly = [(x * k, y * k) for x, y in mf_scaled]
    mf_draw.polygon(mf_poly, fill=MOUNT_FORE)
    for i in range(len(mf_scaled) - 3):
        p1 = (mf_scaled[i][0] * k, mf_scaled[i][1] * k)
        p2 = (mf_scaled[i + 1][0] * k, mf_scaled[i + 1][1] * k)
        mf_draw.line(
            [p1, p2],
            fill=(240, 241, 243, 44),
            width=int(2 * k),
        )
    art = Image.alpha_composite(art, mf_layer)

    # 4. Crisp Hairline Frame
    border_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(border_layer)
    if rounded:
        radius = int(108 * k)
        b_draw.rounded_rectangle(
            [int(2 * k), int(2 * k), big - int(3 * k), big - int(3 * k)],
            radius=radius,
            outline=RIM_SUBTLE,
            width=int(2.5 * k),
        )
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=radius, fill=255
        )
        art = Image.alpha_composite(art, border_layer)
        art.putalpha(mask)
    else:
        b_draw.rectangle(
            [int(2 * k), int(2 * k), big - int(3 * k), big - int(3 * k)],
            outline=RIM_SUBTLE,
            width=int(2 * k),
        )
        art = Image.alpha_composite(art, border_layer)

    return art.resize((size, size), Image.LANCZOS)


def monochrome(size: int) -> Image.Image:
    """The sun and the peaks as opaque white on a transparent canvas (Android Material You)."""
    big = size * 4
    k = big / 512.0
    scale = 0.78

    def to_safe(x: float, y: float) -> tuple[float, float]:
        return (x - 256) * scale + 256, (y - 256) * scale + 256

    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = to_safe(SUN_COORDS[0], SUN_COORDS[1])
    r = SUN_RADIUS * scale
    draw.ellipse(
        [(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k],
        fill=(255, 255, 255, 255),
    )

    mount_pts = [
        (0, 416),
        (132, 264),
        (224, 338),
        (322, 236),
        (512, 414),
        (512, 512),
        (0, 512),
    ]
    pts = [to_safe(x, y) for x, y in mount_pts]
    pts[0] = (0, pts[0][1])
    pts[4] = (512, pts[4][1])
    pts[5] = (512, 512)
    pts[6] = (0, 512)
    draw.polygon([(x * k, y * k) for x, y in pts], fill=(255, 255, 255, 255))
    return layer.resize((size, size), Image.LANCZOS)


def flatten_for_roku(image: Image.Image) -> Image.Image:
    """
    Roku certification test 6.4 forbids transparent artwork, and the Roku
    splash/icon must be fully opaque onto ``#08090E`` (manifest ``splash_color``).
    """
    if image.mode != "RGBA":
        return image.convert("RGB")
    backing = Image.new("RGBA", image.size, BG_SOLID)
    return Image.alpha_composite(backing, image).convert("RGB")


def make_roku_icon(w: int = 540, h: int = 405) -> Image.Image:
    """Roku channel store / home screen grid tile."""
    bw, bh = w * 2, h * 2
    canvas = Image.new("RGBA", (bw, bh), BG_SOLID)

    emblem_size = 220
    emblem = draw_artwork(emblem_size * 2, rounded=True)

    shadow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    ex = (bw - emblem_size * 2) // 2
    ey = int(42 * 2)
    s_draw.rounded_rectangle(
        [ex - 8, ey - 4, ex + emblem_size * 2 + 8, ey + emblem_size * 2 + 16],
        radius=int(46 * 2),
        fill=(0, 0, 0, 140),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(emblem, (ex, ey))

    draw = ImageDraw.Draw(canvas)
    f_title = get_font(int(24 * 2), bold=True)
    f_sub = get_font(int(13 * 2), bold=False)

    title_text = "Spotlight Studio"
    tb = draw.textbbox((0, 0), title_text, font=f_title)
    tw = tb[2] - tb[0]
    draw.text(
        ((bw - tw) // 2, int(296 * 2)),
        title_text,
        fill=(240, 241, 243, 255),
        font=f_title,
    )

    sub_text = "4K Windows Spotlight Archive"
    sb = draw.textbbox((0, 0), sub_text, font=f_sub)
    sw = sb[2] - sb[0]
    draw.text(
        ((bw - sw) // 2, int(336 * 2)),
        sub_text,
        fill=(ACCENT_OCHRE[0], ACCENT_OCHRE[1], ACCENT_OCHRE[2], 235),
        font=f_sub,
    )

    return canvas.resize((w, h), Image.LANCZOS)


def make_roku_splash(w: int = 1920, h: int = 1080) -> Image.Image:
    """Full-bleed Roku launch splash screen."""
    canvas = Image.new("RGBA", (w, h), BG_SOLID)
    emblem_size = 320
    emblem = draw_artwork(emblem_size, rounded=True)
    ex = (w - emblem_size) // 2
    ey = 250
    canvas.alpha_composite(emblem, (ex, ey))

    draw = ImageDraw.Draw(canvas)
    f_title = get_font(50, bold=True)
    f_sub = get_font(21, bold=False)

    title_text = "Spotlight Studio"
    tb = draw.textbbox((0, 0), title_text, font=f_title)
    tw = tb[2] - tb[0]
    draw.text(((w - tw) // 2, 624), title_text, fill=(240, 241, 243, 255), font=f_title)

    sub_text = "Curated 4K & Full HD Landscape Photography"
    sb = draw.textbbox((0, 0), sub_text, font=f_sub)
    sw = sb[2] - sb[0]
    draw.text(
        ((w - sw) // 2, 694),
        sub_text,
        fill=(ACCENT_OCHRE[0], ACCENT_OCHRE[1], ACCENT_OCHRE[2], 235),
        font=f_sub,
    )
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Spotlight Studio icon assets.")
    parser.add_argument(
        "--targets",
        default="web,mobile,roku",
        help="Comma-separated asset targets: web,mobile,roku",
    )
    args = parser.parse_args()
    targets = {part.strip() for part in args.targets.split(",") if part.strip()}

    if "web" in targets:
        print("[web] Generating Web / PWA Assets (static/icons)...")
        OUT_STATIC.mkdir(parents=True, exist_ok=True)
        (OUT_STATIC / "favicon.svg").write_text(SVG_CONTENT, encoding="utf-8")
        draw_artwork(512, rounded=True).save(OUT_STATIC / "icon-512.png", optimize=True)
        draw_artwork(192, rounded=True).save(OUT_STATIC / "icon-192.png", optimize=True)
        draw_artwork(512, scale=0.78, rounded=False).convert("RGB").save(
            OUT_STATIC / "icon-maskable-512.png", optimize=True
        )
        draw_artwork(180, rounded=False).convert("RGB").save(
            OUT_STATIC / "apple-touch-icon.png", optimize=True
        )

    if "mobile" in targets:
        print("[mobile] Generating Mobile Assets (mobile/assets)...")
        OUT_MOBILE.mkdir(parents=True, exist_ok=True)
        draw_artwork(1024, rounded=False).convert("RGB").save(
            OUT_MOBILE / "icon.png", optimize=True
        )
        draw_artwork(1024, rounded=True).save(
            OUT_MOBILE / "splash-icon.png", optimize=True
        )
        draw_artwork(64, rounded=True).save(OUT_MOBILE / "favicon.png", optimize=True)
        draw_artwork(1024, scale=0.78, rounded=False).convert("RGB").save(
            OUT_MOBILE / "android-icon-foreground.png", optimize=True
        )
        monochrome(1024).save(OUT_MOBILE / "android-icon-monochrome.png", optimize=True)

    if "roku" in targets:
        print("[roku] Generating Roku TV Assets (roku/images)...")
        OUT_ROKU.mkdir(parents=True, exist_ok=True)
        flatten_for_roku(make_roku_icon(540, 405)).save(OUT_ROKU / "icon_fhd.png", optimize=True)
        flatten_for_roku(make_roku_icon(290, 218)).save(OUT_ROKU / "icon_hd.png", optimize=True)
        flatten_for_roku(make_roku_splash(1920, 1080)).save(OUT_ROKU / "splash_fhd.png", optimize=True)
        flatten_for_roku(make_roku_splash(1280, 720)).save(OUT_ROKU / "splash_hd.png", optimize=True)


if __name__ == "__main__":
    main()
