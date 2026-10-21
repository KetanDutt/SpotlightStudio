# Spotlight Studio — Roku TV

A pure BrightScript **2D canvas** (`roScreen`) channel: no SceneGraph XML, no
compositor, no framework.  Everything you see is drawn with `ifDraw2D` calls in
a single render loop, which is both the project's charm and the reason the
performance and memory sections in these docs matter.

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, application state, the render loop, memory budget |
| [CONTROLS.md](CONTROLS.md) | The complete remote-control map for every screen |
| [CERTIFICATION.md](CERTIFICATION.md) | Every Roku certification requirement and how this app satisfies it |
| [PERFORMANCE.md](PERFORMANCE.md) | Dirty-frame rendering, the bitmap caches, and how to profile |
| [IAP.md](IAP.md) | Roku Pay product model, purchase flow and entitlement rules |
| [DEEP_LINKING.md](DEEP_LINKING.md) | ECP launch/input parameters with copy-paste curl examples |
| [CATALOG.md](CATALOG.md) | The packaged catalog schema, regeneration and the Git-LFS CDN |
| [SCREENSAVER.md](SCREENSAVER.md) | The standalone screensaver channel and why it is a separate package |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Debug console workflow and the failures people actually hit |
| [RELEASE.md](RELEASE.md) | The pre-submission checklist |

The legacy overview at [`../ROKU.md`](../ROKU.md) is kept as a short pointer so
old links keep working.

## 60-second quickstart

```bash
# 1. compile gate (BrighterScript) over both packages
make roku-lint

# 2. certification pre-flight checks (size, artwork, entry points, deprecated APIs)
make roku-check

# 3. sideload-ready zip in dist/
make roku-zip
```

Then upload `dist/spotlight-studio-*.zip` to the Roku Developer Dashboard
(*Development → My Devices → Dev Channel Setup* uses the same zip over HTTP for
sideloading).

## Repository layout

```
roku/                     the publishable channel package
├── manifest              title, versions, artwork, ui_resolutions, supports_input_launch
├── source/               23 .brs modules (see ARCHITECTURE.md)
├── images/               opaque FHD/HD icons + splash screens (cert 6.4)
└── assets/catalog.json   trimmed wallpaper catalog (~2.2 MB, see CATALOG.md)

roku-screensaver/         standalone screensaver app (see SCREENSAVER.md)
├── manifest              screensaver_title, no title
└── source/main.brs       RunScreenSaver() + RunScreenSaverSettings() only

scripts/
├── build_roku_catalog.py   regenerates roku/assets/catalog.json from data/wallpapers.json
├── flatten_roku_art.py     removes transparency from roku/images (cert 6.4)
├── package_roku.py         builds dist/ zips + runs the certification pre-flight
└── roku/                   BrighterScript compile gate (bsconfig per package)
```

Nothing outside `manifest`, `source/`, `images/` and `assets/` ever enters a
package — `scripts/package_roku.py` builds a clean tree first, so this folder
of documentation can never leak into the 4 MB budget.
