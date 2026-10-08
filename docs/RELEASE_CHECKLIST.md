# Release and operations checklist

## Before release

- [ ] Review [REVIEW.md](REVIEW.md), especially outstanding mobile advisories.
- [ ] Run Python lint/tests, Node core/service-worker tests, Chromium smoke tests,
      mobile typecheck/lint/Jest and both npm audits; inspect actual CI results.
- [ ] Bump app version, HTML asset queries, service-worker version, README badge and
      changelog together. `tests/test_consistency.py` enforces consistency.
- [ ] Upgrade/audit Python installation tools; record resolved dependency versions for
      the target platform. Do not treat the Linux test environment as a Windows lockfile.
- [ ] Verify Android/iOS JavaScript exports AND native compilation separately; inspect custom
      module autolinking and the SDK 57 Gradle plugin. Hermes export is not a native build.
- [ ] Test one-visit PWA offline behavior, scope coexistence and upgrade from old caches;
      test UTC midnight/resume daily selection and cross-client favorites backup round-trip.
- [ ] Follow the [native release/device matrix](NATIVE_RELEASE.md), including final merged manifests,
      privacy aggregation, HTTPS/permission policy, cache/reset concurrency and startup recovery.
      Inspect actual Kotlin/Swift compiler CI; prebuild/autolinking/Hermes are not compilation.
- [ ] Review/host [PRIVACY.md](PRIVACY.md) and supply approved store contact/Data Safety declarations.
      Link the real EAS project/signing through approved tooling; never commit credentials.
- [ ] Test mobile double taps, cancellation/navigation, denied/limited Photos permissions,
      disk/network failure, empty rotation pools and rapid enable/disable/enable changes.
- [ ] Back up the stopped database and images; verify the backup opens and can restore.
- [ ] With real images available, run `python main.py --check`. LFS pointer warnings mean
      the library is not ready to serve local image bytes.
- [ ] Manually verify dark/light theme, keyboard/screen-reader navigation, narrow screens,
      deep links, invalid backup imports, offline recovery, and browser storage denied.
- [ ] Test desktop wallpaper changes on each supported OS; test native mobile builds on devices.
- [ ] Confirm third-party wallpaper rights, source terms and LFS storage/bandwidth budgets.

## Deployment

### Static gallery (preferred public deployment)

1. Run `python scripts/build_site.py`.
2. Publish **only `dist/site/`**, never the repository root. Confirm `/data/wallpapers.db`,
   `/.env`, `/.git/HEAD` and logs return 404.
3. For GitHub Pages select **GitHub Actions** as the publishing source and enable
   `.github/workflows/pages.yml`. Deployment still requires repository Pages permissions.
4. On a custom domain set the `image-base` meta tag as documented in [CONFIGURATION.md](CONFIGURATION.md).
5. Check first visit, installed PWA upgrade, offline revisit and real LFS image URLs.

### Server

- Run **one worker**; the OS library lock rejects another server/CLI owner before startup.
  Never unlink the sidecar or give different DBs a shared image/catalog directory.
- Use a local disk supporting SQLite WAL, with writable data/image folders.
- Public gallery: set `READ_ONLY=true`, explicit `ALLOWED_HOSTS`, HTTPS and proxy rate limits.
- Writable administration: loopback/VPN or an authenticated reverse proxy. Never expose it
  directly to the internet. Host/Origin checks are not user authentication.
- Forward Host and scheme correctly; only trust forwarded headers from your actual proxy.
  Scheme-aware CSRF checks need the correct HTTPS scheme at the application boundary.
- Keep CSP and framing protections. Do not strip security headers at the reverse proxy.
- Do not run CLI crawls/maintenance concurrently with the server, another CLI run or another
  worker. Stop the process first or operate through its API.
- Set `CPU_THREADS=2`, lower `CONCURRENT_DOWNLOADS` and `MAX_IMAGE_BYTES` on constrained
  machines; measure RAM/disk before increasing concurrency.

## Monitor

- Probe `/api/health` for liveness and inspect `lfs_pointers_detected`. A healthy response is
  not a full filesystem readiness check; run `--check` separately while stopped.
- Monitor error logs, queue backlog, available disk, memory and image-serving bandwidth.
- Inspect crawl results and failure counts; test outage/stop/resume behavior before scheduling.
- Take regular stopped-process backups. Use SQLite's backup API for DB-only live backups;
  a coordinated images+DB snapshot still requires stopping writers.

## Rollback / recovery

1. Stop every writer and retain the failed release's logs.
2. Restore the previous code and its compatible dependency environment.
3. Restore DB **and** images from the same backup; don't mix old DB and new WAL/SHM files.
   Never delete live WAL files. Version 2.5 migrates v2 → v3 (indexes); future schemas
   are refused. Roll back with a matching stopped-process backup, not a forced version edit.
4. Regenerate `data/wallpapers.json` (`python main.py --sync-catalog`) and run `--check`.
5. Restart and verify deep links, file bytes, counters, controls and HTTP cache validators.
6. If hard-kill orphans are reported, inspect them manually before deletion. The health
   command deliberately does not delete data.
7. Republish the static artifact if needed. Use a **new** asset/service-worker version for
   a rollback release so installed clients don't retain the broken shell.

## Audit evidence

```bash
# Use current tools; install pip-audit in a separate tools environment if desired.
python -m pip install --upgrade pip setuptools
pip-audit --vulnerability-service pypi
npm audit
cd mobile && npm audit
```

`cd mobile && APP_VARIANT=production npm run verify:release` also checks resolved native policy
and blocks on high-severity npm findings. The EAS production post-install hook has the same audit
block and no automatic waiver; preview builds exist for device QA, not store submission.

Record the date, exact environment, JSON findings and owner decisions with the release.
Current mobile findings/override rationale: [REVIEW.md](REVIEW.md#dependency-audit--2026-10-08).
Do not accept a zero count from a different dependency environment as evidence for this build.
