// Roadbooks on the map (docs/SOCIAL.md 2.6): the Roadbooks layer draws the roads of your roadbooks, your crews' and the
// ones you follow on the main map, driven ones solid in the look's gain colour, the rest dashed in ink, so the roads you
// keep are there while you plan. A tap on one opens its roadbook (Drive it is there). Off by default, members only.
// Nothing new is asked of the server about where you are: the phone already holds each road's box (GET /api/roadbooks),
// and only the books with a road in the map's view are opened (GET /api/roadbooks/:id, the same call the book's page
// makes), at most MAX_FETCH a move, each once a session. Pure helpers: inView, features (tests/test_roadbook_map.py).
(function (root) {
  'use strict';
  const MAX_FETCH = 6, SRC = 'apex-books-src', LINE = 'apex-books', DONE = 'apex-books-driven', CASING = 'apex-books-casing';
  const LAYERS = [CASING, LINE, DONE];
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
   * A FeatureCollection of the opened books' roads (full: Map id → { name, road_list: [{ id, name, geom [[lon, lat]], stamped }] }),
   * each road once even when two books hold it under the same id; a road with fewer than two points is left out.
   * Properties: book (its id), name (the road's), d (1 when you have driven it, else 0).
   */
  function features(full) {
    const out = [], seen = new Set();
    for (const [id, b] of (full instanceof Map ? full : new Map())) {
      for (const r of (b && b.road_list) || []) {
        if (!r || seen.has(r.id) || !Array.isArray(r.geom)) continue;
        const g = r.geom.filter((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]));
        if (g.length < 2) continue;
        seen.add(r.id);
        out.push({ type: 'Feature', properties: { book: id, name: String(r.name || ''), d: r.stamped ? 1 : 0 }, geometry: { type: 'LineString', coordinates: g } });
      }
    }
    return { type: 'FeatureCollection', features: out };
  }

  /**
   * page: { map, call(method, path) → Promise<{ ok, data }>, books() → (a Promise of) [{ id, road_list: [{ box, stamped }] }]
   * (your lists, as last read), colours() → { ink, gain, casing }, open(bookId), blocked() → true while a tap belongs to something else }.
   * Returns { setLayer(on), refresh(), restyle() }.
   */
  function mount(page) {
    const map = page.map, full = new Map();
    let on = false, gen = 0;
    const has = (id) => map && map.getLayer && map.getLayer(id);
    function paint() {
      if (!has(LINE)) return;
      const c = page.colours();
      map.setPaintProperty(LINE, 'line-color', c.ink);
      map.setPaintProperty(DONE, 'line-color', c.gain);
      map.setPaintProperty(CASING, 'line-color', c.casing);
    }
    // added on first use, and again if a new map style dropped them; under the planned route's own lines
    function ensure() {
      if (!map || !map.getSource || map.getSource(SRC)) return !!(map && map.getSource && map.getSource(SRC));
      const before = has('apex-alt') ? 'apex-alt' : undefined;
      map.addSource(SRC, { type: 'geojson', data: features(full) });
      const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 16, b];
      map.addLayer({ id: CASING, type: 'line', source: SRC, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-width': width(4, 10), 'line-opacity': 0.85 } }, before);
      // to drive: dashed in ink; driven: solid in gain (a dash pattern can't follow a property, so two layers)
      map.addLayer({ id: LINE, type: 'line', source: SRC, filter: ['==', ['get', 'd'], 0], layout: { 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': width(2, 5), 'line-dasharray': [2, 1.2] } }, before);
      map.addLayer({ id: DONE, type: 'line', source: SRC, filter: ['==', ['get', 'd'], 1], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': width(2, 5) } }, before);
      paint();
      const tap = (e) => {
        if (!on || (page.blocked && page.blocked()) || !e.features || !e.features.length) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['apex-route', 'apex-alt', 'apex-explore'].filter(has) }).length) return;   // a route drawn over it wins the tap
        page.open(e.features[0].properties.book);
      };
      map.on('click', LINE, tap); map.on('click', DONE, tap);
      return true;
    }
    const show = (vis) => { for (const id of LAYERS) if (has(id)) map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none'); };
    async function refresh() {
      if (!on || !map || !map.getBounds || !ensure()) return;
      const b = map.getBounds(), view = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()];
      const mine = ++gen, books = (await page.books()) || [];
      if (mine !== gen || !on) return;
      const want = inView(books, view).filter((id) => !full.has(id)).slice(0, MAX_FETCH);
      const got = await Promise.all(want.map((id) => page.call('GET', `/api/roadbooks/${encodeURIComponent(id)}`).catch(() => null)));
      if (mine !== gen || !on) return;
      got.forEach((r, i) => { if (r && r.ok && r.data && Array.isArray(r.data.road_list)) full.set(want[i], r.data); });
      // books you no longer keep, follow or share a crew with drop off the map
      const keep = new Set(books.map((x) => x && x.id));
      for (const id of [...full.keys()]) if (!keep.has(id)) full.delete(id);
      const src = map.getSource(SRC);
      if (src) src.setData(features(full));
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

  const api = { inView, features, mount, MAX_FETCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadbookMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
