# Roku certification compliance

This document records **why** the channel is shaped the way it is.  Every row
maps a Roku certification requirement (from the *Certification testing* list,
last updated October 2026) to the code that satisfies it, or records a
deliberate decision where the requirement does not apply.

`scripts/package_roku.py` enforces the machine-checkable rows on every build
(`make roku-check`), and the BrighterScript compile gate
(`make roku-lint`) enforces the code-level ones.

## 3. Performance

| Req | Requirement | Status / implementation |
|---|---|---|
| 3.1 | Responsive on all supported devices | Dirty-frame rendering plus bounded caches; see [PERFORMANCE.md](PERFORMANCE.md) |
| 3.2 | Fully rendered home screen ≤ 15 s | The packaged catalog is parsed behind the manifest splash; the Daily Spotlight scan is cached per day in the registry; first-frame time is logged to the debug console |
| 3.3 | Screen transitions ≤ 3 s | Every view switch is a synchronous redraw (≤ 1 frame) |
| 3.4 | Loading indicator for work > 3 s; respond ≤ 10 s | Per-card spinners, a full-frame spinner block in the viewer/ambient, and toasts for store/licence operations |
| 3.5 | Navigation ≤ 250 ms | No filtering or sorting happens on a key press except the explicit filter dialog rows, which scan the array once (~1 ms) |
| 3.6 | Content starts ≤ 8 s | Thumbnails stream in ~100–300 ms from the CDN; the viewer shows the cached thumbnail while the full frame decodes |
| 3.7 | **Package ≤ 4 MB** | Enforced by the packaging script. Channel: **2.65 MB unpacked / ~830 KB zipped**. The old catalog alone was 4.18 MB; `scripts/build_roku_catalog.py` trims it to 2.20 MB by dropping columns the TV never reads |

## 4. App operation

| Req | Requirement | Status / implementation |
|---|---|---|
| 4.1 | Updates persist saved data | Everything user-owned lives in `roRegistrySection`s (settings, favourites, licence, cache). Nothing is stored in `tmp:/` or `cachefs:/` except throwaway thumbnails |
| 4.4 | Options (★) reserved during video playback | There is no video playback; ★ is free for in-app use (Filter dialog, HUD toggle) |
| 4.5 | **Must not override or interfere with the system screensaver** | `roku/manifest` declares **neither `screensaver_title` nor `screensaver_private`**, and no source file defines `RunScreenSaver()`. The in-app "Ambient Mode" is a channel feature that only runs while the user is in the app. A *standalone* screensaver app (which Roku does permit) is built separately — see [SCREENSAVER.md](SCREENSAVER.md) |
| 4.6 | **Back returns to the previous screen; on the home screen it exits** | `HandleGalleryInput()`: Back in the grid focuses the tab bar, Back on the tab bar sets `exitApp`. Every secondary view returns to the gallery on Back; the viewer/ambient return to their origin |
| 4.7–4.10 | Trick play, captions, instant replay, bookmarks | Not applicable — the channel plays no video and shows no captions |
| 4.11 | Voice transport controls | Not applicable below the streaming-hour threshold and there is no playback to control |
| 4.12 | Roku voice keyboards for email/PIN/password entry | Not applicable — the channel has no login and collects no credentials. The on-screen search keyboard is a content search, not credential entry |

## 5. Deep linking

| Req | Requirement | Status / implementation |
|---|---|---|
| 5.1 | Deep links for all media types | `contentID` / `contentId` / `id` open a wallpaper in the viewer; `mediaType` accepted; `query`/`search`/`keyword` pre-fill the search; `action=ambient` starts Ambient Mode. Parameters are read at launch (`Main(args)`) **and** while running via `roInput` → `roInputEvent` ([DEEP_LINKING.md](DEEP_LINKING.md)) |
| 5.2 | Direct to Play | `supports_input_launch=1` in the manifest (verified by the packaging script) plus the `roInput` listener above |
| 5.3 | No deep links into other apps | The channel never launches anything external |

## 6. UI and graphics

| Req | Requirement | Status / implementation |
|---|---|---|
| 6.1 | Non-zero version, incremented per build | `major_version=2 minor_version=7 build_version=1`; the packaging script fails on `build_version=0` |
| 6.3 | Age-appropriate content and store copy | The archive is landscape/nature photography; store copy makes no misleading claims |
| 6.4 | Splash FHD+HD, artwork **not transparent**, splash URI in manifest | `scripts/flatten_roku_art.py` composites every PNG in `roku/images/` onto `#08090E` and rewrites it as colour-type 2 (no alpha). `scripts/make_icons.py` does the same at generation time. The packaging script decodes each PNG and fails if any pixel is semi-transparent or an alpha channel remains |

## Accounts and purchases (section 2)

| Req | Requirement | Status / implementation |
|---|---|---|
| 2.1 | Transactional content must use Roku Pay | All three products go through `roChannelStore` — one instance for the app's lifetime, `GetCatalog()` → `GetPurchases()` → `ClearOrder()` → `SetOrder([{code, qty}])` → `DoOrder()`. No external payment paths exist ([IAP.md](IAP.md)) |
| 2.2 | On-device authentication | The channel has no accounts; nothing to sign in to |
| 2.4 | No nested apps / off-device purchase directions | The store never tells the user to buy elsewhere |

## Deprecated APIs

Static Analysis reports deprecated APIs as errors.  The packaging script scans
every source file (comments excluded) for:

`InitClientCertificates` (deprecated OS 16.0, blocked from 1 Apr 2027),
`enableFreshConnection` (removed OS 11.5), `ShowChannelStoreSpringboard`
(blocked), `Eval(` (sunset OS 9.3), the removed legacy screens
(`roKeyboardScreen`, `roListScreen`, `roPosterScreen`, `roGridScreen`,
`roImageCanvas`, `roParagraphScreen`, `roSpringboardScreen`) and `file://`
URLs.  None are present.  TLS still uses
`SetCertificatesFile("common:/certs/ca-bundle.crt")`, which is the supported
path.

## Known decision points (read before submitting)

1. **`rsg_version`** — Roku requires `rsg_version=1.3` in the manifest of
   SceneGraph apps from October 2026.  This channel contains no SceneGraph
   components at all (pure `roScreen` 2D, which Roku continues to support for
   games, screensavers and custom renderers).  If Static Analysis ever demands
   the flag on a non-SG package, add exactly one line:
   `rsg_version=1.3`.
2. **2D canvas resolution** — the channel renders into a fixed 1920×1080
   `roScreen` and lets the OS scale it on 720p panels (the documented
   behaviour: "when a screen is created with a different resolution than the
   output display, it is scaled automatically").  `RunUserInterface()` logs a
   warning if the canvas is not 1920×1080 so a regression is visible in the
   debug console instead of silently mis-rendering.
3. **`screensaver_title`** — if you ever add it to `roku/manifest`, publishing
   *will* be blocked: Roku's screensaver policy reserves that key for
   standalone screensaver apps and requirement 4.5 forbids channels from
   shipping screensavers.  Use `roku-screensaver/` instead.
4. **Memory on 512 MB devices** — the peak texture budget is ~32 MB (see
   [PERFORMANCE.md](PERFORMANCE.md)).  Test the 4K viewer and long Ambient
   sessions on a Streaming Stick before submission; if a device reports
   pressure, lower `GfxLimits()` first.
