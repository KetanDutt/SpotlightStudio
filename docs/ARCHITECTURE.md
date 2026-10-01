# 🏛️ Architecture & System Design

Spotlight Studio is built around a **high-throughput asynchronous concurrency engine**, coupled with an offloaded **CPU worker thread pool**, persistent **SQLite WAL state queues**, and a **dual-mode presentation layer** (Apple Liquid Glass Native Desktop App + Static GitHub Pages Showcase).

---

## 📐 System Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                 USER INTERFACE                                    |
|                                                                                   |
|  [ GitHub Pages (Static Web) ]                 [ PyWebView Desktop Window ]       |
|    • Client-side search & filters                • Full crawler engine controls   |
|    • Direct high-res downloads                   • Real-time speed & queue stats  |
|    • Reads data/wallpapers.json                  • 1-Click Windows Wallpaper set  |
+-------------------------------------+---------------------------------------------+
                                      | HTTP REST API
                                      v
+-----------------------------------------------------------------------------------+
|                         FastAPI APPLICATION (src/api.py)                          |
|                                                                                   |
|  • /api/status       • /api/control/{start,pause,stop}   • /api/health            |
|  • /api/wallpapers   • /api/wallpapers/{id}/set-wallpaper• /api/catalog/sync      |
|  • /api/export/json  • /api/export/csv                   • Static Mounts          |
+-------------------------------------+---------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                      DOWNLOAD ENGINE (src/engine.py)                              |
|                                                                                   |
|   Dedicated Thread + Async Event Loop (aiohttp.ClientSession: 128 connections)    |
|                                                                                   |
|   [ Scrape Pool: 4 Concurrency ]           [ Download Pool: 32 Concurrency ]      |
|   • Scrapes Peapix & Win10Spotlight        • Fetches 4K/UHD image bytes           |
|   • Parses titles, tags, dates             • Dynamic UHD -> 1920 fallback chain   |
|   • Enqueues candidate URLs                • Deduplicates & writes to disk        |
+-----------------------+------------------------------------+----------------------+
                        |                                    |
                        v                                    v
+-----------------------------------+   +-------------------------------------------+
|   SQLITE WAL DATABASE             |   |   CPU THREAD POOL (src/downloader.py)     |
|   (data/wallpapers.db)            |   |                                           |
|                                   |   |   • Image decoding (Pillow)               |
|   • wallpapers: metadata & pHash  |   |   • 16-bit dHash calculation              |
|   • scrape_queue: gallery pages   |   |   • 480x270 Lanczos thumbnail generation  |
|   • download_queue: image candidates| |   • Disk writes to images/<source>/       |
|   • stats: operational counters   |   +-------------------------------------------+
+-----------------------------------+
```

---

## ⚡ High-Throughput Concurrency Pipeline

### 1. Dual Independent Async Pools
The engine (`src/engine.py`) separates page scraping from image downloading into two independent pools sharing one `aiohttp.ClientSession`:
- **`scrape_pool` (Semaphore = 4)**: Crawls gallery pages in parallel, populating the queue with candidate URLs.
- **`dl_pool` (Semaphore = 32)**: Simultaneously downloads image bytes across multiple hosts without waiting for page scrapers.
- **Connection Pool**: Configured with a total limit of 128 TCP connections and 48 connections per host, with persistent keep-alive and a 10-minute DNS cache.

### 2. Event-Loop Protection via Worker Thread Pool
Image decoding, perceptual difference hashing (`dHash`), and Lanczos resizing are CPU-heavy operations taking 50–200ms per 4K image. If run on the event loop, they would block all concurrent HTTP requests.
- All Pillow and disk I/O operations are offloaded to a `ThreadPoolExecutor` via `loop.run_in_executor(_cpu_pool, ...)`.
- The asyncio event loop remains 100% responsive, dispatching network requests at maximum wire speed.

---

## 🔍 Perceptual Deduplication Engine

To eliminate duplicates across both provider sites (Peapix and Windows 10 Spotlight):
1. Each downloaded image is converted to grayscale and scaled to a 17×16 grid.
2. A **16-bit difference hash (`dHash`)** is computed by comparing adjacent pixel gradients.
3. If an existing image with the identical visual hash is found in `data/wallpapers.db`:
   - The engine evaluates a **Quality Score**:
     $$\text{Score} = (\text{Width} \times \text{Height} \times 1000) + \text{File Size (bytes)}$$
   - If the new candidate has a strictly higher quality score (e.g. 4K UHD vs 1080p FHD), the old files are deleted and replaced with the higher-resolution copy.
   - If the existing copy is equal or superior, the download is skipped without wasting disk space.

---

## 📂 Source-Partitioned Storage Structure

Wallpapers are stored in dedicated directories by provider:
```
images/
├── peapix/              # Full-resolution wallpapers from Peapix
├── win10spotlight/      # Full-resolution wallpapers from Windows10Spotlight
└── thumbs/              # Low-res 480x270 JPEG thumbnail cache
    ├── peapix/
    └── win10spotlight/
```

---

## 🌐 Dual-Mode Architecture

The project features a single unified interface ([`index.html`](file:///c:/Users/Ketan%20Dutt/Desktop/WindowsSpotlightWallpapers/index.html)) that automatically adapts based on its environment:

1. **GitHub Pages (Static Web)**:
   - When hosted on GitHub Pages or opened in a static browser without a backend, the application loads [`data/wallpapers.json`](file:///c:/Users/Ketan%20Dutt/Desktop/WindowsSpotlightWallpapers/data/wallpapers.json) directly.
   - Provides client-side searching, filtering, sorting, pagination, lightbox preview, and full-resolution image downloads.
   - Hides crawler engine controls and offers a "Get Desktop App" button.

2. **Desktop Mode (`main.py`)**:
   - Detects the local FastAPI backend.
   - Activates crawler engine controls (Start, Pause, Stop), rolling speed calculation (`⚡ /s`), queue backlogs, and Windows desktop wallpaper integration (`SystemParametersInfoW`).
   - Automatically synchronizes `data/wallpapers.json` whenever wallpapers are downloaded.
