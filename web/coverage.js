// Coverage map (IDEAS Q-14): the measured roads, drawn as their map line, thicker the surer they are. The server sends a
// confidence level per direction (`conf`: 1 one pass, 2 two to four, 3 five or more), never a count of passes or drivers.
// Its colour is the pavement members measured there (IDEAS U-13): smooth, fair or rough from the mean roughness the server
// sends per direction (`rough`, g), on the scale the route overview words a road with (route_story.js: under 0.10 g smooth,
// over 0.22 g rough). A tap says the same in words (describe), so the colour is never the only way to read it.
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

  const SMOOTH_G = 0.10, ROUGH_G = 0.22;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const at = (a, d) => (Array.isArray(a) && fin(a[d]) ? a[d] : null);

  /**
   * What the road's line stands for: its surer direction's numbers (both, averaged, when they are as sure as each other; a
   * direction nobody measured is left out). { conf, rough, banked, offCamber }, each null when not measured.
   */
  function reading(w) {
    const conf = [0, 1].map((d) => at(w && w.conf, d) || 0), top = Math.max(conf[0], conf[1]);
    if (!(top > 0)) return { conf: 0, rough: null, banked: null, offCamber: null };
    const dirs = [0, 1].filter((d) => conf[d] === top);
    const mean = (k) => { const v = dirs.map((d) => at(w[k], d)).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    return { conf: top, rough: mean('rough'), banked: mean('banked'), offCamber: mean('offCamber') };
  }

  /** The pavement class of a mean roughness (g): 1 smooth, 2 fair, 3 rough; 0 when roughness was not measured. */
  const surface = (rough) => (!fin(rough) || rough < 0 ? 0 : rough < SMOOTH_G ? 1 : rough > ROUGH_G ? 3 : 2);
  const SURFACE_WORD = ['Measured', 'Smooth pavement', 'Fair pavement', 'Rough pavement'];
  const SURE_WORD = ['', 'one pass so far', 'a few passes', 'many passes'];

  /**
   * A tapped road in words: "Smooth pavement (0.07 g) · many passes · 30% of it banked". Shares of the road banked into its
   * bends or off-camber are said from a tenth up. '' for a road with nothing measured.
   */
  function describe(w) {
    const r = reading(w);
    if (!r.conf) return '';
    const cls = surface(r.rough), parts = [SURFACE_WORD[cls] + (cls ? ` (${r.rough.toFixed(2)} g)` : ''), SURE_WORD[r.conf] || SURE_WORD[3]];
    const pct = (v) => Math.round(v * 100);
    if (fin(r.banked) && r.banked >= 0.1) parts.push(`${pct(r.banked)}% of it banked`);
    if (fin(r.offCamber) && r.offCamber >= 0.1) parts.push(`${pct(r.offCamber)}% off-camber`);
    return parts.join(' · ');
  }

  /** GeoJSON for the layer from the cached /api/coverage ways (Map way → item). s: surface (the pavement class). */
  function geojson(cache) {
    return { type: 'FeatureCollection', features: [...cache.values()].filter((w) => Array.isArray(w.line) && w.line.length >= 2).map((w) => ({
      type: 'Feature', properties: { t: tier(w.conf), s: surface(reading(w).rough), way: w.way },
      geometry: { type: 'LineString', coordinates: w.line.map(([la, lo]) => [lo, la]) } })) };
  }

  /** Adds a response's ways to the cache; true when anything new arrived. */
  function add(cache, json) {
    let added = false;
    for (const w of (json && json.ways) || []) {
      const was = cache.get(w.way);
      if (!was || JSON.stringify([was.conf, was.rough, was.banked, was.offCamber]) !== JSON.stringify([w.conf, w.rough, w.banked, w.offCamber])) { cache.set(w.way, w); added = true; }
    }
    return added;
  }

  const api = { boxFor, inside, tier, reading, surface, describe, geojson, add, MIN_ZOOM, MAX_SPAN, SMOOTH_G, ROUGH_G };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCoverage = api;
})(typeof window !== 'undefined' ? window : globalThis);
