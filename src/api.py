"""
api.py – FastAPI application: REST API, static files and the single-page UI.

The app is built by :func:`create_app` (tests create isolated instances); the module
level :data:`app` is what ``uvicorn`` serves.

Routes
------
UI           ``/``  ``/sw.js``  ``/manifest.webmanifest``  ``/static/*``  ``/images/*``
             ``/data/wallpapers.json``  (only the catalog – never the DB or the log)
Engine       ``/api/health``  ``/api/status``  ``/api/control/{start,pause,stop}``
Library      ``/api/wallpapers``  ``/api/wallpapers/random``  ``/api/wallpapers/{id}``
             ``/api/tags``  ``/api/catalog``  ``/api/export/{json,csv}``  ``/api/catalog/sync``
Desktop      ``/api/wallpapers/{id}/set-wallpaper``  ``/api/wallpapers/{id}/image``
Maintenance  ``/api/library/check``  ``/api/maintenance/{dedupe,thumbnails}``
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import threading
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from pydantic import BaseModel
from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from src import maintenance, storage
from src.config import ROOT, Settings, settings
from src.database import (
    build_catalog,
    close_connection,
    count_wallpapers,
    download_queue_size,
    export_catalog_json,
    get_all_wallpapers,
    get_db,
    get_random_wallpaper,
    get_source_stats,
    get_stats,
    get_tag_counts,
    get_wallpaper,
    iter_wallpapers,
    library_signature,
    scrape_queue_size,
)
from src.downloader import shutdown_cpu_pool
from src.engine import DownloadEngine, EngineBusy, engine
from src.locking import LibraryLock
from src.security import (
    HostCheckMiddleware,
    OriginCheckMiddleware,
    ReadOnlyMiddleware,
    SecurityHeadersMiddleware,
)
from src.utils import csv_safe, is_lfs_pointer
from src.wallpaper import UnsupportedPlatform, WallpaperError, set_desktop_wallpaper

log = logging.getLogger("api")

SortField = Literal["downloaded_at", "date_spotted", "width", "height", "file_size", "title"]
SourceFilter = Literal["both", "peapix", "win10spotlight"]
QualityFilter = Literal["", "4k", "2k", "fhd", "hd", "sd"]

CSV_COLUMNS = (
    "id", "phash", "filename", "title", "source", "source_url", "page_url",
    "width", "height", "file_size", "tags", "date_spotted", "downloaded_at", "quality",
)


# ══════════════════════════════════════════════════════════════════════════
# Response models (they drive the OpenAPI documentation)
# ══════════════════════════════════════════════════════════════════════════


class WallpaperModel(BaseModel):
    id: int
    phash: str
    filename: str
    title: str
    source: str
    source_url: str
    page_url: str
    width: int
    height: int
    file_size: int
    tags: str
    date_spotted: str
    downloaded_at: str
    quality: str


class WallpaperPage(BaseModel):
    total: int
    page: int
    per_page: int
    pages: int
    wallpapers: list[WallpaperModel]


class HealthResponse(BaseModel):
    status: str
    version: str
    engine_status: str
    library_count: int
    downloaded_count: int
    scrape_queue_size: int
    download_queue_size: int
    lfs_pointers_detected: bool
    time: str


class ControlResponse(BaseModel):
    action: str
    result: str
    status: str
    active_source: str
    mode: str


class StatusResponse(BaseModel):
    engine_status: str
    active_source: str
    mode: str
    phase: str
    progress_pct: int
    rate_per_sec: float
    breaker_active: bool
    scraped_count: int
    downloaded_count: int
    duplicates_skipped: int
    duplicates_replaced: int
    errors: int
    library_count: int
    library_signature: str
    scrape_queue_remaining: int
    download_queue_remaining: int
    run: dict
    last_run: dict | None
    source_stats: dict
    config: dict


class SetWallpaperResponse(BaseModel):
    success: bool
    path: str


class CatalogSyncResponse(BaseModel):
    success: bool
    wallpapers_synced: int
    path: str


class TagCount(BaseModel):
    tag: str
    count: int


# ══════════════════════════════════════════════════════════════════════════
# Static file helpers
# ══════════════════════════════════════════════════════════════════════════


class ImmutableStaticFiles(StaticFiles):
    """Wallpaper files are content-addressed and never change → cache forever."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


class RevalidatingStaticFiles(StaticFiles):
    """UI assets: always revalidate (cheap 304) so an update is never masked by a stale cache."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "no-cache"
        return response


class SelectiveGZipMiddleware:
    """GZip everything except ``/images`` (already-compressed JPEGs)."""

    def __init__(self, app: ASGIApp, minimum_size: int = 1024) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not scope["path"].startswith("/images/"):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


# ══════════════════════════════════════════════════════════════════════════
# Application factory
# ══════════════════════════════════════════════════════════════════════════

_DESCRIPTION = """
REST API of **Spotlight Studio** – a Windows Spotlight wallpaper archive.

* Browse / search the library: `GET /api/wallpapers`, `GET /api/tags`, `GET /api/catalog`
* Control the crawler: `POST /api/control/{start,pause,stop}`, `GET /api/status`
* Export the data: `GET /api/export/json`, `GET /api/export/csv`

The API is meant for **local use**: it has no authentication and refuses cross-origin
state-changing requests and unknown Host headers (see `docs/SECURITY.md`).
"""


def create_app(cfg: Settings = settings, eng: DownloadEngine = engine) -> FastAPI:
    """Build the FastAPI application bound to ``cfg`` and ``eng``."""

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Acquire before migrations/claim recovery, even on a READ_ONLY HTTP server:
        # startup still writes state and this process owns the crawler's queues.
        # Storage/engine helpers intentionally use process-wide settings. Refuse a
        # factory config that would lock/serve one library but mutate another.
        if any(getattr(cfg, name).resolve() != getattr(settings, name).resolve()
               for name in ("DB_PATH", "CATALOG_PATH", "IMAGES_DIR")):
            raise RuntimeError("Library paths must match src.config.settings; use a separate process for each library.")
        with LibraryLock(settings.DB_PATH):
            try:
                maintenance.startup_tasks()
                if not cfg.is_loopback_host and not cfg.READ_ONLY:
                    log.warning(
                        "The server listens on %s without authentication. Anyone who can reach this "
                        "port can control the crawler. Use READ_ONLY for a public gallery, or restrict access "
                        "with an authenticated reverse proxy/firewall. ALLOWED_HOSTS is not authentication.",
                        cfg.HOST,
                    )
                yield
            finally:
                if not await asyncio.to_thread(eng.shutdown, timeout=20):
                    log.warning("Waiting for in-flight library work before releasing ownership…")
                    await asyncio.to_thread(eng.wait)
                await asyncio.to_thread(shutdown_cpu_pool, wait=True)
                close_connection()

    app = FastAPI(
        title="Spotlight Studio API",
        description=_DESCRIPTION,
        version=cfg.VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # Middleware: the LAST one added is the OUTERMOST.
    app.add_middleware(SelectiveGZipMiddleware)
    if cfg.CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cfg.CORS_ORIGINS,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    app.add_middleware(ReadOnlyMiddleware, enabled=lambda: cfg.READ_ONLY)
    app.add_middleware(OriginCheckMiddleware, allowed_origins=cfg.CORS_ORIGINS)
    app.add_middleware(HostCheckMiddleware, get_allowed=cfg.allowed_hosts)
    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(EngineBusy)
    async def _engine_busy(_request: Request, exc: EngineBusy) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    # ── Health & status ───────────────────────────────────────────────────

    @app.get("/api/health", response_model=HealthResponse, tags=["System"], summary="Health check")
    def health_check() -> dict:
        """Liveness probe with the most important numbers."""
        library = count_wallpapers()
        pointers, inspected = storage.count_lfs_pointers(sample=10)
        return {
            "status": "healthy",
            "version": cfg.VERSION,
            "engine_status": eng.status,
            "library_count": library,
            "downloaded_count": library,
            "scrape_queue_size": scrape_queue_size(),
            "download_queue_size": download_queue_size(),
            "lfs_pointers_detected": bool(inspected and pointers),
            "time": datetime.now(timezone.utc).isoformat(),
        }

    @app.get("/api/status", response_model=StatusResponse, tags=["Engine"], summary="Engine status")
    def get_status() -> dict:
        """Live engine state, cumulative counters and queue sizes (polled by the UI)."""
        stats = get_stats()
        snap = eng.snapshot()
        target = None if eng.active_source == "both" else eng.active_source
        last_run = None
        if stats.get("last_run_at"):
            last_run = {
                "at": stats.get("last_run_at"),
                "mode": stats.get("last_run_mode", ""),
                "source": stats.get("last_run_source", ""),
                "result": stats.get("last_run_result", ""),
                "downloaded": int(stats.get("last_run_downloaded", 0) or 0),
                "duplicates": int(stats.get("last_run_duplicates", 0) or 0),
                "errors": int(stats.get("last_run_errors", 0) or 0),
                "repaired": int(stats.get("last_run_repaired", 0) or 0),
                "seconds": int(stats.get("last_run_seconds", 0) or 0),
            }
        return {
            "engine_status": snap["status"],
            "active_source": snap["active_source"],
            "mode": snap["mode"],
            "phase": snap["phase"],
            "progress_pct": snap["progress_pct"],
            "rate_per_sec": snap["rate_per_sec"],
            "breaker_active": snap["breaker_active"],
            "scraped_count": int(stats.get("scraped_count", 0)),
            "downloaded_count": int(stats.get("downloaded_count", 0)),
            "duplicates_skipped": int(stats.get("duplicates_skipped", 0)),
            "duplicates_replaced": int(stats.get("duplicates_replaced", 0)),
            "errors": int(stats.get("errors", 0)),
            "library_count": count_wallpapers(),
            "library_signature": library_signature(),
            "scrape_queue_remaining": scrape_queue_size(target),
            "download_queue_remaining": download_queue_size(target),
            "run": snap["run"],
            "last_run": last_run,
            "source_stats": get_source_stats(),
            "config": {
                "read_only": cfg.READ_ONLY,
                "concurrent_downloads": cfg.CONCURRENT_DOWNLOADS,
                "concurrent_scrapers": cfg.CONCURRENT_SCRAPERS,
                "max_connections": cfg.MAX_CONNECTIONS,
                "max_connections_per_host": cfg.MAX_CONNECTIONS_PER_HOST,
                "quick_update_pages": cfg.QUICK_UPDATE_PAGES,
            },
        }

    # ── Engine control ────────────────────────────────────────────────────

    def _control(action: str, result: str) -> ControlResponse:
        return ControlResponse(
            action=action,
            result=result,
            status=eng.status,
            active_source=eng.active_source,
            mode=eng.mode,
        )

    @app.post("/api/control/start", response_model=ControlResponse, tags=["Engine"],
              summary="Start / resume the crawler")
    def control_start(
        source: SourceFilter = Query("both", description="Which site(s) to crawl."),
        mode: Literal["quick", "full", "repair"] = Query(
            "full",
            description="`quick` = newest pages only, `full` = every page, "
            "`repair` = back-fill titles/tags of stored wallpapers.",
        ),
    ) -> ControlResponse:
        """Start a run, resume a paused one, or switch the source of a running one."""
        return _control("start", eng.start(source, mode))

    @app.post("/api/control/pause", response_model=ControlResponse, tags=["Engine"],
              summary="Pause the crawler")
    def control_pause() -> ControlResponse:
        """Stop dispatching new work.  Queues stay persisted in SQLite."""
        eng.pause()
        return _control("pause", "paused")

    @app.post("/api/control/stop", response_model=ControlResponse, tags=["Engine"],
              summary="Stop the crawler")
    def control_stop() -> ControlResponse:
        """Stop the run (`stopping` → `stopped`).  In-flight work is returned to the queue."""
        eng.stop()
        return _control("stop", "stopping")

    # ── Library: listing & lookup ─────────────────────────────────────────

    @app.get("/api/wallpapers", response_model=WallpaperPage, tags=["Wallpapers"],
             summary="List wallpapers")
    def list_wallpapers(
        page: int = Query(1, ge=1),
        per_page: int = Query(48, ge=1, le=200),
        search: str = Query("", max_length=200,
                            description="Space separated terms; all must match title, tag or date."),
        source: str = Query("", max_length=40, description="`peapix` or `win10spotlight`."),
        sort: SortField = Query("downloaded_at"),
        order: Literal["ASC", "DESC", "asc", "desc"] = Query("DESC"),
        tag: str = Query("", max_length=80, description="Exact tag."),
        quality: QualityFilter = Query("", description="Resolution class."),
    ) -> dict:
        """Paginated, filtered and *deterministically ordered* wallpapers."""
        rows, total = get_all_wallpapers(
            page=page, per_page=per_page, search=search, source=source,
            sort=sort, order=order, tag=tag, quality=quality,
        )
        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": max(1, -(-total // per_page)),
            "wallpapers": rows,
        }

    # NOTE: must be declared before ``/api/wallpapers/{wallpaper_id}``.
    @app.get("/api/wallpapers/random", response_model=WallpaperModel, tags=["Wallpapers"],
             summary="Random wallpaper")
    def random_wallpaper(
        search: str = Query("", max_length=200),
        source: str = Query("", max_length=40),
        tag: str = Query("", max_length=80),
        quality: QualityFilter = Query(""),
    ) -> dict:
        """A random wallpaper, optionally restricted by the same filters as the list."""
        row = get_random_wallpaper(search=search, source=source, tag=tag, quality=quality)
        if not row:
            raise HTTPException(status_code=404, detail="No wallpaper matches the filters.")
        return row

    @app.get("/api/wallpapers/{wallpaper_id}", response_model=WallpaperModel,
             tags=["Wallpapers"], summary="Get one wallpaper")
    def read_wallpaper(wallpaper_id: int = Path(..., ge=1)) -> dict:
        row = get_wallpaper(wallpaper_id)
        if not row:
            raise HTTPException(status_code=404, detail="Wallpaper not found.")
        return row

    @app.get("/api/wallpapers/{wallpaper_id}/image", tags=["Wallpapers"],
             summary="Redirect to the full-resolution image")
    def wallpaper_image(wallpaper_id: int = Path(..., ge=1)) -> RedirectResponse:
        row = get_wallpaper(wallpaper_id)
        if not row:
            raise HTTPException(status_code=404, detail="Wallpaper not found.")
        return RedirectResponse(url=f"/images/{row['filename']}", status_code=302)

    @app.get("/api/tags", response_model=list[TagCount], tags=["Wallpapers"],
             summary="Most used tags")
    def list_tags(
        limit: int = Query(50, ge=1, le=500),
        source: str = Query("", max_length=40),
    ) -> list[dict]:
        return [{"tag": t, "count": c} for t, c in get_tag_counts(source).most_common(limit)]

    # ── Desktop integration ───────────────────────────────────────────────

    @app.post("/api/wallpapers/{wallpaper_id}/set-wallpaper", response_model=SetWallpaperResponse,
              tags=["Desktop"], summary="Set as desktop wallpaper")
    def set_wallpaper(wallpaper_id: int = Path(..., ge=1)) -> dict:
        """Apply the image as the desktop background (Windows; best effort on macOS/Linux)."""
        row = get_wallpaper(wallpaper_id)
        if not row:
            raise HTTPException(status_code=404, detail="Wallpaper not found.")
        try:
            path = storage.image_path(row["filename"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid wallpaper path.") from exc
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Image file is missing on disk.")
        if is_lfs_pointer(path):
            raise HTTPException(
                status_code=409,
                detail="This image is a Git LFS pointer. Run `git lfs install && git lfs pull`.",
            )
        try:
            set_desktop_wallpaper(path)
        except UnsupportedPlatform as exc:
            raise HTTPException(status_code=501, detail=str(exc)) from exc
        except WallpaperError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"success": True, "path": str(path)}

    # ── Catalog & exports ─────────────────────────────────────────────────

    catalog_cache: dict[str, tuple[bytes, str, str]] = {}
    catalog_lock = threading.Lock()

    @app.get("/api/catalog", tags=["Catalog"], summary="Compact live catalog (ETag cached)")
    def live_catalog(request: Request) -> Response:
        """
        The whole library as a compact JSON array (no perceptual hashes) – the same shape
        as the static `data/wallpapers.json`.  Honors `If-None-Match`.
        """
        # One builder at a time, and revision + payload from one SQLite snapshot.
        # Hash the representation: replacing a DB with the same revision must not
        # accidentally reuse an old browser ETag after a server restart.
        with catalog_lock, get_db():
            signature = library_signature()
            cached = catalog_cache.get("entry")
            if cached is None or cached[1] != signature:
                payload, _count = build_catalog()
                etag = f'W/"{hashlib.sha256(payload).hexdigest()}"'
                cached = (payload, signature, etag)
                catalog_cache["entry"] = cached
        etag = cached[2]
        validators = [v.strip().removeprefix("W/") for v in
                      request.headers.get("if-none-match", "").split(",")]
        if "*" in validators or etag.removeprefix("W/") in validators:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})
        return Response(
            cached[0], media_type="application/json",
            headers={"ETag": etag, "Cache-Control": "no-cache"},
        )

    @app.get("/data/wallpapers.json", include_in_schema=False)
    def static_catalog() -> Response:
        """The static catalog file (the *only* file of ``data/`` that is public)."""
        if not cfg.CATALOG_PATH.is_file():
            export_catalog_json()
        return FileResponse(cfg.CATALOG_PATH, media_type="application/json",
                            headers={"Cache-Control": "no-cache"})

    @app.post("/api/catalog/sync", response_model=CatalogSyncResponse, tags=["Catalog"],
              summary="Regenerate data/wallpapers.json")
    def catalog_sync() -> dict:
        count = export_catalog_json()
        try:
            shown = str(cfg.CATALOG_PATH.relative_to(ROOT))
        except ValueError:
            shown = str(cfg.CATALOG_PATH)
        return {"success": True, "wallpapers_synced": count, "path": shown.replace("\\", "/")}

    @app.get("/api/export/json", tags=["Catalog"], summary="Download the full database as JSON")
    def export_json() -> StreamingResponse:
        """Every column of every wallpaper (streamed – constant memory)."""

        def generate() -> Iterator[str]:
            yield "["
            first = True
            for row in iter_wallpapers():
                yield ("" if first else ",") + json.dumps(row, ensure_ascii=False)
                first = False
            yield "]"

        return StreamingResponse(
            generate(), media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="spotlight_wallpapers.json"'},
        )

    @app.get("/api/export/csv", tags=["Catalog"], summary="Download the full database as CSV")
    def export_csv() -> StreamingResponse:
        """CSV with a UTF-8 BOM (Excel friendly); spreadsheet formulas are neutralised."""

        def generate() -> Iterator[str]:
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            buffer.write("\ufeff")
            writer.writerow(CSV_COLUMNS)
            yield buffer.getvalue()
            for row in iter_wallpapers():
                buffer.seek(0)
                buffer.truncate(0)
                writer.writerow([csv_safe(row.get(col, "")) for col in CSV_COLUMNS])
                yield buffer.getvalue()

        return StreamingResponse(
            generate(), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="spotlight_wallpapers.csv"'},
        )

    # ── Maintenance ───────────────────────────────────────────────────────

    @app.get("/api/library/check", tags=["Maintenance"], summary="Library health report")
    def library_check() -> dict:
        """Read-only consistency report between the database and the files on disk."""
        return maintenance.verify_library()

    @app.post("/api/maintenance/dedupe", tags=["Maintenance"], summary="Remove near-duplicates")
    def maintenance_dedupe() -> dict:
        with eng.maintenance_guard():
            removed = maintenance.deduplicate_downloaded_wallpapers()
            if removed:
                export_catalog_json()
        return {"removed": removed}

    @app.post("/api/maintenance/thumbnails", tags=["Maintenance"],
              summary="Rebuild missing thumbnails")
    def maintenance_thumbnails() -> dict:
        with eng.maintenance_guard():
            return {"created": maintenance.create_missing_thumbnails()}

    # ── UI & static assets ────────────────────────────────────────────────

    @app.get("/api/docs", include_in_schema=False)
    def api_docs() -> Response:
        return FileResponse(ROOT / "static" / "api-docs.html", media_type="text/html",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/api/redoc", include_in_schema=False)
    def legacy_api_docs() -> Response:
        return RedirectResponse("/api/docs", status_code=307)

    @app.get("/", include_in_schema=False)
    def index_page() -> Response:
        page = ROOT / "index.html"
        if not page.is_file():
            return JSONResponse({"detail": "index.html is missing."}, status_code=404)
        return FileResponse(page, media_type="text/html", headers={"Cache-Control": "no-cache"})

    @app.get("/sw.js", include_in_schema=False)
    def service_worker() -> Response:
        return FileResponse(
            ROOT / "sw.js", media_type="application/javascript",
            headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
        )

    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest() -> Response:
        return FileResponse(
            ROOT / "manifest.webmanifest", media_type="application/manifest+json",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon() -> Response:
        icon = ROOT / "static" / "icons" / "favicon.svg"
        if icon.is_file():
            return FileResponse(icon, media_type="image/svg+xml")
        return Response(status_code=204)

    app.mount("/static", RevalidatingStaticFiles(directory=ROOT / "static", check_dir=False),
              name="static")
    app.mount("/images", ImmutableStaticFiles(directory=cfg.IMAGES_DIR, check_dir=False),
              name="images")
    return app


app = create_app()
