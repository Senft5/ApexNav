// Road marks the co-driver calls on a planned route (the route context's OpenStreetMap points and spans, route_ctx/
// osm_overpass.js): a stop sign that applies to the route, a railway level crossing, a one-lane bridge on a two-way road,
// speed bumps (one call for a run of them), a mapped deer (or other animal) crossing, horse-drawn buggies and a
// covered bridge. On a back road picked for its corners these are what catch a driver out:
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
    animal_crossing: { code: 'ANIMAL', call: 'Deer crossing' },
    buggy: { code: 'BUGGY', call: 'Horse-drawn buggies' },
    covered_bridge: { code: 'COVERED', call: 'Covered bridge' },
  };
  // a mapped animal-crossing sign names its animal (osm_overpass.js hazardOf label); deer is the one on these roads
  const animalCall = (label) => { const a = String(label || 'animals').toLowerCase(); return a === 'deer' ? 'Deer crossing' : /^(horse|horses)$/.test(a) ? 'Horse crossing' : /^(cow|cows|cattle)$/.test(a) ? 'Cattle crossing' : 'Animal crossing'; };
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
   * The marks of a route context as corridor positions [{ kind, atM, endM, n }] (n: how many in a bump run, endM its last),
   * in order.
   * Signs and crossings mapped twice within 40 m are one; bumps within 200 m of the last are one run. A one-lane or
   * covered bridge both on one span is two marks: different warnings (a covered bridge is often low as well as narrow).
   */
  function marksOf(ctx) {
    if (!ctx) return [];
    const raw = [];
    for (const p of Array.isArray(ctx.points) ? ctx.points : []) {
      if (!p || !finite(p.atM)) continue;
      if (p.kind === 'stop' || p.kind === 'level_crossing' || p.kind === 'buggy') raw.push({ kind: p.kind, atM: p.atM });
      else if (p.kind === 'animal_crossing') raw.push({ kind: p.kind, atM: p.atM, call: animalCall(p.label) });
      else if (p.kind === 'calming' && BUMPS.has(String(p.label || 'yes'))) raw.push({ kind: 'calming', atM: p.atM });
    }
    for (const s of Array.isArray(ctx.spans) ? ctx.spans : []) if (s && (s.kind === 'one_lane_bridge' || s.kind === 'covered_bridge') && finite(s.fromM)) raw.push({ kind: s.kind, atM: s.fromM });
    raw.sort((a, b) => a.atM - b.atM);
    const out = [], last = {};
    for (const r of raw) {
      const prev = last[r.kind];
      if (prev && r.atM - prev.endM < (r.kind === 'calming' ? RUN_M : SAME_M)) { prev.endM = r.atM; prev.n++; continue; }
      const m = { kind: r.kind, atM: r.atM, endM: r.atM, n: 1, ...(r.call ? { call: r.call } : {}) };
      out.push(m); last[r.kind] = m;
    }
    return out.map(({ kind, atM, endM, n, call }) => ({ kind, atM, endM, n, ...(call ? { call } : {}) }));
  }

  /**
   * Note events on track t ({lat, lon, dist}) for a route context and its corridor: [{ type: 'mark', kind, code, call,
   * index, dist_m, end_m, lat, lon }], each snapped to the track within 30 m (else left out). nearest(lat, lon, lats, lons) gives
   * { index, distM } (apex_core.js nearestIndex). A speed bump the track already calls is left out (unfelt).
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
      const d = t.dist[hit.index];
      out.push({ type: 'mark', kind: m.kind, code: k.code, call: m.call || (m.n > 1 && k.many ? k.many : k.call), index: hit.index, dist_m: d, end_m: d + (m.endM - m.atM), lat: at[0], lon: at[1] });
    }
    return unfelt(out, t.events);
  }

  /**
   * Marks less the mapped speed bumps the track already calls as a bump (a member's or the crowd's, apex_core.js /
   * contributor.js bumpEvents) within 30 m of the run: one thing gets one call, and the felt bump is the measured one.
   */
  function unfelt(marks, events) {
    const felt = (Array.isArray(events) ? events : []).filter((e) => e && e.type === 'bump' && finite(e.dist_m)).map((e) => e.dist_m);
    if (!felt.length || !Array.isArray(marks)) return marks || [];
    return marks.filter((m) => m.kind !== 'calming' || !felt.some((b) => b >= m.dist_m - SNAP_M && b <= (finite(m.end_m) ? m.end_m : m.dist_m) + SNAP_M));
  }

  const api = { marksOf, events, unfelt, placeAt, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadMarks = api;
})(typeof window !== 'undefined' ? window : globalThis);
