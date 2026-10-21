#!/usr/bin/env python3
"""
Generate the app icons and splash images throughout the project (Pillow required).

Three destinations, one unified Obsidian Liquid Glass design:
* ``static/icons/``  - The web PWA & browser icons (512/192 px, maskable, apple-touch, favicon);
* ``mobile/assets/`` - The Expo mobile app (iOS/Android icons, splash, adaptive icon layers);
* ``roku/images/``   - The Roku TV channel (FHD/HD home screen tiles and full splash screens).

Run ``python scripts/make_icons.py`` after changing the design.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_STATIC = ROOT / "static" / "icons"
OUT_MOBILE = ROOT / "mobile" / "assets"
OUT_ROKU = ROOT / "roku" / "images"

# ── Color Palette (Obsidian Liquid Glass with Electric Cyan Glow) ─────────────
BG_TOP = (18, 30, 48, 255)       # Deep navy-slate obsidian
BG_BOT = (6, 9, 16, 255)         # Midnight obsidian abyss
BG_SOLID = (8, 9, 14, 255)       # #08090E canvas backdrop
CYAN_ACCENT = (0, 210, 255)      # Electric cyan highlight
CYAN_BRIGHT = (0, 229, 255)      # Vibrant cyan rim
MOUNT_BACK = (16, 42, 60, 230)   # Translucent teal glass
MOUNT_FORE = (7, 18, 28, 252)    # Deep obsidian slate

SUN_COORDS = (344, 168)          # cx, cy (512 px design grid)
SUN_RADIUS = 54
HALO_RADIUS = 76

# ── Scalable Vector Favicon (SVG) ─────────────────────────────────────────────
SVG_CONTENT = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#121e30"/>
      <stop offset="50%" stop-color="#09101c"/>
      <stop offset="100%" stop-color="#05070e"/>
    </linearGradient>
    <radialGradient id="sunGlow" cx="68%" cy="33%" r="35%">
      <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#cbf1ff"/>
    </linearGradient>
    <linearGradient id="mountBack" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16384c"/>
      <stop offset="100%" stop-color="#0d2130"/>
    </linearGradient>
    <linearGradient id="mountFore" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1a27"/>
      <stop offset="100%" stop-color="#050d14"/>
    </linearGradient>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="116"/>
    </clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <circle cx="344" cy="168" r="140" fill="url(#sunGlow)"/>
    <circle cx="344" cy="168" r="56" fill="url(#sun)"/>
    <!-- Back mountain -->
    <path d="M0 420 L130 260 L220 340 L320 230 L512 420 L512 512 L0 512 Z" fill="url(#mountBack)"/>
    <path d="M0 420 L130 260 L220 340 L320 230 L512 420" fill="none" stroke="#00d2ff" stroke-width="2.5" stroke-opacity="0.6"/>
    <!-- Fore mountain -->
    <path d="M0 460 L180 320 L275 395 L405 295 L512 390 L512 512 L0 512 Z" fill="url(#mountFore)"/>
    <path d="M0 460 L180 320 L275 395 L405 295 L512 390" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-opacity="0.8"/>
    <!-- Top specular glass sheen -->
    <path d="M0 0 L512 0 L512 160 L0 280 Z" fill="#ffffff" fill-opacity="0.07"/>
    <!-- Glass rim border -->
    <rect width="510" height="510" x="1" y="1" rx="115" fill="none" stroke="#00d2ff" stroke-width="2" stroke-opacity="0.35"/>
  </g>
</svg>
"""


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load system font if available, fallback to default font."""
    candidates = []
    if bold:
        candidates = [
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "/System/Library/Fonts/SFPro-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        candidates = [
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/System/Library/Fonts/SFPro-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for path_str in candidates:
        p = Path(path_str)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                pass
    try:
        return ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()


def make_gradient(width: int, height: int, top_color: tuple, bot_color: tuple) -> Image.Image:
    """Generate a smooth diagonal gradient."""
    base = Image.new("RGBA", (width, height), bot_color)
    top = Image.new("RGBA", (width, height), top_color)
    mask = Image.linear_gradient("L").resize((width, height))
    rot = mask.rotate(45, expand=False)
    return Image.composite(top, base, rot)


def draw_artwork(size: int = 512, scale: float = 1.0, rounded: bool = True) -> Image.Image:
    """
    Render emblem at 4x supersampling and downsample with Lanczos for anti-aliasing.
    """
    big = size * 4
    k = big / 512.0

    def to_safe(x: float, y: float) -> tuple[float, float]:
        return (x - 256) * scale + 256, (y - 256) * scale + 256

    # 1. Base Obsidian Gradient
    art = make_gradient(big, big, BG_TOP, BG_BOT)

    # 2. Ambient radial cyan glow behind sun
    sun_cx, sun_cy = to_safe(SUN_COORDS[0], SUN_COORDS[1])
    glow_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow_layer)
    max_gr = int(180 * k)
    for gr in range(max_gr, 0, -8):
        alpha = int(45 * (1.0 - (gr / float(max_gr))))
        g_draw.ellipse(
            [
                (sun_cx * k) - gr,
                (sun_cy * k) - gr,
                (sun_cx * k) + gr,
                (sun_cy * k) + gr,
            ],
            fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], alpha),
        )
    art = Image.alpha_composite(art, glow_layer)

    # 3. Sun Halo & Core
    sun_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(sun_layer)
    halo_r = HALO_RADIUS * scale * k
    s_draw.ellipse(
        [
            (sun_cx * k) - halo_r,
            (sun_cy * k) - halo_r,
            (sun_cx * k) + halo_r,
            (sun_cy * k) + halo_r,
        ],
        fill=(CYAN_BRIGHT[0], CYAN_BRIGHT[1], CYAN_BRIGHT[2], 65),
    )

    core_r = SUN_RADIUS * scale * k
    s_draw.ellipse(
        [
            (sun_cx * k) - core_r,
            (sun_cy * k) - core_r,
            (sun_cx * k) + core_r,
            (sun_cy * k) + core_r,
        ],
        fill=(255, 255, 255, 255),
    )
    art = Image.alpha_composite(art, sun_layer)

    # 4. Mountain Layers
    # 4A. Back Mountain Ridge (Translucent teal glass)
    mount_back_pts = [
        (0, 420),
        (130, 260),
        (220, 340),
        (320, 230),
        (512, 420),
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
            fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 140),
            width=int(3 * k),
        )
    art = Image.alpha_composite(art, mb_layer)

    # 4B. Fore Mountain Ridge (Deep obsidian slate)
    mount_fore_pts = [
        (0, 460),
        (180, 320),
        (275, 395),
        (405, 295),
        (512, 390),
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
            fill=(CYAN_BRIGHT[0], CYAN_BRIGHT[1], CYAN_BRIGHT[2], 210),
            width=int(3 * k),
        )
    art = Image.alpha_composite(art, mf_layer)

    # 5. Top Specular Glass Sheen
    glass_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gl_draw = ImageDraw.Draw(glass_layer)
    sheen_poly = [(0, 0), (big, 0), (big, int(160 * k)), (0, int(280 * k))]
    gl_draw.polygon(sheen_poly, fill=(255, 255, 255, 18))
    art = Image.alpha_composite(art, glass_layer)

    # 6. Subtle Outer Glass Border
    border_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(border_layer)
    if rounded:
        radius = int(116 * k)
        b_draw.rounded_rectangle(
            [int(2 * k), int(2 * k), big - int(3 * k), big - int(3 * k)],
            radius=radius,
            outline=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 90),
            width=int(3 * k),
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
            outline=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 70),
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
        (0, 420),
        (130, 260),
        (220, 340),
        (320, 230),
        (512, 420),
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
    splash/icon must be fully opaque.  Composite the RGBA master onto the solid
    channel backdrop (#08090E, the manifest ``splash_color``) and drop the alpha
    channel.  ``scripts/flatten_roku_art.py`` does the same thing without Pillow.
    """
    if image.mode != "RGBA":
        return image.convert("RGB")
    backing = Image.new("RGBA", image.size, BG_SOLID)
    return Image.alpha_composite(backing, image).convert("RGB")


def make_roku_icon(w: int = 540, h: int = 405) -> Image.Image:
    """Roku channel store / home screen grid tile."""
    bw, bh = w * 2, h * 2
    canvas = Image.new("RGBA", (bw, bh), BG_SOLID)

    # Ambient radial cyan glow
    glow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    gcx, gcy = bw // 2, int(160 * 2)
    for r in range(int(180 * 2), 0, -10):
        alpha = int(24 * (1.0 - (r / (180.0 * 2))))
        g_draw.ellipse(
            [gcx - r, gcy - r, gcx + r, gcy + r],
            fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], alpha),
        )
    canvas = Image.alpha_composite(canvas, glow)

    # Emblem
    emblem_size = 220
    emblem = draw_artwork(emblem_size * 2, rounded=True)

    # Drop shadow
    shadow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    ex = (bw - emblem_size * 2) // 2
    ey = int(42 * 2)
    s_draw.rounded_rectangle(
        [ex - 8, ey - 4, ex + emblem_size * 2 + 8, ey + emblem_size * 2 + 16],
        radius=int(50 * 2),
        fill=(0, 0, 0, 140),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(emblem, (ex, ey))

    # Typography
    draw = ImageDraw.Draw(canvas)
    f_title = get_font(int(24 * 2), bold=True)
    f_sub = get_font(int(13 * 2), bold=False)
    f_badge = get_font(int(11 * 2), bold=False)

    title_text = "SPOTLIGHT STUDIO"
    tb = draw.textbbox((0, 0), title_text, font=f_title)
    tw = tb[2] - tb[0]
    draw.text(
        ((bw - tw) // 2, int(294 * 2)),
        title_text,
        fill=(255, 255, 255, 255),
        font=f_title,
    )

    sub_text = "WINDOWS SPOTLIGHT"
    sb = draw.textbbox((0, 0), sub_text, font=f_sub)
    sw = sb[2] - sb[0]
    draw.text(
        ((bw - sw) // 2, int(334 * 2)),
        sub_text,
        fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 230),
        font=f_sub,
    )

    # Pill badge
    badge_text = "4K & ULTRA-HD"
    bb = draw.textbbox((0, 0), badge_text, font=f_badge)
    bw_text = bb[2] - bb[0]
    pad_h = int(14 * 2)
    pad_v = int(4 * 2)
    pill_w = bw_text + pad_h * 2
    pill_h = (bb[3] - bb[1]) + pad_v * 2
    pill_x = (bw - pill_w) // 2
    pill_y = int(360 * 2)

    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=int(8 * 2),
        fill=(16, 24, 38, 220),
        outline=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 70),
        width=int(1.5 * 2),
    )
    draw.text(
        (pill_x + pad_h, pill_y + pad_v - 2),
        badge_text,
        fill=(160, 185, 215, 240),
        font=f_badge,
    )

    return canvas.resize((w, h), Image.LANCZOS)


def make_roku_splash(w: int = 1920, h: int = 1080) -> Image.Image:
    """Full-bleed Roku launch splash screen."""
    canvas = Image.new("RGBA", (w, h), BG_SOLID)

    # Ambient radial cyan glow
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    gcx, gcy = w // 2, 400
    for r in range(480, 0, -16):
        alpha = int(32 * (1.0 - (r / 480.0)))
        g_draw.ellipse(
            [gcx - r, gcy - r, gcx + r, gcy + r],
            fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], alpha),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    canvas = Image.alpha_composite(canvas, glow)

    # Center Hero Emblem
    emblem_size = 320
    emblem = draw_artwork(emblem_size, rounded=True)

    # Halo glow under emblem
    halo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(halo)
    ex = (w - emblem_size) // 2
    ey = 240
    h_draw.rounded_rectangle(
        [ex - 24, ey - 24, ex + emblem_size + 24, ey + emblem_size + 24],
        radius=90,
        fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 35),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(30))
    canvas = Image.alpha_composite(canvas, halo)
    canvas.alpha_composite(emblem, (ex, ey))

    # Typography
    draw = ImageDraw.Draw(canvas)
    f_title = get_font(52, bold=True)
    f_sub = get_font(21, bold=False)
    f_badge = get_font(13, bold=False)

    title_text = "SPOTLIGHT STUDIO"
    tb = draw.textbbox((0, 0), title_text, font=f_title)
    tw = tb[2] - tb[0]
    draw.text(
        ((w - tw) // 2, 620),
        title_text,
        fill=(255, 255, 255, 255),
        font=f_title,
    )

    sub_text = "Windows Spotlight Ultra-HD Wallpapers & Ambient Screensaver"
    sb = draw.textbbox((0, 0), sub_text, font=f_sub)
    sw = sb[2] - sb[0]
    draw.text(
        ((w - sw) // 2, 695),
        sub_text,
        fill=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 240),
        font=f_sub,
    )

    badge_text = "ROKU TV EDITION  *  4K & ULTRA-HD ARCHIVE"
    bb = draw.textbbox((0, 0), badge_text, font=f_badge)
    bw_text = bb[2] - bb[0]
    pad_h = 24
    pad_v = 8
    pill_w = bw_text + pad_h * 2
    pill_h = (bb[3] - bb[1]) + pad_v * 2
    pill_x = (w - pill_w) // 2
    pill_y = 750

    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=14,
        fill=(14, 20, 32, 220),
        outline=(CYAN_ACCENT[0], CYAN_ACCENT[1], CYAN_ACCENT[2], 75),
        width=1,
    )
    draw.text(
        (pill_x + pad_h, pill_y + pad_v - 1),
        badge_text,
        fill=(160, 185, 215, 240),
        font=f_badge,
    )

    return canvas


def main() -> None:
    print("[1/3] Generating Web / PWA Assets (static/icons)...")
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

    print("[2/3] Generating Mobile Assets (mobile/assets)...")
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

    print("[3/3] Generating Roku TV Assets (roku/images)...")
    OUT_ROKU.mkdir(parents=True, exist_ok=True)
    flatten_for_roku(make_roku_icon(540, 405)).save(OUT_ROKU / "icon_fhd.png", optimize=True)
    flatten_for_roku(make_roku_icon(290, 218)).save(OUT_ROKU / "icon_hd.png", optimize=True)
    flatten_for_roku(make_roku_splash(1920, 1080)).save(OUT_ROKU / "splash_fhd.png", optimize=True)
    flatten_for_roku(make_roku_splash(1280, 720)).save(OUT_ROKU / "splash_hd.png", optimize=True)

    print("\n[OK] Successfully updated all icons and splash images throughout the project:")
    for folder in (OUT_STATIC, OUT_MOBILE, OUT_ROKU):
        for path in sorted(folder.iterdir()):
            print(f"  {str(path.relative_to(ROOT)):<42} {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
