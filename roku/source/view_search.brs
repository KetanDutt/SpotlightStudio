' Spotlight Studio for Roku
' view_search.brs - On-screen keyboard for free-text search of the archive.
'
' Roku removed roKeyboardScreen in 2019 and the dynamic voice keyboards are a
' SceneGraph component, so a pure-canvas channel has to draw its own.  The
' layout is a staggered QWERTY block plus an action row; navigation clamps the
' column when moving between rows of different lengths so the cursor can never
' land on a key that does not exist.

function SearchDialogMetrics() as object
    gaa = GetGlobalAA()
    if gaa.__ssSearchMetrics = invalid
        gaa.__ssSearchMetrics = {
            w: 1240,
            h: 780,
            x: 340,
            y: 150,
            keyH: 60,
            keyW: 74,
            gap: 10,
            rowsY: 300
        }
    end if
    return gaa.__ssSearchMetrics
end function

sub RenderSearchOverlay(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    M = SearchDialogMetrics()
    rows = KeyboardRows()

    DrawScrim(screen, 216)
    DrawGlassPanelR(screen, M.x, M.y, M.w, M.h, t.borderFocused, t.bgPanel, 18)
    DrawRoundedOutline(screen, M.x - 3, M.y - 3, M.w + 6, M.h + 6, 20, t.focusSoft, 2)

    screen.DrawText("Search the Archive", M.x + 40, M.y + 24, t.textPrimary, fonts.title)
    subtitle = "Matches titles and tags across " + StrI(state.totalCount).Trim() + " wallpapers"
    screen.DrawText(subtitle, M.x + 40, M.y + 78, t.textSecondary, fonts.caption)

    ' ── query field ────────────────────────────────────────────────────
    fieldX = M.x + 40
    fieldY = M.y + 118
    fieldW = M.w - 80
    fieldH = 62

    DrawRoundRect(screen, fieldX, fieldY, fieldW, fieldH, 9, t.bgInset)
    DrawRoundedOutline(screen, fieldX, fieldY, fieldW, fieldH, 9, t.borderFocused, 2)

    query = SafeStr(state.activeSearch)
    display = query
    if display = "" then display = "Type to search..."
    displayColor = t.textPrimary
    if query = "" then displayColor = t.textMuted
    screen.DrawText(TruncateText(display, 44), fieldX + 18, fieldY + 16, displayColor, fonts.heading)

    ' Blinking caret while the field has focus.
    if query <> ""
        caretX = fieldX + 18 + fonts.heading.GetOneLineWidth(TruncateText(query, 44), 1920) + 3
        if state.caretVisible then screen.DrawRect(caretX, fieldY + 14, 2, 34, t.textAccent)
    end if

    matchLabel = StrI(state.filtered.Count()).Trim() + " matches"
    matchW = fonts.caption.GetOneLineWidth(matchLabel, 1920)
    screen.DrawText(matchLabel, fieldX + fieldW - matchW - 18, fieldY + 22, t.textAccent, fonts.caption)

    ' ── keyboard ───────────────────────────────────────────────────────
    for r = 0 to rows.Count() - 1
        line = rows[r]
        widths = SearchRowWidths(line, fonts)
        totalW = 0
        for each w in widths
            totalW = totalW + w
        end for
        totalW = totalW + (M.gap * (line.Count() - 1))

        startX = M.x + CInt((M.w - totalW) / 2)
        rowY = M.y + M.rowsY + (r * (M.keyH + M.gap))
        cursorX = startX

        for c = 0 to line.Count() - 1
            keyW = widths[c]
            isFocused = (state.kbRow = r and state.kbCol = c)

            bgColor = t.btnNormal
            borderColor = t.borderSubtle
            textColor = t.textSecondary
            if isFocused
                bgColor = t.btnFocused
                borderColor = t.borderFocused
                textColor = t.textOnAccent
            end if

            bmp = GetGfxCache().GetPanel(keyW, M.keyH, 9, bgColor, borderColor, 2)
            if bmp <> invalid
                screen.DrawObject(cursorX, rowY, bmp)
            else
                DrawRoundRect(screen, cursorX, rowY, keyW, M.keyH, 9, bgColor)
                DrawRoundedOutline(screen, cursorX, rowY, keyW, M.keyH, 9, borderColor, 2)
            end if

            label = SafeStr(line[c])
            labelW = fonts.body.GetOneLineWidth(label, 1920)
            screen.DrawText(label, cursorX + CInt((keyW - labelW) / 2), rowY + 17, textColor, fonts.body)

            cursorX = cursorX + keyW + M.gap
        end for
    end for

    ' ── hint strip ─────────────────────────────────────────────────────
    hintY = M.y + M.rowsY + (rows.Count() * (M.keyH + M.gap)) + 18
    screen.DrawRect(M.x + 40, hintY - 14, M.w - 80, 1, t.borderSubtle)
    screen.DrawText("OK Select     Back Delete     * Clear     SEARCH Apply & browse results", M.x + 40, hintY, t.textMuted, fonts.caption)
end sub

' Per-key widths: single letters get a fixed cell, the action row is sized to
' its label so "SEARCH" is not clipped.
function SearchRowWidths(line as object, fonts as object) as object
    widths = []
    M = SearchDialogMetrics()
    for each key in line
        label = SafeStr(key)
        if Len(label) <= 1
            widths.Push(M.keyW)
        else
            ' Fallback only: state.fonts is always built, but if it were not the
            ' old estimate (11 px/char) undershot the wide glyphs in the 22 px
            ' default font and clipped the label.  14 px/char is the average
            ' advance of that font, so the estimate errs wide rather than short.
            labelW = Len(label) * 14
            if fonts <> invalid and fonts.body <> invalid
                measured = fonts.body.GetOneLineWidth(label, 1920)
                if measured > 0 then labelW = measured
            end if
            widths.Push(MaxI(labelW + 44, M.keyW))
        end if
    end for
    return widths
end function

' Move the keyboard cursor, clamping the column into the target row.
' Returns true when the cursor moved (so the caller can raise a nav sound).
function MoveKeyboardCursor(state as object, dx as integer, dy as integer) as boolean
    rows = KeyboardRows()
    rowCount = rows.Count()
    if rowCount = 0 then return false

    row = ClampI(state.kbRow + dy, 0, rowCount - 1)
    lineCount = rows[row].Count()
    col = state.kbCol + dx
    if col < 0 then col = 0
    if col > lineCount - 1 then col = lineCount - 1

    moved = (row <> state.kbRow) or (col <> state.kbCol)
    state.kbRow = row
    state.kbCol = col
    return moved
end function

' The key currently under the cursor.
function KeyboardFocusedKey(state as object) as string
    return KeyboardKeyAt(state.kbRow, state.kbCol)
end function
