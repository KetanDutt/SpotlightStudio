"""
scrapers.py – async page scrapers for peapix.com and windows10spotlight.com.

Each scraper function accepts an aiohttp.ClientSession + page URL and returns
a list of ImageCandidate dicts ready to be inserted into the download queue.

Scraping strategy
-----------------
Peapix:
  Gallery pages list image cards.  Each card has:
    • <a href="/spotlight/<id>">  — the image-anchor that wraps the <img>
    • A sibling <a class="text-body …">  — the title link (same href)
    • Sibling <a href="/spotlight/tags/…"> elements — tag links
    • A sibling <span class="text-body-tertiary …"> — the date

  We match on <img data-src="…img.peapix.com…"> to find cards reliably,
  then navigate up/across the DOM to collect metadata.  The UHD URL is
  derived from the thumbnail hash.

Windows10Spotlight:
  Each <article class="post"> contains srcset with sizes up to 1920 px.
  We pick the largest declared width.  Tags come from the article's CSS
  class list (class="… tag-landscape tag-sky …").
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

import asyncio
import aiohttp
from bs4 import BeautifulSoup, Tag

from src.config import settings

log = logging.getLogger("scrapers")

# ── helpers ──────────────────────────────────────────────────────────────────


async def _fetch_html(
    session: aiohttp.ClientSession,
    url: str,
    retries: int = 2,
) -> str | None:
    """GET a page, returning HTML text or None on permanent failure."""
    for attempt in range(retries + 1):
        try:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.text(errors="replace")
                if resp.status in (404, 403, 410):
                    log.debug("Permanent HTTP %d for %s", resp.status, url)
                    return None
                # Transient error — retry
                log.debug("HTTP %d for %s (attempt %d)", resp.status, url, attempt)
        except Exception as exc:
            log.debug("Fetch error %s (attempt %d): %s", url, attempt, exc)
        if attempt < retries:
            await asyncio.sleep(0.5 * (attempt + 1))  # exponential backoff
    return None


def _peapix_hash_to_urls(hash32: str) -> tuple[str, str]:
    """Return (uhd_url, thumb_url) for a 32-char peapix image hash."""
    base = f"https://img.peapix.com/{hash32}"
    return f"{base}_UHD.jpg", f"{base}_640.jpg"


# ── Peapix gallery scraper ────────────────────────────────────────────────────


async def scrape_peapix_gallery_page(
    session: aiohttp.ClientSession, url: str
) -> list[dict]:
    """
    Scrape one Peapix Spotlight gallery page.

    HTML structure (simplified):
        <div class="col-...">                          ← card wrapper
          <a href="/spotlight/12696">                  ← image anchor
            <img data-src="…peapix.com/HASH_640.jpg"> ← lazy-loaded thumb
          </a>
          <div>                                        ← overlay div
            <a href="/spotlight/tags/sky">sky</a>
            …
          </div>
          <div>
            <a class="text-body … text-truncate" href="/spotlight/12696">
              Symphony of the Stones, Garni Gorge, Armenia
            </a>
            <span class="text-body-tertiary …">September 19, 2026</span>
          </div>
        </div>

    We anchor on <img data-src="…img.peapix.com…"> to avoid picking up
    navigation links that also match `a[href^='/spotlight/']`.
    """
    html = await _fetch_html(session, url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []
    seen_hashes: set[str] = set()

    for img_tag in soup.find_all("img", attrs={"data-src": re.compile(r"img\.peapix\.com")}):
        data_src: str = img_tag.get("data-src", "")

        # Extract 32-char hex hash from the thumbnail URL
        m = re.search(r"/([a-f0-9]{32})_", data_src)
        if not m:
            continue
        img_hash = m.group(1)
        if img_hash in seen_hashes:
            continue
        seen_hashes.add(img_hash)

        image_url, _ = _peapix_hash_to_urls(img_hash)

        # Walk up to the card's column wrapper
        card_col = img_tag.parent  # <a> image anchor
        card_href = card_col.get("href", "") if isinstance(card_col, Tag) else ""
        # Normalise: /spotlight/12696
        if not re.fullmatch(r"/spotlight/\d+", card_href):
            # Try parent
            card_col = card_col.parent if card_col else None
            card_href = card_col.get("href", "") if isinstance(card_col, Tag) else ""

        page_url = urljoin("https://peapix.com", card_href) if card_href else ""
        spotlight_id = card_href.split("/")[-1] if card_href else ""

        # The column wrapper is two levels up from the <img>
        # img → <a> → col-div (or similar bootstrap col wrapper)
        wrapper = img_tag
        for _ in range(4):          # walk up at most 4 levels
            wrapper = wrapper.parent
            if wrapper is None:
                break
            # The wrapper contains the title <a> with the same spotlight id
            title_a = wrapper.find(
                "a",
                href=f"/spotlight/{spotlight_id}",
                class_=re.compile(r"text-body"),
            ) if spotlight_id else None
            if title_a:
                break

        title = ""
        date_spotted = ""
        tags = ""

        if wrapper and spotlight_id:
            # Title
            title_a = wrapper.find(
                "a", href=f"/spotlight/{spotlight_id}", class_=re.compile(r"text-body")
            )
            if title_a:
                title = title_a.get_text(strip=True)

            # Date — span with 'tertiary' in class
            date_el = wrapper.find(
                "span", class_=lambda c: c and "tertiary" in " ".join(c)
            )
            if date_el:
                date_spotted = date_el.get_text(strip=True)

            # Tags — sibling links to /spotlight/tags/
            tag_els = wrapper.find_all("a", href=re.compile(r"/spotlight/tags/"))
            tags = ",".join(t.get_text(strip=True) for t in tag_els)

        # Fallback title from img alt
        if not title:
            title = img_tag.get("alt", "").strip() or "Windows Spotlight Wallpaper"

        results.append({
            "image_url": image_url,
            "page_url": page_url,
            "title": title,
            "source": "peapix",
            "tags": tags,
            "date_spotted": date_spotted,
        })

    log.debug("peapix gallery %s → %d items", url, len(results))
    return results


# ── Windows 10 Spotlight scraper ──────────────────────────────────────────────


async def scrape_win10spotlight_page(
    session: aiohttp.ClientSession, url: str
) -> list[dict]:
    """
    Scrape one gallery page of windows10spotlight.com.

    Article structure:
        <article class="post-… tag-sky tag-landscape …">
          <h2><a href="https://windows10spotlight.com/images/42125"> </a></h2>
          <span class="entry-title hidden">Turquoise Spirit Island…</span>
          <aside class="meta"><span class="date">2026-09-29</span></aside>
          <img srcset="…-1024x576.jpg 1024w, …-300x169.jpg 300w, ….jpg 1920w"
               src="…-1024x576.jpg" …>
        </article>
    """
    html = await _fetch_html(session, url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    for article in soup.select("article.post"):
        # ── page URL ──────────────────────────────────────────────────
        h2_a = article.select_one("h2 a")
        page_url = h2_a.get("href", "").strip() if h2_a else ""

        # ── title ─────────────────────────────────────────────────────
        title_el = article.select_one(".entry-title")
        title = title_el.get_text(strip=True) if title_el else ""
        if not title and h2_a:
            title = h2_a.get_text(strip=True)
        title = title or "Windows Spotlight Wallpaper"

        # ── date ──────────────────────────────────────────────────────
        date_el = article.select_one("span.date")
        date_spotted = date_el.get_text(strip=True) if date_el else ""

        # ── tags (from article CSS classes) ──────────────────────────
        classes = article.get("class", [])
        raw_tags = [
            cls[4:].replace("-", " ")   # strip "tag-" prefix
            for cls in classes
            if cls.startswith("tag-")
        ]
        tags = ",".join(raw_tags)

        # ── image URL (highest resolution from srcset) ────────────────
        img = article.select_one("img.thumbnail, img.wp-post-image")
        if not img:
            continue

        image_url: str | None = None
        srcset = img.get("srcset", "")
        if srcset:
            best_w, best_url = 0, ""
            for entry in srcset.split(","):
                parts = entry.strip().split()
                if len(parts) >= 2:
                    try:
                        w = int(parts[1].rstrip("w"))
                    except ValueError:
                        w = 0
                    if w > best_w:
                        best_w, best_url = w, parts[0]
            image_url = best_url or None

        if not image_url:
            # Fallback: strip size suffix from plain src (e.g. -1024x576)
            src = img.get("src", "")
            image_url = re.sub(r"-\d+x\d+(?=\.\w+$)", "", src) if src else None

        if image_url:
            results.append({
                "image_url": image_url,
                "page_url": page_url,
                "title": title,
                "source": "win10spotlight",
                "tags": tags,
                "date_spotted": date_spotted,
            })

    log.debug("win10 %s → %d items", url, len(results))
    return results
