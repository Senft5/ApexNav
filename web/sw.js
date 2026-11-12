// The website's offline shell (IDEAS A-03). Network first for this site's own files, so a deploy is live on the next load;
// the last copy is kept and served when there is no signal. Never /api (accounts and live data), never other hosts (map
// tiles, routing, search keep their own caching), never the large voice models. The iOS app bundles its pages and has no
// service worker.
const CACHE = 'apexnav-shell-v2';
const SHELL = ['/index.html', '/analysis.html', '/manifest.webmanifest', '/brand/mark.svg', '/brand/icon-192.png', '/analysis_worker.js', '/stages_worker.js', '/graph_worker.js', '/graph_tiles.js'];   // the worker has no <script> tag
/** The pages' own scripts (read from their <script src>), so the cockpit works offline after the first visit. */
// route_ctx/: the route-context providers' folder (builder E), kept offline like the rest
const scriptsOf = (html) => [...html.matchAll(/<script src="((?:route_ctx\/)?[^"/:]+\.js)"/g)].map((m) => '/' + m[1]);
/** The modules index.html loads on first use (lazy.js GROUPS, REVIEW_FEEL F-03) and its bundled fonts (F-12). */
const lazyOf = (js) => [...js.matchAll(/'([a-z0-9_]+\.js)'/g)].map((m) => '/' + m[1]);
const FONTS = ['/fonts/fonts.css', ...[600, 700, 800].map((w) => `/fonts/barlow-condensed-${w}.woff2`), '/fonts/inter-tight.woff2'];   // the latin files; -ext ones as used

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      const pages = await Promise.all(['/index.html', '/analysis.html'].map((p) => fetch(p).then((r) => (r.ok ? r.text() : ''))));
      const lazy = await fetch('/lazy.js').then((r) => (r.ok ? r.text() : '')).catch(() => '');
      await c.addAll([...new Set([...SHELL, ...FONTS, ...pages.flatMap(scriptsOf), ...lazyOf(lazy)])]);
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

// A connection that answers nothing (a hotel or roadside "lie-fi") would hold a network-first load for minutes. With a
// kept copy we wait SLOW_MS for the network, then serve the copy; the network answer still lands in the cache for next time.
// Without one there is nothing better to show, so the network gets all the time it needs.
const SLOW_MS = 5000;

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !cacheable(url)) return;
  // a page is kept once, without its query (?drive=, ?add=, ?t= links would each be a copy otherwise)
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
  const kept = () => caches.match(key, { ignoreSearch: req.mode === 'navigate' });
  e.respondWith((async () => {
    const net = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}); }
      return res;
    });
    const hit = await kept().catch(() => null);
    try {
      if (!hit) return await net;
      let timer;
      const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SLOW_MS); });
      const res = await Promise.race([net, slow]).finally(() => clearTimeout(timer));
      if (res) return res;
      net.catch(() => {});                                   // the late answer still fills the cache; its failure is no one's
      return hit;
    } catch (err) {
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await caches.match('/index.html'); if (page) return page; }
      throw err;
    }
  })());
});
