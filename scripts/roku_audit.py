#!/usr/bin/env python3
"""
Static auditor for the Spotlight Studio Roku packages.

BrightScript compiles every ``.brs`` file in ``source/`` into one global
namespace, so the compiler cannot catch the failure modes that actually bite a
canvas channel:

* a typo in ``state.someKey`` reads as ``invalid`` instead of raising, so a
  whole UI element silently disappears;
* ``settingsMgr.somePreference`` has the same problem - the preference lives in
  the manager's ``cache`` AA, not on the manager itself;
* a call to a function that no file defines is a runtime "not a function"
  crash on the code path that reaches it;
* **a call to a method that does not exist on a Roku component** crashes the
  channel outright.  Roku's ``ifDraw2D`` has no ``DrawResizedObject()`` and
  ``roFont`` has no ``Copy()``/``SetSize()`` - both were used in this repo
  before this script existed.

``make roku-audit`` runs it over both packages; ``make roku-check`` runs it
together with the certification pre-flight.  Exit status is non-zero when any
*error* is reported.

    python3 scripts/roku_audit.py            # both packages
    python3 scripts/roku_audit.py --warnings-as-errors
    python3 scripts/roku_audit.py --package channel
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SURFACE_PATH = Path(__file__).resolve().parent / "roku_api_surface.json"

PACKAGES = {
    "channel": ROOT / "roku",
    "screensaver": ROOT / "roku-screensaver",
}

# The screensaver links shared modules out of roku/source, so its audit has to
# consider the union of both trees (same rule as bsconfig-screensaver.json).
SHARED_FOR_SCREENSAVER = ("utils.brs", "constants.brs", "gfx_cache.brs", "theme.brs", "catalog.brs", "image_loader.brs")


# ──────────────────────────────────────────────────────────────────────────
# BrightScript lexing helpers
# ──────────────────────────────────────────────────────────────────────────

def strip_comments(source: str) -> str:
    """Blank out ``'`` comments without touching the text inside string literals.

    Line numbers are preserved so findings can point at the real line.
    """
    out = []
    for line in source.splitlines():
        quote = None
        cut = len(line)
        for index, char in enumerate(line):
            if quote:
                if char == quote:
                    quote = None
            elif char == '"':
                quote = char
            elif char == "'":
                cut = index
                break
        out.append(line[:cut])
    return "\n".join(out)


def strip_strings(source: str) -> str:
    """Replace the *contents* of string literals with dots (keeps the quotes)."""
    def repl(match: re.Match) -> str:
        text = match.group(0)
        return '"' + ("." * max(0, len(text) - 2)) + '"'

    return re.sub(r'"[^"\n]*"', repl, source)


#: Global functions BrightScript provides.  Anything else that is called but not
#: defined in the package is reported.
BUILTIN_FUNCTIONS = {
    "readasciifile", "writeasciifile", "listfiles", "deletedirectory", "createdirectory", "formatdrive",
    "matchfiles", "readasciifilepo", "upcase", "lcase", "right", "stri", "abs", "and", "asc", "atn",
    "box", "cdbl", "chr", "cint", "cos", "createobject", "csng", "dim", "endfunction", "endsub",
    "eval", "exit", "exp", "fix", "for", "formatjson", "getglobalaa", "getlastruncompileerror",
    "getlastrunruntimeerror", "if", "instr", "int", "invalid", "left", "len", "line_num", "log",
    "mid", "next", "not", "or", "parsejson", "pi", "pos", "print", "reboot", "return", "rnd", "run",
    "sgn", "sin", "sleep", "sqr", "step", "stop", "str", "string", "stringi", "substitute", "tab",
    "tan", "then", "to", "true", "false", "type", "ucase", "val", "wait", "while", "goto", "gosub",
    "else", "each", "in", "function", "sub", "end", "endif", "endwhile", "endfor", "exitwhile",
    "exitfor", "lib_system", "runuserinterface", "main", "runscreensaver", "runscreensaversettings",
    "getinterfacebyname", "tr", "atn2", "mod", "isequal", "cbool", "cstr",
}

#: ``roArray`` / ``roAssociativeArray`` methods are checked loosely (the surface
#: table only covers the components this project actually instantiates).
LOOSE_OBJECTS = {"roarray", "rolist", "roassociativearray", "rostring", "roint", "rofloat", "rodouble"}

#: Parameter names that always hold a drawing surface in this code base.  The
#: surfaces are created in main.brs and passed down, so a per-file scan cannot
#: see their type - this table is what lets the auditor flag
#: ``screen.DrawResizedObject()`` inside view_gallery.brs.
SURFACE_ALIASES = {
    "screen": "roscreen",
    "bmp": "robitmap",
    "bitmap": "robitmap",
    "imgbmp": "robitmap",
    "thumbbmp": "robitmap",
    "thumbsrc": "robitmap",
    "logobmp": "robitmap",
    "logoscaled": "robitmap",
    "cached": "robitmap",
    "src": "robitmap",
    "source": "robitmap",
    "fallback": "robitmap",
    "region": "roregion",
    # Fonts are produced by roFontRegistry and then copied into an AA, so the
    # alias table has to name both the plain variables and the AA members.
    "defaultfont": "rofont",
    "basefont": "rofont",
    "clockfont": "rofont",
    "datefont": "rofont",
    "titlefont": "rofont",
    "bodyfont": "rofont",
    "smallfont": "rofont",
    "font": "rofont",
    "fonts.heading": "rofont",
    "fonts.body": "rofont",
    "fonts.small": "rofont",
    "fonts.title": "rofont",
    "fonts.caption": "rofont",
    "fonts.clock": "rofont",
    "fonts.date": "rofont",
}

#: ``x = SomeObject.GetFoo()`` - the producer method implies the returned type.
PRODUCER_TYPES = {
    "getdefaultfont": "rofont",
    "getfont": "rofont",
    "getbitmap": "robitmap",
}

#: Method names that do not exist on ANY Roku component.  Reported wherever they
#: appear, because a call like this terminates the channel the moment it runs.
ALWAYS_MISSING = {
    "drawresizedobject": "use DrawScaledObject(x, y, w / src.GetWidth(), h / src.GetHeight(), src)",
}


class Finding:
    __slots__ = ("level", "where", "message")

    def __init__(self, level: str, where: str, message: str) -> None:
        self.level = level
        self.where = where
        self.message = message

    def __str__(self) -> str:
        return f"  {self.level:<7}: {self.where}: {self.message}"


class Module:
    def __init__(self, path: Path, display: str) -> None:
        self.path = path
        self.display = display
        raw = path.read_text(encoding="utf-8")
        self.raw = raw
        # `code` has string literals blanked (so a method-looking word inside a
        # string is not treated as a call); `literal` keeps them, which is what
        # any check that looks for a component NAME needs.
        self.code = strip_strings(strip_comments(raw))
        self.literal = strip_comments(raw)
        self.lines = self.code.splitlines()
        self.literal_lines = self.literal.splitlines()


def load_modules(package: str) -> list[Module]:
    root = PACKAGES[package]
    paths = sorted((root / "source").glob("*.brs"))
    if package == "screensaver":
        shared = ROOT / "roku" / "source"
        for name in SHARED_FOR_SCREENSAVER:
            candidate = shared / name
            if candidate.exists():
                paths.append(candidate)
        paths = sorted(set(paths))
    return [Module(p, f"{package}/source/{p.name}") for p in paths]


# ──────────────────────────────────────────────────────────────────────────
# Individual checks
# ──────────────────────────────────────────────────────────────────────────

DEFINITION_RE = re.compile(r"^\s*(?:function|sub)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.M)
CALL_RE = re.compile(r"(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*\(")
CREATE_RE = re.compile(r'CreateObject\(\s*"([A-Za-z0-9_]+)"')


def collect_definitions(modules: list[Module]) -> dict[str, list[str]]:
    defs: dict[str, list[str]] = {}
    for mod in modules:
        for match in DEFINITION_RE.finditer(mod.code):
            defs.setdefault(match.group(1).lower(), []).append(mod.display)
    return defs


def check_undefined_calls(modules: list[Module], defs: dict[str, list[str]], findings: list[Finding]) -> None:
    for mod in modules:
        for lineno, line in enumerate(mod.lines, 1):
            for match in CALL_RE.finditer(line):
                name = match.group(1)
                low = name.lower()
                if low in BUILTIN_FUNCTIONS or low in defs:
                    continue
                # `for each x in y(`, `if x(` ...  are handled by the keyword list.
                findings.append(
                    Finding("error", f"{mod.display}:{lineno}",
                            f"call to {name}() - no function or sub with that name is defined in the package")
                )


def check_duplicate_definitions(defs: dict[str, list[str]], findings: list[Finding]) -> None:
    for name, where in sorted(defs.items()):
        if len(where) > 1:
            findings.append(
                Finding("error", ", ".join(sorted(set(where))),
                        f"{name}() is defined {len(where)} times - BrightScript has one global namespace")
            )


def infer_types(modules: list[Module]) -> dict[str, str]:
    """Map variable name -> roComponent across the whole package.

    BrightScript is dynamically typed and every ``.brs`` file shares one global
    namespace, so a name assigned from ``CreateObject("roFoo")`` anywhere is
    assumed to hold that component everywhere.  Ambiguous names are dropped;
    :data:`SURFACE_ALIASES` fills in the parameters that receive a surface
    passed down from ``main.brs``.
    """
    seen: dict[str, set[str]] = {}
    assign_re = re.compile(r"(?:^|[\s=(])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*CreateObject\(\s*\"([A-Za-z0-9_]+)\"")
    member_re = re.compile(r'([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*:\s*CreateObject\(\s*"([A-Za-z0-9_]+)"')
    for mod in modules:
        for match in assign_re.finditer(mod.code):
            var, comp = match.group(1).lower(), match.group(2).lower()
            if var in ("m", "if", "for", "while", "return", "then", "to", "step", "each"):
                continue
            seen.setdefault(var, set()).add(comp)
        for match in member_re.finditer(mod.code):
            seen.setdefault(match.group(1).lower(), set()).add(match.group(2).lower())
        for match in re.finditer(r"(?:^|[\s=(])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[A-Za-z_][A-Za-z0-9_.]*\.([A-Za-z_][A-Za-z0-9_]*)\s*\(", mod.code):
            produced = PRODUCER_TYPES.get(match.group(2).lower())
            if produced:
                seen.setdefault(match.group(1).lower(), set()).add(produced)

    types = {name: next(iter(comps)) for name, comps in seen.items() if len(comps) == 1}
    for name, comp in SURFACE_ALIASES.items():
        types.setdefault(name, comp)
    return types


def check_createobject_and_methods(modules: list[Module], surface: dict, findings: list[Finding]) -> None:
    components: dict[str, set[str]] = {k: set(v) for k, v in surface["components"].items()}
    nonexistent = {k: {m.lower() for m in v} for k, v in surface["nonexistent"].items()}
    types = infer_types(modules)

    # 1. Every CreateObject() must name a real component.
    for mod in modules:
        for lineno, line in enumerate(mod.lines, 1):
            for match in CREATE_RE.finditer(line):
                comp = match.group(1)
                if comp.lower() not in components:
                    findings.append(Finding("error", f"{mod.display}:{lineno}",
                                            f'CreateObject("{comp}") - not a known Roku component'))

    # 2. Method calls on typed variables must exist on that component.
    patterns = [
        (name, comp, re.compile(r"(?<![A-Za-z0-9_.])" + re.escape(name) + r"\.([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.I))
        for name, comp in types.items()
        if comp not in LOOSE_OBJECTS and comp in components
    ]
    for mod in modules:
        for lineno, line in enumerate(mod.lines, 1):
            for name, comp, pattern in patterns:
                allowed = components[comp]
                for m in pattern.finditer(line):
                    method = m.group(1)
                    low = method.lower()
                    if low in ALWAYS_MISSING:
                        findings.append(
                            Finding("error", f"{mod.display}:{lineno}",
                                    f"{name}.{method}() - no Roku component implements {method}(); "
                                    f"{ALWAYS_MISSING[low]}")
                        )
                    elif low in nonexistent.get(comp, set()):
                        findings.append(
                            Finding("error", f"{mod.display}:{lineno}",
                                    f"{name}.{method}() - {comp} has no {method}() method; "
                                    f"this crashes the channel at runtime")
                        )
                    elif low not in allowed:
                        findings.append(
                            Finding("warning", f"{mod.display}:{lineno}",
                                    f"{name}.{method}() - not in the documented {comp} API surface (verify before shipping)")
                        )

    # 3. Methods that no component has, wherever they appear.
    for mod in modules:
        for lineno, line in enumerate(mod.lines, 1):
            for match in re.finditer(r"\.([A-Za-z_][A-Za-z0-9_]*)\s*\(", line):
                low = match.group(1).lower()
                if low in ALWAYS_MISSING:
                    findings.append(
                        Finding("error", f"{mod.display}:{lineno}",
                                f".{match.group(1)}() - no Roku component implements it; {ALWAYS_MISSING[low]}")
                    )


def check_state_keys(modules: list[Module], findings: list[Finding]) -> None:
    """Every ``state.foo`` read must be a key that BuildState() actually creates."""
    declared: set[str] = set()
    assigned: set[str] = set()
    reads: dict[str, set[str]] = {}

    for mod in modules:
        if mod.display != "channel/source/main.brs":
            continue
        start = mod.code.find("    state = {")
        if start < 0:
            findings.append(Finding("error", mod.display, "could not locate BuildState()'s state literal"))
            return
        end = mod.code.find("\n    return state\n", start)
        block = mod.code[start:end if end > 0 else len(mod.code)]
        declared = set(re.findall(r"^\s{8}([A-Za-z_][A-Za-z0-9_]*):", block, re.M))

    for mod in modules:
        for match in re.finditer(r"state\.([A-Za-z_][A-Za-z0-9_]*)", mod.code):
            key = match.group(1)
            reads.setdefault(key, set()).add(mod.display)
            # Is it ever assigned?  `state.key =` / `state.key=` / `state["key"] =`
            tail = mod.code[match.end():match.end() + 4]
            head = mod.code[max(0, match.start() - 12):match.start()]
            if tail.lstrip().startswith("=") or head.rstrip().endswith(("m.state.", "to ")):
                assigned.add(key)

    for key in sorted(reads):
        if key in declared:
            continue
        if key in assigned:
            continue
        where = ", ".join(sorted(reads[key]))
        findings.append(
            Finding("error", where,
                    f"state.{key} is read but never assigned - BuildState() does not declare it, "
                    f"so it always evaluates to invalid")
        )


def check_settings_keys(modules: list[Module], findings: list[Finding]) -> None:
    """``sm.foo`` / ``settingsMgr.foo`` must be a manager method or a persisted preference."""
    settings_mod = next((m for m in modules if m.display.endswith("/settings.brs")), None)
    if settings_mod is None:
        return

    start = settings_mod.code.find("    settings = {")
    end = settings_mod.code.find("    settings.Load()", start)
    if start < 0 or end < 0:
        findings.append(Finding("error", settings_mod.display, "could not locate CreateSettingsManager()'s literal"))
        return
    methods = set(re.findall(r"^\s{8}([A-Za-z_][A-Za-z0-9_]*):", settings_mod.code[start:end], re.M))

    d0 = settings_mod.code.find("            return {", start, end)
    d1 = settings_mod.code.find("            end function", d0)
    preferences = set(re.findall(r"^\s{16}([A-Za-z_][A-Za-z0-9_]*):", settings_mod.code[d0:d1], re.M)) if d0 >= 0 else set()

    known = methods | preferences
    pattern = re.compile(r"\b(?:sm|settingsMgr|state\.settingsMgr|m\.settingsMgr)\.([A-Za-z_][A-Za-z0-9_]*)")
    seen: dict[str, set[str]] = {}
    for mod in modules:
        for lineno, line in enumerate(mod.lines, 1):
            for match in pattern.finditer(line):
                key = match.group(1)
                if key in known:
                    continue
                seen.setdefault(key, set()).add(f"{mod.display}:{lineno}")
    for key in sorted(seen):
        findings.append(
            Finding("error", ", ".join(sorted(seen[key])),
                    f"settings manager has no .{key} - preferences live in the manager's cache AA; use GetStr(\"{key}\", ...)"
                    )
        )


DEPRECATED_APIS = {
    "InitClientCertificates": "deprecated in Roku OS 16.0; blocked from 1 Apr 2027",
    "enableFreshConnection": "removed in Roku OS 11.5",
    "ShowChannelStoreSpringboard": "deprecated Feb 2025; blocked by Static Analysis",
    "roKeyboardScreen": "removed from the Roku OS in 2019",
    "roImageCanvas": "removed from the Roku OS in 2019",
    "roParagraphScreen": "removed from the Roku OS in 2019",
    "roSpringboardScreen": "removed from the Roku OS in 2019",
    "roGridScreen": "removed from the Roku OS in 2019",
    "roListScreen": "removed from the Roku OS in 2019",
    "roPosterScreen": "removed from the Roku OS in 2019",
}


def check_deprecated(modules: list[Module], findings: list[Finding]) -> None:
    # Scans the string-literal-preserving text: every one of these names is a
    # component that appears inside CreateObject("..."), and strip_strings()
    # would have blanked it.
    for mod in modules:
        for lineno, line in enumerate(mod.literal_lines, 1):
            for needle, reason in DEPRECATED_APIS.items():
                if needle in line:
                    findings.append(Finding("error", f"{mod.display}:{lineno}",
                                            f"deprecated API {needle} - {reason}"))


def check_manifest(package: str, findings: list[Finding]) -> None:
    manifest = PACKAGES[package] / "manifest"
    if not manifest.exists():
        findings.append(Finding("error", f"{package}/manifest", "manifest is missing"))
        return
    values: dict[str, str] = {}
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()

    for key in ("major_version", "minor_version", "build_version"):
        if key not in values:
            findings.append(Finding("error", f"{package}/manifest", f"{key}= is missing (cert 6.1)"))
    if values.get("build_version", "0") == "0":
        findings.append(Finding("error", f"{package}/manifest", "build_version must be non-zero (cert 6.1)"))
    if "ui_resolutions" not in values:
        findings.append(Finding("warning", f"{package}/manifest", "ui_resolutions is not declared"))
    if package == "channel":
        if values.get("supports_input_launch") != "1":
            findings.append(Finding("error", f"{package}/manifest", "supports_input_launch=1 is required (cert 5.2)"))
        if "screensaver_title" in values or "screensaver_private" in values:
            findings.append(Finding("error", f"{package}/manifest", "screensaver keys are prohibited in a channel (cert 4.5)"))
    else:
        if "screensaver_title" not in values:
            findings.append(Finding("error", f"{package}/manifest", "screensaver_title= is required"))
        if "title" in values:
            findings.append(Finding("error", f"{package}/manifest", "a standalone screensaver must not declare title="))


def check_entry_points(package: str, modules: list[Module], findings: list[Finding]) -> None:
    """Enforce the entry-point and component rules that separate the two packages.

    Certification 4.5 and Roku's screensaver policy reserve screensavers for
    standalone apps: a channel may not define ``RunScreenSaver()``, and a
    screensaver may not define ``Main()``/``RunUserInterface()`` nor reach for
    the store or the media players.  A package that breaks these rules is
    blocked by static analysis at submission time, which is a slow, expensive
    way to discover something a grep can find.
    """
    defined = {name for mod in modules for name in DEFINITION_RE.findall(mod.code)}
    defined = {name.lower() for name in defined}

    if package == "channel":
        if not {"main", "runuserinterface"} & defined:
            findings.append(Finding("error", "channel/source",
                                    "no Main() or RunUserInterface() entry point"))
        for banned in ("runscreensaver", "runscreensaversettings"):
            if banned in defined:
                findings.append(Finding("error", "channel/source",
                                        f"{banned}() is prohibited in a channel (cert 4.5)"))
        return

    if "runscreensaver" not in defined:
        findings.append(Finding("error", "screensaver/source",
                                "a standalone screensaver must define RunScreenSaver()"))
    for banned in ("main", "runuserinterface"):
        if banned in defined:
            findings.append(Finding("error", "screensaver/source",
                                    f"{banned}() is prohibited in a screensaver package"))

    # literal_lines, not lines: the component names live inside CreateObject("…").
    for mod in modules:
        for lineno, line in enumerate(mod.literal_lines, 1):
            for component in ("roChannelStore", "roAudioPlayer", "roVideoPlayer"):
                if component in line:
                    findings.append(Finding(
                        "error", f"{mod.display}:{lineno}",
                        f"{component} is prohibited in a screensaver package"))


def check_bsconfig_coverage(package: str, modules: list[Module], findings: list[Finding]) -> None:
    config = ROOT / "scripts" / "roku" / ("bsconfig.json" if package == "channel" else "bsconfig-screensaver.json")
    if not config.exists():
        return
    try:
        data = json.loads(config.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        findings.append(Finding("error", config.name, f"unparseable JSON: {exc}"))
        return
    root_dir = (config.parent / data.get("rootDir", "")).resolve()
    covered: set[Path] = set()
    for entry in data.get("files") or []:
        if "*" in entry:
            covered.update(root_dir.glob(entry))
        else:
            candidate = root_dir / entry
            if candidate.exists():
                covered.add(candidate)
    for mod in modules:
        if mod.path.resolve() not in covered:
            findings.append(Finding("warning", mod.display,
                                    "file is not matched by " + config.name + " - it will not be compiled or linted"))


# ──────────────────────────────────────────────────────────────────────────

def audit(package: str, surface: dict) -> list[Finding]:
    findings: list[Finding] = []
    modules = load_modules(package)
    if not modules:
        return [Finding("error", package, "no .brs sources found")]
    defs = collect_definitions(modules)
    check_duplicate_definitions(defs, findings)
    check_undefined_calls(modules, defs, findings)
    check_createobject_and_methods(modules, surface, findings)
    check_deprecated(modules, findings)
    check_entry_points(package, modules, findings)
    check_manifest(package, findings)
    check_bsconfig_coverage(package, modules, findings)
    if package == "channel":
        check_state_keys(modules, findings)
        check_settings_keys(modules, findings)
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package", choices=sorted(PACKAGES), help="audit a single package")
    parser.add_argument("--warnings-as-errors", action="store_true", help="treat warnings as failures")
    parser.add_argument("--quiet", action="store_true", help="only print findings")
    args = parser.parse_args(argv)

    if not SURFACE_PATH.exists():
        print(f"[roku-audit] missing {SURFACE_PATH.name}", file=sys.stderr)
        return 2
    surface = json.loads(SURFACE_PATH.read_text(encoding="utf-8"))

    def dedupe(findings: list[Finding]) -> list[Finding]:
        seen: set[tuple[str, str, str]] = set()
        unique = []
        for finding in findings:
            key = (finding.level, finding.where, finding.message)
            if key in seen:
                continue
            seen.add(key)
            unique.append(finding)
        return unique

    packages = [args.package] if args.package else sorted(PACKAGES)
    total_errors = 0
    total_warnings = 0

    for package in packages:
        findings = dedupe(audit(package, surface))
        errors = [f for f in findings if f.level == "error"]
        warnings = [f for f in findings if f.level == "warning"]
        total_errors += len(errors)
        total_warnings += len(warnings)

        if not args.quiet:
            print(f"[roku-audit] {package}: {len(errors)} error(s), {len(warnings)} warning(s)")
        for finding in sorted(findings, key=lambda f: (f.where, f.message)):
            print(finding)

    if not args.quiet:
        print(f"[roku-audit] total: {total_errors} error(s), {total_warnings} warning(s)")

    if total_errors:
        return 1
    if total_warnings and args.warnings_as_errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
