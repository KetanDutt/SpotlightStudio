' Spotlight Studio for Roku
' constants.brs - Single source of truth for every option list in the app.
'
' These lists used to be re-declared as array literals in three places (input
' handling in main.brs, the filter modal, and the settings view).  Any drift
' between them silently produced "pressing right does nothing" bugs, and each
' literal allocated a fresh roArray on every frame it was touched.  Everything
' below is memoised in the global AA and must be treated as read-only.

' ─── TOP-LEVEL NAVIGATION ─────────────────────────────────────────────

function NavTabs() as object
    gaa = GetGlobalAA()
    if gaa.__ssNavTabs = invalid
        gaa.__ssNavTabs = ["Gallery", "Daily Pick", "Screensavers", "Favorites", "Filter & Sort", "Theme Studio", "Pro Store", "Settings"]
    end if
    return gaa.__ssNavTabs
end function

' Nav tab indices.  Kept as named constants so main.brs reads as intent rather
' than magic numbers.
function TabGallery() as integer
    return 0
end function

function TabDaily() as integer
    return 1
end function

function TabScreensavers() as integer
    return 2
end function

function TabFavorites() as integer
    return 3
end function

function TabFilter() as integer
    return 4
end function

function TabTheme() as integer
    return 5
end function

function TabStore() as integer
    return 6
end function

function TabSettings() as integer
    return 7
end function

' ─── FILTER OPTIONS ───────────────────────────────────────────────────

function CategoryOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssCategories = invalid
        gaa.__ssCategories = ["All", "Landscape", "Nature", "Water", "Animals", "City", "Mountains", "Sky", "Space", "Architecture", "Desert", "Forest"]
    end if
    return gaa.__ssCategories
end function

function ResolutionOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssResolutions = invalid
        gaa.__ssResolutions = ["All", "4K", "FHD"]
    end if
    return gaa.__ssResolutions
end function

function SourceOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssSources = invalid
        gaa.__ssSources = ["All", "peapix", "win10spotlight"]
    end if
    return gaa.__ssSources
end function

function SortOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssSorts = invalid
        gaa.__ssSorts = ["newest", "oldest", "quality", "title", "random"]
    end if
    return gaa.__ssSorts
end function

function TagOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssTags = invalid
        gaa.__ssTags = ["", "sunset", "beach", "forest", "night", "lake", "winter", "stars", "aurora", "desert", "waterfall", "mountains", "coast", "snow"]
    end if
    return gaa.__ssTags
end function

function ClockFormatOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssClockFormats = invalid
        gaa.__ssClockFormats = ["auto", "12h", "24h"]
    end if
    return gaa.__ssClockFormats
end function

function SafeAreaOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssSafeAreas = invalid
        gaa.__ssSafeAreas = ["off", "action_90", "title_80", "both"]
    end if
    return gaa.__ssSafeAreas
end function

' Ambient slideshow intervals, in seconds.
function AmbientIntervalOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssAmbientIntervals = invalid
        gaa.__ssAmbientIntervals = [5, 10, 15, 30, 60, 120, 300]
    end if
    return gaa.__ssAmbientIntervals
end function

' Ambient safety sleep timer options in minutes (0 disables auto-dim).
function AmbientSleepOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssAmbientSleepOptions = invalid
        gaa.__ssAmbientSleepOptions = [0, 30, 60, 120]
    end if
    return gaa.__ssAmbientSleepOptions
end function

' Automatic home-wallpaper / screensaver rotation intervals, in seconds.
' Pro-only feature; the shortest interval is deliberately 60s so the rotation
' engine cannot hammer the CDN.
function AutoSwitchIntervalOptions() as object
    gaa = GetGlobalAA()
    if gaa.__ssAutoSwitchIntervals = invalid
        gaa.__ssAutoSwitchIntervals = [60, 300, 900, 1800, 3600, 86400]
    end if
    return gaa.__ssAutoSwitchIntervals
end function

' ─── HUMAN LABELS ─────────────────────────────────────────────────────

function SortLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssSortLabels = invalid
        gaa.__ssSortLabels = {
            "newest": "Newest Spotted First",
            "oldest": "Oldest Spotted First",
            "quality": "4K UHD Quality First",
            "title": "Title A to Z",
            "random": "Random Shuffle"
        }
    end if
    return gaa.__ssSortLabels
end function

function ResolutionLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssResLabels = invalid
        gaa.__ssResLabels = {
            "All": "All Resolutions",
            "4K": "4K Ultra-HD (3840x2160)",
            "FHD": "Full HD 1080p (1920x1080)"
        }
    end if
    return gaa.__ssResLabels
end function

function SourceLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssSrcLabels = invalid
        gaa.__ssSrcLabels = {
            "All": "All Archives",
            "peapix": "Peapix (Bing Archive)",
            "win10spotlight": "Windows 10 Spotlight"
        }
    end if
    return gaa.__ssSrcLabels
end function

function ClockFormatLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssClockLabels = invalid
        gaa.__ssClockLabels = {
            "auto": "AUTO (DEVICE SETTING)",
            "12h": "12-HOUR (AM / PM)",
            "24h": "24-HOUR (MILITARY)"
        }
    end if
    return gaa.__ssClockLabels
end function

function SafeAreaLabels() as object
    gaa = GetGlobalAA()
    if gaa.__ssSafeAreaLabels = invalid
        gaa.__ssSafeAreaLabels = {
            "off": "OFF",
            "action_90": "ACTION SAFE (90%)",
            "title_80": "TITLE SAFE (80%)",
            "both": "BOTH GUIDES"
        }
    end if
    return gaa.__ssSafeAreaLabels
end function

' Look a value up in one of the label maps above, falling back to the raw value
' so an unexpected registry string can never render as a blank cell.
function LabelFor(labels as object, value as string) as string
    if labels = invalid then return SafeStr(value)
    if value = invalid then return ""
    if labels.DoesExist(value) then return SafeStr(labels[value])
    return SafeStr(value)
end function

' Human-readable interval, e.g. 90 -> "1 Min 30 Sec", 86400 -> "Daily".
function FormatInterval(seconds as integer) as string
    if seconds <= 0 then return "Off"
    if seconds >= 86400 then return "Daily"
    if seconds < 60 then return StrI(seconds).Trim() + " Seconds"
    mins = CInt(seconds / 60)
    secs = seconds MOD 60
    label = StrI(mins).Trim() + " Min"
    if mins = 1 then label = "1 Minute"
    if secs > 0 then label = label + " " + StrI(secs).Trim() + " Sec"
    return label
end function

' ─── ROW CYCLING ──────────────────────────────────────────────────────
' Every option row in the app cycles through one of the lists above.  Doing it
' through one helper means a value that is not in the list (a stale registry
' entry, for example) snaps back into range instead of getting stuck.

function IndexOfOption(options as object, current as string) as integer
    if options = invalid then return 0
    for i = 0 to options.Count() - 1
        if SafeStr(options[i]) = SafeStr(current) then return i
    end for
    return 0
end function

' Cycle `current` through `options` by `direction` (-1 or +1).
function CycleOption(options as object, current as string, direction as integer) as string
    if options = invalid or options.Count() = 0 then return SafeStr(current)
    delta = 1
    if direction < 0 then delta = -1
    idx = IndexOfOption(options, current)
    return SafeStr(options[WrapIndex(idx + delta, options.Count())])
end function

function IndexOfIntOption(options as object, current as integer) as integer
    if options = invalid then return 0
    for i = 0 to options.Count() - 1
        if SafeInt(options[i]) = current then return i
    end for
    return 0
end function

function CycleIntOption(options as object, current as integer, direction as integer) as integer
    if options = invalid or options.Count() = 0 then return current
    delta = 1
    if direction < 0 then delta = -1
    idx = IndexOfIntOption(options, current)
    return SafeInt(options[WrapIndex(idx + delta, options.Count())], current)
end function

' ─── LAYOUT CONSTANTS ─────────────────────────────────────────────────

function GalleryPageSize() as integer
    return 8
end function

function GalleryColumns() as integer
    return 4
end function

function ScreensaverPageSize() as integer
    return 6
end function

function ScreensaverColumns() as integer
    return 3
end function

' How many pages the rewind / fast-forward keys skip.
function PageSkipCount() as integer
    return 10
end function

' ─── ON-SCREEN KEYBOARD ───────────────────────────────────────────────
' roKeyboardScreen was removed from the Roku OS in 2019, and Roku's dynamic
' voice keyboards are a SceneGraph component, so a canvas channel has to draw
' its own.  Four rows: three of letters and one of actions.

function KeyboardRows() as object
    gaa = GetGlobalAA()
    if gaa.__ssKeyboard = invalid
        gaa.__ssKeyboard = [
            ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
            ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
            ["Z", "X", "C", "V", "B", "N", "M"],
            ["SPACE", "CLEAR", "SEARCH", "CANCEL"]
        ]
    end if
    return gaa.__ssKeyboard
end function

' Keys on the action row that type something rather than run a command.
function KeyboardSpaceKey() as string
    return "SPACE"
end function

function KeyboardClearKey() as string
    return "CLEAR"
end function

function KeyboardSearchKey() as string
    return "SEARCH"
end function

function KeyboardCancelKey() as string
    return "CANCEL"
end function

' The key under the cursor, or "" when the coordinates are out of range.
function KeyboardKeyAt(row as integer, col as integer) as string
    rows = KeyboardRows()
    if row < 0 or row >= rows.Count() then return ""
    line = rows[row]
    if col < 0 or col >= line.Count() then return ""
    return SafeStr(line[col])
end function
