"""
engine.py – high-throughput download engine.

Architecture
────────────

  ┌─────────────────────────────────────────────────────────────────────┐
  │  EngineThread  (dedicated daemon thread, own asyncio event loop)    │
  │                                                                     │
  │  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
  │  │  Scrape Pool         │    │  Download Pool                   │   │
  │  │  CONCURRENT_SCRAPERS │    │  CONCURRENT_DOWNLOADS tasks      │   │
  │  │  concurrent tasks    │    │  (each task = 1 HTTP request     │   │
  │  │  (parse HTML,        │    │   + CPU work in thread pool)     │   │
  │  │   enqueue URLs)      │    │                                  │   │
  │  └──────────┬───────────┘    └──────────────┬───────────────────┘   │
  │             │                               │                       │
  │             └──► SQLite download_queue ◄────┘                       │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  ThreadPoolExecutor  (CPU_THREADS workers, shared process-wide)     │
  │  • Pillow image decode                                              │
  │  • imagehash.dhash computation                                      │
  │  • Thumbnail resize + JPEG encode                                   │
  │  • Disk write (full image + thumbnail)                              │
  └─────────────────────────────────────────────────────────────────────┘

  FastAPI routes call engine.start() / pause() / stop() from uvicorn's
  thread — all communication goes through threading.Lock +
  loop.call_soon_threadsafe().

Concurrency controls (all tunable via .env)
───────────────────────────────────────────
  CONCURRENT_DOWNLOADS      default 32   — asyncio download tasks
  CONCURRENT_SCRAPERS       default 4    — asyncio scrape tasks
  MAX_CONNECTIONS           default 128  — total TCP connections in pool
  MAX_CONNECTIONS_PER_HOST  default 48   — per-hostname TCP connections
  CPU_THREADS               default 0    — thread pool workers (0 = auto)
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Literal

import aiohttp

from src.config import settings
from src.database import (
    download_queue_size,
    enqueue_download,
    export_catalog_json,
    get_stats,
    increment_stat,
    init_db,
    pop_download_item,
    pop_scrape_page,
    scrape_queue_size,
    seed_scrape_queue,
    set_stat,
)
from src.downloader import process_download
from src.scrapers import scrape_peapix_gallery_page, scrape_win10spotlight_page

log = logging.getLogger("engine")

Status = Literal["stopped", "running", "paused"]

# Keep the download queue topped-up whenever it falls below this threshold.
_QUEUE_LOW_WATER = settings.CONCURRENT_DOWNLOADS * 3


class DownloadEngine:
    """
    Thread-safe engine with Start / Pause / Stop controls callable from any thread.
    """

    def __init__(self) -> None:
        self._status: Status = "stopped"
        self._active_source: str = "both"
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._pause_event: asyncio.Event | None = None
        self._stop_event:  asyncio.Event | None = None

    # ── Public control API ────────────────────────────────────────────────────

    @property
    def status(self) -> Status:
        return self._status

    @property
    def active_source(self) -> str:
        return self._active_source

    def start(self, source: str = "both") -> None:
        """Start the engine, or resume from pause, with optional source filter ('peapix', 'win10spotlight', or 'both')."""
        with self._lock:
            src = source.lower().strip() if source else "both"
            if src not in ("peapix", "win10spotlight", "both"):
                src = "both"
            self._active_source = src
            set_stat("active_source", self._active_source)

            # Ensure the scrape queue contains pages for the selected source(s)
            seed_scrape_queue(
                settings.PEAPIX_TOTAL_PAGES,
                settings.WIN10_TOTAL_PAGES,
                target_source=self._active_source,
            )

            if self._status == "running":
                log.info("Engine source updated to: %s", self._active_source)
                return

            if self._status == "paused":
                self._status = "running"
                set_stat("status", "running")
                if self._pause_event and self._loop:
                    self._loop.call_soon_threadsafe(self._pause_event.set)
                log.info("Engine resumed with source filter: %s", self._active_source)
                return

            # stopped → fresh thread
            self._status = "running"
            set_stat("status", "running")
            self._thread = threading.Thread(
                target=self._run_loop, daemon=True, name="EngineThread"
            )
            self._thread.start()
            log.info(
                "Engine started (source=%s, downloads=%d, scrapers=%d, connections=%d/%d).",
                self._active_source,
                settings.CONCURRENT_DOWNLOADS,
                settings.CONCURRENT_SCRAPERS,
                settings.MAX_CONNECTIONS,
                settings.MAX_CONNECTIONS_PER_HOST,
            )

    def pause(self) -> None:
        """Pause; the queues remain in SQLite for later resumption."""
        with self._lock:
            if self._status != "running":
                return
            self._status = "paused"
            set_stat("status", "paused")
            if self._pause_event and self._loop:
                self._loop.call_soon_threadsafe(self._pause_event.clear)
            try:
                export_catalog_json()
            except Exception:
                pass
            log.info("Engine paused.")

    def stop(self) -> None:
        """Stop; the queues remain in SQLite."""
        with self._lock:
            if self._status == "stopped":
                return
            prev = self._status
            self._status = "stopped"
            set_stat("status", "stopped")
            if self._stop_event and self._loop:
                self._loop.call_soon_threadsafe(self._stop_event.set)
            if self._pause_event and self._loop:
                self._loop.call_soon_threadsafe(self._pause_event.set)
            try:
                export_catalog_json()
            except Exception:
                pass
            log.info("Engine stopped (was %s).", prev)

    # ── Internal async loop ───────────────────────────────────────────────────

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            loop.run_until_complete(self._main())
        except Exception:
            log.exception("Engine loop crashed.")
        finally:
            loop.close()
            self._loop = None
            try:
                export_catalog_json()
            except Exception:
                pass
            with self._lock:
                if self._status != "stopped":
                    self._status = "stopped"
                    set_stat("status", "stopped")

    async def _main(self) -> None:
        """
        Main async loop.

        Two independent pools run concurrently:
          • scrape_pool  – up to CONCURRENT_SCRAPERS pages parsed at once
          • dl_pool      – up to CONCURRENT_DOWNLOADS images fetched at once

        Both share the same aiohttp.ClientSession (and its connection pool).
        """
        self._pause_event = asyncio.Event()
        self._stop_event  = asyncio.Event()
        self._pause_event.set()   # initially running

        init_db()
        seed_scrape_queue(
            settings.PEAPIX_TOTAL_PAGES,
            settings.WIN10_TOTAL_PAGES,
            target_source=self._active_source,
        )

        # ── Shared HTTP session ────────────────────────────────────────────
        connector = aiohttp.TCPConnector(
            limit=settings.MAX_CONNECTIONS,
            limit_per_host=settings.MAX_CONNECTIONS_PER_HOST,
            ssl=False,
            ttl_dns_cache=600,          # cache DNS for 10 min
            enable_cleanup_closed=True,
        )
        timeout = aiohttp.ClientTimeout(
            total=settings.TIMEOUT,
            connect=10,
            sock_read=settings.TIMEOUT,
        )

        async with aiohttp.ClientSession(
            headers=settings.HEADERS,
            connector=connector,
            timeout=timeout,
        ) as session:

            # Semaphores that cap the two pools
            dl_sem     = asyncio.Semaphore(settings.CONCURRENT_DOWNLOADS)
            scrape_sem = asyncio.Semaphore(settings.CONCURRENT_SCRAPERS)

            dl_tasks:     set[asyncio.Task] = set()
            scrape_tasks: set[asyncio.Task] = set()
            last_synced = int(get_stats().get("downloaded_count", 0))

            while not self._stop_event.is_set():

                # ── Respect pause ────────────────────────────────────────
                await self._pause_event.wait()
                if self._stop_event.is_set():
                    break

                target_src = None if self._active_source == "both" else self._active_source

                # ── Scrape: keep the download queue topped up ────────────
                while (
                    len(scrape_tasks) < settings.CONCURRENT_SCRAPERS
                    and download_queue_size(source=target_src) < _QUEUE_LOW_WATER
                ):
                    page = pop_scrape_page(source=target_src)
                    if not page:
                        break
                    t = asyncio.create_task(
                        self._scrape_one(session, scrape_sem, page),
                        name=f"scrape-{page['id']}",
                    )
                    scrape_tasks.add(t)
                    t.add_done_callback(scrape_tasks.discard)

                # ── Download: saturate the concurrency limit ─────────────
                while len(dl_tasks) < settings.CONCURRENT_DOWNLOADS:
                    item = pop_download_item(source=target_src)
                    if not item:
                        break
                    t = asyncio.create_task(
                        self._download_one(session, dl_sem, item),
                        name=f"dl-{item['id']}",
                    )
                    dl_tasks.add(t)
                    t.add_done_callback(dl_tasks.discard)

                # ── Periodic static catalog export (every 25 downloads) ──
                cur_downloaded = int(get_stats().get("downloaded_count", 0))
                if cur_downloaded - last_synced >= 25:
                    last_synced = cur_downloaded
                    try:
                        export_catalog_json()
                    except Exception:
                        pass

                # ── Done check ────────────────────────────────────────────
                if (
                    not dl_tasks
                    and not scrape_tasks
                    and download_queue_size(source=target_src) == 0
                    and scrape_queue_size(source=target_src) == 0
                ):
                    log.info("🎉 All downloads complete for source '%s'!", self._active_source)
                    with self._lock:
                        self._status = "stopped"
                        set_stat("status", "stopped")
                    break

                await asyncio.sleep(settings.REQUEST_DELAY)

            # ── Graceful shutdown ─────────────────────────────────────────
            all_tasks = dl_tasks | scrape_tasks
            for task in list(all_tasks):
                task.cancel()
            if all_tasks:
                await asyncio.gather(*all_tasks, return_exceptions=True)

    # ── Scrape worker ─────────────────────────────────────────────────────────

    async def _scrape_one(
        self,
        session: aiohttp.ClientSession,
        sem: asyncio.Semaphore,
        page: dict,
    ) -> None:
        async with sem:
            url    = page["url"]
            source = page["source"]
            log.info("📄 Scraping [%s] %s", source, url)
            try:
                if source == "peapix":
                    items = await scrape_peapix_gallery_page(session, url)
                else:
                    items = await scrape_win10spotlight_page(session, url)
            except Exception:
                log.exception("Scrape error: %s", url)
                return

            new_count = sum(
                1 for item in items if enqueue_download(item)
            )
            for _ in range(new_count):
                increment_stat("scraped_count")

            log.info("  → %d new items queued (%d on page)", new_count, len(items))

    # ── Download worker ───────────────────────────────────────────────────────

    async def _download_one(
        self,
        session: aiohttp.ClientSession,
        sem: asyncio.Semaphore,
        item: dict,
    ) -> None:
        async with sem:
            try:
                await process_download(session, item)
            except Exception:
                log.exception("Download crashed: %s", item.get("image_url"))
                increment_stat("errors")


# ── Singleton ─────────────────────────────────────────────────────────────────
engine = DownloadEngine()
