' Spotlight Studio for Roku
' view_gallery.brs - Main grid: glass header, navigation tabs, filter summary
'                    bar, the 4x2 card grid and the footer.
'
' Grid geometry is derived once (see GalleryLayout()) instead of being
' hard-coded per card, and the numbers are chosen so the second row clears the
' footer: the previous layout put row 1 at y=650..1010 while the footer band
' starts at 970, so the bottom of every card on the second row was painted over.

function GalleryLayout() as object
    gaa = GetGlobalAA()
    if gaa.__ssGalleryLayout = invalid
        cardW = 410
        cardH = 336
        gapX = 24
        gapY = 24
        cols = GalleryColumns()
        gridW = (cols * cardW) + ((cols - 1) * gapX)
        gaa.__ssGalleryLayout = {
            cardW: cardW,
            cardH: cardH,
            gapX: gapX,
            gapY: gapY,
            cols: cols,
            startX: CInt((1920 - gridW) / 2),
            startY: 262,
            ' 16:9 image area inside the card, with 10px of padding.
            imgPad: 10,
            imgW: cardW - 20,
            imgH: 219,
            pageSize: GalleryPageSize()
        }
    end if
    return gaa.__ssGalleryLayout
end function

sub RenderGallery(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    L = GalleryLayout()

    screen.Clear(t.bgMain)
    DrawGalleryBackdrop(screen, state)

    ' ── glass header ───────────────────────────────────────────────────
    DrawGlassPanelR(screen, 0, 0, 1920, 135, t.borderSubtle, t.bgHeader, 0)
    screen.DrawRect(0, 133, 1920, 2, t.borderSubtle)

    ' The store icon is 290x218; blitting it at native size would spill out of
    ' the 135px header, so it is resampled once into the shape cache.
    logoBmp = state.logoBitmap
    if logoBmp <> invalid
        logoScaled = GetGfxCache().GetScaled("logo", logoBmp, 100, 75)
        if logoScaled <> invalid
            screen.DrawObject(40, 30, logoScaled)
        else
            DrawScaledTo(screen, 40, 30, 100, 75, logoBmp)
        end if
    end if

    screen.DrawText("Spotlight Studio", 130, 24, t.textPrimary, fonts.heading)
    DrawBadge(screen, state.appVersion, 400, 28, t.btnFocused, t.textOnAccent, fonts.caption)
    DrawBadge(screen, state.licenseMgr.GetStatusBadge(), 500, 28, t.btnNormal, t.textPrimary, fonts.caption)

    ' Offline banner, right-aligned next to the clock.  Without it a dead link
    ' looks identical to a broken app: every card just spins.
    if IsOffline(state.deviceInfo)
        offlineLabel = "OFFLINE"
        offlineColor = t.dangerRed
        if not state.deviceInfo.GetInternetStatus() then offlineLabel = "NO INTERNET"
        badgeW = BadgeWidth(offlineLabel, fonts.caption)
        DrawBadge(screen, offlineLabel, 1690 - badgeW, 64, offlineColor, t.textPrimary, fonts.caption)
    end if

    screen.DrawText(SafeStr(state.clockTime), 1700, 20, t.textPrimary, fonts.heading)
    screen.DrawText(SafeStr(state.clockDate), 1700, 60, t.textAccent, fonts.small)

    ' ── navigation tabs ────────────────────────────────────────────────
    tabs = NavTabs()
    tabX = 85
    for i = 0 to tabs.Count() - 1
        isActive = (state.activeTab = i)
        tabText = tabs[i]
        textW = fonts.heading.GetOneLineWidth(tabText, 1920)
        tabW = textW + 24

        if isActive
            tabPill = GetGfxCache().GetRoundedRect(tabW, 36, 9, t.accentSoft)
            if tabPill <> invalid
                screen.DrawObject(tabX, 82, tabPill)
            else
                DrawRoundRect(screen, tabX, 82, tabW, 36, 9, t.accentSoft)
            end if
            DrawRoundedOutline(screen, tabX, 82, tabW, 36, 9, t.textAccent, 2)
            screen.DrawText(tabText, tabX + 12, 86, t.textAccent, fonts.heading)
        else
            screen.DrawText(tabText, tabX + 12, 86, t.textSecondary, fonts.heading)
        end if

        tabX = tabX + tabW + 12
    end for

    ' ── filter summary bar ─────────────────────────────────────────────
    DrawGlassPanelR(screen, 0, 136, 1920, 110, t.borderSubtle, t.bgPanel, 0)
    screen.DrawRect(0, 244, 1920, 2, t.borderSubtle)

    chipX = 85
    chipY = 148

    chipX = DrawFilterChip(screen, state, chipX, chipY, state.activeCategory, t.textAccent, true)
    chipX = DrawFilterChip(screen, state, chipX, chipY, LabelFor(SourceLabels(), state.activeSource), t.textSecondary, false)
    chipX = DrawFilterChip(screen, state, chipX, chipY, LabelFor(SortLabels(), state.sortOrder), t.textSecondary, false)

    if state.activeResolution <> "All"
        chipX = DrawFilterChip(screen, state, chipX, chipY, state.activeResolution + " Only", t.textSecondary, false)
    end if
    if state.activeTag <> ""
        chipX = DrawFilterChip(screen, state, chipX, chipY, "#" + state.activeTag, t.textAccent, true)
    end if
    if state.favoritesOnly
        chipX = DrawFilterChip(screen, state, chipX, chipY, "Favorites Only", t.heartPink, true)
    end if
    if state.activeSearch <> ""
        chipX = DrawFilterChip(screen, state, chipX, chipY, "Search: " + TruncateText(state.activeSearch, 18), t.textAccent, true)
    end if

    ' Second row: result count on the left, the filter shortcut on the right.
    ' Keeping them off the chip row avoids a collision when several chips are
    ' active at once.
    totalItems = state.filtered.Count()
    totalPages = MaxI(1, CeilDivI(totalItems, L.pageSize))
    summary = StrI(totalItems).Trim() + " wallpapers   •   page " + StrI(state.currentPage + 1).Trim() + " of " + StrI(totalPages).Trim()
    screen.DrawText(summary, 85, 198, t.textSecondary, fonts.caption)

    hint = "Press * for Filter & Sort"
    DrawRightText(screen, hint, 1835, 198, t.textMuted, fonts.caption)

    ' ── card grid ──────────────────────────────────────────────────────
    ' The empty state is drawn in place of the grid but the footer and the
    ' toast still render, so the user keeps the key hints and any feedback
    ' raised by the action that emptied the list.
    if totalItems > 0
        RenderGalleryGrid(screen, state, totalItems, L)
    else
        RenderGalleryEmptyState(screen, state)
    end if

    ' ── footer ─────────────────────────────────────────────────────────
    DrawGlassPanelR(screen, 0, 970, 1920, 110, t.borderSubtle, t.bgFooter, 0)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)

    screen.DrawText("D-Pad Navigate   OK View Fullscreen   Play Ambient Mode   Rewind/FF Skip 10 Pages   Replay Favorite   Ch+ Today's Pick", 85, 1000, t.textSecondary, fonts.small)
    screen.DrawText("Back moves to the tab bar, and Back again exits to the Roku home screen", 85, 1035, t.textMuted, fonts.caption)

    if SafeAreaGuidesEnabled(state) then DrawSafeAreaGuides(screen, state.settingsMgr.GetStr("safeAreaGuides", "off"))

    ' Short fade after a page change.  ifDraw2D has no clipping, so a slide
    ' would need the grid drawn twice; a 180 ms fade reads just as well on a
    ' ten-foot screen and costs one full-screen blend.
    if state.transitioning and state.transitionStartMs >= 0
        elapsed = state.animClock.TotalMilliseconds() - state.transitionStartMs
        ratio = elapsed / 180.0
        if ratio > 1.0 then ratio = 1.0
        alpha = CInt(150 * (1.0 - ratio))
        if alpha > 0 then DrawScrim(screen, alpha)
    end if

    RenderToast(screen, state)
end sub

sub RenderGalleryGrid(screen as object, state as object, totalItems as integer, L as object)
    startIdx = state.currentPage * L.pageSize
    for i = 0 to L.pageSize - 1
        itemIdx = startIdx + i
        if itemIdx >= totalItems then exit for

        col = i MOD L.cols
        row = CInt(i / L.cols)
        cardX = L.startX + (col * (L.cardW + L.gapX))
        cardY = L.startY + (row * (L.cardH + L.gapY))
        isSelected = (state.gridIdx = i)

        DrawWallpaperCard(screen, state, itemIdx, cardX, cardY, L.cardW, L.cardH, isSelected)
    end for
end sub

' A chip in the filter summary bar.  Returns the x position after the chip.
'
' The pill body is served from the shape cache: at radius 9 a rounded rect plus
' its outline is ~80 DrawRect() calls, and up to six chips are drawn every
' frame - ~500 blits a second on a device with no compositor.
function DrawFilterChip(screen as object, state as object, x as integer, y as integer, label as string, color as integer, filled as boolean) as integer
    t = GetTheme()
    fonts = state.fonts
    if label = invalid or label = "" then return x

    chipW = TextWidth(label, fonts.caption, 8) + 24
    bg = t.bgPanelLight
    if filled then bg = t.accentSoft
    body = GetGfxCache().GetRoundedRect(chipW, 34, 9, bg)
    if body <> invalid
        screen.DrawObject(x, y, body)
    else
        DrawRoundRect(screen, x, y, chipW, 34, 9, bg)
    end if
    DrawRoundedOutline(screen, x, y, chipW, 34, 9, color, 1)
    screen.DrawText(label, x + 12, y + 7, color, fonts.caption)
    return x + chipW + 12
end function

' Optional dimmed wallpaper behind the grid, chosen in Theme Studio.  The
' scaled-and-scrimmed frame is baked into ONE cached bitmap and only rebuilt
' when the backdrop selection changes, so it costs a single blit per frame.
sub DrawGalleryBackdrop(screen as object, state as object)
    if state.themeMgr = invalid then return
    backdropId = state.themeMgr.backdropWallpaperId
    if backdropId = 0 then return

    cached = state.backdropBmp
    if cached <> invalid and state.backdropKey = StrI(backdropId).Trim()
        screen.DrawObject(0, 0, cached)
        return
    end if

    backdropItem = FindWallpaper(state.allWallpapers, StrI(backdropId).Trim())
    if backdropItem = invalid then return
    thumb = state.imgLoader.GetThumbnail(WallpaperFilename(backdropItem))
    if thumb = invalid then return

    bmp = CreateObject("roBitmap", { width: 1920, height: 1080, AlphaEnable: false })
    if bmp = invalid then return
    DrawScaledTo(bmp, 0, 0, 1920, 1080, thumb)
    ' Bake the scrim in so the grid stays legible without a second full-screen
    ' blend every frame.
    bmp.DrawRect(0, 0, 1920, 1080, WithAlpha(0, 214))

    state.backdropBmp = bmp
    state.backdropKey = StrI(backdropId).Trim()
    screen.DrawObject(0, 0, bmp)
end sub

function SafeAreaGuidesEnabled(state as object) as boolean
    if state = invalid or state.settingsMgr = invalid then return false
    mode = SafeStr(state.settingsMgr.GetStr("safeAreaGuides", "off"))
    return mode <> "" and mode <> "off"
end function

sub RenderGalleryEmptyState(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts

    DrawGlassPanelR(screen, 460, 380, 1000, 320, t.borderSubtle, t.bgPanel, 20)

    headline = "No wallpapers match this filter"
    if state.totalCount = 0 then headline = "The archive could not be loaded"

    headW = fonts.title.GetOneLineWidth(headline, 1920)
    screen.DrawText(headline, CInt((1920 - headW) / 2), 440, t.textPrimary, fonts.title)

    detail = "Press * to open Filter & Sort and relax the category, resolution or search."
    if state.totalCount = 0 then detail = "The packaged catalog is missing or corrupt. Reinstall the channel to restore it."
    detailW = fonts.body.GetOneLineWidth(detail, 1920)
    screen.DrawText(detail, CInt((1920 - detailW) / 2), 510, t.textSecondary, fonts.body)

    screen.DrawText("Total archive size: " + StrI(state.totalCount).Trim() + " wallpapers", CInt((1920 - fonts.caption.GetOneLineWidth("Total archive size: " + StrI(state.totalCount).Trim() + " wallpapers", 1920)) / 2), 560, t.textMuted, fonts.caption)

    resetLabel = "Press * then choose All to reset every filter"
    resetW = fonts.caption.GetOneLineWidth(resetLabel, 1920)
    DrawBadge(screen, resetLabel, CInt((1920 - resetW) / 2), 610, t.btnFocused, t.textOnAccent, fonts.caption)
end sub

sub DrawWallpaperCard(screen as object, state as object, itemIdx as integer, cardX as integer, cardY as integer, cardW as integer, cardH as integer, isSelected as boolean)
    t = GetTheme()
    fonts = state.fonts
    L = GalleryLayout()

    if itemIdx < 0 or itemIdx >= state.filtered.Count() then return
    curItem = state.filtered[itemIdx]
    if curItem = invalid then return

    imgX = cardX + L.imgPad
    imgY = cardY + L.imgPad
    imgW = L.imgW
    imgH = L.imgH

    ' Card body.  Growing the focused card shifts every neighbour and changes
    ' the cache key each frame, so focus is expressed with a ring instead.
    DrawGlassPanelCached(screen, cardX, cardY, cardW, cardH, t.borderMedium, t.bgPanel, 14)

    ' Image slot: rounded placeholder, then the thumbnail on top.  The
    ' placeholder is cached - at radius 12 it is 51 DrawRect() calls per card,
    ' i.e. 408 per frame across the 4x2 grid.
    DrawRoundedRectCached(screen, imgX, imgY, imgW, imgH, 12, t.bgPanelLight)

    filename = WallpaperFilename(curItem)
    thumbBmp = state.imgLoader.GetThumbnailSized(filename, imgW, imgH)
    if thumbBmp <> invalid
        screen.DrawObject(imgX, imgY, thumbBmp)
    else
        fallback = state.imgLoader.GetThumbnail(filename)
        if fallback <> invalid
            DrawScaledTo(screen, imgX, imgY, imgW, imgH, fallback)
        else if state.spinnerVisible
            DrawLoadingSpinner(screen, imgX + CInt(imgW / 2), imgY + CInt(imgH / 2), 18, state.spinnerAngle, t.textAccent, t.borderSubtle)
        end if
    end if

    ' Overlay badges on the artwork.
    isFav = state.favMgr.IsFavorite(curItem.id)
    isDaily = false
    if state.dailyWallpaper <> invalid then isDaily = SafeStr(state.dailyWallpaper.id) = SafeStr(curItem.id)

    badgeX = imgX + imgW - 12
    if isFav
        favText = "FAV"
        badgeX = badgeX - BadgeWidth(favText, fonts.caption)
        DrawBadge(screen, favText, badgeX, imgY + 10, t.heartPink, t.textPrimary, fonts.caption)
        badgeX = badgeX - 10
    end if
    if isDaily
        dailyLabel = "TODAY"
        badgeX = badgeX - BadgeWidth(dailyLabel, fonts.caption)
        DrawBadge(screen, dailyLabel, badgeX, imgY + 10, t.badge4k, t.textPrimary, fonts.caption)
        badgeX = badgeX - 10
    end if
    qualityLabel = QualityBadge(curItem)
    badgeX = badgeX - BadgeWidth(qualityLabel, fonts.caption)
    DrawBadge(screen, qualityLabel, badgeX, imgY + 10, t.badgeFhd, t.textPrimary, fonts.caption)

    if isDaily then DrawBadge(screen, "DAILY PICK", imgX + 10, imgY + 10, t.textGold, t.textOnAccent, fonts.caption)

    ' Metadata block.
    titleY = imgY + imgH + 12
    screen.DrawText(TruncateText(WallpaperTitle(curItem), 32), imgX + 4, titleY, t.textPrimary, fonts.heading)

    tagStr = SafeStr(curItem.tags)
    if Len(tagStr) > 48 then tagStr = Left(tagStr, 48) + "..."
    screen.DrawText(tagStr, imgX + 4, titleY + 30, t.textSecondary, fonts.small)

    metaStr = SourceLabel(curItem) + "  •  " + FormatDate(SafeStr(curItem.date_spotted))
    screen.DrawText(TruncateText(metaStr, 44), imgX + 4, titleY + 56, t.textMuted, fonts.caption)

    ' Focus ring last so it sits above everything.
    if isSelected
        glowAlpha = CalcGlowAlpha(state, 210)
        DrawFocusRingAnimated(screen, cardX, cardY, cardW, cardH, t.borderFocused, 14, glowAlpha)
        DrawRoundedRectCached(screen, cardX + 2, cardY + cardH - 6, cardW - 4, 4, 2, t.textAccent)
    end if
end sub

' Breathing alpha shared by every focus ring in the app, driven by the single
' animation clock so all of them pulse in phase.
function CalcGlowAlpha(state as object, peak as integer) as integer
    animMs = 0
    if state <> invalid
        if state.animClock <> invalid then animMs = state.animClock.TotalMilliseconds()
    end if
    ' 1.6 second cycle.
    wave = Sin((animMs MOD 1600) / 1600.0 * 6.283185)
    return ClampI(CInt(peak * (0.62 + (0.38 * wave))), 60, 255)
end function

' ─── SHARED OVERLAYS ──────────────────────────────────────────────────

' Transient status message, bottom-centre, width measured from the real font
' metrics rather than a characters-times-constant guess.
sub RenderToast(screen as object, state as object)
    if state.toastMessage = "" then return

    t = GetTheme()
    fonts = state.fonts

    text = TruncateText(state.toastMessage, 96)
    textW = fonts.body.GetOneLineWidth(text, 1920)
    toastW = textW + 60
    if toastW > 1600 then toastW = 1600
    toastH = 64
    toastX = CInt((1920 - toastW) / 2)
    toastY = 866

    DrawGlassPanelR(screen, toastX, toastY, toastW, toastH, t.borderFocused, t.bgPanelLight, 12)
    screen.DrawText(text, toastX + 30, toastY + 18, t.textPrimary, fonts.body)
end sub

' Title-safe (80%) and action-safe (90%) overlays for calibration.
sub DrawSafeAreaGuides(screen as object, guideMode as string)
    if guideMode = invalid or guideMode = "" or guideMode = "off" then return

    if guideMode = "action_90" or guideMode = "both"
        ax = 96
        ay = 54
        aw = 1920 - (ax * 2)
        ah = 1080 - (ay * 2)
        screen.DrawRect(ax, ay, aw, 2, &hFF4444AA)
        screen.DrawRect(ax, ay + ah - 2, aw, 2, &hFF4444AA)
        screen.DrawRect(ax, ay, 2, ah, &hFF4444AA)
        screen.DrawRect(ax + aw - 2, ay, 2, ah, &hFF4444AA)
    end if

    if guideMode = "title_80" or guideMode = "both"
        tx = 192
        ty = 108
        tw = 1920 - (tx * 2)
        th = 1080 - (ty * 2)
        screen.DrawRect(tx, ty, tw, 2, &h44FF44AA)
        screen.DrawRect(tx, ty + th - 2, tw, 2, &h44FF44AA)
        screen.DrawRect(tx, ty, 2, th, &h44FF44AA)
        screen.DrawRect(tx + tw - 2, ty, 2, th, &h44FF44AA)
    end if
end sub
