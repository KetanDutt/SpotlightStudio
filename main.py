"""
main.py – application entry point.

Usage
-----
  python main.py          → opens the desktop WebView window
  python main.py --server → headless API server only (for browser access)
"""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent

# Ensure runtime directories exist before configuring logging
(ROOT / "data").mkdir(parents=True, exist_ok=True)
(ROOT / "images").mkdir(parents=True, exist_ok=True)

# ── Logging setup ────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(ROOT / "data" / "downloader.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("main")


# ── Server launcher ───────────────────────────────────────────────────────

def run_server(host: str, port: int) -> None:
    from src.config import settings  # noqa: F401 – ensures config is loaded
    uvicorn.run(
        "src.api:app",
        host=host,
        port=port,
        log_level="info",
        reload=False,
    )


def wait_for_server(host: str, port: int, timeout: int = 15) -> bool:
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.25)
    return False


# ── Desktop WebView window ────────────────────────────────────────────────

def open_desktop_window(host: str, port: int) -> None:
    try:
        import webview
    except ImportError:
        log.warning("pywebview not installed – falling back to default browser.")
        import webbrowser
        webbrowser.open(f"http://{host}:{port}/?app=desktop")
        return

    url = f"http://{host}:{port}/?app=desktop"
    window = webview.create_window(
        title="Spotlight Studio — Apple Liquid Glass",
        url=url,
        width=1380,
        height=860,
        resizable=True,
        min_size=(920, 620),
    )
    webview.start(debug=False)


# ── CLI ───────────────────────────────────────────────────────────────────

def main() -> None:
    from src.config import settings

    parser = argparse.ArgumentParser(description="Spotlight Studio Downloader & Showcase")
    parser.add_argument(
        "--server",
        action="store_true",
        help="Run as a headless API server only (no desktop window).",
    )
    parser.add_argument("--host", default=settings.HOST, help=f"Host interface (default: {settings.HOST})")
    parser.add_argument("--port", type=int, default=settings.PORT, help=f"Port number (default: {settings.PORT})")
    args = parser.parse_args()

    if args.server:
        log.info("Starting headless server on http://%s:%d/", args.host, args.port)
        try:
            run_server(args.host, args.port)
        except KeyboardInterrupt:
            log.info("Server terminated by user.")
    else:
        # Start server on a background daemon thread, then open the WebView window
        server_thread = threading.Thread(
            target=run_server, args=(args.host, args.port), daemon=True, name="UvicornServer"
        )
        server_thread.start()

        log.info("Waiting for local server to be ready…")
        if not wait_for_server(args.host, args.port):
            log.error("Server did not start within the expected timeout. Exiting.")
            sys.exit(1)

        log.info("Server ready. Launching desktop window.")
        try:
            open_desktop_window(args.host, args.port)
        except KeyboardInterrupt:
            log.info("Application closed.")


if __name__ == "__main__":
    main()
