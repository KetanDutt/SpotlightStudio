# Application state reference

`BuildState()` in `roku/source/main.brs` returns the single associative array
that every view, input handler and timer receives.  This page is the field-by-
field reference, including the invariants that are easy to break.

## Invariants

1. **One `state`, no globals.**  BrightScript compiles all of `source/` into a
   single namespace, so anything not on `state` (or in the global AA behind a
   memoised accessor in `constants.brs` / `gfx_cache.brs`) is effectively
   global mutable state.  Don't add any.
2. **Reading a key that does not exist returns `invalid`, it does not raise.**
   A typo is invisible at runtime and shows up as a blank UI element.
   `scripts/roku_audit.py` fails the build on any `state.<key>` read that is
   never assigned — see [AUDIT.md](AUDIT.md).
3. **The viewer and Ambient Mode never index `state.filtered`.**  They use
   `state.browseList` + `state.browseIdx`, assigned when they are entered.
4. **Preferences are owned by `settingsMgr`.**  The `state` copies are a
   *mirror*, refreshed by `SyncFilterState()`.  Never write them directly.

## Surfaces and managers

| Field | Type | Notes |
|---|---|---|
| `screen` | `roScreen` | 1920×1080 canvas, alpha blending enabled |
| `port` | `roMessagePort` | shared by the screen, `roUrlTransfer`, `roTextureManager`, `roChannelStore` and `roInput` |
| `deviceInfo` | `roDeviceInfo` | clock format, link status, diagnostics |
| `appInfo` | `roAppInfo` | version string, `IsDev()` |
| `settingsMgr` | AA | preferences, see `settings.brs` |
| `favMgr` | AA | favourites set, capped at 400 |
| `licenseMgr` | AA | trial + Roku Pay entitlements |
| `themeMgr` | AA | palette, ambient/backdrop assignment, auto-rotation |
| `audioMgr` | AA | Roku system sound effects |
| `storeMgr` | AA | Roku Pay catalog / purchases |
| `imgLoader` | AA | two-tier image pipeline |
| `launchTimer` | `roTimespan` | marked at the top of `RunUserInterface()` |
| `fonts` | AA | `title` 30, `heading` 26, `body` 22, `small` 17, `caption` 15 |
| `logoBitmap` | `roBitmap` | `pkg:/images/icon_hd.png` (290×218) |
| `appVersion` | string | `roAppInfo.GetVersion()`, shown in Settings |
| `canvasW`, `canvasH` | int | **measured from `screen.GetWidth()/GetHeight()`**, not assumed — a 720p panel downscales the 1920×1080 canvas |
| `uiResolution` | string | `hd` ≤ 1280, `fhd`, `uhd` ≥ 3840 — derived from `canvasW`, so Settings diagnostics tell the truth |

### Fonts — read this before touching `BuildFonts()`

`roFont` has **no `Copy()` and no `SetSize()`**.  Fonts are created with
`roFontRegistry.GetDefaultFont(size, bold, italic)`; see
[AUDIT.md](AUDIT.md#roku-api-surface).

## Content

| Field | Notes |
|---|---|
| `allWallpapers` | the parsed catalog, newest-first. Never mutated in place |
| `filtered` | the working list. **Identity may equal `allWallpapers`** — `FilterWallpapers()` returns the source array by reference when no filter is active |
| `screensaverList` | Ambient Collection: 4K first, then landscape, falling back to `filtered` |
| `dailyWallpaper` | today's deterministic pick, or `invalid` |
| `totalCount` | `allWallpapers.Count()`, cached so the empty state and the filter dialog do not re-count |

## Filter state (the mirror)

These seven fields are **copies** of persisted preferences.  They exist because
the renderers have no accessor to `settingsMgr.cache`, and reading
`settingsMgr.activeCategory` evaluates to `invalid` — the bug that used to blank
out every filter chip in the gallery header.

| Field | Registry key | Default |
|---|---|---|
| `activeCategory` | `activeCategory` | `"All"` |
| `activeResolution` | `activeResolution` | `"All"` |
| `activeSource` | `activeSource` | `"All"` |
| `activeTag` | `activeTag` | `""` |
| `activeSearch` | `searchQuery` | `""` |
| `sortOrder` | `sortOrder` | `"newest"` |
| `favoritesOnly` | `favoritesOnly` | `false` |

`SyncFilterState(state)` refreshes all seven and is called from
`ApplyFilters()`.  If you add a preference the UI reads, add it to
`BuildState()`, `SyncFilterState()` **and** `CreateSettingsManager().Defaults()`
in the same change.

## Navigation

| Field | Values |
|---|---|
| `activeView` | `gallery`, `daily`, `screensavers`, `theme`, `store`, `settings`, `viewer`, `ambient` |
| `activeTab` | index into `NavTabs()`; use the `Tab*()` helpers, never a literal |
| `focusArea` | `grid` or `nav` (gallery only) — drives the Back ladder for cert 4.6 |
| `returnView` | where Back returns to from the viewer / ambient |
| `gridIdx`, `currentPage` | gallery cursor; the absolute index is `currentPage * 8 + gridIdx` |
| `ssGridIdx`, `currentPageSS` | Ambient Collection cursor (6 per page) |
| `dailyAction`, `settingsIdx`, `storeIdx`, `themeRow` | row cursors for the list screens |
| `kbRow`, `kbCol` | on-screen keyboard cursor |
| `filterMode`, `searchMode` | modal flags; **modals own the remote while set** |
| `filterRow` | row cursor inside the filter modal; row 5 opens the keyboard instead of cycling |
| `caretVisible` | blinking caret in the search field (~1 Hz) |

## Viewer and Ambient Mode

| Field | Notes |
|---|---|
| `browseList`, `browseIdx` | the one list and index both screens operate on |
| `showHud` | viewer HUD visibility |
| `aspectMode` | `0` = FIT (letterbox), `1` = FILL (crop) |
| `zoomScale` | 1.0 – 3.0, reset on every wallpaper change |
| `slideshowActive` | viewer slideshow / ambient auto-advance |
| `switchAtMs` | ambient slideshow: start of the current slide |
| `nextSlideAtMs` | viewer slideshow deadline (viewer keeps the still frame, ambient dips to black) |
| `ambientShowInfo` | ambient HUD visibility |
| `ambientTransition` | `0` idle, `1` dip to black (500 ms), `2` reveal (700 ms) |
| `ambientTransStart` | start of the current transition phase |
| `ambientIntervalSec` | **ambient slideshow** interval, in seconds |

> **Naming trap.**  `state.ambientIntervalSec` (how long a slide stays up) is
> *not* `themeMgr.autoSwitchInterval` (how often Theme Studio rotates the
> backdrop).  They were the same state key once, so changing the rotation
> interval silently rescheduled the slideshow.

## Auto-rotation (Theme Studio)

| Field | Notes |
|---|---|
| `autoSwitchAtMs` | wall-clock time of the next rotation; `0` = not yet scheduled |
| `autoSwitchIdx` | walks the rotation pool so the sequence is stable, not random |

Driven by `UpdateAutoRotation()`, which is skipped while the viewer or Ambient
Mode is on screen.  Rotation only ever assigns the **Ambient Mode** wallpaper
and the **menu backdrop** — a channel cannot change the Roku home screen or the
system screensaver (certification 4.5).

## Render loop

| Field | Notes |
|---|---|
| `animClock` | `roTimespan` marked at launch; the single clock for every animation |
| `dirty` | set by input handlers and async events; the loop renders when it is true |
| `spinnerAngle`, `spinnerVisible` | loading indicator; only "visible" when a card on screen is actually missing its thumbnail |
| `transitioning`, `transitionStartMs` | 180 ms page-change fade |
| `clockTime`, `clockDate`, `lastClockMs` | throttled device clock (refreshed every 15 s, one `roDateTime` instead of one per frame) |
| `lastReapMs` | stalled-request watchdog (every 1 s) |
| `lastFrameMs` | for the animation frame budget |
| `toastMessage`, `toastUntilMs` | transient status toast (2.4 s) |
| `backdropBmp`, `backdropKey` | the baked 1920×1080 gallery backdrop, rebuilt only when the assignment changes |
| `exitApp` | ends `MainLoop()`; the only clean exit |

## Render-loop contract

`AnimationActive()` decides the frame budget, so it *is* the budget.  A screen
that returns `true` unconditionally pins the loop at 20 fps and re-issues every
draw call — including a full-screen 1920×1080 rescale — twenty times a second
for a static image.  Return `true` only while something is genuinely moving.

## Persistence

| Registry section | Contents |
|---|---|
| `SpotlightStudio_Settings` | every preference plus the resume position |
| `SpotlightStudio_Favorites` | one comma-separated id list, capped at 400 |
| `SpotlightStudio_License` | trial start (epoch **seconds**), lifetime flag, subscription expiry (epoch seconds), product code, purchase count |
| `SpotlightStudio_Cache` | today's Daily Spotlight winner; older `daily_*` keys are pruned on write |

All four survive channel updates and reboots and are wiped only by uninstall,
which is what certification 4.1 asks for.
