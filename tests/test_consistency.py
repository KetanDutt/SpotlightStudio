"""
Project-wide invariants.  These tests exist because the original repository drifted in exactly
these ways: versions disagreed, docs described code that did not exist, inline scripts crept in,
settings were undocumented.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from dotenv import dotenv_values
from PIL import Image

from src import __version__
from src.config import Settings
from src.security import CONTENT_SECURITY_POLICY

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ── versions ────────────────────────────────────────────────────────────────


def test_versions_agree_everywhere():
    index = read("index.html")
    assert re.search(r'<meta name="app-version" content="([^"]+)"', index).group(1) == __version__
    assert set(re.findall(r"\?v=([0-9.]+)", index)) == {__version__}, "every asset URL needs ?v=<version>"
    assert re.search(r'const VERSION = "([^"]+)"', read("sw.js")).group(1) == __version__
    assert f"badge/version-{__version__}-" in read("README.md")
    first_release = re.search(r"^## \[(\d+\.\d+\.\d+)\]", read("CHANGELOG.md"), re.MULTILINE).group(1)
    assert first_release == __version__
    assert Settings.VERSION == __version__


# ── security invariants of the UI ───────────────────────────────────────────


def test_csp_meta_equals_the_server_policy():
    meta = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', read("index.html"))
    assert meta, "index.html must carry the CSP meta tag (it protects the static GitHub Pages site)"
    assert meta.group(1) == CONTENT_SECURITY_POLICY


def test_index_html_has_no_inline_code():
    html = read("index.html")
    assert not re.search(r"<script(?![^>]*\bsrc=)", html), "inline <script> is forbidden by the CSP"
    assert "<style" not in html
    assert not re.search(r"\sstyle\s*=", html), "inline style attributes are forbidden by the CSP"
    assert not re.search(r"\son[a-z]+\s*=", html, re.IGNORECASE), "inline event handlers are forbidden"
    assert "javascript:" not in html.lower()


def test_app_js_has_no_dangerous_sinks():
    js = read("static/js/app.js")
    assert len(re.findall(r"\.innerHTML\s*=", js)) == 1, "innerHTML is only allowed for the static icon constants"
    assert re.search(r"svg\.innerHTML = ICONS\[", js)
    for sink in ("outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
        assert sink not in js, sink
    assert 'setAttribute("style"' not in js and "cssText" not in js, "inline styles are blocked by the CSP"


def test_every_element_id_used_by_app_js_exists():
    html_ids = set(re.findall(r'\sid="([^"]+)"', read("index.html")))
    used = set(re.findall(r'\$\("([^"]+)"\)', read("static/js/app.js")))
    assert used - html_ids == set()


# ── PWA assets ──────────────────────────────────────────────────────────────


def _asset_path(url: str) -> Path:
    clean = url.split("?")[0]
    return ROOT / ("index.html" if clean in {"./", ""} else clean)


def test_service_worker_precache_list_exists():
    sw = read("sw.js")
    block = re.search(r"const SHELL = \[(.*?)\];", sw, re.DOTALL).group(1)
    urls = [u.replace("${VERSION}", __version__) for u in re.findall(r'[`"]([^`"]+)[`"]', block)]
    assert len(urls) >= 8
    for url in urls:
        assert _asset_path(url).is_file(), url


def test_assets_referenced_by_index_exist():
    html = read("index.html")
    for url in re.findall(r'(?:href|src)="((?:static|data)/[^"]+|manifest\.webmanifest)"', html):
        if url.startswith("data/"):
            continue  # generated at runtime
        assert _asset_path(url).is_file(), url


def test_manifest_is_valid_and_icons_have_the_declared_size():
    manifest = json.loads(read("manifest.webmanifest"))
    assert manifest["name"] == "Spotlight Studio" and manifest["display"] == "standalone"
    assert manifest["orientation"] == "any", "a landscape lock makes the phone UI unusable"
    purposes = set()
    for icon in manifest["icons"]:
        path = ROOT / icon["src"]
        assert path.is_file(), icon["src"]
        purposes.add(icon["purpose"])
        if icon["type"] == "image/png":
            assert "x".join(map(str, Image.open(path).size)) == icon["sizes"], icon["src"]
    assert {"any", "maskable"} <= purposes
    assert _asset_path(manifest["shortcuts"][0]["icons"][0]["src"]).is_file()


# ── configuration & documentation ───────────────────────────────────────────


def _config_env_names() -> set[str]:
    source = read("src/config.py")
    names = set(re.findall(r'_env_(?:str|int|float|bool|list)\(\s*"([A-Z0-9_]+)"', source))
    names |= set(re.findall(r'os\.getenv\(\s*"([A-Z0-9_]+)"', source))
    return names


def test_every_setting_is_documented():
    names = _config_env_names()
    assert len(names) >= 25
    example, reference = read(".env.example"), read("docs/CONFIGURATION.md")
    for name in sorted(names):
        assert re.search(rf"^#?\s*{name}=", example, re.MULTILINE), f"{name} missing from .env.example"
        assert f"`{name}`" in reference, f"{name} missing from docs/CONFIGURATION.md"


def test_env_example_yields_the_default_settings(monkeypatch):
    values = dotenv_values(ROOT / ".env.example")
    names = _config_env_names() | set(values)
    for name in names:
        monkeypatch.delenv(name, raising=False)
    defaults = vars(Settings())
    for key, value in values.items():
        monkeypatch.setenv(key, value or "")
    assert vars(Settings()) == defaults, "the values in .env.example must be the real defaults"


def _markdown_files() -> list[Path]:
    return [ROOT / n for n in ("README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md")] + sorted(
        (ROOT / "docs").glob("*.md")
    )


def test_relative_markdown_links_and_images_resolve():
    broken = []
    for md in _markdown_files():
        text = md.read_text(encoding="utf-8")
        for target in re.findall(r"\]\(([^)\s]+)\)", text) + re.findall(r'src="([^"]+)"', text):
            if re.match(r"^(https?:|mailto:|#)", target):
                continue
            path = (md.parent / target.split("#")[0]).resolve()
            if not path.exists():
                broken.append(f"{md.relative_to(ROOT)} → {target}")
    assert broken == []


def test_markdown_anchors_point_to_existing_headings():
    def slug(heading: str) -> str:
        text = re.sub(r"[`*_]", "", heading.strip().lower())
        text = re.sub(r"[^\w\- ]", "", text)
        return text.replace(" ", "-")

    anchors = {}
    for md in _markdown_files():
        anchors[md] = {slug(h) for h in re.findall(r"^#{1,6}\s+(.+)$", md.read_text(encoding="utf-8"), re.MULTILINE)}
    broken = []
    for md in _markdown_files():
        for target in re.findall(r"\]\(([^)\s]+#[^)\s]+)\)", md.read_text(encoding="utf-8")):
            if target.startswith("http"):
                continue
            file_part, anchor = target.split("#", 1)
            path = (md.parent / file_part).resolve() if file_part else md
            if path in anchors and anchor not in anchors[path]:
                broken.append(f"{md.relative_to(ROOT)} → {target}")
    assert broken == []


def test_api_documentation_covers_every_route():
    from src.api import create_app

    paths = create_app().openapi()["paths"]
    doc = read("docs/API.md")
    missing = [p for p in paths if p.replace("{wallpaper_id}", "{id}") not in doc]
    assert missing == []


def test_readme_claims_match_reality():
    readme = read("README.md")
    for launcher in ("start_desktop.bat", "start_server.bat", "start_update.bat"):
        assert (ROOT / launcher).is_file() and launcher in readme
    assert (ROOT / "docs/assets/screenshot-gallery.jpg").is_file()
    assert "MIT" not in readme, "the LICENSE file is 'All Rights Reserved' – never claim MIT"
    assert "All Rights Reserved" in read("LICENSE")


# ── dependencies & repository hygiene ───────────────────────────────────────


def test_runtime_requirements_are_lean_and_bounded():
    lines = [ln.strip() for ln in read("requirements.txt").splitlines() if ln.strip() and not ln.startswith("#")]
    names = {re.split(r"[<>=;\[ ]", ln, maxsplit=1)[0].lower() for ln in lines}
    assert names == {"aiohttp", "beautifulsoup4", "fastapi", "pillow", "python-dotenv", "uvicorn", "pywebview"}
    assert not any("uvicorn[standard]" in ln for ln in lines)
    assert all("<" in ln for ln in lines if not ln.lower().startswith(("pillow", "pywebview")))


def test_gitignore_keeps_sqlite_side_files_and_artifacts_out():
    ignore = read(".gitignore")
    for pattern in ("data/*.db-wal", "data/*.db-shm", ".env", "*.log", "__pycache__/", ".venv/"):
        assert pattern in ignore, pattern
    attributes = read(".gitattributes")
    assert "images/** filter=lfs" in attributes and "*.bat text eol=crlf" in attributes


@pytest.mark.skipif(shutil.which("git") is None or not (ROOT / ".git").exists(), reason="not a git checkout")
def test_no_runtime_artifacts_are_tracked():
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    forbidden = [f for f in tracked if f.endswith(("-wal", "-shm", ".log", ".pyc")) or f.startswith("templates/")]
    assert forbidden == []
    assert "data/wallpapers.min.json" not in tracked
    assert {"data/wallpapers.db", "data/wallpapers.json"} <= set(tracked)
