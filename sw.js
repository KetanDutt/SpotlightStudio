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

const VERSION = "2.4.0";
const SHELL_CACHE = `spotlight-shell-${VERSION}`;
const DATA_CACHE = "spotlight-data-v1"; // survives app updates: it is the offline copy of the catalog

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
    // allSettled: one missing optional asset must not make the whole install fail.
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      const outdatedShell = key.startsWith("spotlight-shell-") && key !== SHELL_CACHE;
      const legacy = key.startsWith("spotlight-studio-"); // cache names used before v2.2
      if (outdatedShell || legacy) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function safePut(cache, key, response) {
  try { await cache.put(key, response); } catch (_) { /* quota/private mode: network still works */ }
}

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) await safePut(cache, fallbackKey || request, response.clone());
    // A transient server outage should not hide a usable offline catalog/shell.
    if (response && response.status >= 500) {
      const cached = await cache.match(fallbackKey || request);
      if (cached) return cached;
    }
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackKey || request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(SHELL_CACHE);
    await safePut(cache, request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/images/") || url.pathname.endsWith("/sw.js")) return;

  if (url.pathname.endsWith("/data/wallpapers.json")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  } else if (request.mode === "navigate") {
    // One canonical cached document, whatever the ?query / #hash of the visited URL.
    event.respondWith(
      networkFirst(request, SHELL_CACHE, "index.html").catch(async () => (await caches.match("./")) || Response.error())
    );
  } else if (SHELL.some((path) => new URL(path, self.registration.scope).href === url.href)) {
    // Never cache arbitrary query URLs: that creates an unbounded storage sink.
    event.respondWith(cacheFirst(request));
  }
});
