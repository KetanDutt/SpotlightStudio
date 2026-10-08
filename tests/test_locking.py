from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from src.api import create_app
from src.config import settings
from src.engine import DownloadEngine
from src.locking import LibraryBusy, LibraryLock

ROOT = Path(__file__).resolve().parents[1]


def test_lock_refuses_a_second_owner_and_releases_after_an_exception(tmp_path):
    database = tmp_path / "library.db"
    with pytest.raises(ValueError), LibraryLock(database):
        with pytest.raises(LibraryBusy):
            with LibraryLock(database):
                pytest.fail("a second owner was allowed")
        raise ValueError("failed operation")
    # The sidecar survives; ownership, not existence, is what matters.
    assert Path(str(database) + ".lock").exists()
    with LibraryLock(database):
        pass


def test_another_process_cannot_acquire_the_library(tmp_path):
    database = tmp_path / "library.db"
    code = "from pathlib import Path; from src.locking import LibraryLock; " \
           "lock = LibraryLock(Path(__import__('sys').argv[1])); lock.__enter__()"
    with LibraryLock(database):
        result = subprocess.run([sys.executable, "-c", code, str(database)], cwd=ROOT,
                                capture_output=True, text=True, timeout=10)
    assert result.returncode != 0 and "LibraryBusy" in result.stderr
    result = subprocess.run([sys.executable, "-c", code, str(database)], cwd=ROOT,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr


def test_the_os_releases_a_lock_after_a_hard_kill(tmp_path):
    database = tmp_path / "library.db"
    code = """
from pathlib import Path
import sys, time
from src.locking import LibraryLock
with LibraryLock(Path(sys.argv[1])):
    print('ready', flush=True)
    time.sleep(60)
"""
    process = subprocess.Popen([sys.executable, "-c", code, str(database)], cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "ready"
        with pytest.raises(LibraryBusy):
            with LibraryLock(database):
                pytest.fail("child owns the library")
        process.kill()
        process.communicate(timeout=10)
        with LibraryLock(database):
            pass
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=10)


def test_cli_fails_before_resetting_another_instances_queue(env, monkeypatch):
    from src import database as db

    monkeypatch.setattr(main, "configure_logging", lambda: None)
    db.enqueue_download({"source": "peapix", "image_url": "https://example.com/a.jpg"})
    claimed = db.claim_download_item()
    with LibraryLock(settings.DB_PATH):
        assert main.main(["--crawl"]) == 3
        assert main.main(["--check"]) == 3
        assert main.main(["--sync-catalog"]) == 3
    with db.get_db() as conn:
        assert conn.execute("SELECT claimed_at FROM download_queue WHERE id=?",
                            (claimed["id"],)).fetchone()[0] is not None


def test_a_second_server_worker_cannot_start(env):
    with TestClient(create_app(settings, DownloadEngine()), base_url="http://127.0.0.1"):
        with pytest.raises(LibraryBusy):
            with TestClient(create_app(settings, DownloadEngine()), base_url="http://127.0.0.1"):
                pytest.fail("a second server worker started")
    with LibraryLock(settings.DB_PATH):
        pass


def test_factory_cannot_lock_a_different_library_than_storage(env, tmp_path):
    from src.config import Settings, settings

    cfg = Settings()
    cfg.DB_PATH = tmp_path / "different.db"
    before = settings.DB_PATH.read_bytes()
    with pytest.raises(RuntimeError, match="Library paths must match"):
        with TestClient(create_app(cfg, DownloadEngine()), base_url="http://127.0.0.1"):
            pass
    assert settings.DB_PATH.read_bytes() == before
    assert not cfg.DB_PATH.exists()
