"""Regression tests for the Roku packages' static gates.

These run without Node, network or a Roku device, which is why they live in the
main pytest suite rather than behind ``make roku-lint``:

* :mod:`scripts.roku_audit` is the gate that caught the class of bug the
  BrightScript compiler cannot see (``state.foo`` reads that silently evaluate
  to invalid, calls to methods Roku components do not have, calls to functions
  no file defines).
* the manifest and package metadata are checked for the invariants
  certification cares about.

Anything that needs BrighterScript stays in ``make roku-lint``.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import roku_audit  # noqa: E402  (import after sys.path manipulation)


@pytest.fixture(scope="module")
def surface() -> dict:
    assert roku_audit.SURFACE_PATH.exists(), "scripts/roku_api_surface.json is missing"
    return json.loads(roku_audit.SURFACE_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("package", sorted(roku_audit.PACKAGES))
def test_audit_reports_no_errors(package: str, surface: dict) -> None:
    findings = roku_audit.audit(package, surface)
    errors = [f for f in findings if f.level == "error"]
    assert not errors, "\n".join(str(f) for f in errors)


@pytest.mark.parametrize("package", sorted(roku_audit.PACKAGES))
def test_audit_reports_no_warnings(package: str, surface: dict) -> None:
    findings = roku_audit.audit(package, surface)
    warnings = [f for f in findings if f.level == "warning"]
    assert not warnings, "\n".join(str(f) for f in warnings)


def test_main_returns_zero() -> None:
    assert roku_audit.main(["--quiet"]) == 0


# ──────────────────────────────────────────────────────────────────────────
# Source-level invariants the auditor does not express as findings
# ──────────────────────────────────────────────────────────────────────────

BRIGHTSCRIPT_FILES = sorted((ROOT / "roku" / "source").glob("*.brs")) + [ROOT / "roku-screensaver" / "source" / "main.brs"]


@pytest.mark.parametrize("path", BRIGHTSCRIPT_FILES, ids=lambda p: p.name)
def test_no_withheld_api_calls(path: Path) -> None:
    """No file may call an API that does not exist on any Roku component."""
    code = roku_audit.strip_comments(path.read_text(encoding="utf-8"))
    for name in roku_audit.ALWAYS_MISSING:
        assert name not in code.lower(), f"{path.name} calls .{name}()"


@pytest.mark.parametrize("path", BRIGHTSCRIPT_FILES, ids=lambda p: p.name)
def test_files_are_comment_headed(path: Path) -> None:
    """Every module states what it is for - the package has 24 of them."""
    head = path.read_text(encoding="utf-8").splitlines()[:6]
    assert any(line.startswith("'") for line in head), f"{path.name} has no header comment"


def test_manifest_versions_are_sane() -> None:
    for package, root in roku_audit.PACKAGES.items():
        values: dict[str, str] = {}
        for raw in (root / "manifest").read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
        assert int(values["major_version"]) >= 1, package
        assert int(values["build_version"]) >= 1, package
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["build_date"]), package
        if package == "channel":
            assert values["supports_input_launch"] == "1"
            assert "screensaver_title" not in values
        else:
            assert "screensaver_title" in values
            assert "title" not in values


def test_channel_has_no_screensaver_entry_points() -> None:
    joined = "\n".join(
        roku_audit.strip_comments(p.read_text(encoding="utf-8"))
        for p in (ROOT / "roku" / "source").glob("*.brs")
    )
    assert not re.search(r"^\s*sub\s+RunScreenSaver\s*\(", joined, re.M)
    assert re.search(r"^\s*sub\s+(Main|RunUserInterface)\s*\(", joined, re.M)


def test_screensaver_has_only_screensaver_entry_points() -> None:
    joined = "\n".join(
        roku_audit.strip_comments(p.read_text(encoding="utf-8"))
        for p in (ROOT / "roku-screensaver" / "source").glob("*.brs")
    )
    assert re.search(r"^\s*sub\s+RunScreenSaver\s*\(", joined, re.M)
    assert not re.search(r"^\s*sub\s+(Main|RunUserInterface)\s*\(", joined, re.M)
    for banned in ("roChannelStore", "roAudioPlayer", "roVideoPlayer"):
        assert banned not in joined


def test_no_duplicate_global_definitions() -> None:
    modules = roku_audit.load_modules("channel")
    defs = roku_audit.collect_definitions(modules)
    duplicated = {name: where for name, where in defs.items() if len(where) > 1}
    assert not duplicated, f"duplicated global definitions: {duplicated}"


def test_state_keys_are_all_declared() -> None:
    """Every ``state.x`` the channel reads must exist in BuildState()."""
    findings: list[roku_audit.Finding] = []
    roku_audit.check_state_keys(roku_audit.load_modules("channel"), findings)
    assert not findings, "\n".join(str(f) for f in findings)


def test_settings_preferences_are_accessed_through_getters() -> None:
    findings: list[roku_audit.Finding] = []
    roku_audit.check_settings_keys(roku_audit.load_modules("channel"), findings)
    assert not findings, "\n".join(str(f) for f in findings)


# ──────────────────────────────────────────────────────────────────────────
# Row models: counts and indices must be derived, not hard-coded
# ──────────────────────────────────────────────────────────────────────────

def _body(path: Path, name: str) -> str:
    """Return the source of ``function <name>`` ... ``end function``."""
    code = roku_audit.strip_comments(path.read_text(encoding="utf-8"))
    match = re.search(
        r"^\s*(?:function|sub)\s+" + re.escape(name) + r"\s*\(.*?^\s*end\s+(?:function|sub)",
        code,
        re.M | re.S | re.I,
    )
    assert match, f"{path.name} does not define {name}"
    return match.group(0)


def test_filter_row_count_is_derived() -> None:
    """FilterRowCount() must count the spec, not repeat a literal.

    It returned 7 while the dialog had exactly 7 rows, so adding an eighth
    would have made the last row unreachable - silently, with no compile error.
    """
    body = _body(ROOT / "roku" / "source" / "view_filter.brs", "FilterRowCount")
    assert "FilterRowSpec" in body


def test_filter_search_row_index_is_derived() -> None:
    """The input handler must not keep its own literal index for the search row."""
    main = roku_audit.strip_comments((ROOT / "roku" / "source" / "main.brs").read_text(encoding="utf-8"))
    assert "FilterSearchRowIdx" in main
    # No non-zero literal index left over from the hard-coded version.
    # `state.filterRow = 0` is the reset-to-top assignment and is fine.
    leftover = re.findall(r"state\.filterRow\s*=\s*(\d+)\s*$", main, re.M)
    assert not [n for n in leftover if n != "0"], f"hard-coded filter row index: {leftover}"


def test_filter_rows_are_built_from_the_spec() -> None:
    """BuildFilterRows() and the spec must describe the same number of rows."""
    source = (ROOT / "roku" / "source" / "view_filter.brs").read_text(encoding="utf-8")
    spec_body = _body(ROOT / "roku" / "source" / "view_filter.brs", "FilterRowSpec")
    spec_rows = spec_body.count('label:')
    build_body = _body(ROOT / "roku" / "source" / "view_filter.brs", "BuildFilterRows")
    assert "FilterRowSpec" in build_body
    assert spec_rows >= 7, source and f"expected at least 7 filter rows, found {spec_rows}"


def test_theme_assign_rows_are_not_duplicates() -> None:
    """The two assignment rows must not print the same value in both columns.

    Both used to show ``LastViewedLabel(state)``, which read as "these rows are
    duplicates" and hid what was actually assigned.  The rows now show the
    current assignment and the hint line says what OK would assign - once.
    """
    source = ROOT / "roku" / "source" / "view_theme.brs"
    rows = _body(source, "BuildThemeRows")
    assert "LastViewedLabel" not in rows, "the row model must not repeat the last-viewed label"
    assert "AssignedTitle" in rows

    renderer = _body(source, "RenderThemeStudio")
    assert renderer.count("LastViewedLabel") == 1, "the last-viewed label belongs in the panel hint"
    assert renderer.count("OK assigns") == 1


def test_ambient_and_rotation_intervals_are_distinct() -> None:
    """``state.autoSwitchInterval`` was both the rotation and the slideshow timer.

    Changing Theme Studio's rotation interval used to reschedule Ambient Mode.
    """
    channel = "".join(
        roku_audit.strip_comments(p.read_text(encoding="utf-8"))
        for p in (ROOT / "roku" / "source").glob("*.brs")
    )
    assert "state.autoSwitchInterval" not in channel
    assert "state.ambientIntervalSec" in channel


# ──────────────────────────────────────────────────────────────────────────
# Negative tests: the gates must actually fire
# ──────────────────────────────────────────────────────────────────────────

def _module(tmp_path: Path, name: str, body: str) -> roku_audit.Module:
    path = tmp_path / name
    path.write_text("' scratch\n" + body, encoding="utf-8")
    return roku_audit.Module(path, f"scratch/{name}")


def test_entry_point_check_rejects_a_screensaver_in_the_channel(tmp_path: Path) -> None:
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs", "sub RunScreenSaver() as void\nend sub\n")]
    roku_audit.check_entry_points("channel", modules, findings)
    assert any("cert 4.5" in f.message for f in findings), [str(f) for f in findings]


def test_entry_point_check_requires_a_channel_entry_point(tmp_path: Path) -> None:
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs", "sub SomethingElse() as void\nend sub\n")]
    roku_audit.check_entry_points("channel", modules, findings)
    assert any("RunUserInterface" in f.message for f in findings), [str(f) for f in findings]


def test_entry_point_check_rejects_main_in_the_screensaver(tmp_path: Path) -> None:
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs",
                       "sub RunScreenSaver() as void\nend sub\nsub Main(args as dynamic) as void\nend sub\n")]
    roku_audit.check_entry_points("screensaver", modules, findings)
    assert any("main()" in f.message for f in findings), [str(f) for f in findings]


def test_entry_point_check_rejects_banned_components_in_the_screensaver(tmp_path: Path) -> None:
    """The component name lives inside CreateObject("…"), i.e. inside a string.

    strip_strings() blanks those, so a check that scanned the stripped source
    would never fire.  This is the regression.
    """
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs",
                       'sub RunScreenSaver() as void\n'
                       '    store = CreateObject("roChannelStore")\n'
                       'end sub\n')]
    roku_audit.check_entry_points("screensaver", modules, findings)
    assert any("roChannelStore" in f.message for f in findings), [str(f) for f in findings]


def test_deprecated_check_sees_component_names_inside_strings(tmp_path: Path) -> None:
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs",
                       'sub RunUserInterface(args as dynamic)\n'
                       '    canvas = CreateObject("roImageCanvas")\n'
                       'end sub\n')]
    roku_audit.check_deprecated(modules, findings)
    assert any("roImageCanvas" in f.message for f in findings), [str(f) for f in findings]


def test_deprecated_check_ignores_the_same_word_in_a_comment(tmp_path: Path) -> None:
    findings: list[roku_audit.Finding] = []
    modules = [_module(tmp_path, "a.brs",
                       "' roImageCanvas was removed in 2019 - do not use it\n"
                       "sub RunUserInterface(args as dynamic)\nend sub\n")]
    roku_audit.check_deprecated(modules, findings)
    assert not findings, [str(f) for f in findings]
