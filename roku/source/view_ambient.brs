' Spotlight Studio for Roku
' view_ambient.brs - Ambient TV Screensaver mode with auto-cycling and clock overlay

sub RenderAmbient(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    item = state.ambientWallpaper
    if item = invalid and state.filtered.Count() > 0
        item = state.filtered[0]
        state.ambientWallpaper = item
    end if
    
    ' 1. Clear Screen
    screen.Clear(t.bgMain)
    
    if item <> invalid
        ' Draw high-resolution wallpaper or fallback thumbnail with subtle cinematic drift
        imgBmp = state.GetCachedFullImage(item.filename)
        if imgBmp = invalid or imgBmp.GetWidth() <= 1
            imgBmp = state.GetCachedThumbnail(item.filename)
        end if
        
        if imgBmp <> invalid and imgBmp.GetWidth() > 1
            ' Subtle Ken Burns gentle drift to prevent OLED burn-in and add cinematic motion
            driftX = 0
            driftY = 0
            if state.animClock <> invalid
                driftPhase = state.animClock.TotalMilliseconds() / 5000.0
                driftX = CInt(Sin(driftPhase) * 12)
                driftY = CInt(Cos(driftPhase * 0.7) * 8)
            end if
            screen.DrawResizedObject(-20 + driftX, -15 + driftY, 1960, 1110, imgBmp)
        else
            spinnerAngle = 0
            if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
            DrawLoadingSpinner(screen, 960, 520, 26, spinnerAngle, t.textAccent, t.borderSubtle)
            screen.DrawText("Loading Ambient Wallpaper...", 830, 565, t.textMuted, fonts.body)
        end if
    end if
    
    ' 2. Ambient Clock Overlay (Top Right)
    if state.settingsMgr = invalid or state.settingsMgr.ambientClock
        clockStr = state.clockTime
        if clockStr = "" then clockStr = "12:00"
        dateStr = state.clockDate
        if dateStr = invalid or dateStr = "" then dateStr = "Today"
        
        ' Ambient rounded glass capsule for clock
        clockBoxW = 290
        clockBoxH = 100
        clockBoxX = 1920 - clockBoxW - 80
        clockBoxY = 60
        
        DrawGlassPanelR(screen, clockBoxX, clockBoxY, clockBoxW, clockBoxH, t.borderSubtle, &h0A0C14B8, 16)
        screen.DrawText(clockStr, clockBoxX + 30, clockBoxY + 18, t.textPrimary, fonts.title)
        screen.DrawText(dateStr, clockBoxX + 30, clockBoxY + 68, t.textSecondary, fonts.small)
    end if
    
    ' 3. Wallpaper Info Banner (Bottom Left)
    if item <> invalid and (state.settingsMgr = invalid or state.settingsMgr.ambientInfo)
        infoBoxW = 750
        infoBoxH = 80
        infoBoxX = 80
        infoBoxY = 1080 - infoBoxH - 60
        
        DrawGlassPanelR(screen, infoBoxX, infoBoxY, infoBoxW, infoBoxH, t.borderSubtle, &h0A0C14B8, 16)
        
        titleStr = TruncateText(item.title, 55)
        screen.DrawText(titleStr, infoBoxX + 25, infoBoxY + 16, t.textPrimary, fonts.body)
        
        detailStr = "Windows Spotlight  •  " + FormatDate(item.date_spotted)
        if item.quality <> invalid then detailStr = detailStr + "  (" + item.quality + ")"
        screen.DrawText(detailStr, infoBoxX + 25, infoBoxY + 48, t.textAccent, fonts.small)
    end if
    
    ' 4. Ambient Exit Hint (Subtle bottom-center, fades away or very discreet)
    screen.DrawText("Press any button to exit Ambient Mode", 800, 1040, &hFFFFFF44, fonts.small)
end sub
