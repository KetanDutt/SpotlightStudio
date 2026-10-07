# Mobile app (Android & iOS)

For the shared Still Glass material, typography, motion and accessibility rules, see [DESIGN.md](DESIGN.md). The Expo app retains its independent native version (1.0.0).

The `mobile/` folder is a **production Expo (React Native) client** for the same wallpaper
library the desktop app crawls: it browses the published catalog, searches it offline, keeps
favourites and history on the device, downloads wallpapers — and, on Android, *sets them*,
including an automatic rotation. It reuses the project's pure logic (`static/js/core.js` was
ported to `mobile/src/core/utils.ts`) so filters, sorting, titles and quality classes behave
exactly like the web gallery.

## What it does

| | |
|---|---|
| **Browse** | Masonry/list gallery over the whole catalog, tag rail, source/quality/sort filters, favourites-only, deep links (`?tag=sunset`, `?q=aurora`) |
| **Search** | Dedicated screen, searches titles/tags/sources/dates in memory as you type (7,500 rows, no request), recent searches |
| **Directory** | Library stats, sources, resolution classes, the full tag index, and **catalog export** (JSON / CSV) through the system share sheet |
| **Export** | *JSON* is the exact shape of `data/wallpapers.json` (feed it back into the crawler); *CSV* has the columns `id, title, source, quality, width, height, file_size, tags, date_spotted, downloaded_at, page_url, filename`, is UTF-8 BOM + CRLF and neutralises spreadsheet formulas like the server export |
| **Wallpaper detail** | Full-resolution preview, metadata, source link, download, save to Photos, share, copy link, favourite |
| **Set wallpaper** | Android: applies directly (home / lock / both) via a bundled native module. iOS: saves into a “Spotlight Studio” album and explains the one-time Shortcuts step — see [Setting a wallpaper](#setting-a-wallpaper) |
| **Rotation** | Android: periodic background task picks the next wallpaper from a filtered pool. iOS: the OS gives no way to set the wallpaper, so the switch is not offered |
| **Settings** | Theme (auto/light/dark), rotation, catalog source and refresh, cache size, album name, reset |

## Requirements

* **Node ≥ 20** and npm (the repo's front-end tests only need Node, the app needs the toolchain).
* An emulator/device to run it: Android Studio (JDK 17 + Android SDK) for `npm run android`,
  Xcode 16+ for `npm run ios`.
* Optional: an [EAS](https://docs.expo.dev/build/introduction/) account for cloud builds —
  this sandbox/repo has no Android SDK or Xcode, so store builds normally happen on a
  developer machine or on EAS.

## Quick start

```bash
cd mobile
npm ci                 # exact versions from package-lock.json
npm start              # Metro bundler + QR code (Expo Go can open it)
npm run android        # build & install a dev client (needed for the native wallpaper module)
npm run ios            # same on a Mac
npm run verify         # typecheck + lint + unit tests — the gate CI uses
```

> **Expo Go vs. a dev build.** Everything except *set wallpaper*, *save to Photos* and the
> background rotation runs in Expo Go. Those three need the custom native code in
> `mobile/modules/wallpaper` and `expo-media-library`, so use `npm run android` / `npm run ios`
> (which prebuilds and installs a development build) or an EAS build.

## Project layout

```
mobile/
  app/                     expo-router routes (file-based)
    _layout.tsx            providers, theme, error boundary, background-task definition
    (tabs)/_layout.tsx     Browse · Favourites · History · Settings
    (tabs)/index.tsx       the gallery (the only place that owns catalog filters)
    search.tsx             in-memory search + recent searches
    directory.tsx          stats, sources, quality classes, tag index, exports
    tags.tsx               every tag with its count, filterable
    wallpaper/[id].tsx     detail: preview, actions, metadata
    about.tsx              credits, catalog provenance, desktop app
  src/core/                pure logic (no React, no I/O): utils, platform, rotation, config,
                           storage-utils, types — the ported contract of static/js/core.js
  src/services/            the impure edge: media (download/save/share), wallpaper
                           (apply/save), rotation (scheduler + offline catalog), export,
                           storage (AsyncStorage façade)
  src/providers/           CatalogProvider (load/bundle/cache) and PreferencesProvider
                           (favourites, history, rotation, storage limits)
  src/components/          UI kit (ui/), wallpaper pieces, toast provider
  src/hooks/               useWallpaperActions, useRotation, useDebouncedValue
  modules/wallpaper/       the Expo Module that talks to Android's WallpaperManager
  assets/                  icons and splash (generated, see below)
  tests/                   Jest suites + shared doubles
  scripts/sync-catalog.mjs copies ../data/wallpapers.json into src/data/catalog.json
```

## Catalog & image sources

The app never invents data — it renders the same rows as `/api/catalog`:

1. **A local Spotlight Studio server**, when `EXPO_PUBLIC_API_URL` is set (`GET /api/catalog`,
   8 s timeout). This is the only mode that can also report crawl state.
2. **The published catalog** (`data/wallpapers.json` in this repository, via
   `raw.githubusercontent.com`), cached on the device for 30 days.
3. **The offline copy** bundled at build time from `src/data/catalog.json`
   (refresh it with `node scripts/sync-catalog.mjs`).

Images resolve to `github.com/<owner>/<repo>/blob/<branch>/images/…?raw=true` (the same
Git-LFS-friendly URLs the web gallery uses), or to your own server's `/images/…` when
`EXPO_PUBLIC_IMAGE_BASE` points at it.

### Pointing the app at your own server

The API is loopback-bound and unauthenticated by default, so a phone cannot reach it until
you widen it deliberately:

```bash
HOST=0.0.0.0 CORS_ORIGINS=* python main.py --server     # dev only, trusted LAN
# then in mobile/.env.local (or the EAS build profile):
EXPO_PUBLIC_API_URL=http://192.168.0.9:8765
EXPO_PUBLIC_IMAGE_BASE=http://192.168.0.9:8765
```

Anyone on that network can then start crawls and run maintenance — read
[docs/SECURITY.md](SECURITY.md#exposing-the-server-to-a-network) first. `CORS_ORIGINS` is only
needed for the browser build; the native app is not subject to CORS.

## Setting a wallpaper

| | Android | iOS |
|---|---|---|
| Apply directly | ✅ `WallpaperManager` through `modules/wallpaper` (`setWallpaper(uri, mode)` with `home`/`lock`/`both`, Android 7+ for the lock screen) | ❌ no public API exists — not even for Apple's own apps |
| Fallback | — | Save into the “Spotlight Studio” album, then use a *Set Wallpaper* shortcut (Shortcuts → Automation) or the Photos share sheet |
| Rotation | ✅ `expo-background-task` (WorkManager) re-applies every *interval* minutes when the phone is idle | ❌ the OS refuses to set the wallpaper, so the app explains why instead of pretending |

The module is loaded through `requireOptionalNativeModule('SpotlightWallpaper')`: on iOS, in
Expo Go or in a build that predates it, `nativeWallpaper` is simply `null` and the UI falls
back to save-to-Photos. The Android implementation decodes the file with a bounds pre-check,
rejects non-images and recycles the bitmap; the app's own size cap (`LIMITS.maxWallpaperBytes`)
and the resolution class filters decide what gets downloaded in the first place.

## Configuration (environment variables)

`mobile/.env.example` documents them; copy it to `mobile/.env.local` for local development or
set the same names in the EAS build profile (`env`) for release builds. They are
`EXPO_PUBLIC_*`, so they end up in the bundle — never put secrets in them.

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_CATALOG_URL` | this repo's `data/wallpapers.json` on GitHub | Full URL of a catalog JSON file |
| `EXPO_PUBLIC_IMAGE_BASE` | this repo's `blob/main` URL on GitHub | Base URL the `images/…` paths are resolved against |
| `EXPO_PUBLIC_API_URL` | *(empty)* | Base URL of a Spotlight Studio server; adds live catalog + crawl status |

## Building for the stores

```bash
cd mobile
npx eas-cli build --platform android --profile production   # .aab for Play
npx eas-cli build --platform ios --profile production       # .ipa for App Store Connect
npx eas-cli submit --platform android --profile production
```

`eas.json` ships three profiles: `development` (dev client), `preview` (installable APK/IPA)
and `production` (auto-incrementing build numbers, Play App Bundle). Link the project to your
own EAS account once with `npx eas-cli init` — that writes `extra.eas.projectId` into
`app.json`. To build locally instead (needs the Android SDK / Xcode):

```bash
npm run prebuild            # generates android/ and ios/ (git-ignored)
npm run build:android       # prebuild --clean + gradle assembleRelease
```

App identity is already configured in `app.json`: package/bundle `com.ketandutt.spotlightstudio`,
scheme `spotlightstudio`, Android permissions (INTERNET, ACCESS_NETWORK_STATE, SET_WALLPAPER,
WAKE_LOCK, RECEIVE_BOOT_COMPLETED, VIBRATE) with CAMERA/RECORD_AUDIO/LOCATION explicitly
**blocked**, iOS `BGTaskSchedulerPermittedIdentifiers` for the rotation task, iOS 16.4
deployment target and cleartext traffic enabled for LAN servers (`expo-build-properties`).

## Tests & quality gates

```bash
cd mobile
npm run typecheck     # tsc --noEmit
npm run lint          # eslint . --max-warnings 0
npm test              # jest (jest-expo preset)
npm run test:ci       # --ci --coverage --runInBand, enforces the coverage floor
npm run verify        # all three – what CI runs
```

The suites split by layer (see `mobile/tests/`): the ported core logic, the storage helpers,
the media/download/save services, the wallpaper + rotation services (Android and iOS
personalities), catalogue export, the optional native module, and two React suites for the
providers and the components. Platform differences are simulated by mocking
`src/core/platform`'s `getCapabilities()`; `expo-file-system`, `expo-media-library`,
`expo-sharing` and the native module are replaced by the doubles in `tests/mocks.ts`, so the
whole suite is offline and deterministic.

## Icons, splash and assets

`mobile/assets/` is generated — do not edit it by hand. `python scripts/make_icons.py`
(`make icons`) renders the brand mark once and writes both the PWA icons (`static/icons/`) and
the Expo set: `icon.png` (1024², opaque, full-bleed), `splash-icon.png`, `favicon.png`,
`android-icon-foreground.png` (adaptive-icon safe zone) and
`android-icon-monochrome.png` (themed icons).

## Privacy & security notes

* Favourites, history, rotation settings and recent searches live in `AsyncStorage` on the
  device; nothing is uploaded, there is no analytics and no third-party SDK.
* The only outbound traffic is the catalog and the images (GitHub or your own server).
* `data/wallpapers.json` and image URLs are untrusted input: the client validates every field
  while normalising rows, only accepts `http(s)` links, and the CSV export neutralises
  spreadsheet formulas (`= + - @`) exactly like the server and web client do.
* The Android background task only downloads and applies wallpapers; it never sends data out.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Set wallpaper” is missing / says unsupported | You are in Expo Go or on iOS. Build a dev client (`npm run android`) — and remember iOS cannot set the wallpaper at all. |
| Catalog will not refresh | Pull to refresh; the app keeps using the cached/bundled copy offline. Check `EXPO_PUBLIC_CATALOG_URL` if you set one. |
| Images stay grey | `EXPO_PUBLIC_IMAGE_BASE` must be reachable from the phone (not `localhost`), and must contain the `images/…` paths. |
| Rotation never runs | Android may throttle background work; check the status line in Settings, keep the app installed and battery optimisation off for it. |
| `npm run android` fails | No Android SDK/JDK on the machine — use EAS or install Android Studio. |

## 2.3 review notes

Fresh cached remote catalogs now load across app launches using the persisted freshness
stamp, and overlapping foreground/manual refreshes share one request. Provider regressions
cover both cold-cache freshness and expired-cache refresh. Mobile favorites/export formats
are unchanged and are distinct from browser favorites backups.

Native builds/device behavior were not verified in the 2.3 sandbox review. Compatible npm
updates did not clear all upstream advisories; consult [REVIEW.md](REVIEW.md) before a store
release. Do not force Expo/React Native major changes just to silence `npm audit`.
