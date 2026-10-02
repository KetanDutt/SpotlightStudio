"""
fake_site.py – a local stand-in for peapix.com and windows10spotlight.com.

It serves Peapix-style gallery pages, Windows10Spotlight-style listings and post
pages, and **deterministic synthetic images**, so the whole crawl pipeline can be
tested offline.  Failure injection (missing UHD variants, flaky 503s, outages,
corrupt bodies) and per-path hit counters allow assertions about *how* the engine
behaves, not just what it stores.

Run inside a background thread via :class:`FakeSiteThread`.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import random
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from aiohttp import web
from PIL import Image, ImageDraw, ImageFilter


def make_picture(seed: int, width: int = 640, height: int = 360) -> bytes:
    """Deterministic JPEG whose *content* depends only on ``seed`` (not on size)."""
    rnd = random.Random(seed)
    base = Image.new("RGB", (1280, 720), tuple(rnd.randrange(30, 220) for _ in range(3)))
    draw = ImageDraw.Draw(base)
    for _ in range(30):
        x0, y0 = rnd.randrange(1280), rnd.randrange(720)
        x1, y1 = x0 + rnd.randrange(40, 500), y0 + rnd.randrange(40, 300)
        color = tuple(rnd.randrange(256) for _ in range(3))
        (draw.ellipse if rnd.random() < 0.5 else draw.rectangle)([x0, y0, x1, y1], fill=color)
    base = base.filter(ImageFilter.GaussianBlur(2))
    img = base.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def hash32(seed: int) -> str:
    return hashlib.md5(f"peapix-{seed}".encode()).hexdigest()


@dataclass
class Item:
    seed: int
    title: str
    tags: list[str]
    date: str


@dataclass
class FakeSite:
    peapix_items: list[Item] = field(default_factory=list)
    win10_items: list[Item] = field(default_factory=list)
    peapix_per_page: int = 4
    win10_per_page: int = 3
    hits: Counter = field(default_factory=Counter)
    missing_uhd: set[int] = field(default_factory=set)       # seeds whose _UHD.jpg is 404
    flaky: defaultdict = field(default_factory=lambda: defaultdict(int))  # path -> remaining 503s
    outage: bool = False                                      # everything answers 503
    corrupt: set[int] = field(default_factory=set)           # seeds served as garbage bytes
    slow: float = 0.0                                         # artificial image latency (s)
    page_delay: float = 0.0                                   # artificial gallery-page latency (s)
    hash_titles: bool = True                                  # win10 listing shows hash as title
    peapix_markup: str = "A"
    repeat_last: bool = False                                 # out-of-range pages serve the last page
    port: int = 0

    # ── helpers ───────────────────────────────────────────────────────────
    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def peapix_pages(self) -> int:
        return max(1, -(-len(self.peapix_items) // self.peapix_per_page))

    def win10_pages(self) -> int:
        return max(1, -(-len(self.win10_items) // self.win10_per_page))

    def win10_image_name(self, item: Item) -> str:
        return hashlib.md5(f"win10-{item.seed}".encode()).hexdigest()

    # ── routes ────────────────────────────────────────────────────────────
    def _guard(self, request: web.Request) -> web.Response | None:
        self.hits[request.path] += 1
        if self.outage:
            return web.Response(status=503, text="down")
        if self.flaky[request.path] > 0:
            self.flaky[request.path] -= 1
            return web.Response(status=503, text="try later")
        return None

    async def peapix_page(self, request: web.Request) -> web.Response:
        if (resp := self._guard(request)):
            return resp
        if self.page_delay:
            await asyncio.sleep(self.page_delay)
        n = int(request.match_info.get("n", "1"))
        total = self.peapix_pages()
        if n > total and self.repeat_last:
            n = total
        if n < 1 or n > total:
            return web.Response(status=404, text="no such page")
        chunk = self.peapix_items[(n - 1) * self.peapix_per_page : n * self.peapix_per_page]
        cards = []
        for item in chunk:
            h, sid = hash32(item.seed), 1000 + item.seed
            tag_links = "".join(
                f'<a href="/spotlight/tags/{t}">{t}</a>' for t in item.tags
            )
            months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
            y, m, d = item.date.split("-")
            pretty = f"{months[int(m)-1]} {int(d)}, {y}"
            if self.peapix_markup == "B":
                cards.append(
                    f'<div class="card"><a href="{self.base}/spotlight/{sid}"><img src="{self.base}/img/{h}_640.jpg" alt="Windows Spotlight"></a>'
                    f'<h5><a href="{self.base}/spotlight/{sid}">{item.title}</a></h5><time datetime="{item.date}">{pretty}</time>{tag_links}</div>'
                )
            else:
                cards.append(
                    f'<div class="col"><div class="card"><a href="/spotlight/{sid}"><img data-src="{self.base}/img/{h}_640.jpg" alt="Windows Spotlight"></a>'
                    f'<div class="overlay">{tag_links}</div><div class="body"><a class="text-body" href="/spotlight/{sid}">{item.title}</a>'
                    f'<span class="text-body-tertiary">{pretty}</span></div></div></div>'
                )
        html = (
            "<html><head><title>Spotlight Wallpaper Gallery</title></head><body><nav><a href='/spotlight/tags/popular'>popular</a></nav>"
            f"<h1>Spotlight Gallery</h1><p>Page {n} of {total}</p><div class='row'>{''.join(cards)}</div></body></html>"
        )
        return web.Response(text=html, content_type="text/html")

    async def peapix_image(self, request: web.Request) -> web.Response:
        if (resp := self._guard(request)):
            return resp
        name = request.match_info["name"]  # <hash>_<variant>.jpg
        stem, variant = name.rsplit(".", 1)[0].rsplit("_", 1)
        seed = next((i.seed for i in self.peapix_items if hash32(i.seed) == stem), None)
        if seed is None:
            return web.Response(status=404)
        if variant == "UHD" and seed in self.missing_uhd:
            return web.Response(status=404)
        if seed in self.corrupt:
            return web.Response(body=b"not an image" * 1000, content_type="image/jpeg")
        sizes = {"UHD": (1280, 720), "1920": (960, 540), "1280": (800, 450), "640": (640, 360)}
        w, h = sizes.get(variant, (640, 360))
        if self.slow:
            await asyncio.sleep(self.slow)
        return web.Response(body=make_picture(seed, w, h), content_type="image/jpeg")

    async def win10_page(self, request: web.Request) -> web.Response:
        if (resp := self._guard(request)):
            return resp
        if self.page_delay:
            await asyncio.sleep(self.page_delay)
        n = int(request.match_info.get("n", "1"))
        total = self.win10_pages()
        if n > total and self.repeat_last:
            n = total
        if n < 1 or n > total:
            return web.Response(status=404, text="not found")
        chunk = self.win10_items[(n - 1) * self.win10_per_page : n * self.win10_per_page]
        arts = []
        for item in chunk:
            name = self.win10_image_name(item)
            tag_cls = " ".join("tag-" + t.replace(" ", "-") for t in item.tags)
            shown = name if self.hash_titles and item.seed % 2 == 0 else item.title
            pid = 5000 + item.seed
            arts.append(
                f'<article class="post-{pid} post {tag_cls}"><h2><a href="{self.base}/images/{pid}"> </a></h2>'
                f'<span class="entry-title hidden">{shown}</span><aside class="meta"><span class="date">{item.date}</span></aside>'
                f'<img class="thumbnail wp-post-image" srcset="{self.base}/wp/{name}-1024x576.jpg 1024w, {self.base}/wp/{name}-300x169.jpg 300w, {self.base}/wp/{name}.jpg 1920w" '
                f'src="{self.base}/wp/{name}-1024x576.jpg"></article>'
            )
        pager = "".join(f'<a href="{self.base}/page/{p}">{p}</a>' for p in (2, total) if p <= total)
        html = f"<html><body><div id='posts'>{''.join(arts)}</div><nav>{pager}</nav></body></html>"
        return web.Response(text=html, content_type="text/html")

    async def win10_post(self, request: web.Request) -> web.Response:
        if (resp := self._guard(request)):
            return resp
        pid = int(request.match_info["pid"])
        item = next((i for i in self.win10_items if 5000 + i.seed == pid), None)
        if item is None:
            return web.Response(status=404)
        html = (
            f"<html><head><title>{item.title} | Windows Spotlight Images</title></head><body>"
            f"<header><h1><a href='/'>Windows Spotlight Images</a></h1></header><article><h1>{item.title}</h1></article></body></html>"
        )
        return web.Response(text=html, content_type="text/html")

    async def win10_image(self, request: web.Request) -> web.Response:
        if (resp := self._guard(request)):
            return resp
        name = request.match_info["name"].rsplit(".", 1)[0]
        base_name = name.split("-")[0]
        item = next((i for i in self.win10_items if self.win10_image_name(i) == base_name), None)
        if item is None:
            return web.Response(status=404)
        if self.slow:
            await asyncio.sleep(self.slow)
        return web.Response(body=make_picture(item.seed, 640, 360), content_type="image/jpeg")

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/spotlight", self.peapix_page)
        app.router.add_get("/spotlight/page-{n:\\d+}", self.peapix_page)
        app.router.add_get("/img/{name}", self.peapix_image)
        app.router.add_get("/", self.win10_page)
        app.router.add_get("/page/{n:\\d+}", self.win10_page)
        app.router.add_get("/images/{pid:\\d+}", self.win10_post)
        app.router.add_get("/wp/{name}", self.win10_image)
        return app


class FakeSiteThread:
    """Runs a :class:`FakeSite` on its own event loop in a daemon thread."""

    def __init__(self, site: FakeSite) -> None:
        self.site = site
        self._loop: asyncio.AbstractEventLoop | None = None
        self._runner: web.AppRunner | None = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="fake-site")

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        async def boot() -> None:
            self._runner = web.AppRunner(self.site.app())
            await self._runner.setup()
            tcp = web.TCPSite(self._runner, "127.0.0.1", 0)
            await tcp.start()
            self.site.port = tcp._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
            self._ready.set()

        loop.run_until_complete(boot())
        loop.run_forever()

    def start(self) -> FakeSite:
        self._thread.start()
        assert self._ready.wait(10), "fake site did not start"
        return self.site

    def stop(self) -> None:
        if self._loop and self._runner:
            fut = asyncio.run_coroutine_threadsafe(self._runner.cleanup(), self._loop)
            fut.result(5)
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(5)


def build_default_site(peapix: int = 8, win10: int = 6) -> FakeSite:
    """A site with ``peapix`` + ``win10`` distinct wallpapers (seeds 1..N, 101..)."""
    site = FakeSite()
    topics = ["lake", "forest", "desert", "city", "beach", "mountain", "aurora", "canyon"]
    for i in range(peapix):
        seed = 1 + i
        site.peapix_items.append(
            Item(seed, f"Peapix Wonder {seed}", [topics[i % 8], "nature"], f"2026-09-{(i % 27) + 1:02d}")
        )
    for i in range(win10):
        seed = 101 + i
        site.win10_items.append(
            Item(seed, f"Win10 Scene {seed}", [topics[(i + 3) % 8], "outdoors"], f"2026-08-{(i % 27) + 1:02d}")
        )
    return site
