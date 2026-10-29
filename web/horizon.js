// The road ahead with no route (docs/design/REVIEW.md 3.1: Start with no route calls corners on whatever road you're on).
// From the map's own road lines around you (the vector tiles' `transportation` layer), follow the road you are on in the
// direction you are going, through junctions only where the way on is plain (one road, or one that carries straight on
// with the others turning off), and stop at the first junction where it isn't: the co-driver never guesses a turn.
// Pure (tests/test_horizon.py); the page feeds it the tile features and builds notes from the line it returns.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const M_LAT = 110540;
  const SNAP_M = 0.8, NEAR_M = 30, ALIGN_DEG = 50, STRAIGHT_DEG = 35, OFF_DEG = 50;
  const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, minor: 2, unclassified: 2, residential: 2, service: 1, track: 0 };

  const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const bearingOf = (ax, ay, bx, by) => (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;

  /**
   * lines: [{ coords: [[lon, lat], ...], cls }] (tile pieces are fine: shared ends are joined); me: { lat, lon, heading }.
   * Returns { coords: [[lon, lat], ...] from you along the road, m: its length, end: 'length' | 'junction' | 'dead end' }
   * or null when you are not on a mapped road going along it.
   */
  function ahead(lines, me, maxM = 2000) {
    if (!me || !finite(me.lat) || !finite(me.lon) || !finite(me.heading) || !Array.isArray(lines)) return null;
    const kx = 111320 * Math.cos(me.lat * Math.PI / 180);
    const xy = ([lon, lat]) => [(lon - me.lon) * kx, (lat - me.lat) * M_LAT];
    const ll = ([x, y]) => [me.lon + x / kx, me.lat + y / M_LAT];
    // the graph: vertices snapped to SNAP_M so tile pieces join; each undirected edge keeps its road class
    const key = ([x, y]) => `${Math.round(x / SNAP_M)},${Math.round(y / SNAP_M)}`;
    const pos = new Map(), adj = new Map();
    const link = (a, b, cls) => { if (a === b) return; if (!adj.has(a)) adj.set(a, new Map()); if (!adj.has(b)) adj.set(b, new Map()); adj.get(a).set(b, cls); adj.get(b).set(a, cls); };
    const edges = [];
    for (const l of lines) {
      if (!l || !Array.isArray(l.coords) || l.coords.length < 2) continue;
      let prev = null;
      for (const c of l.coords) {
        if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1])) { prev = null; continue; }
        const p = xy(c), k = key(p);
        if (!pos.has(k)) pos.set(k, p);
        if (prev && prev !== k) { link(prev, k, l.cls); edges.push([prev, k, l.cls]); }
        prev = k;
      }
    }
    // the edge you are on: the nearest within NEAR_M that runs your way
    let best = null;
    for (const [a, b, cls] of edges) {
      const [ax, ay] = pos.get(a), [bx, by] = pos.get(b), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      if (!L2) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)), px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (d > NEAR_M) continue;
      const fwd = bearingOf(ax, ay, bx, by);
      const along = angDiff(fwd, me.heading) <= ALIGN_DEG ? [a, b] : angDiff((fwd + 180) % 360, me.heading) <= ALIGN_DEG ? [b, a] : null;
      if (!along) continue;
      if (!best || d < best.d) best = { d, from: along[0], to: along[1], px, py, cls };
    }
    if (!best) return null;
    const out = [[best.px, best.py]];
    let m = 0, prevK = best.from, curK = best.to, end = 'length', cls = best.cls;
    const seen = new Set([prevK]);
    for (let guard = 0; guard < 4000; guard++) {
      const p0 = out[out.length - 1], p1 = pos.get(curK), seg = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (m + seg >= maxM) { const f = (maxM - m) / seg; out.push([p0[0] + f * (p1[0] - p0[0]), p0[1] + f * (p1[1] - p0[1])]); m = maxM; break; }
      out.push(p1); m += seg;
      if (seen.has(curK)) { end = 'junction'; break; }                  // a loop back on itself
      seen.add(curK);
      const inB = bearingOf(pos.get(prevK)[0], pos.get(prevK)[1], p1[0], p1[1]);
      const next = [...(adj.get(curK) || new Map()).entries()].filter(([k]) => k !== prevK)
        .map(([k, c]) => ({ k, c, turn: angDiff(bearingOf(p1[0], p1[1], pos.get(k)[0], pos.get(k)[1]), inB) }));
      if (!next.length) { end = 'dead end'; break; }
      let pick = null;
      if (next.length === 1) pick = next[0];
      else {
        // carry straight on only when one road clearly does and every other turns off; a fork is never guessed
        const straight = next.filter((n) => n.turn <= STRAIGHT_DEG), off = next.filter((n) => n.turn >= OFF_DEG);
        if (straight.length === 1 && straight.length + off.length === next.length && (RANK[straight[0].c] ?? 2) >= (RANK[cls] ?? 2) - 1) pick = straight[0];
      }
      if (!pick) { end = 'junction'; break; }
      prevK = curK; curK = pick.k; cls = pick.c;
    }
    if (m < 50) return null;
    return { coords: out.map(ll), m: Math.round(m), end };
  }

  const api = { ahead };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexHorizon = api;
})(typeof window !== 'undefined' ? window : globalThis);
