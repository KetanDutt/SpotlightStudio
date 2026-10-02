"""
wallpaper.py – set an image as the desktop background.

* **Windows** – ``SystemParametersInfoW`` (the native, fully supported path).
* **macOS**   – AppleScript via ``osascript`` (first run asks for automation permission).
* **Linux**   – GNOME / Cinnamon / MATE via ``gsettings``, KDE Plasma via
  ``plasma-apply-wallpaperimage``.

The non-Windows back-ends are best-effort conveniences; every failure surfaces as a
:class:`WallpaperError` with a human readable message (HTTP 400/501 in the API).
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path


class WallpaperError(RuntimeError):
    """The wallpaper could not be applied (message is safe to show to the user)."""


class UnsupportedPlatform(WallpaperError):
    """No wallpaper back-end exists for this operating system / desktop."""


SPI_SETDESKWALLPAPER = 20
SPIF_UPDATEINIFILE = 0x01
SPIF_SENDCHANGE = 0x02


def _set_windows(path: Path) -> None:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
    user32.SystemParametersInfoW.argtypes = [
        wintypes.UINT, wintypes.UINT, wintypes.LPVOID, wintypes.UINT,
    ]
    user32.SystemParametersInfoW.restype = wintypes.BOOL
    ok = user32.SystemParametersInfoW(
        SPI_SETDESKWALLPAPER,
        0,
        ctypes.c_wchar_p(str(path)),
        SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
    )
    if not ok:
        raise WallpaperError(f"Windows refused the wallpaper (error {ctypes.get_last_error()}).")


def _run(cmd: list[str]) -> None:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WallpaperError(f"Could not run {cmd[0]}: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:200]
        raise WallpaperError(f"{cmd[0]} failed: {detail or proc.returncode}")


def _set_macos(path: Path) -> None:
    escaped = str(path).replace("\\", "\\\\").replace('"', '\\"')
    script = (
        'tell application "System Events" to tell every desktop to '
        f'set picture to POSIX file "{escaped}"'
    )
    _run(["osascript", "-e", script])


def _set_linux(path: Path) -> None:
    desktop = (os.environ.get("XDG_CURRENT_DESKTOP") or "").lower()
    uri = path.as_uri()
    if "kde" in desktop and shutil.which("plasma-apply-wallpaperimage"):
        _run(["plasma-apply-wallpaperimage", str(path)])
        return
    if shutil.which("gsettings"):
        schema = {
            "cinnamon": "org.cinnamon.desktop.background",
            "mate": "org.mate.background",
        }.get(next((d for d in ("cinnamon", "mate") if d in desktop), ""), "org.gnome.desktop.background")
        key = "picture-filename" if schema == "org.mate.background" else "picture-uri"
        value = str(path) if key == "picture-filename" else uri
        _run(["gsettings", "set", schema, key, value])
        if schema == "org.gnome.desktop.background":
            _run(["gsettings", "set", schema, "picture-uri-dark", uri])
        return
    raise UnsupportedPlatform(
        "Setting the wallpaper is supported on Windows, macOS, GNOME, Cinnamon, MATE and KDE."
    )


def set_desktop_wallpaper(path: Path) -> None:
    """Apply ``path`` as the desktop wallpaper of the current user."""
    path = Path(path).resolve()
    if not path.is_file():
        raise WallpaperError("The image file does not exist on this machine.")
    system = platform.system()
    if system == "Windows":
        _set_windows(path)
    elif system == "Darwin":
        _set_macos(path)
    elif system == "Linux":
        _set_linux(path)
    else:
        raise UnsupportedPlatform(f"Setting the wallpaper is not supported on {system}.")
