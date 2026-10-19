# Spotlight Studio for Roku TV

**Spotlight Studio for Roku** brings the complete 7,500+ Windows Spotlight 4K and Full HD wallpaper collection to Roku streaming players, Roku Streaming Sticks, and Roku TV sets.

Designed from the ground up for the **10-foot living room experience**, Spotlight Studio delivers a fluid 60&nbsp;fps 2D canvas interface, customizable ambient screensavers, home screen themes, and automated wallpaper rotation.

---

## Key Features

- **Liquid Glass 10-foot UI (`roScreen`)**: Custom 1080p FHD double-buffered 2D canvas designed specifically for television displays and Roku remotes, bypassing SceneGraph XML latency for instant responsiveness.
- **7,470+ Curated Wallpaper Archive**: Bundled offline catalog (`pkg:/assets/catalog.json`) with high-resolution Git-LFS binary asset streaming via `media.githubusercontent.com`.
- **4×2 Gallery Grid with Fast Page Hopping**: Real-time asynchronous thumbnails with spinner rings, 4K/FHD quality badges, and instant 10-page jumps (`<<` / `>>`) across all 935 pages.
- **Multi-Dimensional Filter & Sort Modal**: Star (`*`) key modal filter covering 12 categories, 4K UHD vs FHD quality, Peapix vs Win10Spotlight source, user favorites, and Newest/Oldest/4K-First/Random sorting.
- **Deterministic UTC Daily Spotlight**: Bit-for-bit parity with web, desktop, and mobile clients using 32-bit FNV-1a avalanche hashing.
- **Cinematic Ambient Screensaver**: Full-screen photo presentation with device local time/date pill and configurable rotation intervals (5s to 300s).
- **Home Screen Theme Studio & Auto-Switching**: 6 curated OLED/LED palettes (*Obsidian Slate*, *Midnight Cyber*, *Emerald Forest*, *Sunset Velvet*, *Royal Amethyst*, *Arctic Frost*) plus automatic wallpaper and screensaver rotation for Pro subscribers.
- **Bounded LRU Memory Cache**: Strict 48-thumbnail and 4-full-image cache ceilings keeping VRAM under ~25MB to prevent crashes on entry-level 512MB Roku devices.
- **Hardware Energy Pacing**: 16ms event loop pacing (`port.WaitMessage(16)`) to keep streaming stick processors cool.
- **Roku Channel Store Certification Ready**: Certified manifest with hardware flags (`confirm_partner_button=1`, `screensaver_private=0`), deep linking (`contentId`, `mediaType`), and full ECP support.

---

## Roku Remote Control Mapping

| Roku Remote Button | Gallery View | Filter & Sort Modal | Fullscreen Lightbox | Ambient Screensaver |
|---|---|---|---|---|
| **D-Pad Arrows** | Move card / nav tab | Cycle rows & options | Previous / Next wallpaper | Previous / Next wallpaper |
| **OK / Select** | Open Fullscreen Viewer | Toggle option / Apply | Toggle HUD overlay | Wake / Exit to Gallery |
| **Star (`*`)** | Open Filter & Sort Modal | Close & apply filters | Toggle Favorite heart | Restore Purchases |
| **Rewind (`<<`)** | Jump 10 pages backward | — | Jump 10 wallpapers back | — |
| **Fast-Fwd (`>>`)** | Jump 10 pages forward | — | Jump 10 wallpapers ahead | — |
| **Play / Pause** | Launch Ambient Mode | — | Toggle Slideshow autoplay | Exit to Gallery |
| **Replay (`<--`)** | Jump to Random Wallpaper | — | Reset View | Exit to Gallery |
| **Back** | Return to Nav Tabs / Exit | Dismiss Modal | Return to Gallery | Exit to Gallery |

---

## Deep Linking & External Control Protocol (ECP)

Spotlight Studio supports standard Roku ECP deep linking:

```bash
# Open specific wallpaper by ID (e.g., ID 5930)
curl -d '' "http://<roku-ip>:8060/launch/dev?contentId=5930"

# Launch directly into Ambient Screensaver mode
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=screensaver"

# Launch into Home Screen Theme Studio
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=theme"

# Launch directly into Daily Spotlight
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=daily"
```

---

## In-App Purchase (IAP) & Monetization

- **3-Day Full Access Trial**: Unlimited access to all features upon first installation.
- **Lifetime Full Version (`BuyFullVersion` - $4.99)**: Permanent manual wallpaper and screensaver gallery access.
- **Pro Monthly (`SubMonthly` - $1.99/mo) / Pro Yearly (`SubYearly` - $14.99/yr)**: Unlocks the automated background rotation engine (1 min, 5 min, 15 min, 30 min, 1 hr, or daily intervals).

---

## Local Development & Simulator Verification

```bash
# 1. Compatibility inspection scan
node "C:\Users\Ketan Dutt\Desktop\RokuEmulator\simulator\apps\cli\src\index.js" inspect "roku"

# 2. Automated headless test (render 10 frames and exit)
node "C:\Users\Ketan Dutt\Desktop\RokuEmulator\simulator\apps\cli\src\index.js" "roku" --port 8077 --headless --exit --frames 10

# 3. Interactive GUI Desktop Emulator
"C:\Users\Ketan Dutt\Desktop\RokuEmulator\dist\RokuSimulator-Portable-1.2.0-x64.exe" "roku"
```

---

## Sideloading onto a Physical Roku TV

1. **Enable Developer Mode**: On the Roku remote, press `Home` 3× → `Up` 2× → `Right` → `Left` → `Right` → `Left` → `Right`. Set a password and record the device IP.
2. **Package Channel**: Zip the contents of `roku/` (`manifest`, `assets/`, `images/`, `source/`).
3. **Install**: Navigate to `http://<roku-ip>` in your web browser, log in with `rokudev` and your password, upload the zip archive, and click **Install**.
