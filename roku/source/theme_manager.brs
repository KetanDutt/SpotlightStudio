' Spotlight Studio for Roku
' theme_manager.brs - Theme Studio state: palette, ambient wallpaper, backdrop
'                     and automatic rotation.
'
' SCOPE NOTE (important, and the reason the previous version was misleading):
' Roku does not let a channel change the device home-screen wallpaper or the
' system screensaver.  Certification requirement 4.5 explicitly prohibits apps
' from overriding or interfering with Roku's system screensaver, and only
' standalone screensaver apps may ship one at all (see docs/roku/CERTIFICATION.md
' and the separate roku-screensaver/ package this repo can build).
'
' Theme Studio therefore controls things the channel genuinely owns:
'   * the Liquid Glass palette applied to every screen of this app;
'   * the wallpaper Ambient Mode opens on and rotates through;
'   * the backdrop image drawn behind the gallery chrome;
'   * automatic rotation of those, with a selectable pool and interval.
' roAppManager.SetTheme() is still called (best effort) so any OS-drawn sheet,
' such as the Roku Pay purchase dialog, picks up a matching accent.

function CreateThemeManager(settingsMgr as object, favMgr as object) as object
    mgr = {
        settingsMgr: settingsMgr,
        favMgr: favMgr,
        appManager: CreateObject("roAppManager"),

        activeThemeName: "",
        ambientWallpaperId: 0,
        backdropWallpaperId: 0,

        autoSwitchEnabled: false,
        autoSwitchInterval: 3600,
        autoSwitchTarget: "both",
        autoSwitchPool: "all",

        Load: function() as void
            sm = m.settingsMgr
            m.activeThemeName = sm.GetStr("activeThemeName", "Obsidian Slate")
            m.ambientWallpaperId = sm.GetInt("homeWallpaperId", 0)
            m.backdropWallpaperId = sm.GetInt("ssWallpaperId", 0)
            m.autoSwitchEnabled = sm.GetBool("autoSwitchEnabled", false)
            m.autoSwitchInterval = sm.GetInt("autoSwitchInterval", 3600)
            m.autoSwitchTarget = sm.GetStr("autoSwitchTarget", "both")
            m.autoSwitchPool = sm.GetStr("autoSwitchPool", "all")

            ' Legacy registry values may name a palette that no longer exists.
            if m.PaletteIndex(m.activeThemeName) < 0
                m.activeThemeName = SafeStr(GetPaletteList()[0].name)
                m.PersistThemeName()
            end if
        end function,

        PersistThemeName: function() as void
            m.settingsMgr.Save("activeThemeName", m.activeThemeName)
        end function,

        PaletteIndex: function(name as string) as integer
            names = GetPaletteNames()
            for i = 0 to names.Count() - 1
                if names[i] = name then return i
            end for
            return -1
        end function,

        GetThemeNames: function() as object
            return GetPaletteNames()
        end function,

        GetPalette: function(name as string) as object
            return GetPaletteByName(name)
        end function,

        ' Apply a palette by name.  Returns false for an unknown name instead of
        ' silently falling back, so the caller can tell the user.
        SetThemeByName: function(name as string) as boolean
            if m.PaletteIndex(name) < 0
                LogDebug("Rejected unknown palette: " + SafeStr(name))
                return false
            end if

            m.activeThemeName = name
            m.PersistThemeName()
            m.ApplyTheme()
            return true
        end function,

        ' Push the active palette into the canvas theme and the OS chrome.
        ApplyTheme: function() as void
            palette = GetPaletteByName(m.activeThemeName)
            ApplyThemePalette(SafeStr(palette.name))

            if m.appManager <> invalid
                attrs = {
                    "GlobalBackgroundColor": SafeStr(palette.bgHex),
                    "BackgroundColor": SafeStr(palette.panelHex),
                    "ButtonNormalColor": SafeStr(palette.panelLightHex),
                    "ButtonFocusedColor": SafeStr(palette.btnHex),
                    "FocusRingColor": SafeStr(palette.focusHex)
                }
                m.appManager.SetTheme(attrs)
            end if
        end function,

        CycleTheme: function(direction as integer) as string
            names = m.GetThemeNames()
            m.activeThemeName = CycleOption(names, m.activeThemeName, direction)
            m.PersistThemeName()
            m.ApplyTheme()
            return m.activeThemeName
        end function,

        ' ── ambient / backdrop wallpapers ────────────────────────────────

        SetAmbientWallpaper: function(item as object) as boolean
            if item = invalid then return false
            m.ambientWallpaperId = SafeInt(item.id, 0)
            m.settingsMgr.Save("homeWallpaperId", StrI(m.ambientWallpaperId).Trim())
            return m.ambientWallpaperId <> 0
        end function,

        SetBackdropWallpaper: function(item as object) as boolean
            if item = invalid then return false
            m.backdropWallpaperId = SafeInt(item.id, 0)
            m.settingsMgr.Save("ssWallpaperId", StrI(m.backdropWallpaperId).Trim())
            return m.backdropWallpaperId <> 0
        end function,

        ' ── automatic rotation ───────────────────────────────────────────

        SetAutoSwitchEnabled: function(enabled as boolean) as void
            m.autoSwitchEnabled = enabled
            m.settingsMgr.Save("autoSwitchEnabled", m.Flag(enabled))
        end function,

        SetAutoSwitchInterval: function(seconds as integer) as void
            m.autoSwitchInterval = seconds
            m.settingsMgr.Save("autoSwitchInterval", StrI(seconds).Trim())
        end function,

        SetAutoSwitchTarget: function(target as string) as void
            m.autoSwitchTarget = target
            m.settingsMgr.Save("autoSwitchTarget", target)
        end function,

        SetAutoSwitchPool: function(pool as string) as void
            m.autoSwitchPool = pool
            m.settingsMgr.Save("autoSwitchPool", pool)
        end function,

        Flag: function(value as boolean) as string
            if value then return "1"
            return "0"
        end function,

        AutoSwitchTargetOptions: function() as object
            return ["both", "ambient", "backdrop"]
        end function,

        AutoSwitchTargetLabel: function() as string
            labels = { "both": "Ambient + Backdrop", "ambient": "Ambient Wallpaper", "backdrop": "Backdrop Wallpaper" }
            return LabelFor(labels, m.autoSwitchTarget)
        end function,

        AutoSwitchPoolOptions: function() as object
            return ["all", "landscape", "4k", "favorites", "daily"]
        end function,

        AutoSwitchPoolLabel: function() as string
            labels = {
                "all": "Full Archive",
                "landscape": "Landscape Tag",
                "4k": "4K UHD Only",
                "favorites": "My Favorites",
                "daily": "Today's Daily Pick"
            }
            return LabelFor(labels, m.autoSwitchPool)
        end function,

        ' Build the rotation pool from the current filter state.  Kept here so
        ' the Ambient view and the rotation timer share one implementation.
        BuildRotationPool: function(allItems as object) as object
            pool = []
            if allItems = invalid then return pool

            mode = m.autoSwitchPool
            if mode = "daily"
                daily = ComputeDailySpotlight(allItems, GetDayString(CreateObject("roDateTime")))
                if daily <> invalid then pool.Push(daily)
                return pool
            end if

            ' The favourites pool is small, so cap the scan of the big pools.
            limit = allItems.Count()
            if limit > 400 then limit = 400

            for i = 0 to limit - 1
                item = allItems[i]
                if item <> invalid
                    include = true
                    if mode = "4k" then include = IsUltraHd(item)
                    if mode = "landscape" then include = ContainsCI(SafeStr(item.tags), "landscape")
                    if mode = "favorites"
                        include = false
                        if m.favMgr <> invalid then include = m.favMgr.IsFavorite(item.id)
                    end if
                    if include then pool.Push(item)
                end if
            end for

            if pool.Count() = 0 and allItems.Count() > 0 then pool.Push(allItems[0])
            return pool
        end function
    }

    mgr.Load()
    return mgr
end function
