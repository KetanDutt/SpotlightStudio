# 🍏 Spotlight Studio — Apple Liquid Glass Edition

A high-performance, multithreaded desktop application, web crawler, and static showcase that automatically downloads **all** Windows Spotlight wallpapers from [Peapix](https://peapix.com/spotlight) and [Windows10Spotlight](https://windows10spotlight.com/), saves them in the **highest available resolution** (up to 4K / UHD), deduplicates them using perceptual hashing (`dHash`), and presents them in a premium Apple Liquid Glass spatial interface.

[![Static Showcase](https://img.shields.io/badge/Web%20Showcase-GitHub%20Pages-38bdf8?style=flat-square)](index.html)
[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12%20%7C%203.14-3b82f6?style=flat-square)](https://www.python.org/)
[![Changelog](https://img.shields.io/badge/Changelog-v2.1.0-6366f1?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)

---

## ✨ Key Features

- **💎 Apple Liquid Glass UI**:
  - Translucent surfaces with deep backdrop filters (`blur(36px) saturate(200%)`), specular top edge highlights, and subtle ambient shadows.
  - Floating top navigation island, spatial filter panel, and spring-eased micro-interactions.
  - Deep obsidian gradient canvas with organic, low-contrast ambient spatial lighting.
- **🚀 High-Throughput Multithreaded Engine**:
  - Independent async pools: **32 concurrent downloads** + **4 parallel gallery scrapers** backed by an `aiohttp` connection pool with up to 128 TCP connections.
  - CPU-intensive tasks (Pillow decode, 16-bit `dHash`, 480×270 Lanczos thumbnail generation, and disk I/O) are offloaded to a worker `ThreadPoolExecutor`, keeping the event loop 100% free for network streams.
  - Sustained throughput of **7–10+ high-res images per second**.
- **🌟 Maximum Quality (4K UHD & FHD)**:
  - Peapix wallpapers are fetched directly at `_UHD.jpg` (3840×2160, 4K) with an automatic fallback chain (`_1920` → `_1280` → `_640`).
  - Windows10Spotlight extracts the largest image from the `srcset` attribute (typically 1920px FHD).
- **📂 Source-Partitioned Organization**:
  - Images and thumbnails are organized directly by source:
    `images/peapix/`, `images/win10spotlight/`, `images/thumbs/peapix/`, and `images/thumbs/win10spotlight/`.
- **🔍 Perceptual Deduplication (`dHash`)**:
  - Computes a 16-bit difference hash for every image.
  - Automatically identifies duplicates across sites and upgrades to higher-resolution copies when found.
- **🌐 Dual-Mode Deployment (Static Web + Desktop App)**:
  - **GitHub Pages (Web Showcase)**: 100% static, client-side viewing, searching, and downloading powered by `data/wallpapers.json` with zero backend requirements.
  - **Desktop App (Crawler Control Center)**: Native PyWebView window with full crawler controls (Start, Pause, Stop), rolling speed tracker (`⚡ /s`), and 1-click Windows desktop wallpaper integration.
- **🏷️ Interactive Tag Filtering & Shuffle Discovery**:
  - One-click tag chips (`#ocean`, `#mountain`, `#aurora`) instantly filter the collection.
  - Built-in **Shuffle** button and keyboard shortcut (`R`) for random serendipitous wallpaper discovery.
  - Copy direct full-resolution link to clipboard (`C`).
- **⌨️ Keyboard Navigation Shortcuts**:
  - `←` / `→` : Navigate previous/next wallpaper in lightbox
  - `Esc` : Close lightbox / unfocus search
  - `R` : Shuffle & view a random wallpaper
  - `C` : Copy direct image link
  - `/` : Instant focus search bar
- **⚡ Progressive JPEG & Native HTTP/2 Streaming**:
  - 100% of thumbnails re-encoded as optimized progressive JPEGs for sub-50ms visual paint.
  - Above-the-fold image prioritization (`fetchpriority="high"`) and native HTTP/2 multi-stream loading.
- **🔄 Git State Preservation**:
  - SQLite database queues (`data/wallpapers.db`), static catalog (`data/wallpapers.json`), and wallpapers (`images/`) are tracked in git so anyone can clone the repo and resume downloading right where anyone left off.

---

## 🚀 Quick Start

### 1. Requirements
- **Windows 10 / 11** (for the native desktop window and wallpaper setting; server & scraper also run on Linux/macOS)
- **Python 3.10+** (tested on Python 3.10, 3.11, 3.12, 3.14)

### 2. Instant Launch (Windows)
- **Desktop Window (PyWebView)**: Double-click **`start_desktop.bat`**.
  *(If the virtual environment is missing, the script will automatically create it and install all dependencies!)*
- **Headless Server Mode**: Double-click **`start_server.bat`** and visit `http://127.0.0.1:8765/`.

### 3. Manual Installation (Cross-Platform)

```bash
# 1. Clone repository
git clone https://github.com/KetanDutt/WindowsSpotlightWallpapers.git
cd WindowsSpotlightWallpapers

# 2. Set up virtual environment
python -m venv venv

# Windows activate:
.\venv\Scripts\activate
# Linux/macOS activate:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run Desktop Window:
python main.py

# Or run Headless Server:
python main.py --server --port 8765
```

---

## 🌐 Deploy to GitHub Pages (Static Web Showcase)

Deploy a public, interactive web showcase with zero server hosting costs:

1. Push your repository to GitHub (ensure `data/wallpapers.json` and `images/` are committed).
2. Go to **Settings** → **Pages** on your GitHub repository.
3. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/ (root)`
4. Click **Save**. Within 1–2 minutes, your showcase will be live at:
   `https://<your-username>.github.io/<your-repository-name>/`

---

## 🔄 Collaboration & Resuming Downloads

Both the SQLite database (`data/wallpapers.db`), the static catalog (`data/wallpapers.json`), and downloaded wallpapers (`images/`) are tracked in git:
- **Pick Up Where Anyone Left Off**: When anyone clones the repository, the database already knows which 1,378+ images are downloaded. Clicking **Start** in the desktop app continues downloading the remaining queue without rescraping.
- **Updating the Web Catalog**: After downloading new wallpapers, simply commit and push:
  ```bash
  git add images/ data/
  git commit -m "Update wallpapers catalog"
  git push
  ```
  GitHub Pages will automatically update with the latest wallpapers!

---

## ⚙️ Concurrency & Bandwidth Configuration

All parameters are centralized in `.env`:

```dotenv
# Server Configuration
HOST=127.0.0.1
PORT=8765

# Storage Directories
IMAGES_DIR=images
DB_PATH=data/wallpapers.db
LOG_PATH=data/downloader.log

# ── High-Throughput Concurrency Settings ──
CONCURRENT_DOWNLOADS=32      # Simultaneous downloads (try 64 on 100+ Mbps)
CONCURRENT_SCRAPERS=4        # Gallery pages scraped in parallel
MAX_CONNECTIONS=128          # Total TCP socket connection pool
MAX_CONNECTIONS_PER_HOST=48  # Max connections per host
CPU_THREADS=0                # ThreadPool workers (0 = auto)

# ── Reliability ──
REQUEST_DELAY_SECONDS=0.1
MAX_RETRIES=3
REQUEST_TIMEOUT_SECONDS=30
```

---

## 📂 Project Architecture

```
WindowsSpotlightWallpapers/
├── .env                     # Local environment settings
├── .env.example             # Example configuration template
├── .gitignore               # Clean Git ignore rules (tracks images & DB, ignores logs/venv)
├── index.html               # Dual-mode Apple Liquid Glass UI (GitHub Pages & Desktop)
├── sw.js                    # High-performance Service Worker (offline cache & instant load)
├── main.py                  # Application entry point (CLI & PyWebView launcher)
├── requirements.txt         # Pinned project dependencies
├── start_desktop.bat        # Windows desktop 1-click launcher with auto-setup
├── start_server.bat         # Headless browser mode 1-click launcher with auto-setup
├── README.md                # Project documentation
│
├── docs/                    # Comprehensive Documentation Suite
│   ├── ARCHITECTURE.md      # Detailed system design, concurrency model & deduplication
│   ├── API.md               # REST API reference, endpoints, schemas & examples
│   ├── DEPLOYMENT.md        # GitHub Pages setup, server hosting & scheduled task guide
│   └── TROUBLESHOOTING.md   # Diagnostic guide for common issues & solutions
│
├── src/
│   ├── __init__.py          # Package initialization
│   ├── config.py            # Typed settings & environment loader
│   ├── database.py          # SQLite schema, WAL mode, transaction management & queues
│   ├── scrapers.py          # Async scrapers for Peapix & Windows10Spotlight
│   ├── downloader.py        # Async downloader + ThreadPoolExecutor for PIL/dHash
│   ├── engine.py            # Dual-pool download & scraping coordination engine
│   └── api.py               # FastAPI REST endpoints & static file serving
│
├── templates/
│   └── index.html           # Server-side HTML template (synced with root index.html)
│
├── images/                  # Wallpapers partitioned into source folders
│   ├── peapix/              # Full-resolution 4K/UHD wallpapers from Peapix
│   ├── win10spotlight/      # Full-resolution wallpapers from Windows10Spotlight
│   └── thumbs/              # Fast 480×270 thumbnail cache organized by source
│       ├── peapix/
│       └── win10spotlight/
│
└── data/
    ├── wallpapers.db        # SQLite database storing metadata & queue state
    ├── wallpapers.json      # Lightweight static catalog for GitHub Pages
    └── downloader.log       # Application logs (ignored in git)
```

---

## 🌐 REST API Endpoints Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the Liquid Glass single-page application |
| `GET` | `/api/health` | Health check returning status and queue sizes |
| `GET` | `/api/status` | Engine status, download counters, speed, and concurrency |
| `POST` | `/api/control/start` | Starts or resumes background crawling & downloading |
| `POST` | `/api/control/pause` | Pauses background workers safely |
| `POST` | `/api/control/stop` | Stops the engine and synchronizes `wallpapers.json` |
| `GET` | `/api/wallpapers` | Paginated, searchable, and sortable wallpaper catalog |
| `GET` | `/api/wallpapers/{id}` | Fetches metadata for a single wallpaper |
| `POST` | `/api/wallpapers/{id}/set-wallpaper` | Applies the image as Windows desktop wallpaper |
| `POST` | `/api/catalog/sync` | Manually triggers `data/wallpapers.json` export |
| `GET` | `/api/export/json` | Exports entire wallpaper database as JSON |
| `GET` | `/api/wallpapers/{id}/image` | Redirects to the full-resolution wallpaper image |
| `GET` | `/api/export/csv` | Exports entire wallpaper database as CSV |
| `GET` | `/api/docs` | Interactive Swagger UI API documentation |
| `GET` | `/api/redoc` | Interactive ReDoc documentation |

*For complete API schemas and query parameter definitions, see [`docs/API.md`](docs/API.md).*

---

## 📋 Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for a detailed version history.

## 🤝 Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## 📚 Documentation Links

- 🏛️ **[System Architecture & Concurrency](docs/ARCHITECTURE.md)**: Deep dive into the dual async pools, CPU thread pool, and perceptual deduplication.
- 🔌 **[REST API Specification](docs/API.md)**: Full endpoint reference, query parameters, schemas, and examples.
- 🚀 **[Deployment Guide](docs/DEPLOYMENT.md)**: GitHub Pages configuration, server deployment, and Windows Task Scheduler setup.
- 🛠️ **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)**: Diagnostic steps for webview fallback, port conflicts, and permissions.
