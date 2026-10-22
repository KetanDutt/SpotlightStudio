' Spotlight Studio for Roku
' view_ambient.brs - Distraction-free Ambient Mode: full-bleed wallpaper,
'                    Ken Burns drift and dip-to-black slideshow transitions.
'
' Transitions are a dip to black rather than a cross-fade because ifDraw2D has
' no per-object alpha control: the only way to fade an image is to fade a solid
' rectangle over it.  A short black dip reads as cinematic on a TV and costs two
' DrawRect calls per frame instead of a second full-screen bitmap.

function AmbientFadeDuration() as integer
    return 500
end function

function AmbientRevealDuration() as integer
    return 700
end function

sub RenderAmbient(screen as object, state as object)
    t = GetTheme()

    if state.browseList.Count() = 0
        screen.Clear(t.bgMain)
        RenderEmptyNotice(screen, state, "Ambient Mode needs wallpapers", "Press Back, then choose a filter that returns results")
        return
    end if

    state.browseIdx = WrapIndex(state.browseIdx, state.browseList.Count())
    curItem = state.browseList[state.browseIdx]
    filename = WallpaperFilename(curItem)

    imgBmp = invalid
    if filename <> "" then imgBmp = state.imgLoader.GetFullImage(filename)

    screen.Clear(t.bgMain)

    if imgBmp <> invalid and imgBmp.GetWidth() > 1
        srcW = imgBmp.GetWidth()
        srcH = imgBmp.GetHeight()

        ' Ken Burns: a 24-second breathing zoom with a slow diagonal drift.
        animMs = 0
        if state.animClock <> invalid then animMs = state.animClock.TotalMilliseconds()
        cycle = (animMs MOD 24000) / 24000.0
        wave = Sin(cycle * 6.283185)
        waveCos = Cos(cycle * 6.283185)

        zoom = 1.04 + (0.05 * wave)
        baseScale = MaxF(1920.0 / srcW, 1080.0 / srcH) * zoom

        drawW = CInt(srcW * baseScale)
        drawH = CInt(srcH * baseScale)
        if drawW < 1 then drawW = 1
        if drawH < 1 then drawH = 1

        ' Drift stays inside the overshoot created by the zoom, so the frame
        ' never exposes the background at the edges.
        maxPanX = MaxI(0, CInt((drawW - 1920) / 2))
        maxPanY = MaxI(0, CInt((drawH - 1080) / 2))
        panX = CInt(wave * maxPanX * 0.85)
        panY = CInt(waveCos * maxPanY * 0.85)

        drawX = CInt((1920 - drawW) / 2) + panX
        drawY = CInt((1080 - drawH) / 2) + panY

        DrawScaledTo(screen, drawX, drawY, drawW, drawH, imgBmp)
    else
        ' Thumbnail stand-in while the full frame decodes.
        thumbBmp = state.imgLoader.GetThumbnail(filename)
        if thumbBmp <> invalid
            DrawScaledTo(screen, 0, 0, 1920, 1080, thumbBmp)
        else if state.spinnerVisible
            DrawLoadingSpinner(screen, 960, 540, 20, state.spinnerAngle, &hFFFFFF44, &hFFFFFF18)
        end if
    end if

    ' ── dip-to-black transition overlay ────────────────────────────────
    alpha = AmbientFadeAlpha(state)
    if alpha > 0 then screen.DrawRect(0, 0, 1920, 1080, WithAlpha(0, alpha))

    if state.ambientShowInfo
        RenderAmbientHud(screen, state, curItem, imgBmp)
    else if imgBmp = invalid and alpha = 0
        ' A quiet spinner only while the very first frame is still loading.
        DrawLoadingSpinner(screen, 960, 540, 20, state.spinnerAngle, &hFFFFFF44, &hFFFFFF18)
    end if
end sub

' Black-overlay alpha for the current transition phase (0 when idle).
function AmbientFadeAlpha(state as object) as integer
    if state.ambientTransition = 0 then return 0

    elapsed = 0
    if state.animClock <> invalid then elapsed = state.animClock.TotalMilliseconds() - state.ambientTransStart
    if elapsed < 0 then elapsed = 0

    if state.ambientTransition = 1
        ratio = elapsed / AmbientFadeDuration()
        if ratio > 1.0 then ratio = 1.0
        return CInt(255 * ratio)
    end if

    ratio = elapsed / AmbientRevealDuration()
    if ratio > 1.0 then ratio = 1.0
    return CInt(255 * (1.0 - ratio))
end function

sub RenderAmbientHud(screen as object, state as object, curItem as object, imgBmp as object)
    t = GetTheme()
    fonts = state.fonts

    DrawGlassPanelR(screen, 0, 880, 1920, 200, t.borderSubtle, t.bgPanel, 0)

    screen.DrawText(TruncateText(WallpaperTitle(curItem), 92), 60, 906, t.textPrimary, fonts.heading)

    metaParts = SourceLabel(curItem) + "  •  " + WallpaperDimensions(curItem) + "  •  Spotted " + FormatDate(SafeStr(curItem.date_spotted))
    screen.DrawText(metaParts, 60, 956, t.textSecondary, fonts.caption)

    tagStr = SafeStr(curItem.tags)
    if Len(tagStr) > 118 then tagStr = Left(tagStr, 118) + "..."
    screen.DrawText(tagStr, 60, 990, t.textMuted, fonts.small)

    idxLabel = StrI(state.browseIdx + 1).Trim() + " / " + StrI(state.browseList.Count()).Trim()
    screen.DrawText(idxLabel, 1700, 906, t.textPrimary, fonts.heading)

    statusLabel = "READY"
    statusColor = t.successGreen
    if imgBmp = invalid
        statusLabel = "STREAMING 4K"
        statusColor = t.warningAmber
    end if
    DrawBadge(screen, statusLabel, 1660, 956, statusColor, t.textOnAccent, fonts.caption)

    if state.slideshowActive
        elapsed = 0
        if state.animClock <> invalid then elapsed = (state.animClock.TotalMilliseconds() - state.switchAtMs) / 1000
        nextIn = MaxI(0, state.ambientIntervalSec - CInt(elapsed))
        DrawBadge(screen, "AUTO " + StrI(nextIn).Trim() + "s", 1660, 996, t.badge4k, t.textPrimary, fonts.caption)
    end if

    screen.DrawText("Play/Pause Slideshow     Info Toggle     Replay Shuffle     Left/Right Browse     Any Other Key Exit", 60, 1036, t.textMuted, fonts.caption)
end sub
