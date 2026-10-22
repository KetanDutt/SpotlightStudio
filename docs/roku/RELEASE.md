# Releasing the channel

Work through this list before scheduling a publication.  Everything in
sections 1–3 is automated; sections 4–5 need a human and a device.

## 1. Content

- [ ] `python3 main.py --crawl` has run and `data/wallpapers.json` is current.
- [ ] `make roku-catalog` regenerated `roku/assets/catalog.json`.
- [ ] New wallpapers' LFS objects are pushed (the channel streams from
      `media.githubusercontent.com`, so missing objects mean spinners).

## 2. Version and manifest

- [ ] Bump `build_version` in `roku/manifest` (certification 6.1 requires it to
      change per submission and be non-zero).
- [ ] `build_date` matches the submission date.
- [ ] `roku-screensaver/manifest` bumped if the screensaver changed.

## 3. Automated gates

```bash
make roku-audit       # static gate: state keys, Roku API surface, dead calls
make roku-lint        # BrighterScript compile, both packages
make roku-check       # audit + cert pre-flight, both packages
make check            # repo unit tests
```

All four must be clean.  `roku-check` runs the audit first, then verifies
package size (≤ 4 MB), artwork opacity and dimensions, entry points,
banned/deprecated APIs and catalog freshness.  `make check` now also runs
`tests/test_roku_audit.py`, which asserts zero errors *and* zero warnings from
the auditor plus the manifest invariants.

## 4. On-device

- [ ] Sideload `dist/spotlight-studio-*.zip`; launch time under 15 s in the
      8085 console (`First frame rendered in …`).
- [ ] Navigate every screen; confirm 250 ms-feel responsiveness and that Back
      walks home and then exits.
- [ ] Ambient Mode for ≥ 10 minutes; `r2d2_bitmaps` shows texture memory stable.
- [ ] Open a 4K wallpaper in the viewer; open a favourite; run a search.
- [ ] Purchase flow with a sandbox/test product, then Restore Purchases.
- [ ] Deep links: launch-time and `/input` while running.
- [ ] 720p device (or set the TV to 720p): layout scales, nothing clips.
- [ ] Sideload `dist/spotlight-studio-screensaver-*.zip`; it appears under
      Settings → Theme → Screensavers and exits on any key.

## 5. Dashboard

- [ ] Store artwork (540×405 poster) and screenshots refreshed if the UI moved.
- [ ] In-App Products exist for all three SKUs with correct prices.
- [ ] Run **Static Analysis** and **App Behavior Analysis** in the dashboard;
      resolve every reported error before scheduling.
- [ ] Privacy policy / support URLs current (no accounts, no data collection —
      say so explicitly).
