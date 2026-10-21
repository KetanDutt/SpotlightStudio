' Spotlight Studio for Roku
' catalog.brs - Catalog loading, filtering, sorting and the deterministic
'               Daily Spotlight pick.

' ─── LOADING ──────────────────────────────────────────────────────────

' Parse the packaged catalog.  Returns an roArray (possibly empty - never
' invalid) so callers can treat "no wallpapers" as a normal, renderable state.
'
' The payload is deliberately compact: scripts/build_roku_catalog.py strips the
' columns the TV client never reads, which keeps the package inside Roku's 4 MB
' limit (certification requirement 3.7) and roughly halves ParseJson time and
' heap use on 512 MB devices.
function LoadCatalog() as object
    timer = CreateObject("roTimespan")
    timer.Mark()

    jsonStr = ReadAsciiFile("pkg:/assets/catalog.json")
    if jsonStr = invalid or jsonStr = ""
        LogInfo("ERROR: could not read pkg:/assets/catalog.json")
        return []
    end if
    readMs = timer.TotalMilliseconds()

    items = ParseJson(jsonStr)
    jsonStr = "" ' release the 2 MB source string before the UI starts allocating
    if items = invalid
        LogInfo("ERROR: ParseJson returned invalid - catalog is not valid JSON")
        return []
    end if
    if type(items) <> "roArray"
        LogInfo("ERROR: catalog root is " + type(items) + ", expected an array")
        return []
    end if

    LogInfo("Catalog loaded: " + StrI(items.Count()).Trim() + " wallpapers (" + StrI(readMs).Trim() + "ms read, " + StrI(timer.TotalMilliseconds()).Trim() + "ms total)")
    return items
end function

' Linear scan used by deep links.  Returns the index, or -1 when the key does
' not match any wallpaper.  Accepts a numeric id, an id string, or a filename.
function FindWallpaperIndex(items as object, key as string) as integer
    if items = invalid or key = invalid or key = "" then return -1
    targetId = Val(key)
    total = items.Count()
    for i = 0 to total - 1
        item = items[i]
        if item <> invalid
            if SafeInt(item.id, -1) = targetId and targetId <> 0 then return i
            if SafeStr(item.filename) = key then return i
        end if
    end for
    return -1
end function

function FindWallpaper(items as object, key as string) as object
    idx = FindWallpaperIndex(items, key)
    if idx < 0 then return invalid
    return items[idx]
end function

' ─── FILTERING ────────────────────────────────────────────────────────

' Build the working list for the gallery.
'
' The catalog ships sorted newest-first, so the unfiltered/default case returns
' the source array by reference.  That fast path matters: copying 7,475
' associative arrays on every filter dialog keystroke would stall the UI well
' past Roku's 250 ms navigation requirement (certification 3.5).
function FilterWallpapers(allItems as object, category as string, resolutionFilter as string, sourceFilter as string, searchQuery as string, onlyFavorites as boolean, favMgr as object, sortOrder as string) as object
    if allItems = invalid then return []
    if sortOrder = invalid or sortOrder = "" then sortOrder = "newest"

    hasSearch = (searchQuery <> invalid and searchQuery <> "")
    hasCategory = (category <> invalid and category <> "" and category <> "All" and category <> "Favorites" and category <> "Daily")
    hasRes = (resolutionFilter <> invalid and resolutionFilter <> "" and resolutionFilter <> "All")
    hasSource = (sourceFilter <> invalid and sourceFilter <> "" and sourceFilter <> "All")
    noFilters = (not hasSearch) and (not hasCategory) and (not hasRes) and (not hasSource) and (not onlyFavorites)

    if noFilters and sortOrder = "newest" then return allItems

    qLower = ""
    if hasSearch then qLower = LCase(searchQuery)
    catLower = ""
    if hasCategory then catLower = LCase(category)

    ' Hoist the per-row string work: titles and tags are lower-cased once per
    ' row instead of once per active filter.
    result = []
    for each item in allItems
        include = (item <> invalid)

        if include and onlyFavorites
            include = (favMgr <> invalid)
            if include then include = favMgr.IsFavorite(item.id)
        end if

        if include and hasRes
            quality = SafeStr(item.quality)
            if resolutionFilter = "4K"
                include = (Instr(1, quality, "4K") > 0) or (Instr(1, quality, "UHD") > 0)
            else if resolutionFilter = "FHD"
                include = (Instr(1, quality, "FHD") > 0) or (Instr(1, quality, "1080") > 0)
            end if
        end if

        if include and hasSource then include = (SafeStr(item.source) = sourceFilter)

        ' Titles and tags are lower-cased once per row, not once per filter.
        if include and (catLower <> "" or qLower <> "")
            titleLower = LCase(SafeStr(item.title))
            tagsLower = LCase(SafeStr(item.tags))

            if include and catLower <> ""
                include = (Instr(1, tagsLower, catLower) > 0) or (Instr(1, titleLower, catLower) > 0)
            end if
            if include and qLower <> ""
                include = (Instr(1, titleLower, qLower) > 0) or (Instr(1, tagsLower, qLower) > 0)
            end if
        end if

        if include then result.Push(item)
    end for

    return SortWallpapers(result, sortOrder)
end function

' ─── SORTING ──────────────────────────────────────────────────────────
' The catalog arrives newest-first, so "newest" is a no-op and "oldest" is a
' reverse.  Only "quality", "title" and "random" need real work.

function SortWallpapers(items as object, sortOrder as string) as object
    if items = invalid then return []
    count = items.Count()
    if count < 2 then return items

    if sortOrder = "oldest"
        reversed = []
        for idx = count - 1 to 0 step -1
            reversed.Push(items[idx])
        end for
        return reversed
    end if

    if sortOrder = "quality"
        ' Stable two-bucket partition: 4K first, everything else keeps its
        ' newest-first order behind it.
        fourK = []
        other = []
        for each itm in items
            if IsUltraHd(itm)
                fourK.Push(itm)
            else
                other.Push(itm)
            end if
        end for
        fourK.Append(other)
        return fourK
    end if

    if sortOrder = "title"
        return SortByTitle(items)
    end if

    if sortOrder = "random"
        return ShuffleWallpapers(items)
    end if

    return items
end function

' Case-insensitive A-Z title sort (insertion sort on a pre-computed key list -
' BrightScript has no built-in comparator sort).
function SortByTitle(items as object) as object
    count = items.Count()
    if count < 2 then return items

    keys = []
    for each itm in items
        keys.Push(LCase(SafeStr(itm.title)))
    end for

    ' Insertion sort: the input is already ordered by id, which correlates
    ' poorly with title, so this is O(n^2).  It only runs on the filtered
    ' subset the user is actually looking at, and is triggered by an explicit
    ' choice rather than every frame.
    for i = 1 to count - 1
        keyItem = items[i]
        keyText = keys[i]
        j = i - 1
        while j >= 0 and keys[j] > keyText
            items[j + 1] = items[j]
            keys[j + 1] = keys[j]
            j = j - 1
        end while
        items[j + 1] = keyItem
        keys[j + 1] = keyText
    end for
    return items
end function

' Fisher-Yates shuffle on a copy, so the source list is never disturbed.
function ShuffleWallpapers(items as object) as object
    shuffled = []
    if items = invalid then return shuffled
    shuffled.Append(items)
    cnt = shuffled.Count()
    for idx = cnt - 1 to 1 step -1
        j = Rnd(idx + 1) - 1
        tmp = shuffled[idx]
        shuffled[idx] = shuffled[j]
        shuffled[j] = tmp
    end for
    return shuffled
end function

' ─── 32-BIT HASHING ───────────────────────────────────────────────────
' BrightScript has no XOR operator and no unsigned 32-bit type, so FNV-1a is
' assembled from bitwise AND/OR and Double arithmetic.  Every intermediate
' stays inside the 53-bit exact range of a Double, which keeps the result
' independent of how a given firmware handles Integer overflow.

function Xor32(a as integer, b as integer) as integer
    ' (a OR b) - (a AND b) is the bitwise XOR of the two operands.  The
    ' subtraction cannot overflow: the operands' set bits are always a subset
    ' relationship, so the magnitude stays inside the 32-bit range.
    return (a or b) - (a and b)
end function

function UnsignedOf(v as integer) as double
    if v < 0 then return 4294967296.0 + CDbl(v)
    return CDbl(v)
end function

function SignedOf(u as double) as integer
    if u >= 2147483648.0 then return CInt(u - 4294967296.0)
    return CInt(u)
end function

' Truncating divide that always comes back as a Double.
function FloorD(v as double) as double
    return CDbl(Int(v))
end function

' Exact 32-bit multiply (the high 32 bits are discarded, as in C).
function Mul32(a as integer, b as integer) as integer
    au = UnsignedOf(a)
    bu = UnsignedOf(b)

    ah = FloorD(au / 65536.0)
    al = au - (ah * 65536.0)
    bh = FloorD(bu / 65536.0)
    bl = bu - (bh * 65536.0)

    low = al * bl
    carry = FloorD(low / 65536.0)
    lowWord = low - (carry * 65536.0)

    midTotal = (ah * bl) + (al * bh) + carry
    midCarry = FloorD(midTotal / 65536.0)
    midWord = midTotal - (midCarry * 65536.0)

    return SignedOf((midWord * 65536.0) + lowWord)
end function

' FNV-1a 32-bit constants.
function FnvOffsetBasis() as integer
    return -2128831035 ' 2166136261 read as a signed 32-bit integer
end function

function FnvPrime() as integer
    return 16777619
end function

' Hash a string with FNV-1a.  `seed` lets a caller continue from a partially
' hashed prefix, which is how the daily pick avoids re-hashing the date for
' every one of the 7,475 rows.
function Fnv1a32(text as string, seed as integer) as integer
    h = seed
    textLen = Len(text)
    for k = 1 to textLen
        h = Mul32(Xor32(h, Asc(Mid(text, k, 1))), FnvPrime())
    end for
    return h
end function

' The two avalanche permutations and final fold shared by every client.
function AvalancheScore(h as integer) as double
    x = Mul32(Xor32(h, ((h >> 16) and &hFFFF)), 2146121005) ' 0x7FEB352D
    x = Mul32(Xor32(x, ((x >> 15) and &h1FFFF)), -2073254261) ' 0x846CA68B
    return UnsignedOf(Xor32(x, ((x >> 16) and &hFFFF)))
end function

' Score one wallpaper for one UTC day.  Must stay bit-identical to
' src/utils.py::daily_score so the web, desktop, mobile and TV clients all show
' the same Daily Spotlight.
function DailyScore(dayStr as string, wallpaperId as integer) as double
    seed = Fnv1a32(dayStr + "|", FnvOffsetBasis())
    return AvalancheScore(Fnv1a32(StrI(wallpaperId).Trim(), seed))
end function

' ─── DAILY SPOTLIGHT ──────────────────────────────────────────────────

' Highest-scoring wallpaper for a UTC day.  Ties break to the lowest id, exactly
' like src/database.py::get_daily_wallpaper.
function ComputeDailySpotlight(allItems as object, dayStr as string) as object
    if allItems = invalid or allItems.Count() = 0 then return invalid

    ' The date prefix is identical for every row, so hash it once.
    seed = Fnv1a32(dayStr + "|", FnvOffsetBasis())

    winner = invalid
    winnerId = 0
    bestScore = -1.0

    total = allItems.Count()
    for i = 0 to total - 1
        item = allItems[i]
        if item <> invalid
            itemId = SafeInt(item.id, 0)
            score = AvalancheScore(Fnv1a32(StrI(itemId).Trim(), seed))
            if score > bestScore or (score = bestScore and (winner = invalid or itemId < winnerId))
                bestScore = score
                winner = item
                winnerId = itemId
            end if
        end if
    end for

    if winner = invalid and total > 0 then winner = allItems[0]
    return winner
end function

' Daily pick with a per-day registry cache.
'
' The full scan is ~7,500 hash rounds; on a streaming stick that is a few
' hundred milliseconds of a launch budget Roku caps at 15 seconds
' (certification 3.2).  Caching the winner per day means it is paid once per
' device per day instead of on every launch.  The cache key includes the
' catalog size so an app update that adds wallpapers recomputes the pick.
function GetDailySpotlightWallpaper(allItems as object) as object
    if allItems = invalid or allItems.Count() = 0 then return invalid

    now = CreateObject("roDateTime")
    dayStr = GetDayString(now)
    total = allItems.Count()

    section = CreateObject("roRegistrySection", "SpotlightStudio_Cache")
    cacheKey = "daily_" + dayStr
    if section <> invalid
        if section.Exists(cacheKey)
            cached = SafeStr(section.Read(cacheKey))
            parts = SplitString(cached, "|")
            if parts.Count() = 2
                if SafeInt(Val(parts[0]), -1) = total
                    cachedId = Val(parts[1])
                    idx = FindWallpaperIndex(allItems, StrI(CInt(cachedId)).Trim())
                    if idx >= 0
                        LogDebug("Daily Spotlight served from cache: id " + StrI(CInt(cachedId)).Trim())
                        return allItems[idx]
                    end if
                end if
            end if
        end if
    end if

    timer = CreateObject("roTimespan")
    timer.Mark()
    winner = ComputeDailySpotlight(allItems, dayStr)
    LogInfo("Daily Spotlight computed in " + StrI(timer.TotalMilliseconds()).Trim() + "ms: " + WallpaperTitle(winner))

    if winner <> invalid and section <> invalid
        section.Write(cacheKey, StrI(total).Trim() + "|" + SafeStr(winner.id))
        section.Flush()
    end if
    return winner
end function

' ─── PARITY SELF-TEST ─────────────────────────────────────────────────
' Vectors generated by src/utils.py::daily_score.  Run this after touching any
' hashing code; a mismatch means the TV client has drifted from the web,
' desktop and mobile clients.  Only executes on sideloaded dev builds.

function RunDailyHashSelfTest() as boolean
    expected = [
        { day: "2026-10-21", id: 1, score: 1924541016.0 },
        { day: "2026-10-21", id: 2, score: 3316362202.0 },
        { day: "2026-10-21", id: 42, score: 3176467012.0 },
        { day: "2026-10-21", id: 100, score: 3719398381.0 },
        { day: "2026-10-21", id: 7493, score: 3783034881.0 },
        { day: "2024-01-01", id: 1, score: 438587365.0 }
    ]

    ok = true
    for each vector in expected
        actual = DailyScore(vector.day, vector.id)
        if actual <> vector.score
            ok = false
            LogInfo("HASH PARITY FAIL " + SafeStr(vector.day) + " id=" + SafeStr(vector.id) + " expected=" + SafeStr(vector.score) + " actual=" + SafeStr(actual))
        end if
    end for

    if ok
        LogInfo("Hash parity self-test passed (" + StrI(expected.Count()).Trim() + " vectors)")
    end if
    return ok
end function
