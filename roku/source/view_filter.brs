' Spotlight Studio for Roku
' view_filter.brs - Advanced Wallpaper Filtering, Sorting and Search Modal Dialog

sub RenderFilterModal(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    
    ' 1. Dark translucent glass backdrop
    screen.DrawRect(0, 0, 1920, 1080, &h000000D0)
    
    ' 2. Modal Dimensions (1240 x 860)
    diaX = 340
    diaY = 110
    diaW = 1240
    diaH = 860
    diaR = 20
    
    DrawGlassPanelR(screen, diaX, diaY, diaW, diaH, t.borderFocused, &h0A0E1AFA, diaR)
    
    ' Header
    screen.DrawText("WALLPAPER FILTERS & SORTING", diaX + 50, diaY + 30, t.textPrimary, fonts.title)
    DrawBadge(screen, "[*] / [Back] Close", diaX + diaW - 240, diaY + 34, t.btnNormal, t.textAccent, fonts.caption)
    screen.DrawText("Filter thousands of wallpapers by category, 4K UHD quality, source, and custom order", diaX + 50, diaY + 76, t.textSecondary, fonts.caption)
    screen.DrawRect(diaX + 50, diaY + 112, diaW - 100, 1, t.borderSubtle)
    
    ' Filter categories lists
    categories = ["All", "Landscape", "Nature", "Water", "Animals", "City", "Mountains", "Sky", "Space", "Architecture", "Desert", "Forest"]
    resolutions = ["All", "4K", "FHD"]
    resLabels = { "All": "All Resolutions", "4K": "4K Ultra-HD (3840×2160)", "FHD": "Full HD 1080p (1920×1080)" }
    sources = ["All", "peapix", "win10spotlight"]
    srcLabels = { "All": "All Archives", "peapix": "Peapix (Bing Archive)", "win10spotlight": "Windows 10 Spotlight" }
    sorts = ["newest", "oldest", "quality", "random"]
    sortLabels = { "newest": "Newest Spotted First", "oldest": "Oldest Spotted First", "quality": "4K UHD Quality First", "random": "Random Shuffle" }
    tags = ["", "sunset", "beach", "forest", "night", "lake", "winter", "stars", "aurora", "desert", "waterfall"]
    
    ' Values
    curCat = state.activeCategory
    curRes = state.activeResolution
    curSrc = state.activeSource
    curSort = state.activeSortOrder
    if curSort = invalid then curSort = "newest"
    curFav = state.onlyFavorites
    curTag = state.searchQuery
    
    tagLabel = "None (All Tags)"
    if curTag <> "" then tagLabel = "#" + curTag
    
    favLabel = "No (All Photos)"
    if curFav then favLabel = "Yes (Favorites Only ♥)"
    
    resDisplay = resLabels[curRes]
    if resDisplay = invalid then resDisplay = curRes
    srcDisplay = srcLabels[curSrc]
    if srcDisplay = invalid then srcDisplay = curSrc
    sortDisplay = sortLabels[curSort]
    if sortDisplay = invalid then sortDisplay = curSort
    
    filterRows = [
        { label: "Category / Theme", value: curCat, desc: "Browse curated collections by visual theme" },
        { label: "Resolution Quality", value: resDisplay, desc: "Filter for true 4K UHD or 1080p FHD wallpapers" },
        { label: "Source Archive", value: srcDisplay, desc: "Filter by originating archive (Bing Peapix or Win10)" },
        { label: "Display Sort Order", value: sortDisplay, desc: "Order wallpapers by date, 4K priority, or shuffle" },
        { label: "Only Favorites", value: favLabel, desc: "Only show wallpapers you have marked with a heart" },
        { label: "Popular Tag Preset", value: tagLabel, desc: "Quickly filter by popular aesthetic photography tags" },
        { label: "Action", value: "APPLY FILTERS", desc: "Apply current filters (" + StrI(state.filtered.Count()).Trim() + " matching wallpapers)" },
        { label: "Action", value: "RESET TO ALL", desc: "Clear all filters and restore entire catalog (7,474+ photos)" }
    ]
    
    rowStartY = diaY + 130
    rowH = 72
    rowGap = 12
    
    for r = 0 to filterRows.Count() - 1
        item = filterRows[r]
        isFocused = (state.filterRowIdx = r)
        rowY = rowStartY + (r * (rowH + rowGap))
        
        rowRadius = 12
        if isFocused
            rowBg = &h00D2FF24
            DrawRoundRect(screen, diaX + 50, rowY, diaW - 100, rowH, rowRadius, rowBg)
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, diaX + 50, rowY, diaW - 100, rowH, t.borderFocused, rowRadius, glow)
        else
            DrawRoundRect(screen, diaX + 50, rowY, diaW - 100, rowH, rowRadius, &h0A0E1866)
            DrawRoundedOutline(screen, diaX + 50, rowY, diaW - 100, rowH, rowRadius, t.borderSubtle, 1)
        end if
        
        if r < 6
            ' Filter option row
            titleColor = t.textPrimary
            if isFocused then titleColor = t.textAccent
            screen.DrawText(item.label, diaX + 75, rowY + 12, titleColor, fonts.body)
            screen.DrawText(item.desc, diaX + 75, rowY + 42, t.textMuted, fonts.small)
            
            valX = diaX + diaW - 460
            DrawBadge(screen, item.value, valX, rowY + 16, t.btnNormal, t.textPrimary, fonts.body)
            
            if isFocused
                screen.DrawText("◄    ►", valX - 85, rowY + 22, t.textAccent, fonts.body)
            end if
        else if r = 6
            ' Apply button
            btnBg = t.btnNormal
            if isFocused then btnBg = t.btnFocused
            DrawRoundRect(screen, diaX + 70, rowY + 8, diaW - 140, 56, 10, btnBg)
            btnText = "✓ Apply Filters (" + StrI(state.filtered.Count()).Trim() + " Wallpapers)"
            btnColor = t.textAccent
            if isFocused then btnColor = t.bgMain
            screen.DrawText(btnText, diaX + 420, rowY + 20, btnColor, fonts.heading)
        else if r = 7
            ' Reset button
            btnBg = &hFF224422
            if isFocused then btnBg = &hFF446666
            DrawRoundRect(screen, diaX + 70, rowY + 8, diaW - 140, 56, 10, btnBg)
            btnColor = t.textSecondary
            if isFocused then btnColor = t.textPrimary
            screen.DrawText("↺ Reset All Filters to All Wallpapers", diaX + 400, rowY + 20, btnColor, fonts.body)
        end if
    end for
end sub
