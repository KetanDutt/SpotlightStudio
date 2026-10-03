"""
config.py – loads settings from the environment / ``.env`` and exposes a single
:data:`settings` object shared by every module.

Design notes
------------
* Every value has a safe default and is **validated**: a typo such as
  ``CONCURRENT_DOWNLOADS=abc`` logs a warning and falls back to the default
  instead of crashing the whole application at import time.
* Numeric settings are clamped to a sane range so that a runaway value cannot
  exhaust sockets or file handles.
* Importing this module has **no filesystem side effects**; call
  :meth:`Settings.ensure_dirs` (done by ``main.py`` and ``init_db``) when the
  directories are actually needed.  This keeps the test-suite hermetic.
* ``settings`` is a plain mutable object on purpose – tests (and advanced
  users) can monkey-patch attributes such as ``settings.DB_PATH`` and every
  module will pick the change up because they all read the attribute lazily.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from src import __version__

# Project root is always the parent of this file's parent directory.
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

_log = logging.getLogger("config")

_TRUE = {"1", "true", "yes", "on", "y"}
_FALSE = {"0", "false", "no", "off", "n"}


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or not value.strip() else value.strip()


def _env_int(name: str, default: int, lo: int | None = None, hi: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        _log.warning("Invalid integer for %s=%r – using default %s", name, raw, default)
        return default
    clamped = value
    if lo is not None:
        clamped = max(lo, clamped)
    if hi is not None:
        clamped = min(hi, clamped)
    if clamped != value:
        _log.warning("%s=%s is out of range [%s, %s] – clamped to %s", name, value, lo, hi, clamped)
    return clamped


def _env_float(name: str, default: float, lo: float | None = None, hi: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw.strip())
    except ValueError:
        _log.warning("Invalid number for %s=%r – using default %s", name, raw, default)
        return default
    if lo is not None:
        value = max(lo, value)
    if hi is not None:
        value = min(hi, value)
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    token = raw.strip().lower()
    if token in _TRUE:
        return True
    if token in _FALSE:
        return False
    _log.warning("Invalid boolean for %s=%r – using default %s", name, raw, default)
    return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return list(default)
    return [part.strip() for part in raw.split(",") if part.strip()]


def _resolve_path(value: str) -> Path:
    """Resolve ``value`` against the project root unless it is already absolute."""
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def _strip_slash(url: str) -> str:
    return url.rstrip("/")


class Settings:
    """Typed, validated application configuration (see ``.env.example``)."""

    VERSION: str = __version__

    def __init__(self) -> None:
        self.reload()

    # ------------------------------------------------------------------ #
    def reload(self) -> None:
        """(Re)read every value from the current environment."""
        # ── Server ────────────────────────────────────────────────────────
        self.HOST: str = _env_str("HOST", "127.0.0.1")
        self.PORT: int = _env_int("PORT", 8765, 1, 65535)
        # Host headers accepted by the API (DNS-rebinding protection).
        # Defaults to loopback names; "*" is implied when HOST is not loopback.
        self.ALLOWED_HOSTS: list[str] = _env_list("ALLOWED_HOSTS", [])
        # Extra browser origins allowed to call the API (CORS).  Empty = same-origin only.
        self.CORS_ORIGINS: list[str] = _env_list("CORS_ORIGINS", [])

        # ── Paths (relative to the project root unless absolute) ──────────
        self.ROOT: Path = ROOT
        self.IMAGES_DIR: Path = _resolve_path(_env_str("IMAGES_DIR", "images"))
        self.DB_PATH: Path = _resolve_path(_env_str("DB_PATH", "data/wallpapers.db"))
        self.LOG_PATH: Path = _resolve_path(_env_str("LOG_PATH", "data/downloader.log"))
        # Static catalog consumed by the GitHub-Pages showcase (next to the DB by default).
        catalog = os.getenv("CATALOG_PATH", "").strip()
        self.CATALOG_PATH: Path = (
            _resolve_path(catalog) if catalog else self.DB_PATH.parent / "wallpapers.json"
        )

        # ── Logging ───────────────────────────────────────────────────────
        self.LOG_LEVEL: str = _env_str("LOG_LEVEL", "INFO").upper()
        self.LOG_MAX_BYTES: int = _env_int("LOG_MAX_BYTES", 5 * 1024 * 1024, 64 * 1024, None)
        self.LOG_BACKUPS: int = _env_int("LOG_BACKUPS", 3, 0, 50)

        # ── Download concurrency ──────────────────────────────────────────
        # Simultaneous image downloads (asyncio tasks).
        self.CONCURRENT_DOWNLOADS: int = _env_int("CONCURRENT_DOWNLOADS", 32, 1, 256)
        # Simultaneous gallery pages scraped (asyncio tasks).
        self.CONCURRENT_SCRAPERS: int = _env_int("CONCURRENT_SCRAPERS", 4, 1, 32)
        # Total open TCP connections across the whole session.
        self.MAX_CONNECTIONS: int = _env_int("MAX_CONNECTIONS", 128, 4, 1024)
        # Max connections to a single hostname.
        self.MAX_CONNECTIONS_PER_HOST: int = _env_int("MAX_CONNECTIONS_PER_HOST", 48, 1, 512)
        # Threads for CPU-bound Pillow work.  0 → Python default (min(32, cpu_count + 4)).
        self.CPU_THREADS: int = _env_int("CPU_THREADS", 0, 0, 128)

        # ── Reliability ───────────────────────────────────────────────────
        # Politeness pause (seconds) after every scraped page, per scraper.
        self.REQUEST_DELAY: float = _env_float("REQUEST_DELAY_SECONDS", 0.1, 0.0, 60.0)
        self.MAX_RETRIES: int = _env_int("MAX_RETRIES", 3, 0, 20)
        self.TIMEOUT: int = _env_int("REQUEST_TIMEOUT_SECONDS", 30, 3, 600)
        # Verify TLS certificates (disable only behind broken corporate proxies).
        self.VERIFY_SSL: bool = _env_bool("VERIFY_SSL", True)
        # Hard cap for a single image download (bytes).
        self.MAX_IMAGE_BYTES: int = _env_int("MAX_IMAGE_BYTES", 40 * 1024 * 1024, 1024 * 1024, None)
        # Images narrower than this are treated as junk (tracking pixels, icons…).
        self.MIN_IMAGE_WIDTH: int = _env_int("MIN_IMAGE_WIDTH", 320, 1, 8192)

        # ── Source sites ──────────────────────────────────────────────────
        # Page counts are *hints*: with AUTO_DETECT_PAGES the engine discovers the
        # real number of gallery pages (the sites keep growing).
        self.PEAPIX_TOTAL_PAGES: int = _env_int("PEAPIX_TOTAL_PAGES", 30, 1, 100_000)
        self.WIN10_TOTAL_PAGES: int = _env_int("WIN10_TOTAL_PAGES", 1320, 1, 100_000)
        self.AUTO_DETECT_PAGES: bool = _env_bool("AUTO_DETECT_PAGES", True)
        # Pages per source scanned by a "quick update" (newest wallpapers first).
        self.QUICK_UPDATE_PAGES: int = _env_int("QUICK_UPDATE_PAGES", 3, 1, 100)
        self.PEAPIX_BASE_URL: str = _strip_slash(_env_str("PEAPIX_BASE_URL", "https://peapix.com"))
        self.PEAPIX_IMAGE_BASE_URL: str = _strip_slash(
            _env_str("PEAPIX_IMAGE_BASE_URL", "https://img.peapix.com")
        )
        self.WIN10_BASE_URL: str = _strip_slash(
            _env_str("WIN10_BASE_URL", "https://windows10spotlight.com")
        )

        # ── HTTP headers ──────────────────────────────────────────────────
        self.HEADERS: dict[str, str] = {
            "User-Agent": _env_str(
                "USER_AGENT",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36",
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }

    # ------------------------------------------------------------------ #
    @property
    def DATA_DIR(self) -> Path:
        """Directory that holds the database, the catalog and the log."""
        return self.DB_PATH.parent

    @property
    def THUMBS_DIR(self) -> Path:
        return self.IMAGES_DIR / "thumbs"

    @property
    def is_loopback_host(self) -> bool:
        return self.HOST in {"127.0.0.1", "localhost", "::1", "[::1]"}

    def allowed_hosts(self) -> list[str]:
        """Host header values the API will answer to."""
        if self.ALLOWED_HOSTS:
            return self.ALLOWED_HOSTS
        if self.is_loopback_host:
            return ["127.0.0.1", "localhost", "[::1]", "::1"]
        # The operator explicitly bound a non-loopback interface → accept any Host.
        return ["*"]

    def ensure_dirs(self) -> None:
        """Create the runtime directories (idempotent)."""
        for directory in (
            self.IMAGES_DIR,
            self.THUMBS_DIR,
            self.DB_PATH.parent,
            self.LOG_PATH.parent,
            self.CATALOG_PATH.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)


settings = Settings()
