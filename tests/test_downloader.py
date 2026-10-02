from __future__ import annotations

import asyncio
import io

import aiohttp
import pytest
from PIL import Image

from src import database as db
from src import downloader, storage
from src.config import settings
from src.downloader import (
    FetchError,
    analyze_image,
    fetch_image,
    process_download,
    url_variants,
)
from tests.fake_site import hash32, make_picture


def run(coro_fn):
    async def main():
        async with aiohttp.ClientSession() as session:
            return await coro_fn(session)

    return asyncio.run(main())


def peapix_url(site, seed: int, variant: str = "UHD") -> str:
    return f"{site.base}/img/{hash32(seed)}_{variant}.jpg"


def item_for(site, seed: int, **extra) -> dict:
    return {"image_url": peapix_url(site, seed), "source": "peapix", "title": f"Title {seed}",
            "tags": "lake", "page_url": f"{site.base}/spotlight/{1000 + seed}",
            "date_spotted": "2026-09-01", "retries": 0, **extra}


# ── URL variants ───────────────────────────────────────────────────────────


def test_url_variants():
    h = "a" * 32
    assert url_variants(f"https://img.peapix.com/{h}_UHD.jpg") == [
        f"https://img.peapix.com/{h}_UHD.jpg", f"https://img.peapix.com/{h}_1920.jpg",
        f"https://img.peapix.com/{h}_1280.jpg", f"https://img.peapix.com/{h}_640.jpg"]
    assert url_variants("https://windows10spotlight.com/wp/x.jpg") == ["https://windows10spotlight.com/wp/x.jpg"]
    assert len(url_variants(f"http://127.0.0.1:1/img/{h}_UHD.jpg")) == 4   # host independent


# ── Fetching ───────────────────────────────────────────────────────────────


def test_fetch_prefers_uhd_and_falls_back_only_when_missing(site):
    async def go(session):
        best = await fetch_image(session, peapix_url(site, 1))
        site.missing_uhd.add(2)
        fallback = await fetch_image(session, peapix_url(site, 2))
        return best, fallback

    best, fallback = run(go)
    assert best.url.endswith("_UHD.jpg")
    assert fallback.url.endswith("_1920.jpg")


def test_transient_error_does_not_silently_downgrade_quality(site):
    async def go(session):
        site.flaky[f"/img/{hash32(1)}_UHD.jpg"] = 1
        with pytest.raises(FetchError) as exc:
            await fetch_image(session, peapix_url(site, 1))               # 503 on UHD
        assert exc.value.permanent is False
        site.flaky[f"/img/{hash32(1)}_UHD.jpg"] = 1
        degraded = await fetch_image(session, peapix_url(site, 1), allow_degrade=True)  # last retry
        return degraded

    degraded = run(go)
    assert degraded.url.endswith("_1920.jpg")


def test_missing_everywhere_is_permanent(site):
    async def go(session):
        with pytest.raises(FetchError) as exc:
            await fetch_image(session, f"{site.base}/img/{'f' * 32}_UHD.jpg")
        return exc.value.permanent

    assert run(go) is True


def test_size_cap_and_html_error_pages(site, monkeypatch):
    monkeypatch.setattr(settings, "MAX_IMAGE_BYTES", 1024)

    async def go(session):
        with pytest.raises(FetchError) as exc:
            await fetch_image(session, peapix_url(site, 1))
        return exc.value

    err = run(go)
    assert err.permanent and "large" in str(err) or "exceeds" in str(err)


def test_network_failure_is_transient(env):
    async def go(session):
        with pytest.raises(FetchError) as exc:
            await fetch_image(session, "http://127.0.0.1:9/img/x.jpg")  # nothing listens on port 9
        return exc.value.permanent

    assert run(go) is False


# ── Image analysis (CPU job) ───────────────────────────────────────────────


def test_analyze_image_produces_hash_and_16x9_thumbnail():
    info = analyze_image(make_picture(3, 1280, 720))
    assert (info.width, info.height, info.fmt) == (1280, 720, "JPEG")
    assert len(info.phash) == 64
    thumb = Image.open(io.BytesIO(info.thumb))
    assert thumb.size == downloader.THUMB_SIZE and thumb.format == "JPEG"


def test_thumbnail_centre_crops_other_aspect_ratios():
    portrait = Image.new("RGB", (600, 1000), (200, 10, 10))
    wide = Image.new("RGB", (2000, 500), (10, 10, 200))
    for img in (portrait, wide):
        assert Image.open(io.BytesIO(downloader.render_thumbnail(img))).size == downloader.THUMB_SIZE


def test_analyze_png_and_garbage():
    buf = io.BytesIO()
    Image.new("RGBA", (800, 450), (1, 2, 3, 128)).save(buf, "PNG")
    info = analyze_image(buf.getvalue())
    assert info.fmt == "PNG" and storage.extension_for_format(info.fmt) == "png"
    with pytest.raises(Exception):  # noqa: B017 – any decode error is acceptable
        analyze_image(b"definitely not an image" * 100)


# ── Full pipeline ──────────────────────────────────────────────────────────


def test_process_download_stores_files_and_row(site):
    async def go(session):
        return await process_download(session, item_for(site, 1))

    assert run(go) == "downloaded"
    (row,), total = db.get_all_wallpapers()
    assert total == 1
    assert row["source"] == "peapix" and row["title"] == "Title 1" and row["tags"] == "lake"
    assert row["quality"] == "HD (720p)" and (row["width"], row["height"]) == (1280, 720)
    assert row["source_url"].endswith("_UHD.jpg") and row["file_size"] > 5000
    assert storage.image_path(row["filename"]).is_file() and storage.thumb_path(row["filename"]).is_file()
    assert db.get_stat("downloaded_count") == "1"
    assert not list(settings.IMAGES_DIR.rglob("*.part"))                 # atomic writes leave no temp files


def test_cross_site_duplicate_is_skipped_and_enriches_metadata(site):
    site.win10_items[0].seed = 1  # the Win10 picture is the same photo as Peapix seed 1 (lower resolution)
    win10_item = {"image_url": f"{site.base}/wp/{site.win10_image_name(site.win10_items[0])}.jpg",
                  "source": "win10spotlight", "title": "", "tags": "chile,landscape", "page_url": "", "date_spotted": ""}

    async def go(session):
        first = await process_download(session, item_for(site, 1))
        second = await process_download(session, win10_item)
        return first, second

    first, second = run(go)
    assert (first, second) == ("downloaded", "duplicate")
    (row,), total = db.get_all_wallpapers()
    assert total == 1 and row["source"] == "peapix"
    assert row["tags"] == "lake,chile,landscape"                          # metadata merged
    assert db.is_url_suppressed(win10_item["image_url"])                  # never downloaded again
    assert db.get_stat("duplicates_skipped") == "1"


def test_better_copy_replaces_old_one_and_keeps_metadata(site):
    site.win10_items[0].seed = 1  # same photo as Peapix seed 1, but only 640×360
    low = {"image_url": f"{site.base}/wp/{site.win10_image_name(site.win10_items[0])}.jpg",
           "source": "win10spotlight", "title": "dfffe373d9c78e79e0d6a28ac186d8c5", "tags": "chile",
           "page_url": f"{site.base}/images/5101", "date_spotted": "2018-11-27"}

    async def go(session):
        first = await process_download(session, low)                      # 640×360 from Win10
        second = await process_download(session, item_for(site, 1))       # 1280×720 from Peapix
        return first, second

    first, second = run(go)
    assert (first, second) == ("downloaded", "replaced")
    (row,), total = db.get_all_wallpapers()
    assert total == 1 and row["width"] == 1280 and row["source"] == "peapix"
    assert row["title"] == "Title 1"                                      # real title beats the hash title
    assert row["tags"] == "chile,lake"                                    # union of both
    assert row["date_spotted"] == "2018-11-27"                            # existing date kept
    assert db.is_url_suppressed(low["image_url"])
    files = sorted(p.name for p in settings.IMAGES_DIR.rglob("*.jpg") if "thumbs" not in p.parts)
    assert files == [row["filename"].split("/")[-1]]                      # old file removed
    assert db.get_stat("duplicates_replaced") == "1"


def test_bad_images_are_rejected_or_retried(site, monkeypatch):
    site.corrupt.add(3)

    async def go(session):
        corrupt = await process_download(session, item_for(site, 3))
        gone = await process_download(session, {**item_for(site, 4), "image_url": f"{site.base}/img/{'e' * 32}_UHD.jpg"})
        site.outage = True
        flaky = await process_download(session, item_for(site, 5))
        site.outage = False
        return corrupt, gone, flaky

    corrupt, gone, flaky = run(go)
    assert (corrupt, gone, flaky) == ("rejected", "rejected", "failed")
    assert db.count_wallpapers() == 0


def test_too_narrow_images_are_rejected(site, monkeypatch):
    monkeypatch.setattr(settings, "MIN_IMAGE_WIDTH", 2000)

    async def go(session):
        return await process_download(session, item_for(site, 1))

    assert run(go) == "rejected" and db.count_wallpapers() == 0


def test_database_failure_leaves_no_orphan_files(site, monkeypatch):
    def boom(_record):
        raise RuntimeError("disk full")

    monkeypatch.setattr(downloader, "upsert_wallpaper", boom)

    async def go(session):
        with pytest.raises(RuntimeError):
            await process_download(session, item_for(site, 1))

    run(go)
    assert not [p for p in settings.IMAGES_DIR.rglob("*") if p.is_file()]


def test_final_retry_may_degrade_resolution(site):
    site.missing_uhd.add(1)
    site.flaky[f"/img/{hash32(1)}_UHD.jpg"] = 0

    async def go(session):
        return await process_download(session, item_for(site, 1, retries=settings.MAX_RETRIES))

    assert run(go) == "downloaded"
    (row,), _ = db.get_all_wallpapers()
    assert row["source_url"].endswith("_1920.jpg")
