"""
scrapers.py – async page scrapers for peapix.com and windows10spotlight.com.

Every scraper turns one gallery page into a list of *candidate* dicts ready for
the download queue::

    {"image_url", "page_url", "title", "source", "tags", "date_spotted"}

The module is split into **pure parsers** (``parse_*`` – HTML in, data out, unit
tested with fixtures) and thin **network wrappers** (``scrape_*`` / ``fetch_*``).

Why the parsers are structure-agnostic
--------------------------------------
The original Peapix scraper walked the DOM using Bootstrap class names
(``text-body``…).  When the site changed its markup it silently kept working for
the *image* but lost every title and tag (895 of 896 stored Peapix rows had the
generic title and no tags).  The parsers below therefore rely on **content
patterns** instead of class names:

* Peapix – a card is "the largest ancestor of a gallery ``<img>`` that contains
  no other gallery image"; the title is the text of the link to the same
  ``/spotlight/<id>`` page, tags are links to ``/spotlight/tags/…``, and the date
  is whatever matches ``Month D, YYYY`` inside the card.
* Windows10Spotlight – ``<article>`` blocks; tags come from ``tag-*`` CSS classes
  (WordPress), the image is the widest entry of ``srcset``.  The listing shows the
  *file hash* as title for most posts – the real title only exists on the post
  page, see :func:`parse_win10_post_title`.

Error model
-----------
``fetch_html`` returns ``None`` for *permanent* failures (404/403/410 – e.g. a page
beyond the last one) and raises :class:`ScrapeError` for *transient* ones
(timeouts, 5xx, 429) so the engine can retry the page later instead of silently
dropping its wallpapers.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
from urllib.parse import unquote, urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup, Tag

from src.config import settings
from src.utils import (
    DEFAULT_TITLE,
    is_placeholder_title,
    normalize_date,
    normalize_tags,
)

log = logging.getLogger("scrapers")

SOURCE_PEAPIX = "peapix"
SOURCE_WIN10 = "win10spotlight"
SOURCES = (SOURCE_PEAPIX, SOURCE_WIN10)


class ScrapeError(Exception):
    """A *transient* scraping failure (network error, 5xx, 429) – retry later."""


# ══════════════════════════════════════════════════════════════════════════
# URLs
# ══════════════════════════════════════════════════════════════════════════


def gallery_page_url(source: str, page: int) -> str:
    """URL of gallery page ``page`` (1-based) of ``source``."""
    if source == SOURCE_PEAPIX:
        base = f"{settings.PEAPIX_BASE_URL}/spotlight"
        return base if page <= 1 else f"{base}/page-{page}"
    if source == SOURCE_WIN10:
        base = settings.WIN10_BASE_URL
        return f"{base}/" if page <= 1 else f"{base}/page/{page}"
    raise ValueError(f"Unknown source: {source!r}")


def peapix_image_url(hash32: str, variant: str = "UHD") -> str:
    """Peapix image URL for a 32-char hash (``UHD``, ``1920``, ``1280`` or ``640``)."""
    return f"{settings.PEAPIX_IMAGE_BASE_URL}/{hash32}_{variant}.jpg"


# ══════════════════════════════════════════════════════════════════════════
# Network helpers
# ══════════════════════════════════════════════════════════════════════════

_PERMANENT_STATUSES = frozenset({404, 403, 410})
_BACKOFF_BASE = 0.5  # seconds; doubled per attempt (tests shrink it)


async def fetch_html(session: aiohttp.ClientSession, url: str, retries: int = 2) -> str | None:
    """
    GET ``url`` and return the HTML text.

    * ``None``  – permanent failure (404 / 403 / 410).
    * raises :class:`ScrapeError` – still failing after ``retries`` retries.
    """
    last_problem = "unknown error"
    for attempt in range(retries + 1):
        retry_after = 0.0
        try:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.text(errors="replace")
                if resp.status in _PERMANENT_STATUSES:
                    log.debug("Permanent HTTP %d for %s", resp.status, url)
                    return None
                last_problem = f"HTTP {resp.status}"
                header = resp.headers.get("Retry-After", "")
                if header.isdigit():
                    retry_after = min(float(header), 30.0)
        except asyncio.CancelledError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            last_problem = f"{type(exc).__name__}: {exc}"
        log.debug("Fetch problem for %s (attempt %d): %s", url, attempt + 1, last_problem)
        if attempt < retries:
            backoff = max(retry_after, _BACKOFF_BASE * (2**attempt)) + random.uniform(0, _BACKOFF_BASE / 2)
            await asyncio.sleep(backoff)
    raise ScrapeError(f"{url}: {last_problem}")


# ══════════════════════════════════════════════════════════════════════════
# Peapix
# ══════════════════════════════════════════════════════════════════════════

_PEAPIX_HASH = re.compile(r"/([a-f0-9]{32})_(?:UHD|\d{3,4})\.(?:jpe?g|webp|png)", re.IGNORECASE)
_SPOTLIGHT_ID = re.compile(r"/spotlight/(\d+)/?$")
_PEAPIX_PAGE_OF = re.compile(r"Page\s+\d+\s+of\s+(\d+)", re.IGNORECASE)
_PEAPIX_PAGE_LINK = re.compile(r"/spotlight/page-(\d+)")
_DATE_IN_TEXT = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
    r"Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+"
    r"\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b"
)
_IMG_URL_ATTRS = ("data-src", "data-lazy-src", "data-original", "src", "data-srcset", "srcset")
#: Containers that are too coarse to be a single card.
_CARD_STOP_TAGS = frozenset(
    {"body", "html", "main", "section", "nav", "header", "footer", "aside", "ul", "ol", "[document]"}
)


def _img_hashes(img: Tag) -> set[str]:
    found: set[str] = set()
    for attr in _IMG_URL_ATTRS:
        value = img.get(attr)
        if isinstance(value, str):
            found.update(h.lower() for h in _PEAPIX_HASH.findall(value))
    return found


def _spotlight_id(href: str | None) -> str | None:
    if not href:
        return None
    match = _SPOTLIGHT_ID.search(urlparse(href).path)
    return match.group(1) if match else None


def _card_container(img: Tag) -> Tag:
    """Largest ancestor of ``img`` that holds no *other* gallery image."""
    best: Tag = img.parent if isinstance(img.parent, Tag) else img
    node: Tag = img
    for _ in range(7):
        parent = node.parent
        if not isinstance(parent, Tag) or parent.name in _CARD_STOP_TAGS:
            break
        hashes: set[str] = set()
        for other in parent.find_all("img"):
            hashes |= _img_hashes(other)
        if len(hashes) > 1:
            break
        best = node = parent
    return best


def parse_peapix_page(html: str) -> list[dict]:
    """Parse one Peapix Spotlight gallery page into candidate dicts."""
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []
    seen: set[str] = set()

    for img in soup.find_all("img"):
        hashes = _img_hashes(img)
        if len(hashes) != 1:
            continue
        img_hash = next(iter(hashes))
        if img_hash in seen:
            continue
        seen.add(img_hash)

        card = _card_container(img)

        # ── page URL / id ──────────────────────────────────────────────
        anchor = img.find_parent("a")
        spotlight_id = _spotlight_id(anchor.get("href") if anchor else None)
        if spotlight_id is None:
            for link in card.find_all("a", href=True):
                spotlight_id = _spotlight_id(link["href"])
                if spotlight_id:
                    break
        page_url = f"{settings.PEAPIX_BASE_URL}/spotlight/{spotlight_id}" if spotlight_id else ""

        # ── title: text of the link(s) to the same page that wrap no image ──
        title = ""
        if spotlight_id:
            for link in card.find_all("a", href=True):
                if _spotlight_id(link["href"]) != spotlight_id or link.find("img"):
                    continue
                text = link.get_text(" ", strip=True)
                if len(text) > len(title):
                    title = text
        if not title:
            heading = card.find(["h1", "h2", "h3", "h4", "h5", "h6"])
            if heading:
                title = heading.get_text(" ", strip=True)
        if not title:
            title = (img.get("alt") or "").strip()
        if is_placeholder_title(title):
            title = ""

        # ── tags ───────────────────────────────────────────────────────
        tag_names: list[str] = []
        for link in card.find_all("a", href=re.compile(r"/spotlight/tags/")):
            name = link.get_text(" ", strip=True)
            if not name:
                name = unquote(urlparse(link["href"]).path.rsplit("/", 1)[-1])
            tag_names.append(name)

        # ── date ───────────────────────────────────────────────────────
        date_spotted = ""
        time_el = card.find("time")
        if time_el:
            date_spotted = normalize_date(time_el.get("datetime") or time_el.get_text(strip=True))
        if not date_spotted:
            match = _DATE_IN_TEXT.search(card.get_text(" ", strip=True))
            if match:
                date_spotted = normalize_date(match.group(0))

        results.append(
            {
                "image_url": peapix_image_url(img_hash),
                "page_url": page_url,
                "title": title,
                "source": SOURCE_PEAPIX,
                "tags": normalize_tags(tag_names),
                "date_spotted": date_spotted,
            }
        )

    log.debug("peapix page → %d items", len(results))
    return results


def detect_peapix_total_pages(html: str) -> int | None:
    """Total number of gallery pages, from ``Page 1 of 30`` or the pagination links."""
    if m := _PEAPIX_PAGE_OF.search(BeautifulSoup(html, "html.parser").get_text(" ", strip=True)):
        return int(m.group(1))
    numbers = [int(n) for n in _PEAPIX_PAGE_LINK.findall(html)]
    return max(numbers) if numbers else None


async def scrape_peapix_gallery_page(session: aiohttp.ClientSession, url: str) -> list[dict]:
    html = await fetch_html(session, url)
    if not html:
        return []
    return await asyncio.to_thread(parse_peapix_page, html)


# ══════════════════════════════════════════════════════════════════════════
# Windows10Spotlight
# ══════════════════════════════════════════════════════════════════════════

_SRCSET_ENTRY = re.compile(r"(\S+)\s+(\d+)w")
_WIN10_PAGE_LINK = re.compile(r"/page/(\d+)")
_SIZE_SUFFIX = re.compile(r"-\d+x\d+(?=\.\w+$)")
_SITE_SUFFIX = re.compile(r"\s*[|\-–—]\s*Windows Spotlight(?: Images)?\s*$", re.IGNORECASE)


def _best_srcset_url(srcset: str, base: str) -> str:
    """Widest candidate of a ``srcset`` attribute (commas inside URLs are tolerated)."""
    best_width, best_url = 0, ""
    for url, width in _SRCSET_ENTRY.findall(srcset):
        if int(width) > best_width:
            best_width, best_url = int(width), url
    return urljoin(base, best_url) if best_url else ""


def parse_win10_page(html: str, base_url: str | None = None) -> list[dict]:
    """
    Parse one Windows10Spotlight gallery page.

    ``title`` is returned **empty** when the listing only shows the file hash;
    the engine then fetches the post page (see :func:`parse_win10_post_title`).
    """
    base = base_url or settings.WIN10_BASE_URL + "/"
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    articles = soup.select("article.post") or soup.find_all("article")
    for article in articles:
        # ── page URL ───────────────────────────────────────────────────
        link = article.select_one("h2 a[href]") or article.find("a", href=re.compile(r"/images/\d+"))
        page_url = urljoin(base, link["href"].strip()) if link else ""

        # ── title ──────────────────────────────────────────────────────
        title_el = article.select_one(".entry-title")
        title = title_el.get_text(" ", strip=True) if title_el else ""
        if not title and link:
            title = link.get_text(" ", strip=True)
        needs_title = is_placeholder_title(title)
        if needs_title:
            title = ""

        # ── date ───────────────────────────────────────────────────────
        date_el = article.select_one("span.date, time")
        date_spotted = ""
        if date_el:
            date_spotted = normalize_date(date_el.get("datetime") or date_el.get_text(strip=True))

        # ── tags (WordPress adds one ``tag-<slug>`` class per tag) ──────
        raw_tags = [
            cls[4:].replace("-", " ") for cls in (article.get("class") or []) if cls.startswith("tag-")
        ]

        # ── image: widest srcset entry, else strip the -WxH size suffix ──
        img = article.select_one("img.thumbnail, img.wp-post-image") or article.find("img")
        if not img:
            continue
        image_url = _best_srcset_url(img.get("srcset", ""), base)
        if not image_url:
            src = img.get("src") or img.get("data-src") or ""
            image_url = urljoin(base, _SIZE_SUFFIX.sub("", src)) if src else ""
        if not image_url:
            continue

        results.append(
            {
                "image_url": image_url,
                "page_url": page_url,
                "title": title,
                "source": SOURCE_WIN10,
                "tags": normalize_tags(raw_tags),
                "date_spotted": date_spotted,
                "needs_title": needs_title and bool(page_url),
            }
        )

    log.debug("win10 page → %d items", len(results))
    return results


def parse_win10_post_title(html: str) -> str:
    """
    Extract the real title from a Windows10Spotlight *post* page.

    Preference order: ``<h1>`` → ``og:title`` → ``<title>`` (site suffix stripped).
    Returns ``""`` when only placeholders are found.
    """
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[str] = []
    h1 = soup.select_one("article h1, main h1, h1.entry-title") or soup.find("h1")
    if h1:
        candidates.append(h1.get_text(" ", strip=True))
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        candidates.append(str(og["content"]))
    if soup.title and soup.title.string:
        candidates.append(soup.title.string)
    for raw in candidates:
        text = _SITE_SUFFIX.sub("", raw).strip()
        if text and not is_placeholder_title(text):
            return text
    return ""


def detect_win10_total_pages(html: str) -> int | None:
    """Highest ``/page/N`` pagination link visible on a gallery page."""
    numbers = [int(n) for n in _WIN10_PAGE_LINK.findall(html)]
    return max(numbers) if numbers else None


async def scrape_win10spotlight_page(session: aiohttp.ClientSession, url: str) -> list[dict]:
    html = await fetch_html(session, url)
    if not html:
        return []
    return await asyncio.to_thread(parse_win10_page, html, url)


async def fetch_win10_post_title(session: aiohttp.ClientSession, page_url: str) -> str:
    """Real title of a post (``""`` if unavailable – never raises for network errors)."""
    try:
        html = await fetch_html(session, page_url, retries=1)
    except ScrapeError:
        return ""
    if not html:
        return ""
    return await asyncio.to_thread(parse_win10_post_title, html)


# ══════════════════════════════════════════════════════════════════════════
# Dispatch helpers & page-count discovery
# ══════════════════════════════════════════════════════════════════════════


async def scrape_gallery_page(session: aiohttp.ClientSession, source: str, url: str) -> list[dict]:
    """Scrape one gallery page of ``source`` (raises :class:`ScrapeError` when transient)."""
    if source == SOURCE_PEAPIX:
        return await scrape_peapix_gallery_page(session, url)
    if source == SOURCE_WIN10:
        return await scrape_win10spotlight_page(session, url)
    raise ValueError(f"Unknown source: {source!r}")


def fallback_title(item: dict) -> str:
    """Title stored when nothing better is known."""
    return (item.get("title") or "").strip() or DEFAULT_TITLE


async def _page_has_items(session: aiohttp.ClientSession, source: str, page: int) -> bool | None:
    """True/False whether ``page`` exists and lists wallpapers; ``None`` on transient errors."""
    try:
        items = await scrape_gallery_page(session, source, gallery_page_url(source, page))
    except ScrapeError:
        return None
    return bool(items)


async def discover_total_pages(session: aiohttp.ClientSession, source: str, hint: int) -> int:
    """
    Find the real number of gallery pages of ``source``.

    The sites grow every day (Windows10Spotlight already had a page 1320 while the
    configuration said 1319, so its oldest wallpaper was silently skipped).

    1. read the pagination markers of page 1 (``Page 1 of 30`` / ``/page/1320``);
    2. verify the boundary by probing (gallop upwards, then binary search);
    3. on *any* trouble – network errors, a dead page 1, an implausible result such
       as a site that serves its last page for every out-of-range number – fall back
       to the best number known so far (``max(hint, marker)``).  Discovery must never
       be able to sabotage a crawl.
    """
    ceiling = max(hint * 2, hint + 100)  # anything beyond this is not believable
    try:
        first = await fetch_html(session, gallery_page_url(source, 1))
    except ScrapeError:
        return hint
    if not first:
        return hint  # site unreachable / blocked: do not draw conclusions
    detected = (
        detect_peapix_total_pages(first) if source == SOURCE_PEAPIX else detect_win10_total_pages(first)
    )
    fallback = min(max(hint, detected or 0), ceiling)
    guess = min(max(detected or hint, 1), ceiling)

    probes = 0

    async def exists(page: int) -> bool | None:
        nonlocal probes
        probes += 1
        return await _page_has_items(session, source, page)

    try:
        ok = await exists(guess)
        if ok is None:
            return fallback
        if ok:
            low, step = guess, 1
            while probes < 24 and low < ceiling:
                nxt = await exists(low + step)
                if nxt is None:
                    return max(low, fallback)
                if not nxt:
                    break
                low += step
                step *= 2
            else:
                log.warning("Page discovery for %s looks unreliable – using %d.", source, fallback)
                return fallback
            high = low + step  # first page known to be missing
        else:
            low, high = 0, guess  # `high` is known to be missing
        while high - low > 1 and probes < 40:
            mid = (low + high) // 2
            res = await exists(mid)
            if res is None:
                return max(low, fallback)
            if res:
                low = mid
            else:
                high = mid
        if low < 1:
            return fallback  # nothing exists at all → trust the configuration instead
        total = low
    except ScrapeError:
        return fallback
    log.info("Discovered %d gallery pages for %s (%d probes, hint %d).", total, source, probes, hint)
    return total
