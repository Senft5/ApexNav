// The arrow on the map at the next turn of a route being driven, as Apple and Google Maps draw one: the route's own line
// through the junction, from a little before the turn to a little past it, with a head where it leaves. The page draws the
// shaft as a line (its width grows with the zoom like the road's) and the head as a filled triangle, both in the theme's
// paper with the route's ink round them, so it stands out on the route line it lies on. Arrivals get none (the
// destination has its own pin). Pure (tests/test_turn_arrow.py).
(function (root) {
  'use strict';
  const R = 6371008.8, RAD = Math.PI / 180;
  const ARRIVE = new Set([4, 5, 6]);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** The point `m` metres along a track { lat, lon, dist }, or null off its ends. */
  function pointAt(t, m) {
    const d = t.dist, n = d.length;
    if (!finite(m) || m < d[0] || m > d[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= m) lo = mid; else hi = mid; }
    const span = d[hi] - d[lo], f = span > 0 ? (m - d[lo]) / span : 0;
    return { lat: t.lat[lo] + f * (t.lat[hi] - t.lat[lo]), lon: t.lon[lo] + f * (t.lon[hi] - t.lon[lo]), i: lo };
  }
  /** The track from `a` to `b` metres as [lon, lat] pairs, both ends interpolated. */
  function slice(t, a, b) {
    const p = pointAt(t, a), q = pointAt(t, b);
    if (!p || !q) return [];
    const out = [[p.lon, p.lat]];
    for (let i = p.i + 1; i <= q.i; i++) if (t.dist[i] > a && t.dist[i] < b) out.push([t.lon[i], t.lat[i]]);
    out.push([q.lon, q.lat]);
    return out;
  }
  // metres east and north of `o` <-> lon/lat (flat over an arrow's few tens of metres)
  const toXY = (o, p) => [(p[0] - o[0]) * RAD * R * Math.cos(o[1] * RAD), (p[1] - o[1]) * RAD * R];
  const toLL = (o, x, y) => [o[0] + x / (R * Math.cos(o[1] * RAD) * RAD), o[1] + y / (R * RAD)];

  /**
   * The arrow for a step { m, type } of a track { lat, lon, dist } (metres along it): a FeatureCollection of the shaft
   * (LineString, part 'shaft') and the head (Polygon, part 'head'), or null when the step has none (an arrival, a step off
   * the track, a track too short). `before`/`after`: metres of route before and past the turn; `head`: the head's length;
   * `halfW`: half its width.
   */
  function arrow(t, step, { before = 45, after = 30, head = 14, halfW = 9 } = {}) {
    if (!t || !Array.isArray(t.lat) || !Array.isArray(t.dist) || t.dist.length < 2 || t.lat.length !== t.dist.length) return null;
    if (!step || !finite(step.m) || ARRIVE.has(step.type)) return null;
    const total = t.dist[t.dist.length - 1], tipM = Math.min(total, step.m + after), fromM = Math.max(0, step.m - before);
    if (step.m < 0 || step.m > total || tipM - fromM < head + 5) return null;
    const baseM = tipM - head;
    const shaft = slice(t, fromM, baseM), tip = pointAt(t, tipM), base = pointAt(t, baseM);
    if (shaft.length < 2 || !tip || !base) return null;
    // the head points from its base to the tip, as the route leaves the junction
    const o = [base.lon, base.lat], [tx, ty] = toXY(o, [tip.lon, tip.lat]), len = Math.hypot(tx, ty);
    if (len < 1) return null;
    const ux = tx / len, uy = ty / len, nx = -uy, ny = ux;
    const tipP = toLL(o, ux * head, uy * head);   // the full head length, straight on, so a bend past the turn can't squash it
    const head3 = [toLL(o, nx * halfW, ny * halfW), tipP, toLL(o, -nx * halfW, -ny * halfW)];
    return { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { part: 'shaft' }, geometry: { type: 'LineString', coordinates: shaft } },
      { type: 'Feature', properties: { part: 'head' }, geometry: { type: 'Polygon', coordinates: [[...head3, head3[0]]] } },
    ] };
  }

  const api = { arrow, pointAt, slice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTurnArrow = api;
})(typeof window !== 'undefined' ? window : globalThis);
