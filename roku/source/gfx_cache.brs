' Spotlight Studio for Roku
' gfx_cache.brs - Bounded bitmap caches for the 2D canvas renderer.
'
' The canvas repaints a whole 1920x1080 frame from scratch.  Two operations
' dominate that cost:
'
'   1. Rounded geometry.  DrawRoundRect() emits 4*r + 3 DrawRect() calls, so a
'      single badge is ~30 blits and a card frame ~60.  A gallery page is well
'      over a thousand blits before a single thumbnail is drawn.
'   2. Image resampling.  DrawScaledObject() re-scales a thumbnail on every
'      frame it is visible, even when nothing on screen moved.
'
' Both results are deterministic for a given (size, colour) or (source, size)
' pair, so they are rendered once into an offscreen roBitmap and blitted with a
' single DrawObject() afterwards.
'
' Every cache is a bounded LRU with an explicit pixel budget.  roBitmap is
' 32 bits per pixel, so an unbounded cache is an out-of-memory crash on a
' 512 MB streaming stick - the budgets below cap both caches together at
' ~3.6 MB of texture memory.
'
' Both stores keep their key list in LRU order (oldest first), so eviction is
' O(1) per victim rather than an O(n) scan for the smallest stamp.

' BrightScript has no compile-time constants, so the budget lives in one
' memoised associative array.  Tune these to trade memory against draw calls.
function GfxLimits() as object
    gaa = GetGlobalAA()
    if gaa.__ssGfxLimits = invalid
        gaa.__ssGfxLimits = {
            ' Anything larger than this (the filter modal, the settings panel) is
            ' cheaper to draw directly than to hold in texture memory.
            maxEntryPixels: 500000,
            shapeMaxEntries: 96,
            shapeMaxPixels: 1800000,
            scaledMaxEntries: 32,
            scaledMaxPixels: 1800000
        }
    end if
    return gaa.__ssGfxLimits
end function

function GetGfxCache() as object
    gaa = GetGlobalAA()
    if gaa.__ssGfx <> invalid then return gaa.__ssGfx

    limits = GfxLimits()
    cache = {
        limits: limits,

        ' key -> { bmp: roBitmap, pixels: integer, stamp: integer }
        shapes: {},
        scaled: {},
        shapeKeys: [],
        scaledKeys: [],
        shapePixels: 0,
        scaledPixels: 0,

        stamp: 0,
        hits: 0,
        misses: 0,
        evictions: 0,

        NextStamp: function() as integer
            m.stamp = m.stamp + 1
            return m.stamp
        end function,

        RemoveKey: function(keys as object, target as string) as void
            idx = 0
            while idx < keys.Count()
                if keys[idx] = target
                    keys.Delete(idx)
                    return
                end if
                idx = idx + 1
            end while
        end function,

        ' Mark `key` as most-recently-used.  The key list doubles as the LRU
        ' order (oldest first, newest last), so eviction stays O(1) instead of
        ' scanning every entry for the smallest stamp.
        Touch: function(store as object, keys as object, key as string) as void
            entry = store[key]
            if entry = invalid then return
            entry.stamp = m.NextStamp()
            m.RemoveKey(keys, key)
            keys.Push(key)
        end function,

        ' Evict least-recently-used entries from one store until it is inside
        ' both of its budgets.  `pixelField` names the counter to decrement.
        EnforceBudget: function(store as object, keys as object, pixelField as string, maxEntries as integer, maxPixels as integer, keepKey as string) as void
            guard = 0
            while guard < 64
                guard = guard + 1
                if keys.Count() <= maxEntries and m[pixelField] <= maxPixels then exit while
                if keys.Count() = 0 then exit while

                ' keys[] is kept in LRU order by Touch(), so the victim is the
                ' head of the list.  Fall back to a stamp scan only if the list
                ' and the store ever disagree.
                oldestKey = keys[0]
                if store[oldestKey] = invalid
                    oldestKey = ""
                    oldestStamp = 0
                    for each k in keys
                        entry = store[k]
                        if entry <> invalid
                            if oldestKey = "" or entry.stamp < oldestStamp
                                oldestKey = k
                                oldestStamp = entry.stamp
                            end if
                        end if
                    end for
                end if
                if oldestKey = "" or oldestKey = keepKey then exit while

                entry = store[oldestKey]
                if entry <> invalid
                    m[pixelField] = m[pixelField] - entry.pixels
                    if m[pixelField] < 0 then m[pixelField] = 0
                end if
                store.Delete(oldestKey)
                m.RemoveKey(keys, oldestKey)
                m.evictions = m.evictions + 1
            end while
        end function,

        ' ── rounded rectangles / glass panels / pills ────────────────────
        ' Returns a transparent-backed bitmap holding the filled shape plus its
        ' rim, or invalid when the shape is too large to cache.
        ' borderColor = 0 means "no rim".
        GetPanel: function(w as integer, h as integer, radius as integer, bgColor as integer, borderColor as integer, borderThickness as integer) as object
            if w <= 0 or h <= 0 then return invalid
            pixels = w * h
            if pixels > m.limits.maxEntryPixels then return invalid

            sizePart = StrI(w).Trim() + "x" + StrI(h).Trim() + "r" + StrI(radius).Trim()
            colourPart = "b" + StrI(bgColor) + "f" + StrI(borderColor) + "t" + StrI(borderThickness)
            key = sizePart + colourPart

            entry = m.shapes[key]
            if entry <> invalid and entry.bmp <> invalid
                m.hits = m.hits + 1
                m.Touch(m.shapes, m.shapeKeys, key)
                return entry.bmp
            end if
            m.misses = m.misses + 1

            bmp = CreateObject("roBitmap", { width: w, height: h, AlphaEnable: true })
            if bmp = invalid then return invalid
            bmp.SetAlphaEnable(true)
            bmp.Clear(&h00000000)
            DrawRoundRect(bmp, 0, 0, w, h, radius, bgColor)
            if borderColor <> 0 and borderThickness > 0
                inset = CInt(borderThickness / 2)
                DrawRoundedOutline(bmp, inset, inset, w - (inset * 2), h - (inset * 2), radius, borderColor, borderThickness)
            end if

            m.shapes[key] = { bmp: bmp, pixels: pixels, stamp: m.NextStamp() }
            m.shapeKeys.Push(key)
            m.shapePixels = m.shapePixels + pixels
            m.EnforceBudget(m.shapes, m.shapeKeys, "shapePixels", m.limits.shapeMaxEntries, m.limits.shapeMaxPixels, key)
            return bmp
        end function,

        ' ── solid rounded rectangles ─────────────────────────────────────
        ' A plain filled rounded rect is the most repeated shape in the app: the
        ' image slot inside every card, every filter chip, every tag pill.  At
        ' radius 12 it is 4*r + 3 = 51 DrawRect() calls, and the gallery issues
        ' eight of them per frame - over 400 blits before a thumbnail is drawn.
        ' Caching it turns that into one blit.
        GetRoundedRect: function(w as integer, h as integer, radius as integer, color as integer) as object
            if w <= 0 or h <= 0 then return invalid
            pixels = w * h
            if pixels > m.limits.maxEntryPixels then return invalid

            key = StrI(w).Trim() + "x" + StrI(h).Trim() + "r" + StrI(radius).Trim() + "s" + StrI(color)
            entry = m.shapes[key]
            if entry <> invalid and entry.bmp <> invalid
                m.hits = m.hits + 1
                m.Touch(m.shapes, m.shapeKeys, key)
                return entry.bmp
            end if
            m.misses = m.misses + 1

            bmp = CreateObject("roBitmap", { width: w, height: h, AlphaEnable: true })
            if bmp = invalid then return invalid
            bmp.SetAlphaEnable(true)
            bmp.Clear(&h00000000)
            DrawRoundRect(bmp, 0, 0, w, h, radius, color)

            m.shapes[key] = { bmp: bmp, pixels: pixels, stamp: m.NextStamp() }
            m.shapeKeys.Push(key)
            m.shapePixels = m.shapePixels + pixels
            m.EnforceBudget(m.shapes, m.shapeKeys, "shapePixels", m.limits.shapeMaxEntries, m.limits.shapeMaxPixels, key)
            return bmp
        end function,

        ' ── pre-scaled image bitmaps ─────────────────────────────────────
        ' `source` is any decoded bitmap (thumbnail or full image).  The same
        ' source is normally blitted at one fixed card size, so caching the
        ' resample removes the most expensive per-frame operation.
        GetScaled: function(cacheKey as string, source as object, w as integer, h as integer) as object
            if source = invalid or w <= 0 or h <= 0 then return invalid
            pixels = w * h
            if pixels > m.limits.maxEntryPixels then return invalid
            if cacheKey = invalid or cacheKey = "" then return invalid

            key = cacheKey + "@" + StrI(w).Trim() + "x" + StrI(h).Trim()
            entry = m.scaled[key]
            if entry <> invalid and entry.bmp <> invalid
                m.hits = m.hits + 1
                m.Touch(m.scaled, m.scaledKeys, key)
                return entry.bmp
            end if
            m.misses = m.misses + 1

            bmp = CreateObject("roBitmap", { width: w, height: h, AlphaEnable: false })
            if bmp = invalid then return invalid
            ' DrawScaledObject() takes SCALE FACTORS, not pixel dimensions - it is
            ' the only documented scaling blit in Roku's ifDraw2D interface.
            srcW = source.GetWidth()
            srcH = source.GetHeight()
            if srcW < 1 or srcH < 1 then return invalid
            ok = bmp.DrawScaledObject(0, 0, w / srcW, h / srcH, source)
            if not ok then return invalid

            m.scaled[key] = { bmp: bmp, pixels: pixels, stamp: m.NextStamp() }
            m.scaledKeys.Push(key)
            m.scaledPixels = m.scaledPixels + pixels
            m.EnforceBudget(m.scaled, m.scaledKeys, "scaledPixels", m.limits.scaledMaxEntries, m.limits.scaledMaxPixels, key)
            return bmp
        end function,

        ' Drop every resample derived from `cacheKey`.  Called when the image
        ' loader evicts or replaces a source bitmap so a stale resample can
        ' never outlive the image it was made from.
        DropScaledFor: function(cacheKey as string) as void
            if cacheKey = invalid or cacheKey = "" then return
            prefix = cacheKey + "@"
            prefixLen = Len(prefix)
            doomed = []
            for each k in m.scaledKeys
                if Len(k) >= prefixLen
                    if Left(k, prefixLen) = prefix then doomed.Push(k)
                end if
            end for
            for each k in doomed
                entry = m.scaled[k]
                if entry <> invalid
                    m.scaledPixels = m.scaledPixels - entry.pixels
                    if m.scaledPixels < 0 then m.scaledPixels = 0
                end if
                m.scaled.Delete(k)
                m.RemoveKey(m.scaledKeys, k)
            end for
        end function,

        ' Free everything: memory pressure, palette switch, or app backgrounding.
        Invalidate: function() as void
            m.shapes = {}
            m.scaled = {}
            m.shapeKeys = []
            m.scaledKeys = []
            m.shapePixels = 0
            m.scaledPixels = 0
        end function,

        Stats: function() as string
            total = m.hits + m.misses
            rate = 0
            if total > 0 then rate = CInt((m.hits * 100) / total)
            hitPart = StrI(rate).Trim() + "% cache hit (" + StrI(m.hits).Trim() + "/" + StrI(total).Trim() + ")"
            memPart = StrI((m.shapePixels + m.scaledPixels) / 1024).Trim() + " KB cached"
            return hitPart + "  " + memPart + "  " + StrI(m.evictions).Trim() + " evictions"
        end function
    }

    gaa.__ssGfx = cache
    return cache
end function

' ─── CONVENIENCE WRAPPERS ─────────────────────────────────────────────

' Blit a cached rounded glass panel, falling back to drawing it directly when
' the panel is too large to cache or the bitmap allocation failed.
sub DrawGlassPanelCached(screen as object, x as integer, y as integer, w as integer, h as integer, borderColor as integer, bgColor as integer, radius as integer)
    bmp = GetGfxCache().GetPanel(w, h, radius, bgColor, borderColor, 1)
    if bmp <> invalid
        screen.DrawObject(x, y, bmp)
        return
    end if
    DrawRoundRect(screen, x, y, w, h, radius, bgColor)
    DrawRoundedOutline(screen, x, y, w, h, radius, borderColor, 1)
end sub

' Blit a bitmap scaled to (w, h) through the cache.  Returns false when the
' caller should fall back to a direct DrawScaledObject().
function DrawScaledCached(screen as object, x as integer, y as integer, w as integer, h as integer, source as object, cacheKey as string) as boolean
    if source = invalid then return false
    bmp = GetGfxCache().GetScaled(cacheKey, source, w, h)
    if bmp = invalid then return false
    screen.DrawObject(x, y, bmp)
    return true
end function

' Blit a cached solid rounded rect, falling back to drawing it directly.
sub DrawRoundedRectCached(screen as object, x as integer, y as integer, w as integer, h as integer, radius as integer, color as integer)
    bmp = GetGfxCache().GetRoundedRect(w, h, radius, color)
    if bmp <> invalid
        screen.DrawObject(x, y, bmp)
        return
    end if
    DrawRoundRect(screen, x, y, w, h, radius, color)
end sub

' Scale `source` into (w, h) at (x, y).  The only documented scaling blit in
' ifDraw2D is DrawScaledObject(x, y, scaleX, scaleY, src), which takes factors
' rather than pixels - so the factors are derived here once, in floats.
'
' NOTE: ifDraw2D has no DrawResizedObject().  Calling it raises a runtime error
' and terminates the channel; scripts/roku_audit.py now fails the build on it.
sub DrawScaledTo(screen as object, x as integer, y as integer, w as integer, h as integer, source as object)
    if source = invalid then return
    srcW = source.GetWidth()
    srcH = source.GetHeight()
    if srcW < 1 or srcH < 1 then return
    screen.DrawScaledObject(x, y, w / srcW, h / srcH, source)
end sub

' Pre-scaled when the cache can hold it, direct blit when it cannot (a
' full-screen 1920x1080 frame is well over the per-entry pixel budget).
sub DrawScaledOrResize(screen as object, x as integer, y as integer, w as integer, h as integer, source as object, cacheKey as string)
    if source = invalid then return
    if not DrawScaledCached(screen, x, y, w, h, source, cacheKey)
        DrawScaledTo(screen, x, y, w, h, source)
    end if
end sub
