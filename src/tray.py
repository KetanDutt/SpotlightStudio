"""Optional cross-platform tray companion for the desktop daemon."""
from __future__ import annotations

import logging
import threading
import webbrowser
from collections.abc import Callable

log = logging.getLogger("tray")


def run_tray(host: str, port: int, server: object | None = None) -> int:
    """Run a pystray menu while the local API and crawler remain available."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise RuntimeError("Tray support requires `pip install -r requirements-desktop.txt`.") from exc

    from src.config import settings
    from src.database import get_daily_wallpaper, get_random_wallpaper
    from src.engine import engine
    from src.wallpaper import set_desktop_wallpaper

    url = f"http://{host if host not in {'0.0.0.0', '::'} else '127.0.0.1'}:{port}/?app=desktop"
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 4, 60, 60), radius=16, fill=(35, 128, 98, 255))
    draw.ellipse((18, 18, 46, 46), fill=(245, 248, 246, 255))
    draw.ellipse((25, 25, 39, 39), fill=(35, 128, 98, 255))
    icon = pystray.Icon("Spotlight Studio", image, "Spotlight Studio · starting")
    quit_event = threading.Event()

    def apply(row: dict | None) -> None:
        if not row:
            icon.notify("No wallpapers are available yet.", "Spotlight Studio")
            return
        try:
            set_desktop_wallpaper(settings.IMAGES_DIR / row["filename"])
            icon.notify(row.get("title") or "Wallpaper applied", "Spotlight Studio")
        except Exception as exc:  # noqa: BLE001 - report a menu action failure, don't kill the tray
            log.exception("Tray wallpaper action failed")
            icon.notify(str(exc)[:180], "Spotlight Studio")

    def action(callback: Callable[[], None]):
        def invoke(_icon: object, _item: object) -> None:
            try:
                callback()
            except Exception:
                log.exception("Tray action failed")
        return invoke

    def start_pause() -> None:
        status = engine.snapshot().get("status", "stopped")
        if status == "running":
            engine.pause()
        elif status == "paused":
            engine.start()
        else:
            engine.start("both", "quick")

    def quit_app(_icon: object, _item: object) -> None:
        quit_event.set()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Open Spotlight Studio", action(lambda: webbrowser.open(url)), default=True),
        pystray.MenuItem("Next Wallpaper", action(lambda: apply(get_random_wallpaper()))),
        pystray.MenuItem("Set Daily Spotlight", action(lambda: apply(get_daily_wallpaper()))),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Start / Pause crawler", action(start_pause)),
        pystray.MenuItem("Quit", quit_app),
    )
    icon.menu = menu

    def refresh_tooltip() -> None:
        while not quit_event.wait(2):
            try:
                snap = engine.snapshot()
                phase = snap.get("phase", "Idle")
                pct = snap.get("progress_pct", 0)
                icon.title = f"Spotlight Studio · {snap.get('status', 'stopped')} · {phase} {pct}%"
            except Exception:
                log.debug("Could not refresh tray status", exc_info=True)

    threading.Thread(target=refresh_tooltip, name="TrayStatus", daemon=True).start()
    try:
        icon.run()
    finally:
        quit_event.set()
        if server is not None:
            server.stop()
    return 0
