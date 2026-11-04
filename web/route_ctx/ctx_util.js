// Shared helpers for the route-context providers of builder E (crowd, driver, car, ios_context, crew_meet): the
// ApexRouteCtx.register shim (until web/route_ctx/registry.js, builder A's, is loaded), NaN channels, spans from per-sample
// runs, a time budget that never blocks, and an ~30 m cell grid for matching map features to a corridor's samples.
// Pure; loaded before the providers. tests/test_route_ctx_crowd.py and friends exercise it through them.
(function (root) {
  'use strict';

  /**
   * The registry, or a shim that queues providers: `ApexRouteCtx.register(p)` keeps p in `pending`, which builder A's
   * registry adopts when it loads (`for (const p of old.pending) register(p)`). A real registry is never replaced.
   */
  function registry() {
    const R = root.ApexRouteCtx || (root.ApexRouteCtx = { pending: [], shim: true });
    if (typeof R.register !== 'function') R.register = function (p) { (this.pending || (this.pending = [])).push(p); return p; };
    return R;
  }

  /** A channel of n samples, all unknown. */
  const nan = (n) => new Float32Array(n).fill(NaN);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * Spans where pred(value, i) holds for at least minLenM of corridor distance: [{ fromM, toM, kind, value, label }], value the
   * mean over the span (NaN samples never count as holding).
   */
  function spansWhere(ch, distM, pred, minLenM, kind, label) {
    const out = [];
    let a = -1, sum = 0, n = 0;
    const close = (end) => {
      if (a >= 0 && distM[end] - distM[a] >= minLenM) {
        const lab = typeof label === 'function' ? label(a, end) : label;
        out.push({ fromM: Math.round(distM[a]), toM: Math.round(distM[end]), kind, value: Math.round((sum / n) * 1000) / 1000, ...(lab ? { label: lab } : {}) });
      }
      a = -1; sum = 0; n = 0;
    };
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (finite(v) && pred(v, i)) { if (a < 0) a = i; sum += v; n++; } else if (a >= 0) close(i - 1);
    }
    if (a >= 0) close(ch.length - 1);
    return out;
  }

  /** Resolves p's value, or `fallback` after ms or when signal aborts. Never rejects. */
  function within(p, ms, signal, fallback = null) {
    return new Promise((resolve) => {
      let done = false;
      const end = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => end(fallback), Math.max(0, ms));
      if (signal) { if (signal.aborted) end(fallback); else signal.addEventListener('abort', () => end(fallback), { once: true }); }
      Promise.resolve(p).then(end, () => end(fallback));
    });
  }

  // ~30 m cells (prefer.js uses 80 m for whole roads; map features along a road need finer)
  const CELL_M = 30;
  const cellKey = (lat, lon) => `${Math.round((lat * 110540) / CELL_M)}:${Math.round((lon * 111320 * Math.cos((lat * Math.PI) / 180)) / CELL_M)}`;
  /** Adds a polyline's cells to `map` with `value` (densified so no cell is skipped). geometry: [{lat, lon}] or [[lat, lon]]. */
  function paint(map, geometry, value) {
    const pts = (geometry || []).map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : p)).filter((p) => p && finite(p.lat) && finite(p.lon));
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[k + 1] || a;
      const d = Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
      const steps = Math.max(1, Math.ceil(d / (CELL_M / 2)));
      for (let s = 0; s < steps; s++) { const f = s / steps; map.set(cellKey(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f), value); }
    }
    return map;
  }
  /** The value of the cell under (lat, lon) or a neighbour; undefined when none. */
  function lookup(map, lat, lon) {
    const [y, x] = cellKey(lat, lon).split(':').map(Number);
    let hit;
    for (let dy = -1; dy <= 1 && hit === undefined; dy++) for (let dx = -1; dx <= 1; dx++) { const v = map.get(`${y + dy}:${x + dx}`); if (v !== undefined) { hit = v; break; } }
    return hit;
  }
  /** Metres between two points (flat earth, road scale). */
  const metres = (a, b) => Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));

  /** The union bbox [s, w, n, e] of corridors (their bbox, else their points). */
  function unionBox(corridors) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const c of corridors || []) {
      const b = Array.isArray(c.bbox) && c.bbox.length === 4 ? c.bbox : null;
      if (b) { s = Math.min(s, b[0]); w = Math.min(w, b[1]); n = Math.max(n, b[2]); e = Math.max(e, b[3]); continue; }
      for (let i = 0; i < (c.lat ? c.lat.length : 0); i++) { s = Math.min(s, c.lat[i]); n = Math.max(n, c.lat[i]); w = Math.min(w, c.lon[i]); e = Math.max(e, c.lon[i]); }
    }
    return s <= n && w <= e ? [s, w, n, e] : null;
  }

  const api = { registry, nan, finite, spansWhere, within, cellKey, paint, lookup, metres, unionBox, CELL_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCtxUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
