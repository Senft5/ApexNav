// Road marks the co-driver calls on a planned route (the route context's OpenStreetMap points and spans, route_ctx/
// osm_overpass.js): a stop sign that applies to the route, a railway level crossing, a one-lane bridge on a two-way road,
// speed bumps (one call for a run of them), a mapped deer (or other animal) crossing, horse-drawn buggies, a
// covered bridge, a ford (the road through water), and where the road turns unpaved or rough. On a back road picked for its corners these are what catch a driver out:
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
    ford: { code: 'FORD', call: 'Water crossing' },
    unpaved: { code: 'GRAVEL', call: 'Unpaved road' },
    rough: { code: 'ROUGH', call: 'Rough road' },
  };
  // a mapped animal-crossing sign names its animal (osm_overpass.js hazardOf label); deer is the one on these roads
  const animalCall = (label) => { const a = String(label || 'animals').toLowerCase(); return a === 'deer' ? 'Deer crossing' : /^(horse|horses)$/.test(a) ? 'Horse crossing' : /^(cow|cows|cattle)$/.test(a) ? 'Cattle crossing' : 'Animal crossing'; };
  const BUMPS = new Set(['bump', 'hump', 'table', 'cushion', 'yes', 'dip', 'rumble_strip']);   // not chicanes, islands or chokers
  const RUN_M = 200, SAME_M = 40, SNAP_M = 30, UNPAVED_MIN_M = 50, ROUGH_MIN_M = 100, SURFACE_GAP_M = 300;

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
  function marksOf(ctx, corridor) {
    if (!ctx) return [];
    const raw = [];
    for (const p of Array.isArray(ctx.points) ? ctx.points : []) {
      if (!p || !finite(p.atM)) continue;
      if (p.kind === 'stop' || p.kind === 'level_crossing' || p.kind === 'buggy' || p.kind === 'ford') raw.push({ kind: p.kind, atM: p.atM });
      else if (p.kind === 'animal_crossing') raw.push({ kind: p.kind, atM: p.atM, call: animalCall(p.label) });
      else if (p.kind === 'calming' && BUMPS.has(String(p.label || 'yes'))) raw.push({ kind: 'calming', atM: p.atM });
    }
    for (const s of Array.isArray(ctx.spans) ? ctx.spans : []) if (s && (s.kind === 'one_lane_bridge' || s.kind === 'covered_bridge' || s.kind === 'ford') && finite(s.fromM)) raw.push({ kind: s.kind, atM: s.fromM });
    raw.sort((a, b) => a.atM - b.atM);
    const out = [], last = {};
    for (const r of raw) {
      const prev = last[r.kind];
      if (prev && r.atM - prev.endM < (r.kind === 'calming' ? RUN_M : SAME_M)) { prev.endM = r.atM; prev.n++; continue; }
      const m = { kind: r.kind, atM: r.atM, endM: r.atM, n: 1, ...(r.call ? { call: r.call } : {}) };
      out.push(m); last[r.kind] = m;
    }
    out.push(...surfaceRuns(ctx, corridor));
    out.sort((a, b) => a.atM - b.atM);
    return out.map(({ kind, atM, endM, n, call }) => ({ kind, atM, endM, n, ...(call ? { call } : {}) }));
  }

  /**
   * Where the road turns unpaved, or rough, as marks { kind: 'unpaved' | 'rough', atM, endM, n: 1 } from the context's
   * per-sample channels on the corridor's distances: unpaved from our tiles (`unpaved` 1) or Overpass (`surface_paved`
   * 0); rough from Overpass `smoothness` 3+ (bad or worse) on a paved stretch. A run counts from 50 m (rough: 100 m);
   * runs less than 300 m apart are one (a bridge deck or a patched bit is no new surface). Not at the very start: the car
   * is already on it. Untagged samples are unknown, never paved or smooth.
   */
  function surfaceRuns(ctx, c) {
    const ch = ctx.channels || {}, d = c && c.distM, out = [];
    if (!d || !d.length) return out;
    const val = (k, i) => (ch[k] && finite(ch[k][i]) ? ch[k][i] : null);
    const unpaved = (i) => val('unpaved', i) === 1 || val('surface_paved', i) === 0;
    const rough = (i) => !unpaved(i) && val('smoothness', i) !== null && val('smoothness', i) >= 3;
    for (const [kind, test, minM] of [['unpaved', unpaved, UNPAVED_MIN_M], ['rough', rough, ROUGH_MIN_M]]) {
      let run = null, cur = null;
      const close = () => { if (run && run.endM - run.atM >= minM) out.push(run); };
      for (let i = 0; i < d.length; i++) {
        if (test(i)) { if (cur) cur.endM = d[i]; else cur = { atM: d[i], endM: d[i] }; continue; }
        if (!cur) continue;
        if (run && cur.atM - run.endM < SURFACE_GAP_M) run.endM = cur.endM;
        else { close(); run = { kind, atM: cur.atM, endM: cur.endM, n: 1 }; }
        cur = null;
      }
      if (cur) { if (run && cur.atM - run.endM < SURFACE_GAP_M) run.endM = cur.endM; else { close(); run = { kind, atM: cur.atM, endM: cur.endM, n: 1 }; } }
      close();
    }
    return out.filter((m) => m.atM > d[0]);
  }

  /**
   * Note events on track t ({lat, lon, dist}) for a route context and its corridor: [{ type: 'mark', kind, code, call,
   * index, dist_m, end_m, lat, lon }], each snapped to the track within 30 m (else left out). nearest(lat, lon, lats, lons) gives
   * { index, distM } (apex_core.js nearestIndex). A speed bump the track already calls is left out (unfelt).
   */
  function events(ctx, corridor, t, nearest) {
    if (!t || !t.dist || !t.dist.length || typeof nearest !== 'function') return [];
    const out = [];
    for (const m of marksOf(ctx, corridor)) {
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

  /** Whether the map (Overpass) answered for this context: its own channel is known somewhere (an 'unavailable' answer is all NaN). */
  const mapAnswered = (ctx) => { const v = ctx && ctx.channels && ctx.channels.side_roads_per_km; return !!v && Array.prototype.some.call(v, finite); };

  /** Marks a and the marks of b that a doesn't have yet (the same code within 40 m is the same thing), in order. */
  function union(a, b) {
    const out = Array.isArray(a) ? a.slice() : [];
    for (const m of Array.isArray(b) ? b : []) if (!out.some((o) => o.code === m.code && Math.abs(o.dist_m - m.dist_m) < SAME_M)) out.push(m);
    return out.sort((x, y) => x.dist_m - y.dist_m);
  }

  /**
   * Whether a mark is called in cruise too, not only with the notes awake: a mapped animal crossing from dusk to dawn
   * (the sun under 6° up, sunAltRad in radians), when deer are on the move and a driver at an easy pace is not braced
   * for one. In daylight it waits for the notes like the other marks; unknown sun is daylight (no call it can't back).
   */
  const DUSK_RAD = 6 * Math.PI / 180;
  const cruiseWorthy = (m, sunAltRad) => !!m && m.type === 'mark' && m.kind === 'animal_crossing' && finite(sunAltRad) && sunAltRad < DUSK_RAD;

  const api = { marksOf, events, unfelt, union, mapAnswered, cruiseWorthy, placeAt, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadMarks = api;
})(typeof window !== 'undefined' ? window : globalThis);
