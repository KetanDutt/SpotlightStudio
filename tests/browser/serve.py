"""Hermetic browser-test server. Uses disposable synthetic images, never the real DB."""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src import database, storage  # noqa: E402
from src.api import create_app  # noqa: E402
from src.config import settings  # noqa: E402
from src.engine import DownloadEngine  # noqa: E402
from tests.fake_site import make_picture  # noqa: E402

if __name__ == "__main__":
    import uvicorn

    with tempfile.TemporaryDirectory(prefix="spotlight-browser-") as directory:
        root = Path(directory)
        settings.DB_PATH = root / "wallpapers.db"
        settings.CATALOG_PATH = root / "wallpapers.json"
        settings.IMAGES_DIR = root / "images"
        settings.READ_ONLY = True
        settings.HOST = "0.0.0.0"
        settings.ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
        database.init_db()
        for i in range(1, 25):
            name = f"peapix/fixture-{i}.jpg"
            data = make_picture(i, 640, 360)
            storage.write_image(name, data)
            storage.write_thumbnail(name, data)
            database.upsert_wallpaper(dict(
                phash=f"{i:064x}", filename=name, title=f"Synthetic fixture {i}",
                source="peapix", source_url="", page_url="", width=640, height=360,
                file_size=len(data), tags="fixture", date_spotted="2026-10-07",
            ))
        # A separate allow-listed, static-only mount exercises real PWA installs.
        # No DB/source/logs are copied or served; the library stays disposable.
        database.export_catalog_json()
        site = root / "site"
        site.mkdir()
        project = Path(__file__).resolve().parents[2]
        html = (project / "index.html").read_text()
        (site / "index.html").write_text(html)
        for name in ("sw.js", "manifest.webmanifest"):
            shutil.copy2(project / name, site / name)
        for folder in ("css", "js", "icons"):
            shutil.copytree(project / "static" / folder, site / "static" / folder)
        (site / "data").mkdir()
        shutil.copy2(settings.CATALOG_PATH, site / "data" / "wallpapers.json")
        from starlette.staticfiles import StaticFiles
        app = create_app(settings, DownloadEngine())
        app.mount("/showcase", StaticFiles(directory=site, html=True), name="static-showcase")
        uvicorn.run(app, host="0.0.0.0", port=8877)
