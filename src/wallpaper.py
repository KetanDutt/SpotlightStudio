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

import logging
import os
import platform
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger("wallpaper")


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


def _set_windows_advanced(path: Path, fit: str = "Fill", monitor_id: str | None = None) -> None:
    """Use IDesktopWallpaper for per-monitor targets and native fit modes."""
    import ctypes
    import uuid

    class GUID(ctypes.Structure):
        _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                    ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]

        @classmethod
        def parse(cls, value: str):
            return cls.from_buffer_copy(uuid.UUID(value).bytes_le)

    ole32 = ctypes.OleDLL("ole32")  # type: ignore[attr-defined]
    ole32.CoInitialize.argtypes = [ctypes.c_void_p]
    ole32.CoInitialize.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoCreateInstance.argtypes = [ctypes.POINTER(GUID), ctypes.c_void_p, ctypes.c_uint32,
                                       ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    ole32.CoCreateInstance.restype = ctypes.c_long
    clsid = GUID.parse("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")
    iid = GUID.parse("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")
    modes = {"fill": 0, "fit": 1, "stretch": 2, "tile": 3, "center": 4, "span": 5}
    mode = modes.get(fit.lower())
    if mode is None:
        raise WallpaperError("Fit mode must be Fill, Fit, Stretch, Tile, Center, or Span.")
    initialized = ole32.CoInitialize(None) >= 0
    pointer = ctypes.c_void_p()
    try:
        hr = ole32.CoCreateInstance(ctypes.byref(clsid), None, 23, ctypes.byref(iid), ctypes.byref(pointer))
        if hr < 0 or not pointer.value:
            raise WallpaperError(f"Could not access the Windows desktop wallpaper service (0x{hr & 0xffffffff:08X}).")
        table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        call_position = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_int)(table[10])
        call_wallpaper = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_wchar_p,
                                            ctypes.c_wchar_p)(table[3])
        hr = call_position(pointer, mode)
        if hr < 0:
            raise WallpaperError(f"Windows rejected the fit mode (0x{hr & 0xffffffff:08X}).")
        hr = call_wallpaper(pointer, monitor_id, str(path))
        if hr < 0:
            raise WallpaperError(f"Windows could not set the wallpaper (0x{hr & 0xffffffff:08X}).")
    finally:
        if pointer.value:
            table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])
            release(pointer)
        if initialized:
            ole32.CoUninitialize()


def get_windows_monitors() -> list[dict[str, str]]:
    """Return IDesktopWallpaper device-path IDs usable by the per-monitor setter."""
    import ctypes
    import uuid

    class GUID(ctypes.Structure):
        _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                    ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]

        @classmethod
        def parse(cls, value: str):
            return cls.from_buffer_copy(uuid.UUID(value).bytes_le)

    ole32 = ctypes.OleDLL("ole32")  # type: ignore[attr-defined]
    ole32.CoInitialize.argtypes = [ctypes.c_void_p]
    ole32.CoInitialize.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoCreateInstance.argtypes = [ctypes.POINTER(GUID), ctypes.c_void_p, ctypes.c_uint32,
                                       ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    ole32.CoCreateInstance.restype = ctypes.c_long
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    initialized = ole32.CoInitialize(None) >= 0
    pointer = ctypes.c_void_p()
    try:
        clsid = GUID.parse("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")
        iid = GUID.parse("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")
        hr = ole32.CoCreateInstance(ctypes.byref(clsid), None, 23, ctypes.byref(iid), ctypes.byref(pointer))
        if hr < 0 or not pointer.value:
            raise WallpaperError(f"Could not enumerate Windows displays (0x{hr & 0xffffffff:08X}).")
        table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        get_count = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint))(table[6])
        get_path = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_uint,
                                      ctypes.POINTER(ctypes.c_wchar_p))(table[5])
        count = ctypes.c_uint()
        hr = get_count(pointer, ctypes.byref(count))
        if hr < 0:
            raise WallpaperError(f"Windows could not read display count (0x{hr & 0xffffffff:08X}).")
        monitors = []
        for index in range(count.value):
            path = ctypes.c_wchar_p()
            hr = get_path(pointer, index, ctypes.byref(path))
            if hr < 0:
                continue
            try:
                device = path.value or ""
                monitors.append({"id": device, "name": device.rsplit("#", 2)[-2] if "#" in device else device})
            finally:
                ole32.CoTaskMemFree(ctypes.cast(path, ctypes.c_void_p))
        return monitors
    finally:
        if pointer.value:
            table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(pointer)
        if initialized:
            ole32.CoUninitialize()


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
    if "kde" in desktop:
        if not shutil.which("plasma-apply-wallpaperimage"):
            raise UnsupportedPlatform("KDE needs plasma-apply-wallpaperimage to change the wallpaper.")
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
            try:
                _run(["gsettings", "set", schema, "picture-uri-dark", uri])
            except WallpaperError as exc:
                # Older GNOME versions have no separate dark key. The main
                # wallpaper already succeeded; do not falsely report failure.
                log.warning("The main wallpaper was applied, but the optional dark background was not: %s", exc)
        return
    raise UnsupportedPlatform(
        "Setting the wallpaper is supported on Windows, macOS, GNOME, Cinnamon, MATE and KDE."
    )


def set_desktop_wallpaper(path: Path, *, fit: str = "Fill", monitor_id: str | None = None) -> None:
    """Apply an image; Windows supports IDesktopWallpaper fit and monitor options."""
    path = Path(path).resolve()
    if not path.is_file():
        raise WallpaperError("The image file does not exist on this machine.")
    system = platform.system()
    if system == "Windows":
        if fit.lower() == "fill" and monitor_id is None:
            _set_windows(path)
        else:
            _set_windows_advanced(path, fit, monitor_id)
    elif system == "Darwin":
        if monitor_id is not None or fit.lower() != "fill":
            raise UnsupportedPlatform("Fit and per-monitor options are currently supported on Windows only.")
        _set_macos(path)
    elif system == "Linux":
        if monitor_id is not None or fit.lower() != "fill":
            raise UnsupportedPlatform("Fit and per-monitor options are currently supported on Windows only.")
        _set_linux(path)
    else:
        raise UnsupportedPlatform(f"Setting the wallpaper is not supported on {system}.")
