from __future__ import annotations

import json

from scripts.check_catalog import check_catalog


def test_catalog_health_accepts_valid_assets(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "images" / "peapix").mkdir(parents=True)
    filename = "peapix/ok.jpg"
    (tmp_path / "images" / filename).write_bytes(b"asset")
    (tmp_path / "data" / "wallpapers.json").write_text(json.dumps([{
        "title": "A place", "source_url": "https://example.org/image.jpg",
        "page_url": "https://example.org/wallpaper/1", "filename": filename,
        "width": 1920, "height": 1080,
    }]), encoding="utf-8")
    assert check_catalog(tmp_path) == []


def test_catalog_health_rejects_empty_titles_invalid_urls_and_missing_files(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "wallpapers.json").write_text(json.dumps([{
        "title": "  ", "source_url": "javascript:alert(1)", "page_url": "",
        "filename": "missing.jpg", "width": 1920, "height": 1080,
    }]), encoding="utf-8")
    errors = check_catalog(tmp_path)
    assert any("title is empty" in error for error in errors)
    assert any("not an absolute HTTP(S) URL" in error for error in errors)
    assert any("page_url is empty" in error for error in errors)
    assert any("missing images/" in error for error in errors)
