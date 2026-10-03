"""Shared fixtures: an isolated settings/DB sandbox and a fake source site."""
from __future__ import annotations

import io
import itertools
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import database as db  # noqa: E402
from src import storage  # noqa: E402
from src.config import settings  # noqa: E402
from tests.fake_site import FakeSite, FakeSiteThread, build_default_site, make_picture  # noqa: E402

_counter = itertools.count(1)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Isolated, fast settings: temp database / images / catalog."""
    monkeypatch.setattr(settings, "DB_PATH", tmp_path / "data" / "wallpapers.db")
    monkeypatch.setattr(settings, "CATALOG_PATH", tmp_path / "data" / "wallpapers.json")
    monkeypatch.setattr(settings, "LOG_PATH", tmp_path / "data" / "downloader.log")
    monkeypatch.setattr(settings, "IMAGES_DIR", tmp_path / "images")
    monkeypatch.setattr(settings, "CONCURRENT_DOWNLOADS", 4)
    monkeypatch.setattr(settings, "CONCURRENT_SCRAPERS", 2)
    monkeypatch.setattr(settings, "REQUEST_DELAY", 0.0)
    monkeypatch.setattr(settings, "MAX_RETRIES", 2)
    monkeypatch.setattr(settings, "TIMEOUT", 10)
    monkeypatch.setattr(settings, "AUTO_DETECT_PAGES", True)
    monkeypatch.setattr(settings, "QUICK_UPDATE_PAGES", 1)
    monkeypatch.setattr("src.scrapers._BACKOFF_BASE", 0.01)
    db.close_connection()
    db.init_db()
    yield settings
    db.close_connection()


@pytest.fixture()
def site(env, monkeypatch):
    """A running fake Peapix + Windows10Spotlight site wired into the settings."""
    fake = build_default_site(peapix=8, win10=6)
    thread = FakeSiteThread(fake)
    thread.start()
    monkeypatch.setattr(settings, "PEAPIX_BASE_URL", fake.base)
    monkeypatch.setattr(settings, "PEAPIX_IMAGE_BASE_URL", fake.base + "/img")
    monkeypatch.setattr(settings, "WIN10_BASE_URL", fake.base)
    monkeypatch.setattr(settings, "PEAPIX_TOTAL_PAGES", 1)  # wrong on purpose: discovery must fix
    monkeypatch.setattr(settings, "WIN10_TOTAL_PAGES", 1)
    yield fake
    thread.stop()


def random_phash(rng: random.Random | None = None) -> str:
    rng = rng or random.Random(next(_counter))
    return f"{rng.getrandbits(256):064x}"


def add_wallpaper(**overrides) -> dict:
    """Insert a wallpaper row (no files) and return it as stored."""
    n = next(_counter)
    record = {
        "phash": random_phash(random.Random(n)),
        "filename": f"peapix/{n:032x}.jpg",
        "title": f"Wallpaper {n}",
        "source": "peapix",
        "source_url": f"https://img.example/{n:032x}_UHD.jpg",
        "page_url": f"https://example.com/spotlight/{n}",
        "width": 3840,
        "height": 2160,
        "file_size": 2_000_000,
        "tags": "nature,sky",
        "date_spotted": "2026-01-01",
        "quality": "4K / UHD",
    }
    record.update(overrides)
    db.upsert_wallpaper(record)
    return db.get_wallpaper_by_phash(record["phash"])


def add_wallpaper_with_files(width: int = 640, height: int = 360, **overrides) -> dict:
    """Insert a row *and* write a real image + thumbnail for it."""
    row = add_wallpaper(width=width, height=height, **overrides)
    data = make_picture(next(_counter), width, height)
    storage.write_image(row["filename"], data)
    storage.write_thumbnail(row["filename"], data)
    return row


@pytest.fixture()
def add():
    return add_wallpaper


@pytest.fixture()
def add_files():
    return add_wallpaper_with_files


@pytest.fixture(scope="session")
def sample_jpeg() -> bytes:
    return make_picture(42, 640, 360)


__all__ = ["FakeSite", "io"]
