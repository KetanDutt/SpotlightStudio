from __future__ import annotations

import csv
import io
import json
import time

import pytest
from fastapi.testclient import TestClient

from src import api as api_mod
from src import database as db
from src import storage
from src.api import create_app
from src.config import settings
from src.engine import DownloadEngine
from src.security import CONTENT_SECURITY_POLICY
from src.wallpaper import UnsupportedPlatform, WallpaperError
from tests.conftest import add_wallpaper, add_wallpaper_with_files


@pytest.fixture()
def eng(env):
    engine = DownloadEngine()
    yield engine
    engine.shutdown(20)


@pytest.fixture()
def client(env, eng):
    app = create_app(settings, eng)
    with TestClient(app, base_url="http://127.0.0.1") as test_client:
        yield test_client


# ── System ─────────────────────────────────────────────────────────────────


def test_health(client):
    add_wallpaper()
    body = client.get("/api/health").json()
    assert body["status"] == "healthy" and body["version"] == settings.VERSION
    assert body["library_count"] == body["downloaded_count"] == 1
    assert body["engine_status"] == "stopped" and body["lfs_pointers_detected"] is False
    assert {"scrape_queue_size", "download_queue_size", "time"} <= set(body)


def test_status_shape_and_counters(client):
    add_wallpaper(source="peapix")
    add_wallpaper(source="win10spotlight")
    status = client.get("/api/status").json()
    assert status["engine_status"] == "stopped" and status["mode"] == "full"
    assert status["library_count"] == 2 and status["source_stats"]["total_available"] == 2
    assert status["progress_pct"] == 0 and status["last_run"] is None
    assert status["library_signature"] == db.library_signature()
    assert {"concurrent_downloads", "quick_update_pages"} <= set(status["config"])
    assert {"pages_total", "downloaded", "result"} <= set(status["run"])


def test_lfs_pointer_detection_in_health(client):
    row = add_wallpaper(filename="peapix/pointer.jpg")
    target = storage.image_path(row["filename"])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")
    assert client.get("/api/health").json()["lfs_pointers_detected"] is True


# ── Control ────────────────────────────────────────────────────────────────


def test_control_start_pause_stop_roundtrip(site, client, eng):
    site.slow = 0.2
    started = client.post("/api/control/start", params={"source": "peapix", "mode": "full"}).json()
    assert started["result"] == "started" and started["status"] == "running"
    assert started["active_source"] == "peapix" and started["mode"] == "full"
    paused = client.post("/api/control/pause").json()
    assert paused["status"] == "paused"
    assert client.get("/api/status").json()["engine_status"] == "paused"
    resumed = client.post("/api/control/start", params={"source": "peapix"}).json()
    assert resumed["result"] == "resumed"
    stopped = client.post("/api/control/stop").json()
    assert stopped["status"] in {"stopping", "stopped"}
    assert eng.wait(20)
    assert client.get("/api/status").json()["engine_status"] == "stopped"


def test_control_validation(client):
    assert client.post("/api/control/start", params={"source": "bogus"}).status_code == 422
    assert client.post("/api/control/start", params={"mode": "bogus"}).status_code == 422


def test_quick_crawl_via_api_updates_status(site, client, eng):
    client.post("/api/control/start", params={"source": "peapix", "mode": "quick"})
    assert eng.wait(30)
    status = client.get("/api/status").json()
    assert status["library_count"] == 4 and status["progress_pct"] == 100
    assert status["last_run"]["result"] == "completed" and status["last_run"]["downloaded"] == 4


# ── Wallpapers ─────────────────────────────────────────────────────────────


def test_list_wallpapers_paging_search_and_validation(client):
    for i in range(7):
        add_wallpaper(title=f"Alpine lake {i}" if i < 3 else f"Desert {i}", tags="t")
    page = client.get("/api/wallpapers", params={"per_page": 3, "page": 3}).json()
    assert (page["total"], page["pages"], page["page"], len(page["wallpapers"])) == (7, 3, 3, 1)
    found = client.get("/api/wallpapers", params={"search": "alpine LAKE"}).json()
    assert found["total"] == 3
    asc = client.get("/api/wallpapers", params={"sort": "title", "order": "asc", "per_page": 7}).json()
    titles = [w["title"] for w in asc["wallpapers"]]
    assert titles == sorted(titles, key=str.lower)
    assert "phash" in asc["wallpapers"][0]
    for bad in ({"per_page": 201}, {"per_page": 0}, {"page": 0}, {"sort": "id; DROP"}, {"order": "sideways"},
                {"quality": "ultra"}):
        assert client.get("/api/wallpapers", params=bad).status_code == 422, bad


def test_random_get_and_image_redirect(client):
    row = add_wallpaper(filename="peapix/abc.jpg", source="peapix")
    assert client.get("/api/wallpapers/random").json()["id"] == row["id"]
    assert client.get("/api/wallpapers/random", params={"source": "nope"}).status_code == 404
    assert client.get(f"/api/wallpapers/{row['id']}").json()["filename"] == "peapix/abc.jpg"
    assert client.get("/api/wallpapers/99999").status_code == 404
    redirect = client.get(f"/api/wallpapers/{row['id']}/image", follow_redirects=False)
    assert redirect.status_code == 302 and redirect.headers["location"] == "/images/peapix/abc.jpg"
    assert client.get("/api/wallpapers/99999/image", follow_redirects=False).status_code == 404


def test_tags_endpoint(client):
    add_wallpaper(tags="a,b")
    add_wallpaper(tags="a")
    tags = client.get("/api/tags", params={"limit": 1}).json()
    assert tags == [{"tag": "a", "count": 2}]


# ── Catalog, exports ───────────────────────────────────────────────────────


def test_live_catalog_etag_and_conditional_get(client):
    add_wallpaper(title="One")
    first = client.get("/api/catalog")
    assert first.status_code == 200 and "phash" not in first.json()[0]
    etag = first.headers["etag"]
    assert client.get("/api/catalog", headers={"If-None-Match": etag}).status_code == 304
    add_wallpaper(title="Two")
    second = client.get("/api/catalog", headers={"If-None-Match": etag})
    assert second.status_code == 200 and len(second.json()) == 2 and second.headers["etag"] != etag


def test_catalog_is_gzipped_when_large(client):
    for _ in range(40):
        add_wallpaper(title="x" * 80)
    response = client.get("/api/catalog", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip" and len(response.json()) == 40
    # httpx decodes transparently: the wire size (content-length) must be far smaller than the payload.
    assert int(response.headers["content-length"]) < len(response.content) / 3


def test_json_export_streams_everything(client):
    for i in range(5):
        add_wallpaper(title=f"T{i}")
    response = client.get("/api/export/json")
    assert "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert len(data) == 5 and "phash" in data[0]


def test_csv_export_is_excel_friendly_and_formula_safe(client):
    add_wallpaper(title='=HYPERLINK("http://evil","click")', tags="a,b")
    add_wallpaper(title="Galápagos, \"quoted\"")
    response = client.get("/api/export/csv")
    text = response.content.decode("utf-8")
    assert text.startswith("\ufeff")                                       # BOM for Excel
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    assert rows[0][:3] == ["id", "phash", "filename"]
    titles = {r[3] for r in rows[1:]}
    assert "'=HYPERLINK(\"http://evil\",\"click\")" in titles               # neutralised
    assert 'Galápagos, "quoted"' in titles                                  # unicode + escaping survive


def test_catalog_sync_and_static_catalog(client):
    add_wallpaper()
    synced = client.post("/api/catalog/sync").json()
    assert synced["success"] and synced["wallpapers_synced"] == 1
    static = client.get("/data/wallpapers.json")
    assert static.status_code == 200 and len(static.json()) == 1
    settings.CATALOG_PATH.unlink()
    assert len(client.get("/data/wallpapers.json").json()) == 1             # regenerated on demand


def test_data_directory_is_not_browsable(client):
    add_wallpaper()
    settings.LOG_PATH.write_text("secret local paths")
    for path in ("/data/wallpapers.db", "/data/wallpapers.db-wal", "/data/downloader.log", "/data/", "/data"):
        assert client.get(path).status_code in {404, 405}, path


# ── Security ───────────────────────────────────────────────────────────────


def test_security_headers_and_csp_on_html(client):
    health = client.get("/api/health")
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    assert health.headers["referrer-policy"] == "no-referrer"
    page = client.get("/")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    csp = page.headers["content-security-policy"]
    assert csp.startswith(CONTENT_SECURITY_POLICY) and "frame-ancestors 'none'" in csp
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
    assert "content-security-policy" not in health.headers                    # only HTML documents


def test_unknown_host_header_is_rejected(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/health", headers={"Host": "localhost:8765"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "127.0.0.1:8765"}).status_code == 200


def test_cross_origin_state_changes_are_blocked(client):
    hostile = {"Origin": "https://evil.example"}
    assert client.post("/api/control/pause", headers=hostile).status_code == 403
    assert client.post("/api/control/stop", headers={"Origin": "null"}).status_code == 403
    assert client.post("/api/control/pause", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.post("/api/catalog/sync", headers=hostile).status_code == 403
    same_origin = {"Origin": "http://127.0.0.1", "Host": "127.0.0.1"}
    assert client.post("/api/control/pause", headers=same_origin).status_code == 200
    assert client.post("/api/control/pause").status_code == 200               # curl / scripts (no Origin)
    assert client.get("/api/health", headers=hostile).status_code == 200      # reads are not CSRF-sensitive


def test_cors_is_off_by_default_and_opt_in(env, eng, monkeypatch):
    app = create_app(settings, eng)
    with TestClient(app, base_url="http://127.0.0.1") as plain:
        pre = plain.options("/api/status", headers={"Origin": "https://evil.example",
                                                    "Access-Control-Request-Method": "GET"})
        assert "access-control-allow-origin" not in pre.headers
        assert "access-control-allow-origin" not in plain.get(
            "/api/status", headers={"Origin": "https://evil.example"}).headers

    monkeypatch.setattr(settings, "CORS_ORIGINS", ["https://dash.example"])
    with TestClient(create_app(settings, eng), base_url="http://127.0.0.1") as configured:
        ok = configured.get("/api/status", headers={"Origin": "https://dash.example"})
        assert ok.headers["access-control-allow-origin"] == "https://dash.example"
        assert configured.post("/api/control/pause", headers={"Origin": "https://dash.example"}).status_code == 200
        assert configured.post("/api/control/pause", headers={"Origin": "https://other.example"}).status_code == 403


def test_non_loopback_binding_accepts_any_host(env, eng, monkeypatch):
    monkeypatch.setattr(settings, "HOST", "0.0.0.0")
    with TestClient(create_app(settings, eng), base_url="http://192.168.1.20:8765") as lan:
        assert lan.get("/api/health").status_code == 200
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", ["spotlight.lan"])
    with TestClient(create_app(settings, eng), base_url="http://192.168.1.20:8765") as strict:
        assert strict.get("/api/health").status_code == 400


# ── Images & static assets ─────────────────────────────────────────────────


def test_images_are_cacheable_forever_and_traversal_is_blocked(client):
    row = add_wallpaper_with_files()
    image = client.get(f"/images/{row['filename']}")
    assert image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
    assert "immutable" in image.headers["cache-control"]
    assert "content-encoding" not in image.headers                            # never gzip a JPEG
    assert client.get(f"/images/thumbs/{row['filename']}").status_code == 200
    for path in ("/images/../data/wallpapers.db", "/images/%2e%2e/data/wallpapers.db",
                 "/images/..%2fdata%2fwallpapers.db"):
        assert client.get(path).status_code in {400, 404}, path


def test_ui_shell_and_pwa_files(client):
    index = client.get("/")
    assert index.status_code == 200 and "Spotlight Studio" in index.text
    assert index.headers["cache-control"] == "no-cache"
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "javascript" in sw.headers["content-type"]
    assert sw.headers["service-worker-allowed"] == "/"
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200 and manifest.headers["content-type"].startswith("application/manifest+json")
    assert json.loads(manifest.text)["name"] == "Spotlight Studio"
    assert client.get("/static/css/app.css").status_code == 200
    assert client.get("/static/js/app.js").status_code == 200


# ── Desktop integration ────────────────────────────────────────────────────


def test_set_wallpaper_flow(client, monkeypatch):
    calls = []
    monkeypatch.setattr(api_mod, "set_desktop_wallpaper", lambda path: calls.append(path))
    row = add_wallpaper_with_files()
    ok = client.post(f"/api/wallpapers/{row['id']}/set-wallpaper")
    assert ok.status_code == 200 and ok.json()["success"] and len(calls) == 1
    assert client.post("/api/wallpapers/99999/set-wallpaper").status_code == 404

    missing = add_wallpaper(filename="peapix/missing.jpg")
    assert client.post(f"/api/wallpapers/{missing['id']}/set-wallpaper").status_code == 404

    pointer = add_wallpaper(filename="peapix/pointer.jpg")
    path = storage.image_path(pointer["filename"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")
    conflict = client.post(f"/api/wallpapers/{pointer['id']}/set-wallpaper")
    assert conflict.status_code == 409 and "git lfs pull" in conflict.json()["detail"]

    def unsupported(_path):
        raise UnsupportedPlatform("not on this OS")

    monkeypatch.setattr(api_mod, "set_desktop_wallpaper", unsupported)
    assert client.post(f"/api/wallpapers/{row['id']}/set-wallpaper").status_code == 501

    def broken(_path):
        raise WallpaperError("access denied")

    monkeypatch.setattr(api_mod, "set_desktop_wallpaper", broken)
    refused = client.post(f"/api/wallpapers/{row['id']}/set-wallpaper")
    assert refused.status_code == 400 and refused.json()["detail"] == "access denied"


# ── Maintenance ────────────────────────────────────────────────────────────


def test_library_check_and_maintenance(site, client, eng):
    row = add_wallpaper_with_files()
    report = client.get("/api/library/check").json()
    assert report["wallpapers"] == 1 and report["missing_images_count"] == 0
    storage.thumb_path(row["filename"]).unlink()
    assert client.get("/api/library/check").json()["missing_thumbnails_count"] == 1
    assert client.post("/api/maintenance/thumbnails").json() == {"created": 1}
    assert client.post("/api/maintenance/dedupe").json() == {"removed": 0}

    site.slow = 0.3
    eng.start("peapix", "full")
    assert client.post("/api/maintenance/dedupe").status_code == 409          # crawler busy
    assert client.post("/api/maintenance/thumbnails").status_code == 409
    eng.stop()
    assert eng.wait(20)


def test_engine_busy_maps_to_409(client, eng, monkeypatch):
    from src.engine import EngineBusy

    def busy(*_a, **_k):
        raise EngineBusy("still shutting down")

    monkeypatch.setattr(eng, "start", busy)
    response = client.post("/api/control/start")
    assert response.status_code == 409 and "shutting down" in response.json()["detail"]


def test_openapi_is_complete_and_constants_agree(client):
    schema = client.get("/api/openapi.json").json()
    paths = schema["paths"]
    for route in ("/api/health", "/api/status", "/api/control/start", "/api/wallpapers",
                  "/api/wallpapers/random", "/api/wallpapers/{wallpaper_id}", "/api/catalog",
                  "/api/export/csv", "/api/export/json", "/api/tags", "/api/library/check"):
        assert route in paths, route
    assert schema["info"]["title"] == "Spotlight Studio API" and schema["info"]["version"] == settings.VERSION
    assert set(api_mod.SortField.__args__) == set(db.ALLOWED_SORTS)
    assert set(api_mod.QualityFilter.__args__) - {""} == set(db.ALLOWED_QUALITIES)
    assert time.time() > 0
