# Roku TV channel

Pointer page: the channel's full documentation set lives in
[`roku/`](roku/README.md).

| Topic | Document |
|---|---|
| Overview & quickstart | [`roku/README.md`](roku/README.md) |
| Module map, state, render loop, image pipeline | [`roku/ARCHITECTURE.md`](roku/ARCHITECTURE.md) |
| Every `state` field | [`roku/STATE.md`](roku/STATE.md) |
| Remote control map & key codes | [`roku/CONTROLS.md`](roku/CONTROLS.md) |
| Certification compliance | [`roku/CERTIFICATION.md`](roku/CERTIFICATION.md) |
| Performance & memory budget | [`roku/PERFORMANCE.md`](roku/PERFORMANCE.md) |
| Static audit & the Roku API traps | [`roku/AUDIT.md`](roku/AUDIT.md) |
| Roku Pay | [`roku/IAP.md`](roku/IAP.md) |
| Deep linking / Direct to Play | [`roku/DEEP_LINKING.md`](roku/DEEP_LINKING.md) |
| Packaged catalog & LFS CDN | [`roku/CATALOG.md`](roku/CATALOG.md) |
| Standalone screensaver app | [`roku/SCREENSAVER.md`](roku/SCREENSAVER.md) |
| Troubleshooting | [`roku/TROUBLESHOOTING.md`](roku/TROUBLESHOOTING.md) |
| Release checklist | [`roku/RELEASE.md`](roku/RELEASE.md) |

## Summary

The Roku channel is a pure BrightScript **2D canvas** (`roScreen`) app: one
message loop, an explicit focus model, and a dirty-frame renderer that only
paints when something changed.  It ships a trimmed ~2.2 MB catalog of 7,475
wallpapers and streams imagery from the project's Git-LFS CDN
(`media.githubusercontent.com`), with a bounded two-tier image cache (480×270
thumbnails on disk, screen-sized full frames through `roTextureManager`).

Two packages are produced from this repository:

* `roku/` — the Spotlight Studio channel (gallery, viewer, Daily Spotlight,
  Ambient Mode, Ambient Collection, Theme Studio, search, Roku Pay store).
* `roku-screensaver/` — a standalone screensaver app, because Roku permits
  screensavers only in dedicated packages (certification 4.5).

Verify and build:

```bash
make roku-audit          # static gate: state keys, Roku API surface, dead calls
make roku-lint           # BrighterScript compile gate
make roku-check          # audit + certification pre-flight
make roku-zip            # dist/spotlight-studio-<version>.zip
make roku-screensaver    # dist/spotlight-studio-screensaver-<version>.zip
```
