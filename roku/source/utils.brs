function ToString(val as dynamic) as string
    if val = invalid then return ""
    t = type(val)
    if t = "roString" or t = "String" then return val
    if t = "roInt" or t = "Integer" then return StrI(val).Trim()
    if t = "roFloat" or t = "Float" then return Str(val).Trim()
    if t = "roDouble" or t = "Double" then return Str(val).Trim()
    if t = "roBoolean" or t = "Boolean"
        if val then return "true" else return "false"
    end if
    if t = "roAssociativeArray"
        if val.id <> invalid then return ToString(val.id)
        return ""
    end if
    return ""
end function

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

function TruncateText(text as string, maxLen as integer) as string
    if text = invalid then return ""
    if Len(text) <= maxLen then return text
    if maxLen <= 3 then return Left(text, maxLen)
    return Left(text, maxLen - 3) + "..."
end function

function FormatDate(dateStr as string) as string
    if dateStr = invalid or Len(dateStr) < 10 then return "Recent"
    ' YYYY-MM-DD to readable format e.g. Oct 15, 2026
    year = Left(dateStr, 4)
    month = Mid(dateStr, 6, 2)
    day = Mid(dateStr, 9, 2)
    
    months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    mIdx = Val(month)
    mName = month
    if mIdx >= 1 and mIdx <= 12 then mName = months[mIdx]
    
    return mName + " " + day + ", " + year
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

function MakeImageUrl(filename as string, thumb as boolean, customBase as string) as string
    if filename = invalid or filename = "" then return ""
    
    ' Default to media.githubusercontent.com for binary Git-LFS assets
    ' (raw.githubusercontent.com only serves 130-byte Git LFS text pointers)
    base = "https://media.githubusercontent.com/media/KetanDutt/SpotlightStudio/main"
    if customBase <> invalid and customBase <> ""
        base = customBase
    end if
    
    ' Automatically convert raw.githubusercontent.com to media.githubusercontent.com for Git LFS
    if Instr(1, base, "raw.githubusercontent.com") > 0
        base = ReplaceStr(base, "raw.githubusercontent.com", "media.githubusercontent.com/media")
    end if
    
    ' Strip any trailing slash
    if Right(base, 1) = "/" then base = Left(base, Len(base) - 1)
    
    prefix = "images/"
    if thumb then prefix = "images/thumbs/"
    
    url = base + "/" + prefix + filename
    if Instr(1, base, "github.com") > 0 and Instr(1, base, "media.githubusercontent.com") = 0 and Instr(1, base, "raw.githubusercontent.com") = 0 and Instr(1, url, "?raw=true") = 0
        url = url + "?raw=true"
    end if
    return url
end function

function GetDayString(dt as object) as string
    if dt = invalid then return "2026-10-17"
    iso = dt.ToISOString()
    if Len(iso) >= 10 then return Left(iso, 10)
    return "2026-10-17"
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
        if partLen > 0
            result.Push(Mid(str, startIdx, partLen))
        end if
        startIdx = foundIdx + Len(delim)
        foundIdx = Instr(startIdx, str, delim)
    end while
    
    remainder = Mid(str, startIdx)
    if Len(remainder) > 0 then result.Push(remainder)
    return result
end function

' Retrieve and format device local time based on system or user preference
function GetDeviceLocalTime(deviceInfo as object, customFormat as string) as object
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()
    
    hours = dt.GetHours()
    minutes = dt.GetMinutes()
    minStr = StrI(minutes).Trim()
    if minutes < 10 then minStr = "0" + minStr
    
    clockFormat = "12h"
    if customFormat = "12h" or customFormat = "24h"
        clockFormat = customFormat
    else if deviceInfo <> invalid
        cf = deviceInfo.GetClockFormat()
        if cf <> invalid and cf <> "" then clockFormat = LCase(cf)
    end if
    
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
    
    weekday = Left(dt.GetWeekday(), 3)
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

