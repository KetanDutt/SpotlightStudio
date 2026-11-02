# Project audit and release follow-up

Review date: 2026-11-02. This is a targeted review of the Python API, crawler,
web/PWA, Expo client, Roku audit tooling, CI and documentation—not a guarantee
of production readiness or a substitute for platform testing. See [REVIEW.md](REVIEW.md)
and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for existing safeguards and gates.

## Improvements made

- Validated browser-local collection storage, including malformed values and names
  such as `constructor` and `__proto__`; refreshed cached filters when membership
  changes and synchronized collection changes across tabs.
- Added deletion of a selected collection with confirmation; images and favorites
  are not deleted. Browser storage failures are reported rather than called saved.
- Limited ZIP input while reading response streams, including responses without a
  reliable Content-Length; prevented overlapping ZIP jobs and duplicate entry names.
  Catalog lookup uses the existing key index rather than scanning the entire archive.
- Refreshed shared web and mobile visual tokens, viewer fullscreen behavior and API
  reference styling. Reduced-motion and reduced-transparency support remain in place.

## Local verification

- Python: Ruff clean and 345 tests passed.
- Web: 34 Node tests passed; catalog validation (7,475 entries), static build and
  Roku static audit passed. Playwright tests were added for fullscreen and collections,
  but **were not run successfully** here: Chromium system libraries are missing.
- Mobile: TypeScript, ESLint and 209 Jest tests passed. No native build or device test
  was performed here.

## Remaining release gates and suggested work

1. Run the complete Playwright suite in CI with Chromium and its system dependencies;
   visually check desktop, mobile, light/dark, keyboard and reduced-motion states.
2. Re-run `npm audit` in `mobile/` before release. This environment reported 54
   advisories, including 6 high; investigate compatible upstream versions and validate
   native builds rather than forcing an incompatible Expo downgrade.
3. Exercise signed Android/iOS releases, background rotation and permissions on real
   devices; test Windows wallpaper, monitor and tray behavior on Windows; and run Roku
   channel/screensaver tests on hardware.
4. The writable API is unauthenticated and local-first. Do not expose it directly to
   the public internet; use a reviewed authenticated TLS proxy/VPN and firewall, or
   deploy the static gallery for public browsing.
5. Confirm source permissions, attribution, LFS hydration/bandwidth and a tested backup
   and restore procedure before publishing. Review Python dependency reproducibility,
   signed desktop packaging and localization as future work.

The ZIP limit applies to downloaded input bytes, not peak browser memory. Original
images hosted cross-origin must permit CORS for JavaScript ZIP downloads. Collections
remain browser-local and are not included in the portable favorites backup.
