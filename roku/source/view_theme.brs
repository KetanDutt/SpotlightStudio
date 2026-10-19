' Spotlight Studio for Roku
' view_theme.brs - Roku Home-screen theme changer and screensaver manager view

sub RenderThemeView(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    tm = state.themeMgr
    lm = state.licenseMgr
    
    ' 1. Clear background
    screen.Clear(t.bgMain)
    
    ' 2. Header
    screen.DrawRect(0, 0, 1920, 110, t.bgHeader)
    screen.DrawRect(0, 109, 1920, 1, t.borderSubtle)
    screen.DrawText("HOME THEME & SCREENSAVER STUDIO", 85, 25, t.textPrimary, fonts.title)
    
    statusBadge = lm.GetStatusBadge()
    badgeColor = t.btnNormal
    if lm.IsTrialActive() then badgeColor = t.textAccent
    if lm.hasFullVersion then badgeColor = t.badgeFhd
    if lm.HasActiveSubscription() then badgeColor = t.badge4k
    DrawBadge(screen, statusBadge, 1600, 32, badgeColor, t.textPrimary, fonts.small)
    
    screen.DrawText("Apply Windows Spotlight themes to your Roku TV, set wallpapers and configure auto-rotation", 85, 74, t.textSecondary, fonts.caption)
    
    ' 3. Left Panel: Active Status & Preview (85, 140, 750 x 800)
    leftX = 85
    leftY = 140
    leftW = 750
    leftH = 800
    DrawGlassPanel(screen, leftX, leftY, leftW, leftH, t.borderSubtle, t.bgPanel)
    
    screen.DrawText("ACTIVE ROKU CONFIGURATION", leftX + 35, leftY + 30, t.textAccent, fonts.caption)
    
    ' Active Home Wallpaper preview
    activeHome = tm.homeWallpaper
    if activeHome = invalid and state.allWallpapers.Count() > 0
        activeHome = state.allWallpapers[0]
        tm.homeWallpaper = activeHome
    end if
    
    screen.DrawText("Current Home Wallpaper:", leftX + 35, leftY + 70, t.textMuted, fonts.small)
    screen.DrawText(TruncateText(activeHome.title, 42), leftX + 35, leftY + 95, t.textPrimary, fonts.body)
    
    ' Preview box with rounded corners
    homeThumb = state.GetCachedThumbnail(activeHome.filename)
    DrawRoundRect(screen, leftX + 35, leftY + 135, 680, 240, 12, &h161A28EE)
    if homeThumb <> invalid and homeThumb.GetWidth() > 1
        screen.DrawResizedObject(leftX + 35, leftY + 135, 680, 240, homeThumb)
    else
        spinnerAngle = 0
        if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
        DrawLoadingSpinner(screen, leftX + 35 + 340, leftY + 135 + 105, 20, spinnerAngle, t.textAccent, t.borderSubtle)
        screen.DrawText("Loading Home Preview...", leftX + 35 + 260, leftY + 135 + 140, t.textMuted, fonts.small)
    end if
    DrawRoundedOutline(screen, leftX + 35, leftY + 135, 680, 240, 12, t.borderSubtle, 1)
    
    ' Active Screensaver preview
    activeSS = tm.screensaverWallpaper
    if activeSS = invalid and state.dailyWallpaper <> invalid
        activeSS = state.dailyWallpaper
        tm.screensaverWallpaper = activeSS
    end if
    
    screen.DrawText("Current TV Screensaver:", leftX + 35, leftY + 400, t.textMuted, fonts.small)
    screen.DrawText(TruncateText(activeSS.title, 42), leftX + 35, leftY + 425, t.textPrimary, fonts.body)
    
    ssThumb = state.GetCachedThumbnail(activeSS.filename)
    DrawRoundRect(screen, leftX + 35, leftY + 465, 680, 240, 12, &h161A28EE)
    if ssThumb <> invalid and ssThumb.GetWidth() > 1
        screen.DrawResizedObject(leftX + 35, leftY + 465, 680, 240, ssThumb)
    else
        spinnerAngle = 0
        if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
        DrawLoadingSpinner(screen, leftX + 35 + 340, leftY + 465 + 105, 20, spinnerAngle, t.textAccent, t.borderSubtle)
        screen.DrawText("Loading Screensaver Preview...", leftX + 35 + 240, leftY + 465 + 140, t.textMuted, fonts.small)
    end if
    DrawRoundedOutline(screen, leftX + 35, leftY + 465, 680, 240, 12, t.borderSubtle, 1)
    
    ' Active Theme details
    screen.DrawText("System Theme Palette: " + tm.activeThemeName, leftX + 35, leftY + 740, t.textAccent, fonts.body)
    
    ' 4. Right Panel: Theme Controls & Auto-Switching Actions (870, 140, 965 x 800)
    rightX = 870
    rightY = 140
    rightW = 965
    rightH = 800
    DrawGlassPanelR(screen, rightX, rightY, rightW, rightH, t.borderSubtle, t.bgPanel, 16)
    
    screen.DrawText("ROKU THEME PALETTES", rightX + 35, rightY + 30, t.textAccent, fonts.caption)
    
    ' Theme Palette Chips
    palX = rightX + 35
    palY = rightY + 70
    for p = 0 to tm.palettes.Count() - 1
        pal = tm.palettes[p]
        isPalSelected = (tm.activeThemeName = pal.name)
        
        chipW = 165
        chipH = 65
        chipRadius = 10
        
        chipBg = t.btnNormal
        chipBorder = t.borderSubtle
        if isPalSelected
            chipBorder = t.borderFocused
            chipBg = &h00D2FF22
        end if
        
        DrawRoundRect(screen, palX, palY, chipW, chipH, chipRadius, chipBg)
        DrawRoundedOutline(screen, palX, palY, chipW, chipH, chipRadius, chipBorder, 2)
        
        screen.DrawText(pal.name, palX + 12, palY + 14, t.textPrimary, fonts.small)
        
        if isPalSelected
            DrawBadge(screen, "ACTIVE", palX + 12, palY + 38, t.borderFocused, t.bgMain, fonts.small)
        end if
        
        palX = palX + chipW + 15
    end for
    
    ' Controls & Action Buttons
    actionRows = [
        { title: "Set Selected Wallpaper as Home Screen", desc: "Requires 3-Day Trial or BuyFullVersion ($4.99)", isPro: false },
        { title: "Set Selected Wallpaper as TV Screensaver", desc: "Requires 3-Day Trial or BuyFullVersion ($4.99)", isPro: false },
        { title: "Automatic Wallpaper & Screensaver Switching", desc: "Requires Pro Subscription ($1.99/mo or $14.99/yr)", isPro: true, status: tm.BoolToStr(tm.autoSwitchEnabled) },
        { title: "Auto-Switch Interval", desc: "Frequency: 1 min, 5 min, 15 min, 30 min, 1 hr, Daily", isPro: true, status: StrI(tm.autoSwitchInterval / 60).Trim() + " Minutes" },
        { title: "Run Ambient TV Screensaver Now", desc: "Launch full ambient mode immediately", isPro: false },
        { title: "Open Spotlight Pro Store / Upgrades", desc: "Purchase Full Version or Subscriptions", isPro: false }
    ]
    
    btnY = rightY + 165
    rowH = 92
    rowRadius = 12
    
    for a = 0 to actionRows.Count() - 1
        act = actionRows[a]
        isFocused = (state.themeActionIdx = a)
        
        if isFocused
            rowBg = &h00D2FF22
            DrawRoundRect(screen, rightX + 25, btnY, rightW - 50, rowH, rowRadius, rowBg)
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, rightX + 25, btnY, rightW - 50, rowH, t.borderFocused, rowRadius, glow)
        else
            DrawRoundRect(screen, rightX + 25, btnY, rightW - 50, rowH, rowRadius, &h0A0E1855)
            DrawRoundedOutline(screen, rightX + 25, btnY, rightW - 50, rowH, rowRadius, t.borderSubtle, 1)
        end if
        
        titleColor = t.textPrimary
        if isFocused then titleColor = t.textAccent
        screen.DrawText(act.title, rightX + 45, btnY + 16, titleColor, fonts.body)
        screen.DrawText(act.desc, rightX + 45, btnY + 52, t.textMuted, fonts.small)
        
        if act.isPro
            DrawBadge(screen, "PRO SUB", rightX + rightW - 170, btnY + 16, t.badge4k, t.textPrimary, fonts.small)
        end if
        
        if act.status <> invalid
            DrawBadge(screen, act.status, rightX + rightW - 190, btnY + 48, t.btnNormal, t.textPrimary, fonts.small)
        end if
        
        btnY = btnY + rowH + 6
    end for
    
    ' 5. Footer Bar
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    screen.DrawText("[▲ / ▼] Select Action     [◄ / ►] Change Theme Palette / Timer     [OK] Apply Action     [Back] Return to Gallery", 85, 1010, t.textSecondary, fonts.body)
end sub
