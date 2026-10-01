// Keeps Nabd working without internet when it is used as a web app.
// The page itself is fetched fresh when online (so an update is never stuck behind an old page)
// and comes from the cache when offline. Other files have hashed names that never change,
// so they are served from the cache first.
const CACHE = 'nabd-v3';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './favicon.svg'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const page = req.mode === 'navigate';
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (page) return fresh.catch(async () => (await cache.match(req, { ignoreSearch: true })) ?? cache.match('./index.html'));
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit ?? fresh;
    }),
  );
});
