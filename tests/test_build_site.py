from pathlib import Path

import pytest

from scripts.build_site import ROOT, build_site


def test_static_artifact_excludes_private_and_unnecessary_files(tmp_path):
    import shutil

    for name in ("index.html", "sw.js", "manifest.webmanifest"):
        shutil.copy2(ROOT / name, tmp_path / name)
    shutil.copytree(ROOT / "static", tmp_path / "static")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "wallpapers.json").write_text("[]")
    for name in ("wallpapers.db", "secret.log", "wallpapers.db-wal"):
        (tmp_path / "data" / name).write_text("private")
    (tmp_path / ".env").write_text("SECRET=never publish")
    site = build_site(tmp_path)
    files = {p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file()}
    assert "index.html" in files and "data/wallpapers.json" in files
    assert not any(p.endswith((".db", ".log", ".env", "-wal")) for p in files)
    assert not (site / "static/vendor").exists()
    (site / "old.js").touch()
    assert build_site(tmp_path) == site and not (site / "old.js").exists()


def test_build_refuses_symlinked_output(tmp_path):
    (tmp_path / "elsewhere").mkdir()
    try:
        (tmp_path / "dist").symlink_to(tmp_path / "elsewhere", target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable on this platform")
    with pytest.raises(ValueError):
        build_site(Path(tmp_path))


def test_exact_allowlist_excludes_private_files_even_inside_static_folders(tmp_path):
    import shutil

    from scripts.build_site import PUBLIC_FILES
    for name in PUBLIC_FILES:
        destination = tmp_path / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    (tmp_path / 'static/css/secret.env').write_text('private')
    (tmp_path / 'static/js/local-settings.js').write_text('private')
    site = build_site(tmp_path)
    assert not (site / 'static/css/secret.env').exists()
    assert not (site / 'static/js/local-settings.js').exists()
    assert not (site / 'static/css/api-docs.css').exists()
    source = tmp_path / 'static/css/app.css'
    source.unlink()
    try:
        source.symlink_to(tmp_path / 'static/css/secret.env')
    except OSError:
        pytest.skip('symlinks unavailable on this platform')
    with pytest.raises(ValueError, match='symlinked public source'):
        build_site(tmp_path)
    assert (site / 'static/css/app.css').read_bytes() == (ROOT / 'static/css/app.css').read_bytes()
