"""
config.py – loads settings from .env and exposes a single Settings object.
"""
from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

# Project root is always the parent of this file's parent directory
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


class Settings:
    # ── Server ────────────────────────────────────────────────────────────
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8765"))

    # ── Paths ──────────────────────────────────────────────────────────────
    IMAGES_DIR: Path = ROOT / os.getenv("IMAGES_DIR", "images")
    DB_PATH:    Path = ROOT / os.getenv("DB_PATH",    "data/wallpapers.db")
    STATE_PATH: Path = ROOT / os.getenv("STATE_PATH", "data/state.json")
    LOG_PATH:   Path = ROOT / os.getenv("LOG_PATH",   "data/downloader.log")

    # ── Download concurrency ───────────────────────────────────────────────
    # Simultaneous image downloads (asyncio tasks).
    CONCURRENT_DOWNLOADS: int = int(os.getenv("CONCURRENT_DOWNLOADS", "32"))

    # Simultaneous gallery pages scraped (asyncio tasks).
    CONCURRENT_SCRAPERS: int = int(os.getenv("CONCURRENT_SCRAPERS", "4"))

    # Total open TCP connections across the whole session.
    MAX_CONNECTIONS: int = int(os.getenv("MAX_CONNECTIONS", "128"))

    # Max connections to a single hostname.
    MAX_CONNECTIONS_PER_HOST: int = int(os.getenv("MAX_CONNECTIONS_PER_HOST", "48"))

    # Threads in the ThreadPoolExecutor used for CPU-bound Pillow / imagehash work.
    # 0 → default (min(32, cpu_count + 4)).
    CPU_THREADS: int = int(os.getenv("CPU_THREADS", "0"))

    # ── Reliability ────────────────────────────────────────────────────────
    REQUEST_DELAY: float = float(os.getenv("REQUEST_DELAY_SECONDS", "0.1"))
    MAX_RETRIES:   int   = int(os.getenv("MAX_RETRIES", "3"))
    TIMEOUT:       int   = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "30"))

    # ── Site page counts ───────────────────────────────────────────────────
    PEAPIX_TOTAL_PAGES: int = int(os.getenv("PEAPIX_TOTAL_PAGES", "30"))
    WIN10_TOTAL_PAGES:  int = int(os.getenv("WIN10_TOTAL_PAGES",  "1319"))

    # ── HTTP headers ───────────────────────────────────────────────────────
    HEADERS: dict = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }


settings = Settings()

# Ensure required directories exist at import time
settings.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
settings.LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
