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

**`AnimationActive()` is part of the budget, so treat it as a budget.**
Returning `true` for a screen that has nothing moving pins the loop at 20 fps.
The fullscreen viewer used to declare itself animating for as long as
`browseList` was non-empty, which meant a *static* 1920×1080 image was
re-scaled and re-blitted twenty times a second, forever.  It now animates only
while a frame is still in flight or a slideshow is running.

## 2. Make each frame cheaper — bounded bitmap caches

`gfx_cache.brs` holds two LRU caches keyed so that repeated work is rendered
once and blitted with a single `DrawObject()`:

| Store | Key | Covers | Why it matters |
|---|---|---|---|
| `shapes` | `WxHrRb<bg>f<border>t<thickness>` | glass panels, buttons, badge pills, keyboard keys | `DrawRoundRect()` is `4r+3` blits and `DrawRoundedOutline()` another `4r+4`; a card is ~100 of them |
| `shapes` | `WxHrRs<colour>` (via `GetRoundedRect`) | solid rounded rects: card image slots, filter chips, tag pills, spinner dots, focus underlines | the same `4r+3` cost, on the shapes that repeat most |
| `scaled` | `"<t:|f:>"filename@WxH` | pre-resampled thumbnails and frames | `DrawScaledObject()` resamples a thumbnail **every frame** it is visible; the cache makes that a one-off |

The solid rounded-rect store is the single largest win in the current renderer.
A gallery page draws eight card image slots at radius 12 (51 `DrawRect()` calls
each), up to six filter chips at radius 9 (~80 each) and eight spinner dots at
radius 3 (15 each) — over 1 000 blits per frame *before a single thumbnail is
drawn*.  Cached, that is ~23 blits.

Both stores are capped (`GfxLimits()`): ≤ 500 000 px per entry, ≤ 1.8 M px per
store, ≤ 96 shape / 32 scaled entries.  `roBitmap` is 32 bits per pixel, so the
caps are a hard memory contract, not a hint.  Oversized surfaces (the filter
modal, the settings panel) are drawn directly — caching them would cost more
than it saves.

Two implementation details keep the cache itself cheap:

* **Eviction is O(1).**  The key list doubles as the LRU order (oldest first);
  `Touch()` moves a hit to the tail.  The previous version scanned every entry
  for the smallest stamp on every eviction.
* **Resamples are dropped when their source is** (`DropScaledFor`), so a stale
  scale can never outlive its image.

### Rounded-rect geometry

`DrawRoundRect()` and `DrawRoundedOutline()` build their corner profile from a
memoised per-radius table (`ArcRowOffsets()`) instead of recomputing `Sqr()` for
each row of each corner.  Sixteen radius-12/14 shapes per frame at 20 fps was
~1 300 `Sqr()` calls a second.

## 3. Memory budget

| Component | Peak |
|---|---|
| 14 decoded thumbnails (480×270) | ~7.3 MB |
| 2 full frames (1920×1080, always downscaled) | ~16.6 MB |
| Gallery backdrop (1920×1080, baked once) | ~8.3 MB |
| Shape cache | ≤ 7.2 MB |
| Scaled-image cache | ≤ 7.2 MB |
| Parsed catalog (7 475 rows) | ~10 MB heap |
| **Total** | **~57 MB worst case** |

For reference an earlier design cached four *native-resolution* full images: a
single 3840×2160 frame is 33 MB as an `roBitmap`, so four of them was an
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
* `GetDeviceLocalTime()` allocates an `roDateTime`; it is called at most once
  every 15 seconds in the channel and in the screensaver.
* Toast and badge widths come from `roFont.GetOneLineWidth(text, maxWidth)`
  instead of `Len(text) * constant`, removing both a per-frame measurement and
  a layout bug on narrow glyphs.  Note the required second argument — see
  [AUDIT.md](AUDIT.md#roku-api-surface).
* **Lookups that resolve a wallpaper id go through `CatalogIndex()`**, a
  memoised id → index map.  `DrawGalleryBackdrop()` and Theme Studio's
  assignment slots resolve an id every frame; a linear scan of 7 475 rows at
  20 fps is ~150 000 iterations a second for a value that changes only when the
  user picks a new backdrop.

## 5. Algorithmic complexity

| Operation | Before | Now |
|---|---|---|
| Resolve a wallpaper id | O(n) linear scan, every frame | O(1) memoised map |
| "Title A→Z" sort | insertion sort, O(n²) ≈ 28 M comparisons on the full archive | bottom-up merge sort, O(n log n) ≈ 97 K comparisons |
| Daily Spotlight | O(n) FNV-1a, ~7 500 hash rounds | same, but cached per day and pruned to one registry key |
| Build the Ambient Collection | O(n) per filter change | unchanged (O(n), only on filter change) |

The title sort is the one that mattered: it ran on the **whole** archive, so
selecting "Title A to Z" hung the channel for minutes and tripped Roku's
response watchdog.  The replacement is an iterative (stack-safe) stable merge
sort over a pre-computed lowercase key array.

## 6. Launch time

| Step | Cost | Mitigation |
|---|---|---|
| Read + parse the 2.2 MB catalog | ~1 s | Trimmed schema (was 4.18 MB); the OS shows the splash meanwhile |
| Daily Spotlight scan | ~0.3 s, **once per day per device** | Winner cached in `SpotlightStudio_Cache` keyed by day + catalog size; older `daily_*` keys are pruned on write |
| First frame | logged | `LogInfo("First frame rendered in … ms")` — check it in the debug console |

The catalog's date prefix is hashed once per day rather than once per row
(~2.5× fewer hash rounds), and the avalanche/FNV core uses Double arithmetic
so the result never depends on firmware overflow behaviour.

## 7. Network

* 4 concurrent transfers; the queue is bounded (240 entries) and re-targeted at
  the visible page on every page change.
* The viewer pre-fetches the neighbouring wallpapers so Left/Right feel
  instant.  Theme Studio's auto-rotation pre-fetches the thumbnail of the
  wallpaper it is about to assign, and the standalone screensaver pre-fetches
  the frame after the one on screen.
* A 30 s watchdog releases the slot of any request that stops reporting —
  without it one stalled socket would shrink concurrency forever.
* Failures retry up to 3 times, then stop: a permanently failing URL shows a
  placeholder instead of hammering the CDN.  *Settings → Retry Failed Images*
  clears the give-up list when the network recovers.
* The `tmp:/` thumbnail cache is byte-budgeted (8 MB) as well as
  entry-capped, and eviction only ever deletes a file it also untracks.

## 8. Profiling on a device

```
telnet <roku-ip> 8085          # BrightScript console: prints, crashes
telnet <roku-id> 8080          # graphics console:  r2d2_bitmaps  (texture RAM)
                               #                    r2d2_frames   (frame timing)
```

`r2d2_bitmaps` prints every live bitmap with its dimensions and byte size plus
the device's remaining texture memory — the quickest way to verify the budget
above on real hardware.  The Settings screen also shows live statistics
(`Image Cache`, `Disk Cache`, `Failed Images`, `Draw Cache`).
