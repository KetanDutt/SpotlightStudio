/**
 * Spotlight Studio — High Performance Service Worker v2.3
 * Provides instant offline caching for the application shell and catalog JSON,
 * while allowing browser HTTP/2 native multi-threaded streaming for image assets.
 */

const CACHE_NAME = 'spotlight-studio-v2.4';
const STATIC_ASSETS = [
  './manifest.webmanifest',
  './',
  './index.html',
  './data/wallpapers.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Bypass ServiceWorker for API calls and dynamic images:
  // Let the browser's native C++ HTTP/2 network stack stream images directly with native disk cache.
  // This completely eliminates ServiceWorker fetch bottlenecks and stream abort errors.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/images/')) {
    return;
  }

  // 2. Stale-While-Revalidate for catalog JSON & HTML shell
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkPromise = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkPromise;
    })
  );
});
