from __future__ import annotations

import io
import random

from PIL import Image

from src import database as db
from src import maintenance, storage
from src.config import settings
from src.hashing import dhash_hex
from tests.conftest import add_wallpaper, add_wallpaper_with_files, random_phash
from tests.fake_site import make_picture


def _near(phash: str, bits: int = 2) -> str:
    return f"{int(phash, 16) ^ ((1 << bits) - 1):064x}"


def test_dedupe_keeps_best_copy_merges_metadata_and_cleans_up(env):
    base = random_phash()
    good = add_wallpaper_with_files(phash=base, width=3840, height=2160, file_size=3_000_000, title="Real title",
                                    tags="lake", source_url="https://x/good.jpg")
    worse = add_wallpaper_with_files(phash=_near(base), width=1920, height=1080, file_size=900_000,
                                     title="dfffe373d9c78e79e0d6a28ac186d8c5", tags="chile,lake",
                                     date_spotted="2018-01-01", source_url="https://x/worse.jpg",
                                     filename="win10spotlight/worse.jpg", source="win10spotlight")
    worst = add_wallpaper_with_files(phash=_near(base, 3), width=1280, height=720, file_size=100_000,
                                     source_url="https://x/worst.jpg", filename="win10spotlight/worst.jpg",
                                     source="win10spotlight", tags="")
    unrelated = add_wallpaper_with_files(source_url="https://x/other.jpg")

    assert maintenance.deduplicate_downloaded_wallpapers() == 2
    assert db.get_wallpaper(good["id"]) and db.get_wallpaper(unrelated["id"])
    assert db.get_wallpaper(worse["id"]) is None and db.get_wallpaper(worst["id"]) is None
    keeper = db.get_wallpaper(good["id"])
    assert keeper["tags"] == "lake,chile" and keeper["date_spotted"] == "2026-01-01"
    assert keeper["title"] == "Real title"
    for victim in (worse, worst):
        assert not storage.image_path(victim["filename"]).exists()
        assert not storage.thumb_path(victim["filename"]).exists()
    assert db.is_url_suppressed("https://x/worse.jpg") and db.is_url_suppressed("https://x/worst.jpg")
    assert not db.is_url_suppressed("https://x/good.jpg")
    assert db.get_stat("duplicates_replaced") == "2"
    assert maintenance.deduplicate_downloaded_wallpapers() == 0               # idempotent


def test_dedupe_ignores_distinct_images_and_small_libraries(env):
    assert maintenance.deduplicate_downloaded_wallpapers() == 0
    add_wallpaper()
    assert maintenance.deduplicate_downloaded_wallpapers() == 0
    for _ in range(30):
        add_wallpaper()
    assert maintenance.deduplicate_downloaded_wallpapers() == 0
    assert db.count_wallpapers() == 31


def test_missing_thumbnails_are_rebuilt_but_lfs_pointers_skipped(env):
    ok = add_wallpaper_with_files()
    storage.thumb_path(ok["filename"]).unlink()
    pointer = add_wallpaper(filename="peapix/pointer.jpg")
    path = storage.image_path(pointer["filename"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")
    add_wallpaper(filename="peapix/not-on-disk.jpg")
    assert maintenance.create_missing_thumbnails() == 1
    thumb = Image.open(storage.thumb_path(ok["filename"]))
    assert thumb.size == (480, 270)
    assert maintenance.create_missing_thumbnails() == 0


def test_verify_library_reports_every_kind_of_problem(env):
    healthy = add_wallpaper_with_files()
    report = maintenance.verify_library()
    assert report["ok"] and report["wallpapers"] == 1

    gone = add_wallpaper(filename="peapix/gone.jpg")
    no_thumb = add_wallpaper_with_files()
    storage.thumb_path(no_thumb["filename"]).unlink()
    orphan = settings.IMAGES_DIR / "peapix" / "orphan.jpg"
    orphan.write_bytes(b"x")
    bad_hash = add_wallpaper_with_files(phash="zz" + "0" * 62)
    dup_a = random_phash()
    add_wallpaper_with_files(phash=dup_a)
    add_wallpaper_with_files(phash=_near(dup_a))

    report = maintenance.verify_library()
    assert not report["ok"]
    assert report["missing_images"] == [gone["filename"]] and report["missing_images_count"] == 1
    assert report["missing_thumbnails_count"] == 2                            # `gone` + `no_thumb`
    assert report["orphan_images"] == ["peapix/orphan.jpg"]
    assert report["invalid_hash_count"] == 1 and report["duplicate_pairs"] == 1
    assert healthy["filename"] not in report["missing_images"] and bad_hash


def test_legacy_flat_layout_is_migrated(env):
    flat_name = "abc.jpg"
    for base in (settings.IMAGES_DIR, settings.THUMBS_DIR):
        base.mkdir(parents=True, exist_ok=True)
        (base / flat_name).write_bytes(make_picture(1))
    row = add_wallpaper(filename=flat_name, source="peapix")
    result = maintenance.migrate_storage_to_source_folders()
    assert result == {"moved_images": 1, "moved_thumbs": 1, "updated_db": 1}
    assert db.get_wallpaper(row["id"])["filename"] == "peapix/abc.jpg"
    assert storage.image_path("peapix/abc.jpg").is_file() and not (settings.IMAGES_DIR / flat_name).exists()
    assert maintenance.migrate_storage_to_source_folders() == {"moved_images": 0, "moved_thumbs": 0, "updated_db": 0}


def test_startup_tasks_are_idempotent_and_reset_stale_state(env, caplog):
    db.set_stat("status", "running")
    db.enqueue_download({"image_url": "https://i/1.jpg", "source": "peapix"})
    db.claim_download_item()
    row = add_wallpaper(filename="peapix/ptr.jpg")
    path = storage.image_path(row["filename"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")
    with caplog.at_level("WARNING"):
        maintenance.startup_tasks()
        maintenance.startup_tasks()
    assert db.get_stat("status") == "stopped"
    assert db.claim_download_item() is not None                               # stale claim released
    assert "git lfs pull" in caplog.text
    assert settings.CATALOG_PATH.is_file()


def test_storage_helpers(env):
    assert storage.clean_source("peapix/../x") == "peapixx" and storage.clean_source("") == "other"
    name = storage.url_to_filename("peapix", "https://img/x.jpg")
    assert name == storage.url_to_filename("peapix", "https://img/x.jpg") and name.startswith("peapix/")
    assert name.endswith(".jpg") and len(name.split("/")[1]) == 36
    for evil in ("../x.jpg", "peapix/../../etc/passwd", "/etc/passwd"):
        try:
            storage.image_path(evil)
        except ValueError:
            continue
        raise AssertionError(f"{evil!r} escaped the storage root")
    assert storage.delete_wallpaper_files("peapix/never-existed.jpg") == 0
    storage.write_image("peapix/a.jpg", b"1")
    storage.write_thumbnail("peapix/a.jpg", b"2")
    assert storage.delete_wallpaper_files("peapix/a.jpg") == 2
    img = Image.new("RGB", (4, 4))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    assert dhash_hex(img) == "0" * 64 and random.random() >= 0
    assert storage.count_lfs_pointers() == (0, 0)
