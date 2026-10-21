# Roku TV channel

Pointer page: the channel's full documentation set now lives in
[`roku/`](roku/README.md):

| Topic | Document |
|---|---|
| Overview & quickstart | [`roku/README.md`](roku/README.md) |
| Architecture, state machine, render loop | [`roku/ARCHITECTURE.md`](roku/ARCHITECTURE.md) |
| Remote control map | [`roku/CONTROLS.md`](roku/CONTROLS.md) |
| Certification compliance | [`roku/CERTIFICATION.md`](roku/CERTIFICATION.md) |
| Performance & memory budget | [`roku/PERFORMANCE.md`](roku/PERFORMANCE.md) |
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

Build both with `make roku-zip` / `make roku-screensaver`; verify with
`make roku-lint` and `make roku-check`.
