"""
security.py – HTTP hardening for the local API.

Threat model
------------
Spotlight Studio exposes an *unauthenticated* API on a local port that can start
crawls and change the desktop wallpaper.  A malicious **web page** open in the
user's browser could try to talk to it:

* **CSRF** – ``POST http://127.0.0.1:8765/api/control/start`` is a "simple" request
  that browsers send without a CORS pre-flight, so CORS configuration alone does
  not stop the *side effect*.  → :class:`OriginCheckMiddleware` rejects unsafe
  methods whose ``Origin`` / ``Sec-Fetch-Site`` says they come from elsewhere.
* **DNS rebinding** – an attacker domain re-pointed at 127.0.0.1 makes the request
  look same-origin.  → ``TrustedHostMiddleware`` only answers to known Host headers
  (configured in :meth:`Settings.allowed_hosts`).
* **Content sniffing / framing / XSS** – :class:`SecurityHeadersMiddleware` adds
  ``nosniff``, ``X-Frame-Options`` and a strict Content-Security-Policy.

Scraped titles are untrusted input: the UI renders them with ``textContent`` and the
CSP forbids inline scripts, so even a hostile title cannot execute code.
"""
from __future__ import annotations

from urllib.parse import urlparse

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Keep in sync with the ``<meta http-equiv="Content-Security-Policy">`` in
#: ``index.html`` (a test asserts this).  Images may come from GitHub because the
#: static showcase loads LFS-hosted wallpapers through ``github.com/.../blob/...?raw=true``.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data: blob: https://github.com https://*.githubusercontent.com; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "manifest-src 'self'; "
    "worker-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

_STATIC_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


class SecurityHeadersMiddleware:
    """Adds defensive response headers (and a CSP to HTML documents)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                for name, value in _STATIC_SECURITY_HEADERS.items():
                    if name.lower().encode() not in present:
                        headers.append((name.lower().encode(), value.encode()))
                content_type = next((v for k, v in headers if k.lower() == b"content-type"), b"")
                if content_type.startswith(b"text/html") and b"content-security-policy" not in present:
                    csp = CONTENT_SECURITY_POLICY + "; frame-ancestors 'none'"
                    headers.append((b"content-security-policy", csp.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class OriginCheckMiddleware:
    """
    Reject cross-site *state-changing* requests (CSRF protection).

    A request is allowed when it is not an unsafe method, carries no browser
    ``Origin`` (curl, scripts, tests), is same-origin, or comes from an origin that
    is explicitly allow-listed (``CORS_ORIGINS``).
    """

    def __init__(self, app: ASGIApp, allowed_origins: list[str] | None = None) -> None:
        self.app = app
        self.allowed = {o.rstrip("/").lower() for o in (allowed_origins or [])}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            headers = Headers(scope=scope)
            if not self._permitted(headers):
                response = JSONResponse(
                    {"detail": "Cross-origin request blocked."}, status_code=403
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _permitted(self, headers: Headers) -> bool:
        origin = headers.get("origin")
        fetch_site = headers.get("sec-fetch-site", "").lower()
        if origin is None:
            # Browsers always send Origin on cross-origin unsafe requests; a bare
            # "cross-site" fetch metadata header without it is still suspicious.
            return fetch_site != "cross-site"
        origin_norm = origin.rstrip("/").lower()
        if "*" in self.allowed or origin_norm in self.allowed:
            return True
        host = headers.get("host", "").lower()
        return bool(host) and urlparse(origin_norm).netloc == host
