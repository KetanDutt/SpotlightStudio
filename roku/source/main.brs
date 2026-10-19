' Spotlight Studio for Roku
' main.brs - Application lifecycle, state machine, event dispatcher, IAP store and render loop

sub Main(args = invalid as dynamic)
    print "[SpotlightStudio] Starting Spotlight Studio on Roku..."
    
    ' 1. Initialize Screen and Message Port
    screen = CreateObject("roScreen", true, 1920, 1080)
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    screen.SetAlphaEnable(true)
    
    ' 2. Initialize Core Services and Device Info
    appInfo = CreateObject("roAppInfo")
    deviceInfo = CreateObject("roDeviceInfo")
    fontsRegistry = CreateObject("roFontRegistry")
    timespan = CreateObject("roTimespan")
    clock = CreateObject("roTimespan")
    ambientClock = CreateObject("roTimespan")
    toastClock = CreateObject("roTimespan")
    autoSwitchTimer = CreateObject("roTimespan")
    now = CreateObject("roDateTime")
    
    clock.Mark()
    ambientClock.Mark()
    autoSwitchTimer.Mark()
    
    ' Fonts
    fonts = {
        title: fontsRegistry.GetDefaultFont(44, false, true),
        heading: fontsRegistry.GetDefaultFont(30, false, true),
        body: fontsRegistry.GetDefaultFont(22, false, false),
        caption: fontsRegistry.GetDefaultFont(18, false, false),
        small: fontsRegistry.GetDefaultFont(15, false, false)
    }
    
    ' 3. Initialize Settings, Favorites, License, Store & Theme Managers
    settingsMgr = CreateSettingsManager()
    favMgr = CreateFavoritesManager()
    licenseMgr = CreateLicenseManager()
    storeMgr = CreateStoreManager(port, licenseMgr)
    themeMgr = CreateThemeManager(licenseMgr)
    imageLoader = CreateImageLoader(port, settingsMgr)
    
    ' 4. Load Catalog
    allWallpapers = LoadCatalog()
    
    ' 5. Compute Daily Spotlight
    dailyWallpaper = GetDailySpotlightWallpaper(allWallpapers)
    if dailyWallpaper <> invalid
        print "[SpotlightStudio] Today's Daily Spotlight: " + dailyWallpaper.title + " (ID: " + StrI(dailyWallpaper.id).Trim() + ")"
    end if
    
    ' 6. App State
    state = {
        screen: screen,
        fonts: fonts,
        appInfo: appInfo,
        deviceInfo: deviceInfo,
        settingsMgr: settingsMgr,
        favMgr: favMgr,
        licenseMgr: licenseMgr,
        storeMgr: storeMgr,
        themeMgr: themeMgr,
        imageLoader: imageLoader,
        spinnerAngle: 0,
        allWallpapers: allWallpapers,
        filtered: allWallpapers,
        dailyWallpaper: dailyWallpaper,
        
        ' UI Views: "gallery", "viewer", "daily", "ambient", "screensavers", "theme", "store", "settings"
        viewMode: "gallery",
        
        ' Navigation & Focus
        ' 0: Gallery, 1: Daily Pick, 2: Screensavers, 3: Favorites, 4: Categories, 5: Theme Studio, 6: Pro Store, 7: Settings
        activeTab: 0,
        focusArea: "grid",       ' "nav", "grid"
        navIdx: 0,
        gridIdx: 0,
        currentPage: 0,
        
        ' Active Filters & Sorting
        activeCategory: "All",
        activeResolution: "All", ' "All", "4K", "FHD"
        activeSource: "All",     ' "All", "peapix", "win10spotlight"
        activeSortOrder: settingsMgr.sortOrder,
        searchQuery: "",
        onlyFavorites: false,
        isFilterDialogVisible: false,
        filterRowIdx: 0,
        
        ' Screensaver Gallery View
        screensaverList: allWallpapers,
        ssCurrentPage: 0,
        ssGridIdx: 0,
        ssFocusArea: "grid",
        
        ' Theme Studio View
        themeActionIdx: 0,
        
        ' Pro Store View
        storeCardIdx: 0,
        
        ' Fullscreen Viewer
        currentWallpaper: dailyWallpaper,
        viewerIdx: 0,
        isHudVisible: true,
        hudTimer: CreateObject("roTimespan"),
        isSlideshowActive: false,
        slideshowTimer: CreateObject("roTimespan"),
        
        ' Daily Spotlight View Button Index
        dailyBtnIdx: 0,
        
        ' Ambient Screensaver
        ambientWallpaper: dailyWallpaper,
        ambientIdx: 0,
        ambientTimer: ambientClock,
        
        ' Settings View Index
        settingsIdx: 0,
        isAboutDialogVisible: false,
        
        ' Diagnostics / Local Device Clock
        clockTime: "",
        clockDate: "",
        clockFull: "",
        displayRes: "1920x1080 FHD",
        
        ' Animation Engine State
        animClock: animClock,
        glowAlpha: 255,
        slideOffset: 0.0,
        toastY: 900.0,
        
        ' Toast notifications
        toastText: "",
        toastTimer: toastClock,
        
        GetCachedThumbnail: function(filename as string) as object
            return m.imageLoader.GetThumbnail(filename)
        end function,
        
        GetCachedFullImage: function(filename as string) as object
            return m.imageLoader.GetFullImage(filename)
        end function,
        
        PrioritizeCurrentPage: function()
            if m.filtered = invalid then return
            startIdx = m.currentPage * 8
            visible = []
            for v = 0 to 7
                idx = startIdx + v
                if idx < m.filtered.Count() then visible.Push(m.filtered[idx])
            end for
            m.imageLoader.PrioritizeVisible(visible)
        end function,
        
        ShowToast: function(text as string)
            m.toastText = text
            m.toastTimer.Mark()
        end function,
        
        ApplyFilters: function()
            m.filtered = FilterWallpapers(m.allWallpapers, m.activeCategory, m.activeResolution, m.activeSource, m.searchQuery, m.onlyFavorites, m.favMgr, m.activeSortOrder)
            m.currentPage = 0
            m.gridIdx = 0
            m.PrioritizeCurrentPage()
        end function
    }
    
    ' Filter curated screensavers for screensaver gallery
    curatedScreensavers = FilterWallpapers(allWallpapers, "Landscape", "All", "All", "", false, favMgr, "newest")
    if curatedScreensavers.Count() >= 6
        state.screensaverList = curatedScreensavers
    else
        state.screensaverList = allWallpapers
    end if
    
    ' Set UI resolution string
    ui = deviceInfo.GetUIResolution()
    if ui <> invalid and ui.name <> invalid
        state.displayRes = ui.name + " (" + StrI(ui.width).Trim() + "x" + StrI(ui.height).Trim() + ")"
    end if
    
    ' Categories list for cycling
    categories = ["All", "Nature", "Landscape", "Water", "Animals", "City", "Mountains", "Sky"]
    catIdx = 0
    
    ' Auto-switch intervals list for cycling
    switchIntervals = [60, 300, 900, 1800, 3600, 86400]
    
    ' Handle Deep Linking if launched via voice, ECP or external trigger
    if args <> invalid
        if args.contentId <> invalid and args.contentId <> ""
            targetId = Val(args.contentId)
            for idx = 0 to allWallpapers.Count() - 1
                wp = allWallpapers[idx]
                if wp.id = targetId or wp.filename = args.contentId
                    state.currentWallpaper = wp
                    state.viewerIdx = idx
                    state.viewMode = "viewer"
                    state.hudTimer.Mark()
                    state.isHudVisible = true
                    exit for
                end if
            end for
        else if args.mediaType = "screensaver" or args.mediaType = "ambient"
            state.viewMode = "ambient"
            state.ambientTimer.Mark()
        else if args.mediaType = "daily"
            state.viewMode = "daily"
        else if args.mediaType = "theme"
            state.viewMode = "theme"
        else if args.mediaType = "store"
            state.viewMode = "store"
        end if
    end if
    
    running = true
    state.PrioritizeCurrentPage()
    
    ' 7. Main Loop
    while running
        ' Advance animated loading spinner angle
        state.spinnerAngle = (state.spinnerAngle + 15) MOD 360
        
        ' Update Device Local Time & Date
        localInfo = GetDeviceLocalTime(deviceInfo, state.settingsMgr.clockFormat)
        state.clockTime = localInfo.time
        state.clockDate = localInfo.date
        state.clockFull = localInfo.full
        
        ' Process Messages (Input, Store & Image Download Events) with 16ms frame pacing
        msg = port.WaitMessage(16)
        while msg <> invalid
            msgType = type(msg)
            
            ' Handle Async Image Download Events
            if msgType = "roUrlEvent"
                state.imageLoader.HandleUrlEvent(msg)
                
            ' Handle IAP Channel Store Events
            else if msgType = "roChannelStoreEvent"
                storeResult = storeMgr.HandleStoreEvent(msg)
                if storeResult <> ""
                    state.ShowToast(storeResult)
                end if
                
            ' Handle Remote Control Input Events
            else if msgType = "roUniversalControlEvent"
                code = msg.GetInt()
                if code < 100 ' Key Press event
                    ' Key mapping:
                    ' 0: Back
                    ' 2: Up
                    ' 3: Down
                    ' 4: Left
                    ' 5: Right
                    ' 6: OK / Select
                    ' 7: Replay
                    ' 8: Rewind
                    ' 9: FastForward
                    ' 10: Info (*)
                    ' 13: Play / Pause
                    
                    ' ── AMBIENT VIEW INPUT ─────────────────────────────────
                    if state.viewMode = "ambient"
                        if code = 4 ' Left - previous wallpaper
                            if state.filtered.Count() > 0
                                state.ambientIdx = (state.ambientIdx - 1 + state.filtered.Count()) MOD state.filtered.Count()
                                state.ambientWallpaper = state.filtered[state.ambientIdx]
                                state.ambientTimer.Mark()
                            end if
                        else if code = 5 ' Right - next wallpaper
                            if state.filtered.Count() > 0
                                state.ambientIdx = (state.ambientIdx + 1) MOD state.filtered.Count()
                                state.ambientWallpaper = state.filtered[state.ambientIdx]
                                state.ambientTimer.Mark()
                            end if
                        else
                            ' Any other key exits ambient mode back to gallery
                            state.viewMode = "gallery"
                            state.activeTab = 0
                            state.focusArea = "grid"
                        end if
                    
                    ' ── FULLSCREEN VIEWER INPUT ────────────────────────────
                    else if state.viewMode = "viewer"
                        state.hudTimer.Mark()
                        state.isHudVisible = true
                        
                        if code = 0 ' Back - Return to gallery
                            state.isSlideshowActive = false
                            state.viewMode = "gallery"
                        else if code = 4 ' Left - Previous
                            if state.viewerIdx > 0
                                state.viewerIdx = state.viewerIdx - 1
                                state.currentWallpaper = state.filtered[state.viewerIdx]
                            end if
                        else if code = 5 ' Right - Next
                            if state.viewerIdx < state.filtered.Count() - 1
                                state.viewerIdx = state.viewerIdx + 1
                                state.currentWallpaper = state.filtered[state.viewerIdx]
                            end if
                        else if code = 6 ' OK - Toggle Favorite
                            if state.currentWallpaper <> invalid
                                isFav = state.favMgr.ToggleFavorite(state.currentWallpaper)
                                if isFav
                                    state.ShowToast("♥ Added to Favorites")
                                else
                                    state.ShowToast("Removed from Favorites")
                                end if
                            end if
                        else if code = 13 ' Play - Toggle Slideshow
                            state.isSlideshowActive = not state.isSlideshowActive
                            state.slideshowTimer.Mark()
                            if state.isSlideshowActive
                                state.ShowToast("▶ Slideshow Started")
                            else
                                state.ShowToast("⏸ Slideshow Paused")
                            end if
                        else if code = 2 ' Up - Toggle Aspect Mode (Fit vs Fill)
                            if state.settingsMgr.viewerZoom = "fit"
                                state.settingsMgr.viewerZoom = "fill"
                            else
                                state.settingsMgr.viewerZoom = "fit"
                            end if
                            state.settingsMgr.Save()
                            state.ShowToast("Aspect Mode: " + UCase(state.settingsMgr.viewerZoom))
                        else if code = 3 or code = 10 ' Down or Info - Toggle HUD
                            state.isHudVisible = not state.isHudVisible
                        else if code = 7 ' Replay - Set as Home Screen Wallpaper
                            if state.currentWallpaper <> invalid
                                if themeMgr.SetHomeScreenWallpaper(state.currentWallpaper)
                                    state.ShowToast("✓ Set as Home Wallpaper: " + TruncateText(state.currentWallpaper.title, 25))
                                else
                                    state.ShowToast("🔒 Trial Expired! Unlock in Pro Store")
                                    state.viewMode = "store"
                                    state.storeCardIdx = 0
                                end if
                            end if
                        else if code = 9 ' FastForward - Set as TV Screensaver
                            if state.currentWallpaper <> invalid
                                if themeMgr.SetScreensaverWallpaper(state.currentWallpaper)
                                    state.ShowToast("✓ Set as TV Screensaver: " + TruncateText(state.currentWallpaper.title, 25))
                                else
                                    state.ShowToast("🔒 Trial Expired! Unlock in Pro Store")
                                    state.viewMode = "store"
                                    state.storeCardIdx = 0
                                end if
                            end if
                        end if
                    
                    ' ── SCREENSAVER GALLERY INPUT ──────────────────────────
                    else if state.viewMode = "screensavers"
                        ssList = state.screensaverList
                        totalSS = ssList.Count()
                        ssPageSize = 6
                        ssTotalPages = MaxI(1, CInt((totalSS + ssPageSize - 1) / ssPageSize))
                        curSSIdx = state.ssCurrentPage * ssPageSize + state.ssGridIdx
                        if curSSIdx >= totalSS then curSSIdx = 0
                        curSSItem = ssList[curSSIdx]
                        
                        if code = 0 ' Back - Return to gallery
                            state.viewMode = "gallery"
                            state.activeTab = 0
                        else if code = 4 ' Left
                            col = state.ssGridIdx MOD 3
                            if col > 0
                                state.ssGridIdx = state.ssGridIdx - 1
                            else if state.ssCurrentPage > 0
                                state.ssCurrentPage = state.ssCurrentPage - 1
                                state.ssGridIdx = state.ssGridIdx + 2
                            end if
                        else if code = 5 ' Right
                            col = state.ssGridIdx MOD 3
                            if col < 2 and (state.ssCurrentPage * 6 + state.ssGridIdx + 1) < totalSS
                                state.ssGridIdx = state.ssGridIdx + 1
                            else if state.ssCurrentPage < ssTotalPages - 1
                                state.ssCurrentPage = state.ssCurrentPage + 1
                                state.ssGridIdx = state.ssGridIdx - 2
                            end if
                        else if code = 2 ' Up
                            if state.ssGridIdx >= 3
                                state.ssGridIdx = state.ssGridIdx - 3
                            else
                                state.viewMode = "gallery"
                                state.focusArea = "nav"
                                state.navIdx = 2
                            end if
                        else if code = 3 ' Down
                            if state.ssGridIdx < 3 and (state.ssCurrentPage * 6 + state.ssGridIdx + 3) < totalSS
                                state.ssGridIdx = state.ssGridIdx + 3
                            end if
                        else if code = 6 ' OK - Lightbox Preview
                            state.currentWallpaper = curSSItem
                            state.viewerIdx = curSSIdx
                            state.viewMode = "viewer"
                            state.hudTimer.Mark()
                            state.isHudVisible = true
                        else if code = 13 ' Play - Launch Ambient Screensaver Now
                            state.ambientWallpaper = curSSItem
                            state.viewMode = "ambient"
                            state.ambientTimer.Mark()
                        else if code = 10 ' Info (*) - Set as Roku TV Screensaver
                            if themeMgr.SetScreensaverWallpaper(curSSItem)
                                state.ShowToast("✓ Set as TV Screensaver: " + TruncateText(curSSItem.title, 25))
                            else
                                state.ShowToast("🔒 Trial Expired! Unlock in Pro Store")
                                state.viewMode = "store"
                                state.storeCardIdx = 0
                            end if
                        else if code = 7 ' Replay - Set as Home Screen Wallpaper
                            if themeMgr.SetHomeScreenWallpaper(curSSItem)
                                state.ShowToast("✓ Set as Home Wallpaper: " + TruncateText(curSSItem.title, 25))
                            else
                                state.ShowToast("🔒 Trial Expired! Unlock in Pro Store")
                                state.viewMode = "store"
                                state.storeCardIdx = 0
                            end if
                        end if
                    
                    ' ── THEME STUDIO INPUT ─────────────────────────────────
                    else if state.viewMode = "theme"
                        if code = 0 ' Back - Return to gallery
                            state.viewMode = "gallery"
                            state.activeTab = 0
                        else if code = 2 ' Up
                            state.themeActionIdx = MaxI(0, state.themeActionIdx - 1)
                        else if code = 3 ' Down
                            state.themeActionIdx = MinI(5, state.themeActionIdx + 1)
                        else if code = 4 or code = 5 ' Left / Right - Cycle Theme Palettes or Interval
                            if state.themeActionIdx = 3 ' Auto-Switch Interval row
                                curIntIdx = 1
                                for si = 0 to switchIntervals.Count() - 1
                                    if switchIntervals[si] = themeMgr.autoSwitchInterval then curIntIdx = si
                                end for
                                if code = 4
                                    curIntIdx = (curIntIdx - 1 + switchIntervals.Count()) MOD switchIntervals.Count()
                                else
                                    curIntIdx = (curIntIdx + 1) MOD switchIntervals.Count()
                                end if
                                themeMgr.SetAutoSwitchInterval(switchIntervals[curIntIdx])
                                state.ShowToast("Interval: " + StrI(themeMgr.autoSwitchInterval / 60).Trim() + " Min")
                            else
                                ' Cycle theme palette
                                curPalIdx = 0
                                for pi = 0 to themeMgr.palettes.Count() - 1
                                    if themeMgr.palettes[pi].name = themeMgr.activeThemeName then curPalIdx = pi
                                end for
                                if code = 4
                                    curPalIdx = (curPalIdx - 1 + themeMgr.palettes.Count()) MOD themeMgr.palettes.Count()
                                else
                                    curPalIdx = (curPalIdx + 1) MOD themeMgr.palettes.Count()
                                end if
                                nextPal = themeMgr.palettes[curPalIdx]
                                themeMgr.ApplySystemTheme(nextPal.name)
                                state.ShowToast("Theme Palette: " + nextPal.name)
                            end if
                        else if code = 6 ' OK - Execute Theme Action
                            if state.themeActionIdx = 0 ' Set Selected Wallpaper as Home Screen
                                target = state.currentWallpaper
                                if target = invalid then target = state.dailyWallpaper
                                if themeMgr.SetHomeScreenWallpaper(target)
                                    state.ShowToast("✓ Set as Roku Home Screen Wallpaper!")
                                else
                                    state.ShowToast("🔒 Trial Expired! Buy Full Version ($4.99)")
                                    state.viewMode = "store"
                                    state.storeCardIdx = 0
                                end if
                            else if state.themeActionIdx = 1 ' Set Selected Wallpaper as TV Screensaver
                                target = state.currentWallpaper
                                if target = invalid then target = state.dailyWallpaper
                                if themeMgr.SetScreensaverWallpaper(target)
                                    state.ShowToast("✓ Set as Roku TV Screensaver!")
                                else
                                    state.ShowToast("🔒 Trial Expired! Buy Full Version ($4.99)")
                                    state.viewMode = "store"
                                    state.storeCardIdx = 0
                                end if
                            else if state.themeActionIdx = 2 ' Toggle Auto-Switching
                                if not licenseMgr.CanAutoSwitch()
                                    state.ShowToast("🔒 Pro Subscription required for Auto-Switching!")
                                    state.viewMode = "store"
                                    state.storeCardIdx = 1
                                else
                                    res = themeMgr.ToggleAutoSwitch()
                                    if res
                                        state.ShowToast("✓ Auto-Switching Enabled")
                                    else
                                        state.ShowToast("⏸ Auto-Switching Paused")
                                    end if
                                end if
                            else if state.themeActionIdx = 3 ' Cycle Interval
                                curIntIdx = 1
                                for si = 0 to switchIntervals.Count() - 1
                                    if switchIntervals[si] = themeMgr.autoSwitchInterval then curIntIdx = si
                                end for
                                curIntIdx = (curIntIdx + 1) MOD switchIntervals.Count()
                                themeMgr.SetAutoSwitchInterval(switchIntervals[curIntIdx])
                                state.ShowToast("Interval: " + StrI(themeMgr.autoSwitchInterval / 60).Trim() + " Min")
                            else if state.themeActionIdx = 4 ' Run Ambient Screensaver Now
                                state.viewMode = "ambient"
                                state.ambientTimer.Mark()
                            else if state.themeActionIdx = 5 ' Open Pro Store
                                state.viewMode = "store"
                                state.storeCardIdx = 0
                            end if
                        end if
                    
                    ' ── PRO STORE INPUT ────────────────────────────────────
                    else if state.viewMode = "store"
                        if code = 0 ' Back - Return to gallery
                            state.viewMode = "gallery"
                            state.activeTab = 0
                        else if code = 4 ' Left
                            state.storeCardIdx = MaxI(0, state.storeCardIdx - 1)
                        else if code = 5 ' Right
                            state.storeCardIdx = MinI(3, state.storeCardIdx + 1)
                        else if code = 2 ' Up
                            if state.storeCardIdx = 3 then state.storeCardIdx = 1
                        else if code = 3 ' Down
                            if state.storeCardIdx < 3 then state.storeCardIdx = 3
                        else if code = 6 ' OK - Purchase or Restore
                            if state.storeCardIdx < 3
                                p = storeMgr.products[state.storeCardIdx]
                                state.ShowToast("Opening Roku Pay for " + p.title + "...")
                                storeMgr.Purchase(p.sku)
                            else
                                state.ShowToast("Restoring Purchases via Roku...")
                                storeMgr.RestorePurchases()
                            end if
                        else if code = 7 ' Replay - Debug: Expire Trial for testing
                            licenseMgr.ExpireTrialForTesting()
                            state.ShowToast("[Test Mode] 3-Day Trial Expired!")
                        else if code = 9 ' FastForward - Debug: Reset Trial for testing
                            licenseMgr.ResetForTesting()
                            state.ShowToast("[Test Mode] 3-Day Trial Reset!")
                        end if
                    
                    ' ── DAILY SPOTLIGHT INPUT ──────────────────────────────
                    else if state.viewMode = "daily"
                        if code = 0 ' Back
                            state.viewMode = "gallery"
                            state.activeTab = 0
                        else if code = 2 ' Up
                            state.dailyBtnIdx = MaxI(0, state.dailyBtnIdx - 1)
                        else if code = 3 ' Down
                            state.dailyBtnIdx = MinI(3, state.dailyBtnIdx + 1)
                        else if code = 6 ' OK - Execute button
                            if state.dailyBtnIdx = 0 ' View Fullscreen
                                state.currentWallpaper = state.dailyWallpaper
                                state.viewerIdx = 0
                                state.viewMode = "viewer"
                                state.hudTimer.Mark()
                                state.isHudVisible = true
                            else if state.dailyBtnIdx = 1 ' Toggle Favorite
                                if state.dailyWallpaper <> invalid
                                    isFav = state.favMgr.ToggleFavorite(state.dailyWallpaper)
                                    if isFav
                                        state.ShowToast("♥ Added to Favorites")
                                    else
                                        state.ShowToast("Removed from Favorites")
                                    end if
                                end if
                            else if state.dailyBtnIdx = 2 ' Start Ambient
                                state.ambientWallpaper = state.dailyWallpaper
                                state.viewMode = "ambient"
                                state.ambientTimer.Mark()
                            else if state.dailyBtnIdx = 3 ' Browse Gallery
                                state.viewMode = "gallery"
                                state.activeTab = 0
                            end if
                        end if
                    
                    ' ── SETTINGS VIEW INPUT ────────────────────────────────
                    else if state.viewMode = "settings"
                        if state.isAboutDialogVisible
                            if code = 0 or code = 6
                                state.isAboutDialogVisible = false
                            end if
                        else
                            if code = 0 ' Back
                                state.viewMode = "gallery"
                                state.activeTab = 0
                            else if code = 2 ' Up
                                state.settingsIdx = MaxI(0, state.settingsIdx - 1)
                            else if code = 3 ' Down
                                state.settingsIdx = MinI(10, state.settingsIdx + 1)
                            else if code = 4 or code = 5 or code = 6 ' Left, Right, OK
                                sm = state.settingsMgr
                                
                                if state.settingsIdx = 0 ' Interval
                                    intervals = [5, 10, 15, 30, 60, 300]
                                    curIdx = 1
                                    for ii = 0 to intervals.Count() - 1
                                        if intervals[ii] = sm.ambientInterval then curIdx = ii
                                    end for
                                    if code = 4
                                        curIdx = (curIdx - 1 + intervals.Count()) MOD intervals.Count()
                                    else
                                        curIdx = (curIdx + 1) MOD intervals.Count()
                                    end if
                                    sm.ambientInterval = intervals[curIdx]
                                    sm.Save()
                                else if state.settingsIdx = 1 ' Clock Display
                                    sm.ambientClock = not sm.ambientClock
                                    sm.Save()
                                else if state.settingsIdx = 2 ' Clock Format
                                    formats = ["auto", "12h", "24h"]
                                    curFmt = 0
                                    for fi = 0 to formats.Count() - 1
                                        if formats[fi] = sm.clockFormat then curFmt = fi
                                    end for
                                    if code = 4
                                        curFmt = (curFmt - 1 + formats.Count()) MOD formats.Count()
                                    else
                                        curFmt = (curFmt + 1) MOD formats.Count()
                                    end if
                                    sm.clockFormat = formats[curFmt]
                                    sm.Save()
                                    state.ShowToast("Clock Format: " + UCase(sm.clockFormat))
                                else if state.settingsIdx = 3 ' Info Display
                                    sm.ambientInfo = not sm.ambientInfo
                                    sm.Save()
                                else if state.settingsIdx = 4 ' Default Sort Order
                                    sorts = ["newest", "oldest", "quality", "random"]
                                    curSort = 0
                                    for si = 0 to sorts.Count() - 1
                                        if sorts[si] = sm.sortOrder then curSort = si
                                    end for
                                    if code = 4
                                        curSort = (curSort - 1 + sorts.Count()) MOD sorts.Count()
                                    else
                                        curSort = (curSort + 1) MOD sorts.Count()
                                    end if
                                    sm.sortOrder = sorts[curSort]
                                    sm.Save()
                                    state.activeSortOrder = sm.sortOrder
                                    state.ApplyFilters()
                                    state.ShowToast("Default Sort: " + UCase(sm.sortOrder))
                                else if state.settingsIdx = 5 ' Zoom
                                    if sm.viewerZoom = "fit" then sm.viewerZoom = "fill" else sm.viewerZoom = "fit"
                                    sm.Save()
                                else if state.settingsIdx = 6 ' Safe Area
                                    if sm.safeArea = "off"
                                        sm.safeArea = "action_90"
                                    else if sm.safeArea = "action_90"
                                        sm.safeArea = "title_80"
                                    else
                                        sm.safeArea = "off"
                                    end if
                                    sm.Save()
                                else if state.settingsIdx = 7 ' Sound
                                    sm.soundEnabled = not sm.soundEnabled
                                    sm.Save()
                                else if state.settingsIdx = 8 ' Clear Favorites
                                    if code = 6
                                        state.favMgr.ClearAll()
                                        state.ShowToast("Favorites Cleared")
                                    end if
                                else if state.settingsIdx = 9 ' Restore Defaults
                                    if code = 6
                                        sm.ResetDefaults()
                                        state.activeSortOrder = sm.sortOrder
                                        state.ApplyFilters()
                                        state.ShowToast("Settings Reset to Defaults")
                                    end if
                                else if state.settingsIdx = 10 ' About Spotlight Studio & Disclaimer
                                    if code = 6
                                        state.isAboutDialogVisible = true
                                    end if
                                end if
                            end if
                        end if
                    
                    ' ── GALLERY VIEW INPUT ─────────────────────────────────
                    else if state.viewMode = "gallery"
                        if state.isFilterDialogVisible
                            if code = 0 or code = 10 ' Back or Info (*) - Close Filter Modal
                                state.isFilterDialogVisible = false
                            else if code = 2 ' Up
                                state.filterRowIdx = MaxI(0, state.filterRowIdx - 1)
                            else if code = 3 ' Down
                                state.filterRowIdx = MinI(7, state.filterRowIdx + 1)
                            else if code = 4 or code = 5 ' Left or Right
                                direction = 1
                                if code = 4 then direction = -1
                                
                                if state.filterRowIdx = 0 ' Category
                                    categories = ["All", "Landscape", "Nature", "Water", "Animals", "City", "Mountains", "Sky", "Space", "Architecture", "Desert", "Forest"]
                                    curIdx = 0
                                    for ci = 0 to categories.Count() - 1
                                        if categories[ci] = state.activeCategory then curIdx = ci
                                    end for
                                    curIdx = (curIdx + direction + categories.Count()) MOD categories.Count()
                                    state.activeCategory = categories[curIdx]
                                    state.ApplyFilters()
                                    
                                else if state.filterRowIdx = 1 ' Resolution
                                    resolutions = ["All", "4K", "FHD"]
                                    curIdx = 0
                                    for ri = 0 to resolutions.Count() - 1
                                        if resolutions[ri] = state.activeResolution then curIdx = ri
                                    end for
                                    curIdx = (curIdx + direction + resolutions.Count()) MOD resolutions.Count()
                                    state.activeResolution = resolutions[curIdx]
                                    state.ApplyFilters()
                                    
                                else if state.filterRowIdx = 2 ' Source
                                    sources = ["All", "peapix", "win10spotlight"]
                                    curIdx = 0
                                    for si = 0 to sources.Count() - 1
                                        if sources[si] = state.activeSource then curIdx = si
                                    end for
                                    curIdx = (curIdx + direction + sources.Count()) MOD sources.Count()
                                    state.activeSource = sources[curIdx]
                                    state.ApplyFilters()
                                    
                                else if state.filterRowIdx = 3 ' Sort Order
                                    sorts = ["newest", "oldest", "quality", "random"]
                                    curIdx = 0
                                    for soi = 0 to sorts.Count() - 1
                                        if sorts[soi] = state.activeSortOrder then curIdx = soi
                                    end for
                                    curIdx = (curIdx + direction + sorts.Count()) MOD sorts.Count()
                                    state.activeSortOrder = sorts[curIdx]
                                    state.ApplyFilters()
                                    
                                else if state.filterRowIdx = 4 ' Only Favorites
                                    state.onlyFavorites = not state.onlyFavorites
                                    state.ApplyFilters()
                                    
                                else if state.filterRowIdx = 5 ' Tag Presets
                                    tags = ["", "sunset", "beach", "forest", "night", "lake", "winter", "stars", "aurora", "desert", "waterfall"]
                                    curIdx = 0
                                    for ti = 0 to tags.Count() - 1
                                        if tags[ti] = state.searchQuery then curIdx = ti
                                    end for
                                    curIdx = (curIdx + direction + tags.Count()) MOD tags.Count()
                                    state.searchQuery = tags[curIdx]
                                    state.ApplyFilters()
                                end if
                                
                            else if code = 6 ' OK
                                if state.filterRowIdx = 6 ' Apply
                                    state.isFilterDialogVisible = false
                                    state.ApplyFilters()
                                    state.ShowToast("✓ Filters Applied: " + StrI(state.filtered.Count()).Trim() + " Wallpapers")
                                else if state.filterRowIdx = 7 ' Reset
                                    state.activeCategory = "All"
                                    state.activeResolution = "All"
                                    state.activeSource = "All"
                                    state.activeSortOrder = "newest"
                                    state.onlyFavorites = false
                                    state.searchQuery = ""
                                    state.ApplyFilters()
                                    state.ShowToast("↺ Filters Reset to All Wallpapers")
                                else
                                    ' Advance value when pressing OK on option row
                                    if state.filterRowIdx = 0
                                        categories = ["All", "Landscape", "Nature", "Water", "Animals", "City", "Mountains", "Sky", "Space", "Architecture", "Desert", "Forest"]
                                        curIdx = 0
                                        for ci = 0 to categories.Count() - 1
                                            if categories[ci] = state.activeCategory then curIdx = ci
                                        end for
                                        state.activeCategory = categories[(curIdx + 1) MOD categories.Count()]
                                        state.ApplyFilters()
                                    else if state.filterRowIdx = 1
                                        resolutions = ["All", "4K", "FHD"]
                                        curIdx = 0
                                        for ri = 0 to resolutions.Count() - 1
                                            if resolutions[ri] = state.activeResolution then curIdx = ri
                                        end for
                                        state.activeResolution = resolutions[(curIdx + 1) MOD resolutions.Count()]
                                        state.ApplyFilters()
                                    else if state.filterRowIdx = 2
                                        sources = ["All", "peapix", "win10spotlight"]
                                        curIdx = 0
                                        for si = 0 to sources.Count() - 1
                                            if sources[si] = state.activeSource then curIdx = si
                                        end for
                                        state.activeSource = sources[(curIdx + 1) MOD sources.Count()]
                                        state.ApplyFilters()
                                    else if state.filterRowIdx = 3
                                        sorts = ["newest", "oldest", "quality", "random"]
                                        curIdx = 0
                                        for soi = 0 to sorts.Count() - 1
                                            if sorts[soi] = state.activeSortOrder then curIdx = soi
                                        end for
                                        state.activeSortOrder = sorts[(curIdx + 1) MOD sorts.Count()]
                                        state.ApplyFilters()
                                    else if state.filterRowIdx = 4
                                        state.onlyFavorites = not state.onlyFavorites
                                        state.ApplyFilters()
                                    else if state.filterRowIdx = 5
                                        tags = ["", "sunset", "beach", "forest", "night", "lake", "winter", "stars", "aurora", "desert", "waterfall"]
                                        curIdx = 0
                                        for ti = 0 to tags.Count() - 1
                                            if tags[ti] = state.searchQuery then curIdx = ti
                                        end for
                                        state.searchQuery = tags[(curIdx + 1) MOD tags.Count()]
                                        state.ApplyFilters()
                                    end if
                                end if
                            end if
                        else
                            ' Normal Gallery Grid Navigation
                            pageSize = 8
                            totalItems = state.filtered.Count()
                            totalPages = MaxI(1, CInt((totalItems + pageSize - 1) / pageSize))
                            
                            if code = 0 ' Back
                                if state.focusArea = "grid"
                                    state.focusArea = "nav"
                                    state.navIdx = state.activeTab
                                else
                                    state.focusArea = "grid"
                                end if
                            else if code = 2 ' Up
                                if state.focusArea = "grid"
                                    if state.gridIdx >= 4
                                        state.gridIdx = state.gridIdx - 4
                                    else
                                        state.focusArea = "nav"
                                        state.navIdx = state.activeTab
                                    end if
                                end if
                            else if code = 3 ' Down
                                if state.focusArea = "nav"
                                    state.focusArea = "grid"
                                    state.gridIdx = 0
                                else if state.focusArea = "grid"
                                    if state.gridIdx < 4 and (state.currentPage * 8 + state.gridIdx + 4) < totalItems
                                        state.gridIdx = state.gridIdx + 4
                                    end if
                                end if
                            else if code = 4 ' Left
                                if state.focusArea = "nav"
                                    state.navIdx = MaxI(0, state.navIdx - 1)
                                else if state.focusArea = "grid"
                                    col = state.gridIdx MOD 4
                                    if col > 0
                                        state.gridIdx = state.gridIdx - 1
                                    else if state.currentPage > 0
                                        state.currentPage = state.currentPage - 1
                                        state.gridIdx = state.gridIdx + 3
                                        state.slideOffset = -50.0
                                        state.PrioritizeCurrentPage()
                                    end if
                                end if
                            else if code = 5 ' Right
                                if state.focusArea = "nav"
                                    state.navIdx = MinI(7, state.navIdx + 1)
                                else if state.focusArea = "grid"
                                    col = state.gridIdx MOD 4
                                    if col < 3 and (state.currentPage * 8 + state.gridIdx + 1) < totalItems
                                        state.gridIdx = state.gridIdx + 1
                                    else if state.currentPage < totalPages - 1
                                        state.currentPage = state.currentPage + 1
                                        state.gridIdx = state.gridIdx - 3
                                        state.slideOffset = 50.0
                                        state.PrioritizeCurrentPage()
                                    end if
                                end if
                            else if code = 8 ' Rewind - Skip 10 pages back
                                if state.currentPage > 0
                                    state.currentPage = MaxI(0, state.currentPage - 10)
                                    state.gridIdx = 0
                                    state.slideOffset = -50.0
                                    state.PrioritizeCurrentPage()
                                    state.ShowToast("Page " + StrI(state.currentPage + 1).Trim() + " of " + StrI(totalPages).Trim() + " (<< 10 Pages)")
                                end if
                            else if code = 9 ' FastForward - Skip 10 pages forward
                                if state.currentPage < totalPages - 1
                                    state.currentPage = MinI(totalPages - 1, state.currentPage + 10)
                                    state.gridIdx = 0
                                    state.slideOffset = 50.0
                                    state.PrioritizeCurrentPage()
                                    state.ShowToast("Page " + StrI(state.currentPage + 1).Trim() + " of " + StrI(totalPages).Trim() + " (>> 10 Pages)")
                                end if
                            else if code = 7 ' Replay - Random wallpaper
                                if totalItems > 0
                                    rndIdx = Rnd(totalItems) - 1
                                    state.currentWallpaper = state.filtered[rndIdx]
                                    state.viewerIdx = rndIdx
                                    state.viewMode = "viewer"
                                    state.hudTimer.Mark()
                                    state.isHudVisible = true
                                end if
                            else if code = 13 ' Play - Launch Ambient Slideshow
                                state.ambientIdx = state.currentPage * 8 + state.gridIdx
                                if state.ambientIdx >= totalItems then state.ambientIdx = 0
                                if totalItems > 0
                                    state.ambientWallpaper = state.filtered[state.ambientIdx]
                                    state.viewMode = "ambient"
                                    state.ambientTimer.Mark()
                                end if
                            else if code = 10 ' Info (*) - Open Filter & Sort Dialog
                                state.isFilterDialogVisible = true
                                state.filterRowIdx = 0
                            else if code = 6 ' OK / Select
                                if state.focusArea = "nav"
                                    state.activeTab = state.navIdx
                                    
                                    if state.navIdx = 0 ' Gallery (All)
                                        state.activeCategory = "All"
                                        state.onlyFavorites = false
                                        state.ApplyFilters()
                                        state.focusArea = "grid"
                                    else if state.navIdx = 1 ' Daily Pick
                                        state.viewMode = "daily"
                                        state.dailyBtnIdx = 0
                                    else if state.navIdx = 2 ' Screensavers
                                        state.viewMode = "screensavers"
                                        state.ssGridIdx = 0
                                        state.ssCurrentPage = 0
                                    else if state.navIdx = 3 ' Favorites
                                        state.activeCategory = "Favorites"
                                        state.onlyFavorites = true
                                        state.ApplyFilters()
                                        state.focusArea = "grid"
                                    else if state.navIdx = 4 ' Categories / Filter Dialog
                                        state.isFilterDialogVisible = true
                                        state.filterRowIdx = 0
                                    else if state.navIdx = 5 ' Theme Studio
                                        state.viewMode = "theme"
                                        state.themeActionIdx = 0
                                    else if state.navIdx = 6 ' Pro Store
                                        state.viewMode = "store"
                                        state.storeCardIdx = 0
                                    else if state.navIdx = 7 ' Settings
                                        state.viewMode = "settings"
                                        state.settingsIdx = 0
                                    end if
                                else if state.focusArea = "grid"
                                    itemIdx = state.currentPage * 8 + state.gridIdx
                                    if itemIdx < totalItems
                                        state.currentWallpaper = state.filtered[itemIdx]
                                        state.viewerIdx = itemIdx
                                        state.viewMode = "viewer"
                                        state.hudTimer.Mark()
                                        state.isHudVisible = true
                                    end if
                                end if
                            end if
                        end if
                    end if
                end if
            end if
            
            msg = port.GetMessage()
        end while
        
        ' Dynamic UI Animations & Timed Updates
        animMs = state.animClock.TotalMilliseconds()
        
        ' 1. Sinusoidal breathing focus glow (1.6s cycle)
        glowPhase = (animMs MOD 1600) / 1600.0
        pulse = (Sin(glowPhase * 6.28318) + 1.0) / 2.0
        state.glowAlpha = 175 + CInt(pulse * 80)
        
        ' 2. Smooth page slide transition lerp
        if state.slideOffset <> 0.0
            state.slideOffset = state.slideOffset * 0.75
            if Abs(state.slideOffset) < 0.5 then state.slideOffset = 0.0
        end if
        
        ' 3. Toast notification slide-in / slide-out curve
        if state.toastText <> "" and state.toastTimer <> invalid
            toastElapsed = state.toastTimer.TotalMilliseconds()
            if toastElapsed < 220
                tRatio = toastElapsed / 220.0
                invT = 1.0 - tRatio
                easeOut = 1.0 - (invT * invT * invT)
                state.toastY = 960.0 - (60.0 * easeOut)
            else if toastElapsed < 2100
                state.toastY = 900.0
            else if toastElapsed < 2400
                tRatio = (toastElapsed - 2100) / 300.0
                easeIn = tRatio * tRatio
                state.toastY = 900.0 + (50.0 * easeIn)
            else
                state.toastText = ""
            end if
        end if
        
        ' 4. Fullscreen Slideshow Auto-Advance
        if state.viewMode = "viewer" and state.isSlideshowActive
            intervalMs = state.settingsMgr.ambientInterval * 1000
            if state.slideshowTimer.TotalMilliseconds() >= intervalMs
                state.slideshowTimer.Mark()
                if state.filtered.Count() > 0
                    state.viewerIdx = (state.viewerIdx + 1) MOD state.filtered.Count()
                    state.currentWallpaper = state.filtered[state.viewerIdx]
                end if
            end if
            
            ' Auto-fade viewer HUD after 4 seconds
            if state.isHudVisible and state.hudTimer.TotalMilliseconds() > 4000
                state.isHudVisible = false
            end if
        end if
        
        ' 5. Ambient Mode Auto-Advance
        if state.viewMode = "ambient"
            intervalMs = state.settingsMgr.ambientInterval * 1000
            if state.ambientTimer.TotalMilliseconds() >= intervalMs
                state.ambientTimer.Mark()
                if state.filtered.Count() > 0
                    state.ambientIdx = (state.ambientIdx + 1) MOD state.filtered.Count()
                    state.ambientWallpaper = state.filtered[state.ambientIdx]
                end if
            end if
        end if
        
        ' 6. Background Auto-Switching Engine (Home Wallpaper & Screensaver Rotation)
        if themeMgr.autoSwitchEnabled
            intervalMs = themeMgr.autoSwitchInterval * 1000
            if autoSwitchTimer.TotalMilliseconds() >= intervalMs
                autoSwitchTimer.Mark()
                if licenseMgr.CanAutoSwitch()
                    if state.filtered.Count() > 0
                        rndIdx = Rnd(state.filtered.Count()) - 1
                        autoItem = state.filtered[rndIdx]
                        if themeMgr.autoSwitchTarget = "both" or themeMgr.autoSwitchTarget = "wallpaper"
                            themeMgr.homeWallpaper = autoItem
                            themeMgr.ApplySystemTheme(themeMgr.activeThemeName)
                        end if
                        if themeMgr.autoSwitchTarget = "both" or themeMgr.autoSwitchTarget = "screensaver"
                            themeMgr.screensaverWallpaper = autoItem
                        end if
                        print "[AutoSwitch] Successfully rotated wallpaper to: " + autoItem.title
                    end if
                else
                    ' Subscription expired or trial ended
                    themeMgr.autoSwitchEnabled = false
                    state.ShowToast("Auto-switch paused: Pro Subscription required")
                end if
            end if
        end if
        
        ' 7. Render Current View
        if state.viewMode = "gallery"
            RenderGalleryView(screen, state)
        else if state.viewMode = "viewer"
            RenderViewer(screen, state)
        else if state.viewMode = "daily"
            RenderDailyView(screen, state)
        else if state.viewMode = "screensavers"
            RenderScreensaverGalleryView(screen, state)
        else if state.viewMode = "theme"
            RenderThemeView(screen, state)
        else if state.viewMode = "store"
            RenderStoreView(screen, state)
        else if state.viewMode = "ambient"
            RenderAmbient(screen, state)
        else if state.viewMode = "settings"
            RenderSettings(screen, state)
        end if
        
        ' 8. Draw Animated Rounded Toast Overlay across all views
        if state.toastText <> "" and state.toastTimer <> invalid and state.toastTimer.TotalMilliseconds() < 2400
            t = GetTheme()
            toastW = Len(state.toastText) * 12 + 50
            toastX = (1920 - toastW) / 2
            toastCurY = CInt(state.toastY)
            DrawGlassPanelR(screen, toastX, toastCurY, toastW, 52, t.borderFocused, &h0C101EEF, 14)
            screen.DrawText(state.toastText, toastX + 25, toastCurY + 14, t.textAccent, state.fonts.body)
        end if
        
        ' 6. Present Frame
        screen.SwapBuffers()
    end while
end sub

' ─── ROKU OS SCREENSAVER ENTRY POINT ───────────────────────────────────
sub RunScreenSaver()
    print "[SpotlightStudio] Launching Roku OS Screensaver..."
    screen = CreateObject("roScreen", true, 1920, 1080)
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    screen.SetAlphaEnable(true)
    
    fontsRegistry = CreateObject("roFontRegistry")
    fonts = {
        title: fontsRegistry.GetDefaultFont(44, false, true),
        heading: fontsRegistry.GetDefaultFont(30, false, true),
        body: fontsRegistry.GetDefaultFont(22, false, false),
        caption: fontsRegistry.GetDefaultFont(18, false, false),
        small: fontsRegistry.GetDefaultFont(15, false, false)
    }
    
    settingsMgr = CreateSettingsManager()
    favMgr = CreateFavoritesManager()
    licenseMgr = CreateLicenseManager()
    themeMgr = CreateThemeManager(licenseMgr)
    imageLoader = CreateImageLoader(port, settingsMgr)
    deviceInfo = CreateObject("roDeviceInfo")
    allWallpapers = LoadCatalog()
    
    ' Active screensaver item
    activeSS = themeMgr.screensaverWallpaper
    if activeSS = invalid
        activeSS = GetDailySpotlightWallpaper(allWallpapers)
    end if
    
    ambientClock = CreateObject("roTimespan")
    ambientClock.Mark()
    now = CreateObject("roDateTime")
    
    state = {
        screen: screen,
        fonts: fonts,
        deviceInfo: deviceInfo,
        settingsMgr: settingsMgr,
        favMgr: favMgr,
        licenseMgr: licenseMgr,
        themeMgr: themeMgr,
        imageLoader: imageLoader,
        spinnerAngle: 0,
        allWallpapers: allWallpapers,
        filtered: allWallpapers,
        ambientWallpaper: activeSS,
        ambientIdx: 0,
        ambientTimer: ambientClock,
        animClock: ambientClock,
        clockTime: "",
        clockDate: "",
        clockFull: "",
        toastText: "",
        toastTimer: CreateObject("roTimespan"),
        
        GetCachedThumbnail: function(filename as string) as object
            return m.imageLoader.GetThumbnail(filename)
        end function,
        
        GetCachedFullImage: function(filename as string) as object
            return m.imageLoader.GetFullImage(filename)
        end function,
        
        ShowToast: function(text as string)
        end function
    }
    
    running = true
    while running
        state.spinnerAngle = (state.spinnerAngle + 15) MOD 360
        localInfo = GetDeviceLocalTime(state.deviceInfo, state.settingsMgr.clockFormat)
        state.clockTime = localInfo.time
        state.clockDate = localInfo.date
        state.clockFull = localInfo.full
        
        msg = port.WaitMessage(20)
        while msg <> invalid
            msgType = type(msg)
            if msgType = "roUrlEvent"
                state.imageLoader.HandleUrlEvent(msg)
            else if msgType = "roUniversalControlEvent"
                running = false
                exit while
            end if
            msg = port.GetMessage()
        end while
        
        if not running then exit while
        
        ' Cycle wallpaper on interval
        intervalMs = state.settingsMgr.ambientInterval * 1000
        if state.ambientTimer.TotalMilliseconds() >= intervalMs
            state.ambientTimer.Mark()
            if state.filtered.Count() > 0
                state.ambientIdx = (state.ambientIdx + 1) MOD state.filtered.Count()
                state.ambientWallpaper = state.filtered[state.ambientIdx]
            end if
        end if
        
        RenderAmbient(screen, state)
        screen.SwapBuffers()
    end while
    print "[SpotlightStudio] Roku OS Screensaver exited."
end sub
