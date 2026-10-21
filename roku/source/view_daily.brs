' Spotlight Studio for Roku
' view_daily.brs - The Daily Spotlight hero screen.
'
' The winner is chosen by a deterministic FNV-1a hash of "<UTC day>|<id>" that is
' bit-identical to src/utils.py::daily_score, so the web, desktop, mobile and TV
' clients all surface the same wallpaper on the same day.  See catalog.brs for
' the implementation and RunDailyHashSelfTest() for the parity vectors.

sub RenderDailySpotlight(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts

    screen.Clear(t.bgMain)
    DrawGalleryBackdrop(screen, state)
    DrawViewHeader(screen, state, "Daily Spotlight", "Deterministic hero picked for today (UTC), identical on every Spotlight Studio client")

    dailyItem = state.dailyWallpaper
    if dailyItem = invalid
        RenderEmptyNotice(screen, state, "No Daily Spotlight available", "The packaged archive is empty, so no hero could be selected")
        return
    end if

    ' ── hero ───────────────────────────────────────────────────────────
    heroX = 85
    heroY = 145
    heroW = 1050
    heroH = 590

    DrawGlassPanelR(screen, heroX - 4, heroY - 4, heroW + 8, heroH + 8, t.borderFocused, t.bgPanel, 20)

    filename = WallpaperFilename(dailyItem)
    thumbBmp = state.imgLoader.GetThumbnail(filename)
    if thumbBmp <> invalid
        DrawScaledOrResize(screen, heroX + 10, heroY + 10, heroW - 20, heroH - 100, thumbBmp, "d:" + filename)
    else
        DrawRoundRect(screen, heroX + 10, heroY + 10, heroW - 20, heroH - 100, 14, t.bgPanelLight)
        DrawSpinnerBlock(screen, state, heroX + 10, heroY + 10, heroW - 20, heroH - 100, 22, "Streaming today's hero...")
    end if

    DrawBadge(screen, QualityBadge(dailyItem), heroX + 20, heroY + 20, t.badge4k, t.textPrimary, fonts.caption)
    DrawBadge(screen, SourceLabel(dailyItem), heroX + 20 + BadgeWidth(QualityBadge(dailyItem), fonts.caption) + 12, heroY + 20, t.btnFocused, t.textOnAccent, fonts.caption)
    DrawBadge(screen, "TODAY", heroX + heroW - 20 - BadgeWidth("TODAY", fonts.caption), heroY + 20, t.textGold, t.textOnAccent, fonts.caption)

    titleY = heroY + heroH - 74
    screen.DrawRect(heroX + 10, titleY - 10, heroW - 20, 1, t.borderSubtle)
    screen.DrawText(TruncateText(WallpaperTitle(dailyItem), 62), heroX + 20, titleY, t.textPrimary, fonts.heading)
    screen.DrawText("Spotted " + FormatDate(SafeStr(dailyItem.date_spotted)) + "   •   " + WallpaperDimensions(dailyItem), heroX + 20, titleY + 34, t.textSecondary, fonts.caption)

    ' ── metadata panel ─────────────────────────────────────────────────
    infoX = heroX + heroW + 40
    infoW = 1920 - infoX - 85
    infoY = heroY
    infoH = 260

    DrawGlassPanelR(screen, infoX, infoY, infoW, infoH, t.borderSubtle, t.bgPanel, 18)
    screen.DrawRect(infoX + 20, infoY + 20, infoW - 40, 4, t.textAccent)
    screen.DrawText("Spotlight Metadata", infoX + 20, infoY + 34, t.textPrimary, fonts.heading)

    metaRows = [
        "ID: #" + SafeStr(dailyItem.id),
        "Resolution: " + WallpaperDimensions(dailyItem),
        "Archive: " + SourceLabel(dailyItem),
        "Spotted: " + FormatDate(SafeStr(dailyItem.date_spotted)),
        "Favorited: " + FavoriteYesNo(state, dailyItem)
    ]
    for i = 0 to metaRows.Count() - 1
        screen.DrawText(metaRows[i], infoX + 20, infoY + 74 + (i * 32), t.textSecondary, fonts.caption)
    end for

    ' ── tag pills ──────────────────────────────────────────────────────
    actionY = 770
    tagStr = SafeStr(dailyItem.tags)
    screen.DrawText("Tags", infoX, infoY + infoH + 24, t.textPrimary, fonts.heading)

    tagY = infoY + infoH + 58
    tagX = infoX
    tagLimitY = actionY - 60
    parts = SplitString(tagStr, ",")
    shown = 0
    for each rawTag in parts
        if shown >= 12 then exit for
        tag = SafeStr(rawTag)
        if tag <> ""
            tagW = fonts.caption.GetOneLineWidth(tag) + 22
            if tagX + tagW > 1920 - 85
                tagX = infoX
                tagY = tagY + 40
            end if
            if tagY > tagLimitY then exit for

            DrawRoundRect(screen, tagX, tagY, tagW, 32, 9, t.bgPanelLight)
            DrawRoundedOutline(screen, tagX, tagY, tagW, 32, 9, t.borderSubtle, 1)
            screen.DrawText(tag, tagX + 11, tagY + 6, t.textAccent, fonts.caption)
            tagX = tagX + tagW + 10
            shown = shown + 1
        end if
    end for

    ' ── actions ────────────────────────────────────────────────────────
    actions = ["VIEW FULLSCREEN", "START AMBIENT MODE", "ADD TO FAVORITES"]
    actionW = infoW
    for i = 0 to actions.Count() - 1
        isFocused = (state.dailyAction = i)
        DrawButton(screen, actions[i], infoX, actionY + (i * 58), actionW, 48, isFocused, fonts.caption)
    end for

    DrawViewFooter(screen, state, "Up/Down select action   OK run action   Play start Ambient Mode   Back return to the gallery")
end sub

' Kept as a helper so the metadata block stays a flat list of strings.
function FavoriteYesNo(state as object, item as object) as string
    if state = invalid or state.favMgr = invalid then return "No"
    if state.favMgr.IsFavorite(item.id) then return "Yes"
    return "No"
end function
