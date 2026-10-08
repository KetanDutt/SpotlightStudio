"""
main.py – application entry point.

Usage
-----
  python main.py                       desktop window (PyWebView; browser fallback)
  python main.py --server              headless server – open http://127.0.0.1:8765/
  python main.py --crawl               one-shot crawl without UI, then exit
        [--source both|peapix|win10spotlight] [--mode quick|full|repair]
  python main.py --check               library health report (DB ⇄ files), exit code 2 on issues
  python main.py --sync-catalog        regenerate data/wallpapers.json
  python main.py --version

``--crawl`` is what Task Scheduler / cron should run, e.g. a daily
``python main.py --crawl --mode quick``.
"""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

log = logging.getLogger("main")


# ══════════════════════════════════════════════════════════════════════════
# Logging
# ══════════════════════════════════════════════════════════════════════════


def configure_logging() -> None:
    """Console + rotating file logging (honours ``LOG_PATH`` / ``LOG_LEVEL``)."""
    from src.config import settings

    settings.ensure_dirs()
    level = getattr(logging, settings.LOG_LEVEL, logging.INFO)
    formatter = logging.Formatter("%(asctime)s  %(levelname)-8s  %(name)s  %(message)s")

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    root.setLevel(level)

    if sys.stdout is not None:  # pythonw.exe has no stdout
        try:
            # Windows consoles may not be UTF-8; never crash on ✓ / → in log lines.
            sys.stdout.reconfigure(errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        root.addHandler(console)

    file_handler = logging.handlers.RotatingFileHandler(
        settings.LOG_PATH,
        maxBytes=settings.LOG_MAX_BYTES,
        backupCount=settings.LOG_BACKUPS,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    for noisy in ("aiohttp", "asyncio", "PIL", "multipart", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


# ══════════════════════════════════════════════════════════════════════════
# Server helpers
# ══════════════════════════════════════════════════════════════════════════


def local_host(host: str) -> str:
    """Address a *client* on this machine should use (0.0.0.0 is not connectable)."""
    return "127.0.0.1" if host in {"0.0.0.0", "::", ""} else host


def base_url(host: str, port: int) -> str:
    client_host = local_host(host)
    if ":" in client_host and not client_host.startswith("["):
        client_host = f"[{client_host}]"
    return f"http://{client_host}:{port}"


def port_in_use(host: str, port: int) -> bool:
    try:
        with socket.create_connection((local_host(host), port), timeout=0.5):
            return True
    except OSError:
        return False


def is_spotlight_studio(host: str, port: int) -> bool:
    """True when a Spotlight Studio instance already answers on ``host:port``."""
    try:
        with urllib.request.urlopen(f"{base_url(host, port)}/api/health", timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("status") == "healthy" and "version" in data
    except (OSError, ValueError, urllib.error.URLError):
        return False


class ServerThread:
    """Runs uvicorn in a background thread with a clean, graceful shutdown."""

    def __init__(self, host: str, port: int) -> None:
        import uvicorn

        from src.api import app

        config = uvicorn.Config(
            app, host=host, port=port, log_level="warning", log_config=None, access_log=False
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True, name="UvicornServer")

    def start(self, timeout: float = 20.0) -> bool:
        self.thread.start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.server.started:
                return True
            if not self.thread.is_alive():
                return False
            time.sleep(0.1)
        return False

    def stop(self, timeout: float = 30.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout)


def _raise_keyboard_interrupt(_signum, _frame) -> None:
    raise KeyboardInterrupt


def install_termination_handlers() -> None:
    """
    Treat SIGTERM (service managers, ``timeout``, ``docker stop``) and Ctrl+Break on Windows like
    Ctrl+C, so the engine is stopped and its queue claims are released instead of the process
    being killed mid-download.  (A hard kill is still safe: claims are released on the next start.)
    """
    for name in ("SIGTERM", "SIGBREAK"):
        number = getattr(signal, name, None)
        if number is None:
            continue
        try:
            signal.signal(number, _raise_keyboard_interrupt)
        except (ValueError, OSError):  # not the main thread / unsupported on this platform
            pass


# ══════════════════════════════════════════════════════════════════════════
# Modes
# ══════════════════════════════════════════════════════════════════════════


def run_server(host: str, port: int) -> int:
    """Headless server (blocking).  ``Ctrl+C`` shuts everything down gracefully."""
    import uvicorn

    from src.api import app

    if port_in_use(host, port):
        if is_spotlight_studio(host, port):
            log.info("Spotlight Studio is already running at %s", base_url(host, port))
            return 0
        log.error("Port %d is already used by another program. Use --port or PORT in .env.", port)
        return 1
    log.info("Starting server on http://%s:%d/  (UI + API docs at /api/docs)", host, port)
    try:
        uvicorn.run(app, host=host, port=port, log_level="warning", log_config=None, access_log=False)
    except KeyboardInterrupt:
        log.info("Server terminated by user.")
    except SystemExit as exc:  # uvicorn exits (code 3) when it cannot bind the port
        log.error("The server could not start on port %d (exit code %s).", port, exc.code)
        return 1
    return 0


def open_in_browser(url: str) -> None:
    """Fallback when no native window is available: open the browser and wait."""
    webbrowser.open(url)
    log.info("Running in your browser at %s – press Ctrl+C to quit.", url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


def open_desktop_window(url: str) -> bool:
    """Show the native window.  Returns False when PyWebView is unusable."""
    try:
        import webview
    except ImportError:
        log.warning("pywebview is not installed – falling back to the default browser.")
        return False
    try:
        # pywebview blocks file downloads by default; the gallery needs them
        # ("Download full resolution", JSON/CSV export).
        webview.settings["ALLOW_DOWNLOADS"] = True
    except (AttributeError, TypeError):
        log.debug("This pywebview version has no ALLOW_DOWNLOADS setting.")
    try:
        webview.create_window(
            title="Spotlight Studio",
            url=url,
            width=1380,
            height=860,
            resizable=True,
            min_size=(920, 620),
            background_color="#08090e",
            text_select=True,
        )
        webview.start(debug=False)
        return True
    except Exception as exc:  # noqa: BLE001 – WebView2 runtime missing, no GUI toolkit, …
        log.warning("Could not open the desktop window (%s) – falling back to the browser.", exc)
        return False


def run_desktop(host: str, port: int) -> int:
    install_termination_handlers()
    url = f"{base_url(host, port)}/?app=desktop"
    server: ServerThread | None = None
    if port_in_use(host, port):
        if not is_spotlight_studio(host, port):
            log.error("Port %d is used by another program. Use --port or PORT in .env.", port)
            return 1
        log.info("Reusing the Spotlight Studio instance already running on port %d.", port)
    else:
        server = ServerThread(host, port)
        log.info("Starting local server…")
        if not server.start():
            log.error("The server did not start (see %s).", "data/downloader.log")
            return 1
    try:
        if not open_desktop_window(url):
            open_in_browser(url)
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None:
            log.info("Shutting down…")
            server.stop()
    return 0


def run_crawl(source: str, mode: str) -> int:
    """Run the crawler to completion without any UI (cron / Task Scheduler friendly)."""
    from src import maintenance
    from src.downloader import shutdown_cpu_pool
    from src.engine import engine

    install_termination_handlers()
    maintenance.startup_tasks()
    action = engine.start(source, mode)
    log.info("Crawl %s (mode=%s, source=%s). Press Ctrl+C to stop.", action, mode, source)
    last_log = 0.0
    try:
        while not engine.wait(1.0):
            if time.monotonic() - last_log >= 10:
                last_log = time.monotonic()
                snap = engine.snapshot()
                run = snap["run"]
                log.info(
                    "%s · %d%% · +%d new · %d dupes · %d errors",
                    snap["phase"], snap["progress_pct"],
                    run["downloaded"] + run["replaced"], run["duplicates"], run["errors"],
                )
    except KeyboardInterrupt:
        log.info("Interrupted – stopping (queues are kept for the next run)…")
        engine.stop()
        engine.wait(60)
        shutdown_cpu_pool()
        return 130
    shutdown_cpu_pool()
    run = engine.run
    log.info(
        "Finished: %s · +%d new · %d replaced · %d duplicates · %d repaired · %d errors in %.0fs",
        run.result, run.downloaded, run.replaced, run.duplicates, run.repaired, run.errors,
        run.elapsed(),
    )
    return 0 if run.result == "completed" else 1


def run_check() -> int:
    from src.database import init_db
    from src.maintenance import verify_library

    init_db()
    report = verify_library()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["ok"] else 2


def run_sync_catalog() -> int:
    from src.config import settings
    from src.database import export_catalog_json, init_db

    init_db()
    count = export_catalog_json()
    log.info("Catalog written: %d wallpapers → %s", count, settings.CATALOG_PATH)
    return 0


# ══════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════


def build_parser() -> argparse.ArgumentParser:
    from src.config import settings

    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Spotlight Studio – Windows Spotlight wallpaper archive & gallery.",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--server", action="store_true",
                        help="Run as a headless server only (no desktop window).")
    action.add_argument("--crawl", action="store_true",
                        help="Run one crawl without UI and exit (for schedulers).")
    action.add_argument("--check", action="store_true",
                        help="Print a library health report and exit (code 2 when issues).")
    action.add_argument("--sync-catalog", action="store_true",
                        help="Regenerate data/wallpapers.json and exit.")
    action.add_argument("--version", action="store_true", help="Print the version and exit.")
    parser.add_argument("--host", default=settings.HOST, help=f"Interface (default: {settings.HOST})")
    parser.add_argument("--port", type=int, default=settings.PORT,
                        help=f"Port (default: {settings.PORT})")
    parser.add_argument("--source", choices=["both", "peapix", "win10spotlight"], default="both",
                        help="Source(s) for --crawl (default: both).")
    parser.add_argument("--mode", choices=["quick", "full", "repair"], default="quick",
                        help="Mode for --crawl: quick = newest pages, full = every page, "
                             "repair = back-fill titles/tags (default: quick).")
    return parser


def main(argv: list[str] | None = None) -> int:
    from src import __version__

    args = build_parser().parse_args(argv)
    if args.version:
        print(f"Spotlight Studio {__version__}")
        return 0

    # An explicit --host/--port is authoritative (the API derives its Host allow-list from it).
    from src.config import settings

    if not 1 <= args.port <= 65535:
        build_parser().error("--port must be between 1 and 65535")
    settings.HOST, settings.PORT = args.host, args.port
    configure_logging()
    if args.check or args.sync_catalog or args.crawl:
        from src.database import close_connection
        from src.downloader import shutdown_cpu_pool
        from src.locking import LibraryBusy, LibraryLock

        try:
            with LibraryLock(settings.DB_PATH):
                try:
                    if args.check:
                        return run_check()
                    if args.sync_catalog:
                        return run_sync_catalog()
                    return run_crawl(args.source, args.mode)
                finally:
                    shutdown_cpu_pool(wait=True)
                    close_connection()
        except LibraryBusy as exc:
            log.error("%s", exc)
            return 3
    if args.server:
        return run_server(args.host, args.port)
    return run_desktop(args.host, args.port)


if __name__ == "__main__":
    sys.exit(main())
