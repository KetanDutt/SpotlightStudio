' Spotlight Studio for Roku
' favorites.brs - Registry persistence and management for user favorites

function CreateFavoritesManager() as object
    mgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_Favorites"),
        map: {},
        
        Init: function()
            m.map = {}
            if m.section <> invalid
                keys = m.section.GetKeyList()
                if keys <> invalid
                    for each k in keys
                        m.map[k] = true
                    end for
                end if
            end if
        end function,
        
        IsFavorite: function(itemOrId as dynamic) as boolean
            if itemOrId = invalid then return false
            t = type(itemOrId)
            if t = "roAssociativeArray"
                if itemOrId.id <> invalid
                    return m.IsFavorite(itemOrId.id)
                end if
                return false
            end if
            key = ToString(itemOrId)
            return m.map.DoesExist(key) and m.map[key] = true
        end function,
        
        ToggleFavorite: function(item as object) as boolean
            if item = invalid or item.id = invalid then return false
            key = ToString(item.id)
            
            if m.IsFavorite(key)
                m.map.Delete(key)
                if m.section <> invalid
                    m.section.Delete(key)
                    m.section.Flush()
                end if
                return false
            else
                m.map[key] = true
                if m.section <> invalid
                    title = "Spotlight Wallpaper"
                    if item.title <> invalid and item.title <> "" then title = item.title
                    m.section.Write(key, title)
                    m.section.Flush()
                end if
                return true
            end if
        end function,
        
        GetCount: function() as integer
            count = 0
            for each k in m.map
                if m.map[k] = true then count = count + 1
            end for
            return count
        end function,
        
        ClearAll: function()
            if m.section <> invalid
                keys = m.section.GetKeyList()
                if keys <> invalid
                    for each k in keys
                        m.section.Delete(k)
                    end for
                    m.section.Flush()
                end if
            end if
            m.map = {}
        end function
    }
    mgr.Init()
    return mgr
end function
