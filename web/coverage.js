// Coverage map (IDEAS Q-14): the measured roads, drawn as their map line, thicker the surer they are. The server sends a
// confidence level per direction (`conf`: 1 one pass, 2 two to four, 3 five or more), never a count of passes or drivers.
// A road with no line is waiting for a pioneer (first to measure it earns 3x, second 2x); one driver alone is never shown
// (Z-08), so blank never means "someone drives here". Pure (tests/test_coverage.py); index.html fetches and draws.
(function (root) {
  'use strict';
  const MAX_SPAN = 0.5, MIN_ZOOM = 9;

  /** The box to ask for around the map's view, clamped to MAX_SPAN° a side around its centre; null when zoomed too far out. */
  function boxFor(view) {
    if (!view || !(view.zoom >= MIN_ZOOM)) return null;
    const half = MAX_SPAN / 2 - 1e-4;   // under the server limit after rounding
    const lat = (view.s + view.n) / 2, lon = (view.w + view.e) / 2;
    const s = Math.max(view.s, lat - half), n = Math.min(view.n, lat + half), w = Math.max(view.w, lon - half), e = Math.min(view.e, lon + half);
    const r = (x) => Math.round(x * 1e4) / 1e4;
    return [r(s), r(w), r(n), r(e)];
  }

  /** Has `box` already been fetched (inside one we have)? */
  const inside = (box, had) => (had || []).some((h) => box[0] >= h[0] && box[1] >= h[1] && box[2] <= h[2] && box[3] <= h[3]);

  /** Tier for the line, from its surer direction: 2 = five or more passes, 1 = two to four, 0 = a single pass (faintest). */
  const tier = (conf) => Math.max(0, Math.max(...(conf || [0])) - 1);

  /** GeoJSON for the layer from the cached /api/coverage ways (Map way → item). */
  function geojson(cache) {
    return { type: 'FeatureCollection', features: [...cache.values()].filter((w) => Array.isArray(w.line) && w.line.length >= 2).map((w) => ({
      type: 'Feature', properties: { t: tier(w.conf) },
      geometry: { type: 'LineString', coordinates: w.line.map(([la, lo]) => [lo, la]) } })) };
  }

  /** Adds a response's ways to the cache; true when anything new arrived. */
  function add(cache, json) {
    let added = false;
    for (const w of (json && json.ways) || []) {
      const was = cache.get(w.way);
      if (!was || JSON.stringify(was.conf) !== JSON.stringify(w.conf)) { cache.set(w.way, w); added = true; }
    }
    return added;
  }

  const api = { boxFor, inside, tier, geojson, add, MIN_ZOOM, MAX_SPAN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCoverage = api;
})(typeof window !== 'undefined' ? window : globalThis);
