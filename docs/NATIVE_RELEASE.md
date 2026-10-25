# Native 1.2 release readiness

**Reviewed 25 October 2026 · app 1.2.0 · bridge 0.3.0.**
The requested native hardening is implemented. **Do not submit this as a certified store release yet:**
dependency advisories, native compiler/device evidence and publishing approvals remain open.
The existing Still Glass UI and tracked wallpaper archive/bundled catalog were preserved.

## Implemented

| Area | Change |
|---|---|
| Image safety | Both native platforms validate canonical private-cache JPEG/PNG/WebP, 40 MiB / 120 MP cap and bounded decode. Android truncation checks, 2 MP validation / 12 MP apply sampling, policy/target checks, positive wallpaper ID and shared native lock. Swift complete ImageIO source/frame/type checks and shared lock. iOS still refuses setting wallpaper. |
| Storage | 256 MiB originals/partials, 40 MiB transfer reservations, 16 MiB free-disk margin, last-used/mtime eviction; 64 MiB export budget, unique filenames, 24-hour temporary cleanup; consumer pins and per-image leases. SDK display cache is separate. |
| Consent | Permission before transfer, add-only/no widening, no Android 11+ gallery-read prompt or album browsing. Legacy write bounded to API 29. iOS album only with pre-existing full-read consent; otherwise Recent. Android Apply failure never automatically saves. |
| Operations | Native writes serialized; latest manual intent preempts pending rotation; recheck plan/favorites/revisions before the OS call. Cancel on navigation/key change/sheet close; report confirmed completion if cancellation came after the OS action started. |
| Lifecycle | Root scheduler restores registration without opening Settings and reconciles on foreground. Unknown/unregister errors are not mistaken for stopped scheduling. Outer provider-independent recovery and an 8-second splash watchdog. |
| Reset/preferences | Refuse destructive work while actions/export/rotation are active; exclude new cache work during reset; drain writes, reject stale writes and reload providers/navigation. Preserve saved Photos. Theme writes outside state updaters with visible persistence errors. |
| Shipping policy | Default HTTPS-only, explicit development `.dev` identities, no production overlay/broad gallery-read permissions or unused iOS background modes, no app/wallpaper backup opt-in, release minification/resource shrinking, disabled production network inspector, offline privacy notice and reason declarations. |
| Automation | Resolved native-mod validation and EAS profile guard; repository CI runs JavaScript/config checks, but this checkout has no hosted Android/iOS compiler jobs. Production release remains blocked by the audit gate. |

## Evidence obtained in this workspace

| Gate | Result |
|---|---|
| TypeScript / ESLint | Passed, zero lint warnings |
| Jest | **209 passed in 22 suites** in the current JS-only verification gate |
| Coverage | **81.81% statements · 70.49% branches · 75.82% functions · 86.15% lines** (`npm run test:ci`; configured thresholds pass) |
| Expo SDK compatibility | Passed offline installed-SDK check; Reanimated pinned to expected **4.5.1** (worklets 0.10.1) |
| Resolved production config | Passed actual Android/iOS mod inspection: HTTPS, add-only descriptions, blocked permissions, no iOS background modes, backup/inspector/minify policy and version agreement |
| Native generation | Android/iOS `expo prebuild --clean --no-install` passed, no package mutation or prebuild warnings |
| Autolinking | Android local Kotlin class and Apple local pod/Swift class discovered |
| JS/Hermes exports | All platforms passed: approximately web **6.6 MB**, Android **7.4 MB**, iOS **7.2 MB**; sizes are exported JS, not final app download sizes |
| Repository regressions | **345 Python / 31 Node tests** and **209 mobile Jest tests** pass in the current checkout. The 16-test browser suite is configured as a separate CI job and requires a real Chromium install. |
| Data integrity | Public DB/catalog/images unchanged; the mobile offline bundle was synced to the matching 7,475-row public catalog. No original image bytes were changed. |

These are not substitutes for Gradle/Xcode compilation or an installed native app. Jest mocks the
OS/bridge. Prebuild writes project/config files; Hermes compiles JavaScript only. No JDK/Gradle,
Android SDK or Xcode toolchain was exercised in this environment; this repository currently has no
hosted Kotlin/Swift compiler workflow. No signed APK/AAB/IPA, device wallpaper change or store
submission was made.

## Remaining blockers — release owner must close

- [ ] **Dependencies:** as of 2026-10-25, mobile `npm audit` reports **5 high, 0 critical**
  findings in Expo CLI / `@expo/code-signing-certificates` / `node-forge` / `zod` dependency paths.
  The suggested automatic fix downgrades Expo to 44.0.6, incompatible with SDK 57; do not apply
  it. Resolve via compatible upstream updates or an explicit owner risk decision, then rerun
  audit and native tests. `verify:release` / the production EAS hook remain intentionally blocked.
- [ ] **Compiler gates:** compile on SDK-compatible Android/iOS toolchains (no hosted native
  compiler jobs exist in this repository). Verify final merged Android manifests, minified release
  behavior, resolved Pods/frameworks and app plus dependency privacy-manifest aggregation. Local
  generated source policy alone is not final evidence.
- [ ] **Device matrix:** complete the tests below, not just an emulator/web view.
- [ ] **Publishing:** link a real EAS project; confirm package/bundle ownership, monotonic store
  build numbers, provisioning/signing, App Store privacy/Play Data Safety and an approved hosted
  privacy/contact URL. Review [PRIVACY.md](PRIVACY.md); no store project IDs or credentials were invented.
- [ ] **Content/backend:** confirm photographer/source distribution rights, functioning full image
  bytes/Git LFS/CDN, bandwidth/storage budget, TLS/host policy and authentication for any writable
  private server. The mobile client has no general proxy-auth/token-management UI.

## Device acceptance matrix

Record OS/build/device, steps, actual permission state, memory/disk observations and result. Redact
private paths/backups/device IDs from public issue reports.

| Scenario | Must verify |
|---|---|
| Android 7–10 (supported target toolchain) | Legacy **write-only** consent denied/granted, API-29 compatibility; no read-permission widening |
| Android 11+, including current Android 16 | Save without broad read consent, no album browsing, home/lock/both, edge-to-edge/large font, managed/work-profile restrictions |
| iPhone/iPad iOS 16.4+ | Fresh add-only grant, denial/canAskAgain=false, old full/limited read consent, Recent/optional album, JPEG/PNG/WebP Photos, manual apply guidance |
| Corrupt/hostile media | HTML/LFS/tiny, truncated JPEG/PNG/WebP, invalid bounds, >40 MiB / >120 MP, codec errors; no broken promotion or Photos save |
| Resource pressure | Low free storage/RAM, concurrent images, pinned source during share/save/native apply, forced retry while shared, cache/export eviction, clear/reset refusal during work |
| Lifecycle | Cold start/offline, hung/failed storage, provider crash/retry, background/foreground/headless overlap, process kill/relaunch, screen/key change and sheet cancellation |
| Rotation | Enable/disable/enable, reboot, battery/data saver, interval/filters/target/favorites changed during transfer, latest manual apply priority, unknown registration state |
| Irreversible boundary | Cancel before OS call means no write; Cancel after a native save/apply starts must not falsely claim rollback or omit confirmed completion |
| Local data | Favorites backup web/mobile round trip, invalid/oversized JSON/picker cancellation, persistence failure, reset reload and preservation of Photos/other app namespaces |
| Accessibility/network | VoiceOver/TalkBack, large type, reduce motion/transparency, narrow/tablet layout, deep links, valid HTTPS/TLS failures and production HTTP refusal |

JS pins/revisions are per runtime; native locks are process-local. They are not a universal
headless multi-runtime or cross-process disk lock. Decoder/progress caps do not promise a hard total
OS/network memory cap; the SDK display cache is separate; OS actions already started are not undoable.
Native crashes, a blocked JS thread, firmware scheduling and recipient/OS backup policies remain
outside the React recovery/cleanup guarantee.

## Reproduce before shipping

```bash
cd mobile
npm ci
APP_VARIANT=production npm run verify
npm run test:ci
APP_VARIANT=production npm run verify:config
EXPO_OFFLINE=1 npx expo install --check
APP_VARIANT=production npx expo export --platform all
APP_VARIANT=production npx expo prebuild --clean --no-install
npx expo-modules-autolinking resolve --platform android --json
npx expo-modules-autolinking resolve --platform apple --json
APP_VARIANT=production npm run verify:release  # expected blocked until audit policy is resolved
```

Use preview EAS builds for device QA; production distribution stays gated. Build output, Pods,
SDKs, audit logs, archives and signing material are not committed. Full platform operation guide:
[MOBILE.md](MOBILE.md); global deployment/rollback: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
