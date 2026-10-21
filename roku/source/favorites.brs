' Spotlight Studio for Roku
' favorites.brs - Persistent favourite wallpapers.
'
' Stored as one comma-separated id list.  A single registry value keeps the
' write count at one per toggle and survives app updates.  The list is capped
' because a Roku registry section is size-limited; hitting the cap drops the
' oldest favourite rather than failing the write.

function CreateFavoriteManager() as object
    favMgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_Favorites"),
        favMap: {},
        order: [],
        maxFavorites: 400,

        Load: function() as void
            m.favMap = {}
            m.order = []
            if m.section = invalid then return
            if not m.section.Exists("ids") then return

            data = SafeStr(m.section.Read("ids"))
            if data = "" then return

            parts = SplitString(data, ",")
            for each part in parts
                trimmed = SafeStr(part)
                if trimmed <> ""
                    idVal = Val(trimmed)
                    if idVal > 0
                        key = StrI(CInt(idVal)).Trim()
                        if not m.favMap.DoesExist(key)
                            m.favMap[key] = true
                            m.order.Push(key)
                        end if
                    end if
                end if
            end for
        end function,

        Persist: function() as void
            if m.section = invalid then return
            joined = ""
            for each key in m.order
                if joined <> "" then joined = joined + ","
                joined = joined + key
            end for
            m.section.Write("ids", joined)
            m.section.Flush()
        end function,

        IsFavorite: function(wallpaperId as dynamic) as boolean
            if wallpaperId = invalid then return false
            return m.favMap.DoesExist(SafeStr(wallpaperId))
        end function,

        ' Toggle a favourite.  Returns the new state so the caller can raise a
        ' matching toast.
        Toggle: function(wallpaperId as dynamic) as boolean
            if wallpaperId = invalid then return false
            key = SafeStr(wallpaperId)
            if key = "" then return false

            if m.favMap.DoesExist(key)
                m.favMap.Delete(key)
                m.RemoveOrderKey(key)
                m.Persist()
                return false
            end if

            m.favMap[key] = true
            m.order.Push(key)
            while m.order.Count() > m.maxFavorites
                oldest = m.order.Shift()
                if oldest <> invalid then m.favMap.Delete(oldest)
            end while
            m.Persist()
            return true
        end function,

        RemoveOrderKey: function(key as string) as void
            idx = 0
            while idx < m.order.Count()
                if m.order[idx] = key
                    m.order.Delete(idx)
                    return
                end if
                idx = idx + 1
            end while
        end function,

        Count: function() as integer
            return m.order.Count()
        end function,

        GetIds: function() as object
            result = []
            for each key in m.order
                result.Push(Val(key))
            end for
            return result
        end function,

        ClearAll: function() as void
            m.favMap = {}
            m.order = []
            m.Persist()
        end function
    }
    favMgr.Load()
    return favMgr
end function
