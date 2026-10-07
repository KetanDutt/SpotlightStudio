"""
engine.py – the crawl orchestrator.

Architecture
────────────

  ┌──────────────────────────── EngineThread (own asyncio loop) ──────────────────────────┐
  │                                                                                        │
  │   scrape dispatcher ──► claim page ──► fetch+parse ──► enrich titles ──► enqueue URLs  │
  │        (CONCURRENT_SCRAPERS)                                                │          │
  │                                                                             ▼          │
  │   download dispatcher ◄── claim item ◄──────────── SQLite download_queue ◄──┘          │
  │        (CONCURRENT_DOWNLOADS)  └─► fetch → analyse (CPU pool) → dedupe → store         │
  │                                                                                        │
  │   supervisor: progress, phase, periodic catalog export, completion detection          │
  └────────────────────────────────────────────────────────────────────────────────────────┘

Both dispatchers run **concurrently** – downloads start as soon as the first page
yields wallpapers (the 2.1 engine waited for *all* ~1 350 gallery pages first).

Modes
─────
``quick``   scan the newest ``QUICK_UPDATE_PAGES`` pages of each source and fetch only
            what is new.  Seconds instead of minutes – the mode to schedule daily.
``full``    discover the real page count, scan every gallery page, resume any backlog.
``repair``  no downloads: re-read gallery/post pages and fill in missing titles & tags
            of wallpapers that are already stored.

Reliability guarantees
──────────────────────
* Queue rows are **claimed**, not deleted, while in flight; Stop / crash / network
  failure never loses work (claims are released and retried).
* Failed items go to the back of the queue and are retried ``MAX_RETRIES`` times.
* A **circuit breaker** pauses dispatching when many consecutive requests fail
  (Wi-Fi dropped, site down) and does *not* burn retries meanwhile.
* ``stop()`` drains gracefully: workers are cancelled, their claims released and
  the catalog is exported before the thread ends.

Thread-safety: ``start/pause/stop/snapshot`` may be called from any thread; they talk
to the loop through ``call_soon_threadsafe``.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Literal

import aiohttp

from src import maintenance
from src.config import settings
from src.database import (
    claim_download_item,
    claim_scrape_page,
    clean_download_queue,
    complete_download_item,
    complete_scrape_page,
    download_queue_size,
    enqueue_download,
    enqueue_scrape_pages,
    export_catalog_json,
    fail_download_item,
    fail_scrape_page,
    get_db,
    get_wallpaper_by_page_url,
    increment_stat,
    is_url_known,
    merge_wallpaper_metadata,
    release_all_claims,
    release_download_item,
    release_scrape_page,
    scrape_queue_size,
    set_stat,
)
from src.downloader import get_cpu_pool, process_download
from src.scrapers import (
    SOURCE_PEAPIX,
    SOURCE_WIN10,
    SOURCES,
    ScrapeError,
    discover_total_pages,
    fetch_win10_post_title,
    gallery_page_url,
    scrape_gallery_page,
)
from src.utils import is_placeholder_title, utcnow_iso

log = logging.getLogger("engine")

# Half-closed TLS connections only leak on interpreters without CPython PR #118960 (first released in 3.12.8
# and 3.13.1).  aiohttp ignores the option elsewhere and emits a DeprecationWarning if it is passed anyway;
# this mirrors aiohttp's own NEEDS_CLEANUP_CLOSED.
_NEEDS_CLEANUP_CLOSED = sys.version_info < (3, 12, 8) or sys.version_info[:3] == (3, 13, 0)

Status = Literal["stopped", "running", "paused", "stopping"]
VALID_SOURCES = ("peapix", "win10spotlight", "both")
VALID_MODES = ("quick", "full", "repair")

BREAKER_THRESHOLD = 10  # consecutive transient failures before dispatching pauses
BREAKER_FIRST_PAUSE = 15.0  # seconds
BREAKER_MAX_PAUSE = 120.0
CATALOG_EXPORT_INTERVAL = 30.0  # seconds between periodic exports while crawling
TITLE_FETCH_CONCURRENCY = 4


class EngineBusy(RuntimeError):
    """Raised when ``start()`` is called while the previous run is still shutting down."""


# ══════════════════════════════════════════════════════════════════════════
# Run statistics
# ══════════════════════════════════════════════════════════════════════════


@dataclass
class RunStats:
    """Counters of the *current* run (the persistent totals live in the ``stats`` table)."""

    mode: str = "full"
    source: str = "both"
    started_at: float = 0.0
    finished_at: float = 0.0
    pages_total: int = 0
    pages_done: int = 0
    pages_failed: int = 0
    items_total: int = 0  # wallpapers known to need processing (backlog + discovered)
    items_done: int = 0
    downloaded: int = 0
    replaced: int = 0
    duplicates: int = 0
    errors: int = 0
    repaired: int = 0
    titles_enriched: int = 0
    phase: str = "Idle"
    result: str = ""  # completed | stopped | failed
    _samples: deque = field(default_factory=lambda: deque(maxlen=128), repr=False)

    def note_stored(self) -> None:
        self._samples.append((time.monotonic(), self.downloaded + self.replaced))

    def rate(self, window: float = 10.0) -> float:
        """Wallpapers stored per second over the last ``window`` seconds."""
        now = time.monotonic()
        recent = [(t, n) for t, n in self._samples if now - t <= window]
        if len(recent) < 2:
            return 0.0
        (t0, n0), (t1, n1) = recent[0], recent[-1]
        return (n1 - n0) / (t1 - t0) if t1 > t0 else 0.0

    def progress_pct(self, finished: bool) -> int:
        if finished and self.result == "completed":
            return 100
        total = self.pages_total + self.items_total
        if total <= 0:
            return 0
        return min(99, int((self.pages_done + self.items_done) * 100 / total))

    def elapsed(self) -> float:
        if not self.started_at:
            return 0.0
        return (self.finished_at or time.time()) - self.started_at

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "source": self.source,
            "pages_total": self.pages_total,
            "pages_done": self.pages_done,
            "pages_failed": self.pages_failed,
            "items_total": self.items_total,
            "items_done": self.items_done,
            "downloaded": self.downloaded,
            "replaced": self.replaced,
            "duplicates": self.duplicates,
            "errors": self.errors,
            "repaired": self.repaired,
            "titles_enriched": self.titles_enriched,
            "elapsed_seconds": round(self.elapsed(), 1),
            "result": self.result,
        }


# ══════════════════════════════════════════════════════════════════════════
# Engine
# ══════════════════════════════════════════════════════════════════════════


class DownloadEngine:
    """Thread-safe crawler with Start / Pause / Stop controls callable from any thread."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._status: Status = "stopped"
        self._source = "both"
        self._mode = "full"
        self._maintenance_active = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._pause_event: asyncio.Event | None = None
        self._stop_event: asyncio.Event | None = None
        self._stop_requested = False
        self._finished = threading.Event()
        self._finished.set()
        self._session: aiohttp.ClientSession | None = None
        self._run = RunStats()
        self._seeded: set[str] = set()
        self._run_started_iso = ""
        self._scrape_inflight = 0
        self._download_inflight = 0
        self._fail_streak = 0
        self._breaker_until = 0.0
        self._breaker_pause = BREAKER_FIRST_PAUSE
        self._title_sem: asyncio.Semaphore | None = None
        self._last_phase = ""

    # ── Public control API ────────────────────────────────────────────────

    @property
    def status(self) -> Status:
        return self._status

    @property
    def active_source(self) -> str:
        return self._source

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def run(self) -> RunStats:
        return self._run

    def start(self, source: str = "both", mode: str = "full") -> str:
        """
        Start a run, resume a paused one, or switch the source of a running one.

        Returns ``"started"``, ``"resumed"`` or ``"updated"``.
        Raises :class:`EngineBusy` if the previous run is still shutting down.
        """
        src = (source or "both").lower().strip()
        src = src if src in VALID_SOURCES else "both"
        md = (mode or "full").lower().strip()
        md = md if md in VALID_MODES else "full"

        with self._lock:
            if self._maintenance_active:
                raise EngineBusy("Library maintenance is in progress.")
            if self._status == "stopping":
                # Shutdown needs this same lock to publish "stopped". Joining
                # while holding it prevented completion and stalled HTTP for 15s.
                raise EngineBusy("The previous run is still shutting down.")

            if self._status in ("running", "paused"):
                changed = src != self._source
                self._source = src
                set_stat("active_source", src)
                if self._status == "paused":
                    self._status = "running"
                    set_stat("status", "running")
                    self._call_in_loop(self._pause_event.set if self._pause_event else None)
                    log.info("Engine resumed (source=%s).", src)
                    return "resumed"
                if changed and self._loop is not None and md != "repair":
                    asyncio.run_coroutine_threadsafe(self._seed(src), self._loop)
                log.info("Engine source updated to: %s", src)
                return "updated"

            # stopped → fresh run
            self._source, self._mode = src, md
            self._status = "running"
            self._stop_requested = False
            self._run = RunStats(mode=md, source=src, started_at=time.time(), phase="Starting")
            self._run_started_iso = utcnow_iso()
            self._seeded = set()
            self._scrape_inflight = self._download_inflight = 0
            self._fail_streak = 0
            self._breaker_until = 0.0
            self._breaker_pause = BREAKER_FIRST_PAUSE
            self._last_phase = ""
            self._finished.clear()
            set_stat("status", "running")
            set_stat("phase", "Starting")
            set_stat("active_source", src)
            set_stat("active_mode", md)
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="EngineThread")
            self._thread.start()
            log.info(
                "Engine started (mode=%s, source=%s, downloads=%d, scrapers=%d).",
                md, src, settings.CONCURRENT_DOWNLOADS, settings.CONCURRENT_SCRAPERS,
            )
            return "started"

    @contextmanager
    def maintenance_guard(self):
        """Reserve the idle engine without racing a concurrent start/maintenance call."""
        with self._lock:
            if self._status != "stopped" or self._maintenance_active:
                raise EngineBusy("Stop the crawler and wait for any maintenance to finish.")
            self._maintenance_active = True
        try:
            yield
        finally:
            with self._lock:
                self._maintenance_active = False

    def pause(self) -> None:
        """Stop dispatching new work; in-flight requests finish, queues stay in SQLite."""
        with self._lock:
            if self._status != "running":
                return
            self._status = "paused"
            set_stat("status", "paused")
            self._call_in_loop(self._pause_event.clear if self._pause_event else None)
            log.info("Engine paused.")
        self._export_quietly()

    def stop(self) -> None:
        """Stop the run.  Claimed work is released; the call returns immediately."""
        with self._lock:
            if self._status in ("stopped", "stopping"):
                return
            self._status = "stopping"
            set_stat("status", "stopping")
            self._stop_requested = True
            if self._loop is not None:
                if self._stop_event:
                    self._call_in_loop(self._stop_event.set)
                if self._pause_event:
                    self._call_in_loop(self._pause_event.set)
            log.info("Engine stopping…")

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the current run finished.  True when it has."""
        return self._finished.wait(timeout)

    def shutdown(self, timeout: float = 30.0) -> bool:
        """Stop and wait – used when the application exits."""
        self.stop()
        return self.wait(timeout)

    def snapshot(self) -> dict[str, Any]:
        """Point-in-time view of the engine for ``/api/status``."""
        run = self._run
        status = self._status
        finished = status == "stopped"
        # Derive the label from the status so Pause/Stop show up instantly (the supervisor
        # refreshes ``run.phase`` only every 250 ms).
        phase = "Paused" if status == "paused" else "Stopping…" if status == "stopping" else run.phase
        return {
            "status": status,
            "active_source": self._source,
            "mode": self._mode,
            "phase": phase,
            "progress_pct": run.progress_pct(finished),
            "rate_per_sec": round(run.rate(), 2),
            "breaker_active": time.monotonic() < self._breaker_until,
            "run": run.as_dict(),
        }

    # ── Internals: thread & loop plumbing ──────────────────────────────────

    def _call_in_loop(self, fn) -> None:
        loop = self._loop
        if fn is not None and loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(fn)

    def _export_quietly(self) -> None:
        try:
            export_catalog_json()
        except Exception as exc:  # noqa: BLE001
            log.warning("Catalog export failed: %s", exc)

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        result = "completed"
        try:
            loop.run_until_complete(self._main())
            if self._stop_requested:
                result = "stopped"
        except Exception:
            log.exception("Engine loop crashed.")
            result = "failed"
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:  # noqa: BLE001
                pass
            loop.close()
            self._loop = None
            self._pause_event = self._stop_event = None
            try:
                release_all_claims()
            except Exception:  # noqa: BLE001
                log.exception("Could not release queue claims.")
            self._export_quietly()
            with self._lock:
                run = self._run
                run.finished_at = time.time()
                run.result = result
                run.phase = "Idle"
                self._status = "stopped"
                self._persist_summary(run)
                # Publish completion before a new start can clear this event.
                self._finished.set()
            log.info("Engine finished (%s).", result)

    def _persist_summary(self, run: RunStats) -> None:
        try:
            set_stat("status", "stopped")
            set_stat("phase", "Idle")
            set_stat("last_run_at", utcnow_iso())
            set_stat("last_run_mode", run.mode)
            set_stat("last_run_source", run.source)
            set_stat("last_run_result", run.result)
            set_stat("last_run_downloaded", run.downloaded + run.replaced)
            set_stat("last_run_duplicates", run.duplicates)
            set_stat("last_run_errors", run.errors)
            set_stat("last_run_repaired", run.repaired)
            set_stat("last_run_seconds", int(run.elapsed()))
        except Exception:  # noqa: BLE001
            log.exception("Could not persist the run summary.")

    def _target(self) -> str | None:
        return None if self._source == "both" else self._source

    def _min_priority(self) -> int:
        return 100 if self._mode == "quick" else 0

    def _since(self) -> str | None:
        return self._run_started_iso if self._mode == "quick" else None

    async def _sleep(self, seconds: float) -> None:
        """Sleep that wakes up immediately when the engine is asked to stop."""
        assert self._stop_event is not None
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    def _stopping(self) -> bool:
        return self._stop_event is None or self._stop_event.is_set()

    # ── Internals: circuit breaker ─────────────────────────────────────────

    def _note_success(self) -> None:
        self._fail_streak = 0
        self._breaker_pause = BREAKER_FIRST_PAUSE

    def _note_transient_failure(self) -> bool:
        """Record a network-ish failure.  True while the breaker is open (don't burn retries)."""
        self._fail_streak += 1
        if self._fail_streak < BREAKER_THRESHOLD:
            return False
        now = time.monotonic()
        if now >= self._breaker_until:
            self._breaker_until = now + self._breaker_pause
            log.warning(
                "Network looks unavailable (%d consecutive failures) – pausing %.0fs.",
                self._fail_streak, self._breaker_pause,
            )
            self._breaker_pause = min(self._breaker_pause * 2, BREAKER_MAX_PAUSE)
        return True

    async def _wait_breaker(self) -> None:
        while not self._stopping() and time.monotonic() < self._breaker_until:
            await self._sleep(0.5)

    # ── Main coroutine ─────────────────────────────────────────────────────

    async def _main(self) -> None:
        self._pause_event = asyncio.Event()
        self._pause_event.set()
        self._stop_event = asyncio.Event()
        if self._stop_requested:
            self._stop_event.set()
        self._title_sem = asyncio.Semaphore(TITLE_FETCH_CONCURRENCY)

        release_all_claims()  # a previous crashed run may have left claims behind

        connector = aiohttp.TCPConnector(
            limit=settings.MAX_CONNECTIONS,
            limit_per_host=settings.MAX_CONNECTIONS_PER_HOST,
            ssl=settings.VERIFY_SSL,
            ttl_dns_cache=600,
            enable_cleanup_closed=_NEEDS_CLEANUP_CLOSED,
        )
        timeout = aiohttp.ClientTimeout(
            total=settings.TIMEOUT, connect=10, sock_read=settings.TIMEOUT
        )
        async with aiohttp.ClientSession(
            headers=settings.HEADERS, connector=connector, timeout=timeout, trust_env=True
        ) as session:
            self._session = session
            try:
                if self._mode == "repair":
                    await self._repair(session)
                else:
                    await self._crawl(session)
            finally:
                self._session = None

    # ── Crawl (quick / full) ───────────────────────────────────────────────

    async def _crawl(self, session: aiohttp.ClientSession) -> None:
        run = self._run
        run.phase = "Preparing"
        await self._seed(self._source)
        run.items_total = download_queue_size(self._target(), self._since())

        dispatchers = [
            asyncio.create_task(self._scrape_dispatcher(session), name="scrape-dispatcher"),
            asyncio.create_task(self._download_dispatcher(session), name="download-dispatcher"),
        ]
        try:
            await self._supervise()
        finally:
            for task in dispatchers:
                task.cancel()
            await asyncio.gather(*dispatchers, return_exceptions=True)

        if self._stopping():
            return
        # Post-processing after a *complete* run.
        run.phase = "Cleaning up"
        set_stat("phase", run.phase)
        loop = asyncio.get_running_loop()
        try:
            if run.downloaded + run.replaced > 0 or self._mode == "full":
                await loop.run_in_executor(None, maintenance.deduplicate_downloaded_wallpapers)
            await loop.run_in_executor(None, maintenance.create_missing_thumbnails)
            await loop.run_in_executor(None, clean_download_queue)
        except Exception:  # noqa: BLE001
            log.exception("Post-run maintenance failed.")
        run.result = "completed"
        log.info(
            "🎉 Run complete (%s/%s): +%d new, %d replaced, %d duplicates, %d errors.",
            self._mode, self._source, run.downloaded, run.replaced, run.duplicates, run.errors,
        )

    async def _seed(self, source: str) -> None:
        """Make sure the scrape queue holds the gallery pages this run needs."""
        sources = SOURCES if source == "both" else (source,)
        loop = asyncio.get_running_loop()
        for src in sources:
            if src in self._seeded:
                continue
            self._seeded.add(src)
            if self._mode == "quick":
                rows = [
                    (gallery_page_url(src, n), src, 100)
                    for n in range(1, settings.QUICK_UPDATE_PAGES + 1)
                ]
                enqueue_scrape_pages(rows)
                self._run.pages_total += scrape_queue_size(src, 100)
                continue

            backlog = scrape_queue_size(src)
            if backlog > 0:
                log.info("Resuming %d unfinished %s gallery pages.", backlog, src)
                self._run.pages_total += backlog
                continue
            total = self._page_hint(src)
            if settings.AUTO_DETECT_PAGES and self._session is not None:
                self._run.phase = f"Discovering {src} pages"
                total = await discover_total_pages(self._session, src, total)
            rows = [(gallery_page_url(src, 1), src, 100)] + [
                (gallery_page_url(src, n), src, 10) for n in range(2, total + 1)
            ]
            await loop.run_in_executor(None, enqueue_scrape_pages, rows)
            self._run.pages_total += len(rows)
            log.info("Queued %d %s gallery pages.", len(rows), src)

    @staticmethod
    def _page_hint(source: str) -> int:
        return settings.PEAPIX_TOTAL_PAGES if source == SOURCE_PEAPIX else settings.WIN10_TOTAL_PAGES

    # ── Dispatchers ────────────────────────────────────────────────────────

    async def _scrape_dispatcher(self, session: aiohttp.ClientSession) -> None:
        assert self._pause_event is not None
        sem = asyncio.Semaphore(settings.CONCURRENT_SCRAPERS)
        tasks: set[asyncio.Task] = set()
        try:
            while not self._stopping():
                await self._pause_event.wait()
                await self._wait_breaker()
                if self._stopping():
                    break
                await sem.acquire()
                page = claim_scrape_page(self._target(), self._min_priority())
                if page is None:
                    sem.release()
                    await self._sleep(0.25)
                    continue
                task = asyncio.create_task(self._scrape_one(session, page, sem))
                tasks.add(task)
                self._scrape_inflight = len(tasks)
                task.add_done_callback(self._make_done_cb(tasks, "scrape"))
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            self._scrape_inflight = 0

    async def _download_dispatcher(self, session: aiohttp.ClientSession) -> None:
        assert self._pause_event is not None
        sem = asyncio.Semaphore(settings.CONCURRENT_DOWNLOADS)
        tasks: set[asyncio.Task] = set()
        try:
            while not self._stopping():
                await self._pause_event.wait()
                await self._wait_breaker()
                if self._stopping():
                    break
                await sem.acquire()
                item = claim_download_item(self._target(), self._since())
                if item is None:
                    sem.release()
                    await self._sleep(0.25)
                    continue
                task = asyncio.create_task(self._download_one(session, item, sem))
                tasks.add(task)
                self._download_inflight = len(tasks)
                task.add_done_callback(self._make_done_cb(tasks, "download"))
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            self._download_inflight = 0

    def _make_done_cb(self, tasks: set[asyncio.Task], kind: str):
        def _done(task: asyncio.Task) -> None:
            tasks.discard(task)
            if kind == "scrape":
                self._scrape_inflight = len(tasks)
            else:
                self._download_inflight = len(tasks)

        return _done

    # ── Scrape worker ──────────────────────────────────────────────────────

    async def _scrape_one(
        self, session: aiohttp.ClientSession, page: dict, sem: asyncio.Semaphore
    ) -> None:
        run = self._run
        finished = False
        try:
            try:
                items = await scrape_gallery_page(session, page["source"], page["url"])
            except ScrapeError as exc:
                breaker_open = self._note_transient_failure()
                if breaker_open:
                    release_scrape_page(page["id"])
                    finished = True
                    return
                requeued = fail_scrape_page(page["id"], settings.MAX_RETRIES)
                finished = True
                if not requeued:
                    run.pages_failed += 1
                    run.pages_done += 1
                    run.errors += 1
                    increment_stat("errors")
                    log.warning("Giving up on page %s: %s", page["url"], exc)
                return
            except Exception:  # parser bug etc. → treat like a failed attempt
                log.exception("Scrape error: %s", page["url"])
                requeued = fail_scrape_page(page["id"], settings.MAX_RETRIES)
                finished = True
                if not requeued:
                    run.pages_failed += 1
                    run.pages_done += 1
                    run.errors += 1
                    increment_stat("errors")
                return
            self._note_success()

            fresh = [it for it in items if not is_url_known(it["image_url"])]
            await self._enrich_titles(session, fresh)
            added = sum(1 for it in fresh if enqueue_download(it))
            # No await between enqueue and complete: cancellation can not split them.
            complete_scrape_page(page["id"])
            finished = True
            run.pages_done += 1
            run.items_total += added
            if added:
                increment_stat("scraped_count", added)
                log.info("📄 %s → %d new of %d", page["url"], added, len(items))
            await asyncio.sleep(settings.REQUEST_DELAY)
        except asyncio.CancelledError:
            if not finished:
                release_scrape_page(page["id"])
            raise
        finally:
            sem.release()

    async def _enrich_titles(self, session: aiohttp.ClientSession, items: list[dict]) -> None:
        """Fetch the real title for listing entries that only show a file hash."""
        todo = [it for it in items if it.get("needs_title") and it.get("page_url")]
        if not todo:
            return
        assert self._title_sem is not None

        async def fetch(item: dict) -> None:
            async with self._title_sem:  # type: ignore[union-attr]
                title = await fetch_win10_post_title(session, item["page_url"])
            if title:
                item["title"] = title
                self._run.titles_enriched += 1

        await asyncio.gather(*(fetch(it) for it in todo))

    # ── Download worker ────────────────────────────────────────────────────

    async def _download_one(
        self, session: aiohttp.ClientSession, item: dict, sem: asyncio.Semaphore
    ) -> None:
        run = self._run
        try:
            try:
                outcome = await process_download(session, item, pool=get_cpu_pool())
            except asyncio.CancelledError:
                release_download_item(item["id"])
                raise
            except Exception:
                log.exception("Download crashed: %s", item.get("image_url"))
                outcome = "failed"

            if outcome == "failed":
                if self._note_transient_failure():
                    release_download_item(item["id"])  # outage: do not burn a retry
                    return
                requeued = fail_download_item(item["id"], settings.MAX_RETRIES)
                run.errors += 1
                increment_stat("errors")
                if not requeued:
                    run.items_done += 1
                return

            if outcome != "rejected":
                self._note_success()
            complete_download_item(item["id"])
            run.items_done += 1
            if outcome == "downloaded":
                run.downloaded += 1
                run.note_stored()
            elif outcome == "replaced":
                run.replaced += 1
                run.note_stored()
            elif outcome == "duplicate":
                run.duplicates += 1
            elif outcome == "rejected":
                run.errors += 1
                increment_stat("errors")
        finally:
            sem.release()

    # ── Supervisor ─────────────────────────────────────────────────────────

    def _set_phase(self, phase: str) -> None:
        self._run.phase = phase
        if phase != self._last_phase:
            self._last_phase = phase
            try:
                set_stat("phase", phase)
            except Exception:  # noqa: BLE001
                pass

    async def _supervise(self) -> None:
        """Track progress and detect completion until finished or stopped."""
        assert self._pause_event is not None
        loop = asyncio.get_running_loop()
        last_export = time.monotonic()
        last_stored = 0
        while not self._stopping():
            paused = not self._pause_event.is_set()
            scraping = self._scrape_inflight > 0 or scrape_queue_size(
                self._target(), self._min_priority()
            ) > 0
            downloading = self._download_inflight > 0 or download_queue_size(
                self._target(), self._since()
            ) > 0

            if paused:
                self._set_phase("Paused")
            elif self._time_in_breaker():
                self._set_phase("Waiting for network")
            elif scraping and downloading:
                self._set_phase("Scraping & downloading")
            elif scraping:
                self._set_phase("Scraping gallery pages")
            elif downloading:
                self._set_phase("Downloading images")
            else:
                self._set_phase("Finishing")

            if not paused and not scraping and not downloading:
                if self._scrape_inflight == 0 and self._download_inflight == 0:
                    return  # nothing queued, nothing in flight → run complete

            stored = self._run.downloaded + self._run.replaced
            if stored != last_stored and time.monotonic() - last_export >= CATALOG_EXPORT_INTERVAL:
                last_stored, last_export = stored, time.monotonic()
                await loop.run_in_executor(None, self._export_quietly)
            await self._sleep(0.25)

    def _time_in_breaker(self) -> bool:
        return time.monotonic() < self._breaker_until

    # ── Repair mode ────────────────────────────────────────────────────────

    async def _repair(self, session: aiohttp.ClientSession) -> None:
        """
        Back-fill titles / tags / dates of wallpapers that are already stored.

        * Peapix:  re-read every gallery page and merge metadata by ``page_url``.
        * Win10:   fetch the post page of every wallpaper whose title is a placeholder.
        """
        run = self._run
        assert self._pause_event is not None
        run.phase = "Repairing metadata"
        set_stat("phase", run.phase)
        loop = asyncio.get_running_loop()
        work: deque[tuple[str, Any]] = deque()
        wanted = SOURCES if self._source == "both" else (self._source,)

        if SOURCE_PEAPIX in wanted:
            total = self._page_hint(SOURCE_PEAPIX)
            if settings.AUTO_DETECT_PAGES:
                total = await discover_total_pages(session, SOURCE_PEAPIX, total)
            for n in range(1, total + 1):
                work.append(("peapix", gallery_page_url(SOURCE_PEAPIX, n)))
        if SOURCE_WIN10 in wanted:
            def _placeholder_posts() -> list[tuple[int, str]]:
                with get_db() as conn:
                    rows = conn.execute(
                        "SELECT id, title, page_url FROM wallpapers "
                        "WHERE source = ? AND page_url != ''", (SOURCE_WIN10,)
                    ).fetchall()
                return [(r["id"], r["page_url"]) for r in rows if is_placeholder_title(r["title"])]

            for row in await loop.run_in_executor(None, _placeholder_posts):
                work.append(("win10", row))
        run.pages_total = len(work)
        log.info("Repair: %d pages/posts to inspect.", len(work))

        async def worker() -> None:
            while work and not self._stopping():
                await self._pause_event.wait()  # type: ignore[union-attr]
                await self._wait_breaker()
                if self._stopping() or not work:
                    return
                kind, payload = work.popleft()
                try:
                    if kind == "peapix":
                        for item in await scrape_gallery_page(session, SOURCE_PEAPIX, payload):
                            row = get_wallpaper_by_page_url(item["page_url"])
                            if row and merge_wallpaper_metadata(
                                row["id"], title=item["title"], tags=item["tags"],
                                date_spotted=item["date_spotted"],
                            ):
                                run.repaired += 1
                    else:
                        wallpaper_id, page_url = payload
                        title = await fetch_win10_post_title(session, page_url)
                        if title and merge_wallpaper_metadata(wallpaper_id, title=title):
                            run.repaired += 1
                    self._note_success()
                except ScrapeError as exc:
                    if self._note_transient_failure():
                        work.append((kind, payload))  # outage: try again later
                        continue
                    run.errors += 1
                    log.warning("Repair skipped %s: %s", payload, exc)
                except Exception:
                    run.errors += 1
                    log.exception("Repair error for %s", payload)
                run.pages_done += 1
                await self._sleep(settings.REQUEST_DELAY)

        workers = [asyncio.create_task(worker()) for _ in range(settings.CONCURRENT_SCRAPERS)]
        try:
            await asyncio.gather(*workers)
        finally:
            for task in workers:
                task.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
        if not self._stopping():
            run.result = "completed"
            log.info("🎉 Repair complete: %d wallpapers updated, %d errors.", run.repaired, run.errors)


# ── Singleton ─────────────────────────────────────────────────────────────
engine = DownloadEngine()
