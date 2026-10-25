from __future__ import annotations

import json

from scripts.check_catalog import check_catalog


def test_catalog_health_accepts_valid_assets(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "images" / "peapix").mkdir(parents=True)
    filename = "peapix/ok.jpg"
    (tmp_path / "images" / filename).write_bytes(b"asset")
    (tmp_path / "data" / "wallpapers.json").write_text(json.dumps([{
        "id": 1, "source": "peapix", "title": "A place",
        "source_url": "https://example.org/image.jpg",
        "page_url": "https://example.org/wallpaper/1", "filename": filename,
        "width": 1920, "height": 1080, "colors": "[\"#abcdef\"]",
        "aspect_ratio": "landscape",
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
    assert any("not a safe absolute HTTP(S) URL" in error for error in errors)
    assert any("page_url is empty" in error for error in errors)
    assert any("missing images/" in error for error in errors)


def test_catalog_health_rejects_duplicate_ids_unsafe_urls_and_bad_metadata(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "images" / "peapix").mkdir(parents=True)
    for name in ("one.jpg", "two.jpg"):
        (tmp_path / "images" / "peapix" / name).write_bytes(b"asset")
    rows = [
        {"id": 7, "source": "peapix", "title": "One", "source_url": "https://user:secret@example.org/a",
         "page_url": "https://[broken", "filename": "peapix/one.jpg", "width": 0, "height": 1,
         "colors": "not-json", "aspect_ratio": "square"},
        {"id": 7, "source": "peapix", "title": "Two", "source_url": "https://example.org/b",
         "page_url": "https://example.org/2", "filename": "peapix/two.jpg", "width": 10, "height": 10},
    ]
    (tmp_path / "data" / "wallpapers.json").write_text(json.dumps(rows), encoding="utf-8")
    errors = check_catalog(tmp_path)
    assert any("duplicate id" in error for error in errors)
    assert sum("safe absolute HTTP(S) URL" in error for error in errors) == 2
    assert any("width must be a positive integer" in error for error in errors)
    assert any("colors must be a JSON array" in error for error in errors)
    assert any("invalid aspect_ratio" in error for error in errors)
