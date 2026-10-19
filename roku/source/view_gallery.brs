' Spotlight Studio for Roku
' view_gallery.brs - Main wallpaper gallery grid view, header navigation and remote control hints

sub RenderGalleryView(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    ' 1. Clear Screen
    screen.Clear(t.bgMain)
    
    ' 2. Draw Top Navigation Header (0 to 135)
    screen.DrawRect(0, 0, 1920, 135, t.bgHeader)
    screen.DrawRect(0, 134, 1920, 2, t.borderSubtle)
    
    ' Brand Title & Version
    screen.DrawText("SPOTLIGHT STUDIO", 85, 24, t.textPrimary, fonts.title)
    DrawBadge(screen, "2.6.0", 520, 28, &h00E5FF33, t.textAccent, fonts.caption)
    DrawBadge(screen, "ROKU TV", 605, 28, &h8E24AA33, t.textGold, fonts.caption)
    
    ' Status Badge & Live Clock on Right
    if state.licenseMgr <> invalid
        statusBadge = state.licenseMgr.GetStatusBadge()
        badgeColor = t.btnNormal
        if state.licenseMgr.IsTrialActive() then badgeColor = t.textAccent
        if state.licenseMgr.hasFullVersion then badgeColor = t.badgeFhd
        if state.licenseMgr.HasActiveSubscription() then badgeColor = t.badge4k
        DrawBadge(screen, statusBadge, 1380, 28, badgeColor, t.textPrimary, fonts.small)
    end if
    
    clockStr = state.clockTime
    if clockStr = "" then clockStr = "12:00"
    dateStr = state.clockDate
    if dateStr = invalid or dateStr = "" then dateStr = "Today"
    
    screen.DrawText(clockStr, 1660, 20, t.textPrimary, fonts.heading)
    screen.DrawText(dateStr, 1660, 56, t.textAccent, fonts.small)
    totalStr = StrI(state.filtered.Count()).Trim() + " Wallpapers"
    screen.DrawText(totalStr, 1660, 80, t.textMuted, fonts.small)
    
    ' Header Navigation Tabs
    tabs = ["Gallery", "Daily Pick", "Screensavers", "Favorites", "Categories", "Theme Studio", "Pro Store", "Settings"]
    tabX = 85
    tabY = 82
    
    for i = 0 to tabs.Count() - 1
        tabName = tabs[i]
        isTabFocused = (state.focusArea = "nav" and state.navIdx = i)
        isTabActive = (state.activeTab = i)
        
        tabW = Len(tabName) * 11 + 20
        
        tabRadius = 8
        if isTabActive
            DrawRoundRect(screen, tabX, tabY, tabW, 36, tabRadius, t.btnNormal)
            DrawRoundedOutline(screen, tabX, tabY, tabW, 36, tabRadius, t.textAccent, 2)
            screen.DrawText(tabName, tabX + 10, tabY + 7, t.textAccent, fonts.caption)
        else if isTabFocused
            tabGlow = 255
            if state.glowAlpha <> invalid then tabGlow = state.glowAlpha
            DrawRoundRect(screen, tabX, tabY, tabW, 36, tabRadius, t.btnFocused)
            DrawRoundedOutline(screen, tabX, tabY, tabW, 36, tabRadius, (t.borderFocused and &hFFFFFF00) or tabGlow, 2)
            screen.DrawText(tabName, tabX + 10, tabY + 7, t.bgMain, fonts.caption)
        else
            screen.DrawText(tabName, tabX + 10, tabY + 7, t.textSecondary, fonts.caption)
        end if
        
        tabX = tabX + tabW + 12
    end for
    
    ' 3. Filter Sub-bar (140 to 185)
    screen.DrawRect(0, 136, 1920, 48, &h0A0C14DD)
    screen.DrawRect(0, 183, 1920, 1, t.borderSubtle)
    
    filterDesc = "Category: " + state.activeCategory
    if state.activeResolution <> "All" then filterDesc = filterDesc + "  •  " + state.activeResolution
    if state.activeSource <> "All" then filterDesc = filterDesc + "  •  " + state.activeSource
    if state.activeSortOrder <> invalid and state.activeSortOrder <> "newest" then filterDesc = filterDesc + "  •  Sort: " + UCase(state.activeSortOrder)
    if state.searchQuery <> "" then filterDesc = filterDesc + "  •  #" + state.searchQuery
    
    screen.DrawText(filterDesc, 85, 150, t.textSecondary, fonts.small)
    
    ' Quick Filter Modal Button pill on right of subbar
    DrawBadge(screen, "[*] Filter & Sort", 1720, 144, &h00E5FF33, t.textAccent, fonts.caption)
    
    ' 4. Main Gallery Grid (4 columns x 2 rows = 8 items per page)
    items = state.filtered
    totalItems = items.Count()
    pageSize = 8
    totalPages = MaxI(1, CInt((totalItems + pageSize - 1) / pageSize))
    currentPage = ClampI(state.currentPage, 0, totalPages - 1)
    
    startIdx = currentPage * pageSize
    
    colWidth = 410
    rowHeight = 360
    gapX = 30
    gapY = 25
    gridStartX = 85
    gridStartY = 195
    
    if totalItems = 0
        ' Empty State Card with rounded corners
        DrawGlassPanelR(screen, 460, 380, 1000, 260, t.borderSubtle, t.bgPanel, 16)
        screen.DrawText("No Wallpapers Match the Current Filter", 620, 440, t.textPrimary, fonts.heading)
        screen.DrawText("Press [*] or Back to reset filters and browse the full catalog", 600, 510, t.textSecondary, fonts.body)
        DrawButton(screen, "Reset Filters to All", 810, 570, 300, 44, true, fonts.body)
    else
        slideX = 0
        if state.slideOffset <> invalid then slideX = CInt(state.slideOffset)
        
        for i = 0 to pageSize - 1
            itemIdx = startIdx + i
            if itemIdx >= totalItems then exit for
            
            item = items[itemIdx]
            col = i MOD 4
            row = Int(i / 4)
            
            cardX = gridStartX + (col * (colWidth + gapX)) + slideX
            cardY = gridStartY + (row * (rowHeight + gapY))
            
            isCardFocused = (state.focusArea = "grid" and state.gridIdx = i)
            
            ' Smooth card elevation pop when focused
            drawX = cardX
            drawY = cardY
            drawW = colWidth
            drawH = rowHeight
            cardRadius = 14
            thumbH = 220
            
            bgColor = t.bgPanel
            borderColor = t.borderSubtle
            if isCardFocused
                drawX = cardX - 4
                drawY = cardY - 4
                drawW = colWidth + 8
                drawH = rowHeight + 8
                cardRadius = 16
                thumbH = 225
                borderColor = t.borderFocused
                bgColor = t.bgPanelLight
            end if
            
            DrawGlassPanelR(screen, drawX, drawY, drawW, drawH, borderColor, bgColor, cardRadius)
            
            ' Thumbnail image area with rounded border
            thumbPad = 10
            thumbX = drawX + thumbPad
            thumbY = drawY + thumbPad
            thumbW = drawW - (thumbPad * 2)
            
            ' Placeholder background for image with rounded corners
            DrawRoundRect(screen, thumbX, thumbY, thumbW, thumbH, 10, &h161A28EE)
            
            ' Draw cached thumbnail bitmap if available
            thumbBmp = state.GetCachedThumbnail(item.filename)
            if thumbBmp <> invalid and thumbBmp.GetWidth() > 1
                screen.DrawResizedObject(thumbX, thumbY, thumbW, thumbH, thumbBmp)
            else
                ' Procedural dark obsidian placeholder
                DrawRoundRect(screen, thumbX, thumbY, thumbW, thumbH, 10, &h101320EE)
                
                isFailed = false
                if state.imageLoader <> invalid and state.imageLoader.failedKeys <> invalid
                    if state.imageLoader.failedKeys.DoesExist(item.filename) then isFailed = true
                end if
                
                if isFailed
                    ' Graceful offline card instead of endless spinner
                    screen.DrawText("Spotlight HD", thumbX + (thumbW / 2) - 44, thumbY + (thumbH / 2) - 6, t.textMuted, fonts.body)
                    screen.DrawText("Preview Offline", thumbX + (thumbW / 2) - 42, thumbY + (thumbH / 2) + 22, t.textSecondary, fonts.caption)
                else
                    spinnerAngle = 0
                    if state.spinnerAngle <> invalid then spinnerAngle = state.spinnerAngle
                    DrawLoadingSpinner(screen, thumbX + (thumbW / 2), thumbY + (thumbH / 2) - 8, 20, spinnerAngle, t.textAccent, t.borderSubtle)
                    screen.DrawText("Loading Preview...", thumbX + (thumbW / 2) - 58, thumbY + (thumbH / 2) + 24, t.textMuted, fonts.small)
                end if
            end if
            
            ' Subtle inner rounded rim around thumbnail
            DrawRoundedOutline(screen, thumbX, thumbY, thumbW, thumbH, 10, t.borderSubtle, 1)
            
            ' Quality Badge on Thumbnail (top right)
            if item.quality <> invalid
                qColor = t.badgeFhd
                qText = "FHD"
                if Instr(1, item.quality, "4K") > 0
                    qColor = t.badge4k
                    qText = "4K UHD"
                end if
                DrawBadge(screen, qText, thumbX + thumbW - (Len(qText) * 9 + 28), thumbY + 10, qColor, t.textPrimary, fonts.small)
            end if
            
            ' Favorite Heart Badge (top left)
            if state.favMgr <> invalid and state.favMgr.IsFavorite(item.id)
                DrawBadge(screen, "♥ FAV", thumbX + 10, thumbY + 10, t.heartPink, t.textPrimary, fonts.small)
            end if
            
            ' Title & metadata below thumbnail
            titleStr = TruncateText(item.title, 34)
            screen.DrawText(titleStr, drawX + 14, drawY + thumbH + 22, t.textPrimary, fonts.body)
            
            dateStr = FormatDate(item.date_spotted)
            sourceStr = "Windows Spotlight"
            if item.source = "peapix" then sourceStr = "Peapix"
            screen.DrawText(dateStr + "  •  " + sourceStr, drawX + 14, drawY + thumbH + 62, t.textMuted, fonts.small)
            
            tagsStr = TruncateText("#" + item.tags, 42)
            screen.DrawText(tagsStr, drawX + 14, drawY + thumbH + 96, t.textAccent, fonts.caption)
            
            ' Glowing rounded focus ring with breathing animation
            if isCardFocused
                glow = 255
                if state.glowAlpha <> invalid then glow = state.glowAlpha
                DrawFocusRingAnimated(screen, drawX, drawY, drawW, drawH, t.borderFocused, cardRadius, glow)
            end if
        end for
    end if
    
    ' 5. Bottom Status and Remote Hints Bar (970 to 1080)
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    
    ' Page information
    pageInfo = "Page " + StrI(currentPage + 1).Trim() + " of " + StrI(totalPages).Trim()
    screen.DrawText(pageInfo, 85, 995, t.textPrimary, fonts.body)
    
    ' Remote button shortcuts hints
    hints = "[OK] View Fullscreen     [*] Filter & Sort     [Play] Slideshow     [Replay] Shuffle     [Rew/FF] Prev/Next     [Back] Menu"
    screen.DrawText(hints, 360, 997, t.textSecondary, fonts.body)
    
    ' Quick TV Safe Area Guides if enabled in settings
    if state.settingsMgr <> invalid and state.settingsMgr.safeArea <> "off"
        DrawSafeAreaGuides(screen, state.settingsMgr.safeArea)
    end if
    
    ' 6. Render Advanced Filter & Sort Modal Dialog if active
    if state.isFilterDialogVisible
        RenderFilterModal(screen, state)
    end if
end sub

sub DrawSafeAreaGuides(screen as object, mode as string)
    ' Title Safe: 80% (192px margins)
    ' Action Safe: 90% (96px margins)
    if mode = "title_80" or mode = "both"
        screen.DrawRect(192, 108, 1536, 1, &hFFD16644)
        screen.DrawRect(192, 972, 1536, 1, &hFFD16644)
        screen.DrawRect(192, 108, 1, 864, &hFFD16644)
        screen.DrawRect(1728, 108, 1, 864, &hFFD16644)
    end if
    if mode = "action_90" or mode = "both"
        screen.DrawRect(96, 54, 1728, 1, &h00E5FF44)
        screen.DrawRect(96, 1026, 1728, 1, &h00E5FF44)
        screen.DrawRect(96, 54, 1, 972, &h00E5FF44)
        screen.DrawRect(1824, 54, 1, 972, &h00E5FF44)
    end if
end sub
