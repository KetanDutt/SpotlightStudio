# Spotlight Studio — native app 1.2.0

Expo SDK 57 / React Native client for the same Spotlight wallpaper catalog and Still Glass design.
Browse/search offline, discover a UTC daily image, filter by aspect/palette, keep local favorites/history,
back up favorites in the shared web/mobile JSON schema, export the catalog, and apply/rotate wallpapers
on Android. Detail views use compact WebP previews when available; save/share actions fetch the original.
iOS saves explicitly to Photos for manual application; it cannot directly set wallpaper.

**Implementation and JS/config checks are complete; store release is still gated.**
See [native release evidence](../docs/NATIVE_RELEASE.md) and the [full mobile guide](../docs/MOBILE.md).

## Development

Use supported Node 22.13+ LTS (22.22.3 tested), JDK 17/Android SDK or compatible Xcode on macOS.

```bash
npm ci
APP_VARIANT=development npm start
APP_VARIANT=development npm run android
APP_VARIANT=development npm run ios       # macOS
npm run verify                          # types, lint, 209 tests
npm run test:ci                          # coverage
```

Use PowerShell environment syntax on Windows. Expo Go/web support browsing; full-image actions
require the custom native bridge **0.3.0**. Native changes need a new binary. Development has separate
`.dev` app IDs and `spotlightstudiodev` scheme, leaving a store installation intact.

## 1.2 hardening

- Private-cache JPEG/PNG/WebP native validation, bounded decoding and serialized Android writes.
- Originals/partials: **256 MiB** quota; exports: **64 MiB** quota; free-disk checks, eviction,
  stale-file cleanup, active-consumer pins and per-image leases.
- Add-only Photos, no consent widening, no broad Android gallery-read permissions; Android apply
  failures never silently save. iOS normally saves to Recent, not a mandatory app album.
- Cancel/key-change cleanup, truthful unabortable system completion, root-owned rotation with
  fresh plan/favorite checks, manual priority and confirmed scheduler state.
- Outer provider-independent render recovery, 8-second splash watchdog, immediate reset reload,
  race-safe preference clearing and StrictMode-safe theme writes.
- HTTPS-only preview/production, narrower manifests/privacy declarations, offline privacy screen,
  profile/config validation, release audit gate and Kotlin/Swift CI compilation jobs.

## Configuration and scripts

Copy `.env.example` to `.env.local` for development; all `EXPO_PUBLIC_*` values are public, not secrets.

| Setting | Default |
|---|---|
| `APP_VARIANT` | `production`; explicit `development` permits HTTP test networking |
| `EXPO_PUBLIC_CATALOG_URL` | Repository catalog on GitHub |
| `EXPO_PUBLIC_API_URL` | Empty; optional configured server |
| `EXPO_PUBLIC_IMAGE_BASE` | API base when configured; otherwise GitHub `blob/main` |

Preview/production reject HTTP, credentials and invalid URL bases. Native clients need a
phone-reachable host, never an assumed localhost backend. See the guide for trusted LAN/read-only use.

| Command | Purpose |
|---|---|
| `npm run verify` | TypeScript, ESLint, deterministic Jest tests |
| `npm run verify:config` | Resolved production manifests/permissions/versions/HTTPS policy |
| `npm run verify:release` | JS/config plus high-severity npm audit; currently blocked by inherited advisories |
| `npm run prebuild` | Generate ignored Android/iOS projects; does not compile them |
| `npm run build:android[:debug]` | Local Gradle smoke build; not a certified/signed store artifact |
| `npx expo export --platform all` | Web and native JS/Hermes bundling |
| `npm run sync:catalog` | Copy the current public catalog into the offline app bundle; checked for parity in Python CI |

EAS profiles: development, HTTPS-only preview, iOS simulator, production. The post-install hook
validates policy and **does not waive production audit failures**. Link your own EAS project and
manage signing through store tooling; no credentials are committed.

Current evidence: **209 Jest tests in 22 suites**, TypeScript and ESLint pass. As of
2026-10-25, npm audit reports **5 high-severity mobile dependency findings**; the automatic
suggestion downgrades Expo to an incompatible SDK, so native release remains blocked pending a
safe upstream resolution or documented owner decision. Repository CI runs JS/config checks but
not Kotlin/Swift compilation. Device, signing, content-rights, real LFS serving and approved
store/privacy metadata also require review. Read [../docs/NATIVE_RELEASE.md](../docs/NATIVE_RELEASE.md)
before shipping.
