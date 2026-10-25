' Spotlight Studio for Roku
' view_settings.brs - Channel configuration, diagnostics and the legal notice.
'
' Rows carry a `kind` so the input handler in main.brs can tell a cycling row
' from an action row without duplicating the list.  The list is rebuilt on every
' render, which is affordable now that the render loop only paints when
' something actually changed (see main.brs `FrameNeedsRender`).

function SettingsLayout() as object
    gaa = GetGlobalAA()
    if gaa.__ssSettingsLayout = invalid
        gaa.__ssSettingsLayout = {
            panelX: 85,
            panelY: 130,
            panelW: 1080,
            panelH: 810,
            rowH: 56,
            rowsY: 210,
            infoX: 1200,
            infoW: 635
        }
    end if
    return gaa.__ssSettingsLayout
end function

sub RenderSettings(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    L = SettingsLayout()

    screen.Clear(t.bgMain)
    DrawViewHeader(screen, state, "Channel Settings", "Preferences, image pipeline diagnostics, licence state and the legal notice")

    ' ── settings rows ──────────────────────────────────────────────────
    DrawGlassPanelR(screen, L.panelX, L.panelY, L.panelW, L.panelH, t.borderSubtle, t.bgPanel, 18)
    screen.DrawRect(L.panelX + 20, L.panelY + 20, L.panelW - 40, 4, t.textAccent)
    screen.DrawText("Preferences", L.panelX + 20, L.panelY + 34, t.textPrimary, fonts.heading)
    screen.DrawText("Up/Down move   Left/Right change a value   OK run an action", L.panelX + 20, L.panelY + 68, t.textMuted, fonts.caption)

    items = BuildSettingsItems(state)
    state.settingsIdx = ClampI(state.settingsIdx, 0, items.Count() - 1)

    for i = 0 to items.Count() - 1
        item = items[i]
        rowY = L.rowsY + (i * L.rowH)
        isFocused = (state.settingsIdx = i)

        if isFocused
            DrawRoundedRectCached(screen, L.panelX + 20, rowY, L.panelW - 40, L.rowH - 8, 10, t.accentSoft)
            DrawRoundedOutline(screen, L.panelX + 20, rowY, L.panelW - 40, L.rowH - 8, 10, t.borderFocused, 2)
        end if

        labelColor = t.textSecondary
        valueColor = t.textPrimary
        if isFocused
            labelColor = t.textAccent
            valueColor = t.textOnAccent
        end if

        screen.DrawText(SafeStr(item.title), L.panelX + 34, rowY + 8, labelColor, fonts.body)
        screen.DrawText(TruncateText(SafeStr(item.desc), 74), L.panelX + 34, rowY + 30, t.textMuted, fonts.caption)

        valueText = SafeStr(item.value)
        if valueText <> "" and valueText <> "[ABOUT]"
            valueW = fonts.body.GetOneLineWidth(valueText, 1920)
            screen.DrawText(valueText, L.panelX + L.panelW - 40 - valueW, rowY + 14, valueColor, fonts.body)
            if SafeStr(item.kind) = "cycle"
                screen.DrawText("<", L.panelX + L.panelW - 66 - valueW, rowY + 14, labelColor, fonts.body)
                screen.DrawText(">", L.panelX + L.panelW - 34, rowY + 14, labelColor, fonts.body)
            end if
        end if
        if valueText = "[ABOUT]"
            DrawBadge(screen, "READ", L.panelX + L.panelW - 130, rowY + 14, t.btnFocused, t.textOnAccent, fonts.caption)
        end if
    end for

    ' ── diagnostics ────────────────────────────────────────────────────
    DrawGlassPanelR(screen, L.infoX, L.panelY, L.infoW, 380, t.borderSubtle, t.bgPanel, 18)
    screen.DrawText("Diagnostics", L.infoX + 20, L.panelY + 18, t.textPrimary, fonts.heading)

    diagRows = BuildDiagnostics(state)
    for i = 0 to diagRows.Count() - 1
        row = diagRows[i]
        rowColor = t.textSecondary
        valueColor = t.textPrimary
        ' Colour the two rows a user can act on when something is wrong.
        if SafeStr(row.tone) = "warn" then valueColor = t.warningAmber
        if SafeStr(row.tone) = "bad" then valueColor = t.dangerRed
        screen.DrawText(SafeStr(row.label) + ":", L.infoX + 20, L.panelY + 58 + (i * 30), rowColor, fonts.caption)
        valueText = TruncateText(SafeStr(row.value), 50)
        valueW = fonts.caption.GetOneLineWidth(valueText, 1920)
        screen.DrawText(valueText, L.infoX + L.infoW - 20 - valueW, L.panelY + 58 + (i * 30), valueColor, fonts.caption)
    end for

    ' ── legal / about ──────────────────────────────────────────────────
    aboutY = L.panelY + 400
    DrawGlassPanelR(screen, L.infoX, aboutY, L.infoW, 410, t.borderFocused, t.bgPanel, 18)
    screen.DrawText("About & Legal", L.infoX + 20, aboutY + 18, t.textPrimary, fonts.heading)

    aboutLines = [
        "Spotlight Studio " + state.appVersion,
        "A curated archive of Windows Spotlight and",
        "Peapix wallpapers for every screen you own.",
        "",
        "Images are fetched from the project's public",
        "Git-LFS CDN and remain the property of their",
        "original photographers and rights holders.",
        "",
        "This channel is an independent fan project and",
        "is not affiliated with, endorsed by, or",
        "sponsored by Microsoft, Roku or Peapix."
    ]
    for i = 0 to aboutLines.Count() - 1
        screen.DrawText(aboutLines[i], L.infoX + 20, aboutY + 58 + (i * 26), t.textSecondary, fonts.caption)
    end for

    DrawViewFooter(screen, state, "Left/Right change value   OK run action   Play open the Filter dialog   Back return")
end sub

' Row model: { title, desc, value, kind }.  kind is "cycle", "action" or "info".
function BuildSettingsItems(state as object) as object
    sm = state.settingsMgr
    items = []

    items.Push({
        title: "Clock Format",
        desc: "12-hour, 24-hour, or follow the Roku system setting",
        value: LabelFor(ClockFormatLabels(), sm.GetStr("clockFormat", "auto")),
        kind: "cycle"
    })

    soundLabel = "Off"
    if sm.GetBool("soundEffects", true) then soundLabel = "On (system sounds)"
    items.Push({
        title: "Navigation Sounds",
        desc: "Roku system effects - they respect your device's sound setting",
        value: soundLabel,
        kind: "cycle"
    })

    items.Push({
        title: "Ambient Interval",
        desc: "How long each wallpaper stays up in Ambient Mode",
        value: FormatInterval(sm.GetInt("ambientInterval", 30)),
        kind: "cycle"
    })

    sleepMinutes = sm.GetInt("ambientSleepMinutes", 0)
    sleepLabel = "Off"
    if sleepMinutes > 0 then sleepLabel = StrI(sleepMinutes).Trim() + " minutes"
    items.Push({
        title: "Ambient Sleep Timer",
        desc: "Dim the screen after 30 minutes, 1 hour or 2 hours to reduce OLED burn-in",
        value: sleepLabel,
        kind: "cycle"
    })

    items.Push({
        title: "Safe Area Guides",
        desc: "Broadcast action-safe (90%) and title-safe (80%) overlays",
        value: LabelFor(SafeAreaLabels(), sm.GetStr("safeAreaGuides", "off")),
        kind: "cycle"
    })

    items.Push({
        title: "Menu Backdrop",
        desc: "Dim the assigned wallpaper behind the gallery grid",
        value: YesNo(state.themeMgr.backdropWallpaperId <> 0),
        kind: "action"
    })

    items.Push({
        title: "Restore Last Position",
        desc: "Jump back to the tab and page you were on when you left",
        value: "Resume",
        kind: "action"
    })

    items.Push({
        title: "Clear Image Cache",
        desc: "Free decoded bitmaps and the tmp:/ thumbnail cache",
        value: StrI(state.imgLoader.thumbCache.Count()).Trim() + " cached",
        kind: "action"
    })

    items.Push({
        title: "Reset Filters",
        desc: "Category, resolution, archive, sort, tag, search and favourites",
        value: "Reset",
        kind: "action"
    })

    favCount = state.favMgr.Count()
    items.Push({
        title: "Clear All Favorites",
        desc: "Remove every wallpaper you have hearted on this device",
        value: StrI(favCount).Trim() + " saved",
        kind: "action"
    })

    failureCount = state.imgLoader.FailureCount()
    items.Push({
        title: "Retry Failed Images",
        desc: "Clear the give-up list so thumbnails that errored can load again",
        value: StrI(failureCount).Trim() + " failed",
        kind: "action"
    })

    if not state.licenseMgr.HasProAccess()
        trialValue = "Start Trial"
        if state.licenseMgr.trialStartedSec > 0 then trialValue = "Used"
        items.Push({
            title: "Spotlight Pro Trial",
            desc: "3 days of every Pro feature, no payment details needed",
            value: trialValue,
            kind: "action"
        })
    end if

    items.Push({
        title: "Image Source",
        desc: "Wallpapers stream from the project's public Git-LFS CDN",
        value: "GitHub CDN",
        kind: "info"
    })

    items.Push({
        title: "Licence",
        desc: state.licenseMgr.GetLicenseSummary(),
        value: state.licenseMgr.GetProBadge(),
        kind: "info"
    })

    items.Push({
        title: "About Spotlight Studio",
        desc: "Attribution, disclaimer and version details",
        value: "[ABOUT]",
        kind: "info"
    })

    return items
end function

function BuildDiagnostics(state as object) as object
    deviceInfo = state.deviceInfo
    rows = []
    rows.Push({ label: "Device", value: SafeStr(deviceInfo.GetVersion()) })
    rows.Push({ label: "Model", value: SafeStr(deviceInfo.GetModelDisplayName()) })
    rows.Push({ label: "Display", value: SafeStr(deviceInfo.GetDisplayType()) + " " + SafeStr(deviceInfo.GetGraphicsPlatform()) })
    rows.Push({ label: "UI Resolution", value: SafeStr(state.uiResolution) + " (" + StrI(state.canvasW).Trim() + "x" + StrI(state.canvasH).Trim() + " canvas)" })
    netLabel = NetworkLabel(deviceInfo)
    netTone = ""
    if netLabel = "Offline" then netTone = "bad"
    rows.Push({ label: "Network", value: netLabel, tone: netTone })
    rows.Push({ label: "Archive", value: StrI(state.totalCount).Trim() + " wallpapers" })
    rows.Push({ label: "Filtered", value: StrI(state.filtered.Count()).Trim() + " wallpapers" })
    rows.Push({ label: "Image Cache", value: state.imgLoader.Stats() })
    rows.Push({ label: "Disk Cache", value: StrI(state.imgLoader.DiskUsage() / 1024).Trim() + " KB in tmp:/" })
    failCount = state.imgLoader.FailureCount()
    rows.Push({ label: "Failed Images", value: StrI(failCount).Trim(), tone: "warn" })
    rows.Push({ label: "Draw Cache", value: GetGfxCache().Stats() })
    rows.Push({ label: "Favorites", value: StrI(state.favMgr.Count()).Trim() + " saved" })
    rows.Push({ label: "Palette", value: state.themeMgr.activeThemeName })
    rows.Push({ label: "Build", value: state.appVersion })
    return rows
end function

function NetworkLabel(deviceInfo as object) as string
    if deviceInfo = invalid then return "Unknown"
    linked = false
    if deviceInfo.GetLinkStatus() then linked = true
    if not linked then return "Offline"
    if not deviceInfo.GetInternetStatus() then return "No internet"
    kind = SafeStr(deviceInfo.GetConnectionType())
    if kind = "WiFiConnection" then return "WiFi"
    if kind = "WiredConnection" then return "Wired"
    return "Connected"
end function

' True when the device has no usable link, used by the gallery header banner.
function IsOffline(deviceInfo as object) as boolean
    if deviceInfo = invalid then return false
    if not deviceInfo.GetLinkStatus() then return true
    return false
end function
