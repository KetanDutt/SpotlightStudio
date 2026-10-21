' Spotlight Studio for Roku
' main.brs - Entry point, application state, input dispatch and render loop.
'
' Architecture
' ------------
' A single `state` associative array owns every manager and every piece of
' navigation state.  Rendering is split into one function per screen
' (view_*.brs) and input into one handler per screen, so the dispatcher below is
' a shallow switch rather than a 900-line if/else chain.
'
' The loop only paints when something actually changed (`state.dirty`) or an
' animation is running, and animations run at 20 fps instead of 60.  A canvas
' app has no compositor: every frame re-issues every draw call, so skipping
' unchanged frames is the single largest performance lever available.
'
' Remote key codes (roUniversalControlEvent.GetInt())
' ---------------------------------------------------
'   0 Back   2 Up   3 Down   4 Left   5 Right   6 Select
'   7 Instant Replay   8 Rewind   9 Fast Forward   10 Info (*)   13 Play
' Release events are the press code + 100 and are ignored.  The Home button is
' never delivered: the OS terminates the channel, so Back (0) is the only exit
' path this code controls - and certification requirement 4.6 says Back must
' return to the previous screen, exiting the app only from the home screen.

' ─── ENTRY POINTS ─────────────────────────────────────────────────────

sub Main(args as dynamic)
    RunUserInterface(args)
end sub

sub RunUserInterface(args as dynamic)
    launchTimer = CreateObject("roTimespan")
    launchTimer.Mark()

    port = CreateObject("roMessagePort")
    deviceInfo = CreateObject("roDeviceInfo")
    appInfo = CreateObject("roAppInfo")

    settingsMgr = CreateSettingsManager()
    favMgr = CreateFavoriteManager()
    licenseMgr = CreateLicenseManager()
    themeMgr = CreateThemeManager(settingsMgr, favMgr)
    ' ApplyTheme() seeds the memoised palette so GetTheme() is valid before the
    ' first draw call anywhere in the app.
    themeMgr.ApplyTheme()

    screen = CreateObject("roScreen", true, 1920, 1080)
    if screen = invalid then screen = CreateObject("roScreen", true)
    if screen = invalid
        ' No drawing surface: nothing can be shown, so exit cleanly rather than
        ' crashing on the first DrawRect.
        return
    end if
    screen.SetMessagePort(port)
    screen.SetAlphaEnable(true)
    if screen.GetWidth() <> 1920
        LogInfo("Warning: canvas is " + StrI(screen.GetWidth()).Trim() + "x" + StrI(screen.GetHeight()).Trim() + ", expected 1920x1080")
    end if

    audioMgr = CreateAudioManager(settingsMgr.GetBool("soundEffects", true))
    storeMgr = CreateStoreManager(port, licenseMgr)
    imgLoader = CreateImageLoader(port, settingsMgr)

    ' ECP "input" events while the channel is already running.  Required for
    ' Direct to Play (certification 5.2) together with supports_input_launch=1.
    ecpInput = CreateObject("roInput")
    if ecpInput <> invalid then ecpInput.SetMessagePort(port)

    allWallpapers = LoadCatalog()
    screensaverList = BuildScreensaverList(allWallpapers)
    dailyWallpaper = GetDailySpotlightWallpaper(allWallpapers)

    state = BuildState(screen, port, deviceInfo, appInfo, settingsMgr, favMgr, licenseMgr, themeMgr, audioMgr, storeMgr, imgLoader, allWallpapers, screensaverList, dailyWallpaper, launchTimer)

    ApplyFilters(state)
    RestorePosition(state)
    ResolveDeepLink(state, args)

    state.imgLoader.PrioritizeVisible(CurrentPageItems(state))
    storeMgr.Refresh()

    RenderFrame(state)
    screen.SwapBuffers()
    state.dirty = false
    LogInfo("First frame rendered in " + StrI(launchTimer.TotalMilliseconds()).Trim() + " ms")

    if IsDevBuild() then RunDailyHashSelfTest()

    MainLoop(state)

    ' Persist where the user left off (certification 4.1).
    RememberPosition(state)
    LogInfo("Channel exited normally after " + StrI(launchTimer.TotalSeconds()).Trim() + "s")
end sub

' ─── FONTS ────────────────────────────────────────────────────────────

function BuildFonts() as object
    fontRegistry = CreateObject("roFontRegistry")
    defaultFont = invalid
    if fontRegistry <> invalid then defaultFont = fontRegistry.GetDefaultFont()

    ' The channel renders at a 1920x1080 design resolution, so these sizes are
    ' chosen for a ten-foot viewing distance and stay legible on a 720p panel
    ' after the OS downscales the canvas.
    fonts = {
        heading: defaultFont,
        body: defaultFont,
        small: defaultFont,
        title: defaultFont,
        caption: defaultFont
    }

    if defaultFont <> invalid
        fonts.heading = defaultFont.Copy()
        fonts.body = defaultFont.Copy()
        fonts.small = defaultFont.Copy()
        fonts.title = defaultFont.Copy()
        fonts.caption = defaultFont.Copy()

        fonts.title.SetSize(30, 0)
        fonts.heading.SetSize(26, 0)
        fonts.body.SetSize(22, 0)
        fonts.small.SetSize(17, 0)
        fonts.caption.SetSize(15, 0)
    end if

    return fonts
end function

' ─── STATE ────────────────────────────────────────────────────────────

function BuildState(screen as object, port as object, deviceInfo as object, appInfo as object, settingsMgr as object, favMgr as object, licenseMgr as object, themeMgr as object, audioMgr as object, storeMgr as object, imgLoader as object, allWallpapers as object, screensaverList as object, dailyWallpaper as object, launchTimer as object) as object
    appVersion = "0.0.0"
    if appInfo <> invalid then appVersion = SafeStr(appInfo.GetVersion())

    uiResolution = "fhd"
    canvasW = 1920
    canvasH = 1080
    if screen <> invalid
        canvasW = screen.GetWidth()
        canvasH = screen.GetHeight()
    end if

    animClock = CreateObject("roTimespan")
    animClock.Mark()

    clockInfo = GetDeviceLocalTime(deviceInfo, settingsMgr.GetStr("clockFormat", "auto"))

    state = {
        ' ── surfaces & managers ──
        screen: screen,
        port: port,
        deviceInfo: deviceInfo,
        appInfo: appInfo,
        settingsMgr: settingsMgr,
        favMgr: favMgr,
        licenseMgr: licenseMgr,
        themeMgr: themeMgr,
        audioMgr: audioMgr,
        storeMgr: storeMgr,
        imgLoader: imgLoader,
        launchTimer: launchTimer,

        appVersion: appVersion,
        uiResolution: uiResolution,
        canvasW: canvasW,
        canvasH: canvasH,
        fonts: BuildFonts(),
        logoBitmap: CreateObject("roBitmap", "pkg:/images/icon_hd.png"),

        ' ── content ──
        allWallpapers: allWallpapers,
        filtered: [],
        screensaverList: screensaverList,
        dailyWallpaper: dailyWallpaper,
        totalCount: allWallpapers.Count(),

        ' ── navigation ──
        activeView: "gallery",
        activeTab: TabGallery(),
        focusArea: "grid",
        returnView: "gallery",
        gridIdx: 0,
        currentPage: 0,
        ssGridIdx: 0,
        currentPageSS: 0,
        dailyAction: 0,
        settingsIdx: 0,
        storeIdx: 0,
        themeRow: 0,
        filterRow: 0,
        kbRow: 0,
        kbCol: 0,

        ' ── modals ──
        filterMode: false,
        searchMode: false,
        caretVisible: true,

        ' ── viewer / ambient (one shared list + index) ──
        browseList: [],
        browseIdx: 0,
        showHud: true,
        aspectMode: 0,
        zoomScale: 1.0,
        slideshowActive: false,
        nextSlideAtMs: 0,
        switchAtMs: 0,
        ambientShowInfo: true,
        ambientTransition: 0,
        ambientTransStart: 0,
        autoSwitchInterval: settingsMgr.GetInt("ambientInterval", 30),

        ' ── render loop ──
        animClock: animClock,
        dirty: true,
        spinnerAngle: 0,
        spinnerVisible: false,
        transitioning: false,
        transitionStartMs: -1,
        clockTime: SafeStr(clockInfo.time),
        clockDate: SafeStr(clockInfo.date),
        lastClockMs: -60000,
        lastReapMs: -10000,
        lastFrameMs: 0,
        toastMessage: "",
        toastUntilMs: 0,

        ' ── gallery backdrop (see DrawGalleryBackdrop) ──
        backdropBmp: invalid,
        backdropKey: "",

        exitApp: false
    }

    return state
end function

' ─── MAIN LOOP ────────────────────────────────────────────────────────

sub MainLoop(state as object)
    port = state.port
    screen = state.screen
    frameClock = state.animClock

    while not state.exitApp
        nowMs = frameClock.TotalMilliseconds()

        interval = FrameIntervalMs(state)
        waitMs = 200
        if interval > 0 then waitMs = interval

        ' WaitMessage() both blocks and REMOVES the message it returns, so it has
        ' to be dispatched.  The previous implementation threw that message away
        ' and then called GetMessage(), which silently dropped the first key
        ' press after every idle period.
        msg = port.WaitMessage(waitMs)
        if msg <> invalid
            ProcessMessage(msg, state)
            msg = invalid
            ' Drain anything that arrived in the same window so a burst of keys
            ' is never rendered a frame late.
            extra = port.GetMessage()
            while extra <> invalid
                ProcessMessage(extra, state)
                extra = port.GetMessage()
            end while
            msg = invalid
        end if

        if state.exitApp then exit while

        UpdateTimers(state, frameClock.TotalMilliseconds())

        if FrameNeedsRender(state, frameClock.TotalMilliseconds())
            RenderFrame(state)
            screen.SwapBuffers()
            state.dirty = false
            state.lastFrameMs = frameClock.TotalMilliseconds()
        end if
    end while
end sub

' Frame budget: 0 when idle (render only on change), 16 ms for short transitions,
' 50 ms for the ambient breathing/spinner/drift animations.
function FrameIntervalMs(state as object) as integer
    if state.transitioning then return 16
    if state.ambientTransition <> 0 then return 16
    if AnimationActive(state) then return 50
    return 0
end function

function AnimationActive(state as object) as boolean
    if state.spinnerVisible then return true
    if state.slideshowActive then return true
    if state.searchMode then return true ' blinking caret
    if state.activeView = "ambient" then return true ' Ken Burns drift
    if state.activeView = "viewer" and state.browseList.Count() > 0 then return true
    if state.toastMessage <> "" then return true
    if state.storeMgr.IsBusy() then return true
    if state.imgLoader.IsPending() then return true
    ' The breathing focus ring is only visible where a ring is drawn.
    if state.activeView = "gallery" then return true
    if state.activeView = "screensavers" then return true
    if state.activeView = "daily" then return true
    if state.activeView = "theme" then return true
    if state.activeView = "store" then return true
    if state.activeView = "settings" then return true
    return false
end function

function FrameNeedsRender(state as object, nowMs as integer) as boolean
    if state.dirty then return true
    interval = FrameIntervalMs(state)
    if interval = 0 then return false
    return (nowMs - state.lastFrameMs) >= interval
end function

' ─── PER-FRAME UPDATES ────────────────────────────────────────────────

sub UpdateTimers(state as object, nowMs as integer)
    ' Device clock: refreshing it allocates an roDateTime, so it is throttled to
    ' once every 15 seconds instead of once per frame.
    if nowMs - state.lastClockMs >= 15000
        state.lastClockMs = nowMs
        clockInfo = GetDeviceLocalTime(state.deviceInfo, state.settingsMgr.GetStr("clockFormat", "auto"))
        newTime = SafeStr(clockInfo.time)
        newDate = SafeStr(clockInfo.date)
        if newTime <> state.clockTime or newDate <> state.clockDate
            state.clockTime = newTime
            state.clockDate = newDate
            state.dirty = true
        end if
    end if

    ' Spinner phase, only while something is actually loading.
    UpdateSpinner(state)

    ' Toast expiry.
    if state.toastMessage <> "" and nowMs > state.toastUntilMs
        state.toastMessage = ""
        state.dirty = true
    end if

    ' Search caret blink (~1 Hz).
    if state.searchMode
        caret = ((nowMs / 500) MOD 2) = 0
        if caret <> state.caretVisible
            state.caretVisible = caret
            state.dirty = true
        end if
    end if

    ' Page-change fade.
    if state.transitioning and (nowMs - state.transitionStartMs) >= 180
        state.transitioning = false
        state.transitionStartMs = -1
        state.dirty = true
    end if

    ' Stalled network requests release their concurrency slot once a second.
    if nowMs - state.lastReapMs >= 1000
        state.lastReapMs = nowMs
        state.imgLoader.ReapStalledRequests()
    end if

    UpdateAmbient(state, nowMs)
    UpdateViewerSlideshow(state, nowMs)
end sub

' A spinner is only worth animating when a visible card is still missing its
' thumbnail; otherwise the render loop would never go idle.
sub UpdateSpinner(state as object)
    visible = CurrentPageItems(state)
    pending = false
    for each item in visible
        if item <> invalid
            if state.imgLoader.GetThumbnail(WallpaperFilename(item)) = invalid
                pending = true
                exit for
            end if
        end if
    end for
    if state.activeView = "viewer" or state.activeView = "ambient"
        pending = true
        if state.browseList.Count() > 0
            idx = WrapIndex(state.browseIdx, state.browseList.Count())
            curItem = state.browseList[idx]
            if curItem <> invalid
                if state.imgLoader.GetFullImage(WallpaperFilename(curItem)) <> invalid then pending = false
            end if
        end if
    end if

    if pending
        state.spinnerAngle = (state.spinnerAngle + 12) MOD 360
        if not state.spinnerVisible then state.dirty = true
        state.spinnerVisible = true
    else
        if state.spinnerVisible then state.dirty = true
        state.spinnerVisible = false
    end if
end sub

' Ambient Mode: auto-advance plus the dip-to-black transition state machine.
sub UpdateAmbient(state as object, nowMs as integer)
    if state.activeView <> "ambient" then return
    if state.browseList.Count() = 0 then return

    if state.ambientTransition = 1
        if (nowMs - state.ambientTransStart) >= AmbientFadeDuration()
            AdvanceAmbient(state)
            state.ambientTransition = 2
            state.ambientTransStart = nowMs
            state.dirty = true
        end if
        return
    end if

    if state.ambientTransition = 2
        if (nowMs - state.ambientTransStart) >= AmbientRevealDuration()
            state.ambientTransition = 0
            state.dirty = true
        end if
        return
    end if

    if not state.slideshowActive then return

    ' Wall-clock elapsed seconds, not loop iterations: the loop runs ~20x per
    ' second while animating, so a per-iteration counter would advance the
    ' slideshow twenty times too fast.
    elapsedSec = (nowMs - state.switchAtMs) / 1000
    if elapsedSec >= state.autoSwitchInterval
        state.switchAtMs = nowMs
        state.ambientTransition = 1
        state.ambientTransStart = nowMs
        ' Warm the next frame during the fade-out so the reveal is not blank.
        PrefetchNeighbours(state)
        state.dirty = true
    end if
end sub

sub AdvanceAmbient(state as object)
    total = state.browseList.Count()
    if total = 0 then return
    state.browseIdx = WrapIndex(state.browseIdx + 1, total)
    RememberWallpaper(state)
    state.imgLoader.PrioritizeVisible(CurrentBrowseItems(state))
end sub

' The viewer slideshow reuses the ambient timing but stays on the still frame.
sub UpdateViewerSlideshow(state as object, nowMs as integer)
    if state.activeView <> "viewer" then return
    if not state.slideshowActive then return
    if nowMs < state.nextSlideAtMs then return

    state.nextSlideAtMs = nowMs + (MaxI(2, state.autoSwitchInterval) * 1000)
    total = state.browseList.Count()
    if total > 0
        state.browseIdx = WrapIndex(state.browseIdx + 1, total)
        RememberWallpaper(state)
        PrefetchNeighbours(state)
        state.dirty = true
    end if
end sub

' ─── RENDER DISPATCH ──────────────────────────────────────────────────

sub RenderFrame(state as object)
    screen = state.screen

    if state.activeView = "viewer"
        RenderViewer(screen, state)
    else if state.activeView = "ambient"
        RenderAmbient(screen, state)
    else if state.activeView = "daily"
        RenderDailySpotlight(screen, state)
    else if state.activeView = "screensavers"
        RenderScreensaverGallery(screen, state)
    else if state.activeView = "theme"
        RenderThemeStudio(screen, state)
    else if state.activeView = "store"
        RenderStore(screen, state)
    else if state.activeView = "settings"
        RenderSettings(screen, state)
    else
        RenderGallery(screen, state)
    end if

    if state.filterMode then RenderFilterOverlay(screen, state)
    if state.searchMode then RenderSearchOverlay(screen, state)
end sub

' ─── MESSAGE ROUTING ──────────────────────────────────────────────────

sub ProcessMessage(msg as object, state as object)
    if msg = invalid then return
    msgType = type(msg)

    if msgType = "roUniversalControlEvent"
        ' Release events are the press code + 100.
        if msg.GetInt() >= 100 then return
        HandleRemoteKey(msg.GetInt(), msg, state)
        return
    end if

    if msgType = "roUrlEvent"
        if state.imgLoader.HandleUrlEvent(msg) then state.dirty = true
        return
    end if

    if msgType = "roTextureRequestEvent"
        if state.imgLoader.HandleTextureEvent(msg) then state.dirty = true
        return
    end if

    if msgType = "roChannelStoreEvent"
        if state.storeMgr.HandleStoreEvent(msg)
            state.dirty = true
            if state.activeView = "store"
                if state.licenseMgr.HasProAccess() then ShowToast(state, "Pro unlocked - thank you!")
            end if
        end if
        return
    end if

    if msgType = "roInputEvent"
        HandleEcpInput(msg, state)
        return
    end if
end sub

sub HandleRemoteKey(code as integer, msg as object, state as object)
    ' Modals own the remote while they are open.
    if state.searchMode
        HandleSearchInput(code, msg, state)
        return
    end if
    if state.filterMode
        HandleFilterInput(code, state)
        return
    end if

    if state.activeView = "viewer"
        HandleViewerInput(code, state)
    else if state.activeView = "ambient"
        HandleAmbientInput(code, state)
    else if state.activeView = "daily"
        HandleDailyInput(code, state)
    else if state.activeView = "screensavers"
        HandleScreensaverInput(code, state)
    else if state.activeView = "theme"
        HandleThemeInput(code, state)
    else if state.activeView = "store"
        HandleStoreInput(code, state)
    else if state.activeView = "settings"
        HandleSettingsInput(code, state)
    else
        HandleGalleryInput(code, state)
    end if
end sub

' ─── GALLERY ──────────────────────────────────────────────────────────

sub HandleGalleryInput(code as integer, state as object)
    pageSize = GalleryPageSize()
    totalItems = state.filtered.Count()
    totalPages = MaxI(1, CeilDivI(totalItems, pageSize))

    if state.focusArea = "nav"
        HandleGalleryNavInput(code, state, totalPages)
        return
    end if

    if code = 0 ' Back: grid -> tab bar, tab bar -> exit (certification 4.6)
        state.focusArea = "nav"
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 2 ' Up
        if CInt(state.gridIdx / GalleryColumns()) = 0
            state.focusArea = "nav"
            state.audioMgr.PlayNav()
        else
            state.gridIdx = state.gridIdx - GalleryColumns()
            state.audioMgr.PlayNav()
        end if
        MarkDirty(state)
        return
    end if

    if code = 3 ' Down
        nextIdx = state.gridIdx + GalleryColumns()
        if nextIdx < pageSize and (state.currentPage * pageSize) + nextIdx < totalItems
            state.gridIdx = nextIdx
            state.audioMgr.PlayNav()
        else
            state.audioMgr.PlayDeadEnd()
        end if
        MarkDirty(state)
        return
    end if

    if code = 4 or code = 5 ' Left / Right
        direction = 1
        if code = 4 then direction = -1
        absoluteIdx = (state.currentPage * pageSize) + state.gridIdx
        targetIdx = absoluteIdx + direction

        if targetIdx < 0 or targetIdx >= totalItems
            state.audioMgr.PlayDeadEnd()
        else
            targetPage = CInt(targetIdx / pageSize)
            if targetPage <> state.currentPage then ChangePage(state, targetPage)
            state.gridIdx = targetIdx MOD pageSize
            state.audioMgr.PlayNav()
        end if
        MarkDirty(state)
        return
    end if

    if code = 6 ' Select -> fullscreen viewer
        absoluteIdx = (state.currentPage * pageSize) + state.gridIdx
        if absoluteIdx < totalItems
            EnterViewer(state, state.filtered, absoluteIdx, "gallery")
            state.audioMgr.PlaySelect()
        end if
        return
    end if

    if code = 8 or code = 9 or code = 17 or code = 18 ' Rewind / FF / A / B: page skip
        delta = PageSkipCount()
        if code = 8 or code = 17 then delta = -PageSkipCount()
        target = ClampI(state.currentPage + delta, 0, totalPages - 1)
        if target <> state.currentPage
            ChangePage(state, target)
            state.audioMgr.PlayNavMulti()
        end if
        MarkDirty(state)
        return
    end if

    if code = 13 ' Play -> Ambient Mode
        absoluteIdx = (state.currentPage * pageSize) + state.gridIdx
        if absoluteIdx >= totalItems then absoluteIdx = 0
        EnterAmbient(state, state.filtered, absoluteIdx, "gallery")
        return
    end if

    if code = 10 ' Info (*) -> filter & sort
        state.filterMode = true
        state.filterRow = 0
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 7 ' Instant Replay -> jump to today's Daily Spotlight
        if state.dailyWallpaper <> invalid
            idx = FindWallpaperIndex(state.filtered, SafeStr(state.dailyWallpaper.id))
            if idx >= 0
                ChangePage(state, CInt(idx / pageSize))
                state.gridIdx = idx MOD pageSize
                ShowToast(state, "Jumped to today's Daily Spotlight")
            else
                SetTab(state, TabDaily())
            end if
            MarkDirty(state)
        end if
        return
    end if

    HandleCommonKey(code, state)
end sub

sub HandleGalleryNavInput(code as integer, state as object, totalPages as integer)
    tabs = NavTabs()

    if code = 0 ' Back on the tab bar exits the channel (certification 4.6)
        state.exitApp = true
        return
    end if

    if code = 4 or code = 5
        direction = 1
        if code = 4 then direction = -1
        SetTab(state, state.activeTab + direction)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 3 ' Down into the grid
        state.focusArea = "grid"
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 6 ' Select the focused tab
        ActivateTab(state)
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 10 ' (*) open Filter & Sort from anywhere on the home screen
        state.filterMode = true
        state.filterRow = 0
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 8 or code = 9
        delta = PageSkipCount()
        if code = 8 then delta = -PageSkipCount()
        target = ClampI(state.currentPage + delta, 0, totalPages - 1)
        if target <> state.currentPage then ChangePage(state, target)
        MarkDirty(state)
        return
    end if

    HandleCommonKey(code, state)
end sub

' Switching tabs moves focus but does not change the view until the tab is
' activated, except for the two tabs that are themselves actions.
sub SetTab(state as object, idx as integer)
    tabs = NavTabs()
    state.activeTab = WrapIndex(idx, tabs.Count())
    state.gridIdx = 0
    state.currentPage = 0

    if state.activeTab = TabFavorites()
        state.settingsMgr.Save("favoritesOnly", "1")
        ApplyFilters(state)
        state.activeView = "gallery"
        state.focusArea = "grid"
    else
        if state.settingsMgr.GetBool("favoritesOnly", false)
            state.settingsMgr.Save("favoritesOnly", "0")
            ApplyFilters(state)
        end if
    end if
end sub

sub ActivateTab(state as object)
    idx = state.activeTab
    if idx = TabGallery() or idx = TabFavorites()
        state.activeView = "gallery"
        state.focusArea = "grid"
        return
    end if
    if idx = TabFilter()
        state.activeView = "gallery"
        state.filterMode = true
        state.filterRow = 0
        return
    end if
    if idx = TabDaily()
        state.activeView = "daily"
        state.dailyAction = 0
        return
    end if
    if idx = TabScreensavers()
        state.activeView = "screensavers"
        state.ssGridIdx = 0
        state.currentPageSS = 0
        return
    end if
    if idx = TabTheme()
        state.activeView = "theme"
        state.themeRow = 0
        return
    end if
    if idx = TabStore()
        state.activeView = "store"
        state.storeIdx = 0
        return
    end if
    if idx = TabSettings()
        state.activeView = "settings"
        state.settingsIdx = 0
        return
    end if
end sub

' ─── VIEWER ───────────────────────────────────────────────────────────

sub HandleViewerInput(code as integer, state as object)
    total = state.browseList.Count()
    if total = 0
        if code = 0 then ExitToView(state, state.returnView)
        return
    end if

    if code = 0 ' Back
        ExitToView(state, state.returnView)
        return
    end if

    if code = 4 or code = 5 or code = 17 or code = 18 ' Left / Right / A / B
        direction = 1
        if code = 4 or code = 17 then direction = -1
        state.browseIdx = WrapIndex(state.browseIdx + direction, total)
        state.zoomScale = 1.0
        RememberWallpaper(state)
        PrefetchNeighbours(state)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 2 ' Up: zoom in
        state.zoomScale = ClampF(state.zoomScale + 0.25, 1.0, 3.0)
        ShowToast(state, "Zoom " + StrI(CInt(state.zoomScale * 100)).Trim() + "%")
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 3 ' Down: zoom out
        state.zoomScale = ClampF(state.zoomScale - 0.25, 1.0, 3.0)
        ShowToast(state, "Zoom " + StrI(CInt(state.zoomScale * 100)).Trim() + "%")
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 6 ' Select: cycle aspect mode, then toggle the HUD when already filling
        if state.aspectMode = 0
            state.aspectMode = 1
            ShowToast(state, "Aspect: FILL (crop to the panel)")
        else
            state.aspectMode = 0
            state.zoomScale = 1.0
            ShowToast(state, "Aspect: FIT (letterboxed)")
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 10 or code = 12 ' Info: toggle the HUD
        state.showHud = not state.showHud
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 13 or code = 14 ' Play / Pause: slideshow
        state.slideshowActive = not state.slideshowActive
        state.nextSlideAtMs = state.animClock.TotalMilliseconds() + (MaxI(2, state.autoSwitchInterval) * 1000)
        if state.slideshowActive
            ShowToast(state, "Slideshow on - a new wallpaper every " + FormatInterval(state.autoSwitchInterval))
        else
            ShowToast(state, "Slideshow paused")
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 7 ' Instant Replay: favourite
        ToggleFavorite(state, state.browseList[state.browseIdx])
        return
    end if

    if code = 8 or code = 9 ' Rewind / FF: jump ten items
        delta = 10
        if code = 8 then delta = -10
        state.browseIdx = WrapIndex(state.browseIdx + delta, total)
        state.zoomScale = 1.0
        RememberWallpaper(state)
        PrefetchNeighbours(state)
        state.audioMgr.PlayNavMulti()
        MarkDirty(state)
        return
    end if

    HandleCommonKey(code, state)
end sub

' ─── AMBIENT MODE ─────────────────────────────────────────────────────

sub HandleAmbientInput(code as integer, state as object)
    total = state.browseList.Count()

    if code = 13 or code = 14 ' Play / Pause the slideshow
        state.slideshowActive = not state.slideshowActive
        state.switchAtMs = state.animClock.TotalMilliseconds()
        if state.slideshowActive
            ShowToast(state, "Ambient slideshow on - " + FormatInterval(state.autoSwitchInterval) + " per image")
        else
            ShowToast(state, "Ambient slideshow paused")
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 10 or code = 12 ' Info
        state.ambientShowInfo = not state.ambientShowInfo
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 7 ' Instant Replay: shuffle to a random wallpaper
        if total > 0
            state.browseIdx = Rnd(total) - 1
            RememberWallpaper(state)
            PrefetchNeighbours(state)
            ShowToast(state, "Shuffled to a random wallpaper")
            state.audioMgr.PlaySelect()
            MarkDirty(state)
        end if
        return
    end if

    if code = 4 or code = 5 or code = 17 or code = 18 ' manual browse
        if total > 0
            direction = 1
            if code = 4 or code = 17 then direction = -1
            state.browseIdx = WrapIndex(state.browseIdx + direction, total)
            RememberWallpaper(state)
            PrefetchNeighbours(state)
            state.audioMgr.PlayNav()
            MarkDirty(state)
        end if
        return
    end if

    if code = 8 or code = 9 ' interval down / up
        state.autoSwitchInterval = CycleIntOption(AmbientIntervalOptions(), state.autoSwitchInterval, 1)
        if code = 8 then state.autoSwitchInterval = CycleIntOption(AmbientIntervalOptions(), state.autoSwitchInterval, -2)
        state.settingsMgr.Save("ambientInterval", StrI(state.autoSwitchInterval).Trim())
        state.switchAtMs = state.animClock.TotalMilliseconds()
        ShowToast(state, "Ambient interval: " + FormatInterval(state.autoSwitchInterval))
        MarkDirty(state)
        return
    end if

    if code = 6 ' Select: use this wallpaper as the Ambient rotation start
        if total > 0
            if state.themeMgr.SetAmbientWallpaper(state.browseList[state.browseIdx])
                ShowToast(state, "Set as the Ambient Mode wallpaper")
            end if
            state.audioMgr.PlaySelect()
            MarkDirty(state)
        end if
        return
    end if

    ' Back - and any other key - leaves Ambient Mode, which is what a
    ' screensaver-like experience should do on a ten-foot screen.
    if code = 0
        ExitToView(state, state.returnView)
        return
    end if

    ExitToView(state, state.returnView)
end sub

' ─── DAILY SPOTLIGHT ──────────────────────────────────────────────────

sub HandleDailyInput(code as integer, state as object)
    if code = 0
        ExitToView(state, "gallery")
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        state.dailyAction = WrapIndex(state.dailyAction + direction, 3)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 6
        RunDailyAction(state, state.dailyAction)
        return
    end if

    if code = 7 ' Instant Replay: favourite today's pick
        ToggleFavorite(state, state.dailyWallpaper)
        return
    end if

    if code = 13
        if state.dailyWallpaper <> invalid
            EnterAmbient(state, [state.dailyWallpaper], 0, "daily")
        end if
        return
    end if

    HandleCommonKey(code, state)
end sub

sub RunDailyAction(state as object, action as integer)
    if state.dailyWallpaper = invalid
        ShowToast(state, "No Daily Spotlight is available")
        return
    end if

    if action = 0
        EnterViewer(state, [state.dailyWallpaper], 0, "daily")
        return
    end if
    if action = 1
        EnterAmbient(state, [state.dailyWallpaper], 0, "daily")
        return
    end if
    ToggleFavorite(state, state.dailyWallpaper)
end sub

' ─── SCREENSAVER / AMBIENT COLLECTION ─────────────────────────────────

sub HandleScreensaverInput(code as integer, state as object)
    pageSize = ScreensaverPageSize()
    totalItems = state.screensaverList.Count()
    totalPages = MaxI(1, CeilDivI(totalItems, pageSize))

    if code = 0
        ExitToView(state, "gallery")
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        nextIdx = state.ssGridIdx + (direction * ScreensaverColumns())
        if nextIdx >= 0 and nextIdx < pageSize and (state.currentPageSS * pageSize) + nextIdx < totalItems
            state.ssGridIdx = nextIdx
            state.audioMgr.PlayNav()
        else
            state.audioMgr.PlayDeadEnd()
        end if
        MarkDirty(state)
        return
    end if

    if code = 4 or code = 5
        direction = 1
        if code = 4 then direction = -1
        absoluteIdx = (state.currentPageSS * pageSize) + state.ssGridIdx
        targetIdx = absoluteIdx + direction
        if targetIdx < 0 or targetIdx >= totalItems
            state.audioMgr.PlayDeadEnd()
        else
            state.ssGridIdx = targetIdx MOD pageSize
            if direction = 1 and state.ssGridIdx = 0 then ChangeScreensaverPage(state, state.currentPageSS + 1)
            if direction = -1 and state.ssGridIdx = pageSize - 1 then ChangeScreensaverPage(state, state.currentPageSS - 1)
            state.audioMgr.PlayNav()
        end if
        MarkDirty(state)
        return
    end if

    if code = 6
        absoluteIdx = (state.currentPageSS * pageSize) + state.ssGridIdx
        if absoluteIdx < totalItems
            EnterViewer(state, state.screensaverList, absoluteIdx, "screensavers")
            state.audioMgr.PlaySelect()
        end if
        return
    end if

    if code = 8 or code = 9
        delta = 1
        if code = 8 then delta = -1
        ChangeScreensaverPage(state, state.currentPageSS + delta)
        state.audioMgr.PlayNavMulti()
        MarkDirty(state)
        return
    end if

    if code = 13
        absoluteIdx = (state.currentPageSS * pageSize) + state.ssGridIdx
        if absoluteIdx >= totalItems then absoluteIdx = 0
        EnterAmbient(state, state.screensaverList, absoluteIdx, "screensavers")
        return
    end if

    if code = 10 ' (*) set the focused wallpaper as the Ambient one
        absoluteIdx = (state.currentPageSS * pageSize) + state.ssGridIdx
        if absoluteIdx < totalItems
            if state.themeMgr.SetAmbientWallpaper(state.screensaverList[absoluteIdx])
                ShowToast(state, "Set as the Ambient Mode wallpaper")
            else
                ShowToast(state, "That wallpaper could not be assigned")
            end if
            state.audioMgr.PlaySelect()
            MarkDirty(state)
        end if
        return
    end if

    if code = 7
        absoluteIdx = (state.currentPageSS * pageSize) + state.ssGridIdx
        if absoluteIdx < totalItems then ToggleFavorite(state, state.screensaverList[absoluteIdx])
        return
    end if

    HandleCommonKey(code, state)
end sub

' ─── THEME STUDIO ─────────────────────────────────────────────────────

sub HandleThemeInput(code as integer, state as object)
    rows = BuildThemeRows(state)
    rowCount = rows.Count()
    if rowCount = 0
        if code = 0 then ExitToView(state, "gallery")
        return
    end if

    if code = 0
        ExitToView(state, "gallery")
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        state.themeRow = WrapIndex(state.themeRow + direction, rowCount)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    row = rows[state.themeRow]
    kind = SafeStr(row.kind)
    name = SafeStr(row.name)

    if code = 4 or code = 5
        if kind = "cycle"
            direction = 1
            if code = 4 then direction = -1
            CycleThemeSetting(state, name, direction)
            state.audioMgr.PlayNav()
            MarkDirty(state)
        else
            state.audioMgr.PlayDeadEnd()
        end if
        return
    end if

    if code = 6
        if kind = "palette"
            if state.themeMgr.SetThemeByName(name)
                ShowToast(state, "Palette: " + name)
                state.audioMgr.PlaySelect()
            else
                ShowToast(state, "That palette is not available")
                state.audioMgr.PlayDeadEnd()
            end if
            MarkDirty(state)
            return
        end if
        if kind = "action"
            RunThemeAction(state, name)
            return
        end if
        if kind = "cycle"
            CycleThemeSetting(state, name, 1)
            state.audioMgr.PlaySelect()
            MarkDirty(state)
            return
        end if
    end if

    if code = 13
        StartAmbientFromGallery(state)
        return
    end if

    HandleCommonKey(code, state)
end sub

sub CycleThemeSetting(state as object, name as string, direction as integer)
    tm = state.themeMgr
    if name = "autoSwitch"
        tm.SetAutoSwitchEnabled(not tm.autoSwitchEnabled)
        if tm.autoSwitchEnabled
            ShowToast(state, "Auto-rotation on - " + FormatInterval(tm.autoSwitchInterval))
        else
            ShowToast(state, "Auto-rotation off")
        end if
        return
    end if
    if name = "interval"
        tm.SetAutoSwitchInterval(CycleIntOption(AutoSwitchIntervalOptions(), tm.autoSwitchInterval, direction))
        state.autoSwitchInterval = tm.autoSwitchInterval
        ShowToast(state, "Rotation interval: " + FormatInterval(tm.autoSwitchInterval))
        return
    end if
    if name = "pool"
        tm.SetAutoSwitchPool(CycleOption(tm.AutoSwitchPoolOptions(), tm.autoSwitchPool, direction))
        ShowToast(state, "Rotation pool: " + tm.AutoSwitchPoolLabel())
        return
    end if
    if name = "target"
        tm.SetAutoSwitchTarget(CycleOption(tm.AutoSwitchTargetOptions(), tm.autoSwitchTarget, direction))
        ShowToast(state, "Rotation applies to: " + tm.AutoSwitchTargetLabel())
        return
    end if
end sub

sub RunThemeAction(state as object, name as string)
    item = LastViewedWallpaper(state)
    if item = invalid
        ShowToast(state, "Open a wallpaper first, then assign it here")
        state.audioMgr.PlayDeadEnd()
        MarkDirty(state)
        return
    end if

    if name = "ambient"
        if state.themeMgr.SetAmbientWallpaper(item)
            ShowToast(state, "Ambient Mode wallpaper: " + TruncateText(WallpaperTitle(item), 40))
        else
            ShowToast(state, "That wallpaper could not be assigned")
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if name = "backdrop"
        if state.themeMgr.SetBackdropWallpaper(item)
            state.backdropBmp = invalid
            state.backdropKey = ""
            ShowToast(state, "Menu backdrop: " + TruncateText(WallpaperTitle(item), 40))
        else
            ShowToast(state, "That wallpaper could not be assigned")
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if
end sub

' ─── PRO STORE ────────────────────────────────────────────────────────

sub HandleStoreInput(code as integer, state as object)
    rowCount = StoreRowCount()

    if code = 0
        ExitToView(state, "gallery")
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        state.storeIdx = WrapIndex(state.storeIdx + direction, rowCount)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 6
        products = state.storeMgr.GetDisplayList()
        if state.storeIdx < products.Count()
            product = products[state.storeIdx]
            if state.licenseMgr.hasFullVersion and SafeStr(product.kind) = "lifetime"
                ShowToast(state, "You already own Pro Lifetime - thank you")
                state.audioMgr.PlayDeadEnd()
                return
            end if
            if not state.storeMgr.IsAvailable()
                ShowToast(state, "Roku Pay is unavailable on this device")
                state.audioMgr.PlayDeadEnd()
                return
            end if

            ' DoOrder() blocks while the Roku Pay sheet is up, so paint the
            ' notice and present it first.
            ShowToast(state, "Opening Roku Pay for " + SafeStr(product.name) + "...")
            RenderFrame(state)
            state.screen.SwapBuffers()

            if state.storeMgr.Purchase(SafeStr(product.code))
                ShowToast(state, "Purchase submitted - confirming with Roku Pay")
            else
                ShowToast(state, state.storeMgr.LastError())
            end if
        else
            ' Restore purchases.
            ShowToast(state, "Restoring purchases from your Roku account...")
            state.storeMgr.Refresh()
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    if code = 13 ' Play: start the trial
        StartTrial(state)
        return
    end if

    if code = 7 or code = 9 ' Developer-only licence shortcuts
        if IsDevBuild()
            if code = 7
                state.licenseMgr.ExpireTrialForTesting()
                ShowToast(state, "Developer build: trial forced to expire")
            else
                state.licenseMgr.ResetForTesting()
                ShowToast(state, "Developer build: licence state reset")
            end if
            MarkDirty(state)
        else
            ShowToast(state, "Licensing shortcuts are only available on developer builds")
        end if
        return
    end if

    HandleCommonKey(code, state)
end sub

sub StartTrial(state as object)
    if state.licenseMgr.HasProAccess()
        ShowToast(state, "Pro is already unlocked on this device")
    else if state.licenseMgr.trialStartedMs > 0
        ShowToast(state, "The trial has already been used on this device")
    else
        state.licenseMgr.StartTrial()
        ShowToast(state, "3-day Spotlight Pro trial started")
    end if
    state.audioMgr.PlaySelect()
    MarkDirty(state)
end sub

' ─── SETTINGS ─────────────────────────────────────────────────────────

sub HandleSettingsInput(code as integer, state as object)
    items = BuildSettingsItems(state)
    rowCount = items.Count()
    if rowCount = 0
        if code = 0 then ExitToView(state, "gallery")
        return
    end if

    if code = 0
        ExitToView(state, "gallery")
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        state.settingsIdx = WrapIndex(state.settingsIdx + direction, rowCount)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    item = items[state.settingsIdx]
    kind = SafeStr(item.kind)
    title = SafeStr(item.title)

    if code = 4 or code = 5
        if kind = "cycle"
            direction = 1
            if code = 4 then direction = -1
            CycleSetting(state, title, direction)
            state.audioMgr.PlayNav()
            MarkDirty(state)
        else
            state.audioMgr.PlayDeadEnd()
        end if
        return
    end if

    if code = 6
        if kind = "cycle"
            CycleSetting(state, title, 1)
            state.audioMgr.PlaySelect()
        else
            RunSettingsAction(state, title)
        end if
        MarkDirty(state)
        return
    end if

    if code = 13
        StartTrial(state)
        return
    end if

    if code = 10
        state.filterMode = true
        state.filterRow = 0
        MarkDirty(state)
        return
    end if

    HandleCommonKey(code, state)
end sub

sub CycleSetting(state as object, title as string, direction as integer)
    sm = state.settingsMgr

    if title = "Clock Format"
        sm.Save("clockFormat", CycleOption(ClockFormatOptions(), sm.GetStr("clockFormat", "auto"), direction))
        state.lastClockMs = -60000 ' force an immediate clock refresh
        ShowToast(state, "Clock: " + LabelFor(ClockFormatLabels(), sm.clockFormat))
        return
    end if

    if title = "Navigation Sounds"
        enabled = not sm.GetBool("soundEffects", true)
        sm.Save("soundEffects", BoolStr(enabled))
        state.audioMgr.SetEnabled(enabled)
        ShowToast(state, "Navigation sounds " + OnOff(enabled))
        return
    end if

    if title = "Ambient Interval"
        nextInterval = CycleIntOption(AmbientIntervalOptions(), sm.GetInt("ambientInterval", 30), direction)
        sm.Save("ambientInterval", StrI(nextInterval).Trim())
        state.autoSwitchInterval = nextInterval
        state.switchAtMs = state.animClock.TotalMilliseconds()
        ShowToast(state, "Ambient interval: " + FormatInterval(nextInterval))
        return
    end if

    if title = "Safe Area Guides"
        sm.Save("safeAreaGuides", CycleOption(SafeAreaOptions(), sm.GetStr("safeAreaGuides", "off"), direction))
        ShowToast(state, "Safe area guides: " + LabelFor(SafeAreaLabels(), sm.safeAreaGuides))
        return
    end if
end sub

sub RunSettingsAction(state as object, title as string)
    sm = state.settingsMgr

    if title = "Menu Backdrop"
        if state.themeMgr.backdropWallpaperId = 0
            if state.dailyWallpaper <> invalid
                state.themeMgr.SetBackdropWallpaper(state.dailyWallpaper)
                ShowToast(state, "Menu backdrop set to today's Daily Spotlight")
            else
                ShowToast(state, "Pick a backdrop in Theme Studio first")
            end if
        else
            state.themeMgr.SetBackdropWallpaper(invalid)
            sm.Save("ssWallpaperId", "0")
            state.themeMgr.backdropWallpaperId = 0
            ShowToast(state, "Menu backdrop removed")
        end if
        state.backdropBmp = invalid
        state.backdropKey = ""
        state.audioMgr.PlaySelect()
        return
    end if

    if title = "Restore Last Position"
        RestorePosition(state)
        ShowToast(state, "Jumped back to where you left off")
        state.audioMgr.PlaySelect()
        return
    end if

    if title = "Clear Image Cache"
        state.imgLoader.ClearCache()
        state.backdropBmp = invalid
        ShowToast(state, "Image caches cleared")
        state.audioMgr.PlaySelect()
        return
    end if

    if title = "Reset Filters"
        ResetFilters(state)
        ShowToast(state, "All filters reset")
        state.audioMgr.PlaySelect()
        return
    end if

    if title = "Spotlight Pro Trial"
        StartTrial(state)
        return
    end if

    if title = "About Spotlight Studio"
        ShowToast(state, "Spotlight Studio " + state.appVersion + " - an independent fan project")
        state.audioMgr.PlaySelect()
        return
    end if

    state.audioMgr.PlayDeadEnd()
end sub

' ─── FILTER MODAL ─────────────────────────────────────────────────────

sub HandleFilterInput(code as integer, state as object)
    rowCount = FilterRowCount()

    if code = 0 ' Back closes the dialog without applying anything new
        state.filterMode = false
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 2 or code = 3
        direction = 1
        if code = 2 then direction = -1
        state.filterRow = WrapIndex(state.filterRow + direction, rowCount)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 4 or code = 5 or code = 6
        direction = 1
        if code = 4 then direction = -1
        if code = 6 then direction = 1

        if state.filterRow = 5 ' Search opens the keyboard instead of cycling
            if code = 6 or code = 5
                state.filterMode = false
                state.searchMode = true
                state.kbRow = 1
                state.kbCol = 4
                state.audioMgr.PlaySelect()
                MarkDirty(state)
            end if
            return
        end if

        if code = 6
            ' OK applies and closes: the filters are already live, so this just
            ' returns the user to the results.
            state.filterMode = false
            ShowToast(state, StrI(state.filtered.Count()).Trim() + " wallpapers match")
            state.audioMgr.PlaySelect()
            MarkDirty(state)
            return
        end if

        CycleFilterRow(state, state.filterRow, direction)
        state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 10 ' (*) reset everything
        ResetFilters(state)
        ShowToast(state, "Filters reset - showing the full archive")
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    HandleCommonKey(code, state)
end sub

sub CycleFilterRow(state as object, row as integer, direction as integer)
    sm = state.settingsMgr
    if row = 0
        sm.Save("activeCategory", CycleOption(CategoryOptions(), sm.GetStr("activeCategory", "All"), direction))
    else if row = 1
        sm.Save("activeResolution", CycleOption(ResolutionOptions(), sm.GetStr("activeResolution", "All"), direction))
    else if row = 2
        sm.Save("activeSource", CycleOption(SourceOptions(), sm.GetStr("activeSource", "All"), direction))
    else if row = 3
        sm.Save("sortOrder", CycleOption(SortOptions(), sm.GetStr("sortOrder", "newest"), direction))
    else if row = 4
        sm.Save("activeTag", CycleOption(TagOptions(), sm.GetStr("activeTag", ""), direction))
    else if row = 6
        sm.Save("favoritesOnly", BoolStr(not sm.GetBool("favoritesOnly", false)))
    else
        return
    end if
    ApplyFilters(state)
end sub

' ─── SEARCH MODAL ─────────────────────────────────────────────────────

sub HandleSearchInput(code as integer, msg as object, state as object)
    sm = state.settingsMgr

    if code = 0 ' Back deletes, and closes once the query is empty
        query = sm.GetStr("searchQuery", "")
        if Len(query) > 0
            sm.Save("searchQuery", Left(query, Len(query) - 1))
            ApplyFilters(state)
            state.audioMgr.PlayNav()
        else
            state.searchMode = false
            state.filterMode = true
            state.filterRow = 5
            state.audioMgr.PlayNav()
        end if
        MarkDirty(state)
        return
    end if

    if code = 2 or code = 3 or code = 4 or code = 5
        dx = 0
        dy = 0
        if code = 4 then dx = -1
        if code = 5 then dx = 1
        if code = 2 then dy = -1
        if code = 3 then dy = 1
        if MoveKeyboardCursor(state, dx, dy) then state.audioMgr.PlayNav()
        MarkDirty(state)
        return
    end if

    if code = 10 ' (*) clear the query
        sm.Save("searchQuery", "")
        ApplyFilters(state)
        ShowToast(state, "Search cleared")
        MarkDirty(state)
        return
    end if

    if code = 6 ' Select the focused key
        key = KeyboardFocusedKey(state)
        if key = KeyboardCancelKey()
            state.searchMode = false
            state.filterMode = true
            state.filterRow = 5
        else if key = KeyboardSearchKey()
            state.searchMode = false
            SetTab(state, TabGallery())
            state.activeView = "gallery"
            state.focusArea = "grid"
            ShowToast(state, StrI(state.filtered.Count()).Trim() + " wallpapers match")
        else if key = KeyboardClearKey()
            sm.Save("searchQuery", "")
            ApplyFilters(state)
        else if key = KeyboardSpaceKey()
            if Len(sm.GetStr("searchQuery", "")) < 40
                sm.Save("searchQuery", sm.GetStr("searchQuery", "") + " ")
                ApplyFilters(state)
            end if
        else if key <> ""
            query = sm.GetStr("searchQuery", "")
            if Len(query) < 40
                sm.Save("searchQuery", query + LCase(key))
                ApplyFilters(state)
            else
                state.audioMgr.PlayDeadEnd()
                return
            end if
        end if
        state.audioMgr.PlaySelect()
        MarkDirty(state)
        return
    end if

    ' Physical keyboards (and the simulator's remote-control mode) deliver
    ' characters through GetChar().
    if msg <> invalid
        charCode = 0
        charCode = msg.GetChar()
        if charCode >= 32 and charCode < 127
            query = sm.GetStr("searchQuery", "")
            if Len(query) < 40
                sm.Save("searchQuery", query + Chr(charCode))
                ApplyFilters(state)
                MarkDirty(state)
            end if
            return
        end if
        if charCode = 8 ' backspace
            query = sm.GetStr("searchQuery", "")
            if Len(query) > 0
                sm.Save("searchQuery", Left(query, Len(query) - 1))
                ApplyFilters(state)
                MarkDirty(state)
            end if
            return
        end if
    end if

    HandleCommonKey(code, state)
end sub

' ─── KEYS SHARED BY EVERY SCREEN ──────────────────────────────────────

sub HandleCommonKey(code as integer, state as object)
    if code = 11 or code = 12 ' channel up / down on legacy remotes
        ShowToast(state, "Use Left and Right to browse")
        MarkDirty(state)
        return
    end if
    if code = 19 ' Find Remote
        ShowToast(state, "Find Remote pressed - the Roku OS handles this")
        MarkDirty(state)
        return
    end if
    if code = 15 or code = 16 or code = 20 ' volume / mute belong to the OS
        return
    end if
end sub

' ─── NAVIGATION HELPERS ───────────────────────────────────────────────

sub MarkDirty(state as object)
    state.dirty = true
end sub

sub ShowToast(state as object, message as string)
    state.toastMessage = message
    state.toastUntilMs = state.animClock.TotalMilliseconds() + 2400
    state.dirty = true
end sub

sub ChangePage(state as object, targetPage as integer)
    pageSize = GalleryPageSize()
    totalPages = MaxI(1, CeilDivI(state.filtered.Count(), pageSize))
    newPage = ClampI(targetPage, 0, totalPages - 1)
    if newPage = state.currentPage then return

    state.currentPage = newPage
    state.gridIdx = ClampI(state.gridIdx, 0, pageSize - 1)
    StartPageFade(state)
    state.imgLoader.PrioritizeVisible(CurrentPageItems(state))
    RememberPosition(state)
end sub

sub ChangeScreensaverPage(state as object, targetPage as integer)
    pageSize = ScreensaverPageSize()
    totalPages = MaxI(1, CeilDivI(state.screensaverList.Count(), pageSize))
    newPage = ClampI(targetPage, 0, totalPages - 1)
    if newPage = state.currentPageSS then return

    state.currentPageSS = newPage
    state.ssGridIdx = ClampI(state.ssGridIdx, 0, pageSize - 1)
    StartPageFade(state)
    state.imgLoader.PrioritizeVisible(CurrentScreensaverPageItems(state))
end sub

sub StartPageFade(state as object)
    state.transitioning = true
    state.transitionStartMs = state.animClock.TotalMilliseconds()
    state.dirty = true
end sub

' Everything the viewer and Ambient Mode operate on goes through one list and
' one index, so Left/Right always moves to a neighbour of what is on screen.
sub EnterViewer(state as object, list as object, idx as integer, returnView as string)
    if list = invalid or list.Count() = 0
        ShowToast(state, "There is nothing to open")
        return
    end if
    state.browseList = list
    state.browseIdx = WrapIndex(idx, list.Count())
    state.returnView = returnView
    state.activeView = "viewer"
    state.showHud = true
    state.zoomScale = 1.0
    state.slideshowActive = false
    RememberWallpaper(state)
    PrefetchNeighbours(state)
    MarkDirty(state)
end sub

sub EnterAmbient(state as object, list as object, idx as integer, returnView as string)
    if list = invalid or list.Count() = 0
        ShowToast(state, "There is nothing to show in Ambient Mode")
        return
    end if
    state.browseList = list
    state.browseIdx = WrapIndex(idx, list.Count())
    state.returnView = returnView
    state.activeView = "ambient"
    state.ambientShowInfo = true
    state.ambientTransition = 0
    state.slideshowActive = true
    state.switchAtMs = state.animClock.TotalMilliseconds()
    state.autoSwitchInterval = state.settingsMgr.GetInt("ambientInterval", 30)
    RememberWallpaper(state)
    PrefetchNeighbours(state)
    ShowToast(state, "Ambient Mode - press Play to pause, any other key to exit")
    MarkDirty(state)
end sub

' Ambient Mode launched from a screen with no focused item.
sub StartAmbientFromGallery(state as object)
    pool = state.themeMgr.BuildRotationPool(state.filtered)
    if pool.Count() = 0 then pool = state.filtered
    if pool.Count() = 0
        ShowToast(state, "There is nothing to show in Ambient Mode")
        MarkDirty(state)
        return
    end if
    EnterAmbient(state, pool, 0, state.activeView)
end sub

sub ExitToView(state as object, viewName as string)
    state.activeView = viewName
    state.slideshowActive = false
    state.ambientTransition = 0
    state.browseList = []
    state.browseIdx = 0

    if viewName = "gallery"
        state.focusArea = "grid"
        state.activeTab = TabGallery()
        state.imgLoader.PrioritizeVisible(CurrentPageItems(state))
    else if viewName = "screensavers"
        state.activeTab = TabScreensavers()
        state.imgLoader.PrioritizeVisible(CurrentScreensaverPageItems(state))
    else if viewName = "daily"
        state.activeTab = TabDaily()
    else if viewName = "theme"
        state.activeTab = TabTheme()
    else if viewName = "settings"
        state.activeTab = TabSettings()
    else if viewName = "store"
        state.activeTab = TabStore()
    end if

    RememberPosition(state)
    state.audioMgr.PlayNav()
    MarkDirty(state)
end sub

sub ToggleFavorite(state as object, item as object)
    if item = invalid
        ShowToast(state, "Nothing to favourite here")
        MarkDirty(state)
        return
    end if

    nowFav = state.favMgr.Toggle(item.id)
    if nowFav
        ShowToast(state, "Added to Favorites: " + TruncateText(WallpaperTitle(item), 40))
    else
        ShowToast(state, "Removed from Favorites")
    end if

    ' The favourites tab and the "favorites only" filter both depend on the set.
    if state.settingsMgr.GetBool("favoritesOnly", false) then ApplyFilters(state)
    state.audioMgr.PlaySelect()
    MarkDirty(state)
end sub

sub ResetFilters(state as object)
    sm = state.settingsMgr
    sm.Save("activeCategory", "All")
    sm.Save("activeResolution", "All")
    sm.Save("activeSource", "All")
    sm.Save("sortOrder", "newest")
    sm.Save("activeTag", "")
    sm.Save("favoritesOnly", "0")
    sm.Save("searchQuery", "")
    ApplyFilters(state)
end sub

' Rebuild the working lists from the persisted filter state.
sub ApplyFilters(state as object)
    sm = state.settingsMgr
    state.filtered = FilterWallpapers(state.allWallpapers, sm.GetStr("activeCategory", "All"), sm.GetStr("activeResolution", "All"), sm.GetStr("activeSource", "All"), sm.GetStr("searchQuery", ""), sm.GetBool("favoritesOnly", false), state.favMgr, sm.GetStr("sortOrder", "newest"))

    state.currentPage = 0
    state.gridIdx = 0
    state.screensaverList = BuildScreensaverList(state.filtered)
    state.currentPageSS = 0
    state.ssGridIdx = 0

    ' Keep the browse session pointing at something real.
    if state.browseList.Count() > 0
        state.browseIdx = WrapIndex(state.browseIdx, state.browseList.Count())
    end if

    state.imgLoader.PrioritizeVisible(CurrentPageItems(state))
    MarkDirty(state)
end sub

' ─── LIST HELPERS ─────────────────────────────────────────────────────

' The Ambient Collection prefers Ultra-HD landscape shots, then anything tagged
' landscape.  It falls back to the whole filtered set so the tab is never empty
' (an empty list used to crash the detail panel on an invalid current item).
function BuildScreensaverList(items as object) as object
    result = []
    if items = invalid then return result

    ultraHd = []
    landscape = []
    for each item in items
        if item <> invalid
            if IsUltraHd(item)
                ultraHd.Push(item)
            else if ContainsCI(SafeStr(item.tags), "landscape")
                landscape.Push(item)
            end if
        end if
    end for

    result.Append(ultraHd)
    result.Append(landscape)
    if result.Count() = 0 and items.Count() > 0 then result.Append(items)
    return result
end function

' The items the current view is showing, for thumbnail prioritisation.
function CurrentPageItems(state as object) as object
    if state.activeView = "screensavers" then return CurrentScreensaverPageItems(state)
    if state.activeView = "viewer" or state.activeView = "ambient" then return CurrentBrowseItems(state)
    if state.activeView = "daily"
        if state.dailyWallpaper <> invalid then return [state.dailyWallpaper]
        return []
    end if

    items = []
    pageSize = GalleryPageSize()
    startIdx = state.currentPage * pageSize
    total = state.filtered.Count()
    for i = 0 to pageSize - 1
        idx = startIdx + i
        if idx >= total then exit for
        items.Push(state.filtered[idx])
    end for
    return items
end function

function CurrentScreensaverPageItems(state as object) as object
    items = []
    pageSize = ScreensaverPageSize()
    startIdx = state.currentPageSS * pageSize
    total = state.screensaverList.Count()
    for i = 0 to pageSize - 1
        idx = startIdx + i
        if idx >= total then exit for
        items.Push(state.screensaverList[idx])
    end for
    return items
end function

' The viewer/ambient frame plus its two neighbours, so browsing feels instant.
function CurrentBrowseItems(state as object) as object
    items = []
    total = state.browseList.Count()
    if total = 0 then return items
    idx = WrapIndex(state.browseIdx, total)
    items.Push(state.browseList[idx])
    return items
end function

sub PrefetchNeighbours(state as object)
    total = state.browseList.Count()
    if total = 0 then return

    idx = WrapIndex(state.browseIdx, total)
    nextIdx = WrapIndex(idx + 1, total)
    prevIdx = WrapIndex(idx - 1, total)

    curItem = state.browseList[idx]
    if curItem <> invalid then state.imgLoader.PrefetchFull(WallpaperFilename(curItem))
    nextItem = state.browseList[nextIdx]
    if nextItem <> invalid then state.imgLoader.PrefetchFull(WallpaperFilename(nextItem))
    prevItem = state.browseList[prevIdx]
    if prevItem <> invalid then state.imgLoader.PrefetchFull(WallpaperFilename(prevItem))
end sub

' ─── POSITION PERSISTENCE ─────────────────────────────────────────────

sub RememberPosition(state as object)
    sm = state.settingsMgr
    sm.Save("lastActiveTab", StrI(state.activeTab).Trim())
    sm.Save("lastPage", StrI(state.currentPage).Trim())
    sm.Save("lastGridIdx", StrI(state.gridIdx).Trim())
end sub

sub RememberWallpaper(state as object)
    if state.browseList.Count() = 0 then return
    idx = WrapIndex(state.browseIdx, state.browseList.Count())
    item = state.browseList[idx]
    if item <> invalid then state.settingsMgr.Save("lastWallpaperId", SafeStr(item.id))
end sub

' Reopen the channel where the user left it (certification 4.1: updates must
' persist saved data).
sub RestorePosition(state as object)
    sm = state.settingsMgr
    tabIdx = sm.GetInt("lastActiveTab", 0)
    if tabIdx < 0 or tabIdx >= NavTabs().Count() then tabIdx = 0

    ' The Filter tab is an action, not a destination - land on the gallery.
    if tabIdx = TabFilter() then tabIdx = TabGallery()

    SetTab(state, tabIdx)
    ActivateTab(state)

    if state.activeView = "gallery"
        pageSize = GalleryPageSize()
        totalPages = MaxI(1, CeilDivI(state.filtered.Count(), pageSize))
        state.currentPage = ClampI(sm.GetInt("lastPage", 0), 0, totalPages - 1)
        state.gridIdx = ClampI(sm.GetInt("lastGridIdx", 0), 0, pageSize - 1)
        absoluteIdx = (state.currentPage * pageSize) + state.gridIdx
        if absoluteIdx >= state.filtered.Count()
            state.currentPage = 0
            state.gridIdx = 0
        end if
        state.focusArea = "grid"
    end if
end sub

' ─── DEEP LINKING ─────────────────────────────────────────────────────
' ECP:  curl -d '' "http://<roku>:8060/launch/dev?contentID=1234&mediaType=wallpaper"
'       curl -d '' "http://<roku>:8060/input?contentID=1234"
' While the channel is already running the same parameters arrive as an
' roInputEvent (certification 5.2 Direct to Play).

sub ResolveDeepLink(state as object, args as dynamic)
    if args = invalid then return
    if type(args) <> "roAssociativeArray" then return
    ApplyDeepLinkParams(state, args)
end sub

sub HandleEcpInput(msg as object, state as object)
    if msg = invalid then return
    isInput = false
    isInput = msg.IsInput()
    if not isInput then return

    info = msg.GetInfo()
    if info = invalid then return
    ApplyDeepLinkParams(state, info)
end sub

sub ApplyDeepLinkParams(state as object, params as object)
    ' Parameter names arrive in whatever case the launcher used.
    contentId = DeepLinkValue(params, ["contentID", "contentId", "contentid", "id"])
    query = DeepLinkValue(params, ["query", "search", "keyword"])
    action = LCase(DeepLinkValue(params, ["action", "mode"]))

    if query <> ""
        state.settingsMgr.Save("searchQuery", TruncateText(query, 40))
        ApplyFilters(state)
        SetTab(state, TabGallery())
        ActivateTab(state)
        state.activeView = "gallery"
        state.focusArea = "grid"
        ShowToast(state, "Deep link search: " + TruncateText(query, 30) + " (" + StrI(state.filtered.Count()).Trim() + " matches)")
        MarkDirty(state)
        return
    end if

    if contentId <> ""
        idx = FindWallpaperIndex(state.filtered, contentId)
        list = state.filtered
        if idx < 0
            idx = FindWallpaperIndex(state.allWallpapers, contentId)
            list = state.allWallpapers
        end if
        if idx >= 0
            if action = "ambient"
                EnterAmbient(state, list, idx, "gallery")
            else
                EnterViewer(state, list, idx, "gallery")
            end if
            ShowToast(state, "Opened wallpaper #" + contentId + " from a deep link")
        else
            ShowToast(state, "Wallpaper " + contentId + " is not in this archive")
        end if
        MarkDirty(state)
        return
    end if

    if action = "ambient"
        StartAmbientFromGallery(state)
        return
    end if
    if action = "daily"
        SetTab(state, TabDaily())
        ActivateTab(state)
        MarkDirty(state)
        return
    end if
end sub

function DeepLinkValue(params as object, names as object) as string
    for each name in names
        if params.DoesExist(name)
            value = SafeStr(params[name])
            if value <> "" then return value
        end if
    end for
    return ""
end function
