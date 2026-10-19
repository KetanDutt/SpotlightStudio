' Spotlight Studio for Roku
' catalog.brs - Catalog loading, filtering, searching and daily spotlight algorithms

function LoadCatalog() as object
    print "[SpotlightStudio] Loading catalog from pkg:/assets/catalog.json..."
    
    t0 = CreateObject("roTimespan")
    t0.Mark()
    
    jsonStr = ReadAsciiFile("pkg:/assets/catalog.json")
    if jsonStr = invalid or jsonStr = ""
        print "[SpotlightStudio] Error: Could not read pkg:/assets/catalog.json"
        return []
    end if
    
    items = ParseJson(jsonStr)
    if items = invalid or type(items) <> "roArray"
        print "[SpotlightStudio] Error: ParseJson failed on catalog.json"
        return []
    end if
    
    print "[SpotlightStudio] Catalog loaded: " + StrI(items.Count()) + " wallpapers in " + StrI(t0.TotalMilliseconds()) + "ms"
    return items
end function

function FilterWallpapers(allItems as object, category as string, resolutionFilter as string, sourceFilter as string, searchQuery as string, onlyFavorites as boolean, favMgr as object, sortOrder as string) as object
    if allItems = invalid then return []
    
    if sortOrder = invalid or sortOrder = "" then sortOrder = "newest"
    
    ' Fast-path: return allItems directly when no filter is applied and default sort (avoids copying 7,500 items)
    hasSearch = (searchQuery <> invalid and searchQuery <> "")
    hasCategory = (category <> invalid and category <> "" and category <> "All" and category <> "Favorites" and category <> "Daily")
    hasRes = (resolutionFilter <> invalid and resolutionFilter <> "All" and resolutionFilter <> "")
    hasSource = (sourceFilter <> invalid and sourceFilter <> "All" and sourceFilter <> "")
    if not hasSearch and not hasCategory and not hasRes and not hasSource and not onlyFavorites and sortOrder = "newest"
        return allItems
    end if
    
    result = []
    qLower = ""
    if hasSearch then qLower = LCase(searchQuery)
    
    tagFilterLower = ""
    if hasCategory then tagFilterLower = LCase(category)
    
    for each item in allItems
        include = true
        
        ' 1. Only favorites check
        if onlyFavorites
            if favMgr = invalid or not favMgr.IsFavorite(item.id)
                include = false
            end if
        end if
        
        ' 2. Resolution check
        if include and resolutionFilter <> invalid and resolutionFilter <> "All"
            q = item.quality
            if q <> invalid
                if resolutionFilter = "4K" and Instr(1, q, "4K") = 0
                    include = false
                else if resolutionFilter = "FHD" and Instr(1, q, "FHD") = 0
                    include = false
                end if
            end if
        end if
        
        ' 3. Source check
        if include and sourceFilter <> invalid and sourceFilter <> "All"
            src = item.source
            if src <> invalid
                if sourceFilter = "peapix" and src <> "peapix"
                    include = false
                else if sourceFilter = "win10spotlight" and src <> "win10spotlight"
                    include = false
                end if
            end if
        end if
        
        ' 4. Category / Tag check
        if include and tagFilterLower <> ""
            itemTags = ""
            if item.tags <> invalid then itemTags = LCase(item.tags)
            itemTitle = ""
            if item.title <> invalid then itemTitle = LCase(item.title)
            
            if Instr(1, itemTags, tagFilterLower) = 0 and Instr(1, itemTitle, tagFilterLower) = 0
                include = false
            end if
        end if
        
        ' 5. Search query check
        if include and qLower <> ""
            itemTags = ""
            if item.tags <> invalid then itemTags = LCase(item.tags)
            itemTitle = ""
            if item.title <> invalid then itemTitle = LCase(item.title)
            
            if Instr(1, itemTitle, qLower) = 0 and Instr(1, itemTags, qLower) = 0
                include = false
            end if
        end if
        
        if include then result.Push(item)
    end for
    
    ' Apply sortOrder
    if sortOrder = "oldest"
        reversed = []
        for idx = result.Count() - 1 to 0 step -1
            reversed.Push(result[idx])
        end for
        return reversed
    else if sortOrder = "quality"
        fourK = []
        other = []
        for each itm in result
            if itm.quality <> invalid and Instr(1, itm.quality, "4K") > 0
                fourK.Push(itm)
            else
                other.Push(itm)
            end if
        end for
        fourK.Append(other)
        return fourK
    else if sortOrder = "random"
        shuffled = []
        shuffled.Append(result)
        cnt = shuffled.Count()
        if cnt > 1
            for idx = cnt - 1 to 1 step -1
                j = Rnd(idx + 1) - 1
                tmp = shuffled[idx]
                shuffled[idx] = shuffled[j]
                shuffled[j] = tmp
            end for
        end if
        return shuffled
    end if
    
    return result
end function

function Xor32(a as integer, b as integer) as integer
    return (a or b) - (a and b)
end function

function Mul32(a as integer, b as integer) as integer
    aInt = a and &hFFFFFFFF
    bInt = b and &hFFFFFFFF
    ah = (aInt >> 16) and &hFFFF
    al = aInt and &hFFFF
    bh = (bInt >> 16) and &hFFFF
    bl = bInt and &hFFFF
    low = (al * bl) and &hFFFFFFFF
    mid = (((ah * bl) and &hFFFFFFFF) + ((al * bh) and &hFFFFFFFF) + ((low >> 16) and &hFFFF)) and &hFFFF
    return (mid << 16) or (low and &hFFFF)
end function

' Deterministic UTC Daily Spotlight calculation matching web and native clients
function GetDailySpotlightWallpaper(allItems as object) as object
    if allItems = invalid or allItems.Count() = 0 then return invalid
    
    now = CreateObject("roDateTime")
    dayStr = GetDayString(now) ' e.g. "2026-10-17"
    
    winner = invalid
    bestScore = -1.0
    
    total = allItems.Count()
    for i = 0 to total - 1
        item = allItems[i]
        key = dayStr + "|" + StrI(item.id).Trim()
        
        ' 32-bit FNV-1a hash
        h = -2128831035 ' 2166136261 as 32-bit signed integer
        keyLen = Len(key)
        for k = 1 to keyLen
            c = Asc(Mid(key, k, 1))
            h = Mul32(Xor32(h, c), 16777619)
        end for
        
        ' Double avalanche permutations to scramble sequential IDs
        h = Mul32(Xor32(h, ((h >> 16) and &hFFFF)), 2146121005) ' 0x7feb352d
        h = Mul32(Xor32(h, ((h >> 15) and &h1FFFF)), -2073254261) ' 0x846ca68b
        rawScore = Xor32(h, ((h >> 16) and &hFFFF))
        
        ' Convert 32-bit signed rawScore to unsigned double (0 to 4294967295)
        if rawScore < 0
            score = 4294967296.0 + CDbl(rawScore)
        else
            score = CDbl(rawScore)
        end if
        
        if score > bestScore or (score = bestScore and (winner = invalid or item.id < winner.id))
            bestScore = score
            winner = item
        end if
    end for
    
    if winner = invalid and total > 0 then winner = allItems[0]
    return winner
end function

