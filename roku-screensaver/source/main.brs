' Spotlight Studio Ambient - standalone Roku screensaver
' main.brs - The ONLY entry points a screensaver may expose.
'
' Roku's screensaver policy is strict, and this file is written around it:
'   * RunScreenSaver() is the discovery entry point.  Main() and
'     RunUserInterface() are PROHIBITED in a screensaver and are not present.
'   * A screensaver accepts no user input: any key press ends it and returns the
'     viewer to whatever app was running.
'   * roChannelStore, roAudioPlayer and roVideoPlayer may not be used, so this
'     package links only the image, theme, catalog and utility modules.
'   * RunScreenSaverSettings() is optional; implementing it adds a
'     "Change screensaver settings" entry to the screensaver's detail menu.
'
' Build it with:  python3 scripts/package_roku.py --variant screensaver
' which copies the shared modules out of roku/source into a standalone package
' under dist/roku-screensaver/.

sub RunScreenSaver()
    port = CreateObject("roMessagePort")
    screen = CreateObject("roScreen", true, 1920, 1080)
    if screen = invalid then screen = CreateObject("roScreen", true)
    if screen = invalid then return
    screen.SetMessagePort(port)
    screen.SetAlphaEnable(true)

    settings = CreateSaverSettings()
    ApplyThemePalette(settings.paletteName)
    fonts = BuildSaverFonts()

    catalog = LoadCatalog()
    pool = BuildSaverPool(catalog, settings)
    if pool.Count() = 0 then return

    loader = CreateImageLoader(port, settings.loaderSettings)

    deviceInfo = CreateObject("roDeviceInfo")
    animClock = CreateObject("roTimespan")
    animClock.Mark()
    stallClock = CreateObject("roTimespan")
    stallClock.Mark()

    idx = Rnd(pool.Count()) - 1
    intervalMs = settings.intervalSeconds * 1000
    phaseStart = animClock.TotalMilliseconds()
    transition = 0 ' 0 = idle, 1 = dip to black, 2 = reveal
    exitNow = false
    dirty = true
    lastFrame = 0
    lastClockMs = -60000
    clockInfo = GetDeviceLocalTime(deviceInfo, "auto")
    ' Warm the NEXT frame while the current one is still on screen, so the dip
    ' to black reveals a decoded image instead of an empty canvas.
    loader.PrefetchFull(WallpaperFilename(pool[WrapIndex(idx + 1, pool.Count())]))

    while not exitNow
        nowMs = animClock.TotalMilliseconds()

        msg = port.WaitMessage(50)
        if msg <> invalid
            if type(msg) = "roUniversalControlEvent"
                ' Any remote input terminates a screensaver.
                exitNow = true
            else if type(msg) = "roUrlEvent"
                if loader.HandleUrlEvent(msg) then dirty = true
            else if type(msg) = "roTextureRequestEvent"
                if loader.HandleTextureEvent(msg) then dirty = true
            end if

            extra = port.GetMessage()
            while extra <> invalid
                if type(extra) = "roUrlEvent" then loader.HandleUrlEvent(extra)
                if type(extra) = "roTextureRequestEvent" then loader.HandleTextureEvent(extra)
                extra = port.GetMessage()
            end while
        end if
        if exitNow then exit while

        ' ── transition state machine ───────────────────────────────────
        curItem = pool[WrapIndex(idx, pool.Count())]
        curBmp = loader.GetFullImage(WallpaperFilename(curItem))

        if transition = 1 and (nowMs - phaseStart) >= 600
            idx = WrapIndex(idx + 1, pool.Count())
            transition = 2
            phaseStart = nowMs
            ' Keep the frame after next warm so the slideshow never waits on
            ' the network mid-transition.
            loader.PrefetchFull(WallpaperFilename(pool[WrapIndex(idx + 1, pool.Count())]))
            dirty = true
        else if transition = 2 and (nowMs - phaseStart) >= 800
            transition = 0
            dirty = true
        else if transition = 0 and curBmp <> invalid and (nowMs - phaseStart) >= intervalMs
            transition = 1
            phaseStart = nowMs
            dirty = true
        end if

        ' Never leave the viewer staring at a black panel: if nothing has
        ' decoded for 45 seconds, hand control back to the OS screensaver.
        ' The clock is re-marked whenever a frame arrives, so a slow network
        ' that is still making progress is not treated as a stall (the previous
        ' version measured from process start and exited permanently after 45s
        ' of runtime the first time any single image was slow).
        if curBmp <> invalid
            ' Progress: restart the stall window.
            stallClock.Mark()
        else if transition = 0 and stallClock.TotalMilliseconds() > 45000
            exitNow = true
        end if

        ' ── clock refresh (throttled: it allocates an roDateTime) ───────
        if nowMs - lastClockMs >= 15000
            lastClockMs = nowMs
            clockInfo = GetDeviceLocalTime(deviceInfo, "auto")
            dirty = true
        end if

        ' ── render ─────────────────────────────────────────────────────
        if dirty or (nowMs - lastFrame) >= 66
            RenderSaverFrame(screen, fonts, curBmp, nowMs, transition, phaseStart, settings, clockInfo)
            screen.SwapBuffers()
            dirty = false
            lastFrame = nowMs
        end if
    end while

    loader.ClearCache()
end sub

' roFont has no Copy() and no SetSize().  The only documented way to obtain a
' font at a given pixel size is roFontRegistry.GetDefaultFont(size, bold,
' italic) - see the same note in roku/source/main.brs::BuildFonts().
function SaverFont(registry as object, size as integer) as object
    if registry = invalid then return invalid
    font = registry.GetDefaultFont(size, false, false)
    if font <> invalid then return font
    return registry.GetDefaultFont()
end function

function BuildSaverFonts() as object
    registry = CreateObject("roFontRegistry")
    if registry = invalid
        return { clock: invalid, date: invalid, title: invalid, body: invalid, small: invalid }
    end if

    return {
        clock: SaverFont(registry, 56),
        date: SaverFont(registry, 22),
        title: SaverFont(registry, 34),
        body: SaverFont(registry, 24),
        small: SaverFont(registry, 18)
    }
end function

sub RenderSaverFrame(screen as object, fonts as object, bmp as object, animMs as integer, transition as integer, phaseStart as integer, settings as object, clockInfo as object)
    t = GetTheme()
    screen.Clear(t.bgMain)

    if bmp <> invalid and bmp.GetWidth() > 1
        srcW = bmp.GetWidth()
        srcH = bmp.GetHeight()

        ' Slow Ken Burns: a 30-second breathing zoom with a diagonal drift.
        cycle = (animMs MOD 30000) / 30000.0
        wave = Sin(cycle * 6.283185)
        waveCos = Cos(cycle * 6.283185)
        zoom = 1.05 + (0.05 * wave)
        scale = MaxF(1920.0 / srcW, 1080.0 / srcH) * zoom

        drawW = MaxI(1, CInt(srcW * scale))
        drawH = MaxI(1, CInt(srcH * scale))
        panX = CInt(wave * MaxI(0, CInt((drawW - 1920) / 2)) * 0.8)
        panY = CInt(waveCos * MaxI(0, CInt((drawH - 1080) / 2)) * 0.8)
        DrawScaledTo(screen, CInt((1920 - drawW) / 2) + panX, CInt((1080 - drawH) / 2) + panY, drawW, drawH, bmp)
    end if

    alpha = 0
    if transition = 1
        alpha = CInt(255 * ClampF((animMs - phaseStart) / 600.0, 0.0, 1.0))
    else if transition = 2
        alpha = CInt(255 * (1.0 - ClampF((animMs - phaseStart) / 800.0, 0.0, 1.0)))
    end if
    if alpha > 0 then screen.DrawRect(0, 0, 1920, 1080, WithAlpha(0, alpha))

    if settings.showClock and bmp <> invalid and fonts.clock <> invalid
        ' The clock fades with the image so the dip to black stays clean.
        textAlpha = ClampI(255 - alpha, 0, 255)
        timeStr = SafeStr(clockInfo.time)
        dateStr = SafeStr(clockInfo.date)
        timeW = fonts.clock.GetOneLineWidth(timeStr, 1920)
        dateW = fonts.date.GetOneLineWidth(dateStr, 1920)
        screen.DrawText(timeStr, CInt((1920 - timeW) / 2), 880, WithAlpha(&hF4F5F8, textAlpha), fonts.clock)
        screen.DrawText(dateStr, CInt((1920 - dateW) / 2), 956, WithAlpha(&h9CA3B8, textAlpha), fonts.date)
    end if
end sub

' ─── SETTINGS STORE ───────────────────────────────────────────────────

function CreateSaverSettings() as object
    section = CreateObject("roRegistrySection", "SpotlightScreensaver")

    settings = {
        section: section,
        intervalSeconds: 30,
        poolName: "landscape",
        paletteName: "Obsidian Slate",
        showClock: true,

        ' CreateImageLoader() only needs GetStr("imageBase"), so this stand-in
        ' keeps the shared module usable without the channel's settings manager.
        loaderSettings: {
            imageBase: "https://media.githubusercontent.com/media/KetanDutt/SpotlightStudio/main",
            GetStr: function(key as string, fallback as string) as string
                if key = "imageBase" and m.imageBase <> "" then return m.imageBase
                return fallback
            end function
        },

        Load: function() as void
            if m.section = invalid then return
            if m.section.Exists("interval") then m.intervalSeconds = Val(SafeStr(m.section.Read("interval")))
            if m.section.Exists("pool") then m.poolName = SafeStr(m.section.Read("pool"))
            if m.section.Exists("palette") then m.paletteName = SafeStr(m.section.Read("palette"))
            if m.section.Exists("clock") then m.showClock = (Val(SafeStr(m.section.Read("clock"))) = 1)
            if m.intervalSeconds < 5 then m.intervalSeconds = 30
            if m.paletteName = "" then m.paletteName = "Obsidian Slate"
        end function,

        Save: function() as void
            if m.section = invalid then return
            m.section.Write("interval", StrI(m.intervalSeconds).Trim())
            m.section.Write("pool", m.poolName)
            m.section.Write("palette", m.paletteName)
            m.section.Write("clock", m.Flag(m.showClock))
            m.section.Flush()
        end function,

        Flag: function(value as boolean) as string
            if value then return "1"
            return "0"
        end function
    }

    settings.Load()
    return settings
end function

function SaverPoolOptions() as object
    return ["landscape", "4k", "all"]
end function

function SaverPoolLabel(name as string) as string
    labels = { "landscape": "Landscape & scenery", "4k": "4K Ultra-HD only", "all": "Entire archive" }
    return LabelFor(labels, name)
end function

function SaverIntervalOptions() as object
    return [10, 15, 30, 60, 120, 300]
end function

' Ultra-HD first, then landscape, then everything - depending on the setting.
function BuildSaverPool(catalog as object, settings as object) as object
    pool = []
    if catalog = invalid then return pool

    mode = settings.poolName
    limit = catalog.Count()
    ' Bound the scan: a screensaver starts with very little time and memory.
    if mode <> "all" and limit > 1200 then limit = 1200

    for i = 0 to limit - 1
        item = catalog[i]
        if item <> invalid
            include = true
            if mode = "4k" then include = IsUltraHd(item)
            if mode = "landscape" then include = IsUltraHd(item) or ContainsCI(SafeStr(item.tags), "landscape")
            if include then pool.Push(item)
        end if
    end for

    if pool.Count() = 0 and catalog.Count() > 0 then pool.Push(catalog[0])
    return pool
end function

' ─── SCREENSAVER SETTINGS ENTRY POINT ─────────────────────────────────
' Implementing this adds "Change screensaver settings" to the screensaver's
' detail menu under Settings > Theme > Screensavers.

sub RunScreenSaverSettings()
    port = CreateObject("roMessagePort")
    screen = CreateObject("roScreen", true, 1920, 1080)
    if screen = invalid then screen = CreateObject("roScreen", true)
    if screen = invalid then return
    screen.SetMessagePort(port)
    screen.SetAlphaEnable(true)

    settings = CreateSaverSettings()
    ApplyThemePalette(settings.paletteName)
    fonts = BuildSaverFonts()

    row = 0
    rowCount = 4
    done = false
    dirty = true

    while not done
        msg = port.WaitMessage(100)
        if msg <> invalid and type(msg) = "roUniversalControlEvent"
            code = msg.GetInt()
            if code < 100
                if code = 0
                    done = true
                else if code = 2
                    row = WrapIndex(row - 1, rowCount)
                    dirty = true
                else if code = 3
                    row = WrapIndex(row + 1, rowCount)
                    dirty = true
                else if code = 4 or code = 5 or code = 6
                    direction = 1
                    if code = 4 then direction = -1
                    SaverCycleSetting(settings, row, direction)
                    dirty = true
                end if
            end if
        end if

        if dirty
            RenderSaverSettings(screen, fonts, settings, row)
            screen.SwapBuffers()
            dirty = false
        end if
    end while

    settings.Save()
end sub

sub SaverCycleSetting(settings as object, row as integer, direction as integer)
    if row = 0
        settings.intervalSeconds = CycleIntOption(SaverIntervalOptions(), settings.intervalSeconds, direction)
    else if row = 1
        settings.poolName = CycleOption(SaverPoolOptions(), settings.poolName, direction)
    else if row = 2
        settings.paletteName = CycleOption(GetPaletteNames(), settings.paletteName, direction)
        ApplyThemePalette(settings.paletteName)
    else if row = 3
        settings.showClock = not settings.showClock
    end if
end sub

sub RenderSaverSettings(screen as object, fonts as object, settings as object, row as integer)
    t = GetTheme()
    screen.Clear(t.bgMain)
    if fonts.body = invalid then return

    screen.DrawText("Spotlight Studio Ambient", 260, 180, t.textPrimary, fonts.title)
    screen.DrawText("Settings are saved when you press Back.", 260, 240, t.textSecondary, fonts.body)

    rows = [
        { label: "Slide interval", value: FormatInterval(settings.intervalSeconds) },
        { label: "Wallpaper pool", value: SaverPoolLabel(settings.poolName) },
        { label: "Colour palette", value: settings.paletteName },
        { label: "Show clock", value: YesNo(settings.showClock) }
    ]

    for i = 0 to rows.Count() - 1
        rowY = 360 + (i * 92)
        if row = i
            DrawRoundRect(screen, 240, rowY, 1440, 76, 12, t.accentSoft)
            DrawRoundedOutline(screen, 240, rowY, 1440, 76, 12, t.borderFocused, 2)
        end if
        screen.DrawText(SafeStr(rows[i].label), 280, rowY + 22, t.textPrimary, fonts.body)
        valueText = SafeStr(rows[i].value)
        valueW = fonts.body.GetOneLineWidth(valueText, 1920)
        screen.DrawText(valueText, 1640 - valueW, rowY + 22, t.textAccent, fonts.body)
    end for

    screen.DrawText("Up/Down move    Left/Right change    Back save and exit", 260, 780, t.textMuted, fonts.small)
end sub
