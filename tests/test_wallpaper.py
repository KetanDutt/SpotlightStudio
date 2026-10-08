from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from src import wallpaper
from src.wallpaper import UnsupportedPlatform, WallpaperError, set_desktop_wallpaper


@pytest.fixture()
def image(tmp_path):
    path = tmp_path / "wall paper.jpg"
    path.write_bytes(b"jpeg")
    return path


class Recorder:
    def __init__(self, returncode=0, stderr=""):
        self.calls, self.returncode, self.stderr = [], returncode, stderr

    def __call__(self, cmd, **_kwargs):
        self.calls.append(cmd)
        return subprocess.CompletedProcess(cmd, self.returncode, stdout="", stderr=self.stderr)


def test_missing_file_is_a_clear_error(tmp_path):
    with pytest.raises(WallpaperError, match="does not exist"):
        set_desktop_wallpaper(tmp_path / "nope.jpg")


def test_windows_dispatch(image, monkeypatch):
    seen = []
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Windows")
    monkeypatch.setattr(wallpaper, "_set_windows", lambda path: seen.append(path))
    set_desktop_wallpaper(image)
    assert seen == [image.resolve()]


def test_macos_uses_osascript(image, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(wallpaper.subprocess, "run", rec)
    set_desktop_wallpaper(image)
    (cmd,) = rec.calls
    assert cmd[0] == "osascript" and "POSIX file" in cmd[2] and "wall paper.jpg" in cmd[2]


def test_macos_script_escapes_quotes_and_backslashes(monkeypatch):
    # Calls the helper directly: going through set_desktop_wallpaper() needs a real file, and a double
    # quote is not a legal character in a Windows file name (this test also runs on the Windows CI job).
    rec = Recorder()
    monkeypatch.setattr(wallpaper.subprocess, "run", rec)
    wallpaper._set_macos(Path('my "best" pic\\copy.jpg'))
    (cmd,) = rec.calls
    assert cmd[0] == "osascript" and 'POSIX file "my \\"best\\" pic\\\\copy.jpg"' in cmd[2]


def test_gnome_sets_light_and_dark_uris(image, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Linux")
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "GNOME")
    monkeypatch.setattr(wallpaper.shutil, "which", lambda name: f"/usr/bin/{name}" if name == "gsettings" else None)
    monkeypatch.setattr(wallpaper.subprocess, "run", rec)
    set_desktop_wallpaper(image)
    keys = [c[3] for c in rec.calls]
    assert keys == ["picture-uri", "picture-uri-dark"]
    assert all(c[:3] == ["gsettings", "set", "org.gnome.desktop.background"] for c in rec.calls)
    assert rec.calls[0][4].startswith("file:///") and "wall%20paper.jpg" in rec.calls[0][4]


def test_kde_prefers_plasma_tool(image, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Linux")
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "KDE")
    monkeypatch.setattr(wallpaper.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(wallpaper.subprocess, "run", rec)
    set_desktop_wallpaper(image)
    assert rec.calls == [["plasma-apply-wallpaperimage", str(image.resolve())]]


def test_unsupported_environments(image, monkeypatch):
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Linux")
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "i3")
    monkeypatch.setattr(wallpaper.shutil, "which", lambda name: None)
    with pytest.raises(UnsupportedPlatform):
        set_desktop_wallpaper(image)
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Plan9")
    with pytest.raises(UnsupportedPlatform, match="Plan9"):
        set_desktop_wallpaper(image)


def test_command_failures_become_wallpaper_errors(image, monkeypatch):
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(wallpaper.subprocess, "run", Recorder(returncode=1, stderr="not allowed"))
    with pytest.raises(WallpaperError, match="not allowed"):
        set_desktop_wallpaper(image)

    def missing(*_a, **_k):
        raise FileNotFoundError("osascript")

    monkeypatch.setattr(wallpaper.subprocess, "run", missing)
    with pytest.raises(WallpaperError, match="Could not run"):
        set_desktop_wallpaper(image)


def test_older_gnome_missing_dark_key_does_not_negate_a_success(image, monkeypatch, caplog):
    calls = []
    def run(cmd, **_kwargs):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, int(cmd[3] == "picture-uri-dark"), stdout="", stderr="No such key")
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "GNOME")
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Linux")
    monkeypatch.setattr(wallpaper.shutil, "which", lambda name: "/usr/bin/gsettings")
    monkeypatch.setattr(wallpaper.subprocess, "run", run)
    set_desktop_wallpaper(image)
    assert len(calls) == 2
    assert "main wallpaper was applied" in caplog.text


def test_kde_without_helper_does_not_silently_set_an_unused_gnome_schema(image, monkeypatch):
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "KDE")
    monkeypatch.setattr(wallpaper.platform, "system", lambda: "Linux")
    monkeypatch.setattr(wallpaper.shutil, "which", lambda name: "/usr/bin/gsettings" if name == "gsettings" else None)
    with pytest.raises(UnsupportedPlatform, match="KDE needs"):
        set_desktop_wallpaper(image)
