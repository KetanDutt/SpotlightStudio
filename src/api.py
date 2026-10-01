"""
api.py – FastAPI application.

Endpoints
---------
GET  /                     → Serve the dashboard HTML
GET  /api/status           → Live engine stats
POST /api/control/start    → Start / resume the download engine
POST /api/control/pause    → Pause the engine (queue persists)
POST /api/control/stop     → Stop the engine (queue persists)
GET  /api/wallpapers       → Paginated, filtered, sorted wallpaper list
GET  /api/wallpapers/{id}  → Single wallpaper detail
GET  /api/export/json      → Download all metadata as JSON
GET  /api/export/csv       → Download all metadata as CSV
POST /api/wallpaper/{id}/set-wallpaper → Set image as Windows desktop wallpaper
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from src.config import settings
from src.database import (
    download_queue_size,
    export_catalog_json,
    get_all_wallpapers,
    get_db,
    get_stats,
    init_db,
    scrape_queue_size,
    seed_scrape_queue,
)
from src.engine import engine

log = logging.getLogger("api")

ROOT = Path(__file__).resolve().parents[1]


# ── Lifespan (replaces deprecated on_event) ─────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    seed_scrape_queue(settings.PEAPIX_TOTAL_PAGES, settings.WIN10_TOTAL_PAGES)
    log.info("✓ Database initialised – scrape queue has %d pages", scrape_queue_size())
    yield
    # Shutdown
    engine.stop()
    log.info("Engine stopped.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Windows Spotlight Downloader",
    description="Download, organise, and browse high-quality Windows Spotlight wallpapers.",
    version="2.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static mounts ─────────────────────────────────────────────────────────────

(ROOT / "static").mkdir(parents=True, exist_ok=True)
settings.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
(ROOT / "data").mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
app.mount("/images", StaticFiles(directory=str(settings.IMAGES_DIR)), name="images")
app.mount("/data", StaticFiles(directory=str(ROOT / "data")), name="data")


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index():
    root_index = ROOT / "index.html"
    if root_index.exists():
        return FileResponse(str(root_index))
    return FileResponse(str(ROOT / "templates" / "index.html"))


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    sw_file = ROOT / "sw.js"
    if sw_file.exists():
        return FileResponse(str(sw_file), media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Service worker not found")



# ── Control ───────────────────────────────────────────────────────────────────

@app.post("/api/control/start", tags=["Control"], summary="Start / resume download")
def start_download(
    source: str = Query("both", description="Download source provider: 'peapix', 'win10spotlight', or 'both'"),
) -> dict:
    """Start the download engine with the specified source (idempotent if already running)."""
    engine.start(source=source)
    return {
        "status": engine.status,
        "active_source": engine.active_source,
    }


@app.post("/api/control/pause", tags=["Control"], summary="Pause download")
def pause_download() -> dict:
    """Pause the engine; the queue is preserved."""
    engine.pause()
    return {
        "status": engine.status,
        "active_source": engine.active_source,
    }


@app.post("/api/control/stop", tags=["Control"], summary="Stop download")
def stop_download() -> dict:
    """Stop the engine; the queue is preserved and can be resumed with start."""
    engine.stop()
    return {
        "status": engine.status,
        "active_source": engine.active_source,
    }


# ── Status ────────────────────────────────────────────────────────────────────

@app.get("/api/status", tags=["Status"], summary="Engine stats")
def get_status() -> dict:
    """Return live download statistics and engine state."""
    stats = get_stats()
    downloaded = int(stats.get("downloaded_count", 0))

    if engine.active_source == "peapix":
        total_estimated = settings.PEAPIX_TOTAL_PAGES * 40
    elif engine.active_source == "win10spotlight":
        total_estimated = settings.WIN10_TOTAL_PAGES * 4
    else:
        total_estimated = settings.PEAPIX_TOTAL_PAGES * 40 + settings.WIN10_TOTAL_PAGES * 4

    target_src = None if engine.active_source == "both" else engine.active_source
    scrape_remaining = scrape_queue_size(source=target_src)
    dl_remaining = download_queue_size(source=target_src)

    progress_pct = 0.0
    if total_estimated > 0 and downloaded > 0:
        progress_pct = min(100.0, round(downloaded / total_estimated * 100, 1))

    return {
        "engine_status": engine.status,
        "active_source": engine.active_source,
        "scraped_count": int(stats.get("scraped_count", 0)),
        "downloaded_count": downloaded,
        "duplicates_skipped": int(stats.get("duplicates_skipped", 0)),
        "duplicates_replaced": int(stats.get("duplicates_replaced", 0)),
        "errors": int(stats.get("errors", 0)),
        "scrape_queue_remaining": scrape_remaining,
        "download_queue_remaining": dl_remaining,
        "progress_pct": progress_pct,
        # Concurrency configuration (informational)
        "config": {
            "concurrent_downloads": settings.CONCURRENT_DOWNLOADS,
            "concurrent_scrapers": settings.CONCURRENT_SCRAPERS,
            "max_connections": settings.MAX_CONNECTIONS,
            "max_connections_per_host": settings.MAX_CONNECTIONS_PER_HOST,
        },
    }


# ── Wallpapers ────────────────────────────────────────────────────────────────

@app.get("/api/wallpapers", tags=["Wallpapers"], summary="List wallpapers")
def list_wallpapers(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(48, ge=1, le=200, description="Items per page"),
    search: str = Query("", description="Search title or tags"),
    source: str = Query("", description="Filter by source (peapix | win10spotlight)"),
    sort: str = Query("downloaded_at", description="Sort field"),
    order: str = Query("DESC", description="ASC or DESC"),
) -> dict:
    wallpapers, total = get_all_wallpapers(
        page=page, per_page=per_page,
        search=search, source=source,
        sort=sort, order=order,
    )
    pages = max(1, (total + per_page - 1) // per_page)
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "wallpapers": wallpapers,
    }


@app.get("/api/wallpapers/{wallpaper_id}", tags=["Wallpapers"], summary="Get one wallpaper")
def get_wallpaper(wallpaper_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM wallpapers WHERE id = ?", (wallpaper_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Wallpaper not found")
    return dict(row)


# ── Export ────────────────────────────────────────────────────────────────────

@app.get("/api/export/json", tags=["Export"], summary="Export metadata as JSON")
def export_json() -> StreamingResponse:
    """Download all wallpaper metadata as a JSON file."""
    wallpapers, _ = get_all_wallpapers(page=1, per_page=999_999)
    content = json.dumps(wallpapers, indent=2, ensure_ascii=False)
    return StreamingResponse(
        io.StringIO(content),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=spotlight_wallpapers.json"},
    )


@app.get("/api/export/csv", tags=["Export"], summary="Export metadata as CSV")
def export_csv() -> StreamingResponse:
    """Download all wallpaper metadata as a CSV file."""
    wallpapers, _ = get_all_wallpapers(page=1, per_page=999_999)
    output = io.StringIO()
    if wallpapers:
        writer = csv.DictWriter(output, fieldnames=wallpapers[0].keys())
        writer.writeheader()
        writer.writerows(wallpapers)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=spotlight_wallpapers.csv"},
    )


# ── Windows-specific: Set wallpaper ──────────────────────────────────────────

@app.post(
    "/api/wallpapers/{wallpaper_id}/set-wallpaper",
    tags=["Wallpapers"],
    summary="Set as desktop wallpaper (Windows only)",
)
def set_desktop_wallpaper(wallpaper_id: int) -> dict:
    """Set the specified wallpaper as the Windows desktop background."""
    if sys.platform != "win32":
        raise HTTPException(status_code=400, detail="Only supported on Windows.")

    with get_db() as conn:
        row = conn.execute(
            "SELECT filename FROM wallpapers WHERE id = ?", (wallpaper_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Wallpaper not found")

    target_path = settings.IMAGES_DIR / row["filename"]
    if not target_path.exists() or target_path.is_dir():
        flat_path = settings.IMAGES_DIR / Path(row["filename"]).name
        if flat_path.exists() and not flat_path.is_dir():
            target_path = flat_path
        else:
            raise HTTPException(status_code=404, detail="Image file not found on disk.")
    filepath = str(target_path.resolve())

    try:
        import ctypes
        SPI_SETDESKWALLPAPER = 0x0014
        SPIF_UPDATEINIFILE = 0x01
        SPIF_SENDCHANGE = 0x02
        result = ctypes.windll.user32.SystemParametersInfoW(
            SPI_SETDESKWALLPAPER, 0, filepath,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        if not result:
            raise RuntimeError("SystemParametersInfoW returned 0")
        return {"success": True, "path": filepath}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to set wallpaper: {exc}")


# ── System & Utility Endpoints ────────────────────────────────────────────────

@app.get("/api/health", tags=["System"], summary="System health check")
def health_check() -> dict:
    """Return system operational status and queue counts."""
    stats = get_stats()
    return {
        "status": "healthy",
        "version": "2.1.0",
        "engine_status": stats.get("status", "stopped"),
        "downloaded_count": int(stats.get("downloaded_count", 0)),
        "scrape_queue_size": scrape_queue_size(),
        "download_queue_size": download_queue_size(),
    }


@app.post("/api/catalog/sync", tags=["System"], summary="Synchronize static catalog JSON")
def sync_catalog() -> dict:
    """Export all wallpapers to data/wallpapers.json for GitHub Pages & static web viewers."""
    count = export_catalog_json()
    return {
        "success": True,
        "wallpapers_synced": count,
        "path": "data/wallpapers.json",
    }
