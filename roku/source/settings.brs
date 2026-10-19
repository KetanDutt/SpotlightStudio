' Spotlight Studio for Roku
' settings.brs - Registry persistence for application settings and display configurations

function CreateSettingsManager() as object
    mgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_Settings"),
        
        ' Current settings with default values
        ambientInterval: 10,       ' 5, 10, 15, 30, 60, 300 seconds
        ambientClock: true,        ' show clock in ambient screensaver
        ambientInfo: true,         ' show wallpaper details in ambient screensaver
        viewerZoom: "fit",         ' "fit" (letterbox) or "fill" (crop 16:9)
        safeArea: "off",           ' "off", "action_90", "title_80"
        soundEnabled: true,        ' sound effects
        imageBase: "",             ' custom image base URL (empty = default GitHub CDN)
        clockFormat: "auto",       ' "auto" (use Roku device setting), "12h" (12-hour AM/PM), "24h" (24-hour military)
        sortOrder: "newest",       ' "newest", "oldest", "quality", "title", "random"
        
        Init: function()
            if m.section = invalid then return invalid
            
            ' 1. ambientInterval
            if m.section.Exists("ambient_interval")
                val = Val(m.section.Read("ambient_interval"))
                if val >= 5 and val <= 600 then m.ambientInterval = val
            end if
            
            ' 2. ambientClock
            if m.section.Exists("ambient_clock")
                m.ambientClock = (m.section.Read("ambient_clock") = "true")
            end if
            
            ' 3. ambientInfo
            if m.section.Exists("ambient_info")
                m.ambientInfo = (m.section.Read("ambient_info") = "true")
            end if
            
            ' 4. viewerZoom
            if m.section.Exists("viewer_zoom")
                z = m.section.Read("viewer_zoom")
                if z = "fill" or z = "fit" then m.viewerZoom = z
            end if
            
            ' 5. safeArea
            if m.section.Exists("safe_area")
                sa = m.section.Read("safe_area")
                if sa = "action_90" or sa = "title_80" or sa = "off" then m.safeArea = sa
            end if
            
            ' 6. soundEnabled
            if m.section.Exists("sound_enabled")
                m.soundEnabled = (m.section.Read("sound_enabled") = "true")
            end if
            
            ' 7. imageBase
            if m.section.Exists("image_base")
                m.imageBase = m.section.Read("image_base")
            end if
            
            ' 8. clockFormat
            if m.section.Exists("clock_format")
                cf = m.section.Read("clock_format")
                if cf = "12h" or cf = "24h" or cf = "auto" then m.clockFormat = cf
            end if
            
            ' 9. sortOrder
            if m.section.Exists("sort_order")
                so = m.section.Read("sort_order")
                if so = "newest" or so = "oldest" or so = "quality" or so = "title" or so = "random" then m.sortOrder = so
            end if
        end function,
        
        Save: function()
            if m.section = invalid then return invalid
            m.section.Write("ambient_interval", StrI(m.ambientInterval).Trim())
            m.section.Write("ambient_clock", m.BoolToStr(m.ambientClock))
            m.section.Write("ambient_info", m.BoolToStr(m.ambientInfo))
            m.section.Write("viewer_zoom", m.viewerZoom)
            m.section.Write("safe_area", m.safeArea)
            m.section.Write("sound_enabled", m.BoolToStr(m.soundEnabled))
            m.section.Write("image_base", m.imageBase)
            m.section.Write("clock_format", m.clockFormat)
            m.section.Write("sort_order", m.sortOrder)
            m.section.Flush()
        end function,
        
        BoolToStr: function(b as boolean) as string
            if b then return "true"
            return "false"
        end function,
        
        ResetDefaults: function()
            m.ambientInterval = 10
            m.ambientClock = true
            m.ambientInfo = true
            m.viewerZoom = "fit"
            m.safeArea = "off"
            m.soundEnabled = true
            m.imageBase = ""
            m.clockFormat = "auto"
            m.sortOrder = "newest"
            m.Save()
        end function
    }
    mgr.Init()
    return mgr
end function
