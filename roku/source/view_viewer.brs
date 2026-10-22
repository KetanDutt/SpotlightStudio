' Spotlight Studio for Roku
' view_viewer.brs - Immersive fullscreen wallpaper viewer with zoom, a hiding
'                   HUD and a slideshow.
'
' Index note: the viewer always operates on `state.browseList` /
' `state.browseIdx`.  It can be opened from the gallery, the screensaver grid,
' the Daily Spotlight and the Theme Studio previews, and each of those has its
' own list - the previous implementation reused `state.filtered` indices for all
' of them, so pressing Left/Right after opening a 4K card jumped to an
' unrelated wallpaper.

sub RenderViewer(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts

    ' 0 = fit inside the frame (letterboxed), 1 = fill the frame (cropped).
    aspectFill = (state.aspectMode = 1)

    if state.browseIdx < 0 then state.browseIdx = 0
    if state.browseList.Count() > 0
        state.browseIdx = WrapIndex(state.browseIdx, state.browseList.Count())
        curItem = state.browseList[state.browseIdx]
    else
        curItem = invalid
    end if

    screen.Clear(t.bgMain)

    filename = WallpaperFilename(curItem)
    imgBmp = invalid
    if filename <> "" then imgBmp = state.imgLoader.GetFullImage(filename)

    if imgBmp <> invalid
        srcW = imgBmp.GetWidth()
        srcH = imgBmp.GetHeight()

        if srcW > 1 and srcH > 1
            ' All arithmetic in floats: the previous MinI(1920/srcW, 1080/srcH)
            ' truncated the ratio to 0 for any source larger than the screen and
            ' then fell back to scale 1, drawing a 4K frame at native size.
            scaleFit = MinF(1920.0 / srcW, 1080.0 / srcH)
            scaleFill = MaxF(1920.0 / srcW, 1080.0 / srcH)
            scale = scaleFit
            if aspectFill then scale = scaleFill
            if state.zoomScale > 1.0 then scale = scale * state.zoomScale

            drawW = CInt(srcW * scale)
            drawH = CInt(srcH * scale)
            if drawW < 1 then drawW = 1
            if drawH < 1 then drawH = 1

            drawX = CInt((1920 - drawW) / 2)
            drawY = CInt((1080 - drawH) / 2)

            DrawScaledTo(screen, drawX, drawY, drawW, drawH, imgBmp)
        else
            screen.DrawObject(0, 0, imgBmp)
        end if
    else if curItem <> invalid
        ' Progressive fallback: show the cached thumbnail while the full frame
        ' decodes, so the screen is never blank.
        thumbBmp = state.imgLoader.GetThumbnail(filename)
        if thumbBmp <> invalid
            DrawScaledOrResize(screen, 0, 0, 1920, 1080, thumbBmp, "v:" + filename)
        else
            screen.DrawRect(0, 0, 1920, 1080, t.bgMain)
        end if
    end if

    if not state.showHud then return
    if curItem = invalid
        RenderEmptyNotice(screen, state, "Nothing to display", "Press Back to return to the gallery")
        return
    end if

    ' ── glass HUD ──────────────────────────────────────────────────────
    DrawGlassPanelR(screen, 0, 0, 1920, 110, t.borderSubtle, t.bgPanel, 0)
    DrawGlassPanelR(screen, 0, 940, 1920, 140, t.borderSubtle, t.bgPanel, 0)

    ' Top: title, favourite, quality, index.
    DrawRoundRect(screen, 0, 108, 8, 44, 3, t.heartPink)
    screen.DrawText(TruncateText(WallpaperTitle(curItem), 74), 20, 18, t.textPrimary, fonts.heading)

    badgeY = 22
    badgeX = 1360
    if state.favMgr.IsFavorite(curItem.id)
        DrawBadge(screen, "FAVORITE", badgeX, badgeY, t.heartPink, t.textPrimary, fonts.caption)
        badgeX = badgeX - BadgeWidth("FAVORITE", fonts.caption) - 12
    end if
    DrawBadge(screen, QualityBadge(curItem), badgeX, badgeY, t.badge4k, t.textPrimary, fonts.caption)
    badgeX = badgeX - BadgeWidth(QualityBadge(curItem), fonts.caption) - 12
    DrawBadge(screen, StrI(state.browseIdx + 1).Trim() + " / " + StrI(state.browseList.Count()).Trim(), badgeX, badgeY, t.btnFocused, t.textPrimary, fonts.caption)

    screen.DrawText("Spotted " + FormatDate(SafeStr(curItem.date_spotted)) + "  •  " + SourceLabel(curItem), 20, 66, t.textSecondary, fonts.caption)

    ' Bottom: metadata and the aspect/zoom readout.
    tagStr = SafeStr(curItem.tags)
    if Len(tagStr) > 110 then tagStr = Left(tagStr, 110) + "..."
    screen.DrawText("Tags: " + tagStr, 40, 956, t.textSecondary, fonts.small)

    aspectLabel = "FIT"
    if aspectFill then aspectLabel = "FILL"
    zoomPct = StrI(CInt(state.zoomScale * 100)).Trim() + "%"
    screen.DrawText("Aspect: " + aspectLabel + "   Zoom: " + zoomPct + "   Res: " + WallpaperDimensions(curItem), 40, 990, t.textSecondary, fonts.small)
    screen.DrawText("OK Info   Up/Down Zoom & HUD   Left/Right Navigate   Play Slideshow   Back Exit", 40, 1024, t.textMuted, fonts.caption)

    if state.slideshowActive
        DrawBadge(screen, "SLIDESHOW ACTIVE", 1560, 954, t.successGreen, t.textOnAccent, fonts.caption)
    else if state.transitioning
        DrawBadge(screen, "TRANSITIONING", 1580, 954, t.badge4k, t.textPrimary, fonts.caption)
    end if

    if imgBmp = invalid and filename <> ""
        DrawSpinnerBlock(screen, state, 760, 460, 400, 160, 22, "Loading full resolution image...")
    end if
end sub

' Shared empty / offline notice.
sub RenderEmptyNotice(screen as object, state as object, headline as string, detail as string)
    t = GetTheme()
    fonts = state.fonts
    screen.DrawRect(0, 0, 1920, 1080, t.bgMain)
    DrawGlassPanelR(screen, 560, 400, 800, 240, t.borderSubtle, t.bgPanel, 20)

    headW = fonts.heading.GetOneLineWidth(headline, 1920)
    screen.DrawText(headline, CInt((1920 - headW) / 2), 460, t.textPrimary, fonts.heading)

    detailW = fonts.body.GetOneLineWidth(detail, 1920)
    screen.DrawText(detail, CInt((1920 - detailW) / 2), 520, t.textSecondary, fonts.body)
    screen.DrawText("Press Back to return", CInt((1920 - fonts.caption.GetOneLineWidth("Press Back to return", 1920)) / 2), 570, t.textMuted, fonts.caption)
end sub
