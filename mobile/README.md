# Spotlight Studio — mobile app

The Expo (React Native) client for the Spotlight Studio wallpaper library: browse and search
the same catalog as the web gallery, keep favourites and history on the device, download
wallpapers, **set them on Android** (home / lock / both) and rotate them in the background.
On iOS the app saves pictures to a “Spotlight Studio” album and walks you through the
Shortcuts step, because iOS has no public API to set the wallpaper.

Full guide: [../docs/MOBILE.md](../docs/MOBILE.md).

## Quick start

```bash
npm ci                # exact dependency versions
npm start             # Metro bundler (Expo Go)
npm run android       # dev build with the native wallpaper module
npm run ios           # same, on a Mac
npm run verify        # typecheck + lint + tests
```

Requirements: **Node ≥ 20**, plus Android Studio (JDK 17) for `npm run android` or Xcode 16+
for `npm run ios`. Cloud builds need only an EAS account:

```bash
npx eas-cli init                                  # once: links the project to your account
npx eas-cli build --platform android --profile production
```

## Scripts

| Script | What it does |
|---|---|
| `npm start` / `npm run web` | Metro bundler (native / browser) |
| `npm run android` · `npm run ios` | Prebuild and install a development build |
| `npm run prebuild` | Generate the native projects (`android/`, `ios/` — git-ignored) |
| `npm run build:android[:debug]` | Local Gradle release/debug build (needs the Android SDK) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint . --max-warnings 0` |
| `npm test` · `npm run test:ci` | Jest (the second one with coverage and CI settings) |
| `npm run verify` | typecheck + lint + tests — the gate used by CI |
| `node scripts/sync-catalog.mjs` | Refresh the offline copy in `src/data/catalog.json` from `../data/wallpapers.json` |

## Configuration

Copy `.env.example` to `.env.local` (or set the variables in your EAS build profile) to
point the app at your own catalog or server:

| Variable | Default |
|---|---|
| `EXPO_PUBLIC_CATALOG_URL` | this repository's `data/wallpapers.json` on GitHub |
| `EXPO_PUBLIC_IMAGE_BASE` | this repository's `blob/main` image base on GitHub |
| `EXPO_PUBLIC_API_URL` | *(empty)* — set it to your Spotlight Studio server for live data |

## Where to look

| | |
|---|---|
| `app/` | Routes (expo-router): gallery, search, directory, tags, detail, about, settings |
| `src/core/` | Pure logic ported from `static/js/core.js` (filters, titles, quality classes) |
| `src/services/` | Download, save, share, apply wallpaper, rotation, catalog export, storage |
| `modules/wallpaper/` | The Expo Module bridging to Android's `WallpaperManager` |
| `tests/` | Jest suites and the platform doubles |
| `../docs/MOBILE.md` | The complete guide (builds, stores, rotation, troubleshooting) |
