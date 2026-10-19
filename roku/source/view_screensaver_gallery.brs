' Spotlight Studio for Roku
' view_screensaver_gallery.brs - Curated Roku Screensaver Gallery view

sub RenderScreensaverGalleryView(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    lm = state.licenseMgr
    tm = state.themeMgr
    
    ' 1. Clear background
    screen.Clear(t.bgMain)
    
    ' 2. Header
    screen.DrawRect(0, 0, 1920, 115, t.bgHeader)
    screen.DrawRect(0, 114, 1920, 1, t.borderSubtle)
    screen.DrawText("SCREENSAVER GALLERY", 85, 24, t.textPrimary, fonts.title)
    
    statusBadge = lm.GetStatusBadge()
    badgeColor = t.btnNormal
    if lm.IsTrialActive() then badgeColor = t.textAccent
    if lm.hasFullVersion then badgeColor = t.badgeFhd
    if lm.HasActiveSubscription() then badgeColor = t.badge4k
    DrawBadge(screen, statusBadge, 1580, 32, badgeColor, t.textPrimary, fonts.small)
    
    screen.DrawText("Browse curated ultra-HD ambient landscape wallpapers and configure your Roku TV Screensaver", 85, 74, t.textSecondary, fonts.caption)
    
    ' Filter screensaver wallpapers (landscape / nature / scenic)
    screensavers = state.screensaverList
    if screensavers = invalid or screensavers.Count() = 0
        screensavers = state.allWallpapers
    end if
    
    totalItems = screensavers.Count()
    pageSize = 6 ' 3 columns x 2 rows
    totalPages = MaxI(1, CInt((totalItems + pageSize - 1) / pageSize))
    currentPage = ClampI(state.ssCurrentPage, 0, totalPages - 1)
    
    ' Current focused wallpaper
    focusedIdx = currentPage * pageSize + state.ssGridIdx
    if focusedIdx >= totalItems then focusedIdx = 0
    curItem = screensavers[focusedIdx]
    
    ' 3. Left Panel: Large Showcase & Quick Action Hub (85, 135, 780 x 810)
    leftX = 85
    leftY = 135
    leftW = 780
    leftH = 810
    DrawGlassPanel(screen, leftX, leftY, leftW, leftH, t.borderSubtle, t.bgPanel)
    
    ' Active Screensaver Label
    isCurrentActive = false
    if tm.screensaverWallpaper <> invalid and curItem <> invalid
        if tm.screensaverWallpaper.id = curItem.id then isCurrentActive = true
    end if
    
    showcaseTitle = "SCREENSAVER PREVIEW"
    if isCurrentActive
        DrawBadge(screen, "CURRENT ACTIVE SCREENSAVER", leftX + 35, leftY + 25, t.badge4k, t.textPrimary, fonts.small)
    else
        screen.DrawText(showcaseTitle, leftX + 35, leftY + 25, t.textAccent, fonts.caption)
    end if
    
    ' Big Preview Image (710 x 400) with rounded corners
    thumb = state.GetCachedThumbnail(curItem.filename)
    DrawRoundRect(screen, leftX + 35, leftY + 60, 710, 400, 14, &h161A28EE)
    if thumb <> invalid and thumb.GetWidth() > 1
        screen.DrawResizedObject(leftX + 35, leftY + 60, 710, 400, thumb)
    else
        spinnerAngle = 0
        if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
        DrawLoadingSpinner(screen, leftX + 35 + 355, leftY + 60 + 185, 24, spinnerAngle, t.textAccent, t.borderSubtle)
        screen.DrawText("Loading Preview...", leftX + 35 + 300, leftY + 60 + 225, t.textMuted, fonts.body)
    end if
    DrawRoundedOutline(screen, leftX + 35, leftY + 60, 710, 400, 14, t.borderSubtle, 1)
    
    ' Wallpaper metadata
    screen.DrawText(TruncateText(curItem.title, 42), leftX + 35, leftY + 480, t.textPrimary, fonts.heading)
    if curItem.copyright <> invalid and curItem.copyright <> ""
        screen.DrawText(TruncateText(curItem.copyright, 56), leftX + 35, leftY + 522, t.textSecondary, fonts.caption)
    end if
    
    ' Badges: Resolution, Source, Category
    resText = "1920x1080 FHD"
    if curItem.resolution <> invalid and curItem.resolution <> "" then resText = curItem.resolution
    DrawBadge(screen, resText, leftX + 35, leftY + 560, t.badgeFhd, t.textPrimary, fonts.small)
    
    if curItem.source <> invalid
        DrawBadge(screen, UCase(curItem.source), leftX + 185, leftY + 560, t.btnNormal, t.textPrimary, fonts.small)
    end if
    
    if state.favMgr.IsFavorite(curItem)
        DrawBadge(screen, "♥ FAVORITE", leftX + 330, leftY + 560, &hE11D48EE, t.textPrimary, fonts.small)
    end if
    
    ' Action Buttons inside Showcase with rounded corners
    actionY = leftY + 620
    actionH = 50
    actionW = 345
    btnRadius = 8
    
    ' Button 1: Set as Roku TV Screensaver
    DrawRoundRect(screen, leftX + 35, actionY, actionW, actionH, btnRadius, t.btnNormal)
    DrawRoundedOutline(screen, leftX + 35, actionY, actionW, actionH, btnRadius, t.borderSubtle, 2)
    screen.DrawText("[*] Set as TV Screensaver", leftX + 60, actionY + 14, t.textPrimary, fonts.body)
    
    ' Button 2: Run Ambient Now
    DrawRoundRect(screen, leftX + 400, actionY, actionW, actionH, btnRadius, t.btnNormal)
    DrawRoundedOutline(screen, leftX + 400, actionY, actionW, actionH, btnRadius, t.borderSubtle, 2)
    screen.DrawText("[Play] Run Ambient Now", leftX + 440, actionY + 14, t.textAccent, fonts.body)
    
    ' Button 3: Set as Home Wallpaper
    DrawRoundRect(screen, leftX + 35, actionY + 65, actionW, actionH, btnRadius, t.btnNormal)
    DrawRoundedOutline(screen, leftX + 35, actionY + 65, actionW, actionH, btnRadius, t.borderSubtle, 2)
    screen.DrawText("[Replay] Set as Home Wall", leftX + 55, actionY + 79, t.textPrimary, fonts.body)
    
    ' Button 4: Fullscreen Lightbox
    DrawRoundRect(screen, leftX + 400, actionY + 65, actionW, actionH, btnRadius, t.btnNormal)
    DrawRoundedOutline(screen, leftX + 400, actionY + 65, actionW, actionH, btnRadius, t.borderSubtle, 2)
    screen.DrawText("[OK] Fullscreen Lightbox", leftX + 435, actionY + 79, t.textPrimary, fonts.body)
    
    ' 4. Right Panel: Curated Grid (3 columns x 2 rows = 6 items per page)
    rightX = 895
    rightY = 135
    rightW = 940
    rightH = 810
    DrawGlassPanelR(screen, rightX, rightY, rightW, rightH, t.borderSubtle, t.bgPanel, 16)
    
    screen.DrawText("SCREENSAVER CATALOG", rightX + 35, rightY + 25, t.textAccent, fonts.caption)
    pageStr = "Page " + StrI(currentPage + 1).Trim() + " of " + StrI(totalPages).Trim() + " (" + StrI(totalItems).Trim() + " items)"
    screen.DrawText(pageStr, rightX + rightW - 320, rightY + 25, t.textMuted, fonts.small)
    
    colW = 275
    rowH = 330
    gapX = 25
    gapY = 25
    gridX = rightX + 35
    gridY = rightY + 70
    
    startItemIdx = currentPage * pageSize
    for i = 0 to pageSize - 1
        itemIdx = startItemIdx + i
        if itemIdx >= totalItems then exit for
        
        item = screensavers[itemIdx]
        c = i MOD 3
        r = Int(i / 3)
        
        cx = gridX + (c * (colW + gapX))
        cy = gridY + (r * (rowH + gapY))
        
        isFocused = (state.ssFocusArea = "grid" and state.ssGridIdx = i)
        
        ' Smooth card elevation pop when focused
        drawCX = cx
        drawCY = cy
        drawCW = colW
        drawCH = rowH
        cardRadius = 12
        cardBg = &h0D111AEE
        cardBorder = t.borderSubtle
        if isFocused
            drawCX = cx - 3
            drawCY = cy - 3
            drawCW = colW + 6
            drawCH = rowH + 6
            cardRadius = 14
            cardBg = &h161D2BEE
            cardBorder = t.borderFocused
        end if
        
        DrawRoundRect(screen, drawCX, drawCY, drawCW, drawCH, cardRadius, cardBg)
        DrawRoundedOutline(screen, drawCX, drawCY, drawCW, drawCH, cardRadius, cardBorder, 1)
        
        ' Thumbnail (275 x 155, 16:9) with rounded corners
        thumbPad = 6
        thumbX = drawCX + thumbPad
        thumbY = drawCY + thumbPad
        thumbW = drawCW - (thumbPad * 2)
        thumbH = 155
        DrawRoundRect(screen, thumbX, thumbY, thumbW, thumbH, 8, &h1E2338DD)
        itemThumb = state.GetCachedThumbnail(item.filename)
        if itemThumb <> invalid and itemThumb.GetWidth() > 1
            screen.DrawResizedObject(thumbX, thumbY, thumbW, thumbH, itemThumb)
        else
            spinnerAngle = 0
            if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
            DrawLoadingSpinner(screen, thumbX + (thumbW / 2), thumbY + (thumbH / 2), 16, spinnerAngle, t.textAccent, t.borderSubtle)
        end if
        DrawRoundedOutline(screen, thumbX, thumbY, thumbW, thumbH, 8, t.borderSubtle, 1)
        
        ' Title & Category
        screen.DrawText(TruncateText(item.title, 22), drawCX + 12, drawCY + 175, t.textPrimary, fonts.body)
        
        itemCat = "Spotlight"
        if item.category <> invalid and item.category <> "" then itemCat = item.category
        screen.DrawText(itemCat, drawCX + 12, drawCY + 215, t.textSecondary, fonts.small)
        
        ' Resolution Badge
        itemRes = "FHD"
        if Instr(1, item.resolution, "3840") > 0 or Instr(1, item.resolution, "4K") > 0
            itemRes = "4K UHD"
        end if
        DrawBadge(screen, itemRes, drawCX + 12, drawCY + 250, t.badgeFhd, t.textPrimary, fonts.small)
        
        ' Is active screensaver marker
        if tm.screensaverWallpaper <> invalid and tm.screensaverWallpaper.id = item.id
            DrawBadge(screen, "ACTIVE", drawCX + 120, drawCY + 250, t.badge4k, t.textPrimary, fonts.small)
        end if
        
        if isFocused
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, drawCX, drawCY, drawCW, drawCH, t.borderFocused, cardRadius, glow)
        end if
    end for
    
    ' 5. Footer Bar
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    screen.DrawText("[▲/▼/◄/►] Browse     [OK] Lightbox     [*] Set as Screensaver     [Play] Ambient Mode     [Back] Gallery", 85, 1010, t.textSecondary, fonts.body)
end sub
