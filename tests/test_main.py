from __future__ import annotations

import json
import logging
import socket

import pytest

import main as cli
from src import __version__
from src import database as db
from src.config import settings
from tests.conftest import add_wallpaper


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture()
def restore_logging():
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    yield
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()
    for handler in handlers:
        root.addHandler(handler)
    root.setLevel(level)


def test_parser_defaults_and_exclusive_actions():
    parser = cli.build_parser()
    args = parser.parse_args([])
    assert not (args.server or args.crawl or args.check) and args.mode == "quick" and args.source == "both"
    assert parser.parse_args(["--crawl", "--mode", "full", "--source", "peapix"]).mode == "full"
    with pytest.raises(SystemExit):
        parser.parse_args(["--server", "--crawl"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--mode", "turbo"])


def test_version_flag(capsys):
    assert cli.main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == f"Spotlight Studio {__version__}"


def test_url_helpers():
    assert cli.local_host("0.0.0.0") == "127.0.0.1" and cli.local_host("::") == "127.0.0.1"
    assert cli.local_host("localhost") == "localhost"
    assert cli.base_url("0.0.0.0", 9) == "http://127.0.0.1:9"


def test_logging_goes_to_a_rotating_file_at_log_path(env, restore_logging):
    cli.configure_logging()
    logging.getLogger("main").info("hello rotating log")
    for handler in logging.getLogger().handlers:
        handler.flush()
    assert "hello rotating log" in settings.LOG_PATH.read_text(encoding="utf-8")
    kinds = {type(h).__name__ for h in logging.getLogger().handlers}
    assert "RotatingFileHandler" in kinds
    cli.configure_logging()                                                  # idempotent: no duplicate handlers
    assert sum(type(h).__name__ == "RotatingFileHandler" for h in logging.getLogger().handlers) == 1


def test_check_reports_and_sets_exit_code(env, capsys, restore_logging):
    assert cli.main(["--check"]) == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True
    add_wallpaper(filename="peapix/missing.jpg")
    assert cli.main(["--check"]) == 2
    assert json.loads(capsys.readouterr().out)["missing_images_count"] == 1


def test_sync_catalog_command(env, restore_logging):
    add_wallpaper()
    assert cli.main(["--sync-catalog"]) == 0
    assert len(json.loads(settings.CATALOG_PATH.read_text(encoding="utf-8"))) == 1


def test_one_shot_crawl_runs_to_completion(site, restore_logging):
    from src.engine import engine

    assert cli.main(["--crawl", "--source", "peapix", "--mode", "quick"]) == 0
    assert db.count_wallpapers() == site.peapix_per_page
    assert engine.status == "stopped"


def test_server_thread_serves_and_is_reused(env, restore_logging):
    port = free_port()
    assert not cli.port_in_use("127.0.0.1", port)
    server = cli.ServerThread("127.0.0.1", port)
    assert server.start(timeout=30)
    try:
        assert cli.port_in_use("127.0.0.1", port)
        assert cli.is_spotlight_studio("127.0.0.1", port)
        assert cli.run_server("127.0.0.1", port) == 0                        # reuses the running instance
    finally:
        server.stop()
    assert not cli.port_in_use("127.0.0.1", port)


def test_foreign_program_on_the_port_is_reported(env, restore_logging):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(64)
        port = sock.getsockname()[1]
        assert cli.port_in_use("127.0.0.1", port) and not cli.is_spotlight_studio("127.0.0.1", port)
        assert cli.run_server("127.0.0.1", port) == 1
        assert cli.run_desktop("127.0.0.1", port) == 1


def test_host_flag_updates_the_settings_used_by_the_api(env, restore_logging, monkeypatch):
    monkeypatch.setattr(settings, "HOST", "127.0.0.1")
    assert cli.main(["--sync-catalog", "--host", "0.0.0.0", "--port", "9123"]) == 0
    assert settings.HOST == "0.0.0.0" and settings.PORT == 9123
    assert settings.allowed_hosts() == ["*"]
