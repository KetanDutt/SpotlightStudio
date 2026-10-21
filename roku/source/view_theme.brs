' Spotlight Studio for Roku
' view_theme.brs - Theme Studio: Liquid Glass palettes plus the ambient and
'                  menu-backdrop wallpaper controls.
'
' Selecting a palette applies it immediately, so the entire screen is its own
' live preview - there is no separate "apply" step to get wrong.
'
' HONESTY NOTE: a Roku channel cannot change the device home-screen wallpaper or
' the system screensaver (certification requirement 4.5 forbids interfering with
' the system screensaver, and only standalone screensaver apps may ship one).
' The controls here therefore act on things this channel owns: the palette used
' by every screen, the wallpaper Ambient Mode rotates through, and the backdrop
' rendered behind the gallery.  See docs/roku/CERTIFICATION.md.

function ThemeLayout() as object
    gaa = GetGlobalAA()
    if gaa.__ssThemeLayout = invalid
        gaa.__ssThemeLayout = {
            panelX: 85,
            panelY: 130,
            panelW: 900,
            panelH: 810,
            rowH: 52,
            rowsY: 210,
            infoX: 1025,
            infoW: 810
        }
    end if
    return gaa.__ssThemeLayout
end function

sub RenderThemeStudio(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    L = ThemeLayout()

    screen.Clear(t.bgMain)
    DrawViewHeader(screen, state, "Theme Studio", "Live Liquid Glass palettes, Ambient Mode wallpaper and automatic rotation")

    ' ── control list ───────────────────────────────────────────────────
    DrawGlassPanelR(screen, L.panelX, L.panelY, L.panelW, L.panelH, t.borderSubtle, t.bgPanel, 18)
    screen.DrawRect(L.panelX + 20, L.panelY + 20, L.panelW - 40, 4, t.textAccent)
    screen.DrawText("Appearance & Ambient Controls", L.panelX + 20, L.panelY + 34, t.textPrimary, fonts.heading)
    screen.DrawText("Up/Down move   OK select   Left/Right change a value", L.panelX + 20, L.panelY + 68, t.textMuted, fonts.caption)

    rows = BuildThemeRows(state)
    state.themeRow = ClampI(state.themeRow, 0, rows.Count() - 1)

    for i = 0 to rows.Count() - 1
        row = rows[i]
        rowY = L.rowsY + (i * L.rowH)
        isFocused = (state.themeRow = i)
        isCurrentPalette = (SafeStr(row.kind) = "palette" and SafeStr(row.name) = state.themeMgr.activeThemeName)

        if isFocused
            DrawRoundRect(screen, L.panelX + 20, rowY, L.panelW - 40, L.rowH - 8, 10, t.accentSoft)
            DrawRoundedOutline(screen, L.panelX + 20, rowY, L.panelW - 40, L.rowH - 8, 10, t.borderFocused, 2)
        end if

        labelColor = t.textSecondary
        valueColor = t.textPrimary
        if isFocused
            labelColor = t.textAccent
            valueColor = t.textOnAccent
        end if

        ' A palette row shows its own accent as a swatch.
        if SafeStr(row.kind) = "palette"
            swatchColor = WithAlpha(HexToRgb(SafeStr(row.accentHex)), 255)
            DrawRoundRect(screen, L.panelX + 34, rowY + 14, 20, 20, 6, swatchColor)
            screen.DrawText(SafeStr(row.label), L.panelX + 66, rowY + 12, labelColor, fonts.body)
            if isCurrentPalette
                DrawBadge(screen, "ACTIVE", L.panelX + L.panelW - 150, rowY + 10, t.successGreen, t.textOnAccent, fonts.caption)
            end if
        else
            screen.DrawText(SafeStr(row.label), L.panelX + 34, rowY + 12, labelColor, fonts.body)
            valueText = SafeStr(row.value)
            if valueText <> ""
                valueW = fonts.body.GetOneLineWidth(valueText)
                screen.DrawText(valueText, L.panelX + L.panelW - 40 - valueW, rowY + 12, valueColor, fonts.body)
                if SafeStr(row.kind) = "cycle"
                    screen.DrawText("<", L.panelX + L.panelW - 66 - valueW, rowY + 12, labelColor, fonts.body)
                    screen.DrawText(">", L.panelX + L.panelW - 34, rowY + 12, labelColor, fonts.body)
                end if
            end if
        end if
    end for

    ' ── live status / preview ──────────────────────────────────────────
    DrawGlassPanelR(screen, L.infoX, L.panelY, L.infoW, 330, t.borderFocused, t.bgPanel, 18)
    palette = GetPaletteByName(state.themeMgr.activeThemeName)
    screen.DrawText("Active Palette", L.infoX + 20, L.panelY + 18, t.textPrimary, fonts.heading)
    screen.DrawText(SafeStr(palette.name), L.infoX + 20, L.panelY + 52, t.textAccent, fonts.title)
    screen.DrawText(TruncateText(SafeStr(palette.desc), 54), L.infoX + 20, L.panelY + 108, t.textSecondary, fonts.caption)

    ' Swatch strip so the palette can be judged even before it is applied.
    swatchY = L.panelY + 148
    swatches = [palette.bgHex, palette.panelHex, palette.panelLightHex, palette.accentHex, palette.focusHex, palette.btnHex]
    for i = 0 to swatches.Count() - 1
        sx = L.infoX + 20 + (i * 66)
        color = WithAlpha(HexToRgb(SafeStr(swatches[i])), 255)
        DrawRoundRect(screen, sx, swatchY, 56, 56, 10, color)
        DrawRoundedOutline(screen, sx, swatchY, 56, 56, 10, t.borderMedium, 1)
    end for
    screen.DrawText("base   panel   raised   accent   focus   control", L.infoX + 20, swatchY + 66, t.textMuted, fonts.caption)

    ' Mini card rendered in the active palette.
    mockY = swatchY + 100
    DrawGlassPanelCached(screen, L.infoX + 20, mockY, 340, 62, t.borderMedium, t.bgPanelLight, 10)
    screen.DrawText("Sample card title", L.infoX + 34, mockY + 8, t.textPrimary, fonts.body)
    screen.DrawText("nature, water, dusk", L.infoX + 34, mockY + 34, t.textSecondary, fonts.caption)
    DrawBadge(screen, "4K UHD", L.infoX + 270, mockY + 10, t.badge4k, t.textPrimary, fonts.caption)
    DrawFocusRingAnimated(screen, L.infoX + 20, mockY, 340, 62, t.borderFocused, 10, CalcGlowAlpha(state, 200))

    ' ── assigned wallpapers ────────────────────────────────────────────
    assignY = L.panelY + 350
    DrawGlassPanelR(screen, L.infoX, assignY, L.infoW, 240, t.borderSubtle, t.bgPanel, 18)
    screen.DrawText("Assigned Wallpapers", L.infoX + 20, assignY + 18, t.textPrimary, fonts.heading)

    DrawAssignedSlot(screen, state, "Ambient Mode", state.themeMgr.ambientWallpaperId, L.infoX + 20, assignY + 62, 370, 150)
    DrawAssignedSlot(screen, state, "Menu Backdrop", state.themeMgr.backdropWallpaperId, L.infoX + 420, assignY + 62, 370, 150)

    ' ── rotation status ────────────────────────────────────────────────
    rotY = assignY + 260
    DrawGlassPanelR(screen, L.infoX, rotY, L.infoW, 200, t.borderSubtle, t.bgPanel, 18)
    screen.DrawText("Automatic Rotation", L.infoX + 20, rotY + 18, t.textPrimary, fonts.heading)

    rotLines = [
        "Enabled: " + YesNo(state.themeMgr.autoSwitchEnabled),
        "Interval: " + FormatInterval(state.themeMgr.autoSwitchInterval),
        "Pool: " + state.themeMgr.AutoSwitchPoolLabel(),
        "Applies to: " + state.themeMgr.AutoSwitchTargetLabel()
    ]
    for i = 0 to rotLines.Count() - 1
        screen.DrawText(rotLines[i], L.infoX + 20, rotY + 58 + (i * 32), t.textSecondary, fonts.caption)
    end for

    DrawViewFooter(screen, state, "OK apply   Left/Right change value   Play preview Ambient Mode   Back return")
end sub

' The wallpaper the assignment actions operate on: the last one the user
' actually opened, falling back to today's Daily Spotlight.
function LastViewedLabel(state as object) as string
    if state = invalid then return "None"
    item = invalid
    lastId = SafeInt(state.settingsMgr.GetInt("lastWallpaperId", 0), 0)
    if lastId > 0 then item = FindWallpaper(state.allWallpapers, StrI(lastId).Trim())
    if item = invalid then item = state.dailyWallpaper
    if item = invalid then return "None"
    return TruncateText(WallpaperTitle(item), 26)
end function

' Resolve the same wallpaper the label above describes.
function LastViewedWallpaper(state as object) as object
    if state = invalid then return invalid
    lastId = SafeInt(state.settingsMgr.GetInt("lastWallpaperId", 0), 0)
    if lastId > 0
        item = FindWallpaper(state.allWallpapers, StrI(lastId).Trim())
        if item <> invalid then return item
    end if
    return state.dailyWallpaper
end function

' One assigned-wallpaper slot with a thumbnail preview.
sub DrawAssignedSlot(screen as object, state as object, label as string, wallpaperId as integer, x as integer, y as integer, w as integer, h as integer)
    t = GetTheme()
    fonts = state.fonts

    screen.DrawText(label, x, y - 4, t.textSecondary, fonts.caption)

    imgY = y + 22
    imgH = h - 22
    DrawRoundRect(screen, x, imgY, w, imgH, 10, t.bgPanelLight)

    if wallpaperId = 0
        notice = "Not set"
        noticeW = fonts.caption.GetOneLineWidth(notice)
        screen.DrawText(notice, x + CInt((w - noticeW) / 2), imgY + CInt((imgH - 20) / 2), t.textMuted, fonts.caption)
        return
    end if

    item = FindWallpaper(state.allWallpapers, StrI(wallpaperId).Trim())
    if item = invalid
        screen.DrawText("Unavailable", x + 14, imgY + CInt((imgH - 20) / 2), t.textMuted, fonts.caption)
        return
    end if

    filename = WallpaperFilename(item)
    thumb = state.imgLoader.GetThumbnailSized(filename, w - 8, imgH - 8)
    if thumb <> invalid
        screen.DrawObject(x + 4, imgY + 4, thumb)
    else
        fallback = state.imgLoader.GetThumbnail(filename)
        if fallback <> invalid
            screen.DrawResizedObject(x + 4, imgY + 4, w - 8, imgH - 8, fallback)
        else
            screen.DrawText(TruncateText(WallpaperTitle(item), 34), x + 14, imgY + 20, t.textSecondary, fonts.caption)
            screen.DrawText("Loading preview...", x + 14, imgY + 50, t.textMuted, fonts.caption)
        end if
    end if
end sub

' Row model shared by the renderer and the input handler.
' kind: "palette" (OK applies), "cycle" (Left/Right changes), "action" (OK runs).
function BuildThemeRows(state as object) as object
    rows = []
    for each palette in GetPaletteList()
        rows.Push({ kind: "palette", name: SafeStr(palette.name), label: SafeStr(palette.name), value: "", accentHex: SafeStr(palette.accentHex) })
    end for

    tm = state.themeMgr
    rotValue = "Off"
    if tm.autoSwitchEnabled then rotValue = "On"
    rows.Push({ kind: "cycle", name: "autoSwitch", label: "Auto-Rotation", value: rotValue })
    rows.Push({ kind: "cycle", name: "interval", label: "Rotation Interval", value: FormatInterval(tm.autoSwitchInterval) })
    rows.Push({ kind: "cycle", name: "pool", label: "Rotation Pool", value: tm.AutoSwitchPoolLabel() })
    rows.Push({ kind: "cycle", name: "target", label: "Rotation Applies To", value: tm.AutoSwitchTargetLabel() })

    pickLabel = LastViewedLabel(state)
    rows.Push({ kind: "action", name: "ambient", label: "Set as Ambient Wallpaper", value: pickLabel })
    rows.Push({ kind: "action", name: "backdrop", label: "Set as Menu Backdrop", value: pickLabel })

    return rows
end function
