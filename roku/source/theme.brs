' Spotlight Studio for Roku
' theme.brs - "Liquid Glass" design system: palettes, rounded geometry,
'             focus rings, badges, buttons, spinners and shared chrome.
'
' The theme associative array is built once per palette and memoised in the
' global AA.  The previous implementation allocated a fresh 24-key AA on every
' GetTheme() call - and every view and component calls it - which meant several
' hundred throwaway allocations per frame on a device with a conservative
' garbage collector.

' ─── COLOUR HELPERS ───────────────────────────────────────────────────

function HexDigitValue(ch as string) as integer
    c = Asc(UCase(ch))
    if c >= 48 and c <= 57 then return c - 48
    if c >= 65 and c <= 70 then return c - 55
    return 0
end function

' "#08090E" -> &h08090E (no alpha).
function HexToRgb(hex as string) as integer
    h = hex
    if Left(h, 1) = "#" then h = Mid(h, 2)
    if Len(h) < 6 then return 0
    r = HexDigitValue(Mid(h, 1, 1)) * 16 + HexDigitValue(Mid(h, 2, 1))
    g = HexDigitValue(Mid(h, 3, 1)) * 16 + HexDigitValue(Mid(h, 4, 1))
    b = HexDigitValue(Mid(h, 5, 1)) * 16 + HexDigitValue(Mid(h, 6, 1))
    return (r * 65536) + (g * 256) + b
end function

' Combine a 24-bit colour with an 8-bit alpha into the &hRRGGBBAA integer the
' ifDraw2D calls expect.  Values at or above &h80000000 are negative when read
' as a signed 32-bit integer; that is the correct bit pattern, not an overflow.
function WithAlpha(rgb as integer, alpha as integer) as integer
    a = ClampI(alpha, 0, 255)
    base = rgb and &hFFFFFF
    return (base * 256) + a
end function

' ─── PALETTES ─────────────────────────────────────────────────────────
' Six curated palettes, tuned for OLED and LED panels.  The hex strings double
' as the values handed to roAppManager.SetTheme() so the Roku Pay sheets and any
' system-drawn chrome match the in-app accent.

function GetPaletteList() as object
    gaa = GetGlobalAA()
    if gaa.__ssPalettes <> invalid then return gaa.__ssPalettes

    palettes = [
        {
            name: "Obsidian Slate",
            desc: "Flagship deep obsidian glass with electric cyan highlights",
            bgHex: "#08090E",
            panelHex: "#131622",
            panelLightHex: "#1A1E2F",
            accentHex: "#00E5FF",
            focusHex: "#00D2FF",
            btnHex: "#00D2FF",
            secondaryHex: "#9CA3B8"
        },
        {
            name: "Midnight Cyber",
            desc: "Electric cyan and sapphire on a near-black indigo base",
            bgHex: "#04081A",
            panelHex: "#0C1330",
            panelLightHex: "#141C42",
            accentHex: "#38BDF8",
            focusHex: "#6366F1",
            btnHex: "#38BDF8",
            secondaryHex: "#94A3C4"
        },
        {
            name: "Emerald Forest",
            desc: "Lush botanical jade with vibrant mint highlights",
            bgHex: "#06110C",
            panelHex: "#0E1F17",
            panelLightHex: "#14301F",
            accentHex: "#34D399",
            focusHex: "#10B981",
            btnHex: "#34D399",
            secondaryHex: "#93B3A5"
        },
        {
            name: "Sunset Velvet",
            desc: "Warm dusk amber melting into magenta velvet",
            bgHex: "#140A0C",
            panelHex: "#241119",
            panelLightHex: "#331822",
            accentHex: "#FB923C",
            focusHex: "#EC4899",
            btnHex: "#FB923C",
            secondaryHex: "#C0A0A8"
        },
        {
            name: "Royal Amethyst",
            desc: "Deep indigo and violet with a regal luminous edge",
            bgHex: "#0C0718",
            panelHex: "#191030",
            panelLightHex: "#241745",
            accentHex: "#A78BFA",
            focusHex: "#8B5CF6",
            btnHex: "#A78BFA",
            secondaryHex: "#A99CC4"
        },
        {
            name: "Arctic Frost",
            desc: "Chilled silver and glacier blue on pale slate",
            bgHex: "#0A1016",
            panelHex: "#141E28",
            panelLightHex: "#1D2A38",
            accentHex: "#E2E8F0",
            focusHex: "#93C5FD",
            btnHex: "#93C5FD",
            secondaryHex: "#A8B6C4"
        }
    ]

    gaa.__ssPalettes = palettes
    return palettes
end function

function GetPaletteByName(name as string) as object
    palettes = GetPaletteList()
    for each p in palettes
        if p.name = name then return p
    end for
    return palettes[0]
end function

function GetPaletteNames() as object
    names = []
    for each p in GetPaletteList()
        names.Push(p.name)
    end for
    return names
end function

' Build the full colour table for one palette.
function BuildTheme(palette as object) as object
    bg = HexToRgb(SafeStr(palette.bgHex))
    panel = HexToRgb(SafeStr(palette.panelHex))
    panelLight = HexToRgb(SafeStr(palette.panelLightHex))
    accent = HexToRgb(SafeStr(palette.accentHex))
    focus = HexToRgb(SafeStr(palette.focusHex))
    btn = HexToRgb(SafeStr(palette.btnHex))
    secondary = HexToRgb(SafeStr(palette.secondaryHex))

    return {
        paletteName: SafeStr(palette.name),
        paletteDesc: SafeStr(palette.desc),

        ' Backgrounds
        bgMain: WithAlpha(bg, 255),
        bgPanel: WithAlpha(panel, 216),
        bgPanelLight: WithAlpha(panelLight, 204),
        bgHeader: WithAlpha(bg, 240),
        bgFooter: WithAlpha(bg, 238),
        bgScrim: WithAlpha(0, 208),
        bgInset: WithAlpha(panel, 238),

        ' Borders & focus
        borderSubtle: WithAlpha(&hFFFFFF, 26),
        borderMedium: WithAlpha(&hFFFFFF, 48),
        borderFocused: WithAlpha(focus, 255),
        borderHighlight: WithAlpha(focus, 128),

        ' Text
        textPrimary: &hF4F5F8FF,
        textSecondary: WithAlpha(secondary, 255),
        textMuted: &h64748BFF,
        textAccent: WithAlpha(accent, 255),
        textOnAccent: WithAlpha(bg, 255),
        textGold: &hFFD166FF,

        ' Badges & accents
        accentRgb: accent,
        focusRgb: focus,
        accentSoft: WithAlpha(accent, 51),
        focusSoft: WithAlpha(focus, 36),
        badge4k: &h8E24AAFF,
        badgeFhd: &h1565C0FF,
        heartPink: &hFF4081FF,
        successGreen: &h10B981FF,
        warningAmber: &hFFB040FF,
        dangerRed: &hFF4466FF,

        ' Buttons
        btnNormal: WithAlpha(panelLight, 187),
        btnFocused: WithAlpha(btn, 170),
        btnFocusedSolid: WithAlpha(btn, 255)
    }
end function

' Memoised theme accessor.  Always returns a valid AA.
function GetTheme() as object
    gaa = GetGlobalAA()
    if gaa.__ssTheme <> invalid then return gaa.__ssTheme
    return ApplyThemePalette("")
end function

' Switch the active palette.  Passing "" or an unknown name selects the default.
' Returns the theme that is now active.
function ApplyThemePalette(name as string) as object
    gaa = GetGlobalAA()
    palette = GetPaletteByName(name)
    theme = BuildTheme(palette)
    gaa.__ssTheme = theme
    gaa.__ssPaletteName = theme.paletteName
    ' Cached panels embed their colours in the cache key, so a palette switch
    ' would otherwise leave the old palette's bitmaps pinned in texture memory.
    GetGfxCache().Invalidate()
    return theme
end function

' ─── ROUNDED GEOMETRY ENGINE ──────────────────────────────────────────
' Every rounded shape is drawn as a centre slab, two side bars and four corner
' caps of one 1px slice per row.  The corner profile depends only on the radius,
' so it is computed once per radius and reused: the gallery draws sixteen
' radius-12/14 shapes per frame, and recomputing Sqr() for each row of each of
' them was ~1,300 Sqr() calls a second at 20 fps.

' ArcRowOffsets(r) -> { dx: [per-row x inset], w: [per-row slice width] }.
function ArcRowOffsets(r as integer) as object
    gaa = GetGlobalAA()
    if gaa.__ssArcs = invalid then gaa.__ssArcs = {}
    key = StrI(r).Trim()
    table = gaa.__ssArcs[key]
    if table <> invalid then return table

    dxs = []
    widths = []
    r2 = r * r
    for dy = 0 to r - 1
        dist = r - dy
        inner = r2 - (dist * dist)
        if inner < 0 then inner = 0
        dx = CInt(r - Sqr(inner))
        dxs.Push(dx)
        widths.Push(r - dx)
    end for

    table = { radius: r, dx: dxs, w: widths }
    gaa.__ssArcs[key] = table
    return table
end function

' Clamp a radius to what the rectangle can actually render.
function FitRadius(r as integer, w as integer, h as integer) as integer
    if r <= 0 then return 0
    maxR = MinI(CInt(w / 2), CInt(h / 2))
    if r > maxR then r = maxR
    if r < 0 then r = 0
    return r
end function

sub DrawRoundRect(screen as object, x as integer, y as integer, w as integer, h as integer, r as integer, color as integer)
    if w <= 0 or h <= 0 then return
    r = FitRadius(r, w, h)
    if r <= 0
        screen.DrawRect(x, y, w, h, color)
        return
    end if

    ' Centre slab and the two side bars cover everything except the corners.
    screen.DrawRect(x + r, y, w - (2 * r), h, color)
    screen.DrawRect(x, y + r, r, h - (2 * r), color)
    screen.DrawRect(x + w - r, y + r, r, h - (2 * r), color)

    ' Four corner caps, one 1px slice per row of the arc.
    arc = ArcRowOffsets(r)
    rows = arc.w.Count()
    for dy = 0 to rows - 1
        arcW = arc.w[dy]
        if arcW > 0
            dx = arc.dx[dy]
            screen.DrawRect(x + dx, y + dy, arcW, 1, color)
            screen.DrawRect(x + w - r, y + dy, arcW, 1, color)
            screen.DrawRect(x + dx, y + h - 1 - dy, arcW, 1, color)
            screen.DrawRect(x + w - r, y + h - 1 - dy, arcW, 1, color)
        end if
    end for
end sub

sub DrawRoundedOutline(screen as object, x as integer, y as integer, w as integer, h as integer, r as integer, color as integer, thickness as integer)
    if thickness <= 0 or w <= 0 or h <= 0 then return
    r = FitRadius(r, w, h)
    if r <= 0
        screen.DrawRect(x, y, w, thickness, color)
        screen.DrawRect(x, y + h - thickness, w, thickness, color)
        screen.DrawRect(x, y, thickness, h, color)
        screen.DrawRect(x + w - thickness, y, thickness, h, color)
        return
    end if

    screen.DrawRect(x + r, y, w - (2 * r), thickness, color)
    screen.DrawRect(x + r, y + h - thickness, w - (2 * r), thickness, color)
    screen.DrawRect(x, y + r, thickness, h - (2 * r), color)
    screen.DrawRect(x + w - thickness, y + r, thickness, h - (2 * r), color)

    arc = ArcRowOffsets(r)
    rows = arc.dx.Count()
    for dy = 0 to rows - 1
        dx = arc.dx[dy]
        screen.DrawRect(x + dx, y + dy, thickness, 1, color)
        screen.DrawRect(x + w - thickness - dx, y + dy, thickness, 1, color)
        screen.DrawRect(x + dx, y + h - 1 - dy, thickness, 1, color)
        screen.DrawRect(x + w - thickness - dx, y + h - 1 - dy, thickness, 1, color)
    end for
end sub

' ─── LIQUID GLASS COMPONENTS ─────────────────────────────────────────

sub DrawGlassPanelR(screen as object, x as integer, y as integer, w as integer, h as integer, borderColor as integer, bgColor as integer, radius as integer)
    ' Small and medium panels are served from the bitmap cache (one blit instead
    ' of ~60); oversized ones are drawn straight to the screen.
    DrawGlassPanelCached(screen, x, y, w, h, borderColor, bgColor, radius)
end sub

' ─── TEXT HELPERS ─────────────────────────────────────────────────────
' Screen.DrawText() requires a valid roFont, and measuring text is the only way
' to centre or right-align anything on a canvas.  These wrap both with the
' "font may be missing" guard and the len*constant fallback the views used to
' repeat inline.

function TextWidth(text as string, font as object, charFallback as integer) as integer
    if text = invalid or text = "" then return 0
    width = Len(text) * charFallback
    if font <> invalid
        measured = font.GetOneLineWidth(text, 1920)
        if measured > 0 then width = measured
    end if
    return width
end function

function TextHeight(font as object, fallback as integer) as integer
    height = fallback
    if font <> invalid
        measured = font.GetOneLineHeight()
        if measured > 0 then height = measured
    end if
    return height
end function

' Draw `text` centred inside the horizontal span [x, x + w].
sub DrawCenteredText(screen as object, text as string, x as integer, y as integer, w as integer, color as integer, font as object)
    if font = invalid or text = invalid or text = "" then return
    screen.DrawText(text, x + CInt((w - TextWidth(text, font, 9)) / 2), y, color, font)
end sub

' Draw `text` right-aligned so it ends at `right`.
sub DrawRightText(screen as object, text as string, right as integer, y as integer, color as integer, font as object)
    if font = invalid or text = invalid or text = "" then return
    screen.DrawText(text, right - TextWidth(text, font, 9), y, color, font)
end sub

' Breathing focus ring: a soft outer halo plus a crisp 2px core rim.
sub DrawFocusRingAnimated(screen as object, x as integer, y as integer, w as integer, h as integer, glowColor as integer, radius as integer, glowAlpha as integer)
    alphaClamped = ClampI(glowAlpha, 90, 255)
    rgb = glowColor and &hFFFFFF00
    ringColor = rgb or alphaClamped

    haloAlpha = CInt(alphaClamped * 0.35)
    haloColor = rgb or ClampI(haloAlpha, 0, 255)
    DrawRoundedOutline(screen, x - 3, y - 3, w + 6, h + 6, radius + 2, haloColor, 1)
    DrawRoundedOutline(screen, x - 2, y - 2, w + 4, h + 4, radius + 1, ringColor, 2)
end sub

sub DrawBadge(screen as object, text as string, x as integer, y as integer, badgeColor as integer, textColor as integer, font as object)
    if text = invalid or text = "" then return

    paddingH = 12
    paddingV = 4
    fontH = 18
    textW = Len(text) * 9
    if font <> invalid
        measuredH = font.GetOneLineHeight()
        if measuredH > 0 then fontH = measuredH
        measuredW = font.GetOneLineWidth(text, 1920)
        if measuredW > 0 then textW = measuredW
    end if

    badgeW = textW + (paddingH * 2)
    badgeH = fontH + (paddingV * 2)
    radius = CInt(badgeH / 2)

    ' Pills repeat constantly (quality, favourite, licence, source badges), so
    ' they are served from the shape cache: one blit instead of ~30 DrawRects.
    DrawGlassPanelCached(screen, x, y, badgeW, badgeH, &hFFFFFF22, badgeColor, radius)
    screen.DrawText(text, x + paddingH, y + paddingV - 2, textColor, font)
end sub

' Width a DrawBadge() call will occupy, so callers can right-align without
' drawing twice.
function BadgeWidth(text as string, font as object) as integer
    if text = invalid or text = "" then return 0
    textW = Len(text) * 9
    if font <> invalid
        measuredW = font.GetOneLineWidth(text, 1920)
        if measuredW > 0 then textW = measuredW
    end if
    return textW + 24
end function

sub DrawButton(screen as object, text as string, x as integer, y as integer, w as integer, h as integer, isFocused as boolean, font as object)
    t = GetTheme()

    bgColor = t.btnNormal
    borderColor = t.borderSubtle
    textColor = t.textSecondary

    if isFocused
        bgColor = t.btnFocused
        borderColor = t.borderFocused
        textColor = t.textOnAccent
    end if

    radius = 9
    bmp = GetGfxCache().GetPanel(w, h, radius, bgColor, borderColor, 2)
    if bmp <> invalid
        screen.DrawObject(x, y, bmp)
    else
        DrawRoundRect(screen, x, y, w, h, radius, bgColor)
        DrawRoundedOutline(screen, x, y, w, h, radius, borderColor, 2)
    end if

    textW = Len(text) * 11
    textH = 22
    if font <> invalid
        measuredW = font.GetOneLineWidth(text, 1920)
        if measuredW > 0 then textW = measuredW
        measuredH = font.GetOneLineHeight()
        if measuredH > 0 then textH = measuredH
    end if

    tx = x + CInt((w - textW) / 2)
    ty = y + CInt((h - textH) / 2)
    screen.DrawText(text, tx, ty, textColor, font)
end sub

' ─── SHARED CHROME ────────────────────────────────────────────────────
' Every secondary view used to hand-roll its own header and footer, which is why
' the badge positions, divider heights and hint baselines all drifted apart.

' Canvas metrics, in the 1920x1080 design space the whole app is authored in.
function LayoutMetrics() as object
    gaa = GetGlobalAA()
    if gaa.__ssLayout = invalid
        gaa.__ssLayout = {
            width: 1920,
            height: 1080,
            margin: 85,
            headerH: 110,
            footerY: 970,
            footerH: 110
        }
    end if
    return gaa.__ssLayout
end function

' Standard view header: glass band, title, subtitle, licence badge and clock.
sub DrawViewHeader(screen as object, state as object, title as string, subtitle as string)
    t = GetTheme()
    fonts = state.fonts
    L = LayoutMetrics()

    screen.DrawRect(0, 0, L.width, L.headerH, t.bgHeader)
    screen.DrawRect(0, L.headerH - 1, L.width, 1, t.borderSubtle)
    screen.DrawText(title, L.margin, 24, t.textPrimary, fonts.title)
    if subtitle <> invalid and subtitle <> ""
        screen.DrawText(TruncateText(subtitle, 118), L.margin, 74, t.textSecondary, fonts.caption)
    end if

    ' Right-aligned status: licence badge above the device clock.
    DrawLicenseBadge(screen, state, 1450, 22)
    clockStr = SafeStr(state.clockTime)
    if clockStr = "" then clockStr = "--:--"
    dateStr = SafeStr(state.clockDate)
    screen.DrawText(clockStr, 1700, 20, t.textPrimary, fonts.heading)
    if dateStr <> "" then screen.DrawText(dateStr, 1700, 60, t.textAccent, fonts.small)
end sub

' Standard view footer: action hints on a glass band.
sub DrawViewFooter(screen as object, state as object, hints as string)
    t = GetTheme()
    L = LayoutMetrics()
    font = invalid
    if state <> invalid
        if state.fonts <> invalid then font = state.fonts.body
    end if
    screen.DrawRect(0, L.footerY, L.width, L.footerH, t.bgFooter)
    screen.DrawRect(0, L.footerY, L.width, 2, t.borderSubtle)
    screen.DrawText(TruncateText(hints, 150), L.margin, L.footerY + 40, t.textSecondary, font)
end sub

' The trial / Pro badge shown in every header.
sub DrawLicenseBadge(screen as object, state as object, x as integer, y as integer)
    if state = invalid or state.licenseMgr = invalid then return
    t = GetTheme()
    lm = state.licenseMgr
    badgeColor = t.btnNormal
    if lm.IsTrialActive() then badgeColor = t.accentSoft
    if lm.hasFullVersion then badgeColor = t.badgeFhd
    if lm.HasActiveSubscription() then badgeColor = t.badge4k
    DrawBadge(screen, lm.GetStatusBadge(), x, y, badgeColor, t.textPrimary, state.fonts.small)
end sub

' Full-screen dimmer used behind modal dialogs.
sub DrawScrim(screen as object, alpha as integer)
    L = LayoutMetrics()
    screen.DrawRect(0, 0, L.width, L.height, WithAlpha(0, ClampI(alpha, 0, 255)))
end sub

' ─── ANIMATED LOADING SPINNER ─────────────────────────────────────────

sub DrawLoadingSpinner(screen as object, cx as integer, cy as integer, radius as integer, angle as integer, colorAccent as integer, colorMuted as integer)
    dotCount = 8
    dotRadius = 3
    dotSize = 6
    if radius > 24
        dotRadius = 4
        dotSize = 8
    end if

    rDiag = CInt(radius * 0.707)
    offsetsX = [radius, rDiag, 0, -rDiag, -radius, -rDiag, 0, rDiag]
    offsetsY = [0, rDiag, radius, rDiag, 0, -rDiag, -radius, -rDiag]

    stepIdx = WrapIndex(CInt(angle / 45), dotCount)

    for i = 0 to dotCount - 1
        px = cx + offsetsX[i] - dotRadius
        py = cy + offsetsY[i] - dotRadius

        dist = (stepIdx - i + dotCount) MOD dotCount
        c = colorMuted
        if dist = 0
            c = colorAccent
        else if dist = 1
            c = (colorAccent and &hFFFFFF00) or &hD0
        else if dist = 2
            c = (colorAccent and &hFFFFFF00) or &h88
        else if dist = 3
            c = (colorAccent and &hFFFFFF00) or &h44
        else
            c = &hFFFFFF18
        end if

        ' A radius-3 rounded rect is 15 DrawRect() calls; eight of them per
        ' frame for the spinner is 120 blits at 20 fps.  The dot is 6x6 or 8x8
        ' pixels, so it is worth caching for every colour used.
        dot = GetGfxCache().GetRoundedRect(dotSize, dotSize, dotRadius, c)
        if dot <> invalid
            screen.DrawObject(px, py, dot)
        else
            DrawRoundRect(screen, px, py, dotSize, dotSize, dotRadius, c)
        end if
    end for
end sub

' Centre a spinner inside a box and draw the "loading" caption under it.
sub DrawSpinnerBlock(screen as object, state as object, boxX as integer, boxY as integer, boxW as integer, boxH as integer, radius as integer, label as string)
    t = GetTheme()
    angle = 0
    if state <> invalid and state.spinnerAngle <> invalid then angle = state.spinnerAngle
    DrawLoadingSpinner(screen, boxX + CInt(boxW / 2), boxY + CInt(boxH / 2) - 10, radius, angle, t.textAccent, t.borderSubtle)
    if label <> invalid and label <> ""
        font = state.fonts.small
        labelW = Len(label) * 8
        if font <> invalid
            measured = font.GetOneLineWidth(label, 1920)
            if measured > 0 then labelW = measured
        end if
        screen.DrawText(label, boxX + CInt((boxW - labelW) / 2), boxY + CInt(boxH / 2) + 22, t.textMuted, font)
    end if
end sub
