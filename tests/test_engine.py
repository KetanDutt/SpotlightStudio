from __future__ import annotations

import asyncio
import json
import time
from collections import Counter

import pytest

from src import database as db
from src import engine as engine_mod
from src.config import settings
from src.engine import DownloadEngine, EngineBusy, RunStats
from tests.fake_site import Item, hash32

EXPECTED_LIBRARY = 8 + 6  # default fake site


@pytest.fixture()
def eng(env):
    engine = DownloadEngine()
    yield engine
    engine.shutdown(20)


@pytest.fixture(autouse=True)
def fast_breaker(monkeypatch):
    monkeypatch.setattr(engine_mod, "BREAKER_THRESHOLD", 3)
    monkeypatch.setattr(engine_mod, "BREAKER_FIRST_PAUSE", 0.3)
    monkeypatch.setattr(engine_mod, "BREAKER_MAX_PAUSE", 0.6)


def finish(engine: DownloadEngine, timeout: float = 40.0) -> None:
    assert engine.wait(timeout), f"engine did not finish: {engine.snapshot()}"


def wait_until(predicate, timeout: float = 20.0, interval: float = 0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


# ── Happy paths ────────────────────────────────────────────────────────────


def test_full_crawl_end_to_end(site, eng):
    site.win10_items[0] = Item(1, "Win10 copy of Peapix 1", ["lake"], "2026-08-01")  # cross-site duplicate
    assert eng.start("both", "full") == "started"
    finish(eng)

    snap = eng.snapshot()
    assert snap["status"] == "stopped" and snap["progress_pct"] == 100
    run = eng.run
    assert run.result == "completed" and run.errors == 0
    # The Peapix copy (1280×720) and the Win10 copy (640×360) of seed 1 are downloaded concurrently, so
    # either may be stored first: the other is then skipped as a duplicate (better copy first) or
    # supersedes it (worse copy first).  The outcome counters differ, the library must not.
    assert run.downloaded == EXPECTED_LIBRARY - 1
    assert run.duplicates + run.replaced == 1
    assert run.pages_total == run.pages_done == 4                       # wrong hints corrected by discovery
    assert run.titles_enriched == 3                                      # seeds 102,104,106 list a hash → post title fetched
    assert db.count_wallpapers() == EXPECTED_LIBRARY - 1
    assert db.scrape_queue_size() == 0 and db.download_queue_size() == 0
    rows = db.get_all_wallpapers(per_page=100)[0]
    assert not [r for r in rows if len(r["title"]) == 32]
    assert Counter(r["source"] for r in rows) == {"peapix": 8, "win10spotlight": 5}  # the better copy survives
    assert len(json.loads(settings.CATALOG_PATH.read_text(encoding="utf-8"))) == EXPECTED_LIBRARY - 1
    assert db.get_stat("status") == "stopped" and db.get_stat("last_run_result") == "completed"
    assert db.get_stat("last_run_mode") == "full"
    assert int(db.get_stat("last_run_downloaded")) == run.downloaded + run.replaced
    assert len(list((settings.IMAGES_DIR / "thumbs").rglob("*.jpg"))) == 13
    assert db.get_stat("scraped_count") == "14"


@pytest.mark.parametrize(
    ("late", "downloaded", "duplicates", "replaced"),
    [("win10", 13, 1, 0), ("peapix", 13, 0, 1)],
    ids=["better-copy-first", "worse-copy-first"],
)
def test_cross_site_duplicate_ends_the_same_whichever_copy_arrives_first(
    site, eng, monkeypatch, late, downloaded, duplicates, replaced
):
    """
    Peapix 1 (1280×720) and its Win10 copy (640×360) are downloaded concurrently, so the engine must
    cope with either arriving first: the worse copy is skipped, or it is stored and then superseded.
    Only the counters differ – the library, its files and the surviving copy are identical.
    """
    site.win10_items[0] = Item(1, "Win10 copy of Peapix 1", ["lake"], "2026-08-01")
    peapix_copy, win10_copy = hash32(1), site.win10_image_name(site.win10_items[0])
    late_copy, early_copy = (peapix_copy, win10_copy) if late == "peapix" else (win10_copy, peapix_copy)
    early_done = asyncio.Event()
    real_process = engine_mod.process_download

    # Ordering by event, not by sleeping: the late copy is held back until the early one is completely
    # processed, so the outcome cannot depend on how fast the two sites happen to answer.
    async def ordered(session, item, **kwargs):
        url = item["image_url"]
        if late_copy in url:
            await asyncio.wait_for(early_done.wait(), 30)
        try:
            return await real_process(session, item, **kwargs)
        finally:
            if early_copy in url:
                early_done.set()

    monkeypatch.setattr(engine_mod, "process_download", ordered)
    assert eng.start("both", "full") == "started"
    finish(eng)

    run = eng.run
    assert (run.downloaded, run.duplicates, run.replaced, run.errors) == (downloaded, duplicates, replaced, 0)
    rows = db.get_all_wallpapers(per_page=100)[0]
    assert len(rows) == EXPECTED_LIBRARY - 1
    assert Counter(r["source"] for r in rows) == {"peapix": 8, "win10spotlight": 5}  # the better copy survives
    assert len([r for r in rows if r["source"] == "peapix" and r["width"] == 1280]) == 8
    files = [p for p in settings.IMAGES_DIR.rglob("*.jpg") if "thumbs" not in p.parts]
    assert len(files) == EXPECTED_LIBRARY - 1                                           # no orphans
    assert int(db.get_stat("last_run_downloaded")) == run.downloaded + run.replaced


def test_scraping_and_downloading_overlap(site, eng):
    site.peapix_per_page = 1
    site.win10_per_page = 1
    site.page_delay = 0.12
    eng.start("both", "full")
    overlapped = wait_until(
        lambda: eng.run.downloaded > 0 and eng.run.pages_done < eng.run.pages_total, timeout=20
    )
    finish(eng)
    assert overlapped, "downloads must start while gallery pages are still being scraped"
    assert db.count_wallpapers() == EXPECTED_LIBRARY


def test_second_run_finds_nothing_new(site, eng):
    eng.start("both", "full")
    finish(eng)
    eng.start("both", "full")
    finish(eng)
    assert eng.run.downloaded == 0 and eng.run.errors == 0
    assert db.count_wallpapers() == EXPECTED_LIBRARY
    assert db.download_queue_size() == 0


def test_source_filter_only_touches_the_selected_site(site, eng):
    eng.start("peapix", "full")
    finish(eng)
    assert db.get_all_wallpapers(source="peapix")[1] == 8
    assert db.get_all_wallpapers(source="win10spotlight")[1] == 0
    assert db.scrape_queue_size("win10spotlight") == 0                   # never seeded
    assert not any(path.startswith("/page/") for path in site.hits)


def test_quick_mode_scans_only_the_newest_pages(site, eng):
    eng.start("peapix", "quick")
    finish(eng)
    assert db.count_wallpapers() == site.peapix_per_page                 # 1 page × 4 items
    assert site.hits["/spotlight"] >= 1 and "/spotlight/page-2" not in site.hits
    assert eng.run.pages_total == 1 and eng.run.result == "completed"


def test_quick_mode_ignores_an_old_backlog(site, eng):
    old = {"image_url": f"{site.base}/img/{hash32(8)}_UHD.jpg", "source": "peapix", "title": "old",
           "tags": "", "page_url": "", "date_spotted": "", "added_at": "2000-01-01T00:00:00+00:00"}
    assert db.enqueue_download(old)
    eng.start("peapix", "quick")
    finish(eng)
    assert db.download_queue_size() == 1                                 # backlog untouched
    assert db.get_all_wallpapers()[1] == site.peapix_per_page
    eng.start("peapix", "full")                                          # a full run continues the backlog
    finish(eng)
    assert db.download_queue_size() == 0 and db.count_wallpapers() == 8


# ── Reliability ────────────────────────────────────────────────────────────


def test_stop_releases_work_and_resume_finishes_without_loss(site, eng):
    site.slow = 0.25
    eng.start("both", "full")
    assert wait_until(lambda: eng.run.downloaded >= 1)
    eng.stop()
    assert eng.snapshot()["status"] in {"stopping", "stopped"}
    finish(eng)

    assert eng.run.result == "stopped"
    pending = db.download_queue_size() + db.scrape_queue_size()
    assert pending > 0, "an interrupted run must leave the remaining work queued"
    with db.get_db() as conn:                                             # no claim may stay locked
        assert conn.execute("SELECT COUNT(*) FROM download_queue WHERE claimed_at IS NOT NULL").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE claimed_at IS NOT NULL").fetchone()[0] == 0
    stored_before = db.count_wallpapers()

    site.slow = 0.0
    eng.start("both", "full")                                             # resumes the backlog
    finish(eng)
    assert db.count_wallpapers() == EXPECTED_LIBRARY
    assert db.count_wallpapers() >= stored_before
    assert db.download_queue_size() == db.scrape_queue_size() == 0


def test_pause_stops_new_work_and_resume_continues(site, eng):
    site.slow = 0.2
    site.peapix_items = site.peapix_items[:8]
    eng.start("peapix", "full")
    assert wait_until(lambda: eng.run.downloaded >= 1)
    eng.pause()
    assert eng.status == "paused" and eng.snapshot()["phase"] == "Paused"
    assert wait_until(lambda: eng._download_inflight == 0, timeout=30)    # in-flight downloads may finish …
    settled = eng.run.downloaded
    time.sleep(0.6)
    assert eng.run.downloaded == settled, "… but no new download may start while paused"
    assert eng.snapshot()["phase"] == "Paused"                            # immediately, not on the next tick
    assert eng.start("peapix", "full") == "resumed"
    finish(eng)
    assert db.count_wallpapers() == 8


def test_transient_page_failures_are_retried_not_dropped(site, eng):
    site.flaky["/spotlight/page-2"] = 5                                   # more than fetch_html's own retries
    eng.start("peapix", "full")
    finish(eng)
    assert eng.run.pages_failed == 0 and db.count_wallpapers() == 8


def test_page_is_dropped_only_after_max_retries(site, eng):
    site.flaky["/spotlight/page-2"] = 10**6
    eng.start("peapix", "full")
    finish(eng)
    assert eng.run.pages_failed == 1 and eng.run.errors >= 1
    assert db.count_wallpapers() == 4                                      # page 1 only
    assert eng.run.result == "completed" and db.scrape_queue_size() == 0


def test_network_outage_trips_the_breaker_and_loses_nothing(site, eng, monkeypatch):
    monkeypatch.setattr(settings, "PEAPIX_TOTAL_PAGES", 2)   # realistic hints: discovery is
    monkeypatch.setattr(settings, "WIN10_TOTAL_PAGES", 2)    # impossible while the site is down
    site.outage = True
    eng.start("both", "full")
    assert wait_until(lambda: eng.snapshot()["breaker_active"] or eng.run.pages_failed > 0, timeout=10)
    site.outage = False
    finish(eng)
    assert eng.run.pages_failed == 0, "an outage must not burn retries"
    assert db.count_wallpapers() == EXPECTED_LIBRARY


def test_download_failures_are_requeued_then_dropped(site, eng):
    site.flaky[f"/img/{hash32(1)}_UHD.jpg"] = 10**6                     # never works
    site.missing_uhd.discard(1)
    eng.start("peapix", "full")
    finish(eng)
    assert db.count_wallpapers() >= 7                                      # the others are fine
    assert eng.run.errors >= 1
    assert db.download_queue_size() == 0                                   # dropped after MAX_RETRIES (+ final degrade)


def test_switching_source_while_running_seeds_the_new_source(site, eng):
    site.slow = 0.15
    assert eng.start("peapix", "full") == "started"
    assert wait_until(lambda: eng.run.pages_done >= 1)
    assert eng.start("both", "full") == "updated"
    site.slow = 0.0
    finish(eng)
    assert eng.active_source == "both"
    assert db.get_all_wallpapers(source="win10spotlight")[1] == 6


def test_start_normalises_arguments_and_stop_is_idempotent(site, eng):
    eng.stop()
    eng.pause()                                                            # no-ops while stopped
    assert eng.status == "stopped"
    assert eng.start("NOPE", "weird") == "started"
    assert eng.active_source == "both" and eng.mode == "full"
    eng.stop()
    eng.stop()
    finish(eng)
    assert eng.status == "stopped"


def test_start_after_stop_is_rejected_while_shutting_down(site, eng, monkeypatch):
    class FakeThread:
        def is_alive(self):
            return True

        def join(self, timeout=None):
            return None

    eng._status = "stopping"
    eng._thread = FakeThread()
    with pytest.raises(EngineBusy):
        eng.start()
    eng._status = "stopped"


# ── Repair mode ────────────────────────────────────────────────────────────


def test_repair_mode_backfills_titles_tags_and_dates(site, eng, add):
    from tests.conftest import add_wallpaper

    peapix_rows = [
        add_wallpaper(source="peapix", title="Windows Spotlight", tags="", date_spotted="",
                      page_url=f"{site.base}/spotlight/{1000 + item.seed}", filename=f"peapix/{n}.jpg")
        for n, item in enumerate(site.peapix_items[:4])
    ]
    win10_rows = [
        add_wallpaper(source="win10spotlight", title=site.win10_image_name(item), tags="x",
                      page_url=f"{site.base}/images/{5000 + item.seed}", filename=f"win10spotlight/{n}.jpg")
        for n, item in enumerate(site.win10_items[:3])
    ]
    keep = add_wallpaper(source="win10spotlight", title="Already good", tags="x",
                         page_url=f"{site.base}/images/{5000 + site.win10_items[3].seed}")

    eng.start("both", "repair")
    finish(eng)
    assert eng.run.result == "completed" and eng.run.errors == 0

    for row, item in zip(peapix_rows, site.peapix_items[:4], strict=True):
        fixed = db.get_wallpaper(row["id"])
        assert fixed["title"] == item.title
        assert set(fixed["tags"].split(",")) == set(item.tags)
        assert fixed["date_spotted"] == item.date
    for row, item in zip(win10_rows, site.win10_items[:3], strict=True):
        assert db.get_wallpaper(row["id"])["title"] == item.title
    assert db.get_wallpaper(keep["id"])["title"] == "Already good"
    assert eng.run.repaired == 7
    assert not any(path.startswith("/img/") for path in site.hits)         # repair never downloads images

    hits_before = site.hits[f"/images/{5000 + site.win10_items[0].seed}"]
    eng.start("both", "repair")                                             # idempotent
    finish(eng)
    assert eng.run.repaired == 0
    assert site.hits[f"/images/{5000 + site.win10_items[0].seed}"] == hits_before  # nothing left to fetch


# ── Units ──────────────────────────────────────────────────────────────────


def test_circuit_breaker_unit(env):
    engine = DownloadEngine()
    assert [engine._note_transient_failure() for _ in range(2)] == [False, False]
    assert engine._note_transient_failure() is True                         # threshold reached
    assert time.monotonic() < engine._breaker_until
    first_pause = engine._breaker_pause
    engine._breaker_until = 0
    engine._note_transient_failure()
    assert engine._breaker_pause >= first_pause                              # back-off grows (capped)
    engine._note_success()
    assert engine._fail_streak == 0 and engine._breaker_pause == engine_mod.BREAKER_FIRST_PAUSE


def test_run_stats_progress_and_rate():
    stats = RunStats(pages_total=10, items_total=10)
    assert stats.progress_pct(False) == 0
    stats.pages_done, stats.items_done = 10, 5
    assert stats.progress_pct(False) == 75
    stats.pages_done, stats.items_done = 10, 10
    assert stats.progress_pct(False) == 99                                  # never 100 before completion
    stats.result = "completed"
    assert stats.progress_pct(True) == 100
    assert RunStats().progress_pct(False) == 0

    now = time.monotonic()
    stats._samples.extend([(now - 4, 0), (now - 2, 4), (now, 8)])
    assert stats.rate() == pytest.approx(2.0, rel=0.05)
    assert RunStats().rate() == 0.0
    assert set(stats.as_dict()) >= {"pages_total", "downloaded", "elapsed_seconds", "result"}
