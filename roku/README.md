# Spotlight Studio — Roku channel

The publishable Roku package.  Pure BrightScript 2D canvas (`roScreen`):
no SceneGraph XML, no framework, every pixel drawn by this code.

> Full documentation lives in [`../docs/roku/`](../docs/roku/) — architecture,
> controls, certification, performance, Roku Pay, deep links, catalog, the
> standalone screensaver, troubleshooting and the release checklist.
> This file is the quickstart only.

## What it is

* **7,475-wallpaper archive** browsed in a 4×2 Liquid Glass grid, backed by a
  ~2.2 MB packaged catalog and streamed Git-LFS imagery from
  `media.githubusercontent.com`.
* **Fullscreen viewer** with zoom, aspect modes, HUD and slideshow.
* **Daily Spotlight** — the same deterministic FNV-1a pick as the web, desktop
  and mobile clients (bit-for-bit, with parity self-test vectors).
* **Ambient Mode** — Ken Burns drift, dip-to-black cross-slides, rotation pools.
* **Ambient Collection** — Ultra-HD-first curated grid for the TV.
* **Theme Studio** — six live "Liquid Glass" palettes, ambient/backdrop
  assignment and automatic rotation.
* **Search** — an on-screen QWERTY keyboard (and physical-keyboard input).
* **Spotlight Pro** — Roku Pay lifetime/subscription products with a 3-day
  trial, entitlement sync via `GetPurchases()` on every launch.

## Build and sideload

```bash
make roku-audit       # static gate: state keys, Roku API surface, dead calls
make roku-lint        # BrighterScript compile gate
make roku-check       # audit + certification pre-flight (size, artwork, entry points…)
make roku-zip         # dist/spotlight-studio-<version>.zip
```

Upload the zip through the Roku Developer Dashboard, or sideload it to a
developer-mode device at `http://<roku-ip>/plugin_install`.

Package contents are exactly `manifest`, `source/`, `images/` and `assets/`;
the packaging script builds a clean tree first, so documentation and tooling
never enter the 4 MB budget.

## Constraints worth knowing before editing

* **No `RunScreenSaver()` and no `screensaver_title` here.**  Certification 4.5
  and Roku's screensaver policy reserve screensavers for standalone apps —
  see `roku-screensaver/` and `docs/roku/CERTIFICATION.md`.
* **The package must stay ≤ 4 MB** (certification 3.7).  The catalog is the
  largest file; regenerate it with `make roku-catalog`, never hand-edit it.
* **`roBitmap` cannot decode above 2048×2048**, so 4K frames come through
  `roTextureManager` with `SetSize(1920, 1080)`.  Do not "simplify" that back to
  `CreateObject("roBitmap", path)` — 4K wallpapers would stop displaying.
* **Back must exit only from the home screen** (certification 4.6).  Keep the
  grid → tab bar → exit ladder in `main.brs`.
* **`make roku-audit` is not optional.**  BrightScript returns `invalid` for a
  missing associative-array key and only discovers a call to a non-existent Roku
  method at runtime, on the main thread.  The auditor catches both before they
  reach a device — see `docs/roku/AUDIT.md`.
* Artwork must stay fully opaque (certification 6.4).  After touching
  `scripts/make_icons.py`, run `make roku-art`.
