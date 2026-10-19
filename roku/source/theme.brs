' Spotlight Studio for Roku
' theme.brs - Liquid Glass visual design system, rounded corners, and animations

function GetTheme() as object
    theme = {
        ' Backgrounds
        bgMain: &h08090EFF,          ' Obsidian deep glass
        bgPanel: &h131622D8,         ' Frosted glass material
        bgPanelLight: &h1A1E2FCC,    ' Floating glass material
        bgHeader: &h0C0E18F0,        ' Fixed navigation glass
        bgFooter: &h0C0E18EE,        ' Action status glass
        
        ' Borders & Focus
        borderSubtle: &hFFFFFF1A,    ' Hairline subtle glass edge
        borderMedium: &hFFFFFF30,    ' Medium card glass rim
        borderFocused: &h00D2FFFF,   ' Vibrant cyan focused glow
        borderHighlight: &h80D8FFFF, ' Soft cyan highlight
        
        ' Text
        textPrimary: &hF4F5F8FF,     ' High-contrast white
        textSecondary: &h9CA3B8FF,   ' Secondary slate
        textMuted: &h64748BFF,       ' Muted caption
        textAccent: &h00E5FFFF,      ' Accent electric cyan
        textGold: &hFFD166FF,        ' Gold accent
        
        ' Badges & Accents
        badge4k: &h8E24AAFF,         ' 4K UHD purple
        badgeFhd: &h1565C0FF,        ' FHD 1080p deep blue
        heartPink: &hFF4081FF,       ' Favorite pink
        successGreen: &h10B981FF,    ' Active / success green
        
        ' Button states
        btnNormal: &h181C2CBB,
        btnFocused: &h00D2FFAA
    }
    return theme
end function

' ─── ROUNDED GEOMETRY ENGINE ──────────────────────────────────────────

sub DrawRoundRect(screen as object, x as integer, y as integer, w as integer, h as integer, r as integer, color as integer)
    if r <= 0
        screen.DrawRect(x, y, w, h, color)
        return
    end if
    
    if r > w / 2 then r = w / 2
    if r > h / 2 then r = h / 2
    
    ' 1. Center slab (X: x + r to x + w - r, Y: y to y + h)
    screen.DrawRect(x + r, y, w - (2 * r), h, color)
    
    ' 2. Left side bar (X: x to x + r, Y: y + r to y + h - r)
    screen.DrawRect(x, y + r, r, h - (2 * r), color)
    
    ' 3. Right side bar (X: x + w - r to x + w, Y: y + r to y + h - r)
    screen.DrawRect(x + w - r, y + r, r, h - (2 * r), color)
    
    ' 4. Four rounded corner caps (non-overlapping slices)
    r2 = r * r
    for dy = 0 to r - 1
        dist = r - dy
        dx = CInt(r - Sqr(r2 - (dist * dist)))
        arcW = r - dx
        if arcW > 0
            ' Top-Left
            screen.DrawRect(x + dx, y + dy, arcW, 1, color)
            ' Top-Right
            screen.DrawRect(x + w - r, y + dy, arcW, 1, color)
            ' Bottom-Left
            screen.DrawRect(x + dx, y + h - 1 - dy, arcW, 1, color)
            ' Bottom-Right
            screen.DrawRect(x + w - r, y + h - 1 - dy, arcW, 1, color)
        end if
    end for
end sub

sub DrawRoundedOutline(screen as object, x as integer, y as integer, w as integer, h as integer, r as integer, color as integer, thickness as integer)
    if thickness <= 0 then return
    if r <= 0
        screen.DrawRect(x, y, w, thickness, color)
        screen.DrawRect(x, y + h - thickness, w, thickness, color)
        screen.DrawRect(x, y, thickness, h, color)
        screen.DrawRect(x + w - thickness, y, thickness, h, color)
        return
    end if
    
    if r > w / 2 then r = w / 2
    if r > h / 2 then r = h / 2
    
    ' Straight border segments
    screen.DrawRect(x + r, y, w - (2 * r), thickness, color)
    screen.DrawRect(x + r, y + h - thickness, w - (2 * r), thickness, color)
    screen.DrawRect(x, y + r, thickness, h - (2 * r), color)
    screen.DrawRect(x + w - thickness, y + r, thickness, h - (2 * r), color)
    
    ' Four rounded corner outline arcs
    r2 = r * r
    for dy = 0 to r - 1
        dist = r - dy
        dx = CInt(r - Sqr(r2 - (dist * dist)))
        ' Top-Left
        screen.DrawRect(x + dx, y + dy, thickness, 1, color)
        ' Top-Right
        screen.DrawRect(x + w - thickness - dx, y + dy, thickness, 1, color)
        ' Bottom-Left
        screen.DrawRect(x + dx, y + h - 1 - dy, thickness, 1, color)
        ' Bottom-Right
        screen.DrawRect(x + w - thickness - dx, y + h - 1 - dy, thickness, 1, color)
    end for
end sub

' ─── LIQUID GLASS UI COMPONENTS ───────────────────────────────────────

sub DrawGlassPanel(screen as object, x as integer, y as integer, w as integer, h as integer, borderColor as integer, bgColor as integer)
    DrawGlassPanelR(screen, x, y, w, h, borderColor, bgColor, 14)
end sub

sub DrawGlassPanelR(screen as object, x as integer, y as integer, w as integer, h as integer, borderColor as integer, bgColor as integer, radius as integer)
    ' 1. Frosted rounded glass body
    DrawRoundRect(screen, x, y, w, h, radius, bgColor)
    ' 2. Subtle glass rim outline
    DrawRoundedOutline(screen, x, y, w, h, radius, borderColor, 1)
end sub

sub DrawFocusRing(screen as object, x as integer, y as integer, w as integer, h as integer, glowColor as integer)
    DrawFocusRingAnimated(screen, x, y, w, h, glowColor, 14, 255)
end sub

sub DrawFocusRingAnimated(screen as object, x as integer, y as integer, w as integer, h as integer, glowColor as integer, radius as integer, glowAlpha as integer)
    ' Outer 3px glowing frame with rounded corners and pulsing breathing alpha
    alphaClamped = ClampI(glowAlpha, 100, 255)
    ringColor = (glowColor and &hFFFFFF00) or alphaClamped
    
    ' Outer soft halo glow (1px extra)
    haloAlpha = CInt(alphaClamped * 0.35)
    haloColor = (glowColor and &hFFFFFF00) or haloAlpha
    DrawRoundedOutline(screen, x - 3, y - 3, w + 6, h + 6, radius + 2, haloColor, 1)
    
    ' Core vibrant focused rim (2px)
    DrawRoundedOutline(screen, x - 2, y - 2, w + 4, h + 4, radius + 1, ringColor, 2)
end sub

sub DrawBadge(screen as object, text as string, x as integer, y as integer, badgeColor as integer, textColor as integer, font as object)
    paddingH = 12
    paddingV = 4
    
    fontH = 18
    textW = Len(text) * 9
    if font <> invalid and type(font) = "roFont"
        if font.GetOneLineHeight() > 0 then fontH = font.GetOneLineHeight()
        if font.GetOneLineWidth(text) > 0 then textW = font.GetOneLineWidth(text)
    end if
    
    badgeW = textW + (paddingH * 2)
    badgeH = fontH + (paddingV * 2)
    
    ' Rounded capsule pill
    radius = 7
    DrawRoundRect(screen, x, y, badgeW, badgeH, radius, badgeColor)
    DrawRoundedOutline(screen, x, y, badgeW, badgeH, radius, &hFFFFFF22, 1)
    screen.DrawText(text, x + paddingH, y + paddingV - 2, textColor, font)
end sub

sub DrawButton(screen as object, text as string, x as integer, y as integer, w as integer, h as integer, isFocused as boolean, font as object)
    t = GetTheme()
    
    bgColor = t.btnNormal
    borderColor = t.borderSubtle
    textColor = t.textSecondary
    
    if isFocused
        bgColor = t.btnFocused
        borderColor = t.borderFocused
        textColor = t.bgMain
    end if
    
    radius = 9
    DrawRoundRect(screen, x, y, w, h, radius, bgColor)
    DrawRoundedOutline(screen, x, y, w, h, radius, borderColor, 2)
    
    textW = Len(text) * 11
    if font <> invalid and font.GetOneLineWidth(text) > 0
        textW = font.GetOneLineWidth(text)
    end if
    
    textH = 22
    if font <> invalid and font.GetOneLineHeight() > 0
        textH = font.GetOneLineHeight()
    end if
    
    tx = x + ((w - textW) / 2)
    ty = y + ((h - textH) / 2)
    
    screen.DrawText(text, tx, ty, textColor, font)
end sub

' ─── ANIMATED LOADING SPINNER ────────────────────────────────────────

sub DrawLoadingSpinner(screen as object, cx as integer, cy as integer, radius as integer, angle as integer, colorAccent as integer, colorMuted as integer)
    dotCount = 8
    dotRadius = 3
    dotSize = 6
    if radius > 24
        dotRadius = 4
        dotSize = 8
    end if
    
    rDiag = CInt(radius * 0.707)
    offsetsX = [ radius,  rDiag,      0, -rDiag, -radius, -rDiag,       0,  rDiag ]
    offsetsY = [      0,  rDiag, radius,  rDiag,       0, -rDiag, -radius, -rDiag ]
    
    stepIdx = (CInt(angle / 45)) MOD dotCount
    
    for i = 0 to dotCount - 1
        dx = offsetsX[i]
        dy = offsetsY[i]
        px = cx + dx - dotRadius
        py = cy + dy - dotRadius
        
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
        
        DrawRoundRect(screen, px, py, dotSize, dotSize, dotRadius, c)
    end for
end sub
