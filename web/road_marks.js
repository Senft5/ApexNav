// Road marks the co-driver calls on a planned route (the route context's OpenStreetMap points and spans, route_ctx/
// osm_overpass.js): a stop sign that applies to the route, a railway level crossing, a one-lane bridge on a two-way road,
// and speed bumps (one call for a run of them). On a back road picked for its corners these are what catch a driver out:
// a stop sign over a crest, a hump at the end of a fast straight. Each becomes a note event on the track (type 'mark'),
// read with the pace notes when they are on and drawn on the strip and the map; a stop sign's call distance includes
// braking to a stop (cockpit.js apexMpsOf). Only what the map has: a mark the map lacks is not invented, and with no route
// context there are no marks. Pure (tests/test_road_marks.py).
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const KINDS = {
    stop: { code: 'STOP', call: 'Stop sign' },
    level_crossing: { code: 'RAIL', call: 'Railway crossing' },
    one_lane_bridge: { code: 'BRIDGE', call: 'One-lane bridge' },
    calming: { code: 'HUMP', call: 'Speed bump', many: 'Speed bumps' },
  };
  const BUMPS = new Set(['bump', 'hump', 'table', 'cushion', 'yes', 'dip', 'rumble_strip']);   // not chicanes, islands or chokers
  const RUN_M = 200, SAME_M = 40, SNAP_M = 30;

  /** Where along a corridor ({lat, lon, distM}) metre m lies, as [lat, lon], or null. */
  function placeAt(c, m) {
    const d = c && c.distM;
    if (!d || !d.length || !finite(m) || m < 0 || m > d[d.length - 1] + 1) return null;
    let lo = 0, hi = d.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (d[mid] < m) lo = mid + 1; else hi = mid; }
    const j = Math.max(1, lo), seg = d[j] - d[j - 1], f = seg > 0 ? Math.max(0, Math.min(1, (m - d[j - 1]) / seg)) : 0;
    return [c.lat[j - 1] + (c.lat[j] - c.lat[j - 1]) * f, c.lon[j - 1] + (c.lon[j] - c.lon[j - 1]) * f];
  }

  /**
   * The marks of a route context as corridor positions [{ kind, atM, n }] (n: how many in a bump run), in order.
   * Stops and crossings mapped twice within 40 m are one; bumps within 200 m of the last are one run.
   */
  function marksOf(ctx) {
    if (!ctx) return [];
    const raw = [];
    for (const p of Array.isArray(ctx.points) ? ctx.points : []) {
      if (!p || !finite(p.atM)) continue;
      if (p.kind === 'stop' || p.kind === 'level_crossing') raw.push({ kind: p.kind, atM: p.atM });
      else if (p.kind === 'calming' && BUMPS.has(String(p.label || 'yes'))) raw.push({ kind: 'calming', atM: p.atM });
    }
    for (const s of Array.isArray(ctx.spans) ? ctx.spans : []) if (s && s.kind === 'one_lane_bridge' && finite(s.fromM)) raw.push({ kind: 'one_lane_bridge', atM: s.fromM });
    raw.sort((a, b) => a.atM - b.atM);
    const out = [], last = {};
    for (const r of raw) {
      const prev = last[r.kind];
      if (prev && r.atM - prev.endM < (r.kind === 'calming' ? RUN_M : SAME_M)) { prev.endM = r.atM; prev.n++; continue; }
      const m = { kind: r.kind, atM: r.atM, endM: r.atM, n: 1 };
      out.push(m); last[r.kind] = m;
    }
    return out.map(({ kind, atM, n }) => ({ kind, atM, n }));
  }

  /**
   * Note events on track t ({lat, lon, dist}) for a route context and its corridor: [{ type: 'mark', kind, code, call,
   * index, dist_m, lat, lon }], each snapped to the track within 30 m (else left out). nearest(lat, lon, lats, lons) gives
   * { index, distM } (apex_core.js nearestIndex).
   */
  function events(ctx, corridor, t, nearest) {
    if (!t || !t.dist || !t.dist.length || typeof nearest !== 'function') return [];
    const out = [];
    for (const m of marksOf(ctx)) {
      const at = placeAt(corridor, m.atM);
      if (!at) continue;
      const hit = nearest(at[0], at[1], t.lat, t.lon);
      if (!hit || !(hit.distM <= SNAP_M) || !(hit.index >= 0)) continue;
      const k = KINDS[m.kind];
      out.push({ type: 'mark', kind: m.kind, code: k.code, call: m.n > 1 && k.many ? k.many : k.call, index: hit.index, dist_m: t.dist[hit.index], lat: at[0], lon: at[1] });
    }
    return out;
  }

  const api = { marksOf, events, placeAt, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadMarks = api;
})(typeof window !== 'undefined' ? window : globalThis);
