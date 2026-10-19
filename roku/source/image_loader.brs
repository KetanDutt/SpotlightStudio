' Spotlight Studio for Roku
' image_loader.brs - Asynchronous non-blocking image loader, memory & disk cache, and request queue

function CreateImageLoader(port as object, settingsMgr as object) as object
    loader = {
        port: port,
        settingsMgr: settingsMgr,
        
        ' In-memory bitmap caches for instant rendering
        thumbCache: {},
        fullCache: {},
        failedKeys: {},
        
        ' LRU memory cache tracking to enforce safe VRAM limits on Roku hardware
        thumbKeys: [],
        fullKeys: [],
        maxThumbCache: 48,
        maxFullCache: 4,
        
        ' In-flight download tracking by key ("t_<file>" / "f_<file>")
        inFlight: {},
        
        ' In-flight roUrlTransfer requests: { idStr: { id: int, filename: string, isThumb: boolean, destPath: string, flightKey: string, xfer: object } }
        activeRequests: {},
        activeCount: 0,
        maxConcurrent: 4, ' Concurrency for Roku networking without blocking main thread
        
        ' Pending FIFO queue: [ { filename: string, isThumb: boolean, key: string, priority: int } ]
        queue: [],
        enqueuedKeys: {},
        
        ' File system helper for checking tmp:/ disk cache
        fs: CreateObject("roFileSystem"),
        
        SaveThumbBitmap: function(filename as string, bmp as object)
            if filename = invalid or bmp = invalid then return
            if not m.thumbCache.DoesExist(filename)
                m.thumbKeys.Push(filename)
            end if
            m.thumbCache[filename] = bmp
            while m.thumbKeys.Count() > m.maxThumbCache
                oldest = m.thumbKeys.Shift()
                if oldest <> filename then m.thumbCache.Delete(oldest)
            end while
        end function,
        
        SaveFullBitmap: function(filename as string, bmp as object)
            if filename = invalid or bmp = invalid then return
            if not m.fullCache.DoesExist(filename)
                m.fullKeys.Push(filename)
            end if
            m.fullCache[filename] = bmp
            while m.fullKeys.Count() > m.maxFullCache
                oldest = m.fullKeys.Shift()
                if oldest <> filename then m.fullCache.Delete(oldest)
            end while
        end function,
        
        GetSafeFilename: function(filename as string) as string
            if filename = invalid or filename = "" then return ""
            safe = filename
            safe = ReplaceStr(safe, "/", "_")
            safe = ReplaceStr(safe, "\", "_")
            safe = ReplaceStr(safe, ":", "_")
            return safe
        end function,
        
        ' Non-blocking thumbnail getter
        GetThumbnail: function(filename as string) as object
            if filename = invalid or filename = "" then return invalid
            
            ' 1. In-memory cache hit (0ms)
            if m.thumbCache.DoesExist(filename)
                return m.thumbCache[filename]
            end if
            
            ' 2. If actively downloading in background, don't touch disk or delete in-progress file
            flightKey = "t_" + filename
            if m.inFlight.DoesExist(flightKey)
                return invalid
            end if
            
            ' 3. If previously failed, do not spin repeatedly
            if m.failedKeys.DoesExist(filename)
                return invalid
            end if
            
            ' 4. Local disk cache hit in tmp:/ (~1ms)
            safeName = m.GetSafeFilename(filename)
            destPath = "tmp:/t_" + safeName
            if m.fs.Exists(destPath)
                bmp = CreateObject("roBitmap", destPath)
                if bmp <> invalid and bmp.GetWidth() > 1
                    m.SaveThumbBitmap(filename, bmp)
                    return bmp
                else
                    m.fs.Delete(destPath)
                end if
            end if
            
            ' 5. Not cached yet -> queue for async background download
            m.Enqueue(filename, true, 1)
            return invalid
        end function,
        
        ' Non-blocking full image getter
        GetFullImage: function(filename as string) as object
            if filename = invalid or filename = "" then return invalid
            
            ' 1. In-memory cache hit (0ms)
            if m.fullCache.DoesExist(filename)
                return m.fullCache[filename]
            end if
            
            ' 2. If actively downloading in background, don't touch disk or delete in-progress file
            flightKey = "f_" + filename
            if m.inFlight.DoesExist(flightKey)
                return invalid
            end if
            
            ' 3. If previously failed, do not spin repeatedly
            failKey = "full_" + filename
            if m.failedKeys.DoesExist(failKey)
                return invalid
            end if
            
            ' 4. Local disk cache hit in tmp:/ (~1ms)
            safeName = m.GetSafeFilename(filename)
            destPath = "tmp:/f_" + safeName
            if m.fs.Exists(destPath)
                bmp = CreateObject("roBitmap", destPath)
                if bmp <> invalid and bmp.GetWidth() > 1
                    m.SaveFullBitmap(filename, bmp)
                    return bmp
                else
                    m.fs.Delete(destPath)
                end if
            end if
            
            ' 5. Queue for async download with highest priority
            m.Enqueue(filename, false, 10)
            return invalid
        end function,
        
        ' Enqueue an image for background download
        Enqueue: function(filename as string, isThumb as boolean, priority as integer)
            key = filename
            if not isThumb then key = "full_" + filename
            
            flightKey = "t_" + filename
            if not isThumb then flightKey = "f_" + filename
            if m.inFlight.DoesExist(flightKey) then return
            
            if m.enqueuedKeys.DoesExist(key) or m.failedKeys.DoesExist(key) then return
            m.enqueuedKeys[key] = true
            
            item = { filename: filename, isThumb: isThumb, key: key, priority: priority }
            if priority >= 10
                m.queue.Unshift(item) ' Prioritize full resolution viewer images
            else
                m.queue.Push(item)
            end if
            
            m.PumpQueue()
        end function,
        
        ' Reprioritize when user scrolls to a new page or changes tab
        PrioritizeVisible: function(visibleWallpapers as object)
            if visibleWallpapers = invalid then return
            
            ' Keep any active full-image requests, but clear stale thumbnail queue
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
            
            ' Enqueue the visible items in order
            for i = 0 to visibleWallpapers.Count() - 1
                wp = visibleWallpapers[i]
                if wp <> invalid and wp.filename <> invalid
                    if not m.thumbCache.DoesExist(wp.filename)
                        m.Enqueue(wp.filename, true, 5)
                    end if
                end if
            end for
        end function,
        
        ' Launch downloads if capacity is available
        PumpQueue: function()
            while m.activeCount < m.maxConcurrent and m.queue.Count() > 0
                item = m.queue.Shift()
                m.enqueuedKeys.Delete(item.key)
                
                m.StartDownload(item.filename, item.isThumb)
            end while
        end function,
        
        ' Launch single async roUrlTransfer
        StartDownload: function(filename as string, isThumb as boolean)
            url = MakeImageUrl(filename, isThumb, m.settingsMgr.imageBase)
            if url = "" then return
            
            safeName = m.GetSafeFilename(filename)
            prefix = "t_"
            if not isThumb then prefix = "f_"
            destPath = "tmp:/" + prefix + safeName
            
            xfer = CreateObject("roUrlTransfer")
            xfer.SetPort(m.port)
            xfer.SetUrl(url)
            xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
            xfer.AddHeader("User-Agent", "SpotlightStudio-Roku/2.6.0")
            xfer.InitClientCertificates()
            
            reqId = xfer.GetIdentity()
            flightKey = prefix + filename
            m.inFlight[flightKey] = true
            
            ok = xfer.AsyncGetToFile(destPath)
            if ok
                idKey = StrI(reqId).Trim()
                m.activeRequests[idKey] = {
                    reqId: reqId,
                    filename: filename,
                    isThumb: isThumb,
                    destPath: destPath,
                    flightKey: flightKey,
                    xfer: xfer
                }
                m.activeCount = m.activeCount + 1
            else
                m.inFlight.Delete(flightKey)
            end if
        end function,
        
        ' Handle roUrlEvent from message port
        HandleUrlEvent: function(msg as object) as boolean
            if msg = invalid or type(msg) <> "roUrlEvent" then return false
            
            idKey = StrI(msg.GetSourceIdentity()).Trim()
            if not m.activeRequests.DoesExist(idKey) then return false
            
            req = m.activeRequests[idKey]
            m.activeRequests.Delete(idKey)
            if req.flightKey <> invalid then m.inFlight.Delete(req.flightKey)
            m.activeCount = MaxI(0, m.activeCount - 1)
            
            code = msg.GetResponseCode()
            if code = 200 or code = 206
                ' Successfully saved to local tmp:/ disk! Load into bitmap
                bmp = CreateObject("roBitmap", req.destPath)
                if bmp <> invalid and bmp.GetWidth() > 1
                    if req.isThumb
                        m.SaveThumbBitmap(req.filename, bmp)
                    else
                        m.SaveFullBitmap(req.filename, bmp)
                    end if
                else
                    m.fs.Delete(req.destPath)
                    failKey = req.filename
                    if not req.isThumb then failKey = "full_" + req.filename
                    m.failedKeys[failKey] = true
                end if
            else
                m.fs.Delete(req.destPath)
                failKey = req.filename
                if not req.isThumb then failKey = "full_" + req.filename
                m.failedKeys[failKey] = true
            end if
            
            ' Pump next item in queue
            m.PumpQueue()
            return true
        end function,
        
        ' Clear cache if memory needs to be freed
        ClearCache: function()
            m.thumbCache = {}
            m.fullCache = {}
            m.failedKeys = {}
            m.inFlight = {}
            m.thumbKeys = []
            m.fullKeys = []
        end function
    }
    
    return loader
end function
