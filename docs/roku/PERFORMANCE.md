# Performance

A 2D-canvas channel has no compositor: **every frame re-issues every draw
call**.  The whole performance strategy is therefore (a) draw less often and
(b) make each frame cheaper.

## 1. Draw less often — dirty-frame rendering

`MainLoop()` asks `FrameNeedsRender()` before touching the canvas:

```
render  if  state.dirty                       # something changed
     or (FrameIntervalMs(state) > 0
         and now - lastFrame >= interval)     # an animation is running
```

`state.dirty` is set by every input handler, every network/texture event,
every timer that actually changed something, and nothing else.  When idle the
loop blocks in `port.WaitMessage(200)` and the channel uses effectively zero
CPU — important for a TV that may sit on the gallery for hours.

Animations run at a *budget*, not at the display rate:

| Situation | Frame budget |
|---|---|
| Page-change fade, ambient dip-to-black | 16 ms (60 fps), short-lived |
| Breathing focus ring, spinner, caret, Ken Burns drift | 50 ms (20 fps) |
| Idle | render only on change |

60 fps for a slowly breathing glow is indistinguishable from 20 fps on a
ten-foot screen, and the difference is a 3× reduction in draw calls.

## 2. Make each frame cheaper — bounded bitmap caches

`gfx_cache.brs` holds two LRU caches keyed so that repeated work is rendered
once and blitted with a single `DrawObject()`:

| Cache | Key | Why it matters |
|---|---|---|
| shapes | `WxHrRb<bg>f<border>t<thickness>` | `DrawRoundRect()` emits `4r+3` blits and `DrawRoundedOutline()` another `4r+4`; a card is ~100 of them. A cached panel is one blit |
| scaled | `"<t:\|f:>"filename@WxH` | `DrawResizedObject()` resamples a thumbnail **every frame** it is visible; the cache makes that a one-off |

Both are capped (`GfxLimits()`): ≤ 500 000 px per entry, ≤ 1.5 M px per cache,
≤ 48/24 entries.  `roBitmap` is 32 bits per pixel, so the caps are a hard
memory contract, not a hint.  Oversized surfaces (the filter modal, the
settings panel) are drawn directly — caching them would cost more than it
saves.

Resamples are dropped automatically when their source bitmap is evicted or
re-downloaded (`DropScaledFor`), so a stale scale can never outlive its image.

## 3. Memory budget

| Component | Peak |
|---|---|
| 14 decoded thumbnails (480×270) | ~7.3 MB |
| 2 full frames (1920×1080, always downscaled) | ~16.6 MB |
| Shape cache | ≤ 6 MB |
| Scaled-image cache | ≤ 6 MB |
| Parsed catalog (7 475 rows) | ~10 MB heap |
| **Total** | **~46 MB worst case** |

For reference the previous design cached four *native-resolution* full images:
a single 3840×2160 frame is 33 MB as an `roBitmap`, so four of them was an
out-of-memory crash on any 512 MB device.  The texture-manager path requests
1920×1080 up front, which is both the fix and the reason 4K wallpapers display
at all (`roBitmap` cannot decode beyond 2048×2048).

## 4. Allocation discipline

* `GetTheme()` is memoised in the global AA and rebuilt only on palette
  change.  It used to allocate a fresh 24-key associative array per call, and
  every component calls it — hundreds of throwaway AAs per frame.
* Every option list lives in `constants.brs` behind a memoised accessor.
  Before, the category/sort/source lists were re-declared as array literals in
  three places, including inside the render loop.
* `GetDeviceLocalTime()` allocates an `roDateTime`; it is now called at most
  once every 15 seconds (once per 15 s in the channel, throttled in the
  screensaver too).
* Toast and badge widths come from `roFont.GetOneLineWidth()` instead of
  `Len(text) * constant`, removing both a per-frame measurement and a layout
  bug on narrow glyphs.

## 5. Launch time

| Step | Cost | Mitigation |
|---|---|---|
| Read + parse the 2.2 MB catalog | ~1 s | Trimmed schema (was 4.18 MB); the OS shows the splash meanwhile |
| Daily Spotlight scan | ~0.3 s, **once per day per device** | Winner cached in `SpotlightStudio_Cache` keyed by day + catalog size |
| First frame | logged | `LogInfo("First frame rendered in … ms")` — check it in the debug console |

The catalog's date prefix is hashed once per day rather than once per row
(~2.5× fewer hash rounds), and the avalanche/FNV core uses Double arithmetic
so the result never depends on firmware overflow behaviour.

## 6. Network

* 4 concurrent transfers; the queue is bounded (240 entries) and re-targeted at
  the visible page on every page change.
* The viewer pre-fetches the neighbouring wallpapers so Left/Right feel
  instant.
* A 30 s watchdog releases the slot of any request that stops reporting —
  without it one stalled socket would shrink concurrency forever.
* Failures retry up to 3 times, then stop: a permanently failing URL shows a
  placeholder instead of hammering the CDN.

## 7. Profiling on a device

```
telnet <roku-ip> 8085          # BrightScript console: prints, crashes
telnet <roku-ip> 8080          # graphics console:  r2d2_bitmaps  (texture RAM)
                                #                   r2d2_frames   (frame timing)
```

`r2d2_bitmaps` prints every live bitmap with its dimensions and byte size plus
the device's remaining texture memory — the quickest way to verify the budget
above on real hardware.  The Settings screen also shows live cache statistics
(`Image Cache`, `Draw Cache`).
