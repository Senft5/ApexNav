// The website's offline shell (IDEAS A-03). Network first for this site's own files, so a deploy is live on the next load;
// the last copy is kept and served when there is no signal. Never /api (accounts and live data), never other hosts (map
// tiles, routing, search keep their own caching), never the large voice models. The iOS app bundles its pages and has no
// service worker.
const CACHE = 'apexnav-shell-v1';
const SHELL = ['/index.html', '/analysis.html', '/manifest.webmanifest', '/brand/mark.svg', '/brand/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('apexnav-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const cacheable = (url) => url.origin === self.location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/voices/');

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !cacheable(url)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await caches.match('/index.html'); if (page) return page; }
      throw err;
    }
  })());
});
