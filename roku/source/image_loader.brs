' Spotlight Studio for Roku
' image_loader.brs - Non-blocking two-tier image pipeline with bounded caches.
'
' Thumbnails (480x270 JPEG, ~22 KB)
'     roUrlTransfer.AsyncGetToFile -> tmp:/ -> roBitmap.  The on-disk copy means
'     a page the user returns to is instant for the rest of the session, and
'     tmp:/ is wiped by the OS when the channel exits.
'
' Full-size wallpapers
'     roTextureManager + roTextureRequest with SetSize(1920, 1080).  This is not
'     a stylistic choice: roBitmap is hard-capped at 2048x2048, so the 898 4K
'     (3840x2160) wallpapers in the archive can NEVER be decoded with
'     CreateObject("roBitmap", path) - it returns invalid.  The texture manager
'     decodes and rescales off the main thread and hands back a screen-sized
'     bitmap, which also removes a 79-160 ms decode stall from the render loop.
'     When the component is unavailable the loader falls back to the thumbnail
'     path, which still works for the 6,577 FHD wallpapers.
'
' Memory budget (roBitmap is 32 bits per pixel):
'     14 thumbnails @ 480x270      ~ 7.3 MB
'      2 full frames @ 1920x1080   ~16.6 MB
'     gfx_cache resamples/shapes   ~ 8.0 MB  (see gfx_cache.brs)
'     --------------------------------------
'                            peak ~32 MB of texture memory

function CreateImageLoader(port as object, settingsMgr as object) as object
    textureMgr = CreateObject("roTextureManager")
    if textureMgr <> invalid then textureMgr.SetMessagePort(port)

    loader = {
        port: port,
        settingsMgr: settingsMgr,
        textureMgr: textureMgr,

        ' Decoded bitmaps, least-recently-used first.
        thumbCache: {},
        fullCache: {},
        thumbKeys: [],
        fullKeys: [],
        maxThumbCache: 14,
        maxFullCache: 2,

        ' tmp:/ bookkeeping.  tmp:/ has a small per-device quota, so the on-disk
        ' thumbnail cache is byte-capped as well as entry-capped.
        fs: CreateObject("roFileSystem"),
        diskFiles: [],
        diskBytes: 0,
        diskBudget: 8388608, ' 8 MB

        ' Keys with no file on disk.  Without this the loader stats tmp:/ for
        ' every not-yet-downloaded card on every frame.
        missingKeys: {},

        ' filename (thumbs) / "full_"+filename (full frames) -> attempts made.
        failedKeys: {},
        maxAttempts: 3,

        ' In-flight tracking.
        inFlight: {},
        activeRequests: {},
        activeTextures: {},
        activeCount: 0,
        maxConcurrent: 4,
        requestTimeoutMs: 30000,

        ' Pending FIFO queue of { filename, isThumb, key, priority, queuedAt }.
        queue: [],
        enqueuedKeys: {},
        maxQueue: 240,

        ' Diagnostics surfaced on the Settings screen.
        stats: { thumbHits: 0, thumbMisses: 0, fullHits: 0, fullMisses: 0, downloaded: 0, failed: 0, textureFallbacks: 0 },

        ' ── cache primitives ─────────────────────────────────────────────

        SaveThumbBitmap: function(filename as string, bmp as object) as void
            if filename = invalid or bmp = invalid then return
            if not m.thumbCache.DoesExist(filename) then m.thumbKeys.Push(filename)
            m.thumbCache[filename] = bmp
            m.missingKeys.Delete(filename)
            GetGfxCache().DropScaledFor("t:" + filename)
            m.EvictThumbs()
        end function,

        SaveFullBitmap: function(filename as string, bmp as object) as void
            if filename = invalid or bmp = invalid then return
            if not m.fullCache.DoesExist(filename) then m.fullKeys.Push(filename)
            m.fullCache[filename] = bmp
            GetGfxCache().DropScaledFor("f:" + filename)
            m.EvictFulls()
        end function,

        EvictThumbs: function() as void
            guard = 0
            while m.thumbKeys.Count() > m.maxThumbCache and guard < 64
                guard = guard + 1
                oldest = m.thumbKeys.Shift()
                if oldest <> invalid
                    m.thumbCache.Delete(oldest)
                    GetGfxCache().DropScaledFor("t:" + oldest)
                end if
            end while
        end function,

        EvictFulls: function() as void
            guard = 0
            while m.fullKeys.Count() > m.maxFullCache and guard < 16
                guard = guard + 1
                oldest = m.fullKeys.Shift()
                if oldest <> invalid
                    m.fullCache.Delete(oldest)
                    GetGfxCache().DropScaledFor("f:" + oldest)
                end if
            end while
        end function,

        ' Mark a key as attempted-and-failed.  Returns true once the retry budget
        ' is exhausted, at which point the UI stops spinning and shows an
        ' offline placeholder instead of retrying forever.
        RecordFailure: function(key as string) as boolean
            attempts = 1
            if m.failedKeys.DoesExist(key) then attempts = SafeInt(m.failedKeys[key], 0) + 1
            m.failedKeys[key] = attempts
            m.stats.failed = m.stats.failed + 1
            return attempts >= m.maxAttempts
        end function,

        GiveUp: function(key as string) as boolean
            return SafeInt(m.failedKeys[key], 0) >= m.maxAttempts
        end function,

        GetSafeFilename: function(filename as string) as string
            if filename = invalid or filename = "" then return ""
            safe = ReplaceStr(filename, "/", "_")
            safe = ReplaceStr(safe, "\", "_")
            safe = ReplaceStr(safe, ":", "_")
            return safe
        end function,

        ThumbPath: function(filename as string) as string
            return "tmp:/t_" + m.GetSafeFilename(filename)
        end function,

        ' ── public getters (all non-blocking) ────────────────────────────

        GetThumbnail: function(filename as string) as object
            if filename = invalid or filename = "" then return invalid

            if m.thumbCache.DoesExist(filename)
                m.stats.thumbHits = m.stats.thumbHits + 1
                bmp = m.thumbCache[filename]
                ' Touch the LRU so a card that stays on screen is not evicted.
                m.RemoveFromList(m.thumbKeys, filename)
                m.thumbKeys.Push(filename)
                return bmp
            end if
            m.stats.thumbMisses = m.stats.thumbMisses + 1

            if m.inFlight.DoesExist("t_" + filename) then return invalid
            if m.GiveUp(filename) then return invalid

            ' Disk hit: decode once, then serve from memory.
            if not m.missingKeys.DoesExist(filename)
                destPath = m.ThumbPath(filename)
                if m.fs <> invalid and m.fs.Exists(destPath)
                    bmp = CreateObject("roBitmap", destPath)
                    if bmp <> invalid and bmp.GetWidth() > 1
                        m.SaveThumbBitmap(filename, bmp)
                        return bmp
                    end if
                    if m.fs <> invalid then m.fs.Delete(destPath)
                end if
                m.missingKeys[filename] = true
            end if

            m.Enqueue(filename, true, 1)
            return invalid
        end function,

        ' Thumbnail resampled to the exact card size, served from gfx_cache.
        ' Falls back to invalid so the caller can scale the bitmap directly.
        GetThumbnailSized: function(filename as string, w as integer, h as integer) as object
            source = m.GetThumbnail(filename)
            if source = invalid then return invalid
            return GetGfxCache().GetScaled("t:" + filename, source, w, h)
        end function,

        GetFullImage: function(filename as string) as object
            if filename = invalid or filename = "" then return invalid

            if m.fullCache.DoesExist(filename)
                m.stats.fullHits = m.stats.fullHits + 1
                bmp = m.fullCache[filename]
                m.RemoveFromList(m.fullKeys, filename)
                m.fullKeys.Push(filename)
                return bmp
            end if
            m.stats.fullMisses = m.stats.fullMisses + 1

            failKey = "full_" + filename
            if m.inFlight.DoesExist("f_" + filename) then return invalid
            if m.GiveUp(failKey) then return invalid

            m.Enqueue(filename, false, 10)
            return invalid
        end function,

        ' Ask for a thumbnail without waiting for a getter to be called - used
        ' by Theme Studio's auto-rotation so a freshly assigned backdrop is not
        ' a blank panel for a second.
        PrefetchThumb: function(filename as string) as void
            if filename = invalid or filename = "" then return
            if m.thumbCache.DoesExist(filename) then return
            if m.inFlight.DoesExist("t_" + filename) then return
            if m.GiveUp(filename) then return
            m.Enqueue(filename, true, 6)
        end function,

        ' Ask for a full-size frame without waiting for a getter to be called -
        ' used to pre-warm the next/previous wallpaper in the viewer.
        PrefetchFull: function(filename as string) as void
            if filename = invalid or filename = "" then return
            if m.fullCache.DoesExist(filename) then return
            if m.inFlight.DoesExist("f_" + filename) then return
            if m.GiveUp("full_" + filename) then return
            m.Enqueue(filename, false, 8)
        end function,

        RemoveFromList: function(list as object, target as string) as void
            idx = 0
            while idx < list.Count()
                if list[idx] = target
                    list.Delete(idx)
                    return
                end if
                idx = idx + 1
            end while
        end function,

        ' ── queue ────────────────────────────────────────────────────────

        Enqueue: function(filename as string, isThumb as boolean, priority as integer) as void
            if filename = invalid or filename = "" then return

            key = filename
            flightKey = "t_" + filename
            if not isThumb
                key = "full_" + filename
                flightKey = "f_" + filename
            end if

            if m.inFlight.DoesExist(flightKey) then return
            if m.enqueuedKeys.DoesExist(key) then return
            if m.GiveUp(key) then return

            ' Bound the backlog: a rapid page-hop must not queue thousands of
            ' thumbnails that are no longer on screen.
            if m.queue.Count() >= m.maxQueue and priority < 8 then return

            m.enqueuedKeys[key] = true
            item = { filename: filename, isThumb: isThumb, key: key, priority: priority }
            if priority >= 10
                m.queue.Unshift(item)
            else
                m.queue.Push(item)
            end if

            m.PumpQueue()
        end function,

        ' Re-target the thumbnail queue at whatever is actually on screen.
        PrioritizeVisible: function(visibleItems as object) as void
            if visibleItems = invalid then return

            newQueue = []
            newEnqueued = {}
            for each item in m.queue
                if not item.isThumb
                    newQueue.Push(item)
                    newEnqueued[item.key] = true
                end if
            end for
            m.queue = newQueue
            m.enqueuedKeys = newEnqueued

            for i = 0 to visibleItems.Count() - 1
                wp = visibleItems[i]
                if wp <> invalid
                    filename = SafeStr(wp.filename)
                    if filename <> "" and not m.thumbCache.DoesExist(filename)
                        m.Enqueue(filename, true, 5)
                    end if
                end if
            end for
        end function,

        PumpQueue: function() as void
            guard = 0
            while m.activeCount < m.maxConcurrent and m.queue.Count() > 0 and guard < 32
                guard = guard + 1
                item = m.queue.Shift()
                if item <> invalid
                    m.enqueuedKeys.Delete(item.key)
                    if item.isThumb
                        m.StartThumbDownload(item.filename)
                    else
                        m.StartFullRequest(item.filename)
                    end if
                end if
            end while
        end function,

        ' ── thumbnail transport ──────────────────────────────────────────

        StartThumbDownload: function(filename as string) as void
            url = MakeImageUrl(filename, true, m.ImageBase())
            if url = "" then return

            destPath = m.ThumbPath(filename)
            xfer = CreateObject("roUrlTransfer")
            if xfer = invalid then return
            xfer.SetPort(m.port)
            xfer.SetUrl(url)
            xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
            xfer.AddHeader("User-Agent", "SpotlightStudio-Roku/2.7.0")
            ' NOTE: InitClientCertificates() is intentionally NOT called.  Roku
            ' deprecated it in OS 16.0 and Static Analysis blocks publishing for
            ' apps that still use it after 1 April 2027.

            flightKey = "t_" + filename
            m.inFlight[flightKey] = true
            started = false
            if xfer.AsyncGetToFile(destPath) then started = true

            if started
                idKey = StrI(xfer.GetIdentity()).Trim()
                m.activeRequests[idKey] = {
                    filename: filename,
                    isThumb: true,
                    destPath: destPath,
                    flightKey: flightKey,
                    failKey: filename,
                    xfer: xfer,
                    startedAt: m.NowMs()
                }
                m.activeCount = m.activeCount + 1
            else
                m.inFlight.Delete(flightKey)
                if m.RecordFailure(filename) then m.missingKeys[filename] = true
            end if
        end function,

        ' ── full-size transport ──────────────────────────────────────────

        StartFullRequest: function(filename as string) as void
            url = MakeImageUrl(filename, false, m.ImageBase())
            if url = "" then return

            flightKey = "f_" + filename
            m.inFlight[flightKey] = true

            if m.textureMgr <> invalid
                request = CreateObject("roTextureRequest", url)
                if request <> invalid
                    request.SetAsync(true)
                    ' Screen-sized output: keeps 4K sources inside the 2048x2048
                    ' roBitmap ceiling and caps each cached frame at 8.3 MB.
                    request.SetSize(1920, 1080)
                    request.SetScaleMode(1)
                    m.textureMgr.RequestTexture(request)

                    idKey = "tex" + StrI(request.GetId()).Trim()
                    m.activeTextures[idKey] = {
                        filename: filename,
                        flightKey: flightKey,
                        request: request,
                        startedAt: m.NowMs()
                    }
                    m.activeCount = m.activeCount + 1
                    return
                end if
            end if

            ' Fallback for devices without a usable texture manager: download to
            ' tmp:/ and decode with roBitmap.  Only succeeds for sources that
            ' are already inside the 2048x2048 limit (the FHD archive).
            m.stats.textureFallbacks = m.stats.textureFallbacks + 1
            destPath = "tmp:/f_" + m.GetSafeFilename(filename)
            xfer = CreateObject("roUrlTransfer")
            if xfer = invalid
                m.inFlight.Delete(flightKey)
                m.RecordFailure("full_" + filename)
                return
            end if
            xfer.SetPort(m.port)
            xfer.SetUrl(url)
            xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
            xfer.AddHeader("User-Agent", "SpotlightStudio-Roku/2.7.0")

            if xfer.AsyncGetToFile(destPath)
                idKey = StrI(xfer.GetIdentity()).Trim()
                m.activeRequests[idKey] = {
                    filename: filename,
                    isThumb: false,
                    destPath: destPath,
                    flightKey: flightKey,
                    failKey: "full_" + filename,
                    xfer: xfer,
                    startedAt: m.NowMs()
                }
                m.activeCount = m.activeCount + 1
            else
                m.inFlight.Delete(flightKey)
                m.RecordFailure("full_" + filename)
            end if
        end function,

        NowMs: function() as integer
            if m.__clock = invalid
                m.__clock = CreateObject("roTimespan")
                m.__clock.Mark()
            end if
            return m.__clock.TotalMilliseconds()
        end function,

        ' The CDN base the user may have overridden (a Pro feature).  Read it
        ' through GetStr(): the value lives in the settings manager's cache AA,
        ' so `m.settingsMgr.imageBase` is always invalid.  The screensaver passes
        ' a minimal stand-in object that only has GetStr().
        ImageBase: function() as string
            if m.settingsMgr = invalid then return ""
            if m.settingsMgr.GetStr <> invalid
                base = SafeStr(m.settingsMgr.GetStr("imageBase", ""))
                if base <> "" then return base
            end if
            return DefaultImageBase()
        end function,

        ' ── event handling ───────────────────────────────────────────────

        HandleUrlEvent: function(msg as object) as boolean
            if msg = invalid then return false
            if type(msg) <> "roUrlEvent" then return false

            idKey = StrI(msg.GetSourceIdentity()).Trim()
            if not m.activeRequests.DoesExist(idKey) then return false

            req = m.activeRequests[idKey]
            m.activeRequests.Delete(idKey)
            if req.flightKey <> invalid then m.inFlight.Delete(req.flightKey)
            m.activeCount = MaxI(0, m.activeCount - 1)

            failKey = SafeStr(req.filename)
            if not req.isThumb then failKey = "full_" + SafeStr(req.filename)

            code = msg.GetResponseCode()
            if code = 200 or code = 206
                bmp = CreateObject("roBitmap", SafeStr(req.destPath))
                if bmp <> invalid and bmp.GetWidth() > 1
                    if req.isThumb
                        m.stats.downloaded = m.stats.downloaded + 1
                        m.SaveThumbBitmap(SafeStr(req.filename), bmp)
                        m.TrackDiskFile(SafeStr(req.destPath))
                    else
                        m.stats.downloaded = m.stats.downloaded + 1
                        m.SaveFullBitmap(SafeStr(req.filename), bmp)
                    end if
                else
                    ' Undecodable: an LFS pointer, a truncated file, or a source
                    ' larger than the 2048x2048 roBitmap ceiling.
                    m.DeleteFile(SafeStr(req.destPath))
                    if req.isThumb then m.missingKeys[SafeStr(req.filename)] = true
                    m.RecordFailure(failKey)
                end if
            else
                m.DeleteFile(SafeStr(req.destPath))
                if req.isThumb then m.missingKeys[SafeStr(req.filename)] = true
                m.RecordFailure(failKey)
                LogDebug("HTTP " + StrI(code).Trim() + " for " + SafeStr(req.filename))
            end if

            m.PumpQueue()
            return true
        end function,

        HandleTextureEvent: function(msg as object) as boolean
            if msg = invalid then return false
            if type(msg) <> "roTextureRequestEvent" then return false

            idKey = "tex" + StrI(msg.GetId()).Trim()
            if not m.activeTextures.DoesExist(idKey) then return false

            ' 0 Requested, 1 Downloading, 2 Downloaded, 3 Ready, 4 Failed,
            ' 5 Cancelled.  Intermediate states must not release the slot.
            state = msg.GetState()
            if state <> 3 and state <> 4 and state <> 5 then return true

            req = m.activeTextures[idKey]
            m.activeTextures.Delete(idKey)
            if req.flightKey <> invalid then m.inFlight.Delete(req.flightKey)
            m.activeCount = MaxI(0, m.activeCount - 1)

            filename = SafeStr(req.filename)
            if state = 3
                bmp = msg.GetBitmap()
                if bmp <> invalid and bmp.GetWidth() > 1
                    m.stats.downloaded = m.stats.downloaded + 1
                    m.SaveFullBitmap(filename, bmp)
                else
                    m.RecordFailure("full_" + filename)
                end if
            else
                m.RecordFailure("full_" + filename)
                LogDebug("Texture request state " + StrI(state).Trim() + " for " + filename)
            end if

            m.PumpQueue()
            return true
        end function,

        ' Release slots held by requests that stopped reporting.  Without this a
        ' single stalled socket permanently shrinks the concurrency budget.
        ReapStalledRequests: function() as void
            nowMs = m.NowMs()

            doomed = []
            for each idKey in m.activeRequests
                req = m.activeRequests[idKey]
                if req <> invalid
                    if nowMs - SafeInt(req.startedAt, nowMs) > m.requestTimeoutMs then doomed.Push(idKey)
                end if
            end for
            for each idKey in doomed
                req = m.activeRequests[idKey]
                m.activeRequests.Delete(idKey)
                if req <> invalid
                    if req.flightKey <> invalid then m.inFlight.Delete(req.flightKey)
                    m.DeleteFile(SafeStr(req.destPath))
                    m.RecordFailure(SafeStr(req.failKey))
                end if
                m.activeCount = MaxI(0, m.activeCount - 1)
            end for

            doomedTex = []
            for each idKey in m.activeTextures
                req = m.activeTextures[idKey]
                if req <> invalid
                    if nowMs - SafeInt(req.startedAt, nowMs) > m.requestTimeoutMs then doomedTex.Push(idKey)
                end if
            end for
            for each idKey in doomedTex
                req = m.activeTextures[idKey]
                m.activeTextures.Delete(idKey)
                if req <> invalid
                    if req.flightKey <> invalid then m.inFlight.Delete(req.flightKey)
                    m.RecordFailure("full_" + SafeStr(req.filename))
                end if
                m.activeCount = MaxI(0, m.activeCount - 1)
            end for

            if doomed.Count() > 0 or doomedTex.Count() > 0 then m.PumpQueue()
        end function,

        DeleteFile: function(path as string) as void
            if path = invalid or path = "" then return
            if m.fs <> invalid then m.fs.Delete(path)
            m.RemoveFromList(m.diskFiles, path)
        end function,

        ' Keep the tmp:/ thumbnail cache inside its byte budget.
        '
        ' The previous version shifted entries off the list even when it did not
        ' delete them (the `oldest <> path` guard), so the byte accounting
        ' drifted away from reality and the file it had just written could be
        ' the one it deleted.  Eviction now only ever removes entries it really
        ' deletes, and never the file that was just added.
        TrackDiskFile: function(path as string) as void
            if path = invalid or path = "" then return
            ' roArray has no DoesExist()/Contains(); RemoveFromList is the
            ' project's linear-search helper for exactly this.
            m.RemoveFromList(m.diskFiles, path)
            m.diskFiles.Push(path)
            m.diskBytes = m.diskBytes + 24576 ' average 480x270 JPEG
            guard = 0
            while m.diskBytes > m.diskBudget and m.diskFiles.Count() > 1 and guard < 200
                guard = guard + 1
                oldest = m.diskFiles[0]
                if oldest = invalid or oldest = path then exit while
                m.diskFiles.Delete(0)
                if m.fs <> invalid then m.fs.Delete(oldest)
                m.diskBytes = m.diskBytes - 24576
            end while
            if m.diskBytes < 0 then m.diskBytes = 0
        end function,

        ' ── maintenance ──────────────────────────────────────────────────

        ClearCache: function() as void
            m.thumbCache = {}
            m.fullCache = {}
            m.thumbKeys = []
            m.fullKeys = []
            m.missingKeys = {}
            m.failedKeys = {}
            ' The tmp:/ files are freed too, so the byte accounting has to go
            ' back to zero - otherwise the next TrackDiskFile() would evict
            ' thumbnails that are not on disk.
            for each path in m.diskFiles
                if path <> invalid and m.fs <> invalid then m.fs.Delete(path)
            end for
            m.diskFiles = []
            m.diskBytes = 0
            GetGfxCache().Invalidate()
        end function,

        ' Bytes currently held in the tmp:/ thumbnail cache.
        DiskUsage: function() as integer
            return m.diskBytes
        end function,

        ' Forget permanent failures so a recovered network can retry.
        ResetFailures: function() as void
            m.failedKeys = {}
            m.missingKeys = {}
        end function,

        ' How many keys have exhausted their retry budget (Settings screen).
        FailureCount: function() as integer
            return m.failedKeys.Count()
        end function,

        IsPending: function() as boolean
            return m.activeCount > 0 or m.queue.Count() > 0
        end function,

        Stats: function() as string
            thumbTotal = m.stats.thumbHits + m.stats.thumbMisses
            rate = 0
            if thumbTotal > 0 then rate = CInt((m.stats.thumbHits * 100) / thumbTotal)
            summary = StrI(m.thumbCache.Count()).Trim() + " thumbs, " + StrI(m.fullCache.Count()).Trim() + " full"
            return summary + ", " + StrI(rate).Trim() + "% hit, " + StrI(m.stats.downloaded).Trim() + " fetched"
        end function
    }

    return loader
end function
