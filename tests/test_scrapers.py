from __future__ import annotations

import asyncio

import aiohttp
import pytest

from src import scrapers
from src.config import settings
from src.scrapers import (
    ScrapeError,
    detect_peapix_total_pages,
    detect_win10_total_pages,
    discover_total_pages,
    fetch_html,
    gallery_page_url,
    parse_peapix_page,
    parse_win10_page,
    parse_win10_post_title,
)

H1, H2, H3 = "a" * 32, "b" * 32, "c" * 32


def run(coro_fn):
    async def main():
        async with aiohttp.ClientSession() as session:
            return await coro_fn(session)

    return asyncio.run(main())


# ── Peapix parser (structure-agnostic) ─────────────────────────────────────

BOOTSTRAP = f"""<html><body><nav><a href="/spotlight/tags/popular">popular</a></nav><div class="row">
<div class="col"><div class="card"><a href="/spotlight/61"><img data-src="https://img.peapix.com/{H1}_640.jpg" alt="Windows Spotlight"></a>
  <div class="position-absolute"><a href="/spotlight/tags/water">water</a><a href="/spotlight/tags/palm%20tree">palm tree</a></div>
  <div class="card-body"><a class="text-body text-truncate" href="/spotlight/61">Beach, Ocean Surf, Umbrellas</a> <span class="text-body-tertiary">May 14, 2025</span></div></div></div>
<div class="col"><div class="card"><a href="/spotlight/59"><img data-src="https://img.peapix.com/{H2}_640.jpg"></a>
  <div><a href="/spotlight/tags/desert">desert</a></div>
  <div><a class="link-body-emphasis" href="https://peapix.com/spotlight/59">White and Orange Rock Formations</a> <small>September 3, 2026</small></div></div></div>
</div><p>Page 2 of 30</p></body></html>"""

FLAT = f"""<main><div class="card"><a href="https://peapix.com/spotlight/12696"><img src="https://img.peapix.com/{H3}_640.jpg" alt="Symphony"></a>
<h5 class="card-title"><a href="https://peapix.com/spotlight/12696">Symphony of the Stones, Garni Gorge, Armenia</a></h5>
<time datetime="2026-09-19">Sept 19</time><a href="/spotlight/tags/sky">sky</a></div></main>"""

LISTING = f"""<div class="col"><a href="/spotlight/5"><img srcset="https://img.peapix.com/{H1}_640.jpg 640w, https://img.peapix.com/{H1}_1280.jpg 1280w"></a>
<p><a href="/spotlight/tags/a">a</a> <a href="/spotlight/tags/b">b</a></p><div><a href="/spotlight/5">First Title</a> May 13, 2025</div></div>
<div class="col"><a href="/spotlight/7"><img src="https://img.peapix.com/{H2}_640.jpg"></a>
<p><a href="/spotlight/tags/c">c</a></p><div><a href="/spotlight/7">Second Title</a> May 12, 2025</div></div>"""


def test_peapix_bootstrap_markup():
    first, second = parse_peapix_page(BOOTSTRAP)
    assert first["image_url"] == f"https://img.peapix.com/{H1}_UHD.jpg"
    assert first["page_url"] == "https://peapix.com/spotlight/61"
    assert first["title"] == "Beach, Ocean Surf, Umbrellas"      # generic alt text is ignored
    assert first["tags"] == "water,palm tree"
    assert first["date_spotted"] == "2025-05-14"
    assert first["source"] == "peapix"
    assert second["title"] == "White and Orange Rock Formations"  # absolute href + other class names
    assert second["tags"] == "desert" and second["date_spotted"] == "2026-09-03"


def test_peapix_flat_markup_with_time_element():
    (item,) = parse_peapix_page(FLAT)
    assert item["title"] == "Symphony of the Stones, Garni Gorge, Armenia"
    assert item["date_spotted"] == "2026-09-19"
    assert item["tags"] == "sky"
    assert item["page_url"].endswith("/spotlight/12696")


def test_peapix_cards_do_not_bleed_into_each_other():
    first, second = parse_peapix_page(LISTING)
    assert (first["title"], first["tags"], first["date_spotted"]) == ("First Title", "a,b", "2025-05-13")
    assert (second["title"], second["tags"], second["date_spotted"]) == ("Second Title", "c", "2025-05-12")


def test_peapix_ignores_pages_without_gallery_images_and_duplicates():
    assert parse_peapix_page("<html><body><img src='/logo.png'><p>nothing</p></body></html>") == []
    doubled = LISTING + LISTING
    assert len(parse_peapix_page(doubled)) == 2


def test_peapix_title_falls_back_to_alt_then_empty():
    html = f'<div><a href="/spotlight/9"><img src="https://img.peapix.com/{H1}_640.jpg" alt="Real alt text"></a></div>'
    assert parse_peapix_page(html)[0]["title"] == "Real alt text"
    html = f'<div><a href="/spotlight/9"><img src="https://img.peapix.com/{H1}_640.jpg" alt="Windows Spotlight"></a></div>'
    assert parse_peapix_page(html)[0]["title"] == ""


def test_peapix_total_pages_detection():
    assert detect_peapix_total_pages(BOOTSTRAP) == 30
    assert detect_peapix_total_pages('<a href="/spotlight/page-2">2</a><a href="/spotlight/page-17">17</a>') == 17
    assert detect_peapix_total_pages("<p>nothing</p>") is None


# ── Windows10Spotlight parser ──────────────────────────────────────────────

WIN10 = """<div>
<article class="post-42125 post type-post tag-alberta tag-national-park tag-lake hentry">
  <h2><a href="https://windows10spotlight.com/images/42125"> </a></h2>
  <span class="entry-title hidden">Turquoise Spirit Island in summer, Maligne Lake, Canada</span>
  <aside class="meta"><span class="date">2026-09-29</span></aside>
  <img class="thumbnail wp-post-image" srcset="https://w.com/u/x-1024x576.jpg 1024w, https://w.com/u/x-300x169.jpg 300w, https://w.com/u/x.jpg 1920w" src="https://w.com/u/x-1024x576.jpg"></article>
<article class="post-11289 post tag-chile"><h2><a href="/images/11289"> </a></h2>
  <span class="entry-title hidden">dfffe373d9c78e79e0d6a28ac186d8c5</span><aside><span class="date">2018-11-27</span></aside>
  <img class="thumbnail" src="/u/y-1024x576.jpg"></article>
<article class="post-1 post"><h2><a href="/images/1"> </a></h2></article>
</div><a href="/page/2">2</a><a href="/page/1320">1320</a>"""


def test_win10_listing():
    first, second = parse_win10_page(WIN10, base_url="https://windows10spotlight.com/")
    assert first["image_url"] == "https://w.com/u/x.jpg"                  # widest srcset entry
    assert first["title"].startswith("Turquoise Spirit Island")
    assert first["needs_title"] is False
    assert first["tags"] == "alberta,national park,lake"
    assert first["date_spotted"] == "2026-09-29"
    assert first["page_url"] == "https://windows10spotlight.com/images/42125"
    # hash title → empty + flagged for enrichment; relative URLs resolved; size suffix stripped
    assert second["title"] == "" and second["needs_title"] is True
    assert second["image_url"] == "https://windows10spotlight.com/u/y.jpg"
    assert second["page_url"] == "https://windows10spotlight.com/images/11289"
    assert len([i for i in parse_win10_page(WIN10)]) == 2                 # article without <img> skipped


def test_win10_post_title_extraction():
    post = ("<html><head><title>Graceful guanaco, Chile | Windows Spotlight Images</title></head><body>"
            "<header><h1><a>Windows Spotlight Images</a></h1></header>"
            "<article><h1>Graceful guanaco, Chile</h1><p>dfffe373d9c78e79e0d6a28ac186d8c5</p></article></body></html>")
    assert parse_win10_post_title(post) == "Graceful guanaco, Chile"
    only_title = ("<html><head><title>Lake Monowai, New Zealand | Windows Spotlight Images</title></head>"
                  "<body><header><h1>Windows Spotlight Images</h1></header></body></html>")
    assert parse_win10_post_title(only_title) == "Lake Monowai, New Zealand"
    og = '<html><head><meta property="og:title" content="From OG - Windows Spotlight"></head><body></body></html>'
    assert parse_win10_post_title(og) == "From OG"
    assert parse_win10_post_title("<html><head><title>Windows Spotlight Images</title></head></html>") == ""
    assert parse_win10_post_title("") == ""


def test_win10_total_pages_detection():
    assert detect_win10_total_pages(WIN10) == 1320
    assert detect_win10_total_pages("<p>x</p>") is None


def test_gallery_page_urls(env, monkeypatch):
    monkeypatch.setattr(settings, "PEAPIX_BASE_URL", "https://peapix.com")
    monkeypatch.setattr(settings, "WIN10_BASE_URL", "https://windows10spotlight.com")
    assert gallery_page_url("peapix", 1) == "https://peapix.com/spotlight"
    assert gallery_page_url("peapix", 7) == "https://peapix.com/spotlight/page-7"
    assert gallery_page_url("win10spotlight", 1) == "https://windows10spotlight.com/"
    assert gallery_page_url("win10spotlight", 7) == "https://windows10spotlight.com/page/7"
    with pytest.raises(ValueError):
        gallery_page_url("nope", 1)


# ── Network behaviour (fake site) ──────────────────────────────────────────


def test_fetch_html_permanent_vs_transient(site, monkeypatch):
    monkeypatch.setattr(scrapers.random, "uniform", lambda *_: 0.0)

    async def go(session):
        page = await fetch_html(session, site.base + "/spotlight", retries=1)
        assert page and "Peapix Wonder 1" in page
        assert await fetch_html(session, site.base + "/spotlight/page-99") is None   # 404 → permanent
        site.flaky["/spotlight"] = 1                                                  # one 503 then OK
        assert await fetch_html(session, site.base + "/spotlight", retries=2) is not None
        site.outage = True
        with pytest.raises(ScrapeError):
            await fetch_html(session, site.base + "/spotlight", retries=1)           # transient → raise
        site.outage = False

    monkeypatch.setattr(asyncio, "sleep", _fast_sleep())
    run(go)


def _fast_sleep():
    real = asyncio.sleep

    async def fast(delay, *args, **kwargs):
        await real(0)

    return fast


@pytest.mark.parametrize("hint", [1, 2, 3, 50])
def test_discover_total_pages_corrects_any_hint(site, hint):
    async def go(session):
        return (
            await discover_total_pages(session, "peapix", hint),
            await discover_total_pages(session, "win10spotlight", hint),
        )

    peapix, win10 = run(go)
    assert peapix == site.peapix_pages() == 2
    assert win10 == site.win10_pages() == 2


def test_discover_finds_growth_beyond_the_advertised_count(site):
    site.peapix_items += [site.peapix_items[0].__class__(900 + i, f"New {i}", ["x"], "2026-09-01") for i in range(20)]

    async def go(session):
        return await discover_total_pages(session, "peapix", 2)

    assert run(go) == site.peapix_pages() == 7


def test_discover_falls_back_to_hint_on_trouble(site, monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", _fast_sleep())
    monkeypatch.setattr(scrapers.random, "uniform", lambda *_: 0.0)

    async def go(session):
        site.outage = True
        down = await discover_total_pages(session, "peapix", 17)
        site.outage = False
        site.repeat_last = True          # site serves its last page for ANY page number
        endless = await discover_total_pages(session, "win10spotlight", 5)
        return down, endless

    down, endless = run(go)
    assert down == 17           # unreachable → configuration hint
    assert endless == 5         # implausible growth → configuration hint


def test_fetch_win10_post_title_never_raises(site, monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", _fast_sleep())

    async def go(session):
        item = site.win10_items[0]
        ok = await scrapers.fetch_win10_post_title(session, f"{site.base}/images/{5000 + item.seed}")
        missing = await scrapers.fetch_win10_post_title(session, f"{site.base}/images/1")
        site.outage = True
        down = await scrapers.fetch_win10_post_title(session, f"{site.base}/images/{5000 + item.seed}")
        return ok, missing, down

    ok, missing, down = run(go)
    assert ok == site.win10_items[0].title and missing == "" and down == ""


def test_scrape_pages_end_to_end(site):
    async def go(session):
        px = await scrapers.scrape_peapix_gallery_page(session, gallery_page_url("peapix", 1))
        w10 = await scrapers.scrape_win10spotlight_page(session, gallery_page_url("win10spotlight", 1))
        gone = await scrapers.scrape_peapix_gallery_page(session, gallery_page_url("peapix", 99))
        return px, w10, gone

    px, w10, gone = run(go)
    assert len(px) == 4 and px[0]["title"] == "Peapix Wonder 1" and px[0]["tags"] == "lake,nature"
    assert px[0]["date_spotted"] == "2026-09-01"
    assert len(w10) == 3 and gone == []
    assert any(i["needs_title"] for i in w10) and any(not i["needs_title"] for i in w10)
