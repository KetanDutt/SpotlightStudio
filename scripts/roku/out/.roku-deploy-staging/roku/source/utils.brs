' Spotlight Studio for Roku
' utils.brs - Defensive type coercion, math, formatting and device-clock helpers.
'
' Every helper in this file is written to never raise a runtime error, because a
' single type mismatch anywhere in the render loop terminates a BrightScript
' channel.  Values coming out of ParseJson() are `dynamic` and may be missing on
' any row, so they always go through SafeStr() / SafeInt() before use.

' ─── LOGGING ──────────────────────────────────────────────────────────
' Verbose logging is only emitted on sideloaded developer builds.  Published
' channels stay quiet, which keeps the debug console readable during Roku's
' certification runs.
function IsDevBuild() as boolean
    gaa = GetGlobalAA()
    if gaa.__ssDev <> invalid then return gaa.__ssDev
    appInfo = CreateObject("roAppInfo")
    isDev = false
    if appInfo <> invalid then isDev = appInfo.IsDev()
    gaa.__ssDev = isDev
    return isDev
end function

sub LogDebug(message as string)
    if IsDevBuild() then print "[Spotlight] " + message
end sub

sub LogInfo(message as string)
    print "[Spotlight] " + message
end sub

' ─── SAFE COERCION ────────────────────────────────────────────────────

' Never-failing string coercion.  Use this for any value that is concatenated
' into a label: `"x" + invalid` is a fatal runtime error in BrightScript.
function SafeStr(val as dynamic) as string
    if val = invalid then return ""
    valueType = type(val)
    if valueType = "String" or valueType = "roString" then return val.ToStr()
    if valueType = "Integer" or valueType = "roInt" then return StrI(val).Trim()
    if valueType = "LongInteger" or valueType = "roLongInteger" then return Str(val).Trim()
    if valueType = "Float" or valueType = "roFloat" then return Str(val).Trim()
    if valueType = "Double" or valueType = "roDouble" then return Str(val).Trim()
    if valueType = "Boolean" or valueType = "roBoolean"
        if val then return "true"
        return "false"
    end if
    return ""
end function

' Never-failing integer coercion (0 for anything non-numeric).
function SafeInt(val as dynamic, fallback = 0 as integer) as integer
    if val = invalid then return fallback
    valueType = type(val)
    if valueType = "Integer" or valueType = "roInt" then return val
    if valueType = "LongInteger" or valueType = "roLongInteger" then return CInt(val)
    if valueType = "Float" or valueType = "roFloat" then return CInt(val)
    if valueType = "Double" or valueType = "roDouble" then return CInt(val)
    if valueType = "String" or valueType = "roString" then return Val(val)
    if valueType = "Boolean" or valueType = "roBoolean"
        if val then return 1
        return 0
    end if
    return fallback
end function

' Yes/No and On/Off labels shared by the settings, store and theme views.
function YesNo(value as boolean) as string
    if value then return "Yes"
    return "No"
end function

function OnOff(value as boolean) as string
    if value then return "on"
    return "off"
end function

function BoolStr(value as boolean) as string
    if value then return "1"
    return "0"
end function

' ─── MATH ─────────────────────────────────────────────────────────────

function MinI(a as integer, b as integer) as integer
    if a < b then return a
    return b
end function

function MaxI(a as integer, b as integer) as integer
    if a > b then return a
    return b
end function

function ClampI(val as integer, minVal as integer, maxVal as integer) as integer
    if val < minVal then return minVal
    if val > maxVal then return maxVal
    return val
end function

' Float variants.  Using MinI()/MaxI() with fractional arguments silently
' truncates them (and BrightScript rejects mismatched numeric types outright),
' which is how the fullscreen "fit" scaling used to break on 4K sources.
function MinF(a as float, b as float) as float
    if a < b then return a
    return b
end function

function MaxF(a as float, b as float) as float
    if a > b then return a
    return b
end function

function ClampF(val as float, minVal as float, maxVal as float) as float
    if val < minVal then return minVal
    if val > maxVal then return maxVal
    return val
end function

' Ceiling integer division, used for page counts everywhere.
function CeilDivI(numerator as integer, denominator as integer) as integer
    if denominator <= 0 then return 1
    if numerator <= 0 then return 0
    return CInt((numerator + denominator - 1) / denominator)
end function

' Number of pages required for `itemCount` items, always >= 1.
function PageCount(itemCount as integer, pageSize as integer) as integer
    return MaxI(1, CeilDivI(itemCount, pageSize))
end function

' Wrap an index into [0, count-1].  Returns 0 for an empty collection.
function WrapIndex(idx as integer, count as integer) as integer
    if count <= 0 then return 0
    result = idx MOD count
    if result < 0 then result = result + count
    return result
end function

' ─── STRINGS ──────────────────────────────────────────────────────────

function TruncateText(text as string, maxLen as integer) as string
    if text = invalid then return ""
    if maxLen <= 0 then return ""
    if Len(text) <= maxLen then return text
    if maxLen <= 3 then return Left(text, maxLen)
    return Left(text, maxLen - 3) + "..."
end function

function ReplaceStr(src as string, find as string, repl as string) as string
    if src = invalid or src = "" or find = invalid or find = "" then return src
    result = ""
    startIdx = 1
    findLen = Len(find)
    while true
        foundIdx = Instr(startIdx, src, find)
        if foundIdx = 0
            result = result + Mid(src, startIdx)
            exit while
        end if
        result = result + Mid(src, startIdx, foundIdx - startIdx) + repl
        startIdx = foundIdx + findLen
    end while
    return result
end function

function SplitString(str as string, delim as string) as object
    result = []
    if str = invalid or str = "" then return result
    if delim = invalid or delim = ""
        result.Push(str)
        return result
    end if

    startIdx = 1
    foundIdx = Instr(startIdx, str, delim)
    while foundIdx > 0
        partLen = foundIdx - startIdx
        if partLen > 0 then result.Push(Mid(str, startIdx, partLen))
        startIdx = foundIdx + Len(delim)
        foundIdx = Instr(startIdx, str, delim)
    end while

    remainder = Mid(str, startIdx)
    if Len(remainder) > 0 then result.Push(remainder)
    return result
end function

' Case-insensitive "does haystack contain needle".  Empty needle = no match.
function ContainsCI(haystack as string, needle as string) as boolean
    if haystack = invalid or needle = invalid or needle = "" then return false
    return Instr(1, LCase(haystack), LCase(needle)) > 0
end function

' ─── DATE / TIME ──────────────────────────────────────────────────────

' "2026-10-08" -> "Oct 08, 2026".  Falls back to "Recent" for missing dates so
' a partially-populated row never renders an empty metadata line.
function FormatDate(dateStr as string) as string
    if dateStr = invalid or Len(dateStr) < 10 then return "Recent"
    yearPart = Left(dateStr, 4)
    monthPart = Mid(dateStr, 6, 2)
    dayPart = Mid(dateStr, 9, 2)

    months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    mIdx = Val(monthPart)
    mName = monthPart
    if mIdx >= 1 and mIdx <= 12 then mName = months[mIdx]

    return mName + " " + dayPart + ", " + yearPart
end function

' UTC day string used as the seed for the deterministic Daily Spotlight.
function GetDayString(dt as object) as string
    if dt = invalid then return "1970-01-01"
    iso = SafeStr(dt.ToISOString())
    if Len(iso) >= 10 then return Left(iso, 10)
    return "1970-01-01"
end function

' Device local time, honouring the user's override or the Roku system setting.
' Callers are expected to throttle this (see main.brs): it allocates an
' roDateTime, so running it 60x per second is pure waste.
function GetDeviceLocalTime(deviceInfo as object, customFormat as string) as object
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()

    hours = dt.GetHours()
    minutes = dt.GetMinutes()
    minStr = StrI(minutes).Trim()
    if minutes < 10 then minStr = "0" + minStr

    clockFormat = ""
    if customFormat = "12h" or customFormat = "24h"
        clockFormat = customFormat
    else if deviceInfo <> invalid
        ' roDeviceInfo.GetClockFormat() returns "12-hour" / "24-hour".
        cf = SafeStr(deviceInfo.GetClockFormat())
        if Instr(1, cf, "12") > 0
            clockFormat = "12h"
        else if Instr(1, cf, "24") > 0
            clockFormat = "24h"
        end if
    end if
    if clockFormat = "" then clockFormat = "12h"

    timeStr = ""
    ampm = ""
    if clockFormat = "12h"
        ampm = "AM"
        displayHour = hours
        if displayHour >= 12
            ampm = "PM"
            if displayHour > 12 then displayHour = displayHour - 12
        else if displayHour = 0
            displayHour = 12
        end if
        timeStr = StrI(displayHour).Trim() + ":" + minStr + " " + ampm
    else
        hrStr = StrI(hours).Trim()
        if hours < 10 then hrStr = "0" + hrStr
        timeStr = hrStr + ":" + minStr
    end if

    weekday = Left(SafeStr(dt.GetWeekday()), 3)
    monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    mIdx = dt.GetMonth() - 1
    mStr = "Jan"
    if mIdx >= 0 and mIdx < monthNames.Count() then mStr = monthNames[mIdx]
    dayStr = StrI(dt.GetDayOfMonth()).Trim()
    dateStr = weekday + ", " + mStr + " " + dayStr

    return {
        time: timeStr,
        date: dateStr,
        hours: hours,
        minutes: minutes,
        ampm: ampm,
        clockFormat: clockFormat,
        full: timeStr + "  •  " + dateStr
    }
end function

' ─── IMAGE URLS ───────────────────────────────────────────────────────

' Build the CDN URL for a wallpaper or its thumbnail.
'
' The archive is stored in Git LFS, so `raw.githubusercontent.com` returns a
' 130-byte text pointer instead of the JPEG.  `media.githubusercontent.com`
' serves the resolved binary, and any raw URL a user configures is rewritten to
' it automatically.
function MakeImageUrl(filename as string, thumb as boolean, customBase as string) as string
    if filename = invalid or filename = "" then return ""

    base = DefaultImageBase()
    if customBase <> invalid and customBase <> "" then base = customBase

    if Instr(1, base, "raw.githubusercontent.com") > 0
        base = ReplaceStr(base, "raw.githubusercontent.com", "media.githubusercontent.com/media")
    end if
    if Right(base, 1) = "/" then base = Left(base, Len(base) - 1)

    prefix = "images/"
    if thumb then prefix = "images/thumbs/"

    url = base + "/" + prefix + filename
    ' Plain github.com blob URLs need ?raw=true; the CDN hosts do not.
    if Instr(1, base, "github.com/") > 0 and Instr(1, base, "githubusercontent.com") = 0
        if Instr(1, url, "?raw=true") = 0 then url = url + "?raw=true"
    end if
    return url
end function

' Memoised so the string is not rebuilt for every queued image.
function DefaultImageBase() as string
    gaa = GetGlobalAA()
    if gaa.__ssImageBase = invalid
        gaa.__ssImageBase = "https://media.githubusercontent.com/media/KetanDutt/SpotlightStudio/main"
    end if
    return gaa.__ssImageBase
end function

' ─── WALLPAPER FIELD ACCESSORS ────────────────────────────────────────
' The packaged catalog is deliberately minimal (see scripts/build_roku_catalog.py):
' width/height are derived from `quality` here so the payload stays small.

function IsUltraHd(item as object) as boolean
    if item = invalid then return false
    return ContainsCI(SafeStr(item.quality), "4K") or ContainsCI(SafeStr(item.quality), "UHD")
end function

function WallpaperWidth(item as object) as integer
    if IsUltraHd(item) then return 3840
    return 1920
end function

function WallpaperHeight(item as object) as integer
    if IsUltraHd(item) then return 2160
    return 1080
end function

function WallpaperDimensions(item as object) as string
    return StrI(WallpaperWidth(item)).Trim() + "x" + StrI(WallpaperHeight(item)).Trim()
end function

' Short quality badge label: "4K UHD" or "FHD".
function QualityBadge(item as object) as string
    if IsUltraHd(item) then return "4K UHD"
    return "FHD"
end function

' Human-readable archive name.
function SourceLabel(item as object) as string
    if item = invalid then return "Windows Spotlight"
    if SafeStr(item.source) = "peapix" then return "Peapix"
    return "Windows Spotlight"
end function

function WallpaperTitle(item as object) as string
    if item = invalid then return ""
    title = SafeStr(item.title)
    if title = "" then title = "Spotlight Wallpaper #" + SafeStr(item.id)
    return title
end function

function WallpaperFilename(item as object) as string
    if item = invalid then return ""
    return SafeStr(item.filename)
end function

' "1920x1080" style label used by the screensaver gallery badges.
function ResolutionLabel(item as object) as string
    if IsUltraHd(item) then return "3840x2160 4K"
    return "1920x1080 FHD"
end function

' First tag of a wallpaper, used as a lightweight "category" label.
function PrimaryCategory(item as object) as string
    if item = invalid then return "Spotlight"
    tags = SafeStr(item.tags)
    if tags = "" then return "Spotlight"
    parts = SplitString(tags, ",")
    if parts.Count() = 0 then return "Spotlight"
    first = SafeStr(parts[0])
    if first = "" then return "Spotlight"
    return UCase(Left(first, 1)) + LCase(Mid(first, 2))
end function
