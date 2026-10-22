# Architecture

The channel is one BrightScript program compiled from every `.brs` in
`roku/source/`.  There is no SceneGraph, so there is no node tree, no task
threads and no framework focus manager: **focus, navigation and the frame
schedule are all explicit state in a single associative array.**

## Module map

| Module | Responsibility |
|---|---|
| `main.brs` | Entry points, `state` construction, message loop, one input handler per screen, navigation/transition/position-persistence helpers, ECP deep links |
| `theme.brs` | The six "Liquid Glass" palettes, the memoised colour table, rounded geometry, focus rings, badges, buttons, spinner and the shared header/footer chrome |
| `gfx_cache.brs` | Bounded LRU bitmap caches for rounded panels and resampled images |
| `utils.brs` | Defensive coercion (`SafeStr`, `SafeInt`), math, string, date and device-clock helpers, wallpaper field accessors, the LFS CDN URL builder |
| `constants.brs` | Every option list, label map and layout constant, memoised — the single source of truth for both the renderer and the input handlers |
| `catalog.brs` | Catalog loading, filtering, sorting (`MergeSortByKey`), the memoised id→index map, FNV-1a 32-bit hashing and the Daily Spotlight |
| `image_loader.brs` | The non-blocking two-tier image pipeline and its caches |
| `settings.brs` `favorites.brs` `license.brs` `store.brs` `theme_manager.brs` `audio.brs` | The persistence and entitlement layer, all backed by `roRegistrySection` (plus `roChannelStore` for the store) |
| `view_*.brs` | One render function per screen |

Plus, in `scripts/`: `roku_audit.py` (the static gate described in
[AUDIT.md](AUDIT.md)) and `roku_api_surface.json` (the Roku API table it checks
against).

## Application state

`BuildState()` in `main.brs` returns the one associative array every view and
input handler receives — 78 keys, all of them documented field by field in
[STATE.md](STATE.md).  The groups are:

* **managers** — `settingsMgr`, `favMgr`, `licenseMgr`, `themeMgr`, `storeMgr`,
  `audioMgr`, `imgLoader`, plus `screen`, `port`, `deviceInfo`, `appInfo`.
* **content** — `allWallpapers`, `filtered`, `screensaverList`,
  `dailyWallpaper`, `totalCount`.
* **navigation** — `activeView` (`gallery | daily | screensavers | theme |
  store | settings | viewer | ambient`), `activeTab`, `focusArea`, the grid
  cursors, and the modal flags `filterMode` / `searchMode`.
* **viewer/ambient** — `browseList` + `browseIdx` (one shared list and index, so
  Left/Right always move to a neighbour of whatever is on screen), zoom,
  aspect mode, slideshow and the dip-to-black transition phase.
* **render loop** — `dirty`, `animClock`, `spinnerAngle/Visible`,
  `transitioning`, `clockTime/clockDate`, toast and caret timers.

Because BrightScript returns `invalid` for a key an associative array does not
have, a typo in a state field is *invisible* at runtime — it just renders as a
blank UI element.  `scripts/roku_audit.py` fails the build on any `state.<key>`
read that is never assigned.

### Index spaces

The single most important invariant: **the viewer and Ambient Mode never index
into `state.filtered`**.  They operate on `state.browseList`, which is
explicitly assigned when they are entered (the gallery page, the screensaver
page, the daily pick, or a rotation pool), with `state.browseIdx` as the cursor.
The previous implementation reused `filtered` indices for lists that were not
`filtered`, which made Left/Right jump to unrelated wallpapers.

## The render loop

```
while not state.exitApp
    msg = port.WaitMessage(FrameIntervalMs(state))     # blocks AND removes
    if msg <> invalid
        ProcessMessage(msg, state)                     # dispatch, never drop
        drain remaining messages with port.GetMessage()
    end if
    UpdateTimers(...)                                  # clock, spinner, caret,
                                                       # toast, fade, ambient,
                                                       # auto-rotation,
                                                       # stalled-request reaper
    if FrameNeedsRender(...)
        RenderFrame(state)                             # draw the whole screen
        screen.SwapBuffers()
    end if
end while
```

Two details deserve emphasis:

* **`WaitMessage()` removes the message it returns.**  The loop dispatches it
  and then drains the rest with `GetMessage()`.  (An earlier version discarded
  the `WaitMessage()` result and read `GetMessage()`, silently swallowing the
  first key press after every idle period.)
* **Frames are skipped when nothing changed.**  `state.dirty` is set by every
  input handler and every asynchronous event; animations run at 20 fps
  (50 ms) or 60 fps (16 ms) only while they are actually active.  See
  [PERFORMANCE.md](PERFORMANCE.md).

### Timers

`UpdateTimers()` is one function per concern, all of them wall-clock driven
from `state.animClock`:

| Timer | Period | Notes |
|---|---|---|
| Device clock | 15 s | one `roDateTime` allocation instead of one per frame |
| Spinner phase | per frame | only while a visible card is actually missing its thumbnail |
| Toast expiry | 2.4 s | |
| Search caret | ~1 Hz | only while `searchMode` |
| Page fade | 180 ms | |
| Ambient slideshow | `state.ambientIntervalSec` | sets the dip-to-black phase, pre-fetches the next frame during the fade |
| Theme Studio auto-rotation | `themeMgr.autoSwitchInterval` | see below |
| Stalled-request reaper | 1 s | releases the concurrency slot of any request that stopped reporting |
| Daily Spotlight | once per day | winner cached in the registry, older `daily_*` keys pruned |

`UpdateAutoRotation()` is the newest of these and the reason the *Auto-switch*
row in Theme Studio now does something.  It:

1. returns immediately if `themeMgr.autoSwitchEnabled` is false, or if the
   viewer or Ambient Mode is on screen (rotating a backdrop while someone is
   reading a full-screen image is jarring, and Ambient owns its own
   sequencing);
2. schedules itself on the first tick (`autoSwitchAtMs`), then fires every
   `MaxI(60, tm.autoSwitchInterval)` seconds — 60 s is the floor, because a
   shorter interval would restart the thumbnail pipeline constantly;
3. walks `tm.BuildRotationPool(state.filtered)` with `autoSwitchIdx` so the
   sequence is stable rather than random, falling back to `state.allWallpapers`
   when the pool is empty;
4. assigns per `autoSwitchTarget` (`backdrop`, `ambient`, `both`), clears
   `state.backdropBmp`/`backdropKey` so the baked 1920×1080 backdrop is
   rebuilt, and pre-fetches the new thumbnail so the panel is never blank.

**Two intervals that are not the same thing.**  `state.ambientIntervalSec`
(registry `ambientInterval`, default 30) is how long a slide stays up.
`themeMgr.autoSwitchInterval` (registry `autoSwitchInterval`, default 3600) is
how often Theme Studio rotates what it assigns.  They were one state key once,
so changing the rotation interval silently rescheduled the slideshow.

## Input dispatch

`roUniversalControlEvent.GetInt()` returns the press code; release events are
the press code + 100 and are ignored.  The codes the channel uses
(see [CONTROLS.md](CONTROLS.md) for the full map):

```
0 Back   2 Up   3 Down   4 Left   5 Right   6 Select   7 Instant Replay
8 Rewind   9 Fast Forward   10 Info (*)   13 Play   17/18 A/B
```

`Back` (0) is the **only** exit path this code controls — the Home button is
intercepted by the OS.  `HandleGalleryInput()` implements certification 4.6:
Back in the grid moves focus to the tab bar, and Back on the tab bar exits.

Modals own the remote while open: `searchMode` first, then `filterMode`, then
the active view's handler.

## Image pipeline

`image_loader.brs` runs two transports:

* **Thumbnails** (480×270 JPEG, ~22 KB) — `roUrlTransfer.AsyncGetToFile()` into
  `tmp:/`, then `CreateObject("roBitmap", path)`.  The on-disk copy survives
  page hops for the rest of the session; `tmp:/` is wiped by the OS at exit.
  A *negative* cache (`missingKeys`) stops the loader from stat-ing `tmp:/`
  for every not-yet-fetched card on every frame.
* **Full frames** — `roTextureManager` + `roTextureRequest` with
  `SetSize(1920, 1080)` and `SetScaleMode(1)`, so 4K sources are decoded and
  rescaled off the main thread and arrive already screen-sized.  This is not
  optional: `roBitmap` is capped at 2048×2048, so a 3840×2160 JPEG can *never*
  be loaded with `CreateObject("roBitmap", path)`.  Where the texture manager
  is unavailable the loader falls back to download+`roBitmap`, which still
  covers the FHD archive.

Both tiers are bounded LRUs with an explicit byte budget, and both expose
`PrefetchFull()` / `PrefetchThumb()` so a consumer can warm an image *before* it
becomes visible — the ambient dip-to-black, the viewer's neighbours and the
auto-rotation all rely on that.  See [PERFORMANCE.md](PERFORMANCE.md) for the
numbers.

The loader also owns three things the Settings screen reports: `DiskUsage()`
(the `tmp:/` cache, budgeted to 8 MB as well as entry-capped),
`FailureCount()` (images given up on after 3 retries — *Settings → Retry
Failed Images* clears the list), and the stalled-request watchdog.

## Daily Spotlight determinism

`catalog.brs::DailyScore()` reproduces `src/utils.py::daily_score()` bit for
bit: FNV-1a over `"<UTC day>|<id>"`, then a two-step avalanche and a final
fold, compared as unsigned 32-bit values.  Because BrightScript has neither an
XOR operator nor an unsigned integer type, the hash is built from
`(a or b) - (a and b)` and Double arithmetic (`Mul32`).  The date prefix is
hashed once per day, not once per row, and the winner is cached in the
registry keyed by day + catalog size.  `RunDailyHashSelfTest()` asserts six
vectors generated by the Python implementation on every dev-build launch.

## Persistence

Four registry sections, all of which survive channel updates and reboots (and
are wiped only by uninstall, exactly as certification 4.1 requires):

| Section | Contents |
|---|---|
| `SpotlightStudio_Settings` | every preference plus the resume position (`lastActiveTab`, `lastPage`, `lastGridIdx`, `lastWallpaperId`) |
| `SpotlightStudio_Favorites` | one comma-separated id list, capped at 400 entries |
| `SpotlightStudio_License` | trial start, lifetime flag, subscription expiry (epoch **seconds**, not milliseconds — a millisecond epoch overflows a 32-bit Integer), purchase count |
| `SpotlightStudio_Cache` | the per-day Daily Spotlight winner |
