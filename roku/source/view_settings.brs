' Spotlight Studio for Roku
' view_settings.brs - Device settings, display calibration, screensaver timers, system diagnostics & legal credits

sub RenderSettings(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    sm = state.settingsMgr
    
    ' 1. Clear background
    screen.Clear(t.bgMain)
    
    ' 2. Top Header (0 to 110)
    screen.DrawRect(0, 0, 1920, 110, t.bgHeader)
    screen.DrawRect(0, 109, 1920, 1, t.borderSubtle)
    screen.DrawText("SETTINGS & DEVICE CONFIGURATION", 85, 30, t.textPrimary, fonts.title)
    screen.DrawText("Customize TV display, ambient timers, safe area calibration and view legal credits", 85, 75, t.textSecondary, fonts.caption)
    
    ' 3. Settings List (Left Side: 85, 140, 1100 x 800)
    listX = 85
    listY = 140
    listW = 1100
    listH = 800
    DrawGlassPanelR(screen, listX, listY, listW, listH, t.borderSubtle, t.bgPanel, 16)
    
    clockDisplay = "AUTO (DEVICE)"
    if sm.clockFormat = "12h" then clockDisplay = "12-HOUR (AM/PM)"
    if sm.clockFormat = "24h" then clockDisplay = "24-HOUR (24h)"
    
    sortDisplay = "NEWEST FIRST"
    if sm.sortOrder = "oldest" then sortDisplay = "OLDEST FIRST"
    if sm.sortOrder = "quality" then sortDisplay = "4K UHD FIRST"
    if sm.sortOrder = "random" then sortDisplay = "RANDOM SHUFFLE"
    
    settingsItems = [
        { title: "Ambient Slideshow Interval", desc: "Duration each wallpaper is displayed in Ambient Mode", value: StrI(sm.ambientInterval).Trim() + " Seconds" },
        { title: "Ambient Clock Display", desc: "Overlay digital clock & date on ambient screensaver", value: sm.BoolToStr(sm.ambientClock) },
        { title: "Clock Time Format", desc: "Device local time display format across all views", value: clockDisplay },
        { title: "Ambient Wallpaper Info", desc: "Display title and location badge in ambient mode", value: sm.BoolToStr(sm.ambientInfo) },
        { title: "Default Gallery Sorting", desc: "Sort order for browsing the full wallpaper collection", value: sortDisplay },
        { title: "Viewer Aspect Mode", desc: "Fit preserves entire photo; Fill crops to 16:9 screen", value: UCase(sm.viewerZoom) },
        { title: "TV Safe Area Guides", desc: "Overlay Action Safe (90%) or Title Safe (80%) guides", value: UCase(sm.safeArea) },
        { title: "Sound Effects", desc: "Tactile remote feedback audio clicks", value: sm.BoolToStr(sm.soundEnabled) },
        { title: "Clear All Favorites", desc: "Erase locally saved favorites list from device", value: "[CLEAR]" },
        { title: "Restore Default Settings", desc: "Reset all display and timer preferences to defaults", value: "[RESET]" },
        { title: "About Spotlight Studio", desc: "Author credits, wallpaper attribution, copyright & disclaimer", value: "[ABOUT]" }
    ]
    
    rowY = listY + 14
    rowH = 64
    rowGap = 6
    
    for r = 0 to settingsItems.Count() - 1
        item = settingsItems[r]
        isFocused = (state.settingsIdx = r)
        
        rowRadius = 10
        if isFocused
            rowBg = &h00D2FF22
            DrawRoundRect(screen, listX + 15, rowY, listW - 30, rowH, rowRadius, rowBg)
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, listX + 15, rowY, listW - 30, rowH, t.borderFocused, rowRadius, glow)
        else
            DrawRoundRect(screen, listX + 15, rowY, listW - 30, rowH, rowRadius, &h0A0E1855)
            DrawRoundedOutline(screen, listX + 15, rowY, listW - 30, rowH, rowRadius, t.borderSubtle, 1)
        end if
        
        ' Title & Description
        titleColor = t.textPrimary
        if isFocused then titleColor = t.textAccent
        screen.DrawText(item.title, listX + 35, rowY + 10, titleColor, fonts.body)
        screen.DrawText(item.desc, listX + 35, rowY + 38, t.textMuted, fonts.small)
        
        ' Current Value Pill on Right
        valX = listX + listW - 270
        DrawBadge(screen, item.value, valX, rowY + 14, t.btnNormal, t.textPrimary, fonts.small)
        
        if isFocused
            ' Draw arrow hints on focused row (except About and Action buttons)
            if r <= 7
                screen.DrawText("◄  ►", valX - 65, rowY + 18, t.textAccent, fonts.body)
            else
                screen.DrawText("[OK]", valX - 55, rowY + 18, t.textAccent, fonts.caption)
            end if
        end if
        
        rowY = rowY + rowH + rowGap
    end for
    
    ' 4. Right Side: Split into Diagnostics Panel and Credits/Disclaimer Panel
    infoX = 1220
    infoW = 615
    dev = state.deviceInfo
    app = state.appInfo
    
    ' 4A. System Diagnostics Panel (Top: Y=140, H=340)
    topH = 340
    DrawGlassPanelR(screen, infoX, 140, infoW, topH, t.borderSubtle, t.bgPanel, 16)
    screen.DrawText("DEVICE & SYSTEM DIAGNOSTICS", infoX + 30, 165, t.textAccent, fonts.caption)
    
    diagRows = [
        { label: "Channel Title", val: app.GetTitle() + " (v" + app.GetVersion() + ")" },
        { label: "Platform", val: "Roku OS / BrightScript Engine" },
        { label: "Device Model", val: dev.GetModelDisplayName() + " (" + dev.GetModel() + ")" },
        { label: "Display Resolution", val: state.displayRes },
        { label: "Wallpaper Catalog", val: StrI(state.allWallpapers.Count()).Trim() + " Photos Available" },
        { label: "Stored Favorites", val: StrI(state.favMgr.GetCount()).Trim() + " Saved Locally" }
    ]
    
    curY = 202
    for each d in diagRows
        screen.DrawText(d.label, infoX + 30, curY, t.textMuted, fonts.small)
        screen.DrawText(d.val, infoX + 220, curY, t.textPrimary, fonts.small)
        screen.DrawRect(infoX + 30, curY + 22, infoW - 60, 1, &hFFFFFF0D)
        curY = curY + 28
    end for
    
    ' 4B. About, Credits & Legal Disclaimer Panel (Bottom: Y=500, H=440)
    botY = 500
    botH = 440
    DrawGlassPanelR(screen, infoX, botY, infoW, botH, t.borderSubtle, t.bgPanel, 16)
    
    screen.DrawText("ABOUT, CREDITS & DISCLAIMER", infoX + 30, botY + 24, t.textAccent, fonts.caption)
    DrawBadge(screen, "LEGAL NOTICE", infoX + infoW - 145, botY + 18, t.btnNormal, t.textAccent, fonts.caption)
    
    ' Credits block
    screen.DrawText("Created & Developed by:", infoX + 30, botY + 62, t.textMuted, fonts.small)
    screen.DrawText("Ketan Dutt (© 2026 All Rights Reserved)", infoX + 30, botY + 84, t.textPrimary, fonts.body)
    
    screen.DrawText("Wallpaper Sources:", infoX + 30, botY + 118, t.textMuted, fonts.small)
    screen.DrawText("Peapix (peapix.com) & Windows10Spotlight", infoX + 30, botY + 140, t.textPrimary, fonts.body)
    
    ' Legal Disclaimer box
    boxY = botY + 175
    boxH = 195
    DrawRoundRect(screen, infoX + 25, boxY, infoW - 50, boxH, 10, &h0A0E1899)
    DrawRoundedOutline(screen, infoX + 25, boxY, infoW - 50, boxH, 10, t.borderSubtle, 1)
    
    screen.DrawText("LEGAL DISCLAIMER:", infoX + 40, boxY + 14, t.textAccent, fonts.caption)
    screen.DrawText("Spotlight Studio is an independent, unofficial project.", infoX + 40, boxY + 42, t.textPrimary, fonts.small)
    screen.DrawText("Not affiliated with or endorsed by Microsoft, Peapix,", infoX + 40, boxY + 68, t.textSecondary, fonts.small)
    screen.DrawText("or Windows10Spotlight. All Windows Spotlight wallpapers", infoX + 40, boxY + 94, t.textSecondary, fonts.small)
    screen.DrawText("remain property of original photographers & copyright holders.", infoX + 40, boxY + 120, t.textSecondary, fonts.small)
    screen.DrawText("Provided strictly for personal viewing on Roku TV.", infoX + 40, boxY + 146, t.textMuted, fonts.small)
    screen.DrawText("Commercial use, scraping or AI training is prohibited.", infoX + 40, boxY + 170, &hFF8800CC, fonts.small)
    
    ' Action hint
    screen.DrawText("Press [OK] on 'About' row to view full legal modal", infoX + 30, botY + 395, t.textAccent, fonts.small)
    
    ' 5. Footer Bar
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    screen.DrawText("[▲ / ▼] Navigate Settings     [◄ / ►] Change Value     [OK] Select / View About     [Back] Return to Gallery", 85, 1010, t.textSecondary, fonts.body)
    
    ' 6. Render Full About Dialog Modal if active
    if state.isAboutDialogVisible
        RenderAboutDialog(screen, state)
    end if
end sub

' ─── RENDER FULL ABOUT & LEGAL MODAL DIALOG ───────────────────────────
sub RenderAboutDialog(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    ' Dark Translucent Backdrop
    screen.DrawRect(0, 0, 1920, 1080, &h000000C8)
    
    ' Modal Window (1400 x 820)
    diaX = 260
    diaY = 130
    diaW = 1400
    diaH = 820
    diaR = 20
    
    DrawGlassPanelR(screen, diaX, diaY, diaW, diaH, t.borderFocused, &h0A0E1AFA, diaR)
    
    ' Header
    screen.DrawText("ABOUT SPOTLIGHT STUDIO", diaX + 50, diaY + 32, t.textPrimary, fonts.title)
    DrawBadge(screen, "UNOFFICIAL COMMUNITY PROJECT", diaX + diaW - 350, diaY + 34, t.btnNormal, t.textAccent, fonts.caption)
    screen.DrawText("Curated ultra-HD Windows Spotlight wallpaper catalog and ambient screensaver for Roku TV", diaX + 50, diaY + 76, t.textSecondary, fonts.caption)
    screen.DrawRect(diaX + 50, diaY + 110, diaW - 100, 1, t.borderSubtle)
    
    ' Section 1: Author & Developer Credit
    sec1Y = diaY + 125
    sec1H = 130
    DrawRoundRect(screen, diaX + 50, sec1Y, diaW - 100, sec1H, 12, &h080C1688)
    DrawRoundedOutline(screen, diaX + 50, sec1Y, diaW - 100, sec1H, 12, t.borderSubtle, 1)
    screen.DrawText("AUTHOR & DEVELOPER CREDITS", diaX + 75, sec1Y + 14, t.textAccent, fonts.caption)
    screen.DrawText("Created & Developed by: Ketan Dutt", diaX + 75, sec1Y + 44, t.textPrimary, fonts.body)
    screen.DrawText("Copyright (c) 2026 Ketan Dutt. All Rights Reserved.", diaX + 75, sec1Y + 74, t.textSecondary, fonts.small)
    screen.DrawText("Repository: github.com/KetanDutt/SpotlightStudio  *  Contact: ketan6196@gmail.com", diaX + 75, sec1Y + 98, t.textMuted, fonts.small)
    
    ' Section 2: Wallpaper Sources & Attribution
    sec2Y = sec1Y + sec1H + 15
    sec2H = 130
    DrawRoundRect(screen, diaX + 50, sec2Y, diaW - 100, sec2H, 12, &h080C1688)
    DrawRoundedOutline(screen, diaX + 50, sec2Y, diaW - 100, sec2H, 12, t.borderSubtle, 1)
    screen.DrawText("WALLPAPER ARCHIVE & DATA ATTRIBUTION", diaX + 75, sec2Y + 14, t.textAccent, fonts.caption)
    screen.DrawText("Sources: Windows Spotlight wallpapers collected via Peapix (peapix.com) and Windows10Spotlight", diaX + 75, sec2Y + 44, t.textPrimary, fonts.body)
    screen.DrawText("Archive: 7,474+ Curated ultra-high-definition wallpapers, perceptual hash de-duplicated", diaX + 75, sec2Y + 74, t.textSecondary, fonts.small)
    screen.DrawText("Attribution: All photographs remain the exclusive intellectual property of their original photographers.", diaX + 75, sec2Y + 98, t.textMuted, fonts.small)
    
    ' Section 3: Legal Disclaimer & Trademark Notice
    sec3Y = sec2Y + sec2H + 15
    sec3H = 220
    DrawRoundRect(screen, diaX + 50, sec3Y, diaW - 100, sec3H, 12, &h140F0A88)
    DrawRoundedOutline(screen, diaX + 50, sec3Y, diaW - 100, sec3H, 12, &hFF880055, 1)
    screen.DrawText("LEGAL DISCLAIMER & TRADEMARKS", diaX + 75, sec3Y + 14, &hFFB040FF, fonts.caption)
    screen.DrawText("1. Spotlight Studio is an independent, unofficial community application developed for Roku OS.", diaX + 75, sec3Y + 44, t.textPrimary, fonts.small)
    screen.DrawText("2. It is NOT affiliated with, authorized, maintained, sponsored, or endorsed by Microsoft, Peapix, or Windows10Spotlight.", diaX + 75, sec3Y + 72, t.textSecondary, fonts.small)
    screen.DrawText("3. Microsoft, Windows, Windows 10, Windows 11, and Windows Spotlight are trademarks of Microsoft Corporation.", diaX + 75, sec3Y + 100, t.textSecondary, fonts.small)
    screen.DrawText("4. Wallpapers are provided strictly for personal evaluation, viewing, and Roku TV screensaver enjoyment.", diaX + 75, sec3Y + 128, t.textSecondary, fonts.small)
    screen.DrawText("5. Commercial use, public redistribution, scraping, or AI/ML model training without explicit permission is strictly prohibited.", diaX + 75, sec3Y + 156, t.textMuted, fonts.small)
    screen.DrawText("6. For commercial licensing permissions, contact the author at ketan6196@gmail.com.", diaX + 75, sec3Y + 184, &hFFB040CC, fonts.small)
    
    ' Close Action Button at Bottom
    btnW = 380
    btnH = 50
    btnX = diaX + (diaW - btnW) / 2
    btnY = diaY + diaH - 74
    glow = 255
    if state.glowAlpha <> invalid then glow = state.glowAlpha
    DrawRoundRect(screen, btnX, btnY, btnW, btnH, 10, t.btnFocused)
    DrawRoundedOutline(screen, btnX, btnY, btnW, btnH, 10, (t.borderFocused and &hFFFFFF00) or glow, 2)
    screen.DrawText("[OK / Back] Close About Dialog", btnX + 36, btnY + 13, t.bgMain, fonts.body)
end sub
