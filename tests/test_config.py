from __future__ import annotations

from pathlib import Path

import pytest

from src import __version__
from src.config import ROOT, Settings


def fresh(monkeypatch, **env) -> Settings:
    for key in ("HOST", "PORT", "CONCURRENT_DOWNLOADS", "VERIFY_SSL", "ALLOWED_HOSTS", "DB_PATH", "IMAGES_DIR",
                "CATALOG_PATH", "LOG_PATH", "PEAPIX_BASE_URL", "MAX_RETRIES", "REQUEST_DELAY_SECONDS",
                "CORS_ORIGINS", "AUTO_DETECT_PAGES", "LOG_LEVEL"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return Settings()


def test_defaults(monkeypatch):
    cfg = fresh(monkeypatch)
    assert cfg.VERSION == __version__
    assert (cfg.HOST, cfg.PORT) == ("127.0.0.1", 8765)
    assert cfg.CONCURRENT_DOWNLOADS == 32 and cfg.VERIFY_SSL is True and cfg.AUTO_DETECT_PAGES is True
    assert cfg.DB_PATH == ROOT / "data" / "wallpapers.db"
    assert cfg.IMAGES_DIR == ROOT / "images" and cfg.THUMBS_DIR == ROOT / "images" / "thumbs"
    assert cfg.CATALOG_PATH == ROOT / "data" / "wallpapers.json" and cfg.DATA_DIR == ROOT / "data"
    assert cfg.PEAPIX_BASE_URL == "https://peapix.com" and cfg.WIN10_TOTAL_PAGES >= 1320
    assert "Mozilla" in cfg.HEADERS["User-Agent"]


def test_invalid_values_fall_back_instead_of_crashing(monkeypatch, caplog):
    with caplog.at_level("WARNING"):
        cfg = fresh(monkeypatch, PORT="abc", CONCURRENT_DOWNLOADS="lots", VERIFY_SSL="maybe",
                    REQUEST_DELAY_SECONDS="fast")
    assert cfg.PORT == 8765 and cfg.CONCURRENT_DOWNLOADS == 32 and cfg.VERIFY_SSL is True
    assert cfg.REQUEST_DELAY == 0.1
    assert "Invalid" in caplog.text


def test_values_are_clamped(monkeypatch):
    cfg = fresh(monkeypatch, CONCURRENT_DOWNLOADS="100000", PORT="99999", MAX_RETRIES="-5")
    assert cfg.CONCURRENT_DOWNLOADS == 256 and cfg.PORT == 65535 and cfg.MAX_RETRIES == 0


@pytest.mark.parametrize(("raw", "expected"), [("true", True), ("1", True), ("YES", True), ("off", False),
                                               ("0", False), ("No", False)])
def test_booleans(monkeypatch, raw, expected):
    assert fresh(monkeypatch, VERIFY_SSL=raw).VERIFY_SSL is expected


def test_paths_relative_and_absolute(monkeypatch, tmp_path):
    cfg = fresh(monkeypatch, DB_PATH="custom/db.sqlite", IMAGES_DIR=str(tmp_path / "pics"))
    assert cfg.DB_PATH == ROOT / "custom" / "db.sqlite"
    assert cfg.IMAGES_DIR == tmp_path / "pics"
    assert cfg.CATALOG_PATH == ROOT / "custom" / "wallpapers.json"          # next to the DB
    explicit = fresh(monkeypatch, CATALOG_PATH=str(tmp_path / "c.json"))
    assert explicit.CATALOG_PATH == tmp_path / "c.json"


def test_ensure_dirs_is_lazy_and_idempotent(monkeypatch, tmp_path):
    cfg = fresh(monkeypatch, DB_PATH=str(tmp_path / "d" / "w.db"), IMAGES_DIR=str(tmp_path / "i"),
                LOG_PATH=str(tmp_path / "l" / "x.log"))
    assert not (tmp_path / "d").exists()                                      # importing has no side effects
    cfg.ensure_dirs()
    cfg.ensure_dirs()
    assert (tmp_path / "d").is_dir() and (tmp_path / "i" / "thumbs").is_dir() and (tmp_path / "l").is_dir()


def test_allowed_hosts_policy(monkeypatch):
    assert "localhost" in fresh(monkeypatch).allowed_hosts()
    assert "evil" not in fresh(monkeypatch).allowed_hosts()
    assert fresh(monkeypatch, HOST="0.0.0.0").allowed_hosts() == ["*"]
    assert fresh(monkeypatch, HOST="0.0.0.0", ALLOWED_HOSTS="a.lan, b.lan").allowed_hosts() == ["a.lan", "b.lan"]
    assert fresh(monkeypatch).is_loopback_host and not fresh(monkeypatch, HOST="192.168.0.5").is_loopback_host


def test_lists_and_urls_are_cleaned(monkeypatch):
    cfg = fresh(monkeypatch, CORS_ORIGINS=" https://a.example , ,https://b.example", PEAPIX_BASE_URL="http://x/")
    assert cfg.CORS_ORIGINS == ["https://a.example", "https://b.example"]
    assert cfg.PEAPIX_BASE_URL == "http://x"
    assert isinstance(cfg.LOG_PATH, Path)
