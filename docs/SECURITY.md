# Security

Spotlight Studio is a **local-first** application: the backend listens on `127.0.0.1` and has **no authentication**. The measures below protect it from the things that can still reach a loopback port — other web pages in your browser and untrusted data from the source sites. To report a vulnerability see [../SECURITY.md](../SECURITY.md).

## Threat model

| Threat | Mitigation |
|---|---|
| **CSRF** — a web page you visit sends `POST http://127.0.0.1:8765/api/control/start` or `…/set-wallpaper` (a "simple" request that needs no CORS pre-flight) | `OriginCheckMiddleware`: unsafe methods (`POST/PUT/PATCH/DELETE`) are rejected (`403`) when the `Origin` header is not the server's own origin or an allow-listed one, when `Origin: null`, or when `Sec-Fetch-Site: cross-site` is sent without an `Origin`. curl/scripts (no `Origin`) are unaffected. |
| **DNS rebinding** — an attacker domain re-pointed at 127.0.0.1 makes requests look same-origin | `HostCheckMiddleware`: only `127.0.0.1`, `localhost` and `[::1]` are answered by default (`400 Invalid host header` otherwise). The list is evaluated **per request** from `ALLOWED_HOSTS`/`HOST`. |
| **Cross-origin reads** | no CORS headers by default (the old `*` was removed); opt in per origin with `CORS_ORIGINS` |
| **Stored XSS** from scraped titles/tags | the UI never uses `innerHTML` with data — everything is `textContent`/DOM APIs; event delegation instead of inline handlers; a **CSP** forbids inline scripts/styles and `eval` (`script-src 'self'`); links from catalog data must be absolute `http(s)` URLs (`javascript:` is dropped); a test injects hostile titles/tags/URLs |
| **Information disclosure** | only `/data/wallpapers.json` is served from `data/`; the SQLite file, WAL and the log are not reachable (the 2.1 `/data` mount exposed them) |
| **Path traversal** | filenames are generated from a hash; every path is re-checked with `_safe_join` (must stay inside the images folder) |
| **CSV/formula injection** | exports prefix cells starting with `= + - @ TAB CR` with `'` (server **and** client) |
| **Resource exhaustion by a hostile site** | downloads are streamed with a size cap (`MAX_IMAGE_BYTES`), decoded images are limited to 120 megapixels, tiny files and non-images are rejected |
| **Man-in-the-middle on the crawler** | TLS verification is **on** (`VERIFY_SSL=true`; 2.1 disabled it globally) |
| **Content sniffing / clickjacking** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy` |

### Content-Security-Policy

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data: blob: https://github.com https://*.githubusercontent.com;
font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'
```
It is delivered as a `<meta http-equiv>` tag (so it also protects the static GitHub Pages site) and as a header by the server (plus `frame-ancestors 'none'`). A test keeps both identical. The GitHub origins are needed because the static showcase streams LFS images from them.

## Exposing the server to a network

Setting `HOST` (or `--host`) to a non-loopback address — e.g. `0.0.0.0` — makes the Host check accept **any** host and the API reachable by everyone on that network. Anyone who can reach the port can start crawls, run maintenance and change the wallpaper of the machine. A warning is logged. If you must do it:

* keep it on a trusted LAN or behind a VPN, **or** put a reverse proxy with authentication in front;
* set `ALLOWED_HOSTS` to the exact names you use;
* never forward the port to the internet;
* remember that a phone client needs the same widened access: the mobile app talks to
  `http://<your-ip>:8765` (set `EXPO_PUBLIC_API_URL`), which means `ALLOWED_HOSTS` must include
  that address. Save-to-Photos and set-wallpaper happen **on the phone** and are unaffected by
  the server's permissions — see [MOBILE.md](MOBILE.md).

## Data handling & privacy

* No telemetry, no analytics, no third-party scripts or fonts. The UI is entirely self-hosted.
* Outbound connections go only to the configured source sites (`peapix.com`, `img.peapix.com`, `windows10spotlight.com`) — and, in the static showcase, to GitHub for images.
* Favorites, display preferences and the theme are stored in the browser's `localStorage`; nothing is sent anywhere.
* The wallpapers belong to their copyright holders; see the disclaimer in the README.

## Dependencies

Runtime dependencies are small and widely used: `aiohttp`, `beautifulsoup4`, `fastapi`/`uvicorn`, `Pillow`, `python-dotenv` (+ `pywebview` on Windows). Version ranges allow security updates; `imagehash`, NumPy and SciPy were dropped to shrink the attack surface. Run `pip install pip-audit && pip-audit -r requirements.txt` periodically; Dependabot is configured for pip and GitHub Actions.

## Known limitations

* No authentication or HTTPS: not intended for untrusted networks (see above).
* `set-wallpaper` runs OS commands (`osascript`, `gsettings`, `plasma-apply-wallpaperimage`) with arguments derived from file paths created by the app itself — never from request input.
* A malicious source site could serve misleading titles/tags; the UI renders them inertly, but cannot judge their content.

## Public galleries and release auditing

Set `READ_ONLY=true` to reject every HTTP mutation. This does not restrict catalog reads,
CLI operations or startup migrations, and it is not filesystem read-only mode. For writable
remote deployments use authenticated TLS access; **Host allow-lists are not authentication**.
Origin comparison includes the scheme; configure trusted reverse-proxy headers correctly.

Static publication must use `python scripts/build_site.py` and publish only `dist/site/`.
A generic static server serving the repository root does not inherit FastAPI's protections.
HTML scraping is capped at 8 MiB of decompressed bytes; automatic CPU workers are capped at
four (explicit concurrency settings can still exhaust constrained hosts).

See [REVIEW.md](REVIEW.md#dependency-audit-2026-10-07) for current audit findings and unresolved
mobile advisories. Self-hosted Swagger UI attribution/version is recorded alongside its assets.
