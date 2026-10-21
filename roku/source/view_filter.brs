' Spotlight Studio for Roku
' view_filter.brs - Modal filter & sort dialog.
'
' Every option list and label comes from constants.brs, which is also what the
' input handler in main.brs reads.  The two used to carry their own copies, and
' the copies disagreed: the settings screen persisted a "title" sort order that
' the dialog never offered and the filter never implemented.

function FilterDialogMetrics() as object
    gaa = GetGlobalAA()
    if gaa.__ssFilterMetrics = invalid
        gaa.__ssFilterMetrics = { w: 1240, h: 720, x: 340, y: 180, rowH: 62, rowsY: 150 }
    end if
    return gaa.__ssFilterMetrics
end function

sub RenderFilterOverlay(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    M = FilterDialogMetrics()

    rows = BuildFilterRows(state)
    rowCount = rows.Count()

    DrawScrim(screen, 216)
    DrawGlassPanelR(screen, M.x, M.y, M.w, M.h, t.borderFocused, t.bgPanel, 18)
    DrawRoundedOutline(screen, M.x - 3, M.y - 3, M.w + 6, M.h + 6, 20, t.focusSoft, 2)

    screen.DrawText("Filter & Sort", M.x + 50, M.y + 28, t.textPrimary, fonts.title)
    screen.DrawText("Narrow " + StrI(state.totalCount).Trim() + " wallpapers by category, resolution, archive and order", M.x + 50, M.y + 84, t.textSecondary, fonts.caption)

    rowIdx = 0
    while rowIdx < rowCount
        row = rows[rowIdx]
        rowY = M.y + M.rowsY + (rowIdx * M.rowH)
        isFocused = (state.filterRow = rowIdx)

        if isFocused
            DrawRoundRect(screen, M.x + 30, rowY, M.w - 60, 54, 10, t.accentSoft)
            DrawRoundedOutline(screen, M.x + 30, rowY, M.w - 60, 54, 10, t.borderFocused, 2)
        end if

        labelColor = t.textSecondary
        valueColor = t.textPrimary
        if isFocused
            labelColor = t.textAccent
            valueColor = t.textOnAccent
        end if

        screen.DrawText(SafeStr(row.label), M.x + 50, rowY + 14, labelColor, fonts.body)

        valueText = SafeStr(row.value)
        valueW = fonts.body.GetOneLineWidth(valueText)
        screen.DrawText(valueText, M.x + M.w - 50 - valueW, rowY + 14, valueColor, fonts.body)

        ' Directional affordance for rows that cycle.
        if SafeStr(row.kind) = "cycle"
            screen.DrawText("<", M.x + M.w - 78 - valueW, rowY + 14, labelColor, fonts.body)
            screen.DrawText(">", M.x + M.w - 42, rowY + 14, labelColor, fonts.body)
        end if

        rowIdx = rowIdx + 1
    end while

    actionY = M.y + M.rowsY + (rowCount * M.rowH) + 6
    screen.DrawRect(M.x + 50, actionY, M.w - 100, 1, t.borderSubtle)
    screen.DrawText("Left/Right change value    OK apply & close    * reset every filter    Back cancel", M.x + 50, actionY + 16, t.textMuted, fonts.caption)
end sub

' Row model: { label, value, kind }.  `kind` is "cycle" for rows the left/right
' keys change and "action" for rows that open something else.
function BuildFilterRows(state as object) as object
    rows = []
    rows.Push({ label: "Category", value: LabelFor(CategoryLabels(), state.activeCategory), kind: "cycle" })
    rows.Push({ label: "Resolution", value: LabelFor(ResolutionLabels(), state.activeResolution), kind: "cycle" })
    rows.Push({ label: "Archive", value: LabelFor(SourceLabels(), state.activeSource), kind: "cycle" })
    rows.Push({ label: "Sort Order", value: LabelFor(SortLabels(), state.sortOrder), kind: "cycle" })
    rows.Push({ label: "Quick Tag", value: QuickTagLabel(state.activeTag), kind: "cycle" })

    searchValue = "Open keyboard..."
    if state.activeSearch <> "" then searchValue = """" + TruncateText(state.activeSearch, 24) + """"
    rows.Push({ label: "Search", value: searchValue, kind: "action" })

    favValue = "No"
    if state.favoritesOnly then favValue = "Yes"
    rows.Push({ label: "Favorites Only", value: favValue, kind: "cycle" })

    return rows
end function

' Number of rows in the dialog, so main.brs can clamp navigation without
' rebuilding the row model.
function FilterRowCount() as integer
    return 7
end function

' Categories carry a friendly label; "All" and preset names read better than the
' raw tag string that is actually matched against.
function CategoryLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssCategoryLabels = invalid
        gaa.__ssCategoryLabels = {
            "All": "All Categories",
            "Landscape": "Landscape & Scenery",
            "Nature": "Nature & Wildlife",
            "Water": "Water & Coast",
            "Animals": "Animals",
            "City": "City & Urban",
            "Mountains": "Mountains",
            "Sky": "Sky & Clouds",
            "Space": "Space & Astronomy",
            "Architecture": "Architecture",
            "Desert": "Desert",
            "Forest": "Forest"
        }
    end if
    return gaa.__ssCategoryLabels
end function

function QuickTagLabel(tag as string) as string
    if tag = invalid or tag = "" then return "No quick tag"
    return "#" + tag
end function
