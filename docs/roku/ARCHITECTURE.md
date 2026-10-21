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
| `catalog.brs` | Catalog loading, filtering, sorting, FNV-1a 32-bit hashing and the Daily Spotlight |
| `image_loader.brs` | The non-blocking two-tier image pipeline and its caches |
| `settings.brs` `favorites.brs` `license.brs` `store.brs` `theme_manager.brs` `audio.brs` | The persistence and entitlement layer, all backed by `roRegistrySection` (plus `roChannelStore` for the store) |
| `view_*.brs` | One render function per screen |

## Application state

`BuildState()` in `main.brs` returns the one associative array every view and
input handler receives.  The fields fall into five groups:

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

Both tiers are bounded LRUs with an explicit pixel budget; see
[PERFORMANCE.md](PERFORMANCE.md) for the numbers.

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
