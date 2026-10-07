# Release and operations checklist

## Before release

- [ ] Review [REVIEW.md](REVIEW.md), especially outstanding mobile advisories.
- [ ] Run Python lint/tests, Node core/service-worker tests, Chromium smoke tests,
      mobile typecheck/lint/Jest and both npm audits; inspect actual CI results.
- [ ] Bump app version, HTML asset queries, service-worker version, README badge and
      changelog together. `tests/test_consistency.py` enforces consistency.
- [ ] Upgrade/audit Python installation tools; record resolved dependency versions for
      the target platform. Do not treat the Linux test environment as a Windows lockfile.
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

- Run **one worker**, on a local disk supporting SQLite WAL, with writable data/image folders.
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
   Never delete live WAL files. Schema v2 is unchanged by 2.3.0.
4. Regenerate `data/wallpapers.json` (`python main.py --sync-catalog`) and run `--check`.
5. Restart and verify deep links, file bytes, counters, controls and HTTP cache validators.
6. If hard-kill orphans are reported, inspect them manually before deletion. The health
   command deliberately does not delete data.
7. Republish the static artifact if needed. Use a **new** asset/service-worker version for
   a rollback release so installed clients don't retain the broken shell.
