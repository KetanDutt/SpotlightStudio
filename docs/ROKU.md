# Spotlight Studio for Roku TV

**Spotlight Studio for Roku** brings the complete 7,500+ Windows Spotlight 4K & Full HD wallpaper collection to Roku streaming players, Roku Streaming Sticks, and Roku TV sets.

Designed from the ground up for the **10-foot living room experience**, Spotlight Studio delivers a fluid 60&nbsp;fps canvas interface, customizable ambient screensavers, home screen themes, and automatic wallpaper rotation.

---

## Key Features

* **High-Performance 2D Double-Buffered Engine (`roScreen`)**:
  Bypasses SceneGraph XML overhead for instantaneous navigation, smooth 60&nbsp;fps page transitions, and sub-100ms catalog indexing of 7,500+ entries.
* **Obsidian Liquid Glass Aesthetics**:
  Mathematical rounded card geometry, dynamic elevation pop, soft glowing ambient borders, and breathing focus rings designed for high-resolution televisions (1080p FHD and 4K UHD).
* **Device Local Time & Date Engine**:
  Real-time device clock synchronization supporting both 12-hour AM/PM and 24-hour military clock formats automatically resolved via Roku OS system settings or custom user override. Displayed seamlessly across the Gallery header, Fullscreen Viewer HUD, Ambient Screensaver clock capsule, and Daily Spotlight.
* **Fast Page Hopping Remote Shortcuts**:
  Rewind (`<<`) and Fast-Forward (`>>`) remote buttons instantly jump 10 pages (80 wallpapers) backwards or forwards with an animated HUD toast indicator, making it effortless to browse the full 935 pages of the archive.
* **Multi-Dimensional Wallpaper Filtering & Dynamic Sorting**:
  Accessible at any time via the remote Star (`*`) key or "Categories" tab. Features an Obsidian Liquid Glass modal with live match count, filtering across 12 categories, 4K UHD vs FHD resolutions, archive source (Peapix vs Win10Spotlight), favorite-only filters, and 11 photography tag presets (`#sunset`, `#beach`, `#forest`, `#mountains`, `#nature`, `#architecture`, etc.). Sort wallpapers on the fly by Newest, Oldest, 4K Quality First, or Random Shuffle.
* **Asynchronous Image & Bounded LRU Cache Pipeline**:
  Background thread-safe image downloader (`roUrlTransfer`) using direct `media.githubusercontent.com` binary routing (automatically rewriting `raw.githubusercontent.com` Git-LFS pointer endpoints). Uses an LRU memory eviction policy bounding thumbnails to 48 bitmaps and full-screen images to 4 bitmaps, guaranteeing a strict VRAM ceiling under ~25MB to eliminate out-of-memory crashes on 512MB hardware.
* **Deterministic Daily Spotlight**:
  Synchronized with the Web, Mobile, and Desktop clients using the exact same 32-bit FNV-1a avalanche algorithm with bit-for-bit parity across all platforms.
* **Ambient Screensaver Gallery**:
  Continuous high-resolution photo showcase with subtle Ken Burns panning, cinematic cross-fades, and an ambient time/date glass capsule.
* **Home Screen Theme Studio**:
  Six curated color palettes tailored for OLED and LED displays:
  * *Obsidian Slate* (Default flagship)
  * *Midnight Cyber* (Electric cyan & sapphire)
  * *Emerald Forest* (Lush botanical jade)
  * *Sunset Velvet* (Warm dusk amber & magenta)
  * *Royal Amethyst* (Deep indigo & violet)
  * *Arctic Frost* (Chilled silver & glacier blue)
* **Trial & In-App Purchase (IAP) Monetization**:
  * **3-Day Full Trial**: All features available without restriction upon first launch.
  * **Lifetime Full Version ($4.99)**: Permanent manual wallpaper and screensaver gallery access.
  * **Pro Monthly ($1.99) / Pro Yearly ($14.99)**: Unlocks hands-free background rotation engine (1 min, 5 min, 15 min, 30 min, 1 hr, or daily intervals).
* **Hardware Energy Pacing**:
  Event loop uses `port.WaitMessage(16)` and `port.WaitMessage(20)` for screensaver mode, keeping TV processor usage minimal when idle.
* **Certification & Deep Linking Ready**:
  Certified manifest flags (`confirm_partner_button=1`, `screensaver_private=0`, `requires_cellular=0`) and full support for ECP deep linking via `contentId` and `mediaType` parameters.

---

## Remote Control Navigation

| Key | Gallery View | Filter & Sort Modal | Fullscreen Viewer | Ambient Screensaver |
|---|---|---|---|---|
| **D-Pad Arrows** | Navigate grid cards / tabs | Up/Down rows, Left/Right cycle | Pan image / step prev/next | Previous / Next wallpaper |
| **OK / Select** | Open viewer / select item | Toggle option / Apply Filters | Toggle UI overlay & details | Wake to Gallery |
| **Star (`*`)** | Open Filter & Sort Modal | Close modal / return to grid | Toggle favorite heart | Restore purchases |
| **Rewind (`<<`)** | Jump 10 pages backward | — | Jump 10 wallpapers back | — |
| **Fast-Fwd (`>>`)** | Jump 10 pages forward | — | Jump 10 wallpapers ahead | — |
| **Play / Pause** | Launch Ambient Slideshow | — | Toggle Slideshow autoplay | Exit to Gallery |
| **Replay (`<--`)** | Jump to Random Wallpaper | — | Reset View | Exit to Gallery |
| **Back** | Return to top nav / exit | Dismiss modal dialog | Return to gallery | Return to gallery |

---

## Deep Linking & External Control Protocol (ECP)

Spotlight Studio responds to external launch triggers:

```bash
# Direct wallpaper link by ID
curl -d '' "http://<roku-ip>:8060/launch/dev?contentId=5930"

# Direct mode launch: screensaver, ambient, theme, daily
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=screensaver"
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=theme"
curl -d '' "http://<roku-ip>:8060/launch/dev?mediaType=daily"
```

---

## Architecture & Code Structure

The Roku channel is located in `roku/` (kept local per project policy):

```text
roku/
├── manifest                      # Roku channel metadata, resolutions, certification flags
├── assets/
│   └── catalog.json              # Packaged local wallpaper catalog (~7,500 entries)
├── images/
│   ├── icon_fhd.png              # 540x405 channel poster (FHD)
│   ├── icon_hd.png               # 290x218 channel poster (HD)
│   ├── splash_fhd.png            # 1920x1080 splash screen (FHD)
│   └── splash_hd.png             # 1280x720 splash screen (HD)
└── source/
    ├── main.brs                  # Main event loop, frame pacing & deep link dispatcher
    ├── theme.brs                 # Design system colors, drawing primitives & animations
    ├── catalog.brs               # Catalog loader, search, deterministic FNV-1a & sorting
    ├── image_loader.brs          # Async Git-LFS downloader, bounded LRU cache & spinners
    ├── settings.brs              # User preferences registry manager (clock, sort, quality)
    ├── store.brs                 # In-app purchase simulator & Roku ChannelStore integration
    ├── license.brs               # 3-day trial state, registry storage & license checks
    ├── favorites.brs             # User favorites persisted to roRegistrySection
    ├── theme_manager.brs         # Palette switcher and auto-switching interval scheduler
    ├── utils.brs                 # Date/local time formatting, text clipping, and safe math
    ├── view_gallery.brs          # Primary wallpaper grid view & live header status
    ├── view_filter.brs           # Liquid Glass multi-dimensional Filter & Sort modal dialog
    ├── view_viewer.brs           # Fullscreen high-res wallpaper inspector & metadata HUD
    ├── view_daily.brs            # Daily Spotlight hero presentation view
    ├── view_ambient.brs          # Ken Burns ambient screensaver & clock capsule
    ├── view_screensaver_gallery.brs # Ambient screensaver selector & launcher
    ├── view_theme.brs            # Home-screen theme customization view
    ├── view_store.brs            # In-app purchase store (Lifetime & Pro Subscriptions)
    └── view_settings.brs         # Settings (Clock Format, Default Sorting, Cache, Credits)
```

---

## Local Development & Simulator Testing

The project includes compatibility testing with the headless **Roku Simulator**:

### 1. Compatibility Scan
Verify BrightScript component usage and syntax:
```bash
node "C:\Users\Ketan Dutt\Desktop\RokuEmulator\simulator\apps\cli\src\index.js" inspect "roku"
```

### 2. Headless Verification
Test that the channel boots, loads the catalog, and renders 10 frames cleanly:
```bash
node "C:\Users\Ketan Dutt\Desktop\RokuEmulator\simulator\apps\cli\src\index.js" "roku" --port 8077 --headless --exit --frames 10
```

### 3. Interactive Simulator
Launch the live interactive emulator with virtual remote control:
```bash
node "C:\Users\Ketan Dutt\Desktop\RokuEmulator\simulator\apps\cli\src\index.js" "roku"
```

---

## Sideloading onto a Physical Roku Device

1. **Enable Developer Mode on Roku**:
   Using the physical Roku remote, press:
   `Home` 3× → `Up` 2× → `Right` → `Left` → `Right` → `Left` → `Right`.
   Enable the Developer Server and set a password. Note the IP address.
2. **Package the Channel**:
   Create a standard ZIP archive of the `roku/` folder contents (`manifest`, `assets/`, `images/`, `source/`).
3. **Deploy via Web Browser**:
   Open `http://<roku-device-ip>` in your browser, log in with `rokudev` and your password, click **Browse**, select the ZIP file, and click **Install**.
