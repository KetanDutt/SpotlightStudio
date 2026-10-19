' Spotlight Studio for Roku
' theme_manager.brs - Roku home-screen theme changer, wallpaper setter, and auto-rotation engine

function CreateThemeManager(licenseMgr as object) as object
    mgr = {
        licenseMgr: licenseMgr,
        section: CreateObject("roRegistrySection", "SpotlightStudio_Themes"),
        appManager: CreateObject("roAppManager"),
        
        ' Active settings
        activeThemeName: "Obsidian Glass",
        homeWallpaper: invalid,
        screensaverWallpaper: invalid,
        
        ' Automatic switching
        autoSwitchEnabled: false,
        autoSwitchInterval: 300, ' 60s, 300s (5m), 900s (15m), 1800s (30m), 3600s (1h), 86400s (daily)
        autoSwitchTarget: "both", ' "both", "wallpaper", "screensaver"
        autoSwitchPool: "all",    ' "all", "favorites", "4k", "daily"
        
        ' Palettes
        palettes: [
            {
                name: "Obsidian Glass",
                desc: "Liquid Glass dark obsidian with electric cyan highlights",
                bgHex: "#08090E",
                accentHex: "#00E5FF",
                btnHex: "#00D2FF"
            },
            {
                name: "Sunset Amber",
                desc: "Warm twilight glow with deep golden amber accents",
                bgHex: "#120B08",
                accentHex: "#FF9E00",
                btnHex: "#FFD166"
            },
            {
                name: "Nordic Glacier",
                desc: "Frosted polar blue with clean crystalline white tones",
                bgHex: "#080E14",
                accentHex: "#00B4D8",
                btnHex: "#90E0EF"
            },
            {
                name: "Emerald Forest",
                desc: "Lush botanical deep green with vibrant mint highlights",
                bgHex: "#07120C",
                accentHex: "#10B981",
                btnHex: "#34D399"
            },
            {
                name: "Cosmic Violet",
                desc: "Deep neon space violet with vivid magenta glow",
                bgHex: "#0E0814",
                accentHex: "#A855F7",
                btnHex: "#EC4899"
            }
        ],
        
        Init: function()
            if m.section = invalid then return invalid
            
            if m.section.Exists("active_theme_name")
                m.activeThemeName = m.section.Read("active_theme_name")
            end if
            if m.section.Exists("auto_switch_enabled")
                m.autoSwitchEnabled = (m.section.Read("auto_switch_enabled") = "true")
            end if
            if m.section.Exists("auto_switch_interval")
                val = Val(m.section.Read("auto_switch_interval"))
                if val >= 10 then m.autoSwitchInterval = val
            end if
            if m.section.Exists("auto_switch_target")
                m.autoSwitchTarget = m.section.Read("auto_switch_target")
            end if
            if m.section.Exists("auto_switch_pool")
                m.autoSwitchPool = m.section.Read("auto_switch_pool")
            end if
            
            ' Apply theme to system
            m.ApplySystemTheme(m.activeThemeName)
        end function,
        
        ApplySystemTheme: function(themeName as string)
            m.activeThemeName = themeName
            palette = m.GetPalette(themeName)
            if palette = invalid or m.appManager = invalid then return invalid
            
            themeAttrs = {
                BackgroundColor: palette.bgHex,
                ButtonNormalColor: palette.bgHex,
                ButtonHighlightColor: palette.btnHex,
                ListScreenDescriptionText: palette.accentHex,
                ThemeType: "Dark"
            }
            m.appManager.SetTheme(themeAttrs)
            
            if m.section <> invalid
                m.section.Write("active_theme_name", themeName)
                m.section.Flush()
            end if
        end function,
        
        GetPalette: function(name as string) as object
            for each p in m.palettes
                if p.name = name then return p
            end for
            return m.palettes[0]
        end function,
        
        SetHomeScreenWallpaper: function(wallpaper as object) as boolean
            ' Check license permission for manual setting
            if not m.licenseMgr.CanChangeWallpaperManually()
                return false
            end if
            
            m.homeWallpaper = wallpaper
            if m.section <> invalid and wallpaper <> invalid
                m.section.Write("home_wallpaper_id", ToString(wallpaper.id))
                m.section.Write("home_wallpaper_filename", wallpaper.filename)
                m.section.Write("home_wallpaper_title", wallpaper.title)
                m.section.Flush()
            end if
            
            ' Also sync roAppManager theme background
            m.ApplySystemTheme(m.activeThemeName)
            return true
        end function,
        
        SetScreensaverWallpaper: function(wallpaper as object) as boolean
            ' Check license permission for manual setting
            if not m.licenseMgr.CanChangeWallpaperManually()
                return false
            end if
            
            m.screensaverWallpaper = wallpaper
            if m.section <> invalid and wallpaper <> invalid
                m.section.Write("screensaver_wallpaper_id", ToString(wallpaper.id))
                m.section.Write("screensaver_wallpaper_filename", wallpaper.filename)
                m.section.Write("screensaver_wallpaper_title", wallpaper.title)
                m.section.Flush()
            end if
            return true
        end function,
        
        ToggleAutoSwitch: function() as boolean
            ' Check subscription permission for automatic switching
            if not m.licenseMgr.CanAutoSwitch()
                return false
            end if
            
            m.autoSwitchEnabled = not m.autoSwitchEnabled
            if m.section <> invalid
                m.section.Write("auto_switch_enabled", m.BoolToStr(m.autoSwitchEnabled))
                m.section.Flush()
            end if
            return m.autoSwitchEnabled
        end function,
        
        SetAutoSwitchInterval: function(seconds as integer)
            m.autoSwitchInterval = seconds
            if m.section <> invalid
                m.section.Write("auto_switch_interval", StrI(seconds).Trim())
                m.section.Flush()
            end if
        end function,
        
        BoolToStr: function(b as boolean) as string
            if b then return "true"
            return "false"
        end function
    }
    mgr.Init()
    return mgr
end function
