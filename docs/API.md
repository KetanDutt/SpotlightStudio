# 🔌 REST API Specification

The Spotlight Studio backend runs on **FastAPI** and serves both the client dashboard and a fully documented REST API. Interactive OpenAPI documentation is accessible at `http://127.0.0.1:8765/api/docs`.

---

## 🧭 Base URL
```
http://127.0.0.1:8765
```

---

## 🛠️ Endpoints Reference

### 1. System Health & Status

#### `GET /api/health`
Returns system operational health, queue counts, and engine version.

**Response `200 OK`**:
```json
{
  "status": "healthy",
  "version": "2.1.0",
  "engine_status": "stopped",
  "downloaded_count": 1378,
  "scrape_queue_size": 1192,
  "download_queue_size": 95
}
```

#### `GET /api/status`
Returns real-time engine metrics, download counters, queue sizes, and concurrency configuration.

**Response `200 OK`**:
```json
{
  "engine_status": "running",
  "scraped_count": 1510,
  "downloaded_count": 1378,
  "duplicates_skipped": 12,
  "duplicates_replaced": 4,
  "errors": 0,
  "scrape_queue_remaining": 1192,
  "download_queue_remaining": 95,
  "progress_pct": 52,
  "config": {
    "concurrent_downloads": 32,
    "concurrent_scrapers": 4,
    "max_connections": 128,
    "max_connections_per_host": 48
  }
}
```

---

### 2. Crawler Engine Control

#### `POST /api/control/start`
Starts or resumes the asynchronous download and scraper engine.

**Response `200 OK`**:
```json
{
  "action": "start",
  "status": "running"
}
```

#### `POST /api/control/pause`
Pauses background download and scraping tasks. Queues and in-progress items remain safely persisted in SQLite.

**Response `200 OK`**:
```json
{
  "action": "pause",
  "status": "paused"
}
```

#### `POST /api/control/stop`
Stops the engine and triggers an automatic synchronization of `data/wallpapers.json`.

**Response `200 OK`**:
```json
{
  "action": "stop",
  "status": "stopped"
}
```

---

### 3. Wallpapers & Catalog

#### `GET /api/wallpapers`
Returns a paginated, searchable, and sortable list of wallpapers.

**Query Parameters**:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `integer` | `1` | Page number (1-indexed) |
| `per_page` | `integer` | `48` | Number of items per page (1–500) |
| `search` | `string` | `""` | Search query matching titles, tags, or dates |
| `source` | `string` | `""` | Filter by source (`peapix` or `win10spotlight`) |
| `sort` | `string` | `"downloaded_at"` | Sort field (`downloaded_at`, `width`, `height`, `file_size`, `title`, `date_spotted`) |
| `order` | `string` | `"DESC"` | Sort order (`DESC` or `ASC`) |

**Response `200 OK`**:
```json
{
  "total": 1378,
  "page": 1,
  "per_page": 48,
  "pages": 29,
  "wallpapers": [
    {
      "id": 900,
      "phash": "a7b3c2d4e5f61234",
      "filename": "peapix/695f81f07c8721303d4bcb3fd8b9cb90.jpg",
      "title": "Symphony of the Stones, Garni Gorge, Armenia",
      "source": "peapix",
      "source_url": "https://img.peapix.com/695f81f07c8721303d4bcb3fd8b9cb90_UHD.jpg",
      "page_url": "https://peapix.com/spotlight/12696",
      "width": 3840,
      "height": 2160,
      "file_size": 2189742,
      "quality": "4K / UHD",
      "tags": "sky,rock,nature",
      "date_spotted": "September 19, 2026",
      "downloaded_at": "2026-10-01T10:20:00Z"
    }
  ]
}
```

#### `GET /api/wallpapers/{wallpaper_id}`
Retrieves metadata for a specific wallpaper by ID.

**Response `200 OK`**: Returns a single wallpaper object.

---

### 4. Windows Desktop Integration

#### `POST /api/wallpapers/{wallpaper_id}/set-wallpaper`
Applies the chosen wallpaper directly as the Windows desktop background using the native Windows API (`SystemParametersInfoW`).

**Response `200 OK`**:
```json
{
  "success": true,
  "path": "C:\\Users\\...\\images\\peapix\\695f81f07c8721303d4bcb3fd8b9cb90.jpg"
}
```

---

### 5. Export & Catalog Synchronization

#### `GET /api/export/json`
Streams the entire database catalog as an attachment download (`spotlight_wallpapers.json`).

#### `GET /api/export/csv`
Streams the entire database catalog as a CSV attachment download (`spotlight_wallpapers.csv`).

#### `POST /api/catalog/sync`
Manually triggers regeneration of `data/wallpapers.json` for GitHub Pages static hosting.

**Response `200 OK`**:
```json
{
  "success": true,
  "wallpapers_synced": 1378,
  "path": "data/wallpapers.json"
}
```
