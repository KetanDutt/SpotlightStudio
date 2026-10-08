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

test('cache-storage failure still returns a successful network response', async () => {
  const w = worker(async () => new Response('fresh'));
  w.context.caches.open = async () => { throw new Error('blocked cache storage'); };
  w.context.caches.match = async () => { throw new Error('blocked cache storage'); };
  assert.equal(await (await vm.runInContext('networkFirst("catalog", "data")', w.context)).text(), 'fresh');
  assert.equal(await (await vm.runInContext('cacheFirst("shell")', w.context)).text(), 'fresh');
});

test('catalog caching is scope-bound and never creates entries for arbitrary queries', () => {
  const w = worker(async () => new Response('[]'));
  for (const path of ['/other/data/wallpapers.json', '/gallery/nested/data/wallpapers.json',
    '/gallery/data/wallpapers.json?cachebust=1', '/data/wallpapers.json']) {
    let called = false;
    w.handlers.fetch({ request: new Request(`https://example.com${path}`), respondWith: () => { called = true; } });
    assert.equal(called, false, path);
  }
  assert.equal(vm.runInContext('DATA_CACHE', w.context), 'spotlight-data-%2Fgallery%2F-v1');
});

test('a broken mandatory shell prevents activation; optional icons do not', async () => {
  const w = worker(async () => new Response('ok'));
  let skipped = false;
  w.context.self.skipWaiting = async () => { skipped = true; };
  w.context.caches.open = async () => ({
    addAll: async () => { throw new Error('core.js is unavailable'); },
    add: async () => {},
  });
  let install;
  w.handlers.install({ waitUntil: promise => { install = promise; } });
  await assert.rejects(install, /unavailable/);
  assert.equal(skipped, false);
  w.context.caches.open = async () => ({
    addAll: async () => {},
    add: async () => { throw new Error('optional icon missing'); },
  });
  w.handlers.install({ waitUntil: promise => { install = promise; } });
  await install;
  assert.equal(skipped, true);
});

test('activation deletes only this gallery scope\'s outdated shell cache', async () => {
  const w = worker(async () => new Response('ok'));
  const deleted = [];
  w.context.caches.keys = async () => ['spotlight-shell-%2Fgallery%2F-old',
    'spotlight-shell-%2Fother%2F-old', 'spotlight-data-%2Fgallery%2F-v1', 'unrelated', 'spotlight-data-v1'];
  w.context.caches.delete = async key => { deleted.push(key); return true; };
  w.context.self.clients = { claim: async () => {} };
  let activation;
  w.handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['spotlight-shell-%2Fgallery%2F-old']);
});

test('activation seeds the initial offline catalog before claiming its first page', async () => {
  const w = worker(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
  w.context.caches.keys = async () => [];
  let claimed = false;
  w.context.self.clients = { claim: async () => { claimed = true; } };
  let activation;
  w.handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.equal(claimed, true);
  assert.equal(await w.entries.get('https://example.com/gallery/data/wallpapers.json').text(), '[]');
});
