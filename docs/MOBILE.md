# Mobile app (Android & iOS)

**Native client 1.2.0 · wallpaper bridge 0.3.0 · Expo SDK 57.**
The Expo/React Native client retains the [Still Glass](DESIGN.md) design and the same catalog
and pure filtering/daily-discovery rules as the web gallery. It is hardened for release
verification, **not certified for the stores**. Current evidence and blockers:
[NATIVE_RELEASE.md](NATIVE_RELEASE.md).

## Features and platform boundaries

| Feature | Behavior |
|---|---|
| Browse/search | Masonry/list, sources, tags, quality/sort filters, favorites, deep links, offline catalog and recent searches |
| Daily spotlight | Deterministic UTC daily selection shared with web for an identical valid catalog; changes at midnight/resume, **not OS wallpaper automation** |
| Detail | Downscaled full-image preview, retry, metadata, favorite, source/link actions, cancellable image actions and progress |
| Android Apply | Native home/lock/both, subject to device policy. Failure is explicit; it **never silently requests Photos or saves instead** |
| iOS Apply | Explicitly labeled Photos save. Choose the saved image in Photos, Settings or a Shortcuts Set Wallpaper action |
| Save | Saves to Photos/gallery without changing Android wallpaper. Consent is checked **before download** |
| Share | Validated image or selected export through the system share sheet; copy writes only the public link |
| Rotation | Opt-in Android background task, root-owned scheduling and foreground reconciliation. OS-selected timing, not an exact alarm; unavailable on iOS |
| Favorites backups | Portable `spotlight-favorites` v1 JSON, web/mobile compatible, merge-only, preserves unknown keys; 20,000 keys / 2 MiB |
| Directory exports | Catalog snapshot JSON or UTF-8 BOM/CRLF CSV, with formula neutralization. Not a supported crawler-import command |
| Settings | Appearance, rotation, source/refresh, guarded cache clearing, confirmed reset with immediate provider reload, offline privacy notice |

## Development

Use a supported **Node 22.13+ LTS** (verified on 22.22.3), or the compatible Node range in
`mobile/package.json`; install from the lockfile. Android needs JDK 17/Android Studio/SDK;
iOS needs an Expo SDK 57-compatible Xcode/SDK on macOS. EAS is an optional cloud build path.

```bash
cd mobile
npm ci
APP_VARIANT=development npm start
APP_VARIANT=development npm run android
APP_VARIANT=development npm run ios       # macOS only
npm run verify                          # types, lint, all Jest tests
npm run test:ci                          # coverage floor
```

On Windows, set environment variables in PowerShell instead of using the shell-prefix syntax.
**Expo Go/web can browse, search and manage local favorites, but full-image download/save/share,
Android application and rotation require the updated custom native module.** Older binaries
without `validateImage` fail clearly rather than bypassing validation. Changing native code,
permissions or build policy requires a new native binary; Metro/OTA JavaScript is not sufficient.

Development uses separate `.dev` package/bundle IDs and `spotlightstudiodev` scheme so it does
not overwrite a store installation. The production identity remains
`com.ketandutt.spotlightstudio`, scheme `spotlightstudio`.

## Configuration and sources

`app.json` contains the static app settings; `app.config.ts` validates deployment URLs and
selects the build variant. The safety plugin registers first because Expo's mod chain executes
in reverse order: it finalizes policy **after** dependency plugins. Verification inspects those
resolved mods, not just the source JSON.

| Variable | Default / policy |
|---|---|
| `APP_VARIANT` | `production`; `development` explicitly opts into test HTTP, `preview` is also HTTPS-only |
| `EXPO_PUBLIC_CATALOG_URL` | Published repository `data/wallpapers.json` on GitHub; absolute catalog URL |
| `EXPO_PUBLIC_API_URL` | Empty; optional configured server (`GET /api/catalog`) |
| `EXPO_PUBLIC_IMAGE_BASE` | Configured API base, otherwise GitHub `blob/main`; explicit override wins |

These values are **public bundle content**, not a secret store. Credentials, fragments,
malformed URLs and queries on image/API bases are rejected. Preview/production reject HTTP;
release runtime also refuses HTTP URLs. A catalog URL may contain a non-secret query.
The app has no arbitrary proxy-login/token-management feature.

Catalog resolution renders matching device cache or bundled rows first, then tries a configured
API (8-second deadline), then published GitHub JSON (20-second deadline). Cache freshness is
30 days, with origin/source/time provenance. Intentional empty catalogs stay empty, failed
refresh keeps offline rows but reports failure, and a stalled native cache read falls back after
3 seconds. Clearing the cache invalidates in-flight catalog writes from an older generation.
Images use the configured host, not an unrelated source-page download URL.

For an HTTP **development-only** LAN server:

```bash
# Run the desktop server on a trusted network, without writable administration:
HOST=0.0.0.0 READ_ONLY=true ALLOWED_HOSTS=192.168.0.9,127.0.0.1,localhost python main.py --server
# mobile/.env.local:
APP_VARIANT=development
EXPO_PUBLIC_API_URL=http://192.168.0.9:8765
```

Use a phone-reachable address, not localhost. Native clients do not require CORS; browser
clients do. Public/private production servers need authenticated TLS/VPN and a read-only
public gallery; see [SECURITY.md](SECURITY.md). Do not distribute development networking flags.

## Setting a wallpaper

Android Apply uses the native manager and returns its confirmed target; Save is separate.
iOS saves to Photos and you select that image manually in Photos/Settings or Shortcuts.
The app does not provide a custom Shortcuts action or silently save after an Android failure.

## Permissions, image validation and storage

- **iOS:** add-only Photos consent, no full gallery-read prompt. New saves normally appear in
  Photos / Recent. An app album is optional only with existing full-read consent from an older
  build. Denial never widens the request. No iOS background modes/task identifiers are shipped.
- **Android 11+:** MediaStore insertion without runtime gallery-read permission or album browsing.
  Android 7–10 use legacy write-only consent; `WRITE_EXTERNAL_STORAGE` has `maxSdkVersion=29`.
  The SDK's legacy-storage flag is retained for Android 10 and ignored by scoped storage on 11+.
- Camera, microphone, location, gallery-read/media-location/manage-storage and production overlay
  permissions are blocked. App backup and native wallpaper backup are disabled; manufacturer/OS
  transfer behavior and Photos sync still need review. App data is not encrypted secret storage.
- Both native implementations accept only **canonical private-cache file URIs**, supported static
  JPEG/PNG/WebP, at most **40 MiB / 120 MP**, and perform bounded decoder validation before cache
  reuse/promotion or a system action. Android adds format completeness checks and uses a 2 MP
  validation decode, at most 12 MP apply decode, shared native lock and positive OS confirmation.
  Swift uses complete ImageIO source/frame status and a ≤2048-pixel thumbnail under a shared lock.
  This is stronger than a signature check, not proof against every codec or OS failure.
- Originals plus partials are bounded at **256 MiB**, with worst-case 40 MiB transfer reservations,
  16 MiB free-disk margin, last-used/mtime eviction, consumer pins and 24-hour stale-part cleanup.
  Exports use unique filenames in a separately bounded **64 MiB** directory and stale-file cleanup.
  Catalogs are bounded at **32 MiB / 100,000 rows**; a favorites backup is at most 2 MiB.
- The display SDK has a **separate cache**, not included in the managed-original quota. Clear cache
  removes app-owned files and asks that SDK to clear disk images; it keeps favorites and Photos.
  Reset first confirms scheduling has stopped, excludes active cache work, drains preference writes,
  clears app-owned data and remounts providers/navigation immediately. It never deletes Photos.
- Per-image leases serialize transfers/consumers; a forced replacement cannot overwrite an active
  save/share/apply source. Native writes are serialized; newest manual intent supersedes pending
  background work. Rotation rechecks settings, favorites and write revisions before the OS call.

### Cancellation and recovery

Leaving/changing a detail item or closing its sheet cancels pending work. Cancel is available
through download/validation. **An OS save/apply/share already started is not undoable**; confirmed
completion is reported honestly. Byte-progress abort can overshoot and `text()` fallback may buffer
before validation. File leases/intent arbitration are per JS runtime; native decode/write locks are
process-local, not cross-process/distributed guarantees. Physical-device headless/foreground races
remain a release gate.

A provider-independent outer boundary catches render failures without depending on the failed theme
or router. An 8-second startup watchdog removes the splash and offers retry instead of hanging on
native storage. Neither mechanism catches every native crash, blocks a hung JS thread, or deletes
user preferences as recovery. Theme changes persist outside state updaters, including StrictMode.

## Release profiles and gates

`eas.json`: `development` (dev client/LAN), `preview` (HTTPS-only internal APK/device IPA),
`simulator` (preview-based iOS simulator), `production` (store distribution/AAB, incrementing builds).
Link your own EAS project and manage credentials through EAS/store tooling, never chat or committed files.

```bash
cd mobile
APP_VARIANT=production npm run verify:config
APP_VARIANT=production npm run verify:release  # includes npm audit; currently BLOCKED by upstream advisories
APP_VARIANT=production npx expo export --platform all
APP_VARIANT=production npx expo prebuild --clean --no-install
# Physical-device QA before any store submission:
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
# Only after all gates are approved:
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

The EAS post-install hook verifies profile policy and blocks production on high-severity audit
failure; it contains **no automatic waiver**. There are currently 55 affected npm dependency nodes
in three inherited advisory families, with no patched family versions published in the checked
registry. Do not force an incompatible Expo/Jest downgrade to silence the audit.

Local `APP_VARIANT=production npm run build:android` is a compilation smoke path with generated
signing configuration, **not a signed Play release**. `.github/workflows/mobile-native.yml` adds
Android release and unsigned iOS simulator compilation; hosted jobs have not been executed in this
sandbox. JavaScript exports/prebuild/autolinking do not compile Kotlin/Swift. Real-device tests,
final merged manifests/privacy aggregation, signing, permissions, rights and store declarations
remain mandatory. Follow [NATIVE_RELEASE.md](NATIVE_RELEASE.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Project layout and privacy

- `app/`: router screens, root recovery/providers/scheduler, `privacy.tsx` offline notice.
- `src/core/`: pure catalog/platform/rotation/privacy rules and limits.
- `src/services/`: cache, catalog I/O, media, wallpaper writer/controller, rotation, exports, storage.
- `src/providers/`: offline catalog and defensive local preferences; `src/hooks/`: action/scheduler lifecycles.
- `modules/wallpaper/`: local Kotlin/Swift bridge; `plugins/`: resolved native-policy finalizer.
- `scripts/verify-*.cjs`: release/EAS gates; `tests/`: deterministic Jest/native doubles.
- `node scripts/sync-catalog.mjs`: deliberate offline-catalog refresh; not part of verification.
- Brand icons/splash follow `python scripts/make_icons.py`; retain the existing design/assets.

No account/advertising/analytics or automatic crash uploads are implemented. GitHub/configured hosts
receive normal request information (including IP/URL/time); websites and user-chosen share recipients
have their own policies. Local backups/history are not cloud sync. The app notice and
[PRIVACY.md](PRIVACY.md) explain permissions, data retention, OS backups and contact. The publisher
must review this notice and host an approved public policy URL before store submission.

## Troubleshooting

| Symptom | Action |
|---|---|
| Image actions require updated native build | Expo Go/web or an older bridge: rebuild the binary, not only Metro |
| Photos denied | Enable add-only consent in OS Settings; the app does not retry with gallery read |
| Images grey / retry fails | Check connectivity, reachable HTTPS image host, and real image bytes rather than a Git LFS pointer |
| Cache busy/full or low disk | Finish/cancel actions or exports, then clear cache/free storage; saved Photos are untouched |
| Rotation late/restricted | Inspect Settings status and system battery/data policy; intervals are best effort |
| Startup timeout | Retry/restart; do not delete favorites as the first recovery action |
| Production build fails audit | Review inherited upstream findings and release gates; do not blindly force SDK changes |
