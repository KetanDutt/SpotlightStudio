import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function worker(fetch, { quota = false } = {}) {
  const handlers = {};
  const entries = new Map();
  const cache = {
    match: async (key) => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key, response) => {
      if (quota) throw new Error('quota');
      entries.set(typeof key === 'string' ? key : key.url, response.clone());
    },
  };
  const context = vm.createContext({
    URL, Request, Response, fetch,
    caches: { open: async () => cache, match: cache.match },
    self: {
      location: { origin: 'https://example.com' },
      registration: { scope: 'https://example.com/gallery/' },
      addEventListener: (name, fn) => { handlers[name] = fn; },
    },
  });
  vm.runInContext(readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), context);
  return { handlers, entries, context };
}

test('service worker serves cached catalog during HTTP 503', async () => {
  const w = worker(async () => new Response('unavailable', { status: 503 }));
  w.entries.set('catalog', new Response('[{"id":1}]'));
  const res = await vm.runInContext('networkFirst("catalog", "data")', w.context);
  assert.equal(await res.text(), '[{"id":1}]');
});

test('cache quota failure does not turn successful network response into an error', async () => {
  const w = worker(async () => new Response('fresh'), { quota: true });
  const res = await vm.runInContext('networkFirst("catalog", "data")', w.context);
  assert.equal(await res.text(), 'fresh');
});

test('worker intercepts only its shell/catalog, not arbitrary URLs, images or APIs', () => {
  const w = worker(async () => new Response('ok'));
  for (const path of ['/api/status', '/gallery/images/a.jpg', '/gallery/unrelated?x=1',
    '/gallery/static/js/core.js?v=unbounded', '/gallery/sw.js']) {
    let called = false;
    w.handlers.fetch({ request: new Request(`https://example.com${path}`), respondWith: () => { called = true; } });
    assert.equal(called, false, path);
  }
  let response;
  w.handlers.fetch({ request: new Request('https://example.com/gallery/data/wallpapers.json'),
    respondWith: (promise) => { response = promise; } });
  assert.ok(response);
});
