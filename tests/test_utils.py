from __future__ import annotations

import pytest

from src import utils


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("May 14, 2025", "2025-05-14"),
        ("September 19, 2026", "2026-09-19"),
        ("Sept 3, 2026", "2026-09-03"),
        ("Sep 3 2026", "2026-09-03"),
        ("3 March 2024", "2024-03-03"),
        ("1st Jan 2020", "2020-01-01"),
        ("2018-11-27", "2018-11-27"),
        ("2018-11-27T10:00:00+00:00", "2018-11-27"),
        ("2018/11/27", "2018-11-27"),
        ("", ""),
        (None, ""),
        ("not a date", ""),
        ("February 30, 2025", ""),
        ("Smarch 3, 2025", ""),
    ],
)
def test_normalize_date(raw, expected):
    assert utils.normalize_date(raw) == expected


@pytest.mark.parametrize(
    ("title", "placeholder"),
    [
        ("dfffe373d9c78e79e0d6a28ac186d8c5", True),
        ("DFFFE373D9C78E79E0D6A28AC186D8C5", True),
        ("", True),
        (None, True),
        ("Windows Spotlight", True),
        ("windows spotlight wallpaper", True),
        ("Windows Spotlight Images", True),
        ("Lake Pehoe, Chile", False),
        ("Beach 2024", False),
        ("a1b2c3", False),  # short hex-looking words are legitimate titles
    ],
)
def test_is_placeholder_title(title, placeholder):
    assert utils.is_placeholder_title(title) is placeholder


def test_choose_title_prefers_informative():
    hash_title = "dfffe373d9c78e79e0d6a28ac186d8c5"
    assert utils.choose_title(hash_title, "Real Title") == "Real Title"
    assert utils.choose_title("Existing", "Other") == "Existing"
    assert utils.choose_title("Existing", hash_title) == "Existing"
    assert utils.choose_title("", "") == utils.DEFAULT_TITLE


def test_tags_are_normalised_and_merged():
    assert utils.normalize_tags(" Lake, lake ,NATURE,, Palm  Tree ") == "lake,nature,palm tree"
    assert utils.merge_tags("a,b", "B,c", None) == "a,b,c"
    assert utils.split_tags(None) == []
    assert utils.split_tags(["X", "x", "y"]) == ["x", "y"]


def test_quality_helpers():
    assert utils.quality_label(3840) == utils.QUALITY_4K
    assert utils.quality_label(2560) == utils.QUALITY_2K
    assert utils.quality_label(1920) == utils.QUALITY_FHD
    assert utils.quality_label(1280) == utils.QUALITY_HD
    assert utils.quality_label(640) == utils.QUALITY_SD
    assert utils.canonical_quality("FHD", 1920) == utils.QUALITY_FHD
    assert utils.canonical_quality("UHD", 3840) == utils.QUALITY_4K
    assert utils.canonical_quality(None, 3840) == utils.QUALITY_4K
    assert utils.quality_score(3840, 2160, 1) > utils.quality_score(1920, 1080, 10**9)
    assert utils.quality_score(1920, 1080, 2) > utils.quality_score(1920, 1080, 1)


def test_normalize_timestamp():
    assert utils.normalize_timestamp("2026-10-01T10:08:17.213612") == "2026-10-01T10:08:17.213612+00:00"
    assert utils.normalize_timestamp("2026-10-01T10:08:17+00:00") == "2026-10-01T10:08:17+00:00"
    assert utils.normalize_timestamp("2026-10-01T10:08:17Z") == "2026-10-01T10:08:17Z"
    assert utils.normalize_timestamp("") == ""


def test_csv_safe_neutralises_formulas():
    for evil in ("=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tTAB"):
        assert utils.csv_safe(evil).startswith("'")
    assert utils.csv_safe("Normal title") == "Normal title"
    assert utils.csv_safe(None) == ""
    assert utils.csv_safe(42) == "42"


def test_escape_like():
    assert utils.escape_like("100%_a\\b") == "100\\%\\_a\\\\b"


def test_atomic_write_and_lfs_detection(tmp_path):
    target = tmp_path / "sub" / "file.bin"
    utils.atomic_write_bytes(target, b"hello")
    assert target.read_bytes() == b"hello"
    assert not list(target.parent.glob("*.part"))
    utils.atomic_write_bytes(target, b"world")
    assert target.read_bytes() == b"world"

    pointer = tmp_path / "ptr.jpg"
    pointer.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n")
    assert utils.is_lfs_pointer(pointer)
    assert not utils.is_lfs_pointer(target)
    assert not utils.is_lfs_pointer(tmp_path / "missing.jpg")
    big = tmp_path / "big.jpg"
    big.write_bytes(b"version https://git-lfs.github.com/spec/v1\n" + b"x" * 5000)
    assert not utils.is_lfs_pointer(big)  # too large to be a pointer
