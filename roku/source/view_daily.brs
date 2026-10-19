' Spotlight Studio for Roku
' view_daily.brs - Daily Spotlight hero showcase view

sub RenderDailyView(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    dailyItem = state.dailyWallpaper
    if dailyItem = invalid
        screen.Clear(t.bgMain)
        screen.DrawText("No Daily Wallpaper Available", 800, 500, t.textPrimary, fonts.heading)
        return
    end if
    
    ' 1. Clear background
    screen.Clear(t.bgMain)
    
    ' 2. Header
    screen.DrawRect(0, 0, 1920, 110, t.bgHeader)
    screen.DrawRect(0, 109, 1920, 1, t.borderSubtle)
    screen.DrawText("DAILY SPOTLIGHT", 85, 25, t.textPrimary, fonts.title)
    
    clockStr = state.clockTime
    if clockStr = "" then clockStr = "12:00"
    dateStr = state.clockDate
    if dateStr = invalid or dateStr = "" then dateStr = "Today"
    
    subText = dateStr + "  •  Local Time: " + clockStr + "  •  Spotted: " + FormatDate(dailyItem.date_spotted)
    screen.DrawText(subText, 85, 75, t.textAccent, fonts.caption)
    
    screen.DrawText(clockStr, 1710, 24, t.textPrimary, fonts.heading)
    screen.DrawText(dateStr, 1710, 68, t.textSecondary, fonts.small)
    
    ' 3. Hero Preview (Left Side: 85, 150, 1080 x 650) with rounded corners
    heroX = 85
    heroY = 150
    heroW = 1080
    heroH = 650
    
    DrawGlassPanelR(screen, heroX, heroY, heroW, heroH, t.borderMedium, t.bgPanel, 16)
    
    ' Thumbnail image with rounded borders
    DrawRoundRect(screen, heroX + 15, heroY + 15, heroW - 30, heroH - 30, 12, &h161A28EE)
    thumbBmp = state.GetCachedFullImage(dailyItem.filename)
    if thumbBmp = invalid or thumbBmp.GetWidth() <= 1
        thumbBmp = state.GetCachedThumbnail(dailyItem.filename)
    end if
    
    if thumbBmp <> invalid and thumbBmp.GetWidth() > 1
        screen.DrawResizedObject(heroX + 15, heroY + 15, heroW - 30, heroH - 30, thumbBmp)
    else
        spinnerAngle = 0
        if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
        DrawLoadingSpinner(screen, heroX + (heroW / 2), heroY + (heroH / 2) - 15, 28, spinnerAngle, t.textAccent, t.borderSubtle)
        screen.DrawText("Loading Daily Spotlight...", heroX + (heroW / 2) - 105, heroY + (heroH / 2) + 32, t.textMuted, fonts.body)
    end if
    DrawRoundedOutline(screen, heroX + 15, heroY + 15, heroW - 30, heroH - 30, 12, t.borderSubtle, 1)
    
    ' Hero resolution badge
    qText = "FHD 1080p"
    qColor = t.badgeFhd
    if dailyItem.quality <> invalid and Instr(1, dailyItem.quality, "4K") > 0
        qText = "4K / UHD"
        qColor = t.badge4k
    end if
    DrawBadge(screen, qText, heroX + 35, heroY + 35, qColor, t.textPrimary, fonts.small)
    
    ' 4. Metadata & Action Panel (Right Side: 1210, 150, 625 x 650)
    infoX = 1210
    infoY = 150
    infoW = 625
    infoH = 650
    
    DrawGlassPanelR(screen, infoX, infoY, infoW, infoH, t.borderSubtle, t.bgPanel, 16)
    
    screen.DrawText("TODAY'S FEATURED WALLPAPER", infoX + 35, infoY + 35, t.textAccent, fonts.caption)
    
    ' Title (wrapped / multi-line approximation)
    titleStr = TruncateText(dailyItem.title, 70)
    screen.DrawText(titleStr, infoX + 35, infoY + 75, t.textPrimary, fonts.heading)
    
    ' Details
    sourceStr = "Windows Spotlight"
    if dailyItem.source = "peapix" then sourceStr = "Peapix Archive"
    screen.DrawText("Provider: " + sourceStr, infoX + 35, infoY + 170, t.textSecondary, fonts.body)
    
    resStr = "1920 x 1080 (16:9)"
    if dailyItem.width <> invalid and dailyItem.height <> invalid
        resStr = StrI(dailyItem.width).Trim() + " x " + StrI(dailyItem.height).Trim()
    end if
    screen.DrawText("Resolution: " + resStr, infoX + 35, infoY + 215, t.textSecondary, fonts.body)
    
    tagsStr = TruncateText("Tags: #" + dailyItem.tags, 55)
    screen.DrawText(tagsStr, infoX + 35, infoY + 260, t.textMuted, fonts.small)
    
    ' Action Buttons (Focusable list)
    btnLabels = [
        "View Fullscreen",
        "Toggle Favorite",
        "Start Ambient Screensaver",
        "Browse Gallery"
    ]
    
    if state.favMgr <> invalid and state.favMgr.IsFavorite(dailyItem.id)
        btnLabels[1] = "♥ In Favorites (Remove)"
    end if
    
    btnY = infoY + 330
    for b = 0 to btnLabels.Count() - 1
        isFocused = (state.dailyBtnIdx = b)
        DrawButton(screen, btnLabels[b], infoX + 35, btnY, infoW - 70, 52, isFocused, fonts.body)
        if isFocused
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, infoX + 35, btnY, infoW - 70, 52, t.borderFocused, 10, glow)
        end if
        btnY = btnY + 70
    end for
    
    ' 5. Footer Bar
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    screen.DrawText("[▲ / ▼] Select Action     [OK] Execute     [Back] Return to Gallery", 85, 1010, t.textSecondary, fonts.body)
end sub
