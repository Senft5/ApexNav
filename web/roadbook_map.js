// Roadbooks on the map (docs/SOCIAL.md 2.6): the Roadbooks layer draws the roads of your roadbooks, your crews' and the
// ones you follow on the main map, driven ones solid in the look's gain colour, the rest dashed in ink, so the roads you
// keep are there while you plan. Public roadbooks round the map's view are drawn too, thin and quiet, so good roads
// other members keep turn up where you are looking (a tap opens the book, where Follow is). A tap on one opens its
// roadbook (Drive it is there). Off by default, members only.
// Your own books: the phone already holds each road's box (GET /api/roadbooks), and only the books with a road in the
// map's view are opened (GET /api/roadbooks/:id, the same call the book's page makes). Public ones: the coarse cell of
// the map's centre (GET /api/roadbooks/near, as People's Roadbooks near you asks; never from inside a privacy zone),
// once a cell a session. At most MAX_FETCH books are opened a move, yours first, each once a session.
// Pure helpers: inView, nearInView, features (tests/test_roadbook_map.py).
(function (root) {
  'use strict';
  const MAX_FETCH = 6, SRC = 'apex-books-src', LINE = 'apex-books', DONE = 'apex-books-driven', CASING = 'apex-books-casing', PUB = 'apex-books-public';
  const LAYERS = [CASING, PUB, LINE, DONE];
  const fin = Number.isFinite;
  const touches = (b, v) => Array.isArray(b) && b.length === 4 && b.every(fin) && b[0] <= v[1] && v[0] <= b[1] && b[2] <= v[3] && v[2] <= b[3];

  /**
   * The ids of the books with a road whose [s, n, w, e] box touches the view ([s, n, w, e]), books in the order given.
   * books: [{ id, road_list: [{ box }] }].
   */
  function inView(books, view) {
    if (!Array.isArray(view) || view.length !== 4 || !view.every(fin)) return [];
    return (Array.isArray(books) ? books : []).filter((b) => b && b.id && (b.road_list || []).some((r) => r && touches(r.box, view))).map((b) => b.id);
  }

  /**
   * The ids of the public books (cards: [{ id, lat, lon }], lat/lon the book's area) whose area lies in the view grown by
   * half its size each way, nearest the view's centre first, leaving out the ids in skip (a Set: your own books).
   */
  function nearInView(cards, view, skip) {
    if (!Array.isArray(view) || view.length !== 4 || !view.every(fin)) return [];
    const [s, n, w, e] = view, dy = (n - s) / 2, dx = (e - w) / 2, cy = (s + n) / 2, cx = (w + e) / 2;
    const k = Math.cos(cy * Math.PI / 180), d = (c) => (c.lat - cy) ** 2 + ((c.lon - cx) * k) ** 2;
    return (Array.isArray(cards) ? cards : []).filter((c) => c && c.id && fin(c.lat) && fin(c.lon) && !(skip && skip.has(c.id))
      && c.lat >= s - dy && c.lat <= n + dy && c.lon >= w - dx && c.lon <= e + dx).sort((a, b) => d(a) - d(b)).map((c) => c.id);
  }

  /**
   * A FeatureCollection of the opened books' roads (full: Map id → { name, road_list: [{ id, name, geom [[lon, lat]], stamped }] }),
   * each road once even when two books hold it under the same id; a road with fewer than two points is left out.
   * Properties: book (its id), name (the road's), d (1 when you have driven it, else 0), p (1 for a public book you don't
   * keep, follow or share a crew with: pub, a Set of those ids). A road in one of your books is drawn as yours.
   */
  function features(full, pub) {
    const out = [], seen = new Set();
    const all = [...(full instanceof Map ? full : new Map())], isPub = (id) => !!(pub && pub.has(id));
    all.sort((a, b) => isPub(a[0]) - isPub(b[0]));                       // yours first, so a shared road id is drawn as yours
    for (const [id, b] of all) {
      for (const r of (b && b.road_list) || []) {
        if (!r || seen.has(r.id) || !Array.isArray(r.geom)) continue;
        const g = r.geom.filter((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]));
        if (g.length < 2) continue;
        seen.add(r.id);
        out.push({ type: 'Feature', properties: { book: id, name: String(r.name || ''), d: r.stamped ? 1 : 0, p: isPub(id) ? 1 : 0 }, geometry: { type: 'LineString', coordinates: g } });
      }
    }
    return { type: 'FeatureCollection', features: out };
  }

  /**
   * page: { map, call(method, path) → Promise<{ ok, data }>, books() → (a Promise of) [{ id, road_list: [{ box, stamped }] }]
   * (your lists, as last read), near(lat, lon) → (a Promise of) public book cards [{ id, lat, lon }] round there, or [] (it
   * keeps privacy zones out and asks once a cell), colours() → { ink, gain, casing }, open(bookId), blocked() → true while a
   * tap belongs to something else }.
   * Returns { setLayer(on), refresh(), restyle() }.
   */
  function mount(page) {
    const map = page.map, full = new Map(), pub = new Set();
    let on = false, gen = 0;
    const seenPub = new Set();                                          // public books the near list named this session
    const has = (id) => map && map.getLayer && map.getLayer(id);
    function paint() {
      if (!has(LINE)) return;
      const c = page.colours();
      map.setPaintProperty(LINE, 'line-color', c.ink);
      map.setPaintProperty(DONE, 'line-color', c.gain);
      map.setPaintProperty(CASING, 'line-color', c.casing);
      if (has(PUB)) map.setPaintProperty(PUB, 'line-color', c.ink);
    }
    // added on first use, and again if a new map style dropped them; under the planned route's own lines
    function ensure() {
      if (!map || !map.getSource || map.getSource(SRC)) return !!(map && map.getSource && map.getSource(SRC));
      const before = has('apex-alt') ? 'apex-alt' : undefined;
      map.addSource(SRC, { type: 'geojson', data: features(full, pub) });
      const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 16, b];
      // casing under your own roads only: a public book's road stays quiet
      map.addLayer({ id: CASING, type: 'line', source: SRC, filter: ['any', ['==', ['get', 'p'], 0], ['==', ['get', 'd'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-width': width(4, 10), 'line-opacity': 0.85 } }, before);
      // public, not driven: thin and faint in ink
      map.addLayer({ id: PUB, type: 'line', source: SRC, filter: ['all', ['==', ['get', 'd'], 0], ['==', ['get', 'p'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': width(1.5, 3.5), 'line-opacity': 0.5 } }, before);
      // to drive: dashed in ink; driven: solid in gain (a dash pattern can't follow a property, so two layers)
      map.addLayer({ id: LINE, type: 'line', source: SRC, filter: ['all', ['==', ['get', 'd'], 0], ['==', ['get', 'p'], 0]], layout: { 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': width(2, 5), 'line-dasharray': [2, 1.2] } }, before);
      map.addLayer({ id: DONE, type: 'line', source: SRC, filter: ['==', ['get', 'd'], 1], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': width(2, 5) } }, before);
      paint();
      const tap = (e) => {
        if (!on || (page.blocked && page.blocked()) || !e.features || !e.features.length) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['apex-route', 'apex-alt', 'apex-explore'].filter(has) }).length) return;   // a route drawn over it wins the tap
        page.open(e.features[0].properties.book);
      };
      map.on('click', LINE, tap); map.on('click', DONE, tap); map.on('click', PUB, tap);
      return true;
    }
    const show = (vis) => { for (const id of LAYERS) if (has(id)) map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none'); };
    async function refresh() {
      if (!on || !map || !map.getBounds || !ensure()) return;
      const b = map.getBounds(), view = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()];
      const mine = ++gen, books = (await page.books()) || [];
      if (mine !== gen || !on) return;
      const keep = new Set(books.map((x) => x && x.id));
      const ownWant = inView(books, view).filter((id) => !full.has(id)).slice(0, MAX_FETCH);
      // public books round the view, while there is room this move (yours first)
      let cards = [];
      if (page.near && ownWant.length < MAX_FETCH) {
        cards = (await Promise.resolve(page.near((view[0] + view[1]) / 2, (view[2] + view[3]) / 2)).catch(() => [])) || [];
        if (mine !== gen || !on) return;
      }
      for (const c of cards) if (c && c.id && !keep.has(c.id)) seenPub.add(c.id);
      const pubWant = nearInView(cards, view, keep).filter((id) => !full.has(id)).slice(0, MAX_FETCH - ownWant.length);
      const want = [...ownWant, ...pubWant];
      const got = await Promise.all(want.map((id) => page.call('GET', `/api/roadbooks/${encodeURIComponent(id)}`).catch(() => null)));
      if (mine !== gen || !on) return;
      got.forEach((r, i) => { if (r && r.ok && r.data && Array.isArray(r.data.road_list)) full.set(want[i], r.data); });
      // books you no longer keep, follow or share a crew with drop off the map (public ones met this session stay, as public)
      pub.clear();
      for (const id of [...full.keys()]) { if (keep.has(id)) continue; if (seenPub.has(id)) pub.add(id); else full.delete(id); }
      const src = map.getSource(SRC);
      if (src) src.setData(features(full, pub));
      show(true);
    }
    if (map && map.on) map.on('moveend', () => { if (on) refresh(); });
    function setLayer(next) {
      on = !!next; gen++;
      if (on) refresh(); else show(false);
    }
    /** A book changed (a road added, a stamp): read it again next time it is in view. */
    const forget = (id) => { if (id) full.delete(id); else full.clear(); if (on) refresh(); };
    return { setLayer, refresh, restyle: paint, forget };
  }

  const api = { inView, nearInView, features, mount, MAX_FETCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadbookMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
