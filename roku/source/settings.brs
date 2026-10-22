' Spotlight Studio for Roku
' settings.brs - Persistent user preferences backed by roRegistrySection.
'
' The registry survives channel updates and reboots but is wiped by an
' uninstall, which is exactly what certification requirement 4.1 asks for
' (updates must persist saved data without re-linking).

function CreateSettingsManager() as object
    settings = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_Settings"),
        cache: {},

        Defaults: function() as object
            return {
                ' Profile
                title: "Guest",

                ' Appearance
                activeThemeName: "Obsidian Slate",
                clockFormat: "auto",
                safeAreaGuides: "off",
                soundEffects: "1",

                ' Content
                sortOrder: "newest",
                activeCategory: "All",
                activeResolution: "All",
                activeSource: "All",
                activeTag: "",
                favoritesOnly: "0",
                searchQuery: "",
                ambientInterval: "30",

                ' Network
                imageBase: "https://media.githubusercontent.com/media/KetanDutt/SpotlightStudio/main",

                ' Resume: where the user left off.
                lastActiveTab: "0",
                lastPage: "0",
                lastGridIdx: "0",
                lastWallpaperId: "0",

                ' Home-screen theme automation (see theme_manager.brs).
                homeWallpaperId: "0",
                ssWallpaperId: "0",
                autoSwitchEnabled: "0",
                autoSwitchInterval: "3600",
                autoSwitchTarget: "both",
                autoSwitchPool: "all"
            }
        end function,

        Load: function() as object
            defaults = m.Defaults()
            result = {}
            if m.section = invalid
                ' No registry access (extremely rare): run on defaults so the
                ' channel still starts instead of dying on a null section.
                for each key in defaults
                    result[key] = defaults[key]
                end for
                m.cache = result
                return result
            end if

            for each key in defaults
                fallback = defaults[key]
                if m.section.Exists(key)
                    stored = m.section.Read(key)
                    if stored <> invalid and stored <> ""
                        result[key] = stored
                    else
                        result[key] = fallback
                    end if
                else
                    result[key] = fallback
                end if
            end for

            m.cache = result
            return result
        end function,

        Save: function(key as string, value as string) as void
            m.cache[key] = value
            if m.section <> invalid
                m.section.Write(key, value)
                m.section.Flush()
            end if
        end function,

        GetStr: function(key as string, fallback as string) as string
            if m.cache.DoesExist(key) then return SafeStr(m.cache[key])
            return fallback
        end function,

        GetInt: function(key as string, fallback as integer) as integer
            if m.cache.DoesExist(key)
                ' Val() yields a Float; CInt keeps the value an Integer so
                ' StrI() and array indexing never see "30.0".
                return CInt(Val(SafeStr(m.cache[key])))
            end if
            return fallback
        end function,

        GetBool: function(key as string, fallback as boolean) as boolean
            if m.cache.DoesExist(key) then return Val(SafeStr(m.cache[key])) = 1
            return fallback
        end function
    }
    settings.Load()
    return settings
end function
