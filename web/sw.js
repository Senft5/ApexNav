// The website's offline shell (IDEAS A-03). Network first for this site's own files, so a deploy is live on the next load;
// the last copy is kept and served when there is no signal. Never /api (accounts and live data), never other hosts (map
// tiles, routing, search keep their own caching), never the large voice models. The iOS app bundles its pages and has no
// service worker.
const CACHE = 'apexnav-shell-v2';
const SHELL = ['/index.html', '/analysis.html', '/manifest.webmanifest', '/brand/mark.svg', '/brand/icon-192.png', '/analysis_worker.js'];   // the worker has no <script> tag
/** The pages' own scripts (read from their <script src>), so the cockpit works offline after the first visit. */
const scriptsOf = (html) => [...html.matchAll(/<script src="([^"/:]+\.js)"/g)].map((m) => '/' + m[1]);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      const pages = await Promise.all(['/index.html', '/analysis.html'].map((p) => fetch(p).then((r) => (r.ok ? r.text() : ''))));
      await c.addAll([...new Set([...SHELL, ...pages.flatMap(scriptsOf)])]);
    } catch (_) { /* offline at install: the next online load fills it */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('apexnav-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Never /api, the voice and pronunciation models (large, cached by the page itself) or the bundled data.
const cacheable = (url) => url.origin === self.location.origin && !/^\/(api|voices|g2p|data)\//.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !cacheable(url)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // a page is kept once, without its query (?drive=, ?add=, ?t= links would each be a copy otherwise)
      const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req.mode === 'navigate' ? url.origin + url.pathname : req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await caches.match('/index.html'); if (page) return page; }
      throw err;
    }
  })());
});
