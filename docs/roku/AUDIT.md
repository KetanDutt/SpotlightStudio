# Static audit (`scripts/roku_audit.py`)

`make roku-audit` — also run as the first step of `make roku-check`, and as
part of `pytest tests/test_roku_audit.py`.

## Why this exists

BrightScript compiles **every** `.brs` file in `source/` into one global
namespace, and the compiler is forgiving in exactly the ways that hurt a canvas
channel:

* reading a key an `roAssociativeArray` does not have returns `invalid` instead
  of raising;
* calling a method a Roku component does not implement is a *runtime* error,
  and on the main thread it terminates the channel;
* a call to a function no file defines is only discovered when execution
  reaches that line.

None of those are visible to `bsc`.  All three were present in this repository
before the auditor existed.  The auditor is the cheap, offline gate that finds
them in CI.

## What it checks

| # | Check | Level | What it catches |
|---|---|---|---|
| 1 | `CreateObject("roX")` names a known component | error | typos, components removed from the OS |
| 2 | `roFoo` method calls exist on `roFoo` | error / warning | **`roBitmap.DrawResizedObject()`**, **`roFont.Copy()` / `roFont.SetSize()`** |
| 3 | Calls to methods no component implements, wherever they appear | error | the same class, on an untyped receiver |
| 4 | `state.<key>` reads that are never assigned | error | blank filter chips, dead UI elements |
| 5 | `sm.`/`settingsMgr.<key>` that is neither a manager method nor a persisted preference | error | `settingsMgr.clockFormat` (the value lives in `cache`) |
| 6 | Global calls with no `function`/`sub` definition in the package | error | renamed or deleted helpers |
| 7 | Duplicate global `function`/`sub` names | error | two files defining the same helper |
| 8 | Deprecated / sunset Roku APIs | error | `InitClientCertificates`, `roImageCanvas`, … |
| 9 | Entry points and package separation | error | `RunScreenSaver()` in the channel; `Main()`/`RunUserInterface()` or `roChannelStore`/`roAudioPlayer`/`roVideoPlayer` in the screensaver |
| 10 | Manifest invariants (version, `supports_input_launch`, screensaver keys) | error | certification 6.1 / 5.2 / 4.5 |
| 11 | Sources not matched by the `bsconfig` `files` globs | warning | a module that is never compiled or linted |

Checks 8 and 9 look for **component names**, which means they must scan the
source with string literals intact (`Module.literal`) — every one of those names
appears inside `CreateObject("…")`.  The call checks deliberately use the
string-blanked text (`Module.code`) instead, so a word that merely looks like a
method call inside a string is not reported.  Both are covered by negative
tests in `tests/test_roku_audit.py`.

Warnings do not fail the build by default; `python3 scripts/roku_audit.py
--warnings-as-errors` tightens that, and the pytest suite asserts zero of both.

## Roku API surface

`scripts/roku_api_surface.json` is the data behind checks 1–3.  It is generated
from BrighterScript's bundled `roku-types` data (itself scraped from
`developer.roku.com`) plus a small table of documented methods the scrape
misses — `roAppManager.SetTheme()`, `roUrlTransfer.SetPort()`,
`roChannelStoreEvent.GetResponse()`, and others.

Two tables in that file are hand-maintained on purpose:

* **`nonexistent`** — methods that do **not** exist on the named component but
  that a reasonable person might assume do.  Reported as hard errors.
  Currently: `roBitmap`/`roScreen.DrawResizedObject()`,
  `roFont.SetSize()`, `roFont.Copy()`.
* **`ALWAYS_MISSING`** in the script — methods that do not exist on *any*
  Roku component, reported wherever they appear, with the fix in the message.

### The two real bugs this caught

**`DrawResizedObject()` does not exist.**  `ifDraw2D` — the only drawing
interface `roBitmap` and `roScreen` implement — exposes `DrawObject()`,
`DrawScaledObject(x, y, scaleX, scaleY, src)`, `DrawRotatedObject()` and
`DrawTransformedObject()`.  There is no pixel-dimension variant.  Every image
in the channel was drawn with it, so the channel crashed on the first frame
that contained a picture.  The replacement is:

```brightscript
' DrawScaledObject() takes SCALE FACTORS, not pixels.
sub DrawScaledTo(screen as object, x as integer, y as integer, w as integer, h as integer, source as object)
    if source = invalid then return
    srcW = source.GetWidth()
    srcH = source.GetHeight()
    if srcW < 1 or srcH < 1 then return
    screen.DrawScaledObject(x, y, w / srcW, h / srcH, source)
end sub
```

**`roFont` has no `Copy()` and no `SetSize()`.**  `roFont` exposes
`GetOneLineWidth()`, `GetOneLineHeight()`, `GetAscent()`, `GetDescent()` and
`GetMaxAdvance()` — nothing else.  The only documented way to obtain a font at
a given pixel size is `roFontRegistry.GetDefaultFont(size, bold, italic)`:

```brightscript
function MakeFont(registry as object, size as integer) as object
    if registry = invalid then return invalid
    font = registry.GetDefaultFont(size, false, false)
    if font <> invalid then return font
    return registry.GetDefaultFont()   ' very old firmware
end function
```

Both were called from `BuildFonts()`, i.e. during `RunUserInterface()` — the
channel died before it drew anything.

### Other API notes

* `roDateTime.FromISO8601String()` is the correct name; there is no
  `FromISOString()`.
* `roDeviceInfo.GetConnectionType()` is documented; bare `ConnectionType()` is
  not.
* `roFont.GetOneLineWidth(text, maxWidth)` takes **two** arguments.  The calls
  in this repo now pass an explicit `1920`.
* `roTextureRequest.SetSize(w, h)` *is* real — it is the only `SetSize()` in
  the API, which is why `roFont.SetSize()` looks plausible and is not.

## Type inference

BrightScript is dynamically typed, so the auditor infers types the same way a
reader does:

* `x = CreateObject("roFoo", …)` anywhere in the package types `x` as `roFoo`
  everywhere (one global namespace).  Ambiguous names are dropped.
* `x = something.GetDefaultFont()` types `x` as `roFont`, via `PRODUCER_TYPES`.
* Parameters that always receive a drawing surface passed down from
  `main.brs` — `screen`, `bmp`, `imgBmp`, `thumbBmp`, … — are listed in
  `SURFACE_ALIASES`.  This is what lets the audit flag
  `screen.DrawResizedObject()` inside `view_gallery.brs`, where `screen` is a
  parameter rather than a local.

Because inference is heuristic, check 2 reports *unrecognised* methods as
**warnings**, not errors.  Only the hand-curated `nonexistent` table produces
errors.  If a warning is a false positive, either rename the local variable or
add the method to `scripts/roku_api_surface.json` with a comment explaining
where it is documented.

## Companion: the BrighterScript compile gate

`make roku-lint` runs `bsc` over both packages at `--diagnostic-level info`.
That is a different, complementary gate: it catches undefined names, type
signature mismatches and unreachable code.  It does **not** catch anything on
the list above, which is why both exist.

`bsconfig-screensaver.json` carries two `diagnosticFilters` for BS1013
("file is not referenced by any other file").  The warning is meaningless here:

* the screensaver's `main.brs` is *supposed* to have no `Main()` or
  `RunUserInterface()` — that is what makes it a screensaver;
* the six shared modules are pulled in for the functions the screensaver calls,
  but `bsc` reasons about reachability from an entry point, and Roku does not:
  the device compiles **every** `.brs` in `source/` into one program.

The filters are `src`-scoped to those exact paths, so a genuinely orphaned file
elsewhere in either package still reports.

## Running it

```bash
make roku-audit                                  # both packages
python3 scripts/roku_audit.py --package channel  # one package
python3 scripts/roku_audit.py --warnings-as-errors
python3 -m pytest tests/test_roku_audit.py -q    # in CI, no Node needed
```
