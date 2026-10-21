' Spotlight Studio for Roku
' view_screensaver_gallery.brs - Curated 4K UHD landscape collection.
'
' Field note: the packaged catalog carries id, filename, title, tags,
' date_spotted, source and quality only.  The previous version of this screen
' read `resolution`, `category` and `copyright`, which do not exist on any row,
' so `Instr(1, item.resolution, "3840")` was handed `invalid` and raised a type
' mismatch that killed the channel.  Resolution, category and attribution are
' now derived (see utils.brs).

function ScreensaverLayout() as object
    gaa = GetGlobalAA()
    if gaa.__ssSaverLayout = invalid
        cardW = 567
        cardH = 368
        gapX = 24
        gapY = 22
        cols = ScreensaverColumns()
        gridW = (cols * cardW) + ((cols - 1) * gapX)
        gaa.__ssSaverLayout = {
            cardW: cardW,
            cardH: cardH,
            gapX: gapX,
            gapY: gapY,
            cols: cols,
            startX: CInt((1920 - gridW) / 2),
            startY: 210,
            imgPad: 10,
            imgW: cardW - 20,
            imgH: 306,
            pageSize: ScreensaverPageSize()
        }
    end if
    return gaa.__ssSaverLayout
end function

sub RenderScreensaverGallery(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    L = ScreensaverLayout()

    screen.Clear(t.bgMain)
    DrawViewHeader(screen, state, "Ambient Collection", "Curated landscape wallpapers for Ambient Mode - Ultra-HD first, then the best of Full HD")

    savList = state.screensaverList
    totalItems = 0
    if savList <> invalid then totalItems = savList.Count()
    totalPages = MaxI(1, CeilDivI(totalItems, L.pageSize))

    ' ── focused-item info bar ──────────────────────────────────────────
    curItem = invalid
    if totalItems > 0
        state.ssGridIdx = ClampI(state.ssGridIdx, 0, L.pageSize - 1)
        curIdx = (state.currentPageSS * L.pageSize) + state.ssGridIdx
        if curIdx < totalItems then curItem = savList[curIdx]
    end if

    DrawGlassPanelR(screen, 0, 120, 1920, 82, t.borderSubtle, t.bgPanel, 0)
    if curItem <> invalid
        screen.DrawText(TruncateText(WallpaperTitle(curItem), 84), 85, 134, t.textPrimary, fonts.heading)
        detail = ResolutionLabel(curItem) + "   •   " + PrimaryCategory(curItem) + "   •   Spotted " + FormatDate(SafeStr(curItem.date_spotted))
        screen.DrawText(detail, 85, 170, t.textSecondary, fonts.caption)

        rightLabel = "Item " + StrI(state.ssGridIdx + 1).Trim() + "/" + StrI(L.pageSize).Trim()
        rightW = fonts.caption.GetOneLineWidth(rightLabel)
        screen.DrawText(rightLabel, 1835 - rightW, 152, t.textAccent, fonts.caption)
    else
        screen.DrawText("No wallpapers in this collection", 85, 134, t.textPrimary, fonts.heading)
        screen.DrawText("Try clearing the 4K-only preference from Filter & Sort", 85, 170, t.textSecondary, fonts.caption)
    end if

    ' ── grid ───────────────────────────────────────────────────────────
    if totalItems = 0
        RenderEmptyNotice(screen, state, "The Ambient Collection is empty", "Press Back, then use Filter & Sort to widen the selection")
        return
    end if

    startIdx = state.currentPageSS * L.pageSize
    for i = 0 to L.pageSize - 1
        itemIdx = startIdx + i
        if itemIdx >= totalItems then exit for

        col = i MOD L.cols
        row = CInt(i / L.cols)
        cardX = L.startX + (col * (L.cardW + L.gapX))
        cardY = L.startY + (row * (L.cardH + L.gapY))
        isSelected = (state.ssGridIdx = i)

        DrawScreensaverCard(screen, state, itemIdx, cardX, cardY, L, isSelected)
    end for

    pageLabel = "Page " + StrI(state.currentPageSS + 1).Trim() + " of " + StrI(totalPages).Trim() + "   •   " + StrI(totalItems).Trim() + " wallpapers"
    pageW = fonts.caption.GetOneLineWidth(pageLabel)
    screen.DrawText(pageLabel, CInt((1920 - pageW) / 2), 936, t.textSecondary, fonts.caption)

    DrawViewFooter(screen, state, "D-Pad Navigate   OK View Fullscreen   Play Ambient Mode   Right/Left Page   * Use as Ambient Wallpaper   Back return")
end sub

sub DrawScreensaverCard(screen as object, state as object, itemIdx as integer, cardX as integer, cardY as integer, L as object, isSelected as boolean)
    t = GetTheme()
    fonts = state.fonts

    curItem = state.screensaverList[itemIdx]
    if curItem = invalid then return

    imgX = cardX + L.imgPad
    imgY = cardY + L.imgPad
    imgW = L.imgW
    imgH = L.imgH

    DrawGlassPanelCached(screen, cardX, cardY, L.cardW, L.cardH, t.borderMedium, t.bgPanel, 14)
    DrawRoundRect(screen, imgX, imgY, imgW, imgH, 12, t.bgPanelLight)

    filename = WallpaperFilename(curItem)
    thumbBmp = state.imgLoader.GetThumbnailSized(filename, imgW, imgH)
    if thumbBmp <> invalid
        screen.DrawObject(imgX, imgY, thumbBmp)
    else
        fallback = state.imgLoader.GetThumbnail(filename)
        if fallback <> invalid
            screen.DrawResizedObject(imgX, imgY, imgW, imgH, fallback)
        else if state.spinnerVisible
            DrawLoadingSpinner(screen, imgX + CInt(imgW / 2), imgY + CInt(imgH / 2), 18, state.spinnerAngle, t.textAccent, t.borderSubtle)
        end if
    end if

    ' Badges over the artwork.
    if IsUltraHd(curItem)
        DrawBadge(screen, "4K UHD", imgX + 12, imgY + 12, t.badge4k, t.textPrimary, fonts.caption)
    else
        DrawBadge(screen, "FHD", imgX + 12, imgY + 12, t.badgeFhd, t.textPrimary, fonts.caption)
    end if

    isFav = state.favMgr.IsFavorite(curItem.id)
    if isFav
        favW = BadgeWidth("FAVORITE", fonts.caption)
        DrawBadge(screen, "FAVORITE", imgX + imgW - favW - 12, imgY + 12, t.heartPink, t.textPrimary, fonts.caption)
    end if

    isCurrent = false
    if state.themeMgr <> invalid then isCurrent = (state.themeMgr.ambientWallpaperId = SafeInt(curItem.id, 0))
    if isCurrent
        labelW = BadgeWidth("AMBIENT WALLPAPER", fonts.caption)
        DrawBadge(screen, "AMBIENT WALLPAPER", imgX + imgW - labelW - 12, imgY + imgH - 44, t.successGreen, t.textOnAccent, fonts.caption)
    end if

    ' Caption.
    captionY = imgY + imgH + 12
    screen.DrawText(TruncateText(WallpaperTitle(curItem), 44), imgX + 4, captionY, t.textPrimary, fonts.body)
    screen.DrawText(TruncateText(PrimaryCategory(curItem) + "  •  " + SourceLabel(curItem), 44), imgX + 4, captionY + 28, t.textSecondary, fonts.caption)

    if isSelected
        glowAlpha = CalcGlowAlpha(state, 210)
        DrawFocusRingAnimated(screen, cardX, cardY, L.cardW, L.cardH, t.borderFocused, 14, glowAlpha)
        DrawRoundRect(screen, cardX + 2, cardY + L.cardH - 6, L.cardW - 4, 4, 2, t.textAccent)
    end if
end sub
