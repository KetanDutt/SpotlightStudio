/*!
 * Spotlight Studio – service worker
 *
 *  • App shell (HTML/CSS/JS/icons)  → precached; assets are versioned (?v=…) so they are cache-first.
 *  • data/wallpapers.json           → network-first (always fresh when online, last copy offline).
 *  • HTML navigations               → network-first, falling back to the cached shell when offline.
 *  • /api/*, /images/*, cross-origin → never touched (the browser's own HTTP cache is better at it).
 *
 * Bump VERSION together with src/__init__.py (tests/test_consistency.py enforces this).
 * The desktop app does not use the service worker (app.js unregisters it).
 */
"use strict";

const VERSION = "2.6.0";
const SCOPE_KEY = encodeURIComponent(new URL(self.registration.scope).pathname);
const SHELL_PREFIX = `spotlight-shell-${SCOPE_KEY}-`;
const SHELL_CACHE = `${SHELL_PREFIX}${VERSION}`;
const DATA_CACHE = `spotlight-data-${SCOPE_KEY}-v1`; // survives app updates, isolated from other galleries

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  `static/css/tokens.css?v=${VERSION}`,
  `static/css/app.css?v=${VERSION}`,
  `static/js/theme-init.js?v=${VERSION}`,
  `static/js/core.js?v=${VERSION}`,
  `static/js/app.js?v=${VERSION}`,
  "static/icons/favicon.svg",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png",
  "static/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const requests = SHELL.map((url) => new Request(new URL(url, self.registration.scope), { cache: "reload" }));
    // Do not replace a working offline app with a half-installed shell. Icons
    // are optional; HTML, CSS and scripts (the first eight entries) are not.
    await cache.addAll(requests.slice(0, 8));
    await Promise.allSettled(requests.slice(8).map((request) => cache.add(request)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      const outdatedShell = key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE;
      if (outdatedShell) await caches.delete(key);
    }
    // Retain the previous offline catalog when upgrading from unscoped caches.
    // Copy only this scope's URL and leave other galleries' legacy data alone.
    try {
      const catalogUrl = new URL("data/wallpapers.json", self.registration.scope).href;
      const cache = await caches.open(DATA_CACHE);
      if (!await cache.match(catalogUrl)) {
        const old = await caches.match(catalogUrl);
        if (old) await safePut(cache, catalogUrl, old);
        else {
          // The first page often fetched its catalog before this worker took
          // control. Seed it now so offline works after ONE successful visit.
          const response = await fetch(new Request(catalogUrl, { cache: "no-cache" }));
          if (response.ok && (response.headers.get("content-type") || "").includes("application/json")) {
            await safePut(cache, catalogUrl, response);
          }
        }
      }
    } catch (_) { /* cache storage can be unavailable */ }
    await self.clients.claim();
  })());
});

async function safePut(cache, key, response) {
  try { await cache.put(key, response); } catch (_) { /* quota/private mode: network still works */ }
}

async function openCache(name) {
  try { return await caches.open(name); } catch (_) { return null; }
}

async function cachedMatch(cache, key) {
  try { return cache ? await cache.match(key) : null; } catch (_) { return null; }
}

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await openCache(cacheName);
  try {
    const response = await fetch(request);
    if (cache && response?.ok) await safePut(cache, fallbackKey || request, response.clone());
    // A transient server outage should not hide a usable offline catalog/shell.
    if (response && response.status >= 500) {
      const cached = await cachedMatch(cache, fallbackKey || request);
      if (cached) return cached;
    }
    return response;
  } catch (err) {
    const cached = await cachedMatch(cache, fallbackKey || request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await cachedMatch(caches, request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    const cache = await openCache(SHELL_CACHE);
    if (cache) await safePut(cache, request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/images/") || url.pathname.endsWith("/sw.js")) return;

  const catalogUrl = new URL("data/wallpapers.json", self.registration.scope);
  const indexUrl = new URL("index.html", self.registration.scope);
  if (url.pathname === catalogUrl.pathname && !url.search) {
    event.respondWith(networkFirst(request, DATA_CACHE, catalogUrl.href));
  } else if (request.mode === "navigate" &&
      (url.pathname === new URL(self.registration.scope).pathname || url.pathname === indexUrl.pathname)) {
    // One canonical cached document, whatever the ?query / #hash of the visited URL.
    event.respondWith(
      networkFirst(request, SHELL_CACHE, indexUrl.href).catch(async () =>
        (await cachedMatch(caches, self.registration.scope)) || Response.error())
    );
  } else if (SHELL.some((path) => new URL(path, self.registration.scope).href === url.href)) {
    // Never cache arbitrary query URLs: that creates an unbounded storage sink.
    event.respondWith(cacheFirst(request));
  }
});
