' Spotlight Studio for Roku
' view_viewer.brs - Fullscreen Lightbox wallpaper viewer with floating glass HUD and slideshow

sub RenderViewer(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    item = state.currentWallpaper
    if item = invalid
        screen.Clear(t.bgMain)
        screen.DrawText("No Wallpaper Selected", 800, 500, t.textPrimary, fonts.heading)
        return
    end if
    
    ' 1. Clear background
    screen.Clear(t.bgMain)
    
    ' 2. Draw Full Image or High-res Thumbnail
    imgBmp = state.GetCachedFullImage(item.filename)
    isFullLoaded = (imgBmp <> invalid and imgBmp.GetWidth() > 1)
    if not isFullLoaded
        ' Fallback to thumbnail while full resolution is decoding
        imgBmp = state.GetCachedThumbnail(item.filename)
    end if
    
    zoomMode = "fit"
    if state.settingsMgr <> invalid then zoomMode = state.settingsMgr.viewerZoom
    
    if imgBmp <> invalid and imgBmp.GetWidth() > 1
        srcW = imgBmp.GetWidth()
        srcH = imgBmp.GetHeight()
        
        if zoomMode = "fill"
            ' Fill entire 1920x1080 canvas
            screen.DrawResizedObject(0, 0, 1920, 1080, imgBmp)
        else
            ' Fit preserving aspect ratio
            scale = MinI(1920 / srcW, 1080 / srcH)
            if scale <= 0 then scale = 1
            destW = srcW * scale
            destH = srcH * scale
            destX = (1920 - destW) / 2
            destY = (1080 - destH) / 2
            screen.DrawResizedObject(destX, destY, destW, destH, imgBmp)
        end if
        
        ' If full image is still downloading in background, show subtle loading badge with spinner
        if not isFullLoaded and not state.isSlideshowActive
            spinnerAngle = 0
            if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
            badgeW = 230
            badgeH = 38
            badgeX = 1640
            badgeY = 30
            DrawGlassPanelR(screen, badgeX, badgeY, badgeW, badgeH, t.borderSubtle, &h0B0E18DD, 8)
            DrawLoadingSpinner(screen, badgeX + 20, badgeY + 19, 10, spinnerAngle, t.textAccent, t.borderSubtle)
            screen.DrawText("Loading 4K UHD...", badgeX + 38, badgeY + 8, t.textSecondary, fonts.small)
        end if
    else
        ' Elegant Loading state with animated spinner
        DrawGlassPanelR(screen, 680, 440, 560, 180, t.borderSubtle, t.bgPanel, 16)
        spinnerAngle = 0
        if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
        DrawLoadingSpinner(screen, 960, 495, 24, spinnerAngle, t.textAccent, t.borderSubtle)
        screen.DrawText("Loading Full Resolution Image...", 780, 545, t.textPrimary, fonts.body)
        titleSmall = TruncateText(item.title, 48)
        screen.DrawText(titleSmall, 780, 580, t.textMuted, fonts.small)
    end if
    
    ' 3. Slideshow Indicator Pill (Top Right)
    if state.isSlideshowActive
        DrawBadge(screen, "▶ SLIDESHOW PLAYING", 1620, 30, t.badge4k, t.textPrimary, fonts.small)
    end if
    
    ' 4. Floating Glass HUD (Rendered when HUD is active)
    if state.isHudVisible
        ' Top Floating HUD Banner (80px height, inset 60px from edges)
        DrawGlassPanelR(screen, 60, 40, 1800, 100, t.borderSubtle, t.bgPanel, 14)
        
        ' Title & Badges
        titleStr = TruncateText(item.title, 55)
        screen.DrawText(titleStr, 90, 56, t.textPrimary, fonts.heading)
        
        metaStr = FormatDate(item.date_spotted) + "  •  " + item.source
        if item.width <> invalid and item.height <> invalid
            metaStr = metaStr + "  •  " + StrI(item.width).Trim() + "x" + StrI(item.height).Trim()
        end if
        if item.quality <> invalid then metaStr = metaStr + "  (" + item.quality + ")"
        screen.DrawText(metaStr, 90, 102, t.textSecondary, fonts.small)
        
        ' Clock on Right of HUD
        clockTimeStr = state.clockTime
        if clockTimeStr <> ""
            screen.DrawText(clockTimeStr, 1380, 54, t.textPrimary, fonts.heading)
            if state.clockDate <> invalid then screen.DrawText(state.clockDate, 1380, 98, t.textAccent, fonts.small)
        end if
        
        ' Favorite Status Icon
        isFav = false
        if state.favMgr <> invalid then isFav = state.favMgr.IsFavorite(item.id)
        if isFav
            DrawBadge(screen, "♥ FAVORITE", 1660, 68, t.heartPink, t.textPrimary, fonts.small)
        else
            DrawBadge(screen, "+ [OK] FAVORITE", 1600, 68, t.btnNormal, t.textSecondary, fonts.small)
        end if
        
        ' Bottom Floating HUD Banner (Controls & Tags)
        DrawGlassPanel(screen, 60, 930, 1800, 100, t.borderSubtle, t.bgPanel)
        
        ' Tags
        tagsStr = "Tags: #" + item.tags
        screen.DrawText(TruncateText(tagsStr, 90), 90, 948, t.textAccent, fonts.small)
        
        ' Action Hints
        actions = "[◄ / ►] Nav     [OK] Favorite     [Play] Slideshow     [*] Set Screensaver     [Replay] Set Home Wall     [▲] Aspect     [▼] HUD"
        screen.DrawText(actions, 90, 988, t.textPrimary, fonts.small)
    end if
end sub
