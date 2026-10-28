// Along the route (IDEAS R-24, R-23): viewpoints, cafés and fuel from the map's own OpenStreetMap points (stages.js pois),
// placed along a planned route, and the longest stretch with no fuel. Map data, labelled as such: a viewpoint is where
// someone mapped one, a fuel station may be closed. Pure (tests/test_scenic.py); the page pins them and says the summary.
(function (root) {
  'use strict';
  const NEAR_M = { view: 350, cafe: 200, fuel: 200 };     // how far off the road still counts as "along" it
  const SAME_M = 300;                                       // the same kind within this along the road is one stop
  const FUEL_WARN_M = 80 * 1000;                            // ~50 mi without fuel is worth saying
  const MI = 1609.344;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * The points along `track` ({lat[], lon[], dist[]}): [{ kind, name, lat, lon, m, offM }] in road order, each within
   * NEAR_M of the road, one per kind per SAME_M (a named one kept over an unnamed one).
   */
  function along(pois, track) {
    const n = track && Array.isArray(track.lat) ? track.lat.length : 0;
    if (n < 2) return [];
    const step = Math.max(1, Math.floor(n / 4000)), c = Math.cos(track.lat[0] * Math.PI / 180);
    const found = [];
    for (const p of pois || []) {
      const lim = NEAR_M[p.kind];
      if (!lim || !finite(p.lat) || !finite(p.lon)) continue;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < n; i += step) {
        const d = Math.hypot((track.lon[i] - p.lon) * 111320 * c, (track.lat[i] - p.lat) * 110540);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD <= lim) found.push({ kind: p.kind, name: p.name || null, lat: p.lat, lon: p.lon, m: track.dist[best], offM: Math.round(bestD) });
    }
    found.sort((a, b) => a.m - b.m);
    const out = [];
    for (const f of found) {
      const twin = out.find((o) => o.kind === f.kind && Math.abs(o.m - f.m) < SAME_M);
      if (!twin) out.push(f);
      else if (!twin.name && f.name) Object.assign(twin, f);
    }
    return out;
  }

  /** The longest stretch of the route with no fuel along it: { m, fromM, toM }. The start and the end count as ends. */
  function fuelGap(list, totalM) {
    const stops = [0, ...(list || []).filter((p) => p.kind === 'fuel').map((p) => p.m), totalM].sort((a, b) => a - b);
    let gap = { m: 0, fromM: 0, toM: 0 };
    for (let i = 1; i < stops.length; i++) if (stops[i] - stops[i - 1] > gap.m) gap = { m: stops[i] - stops[i - 1], fromM: stops[i - 1], toM: stops[i] };
    return gap;
  }

  /** One line for the route card: "3 viewpoints · 2 cafés", and a fuel warning when a stretch is long; '' with nothing to say. */
  function summary(list, totalM) {
    const count = (k) => (list || []).filter((p) => p.kind === k).length;
    const parts = [];
    const v = count('view'), cf = count('cafe');
    if (v) parts.push(`${v} viewpoint${v === 1 ? '' : 's'}`);
    if (cf) parts.push(`${cf} café${cf === 1 ? '' : 's'}`);
    const gap = fuelGap(list, totalM);
    if (finite(totalM) && gap.m >= FUEL_WARN_M) parts.push(`no fuel for ${Math.round(gap.m / MI)} mi (mi ${Math.round(gap.fromM / MI)}–${Math.round(gap.toM / MI)})`);
    return parts.join(' · ');
  }

  const api = { along, fuelGap, summary, NEAR_M, FUEL_WARN_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexScenic = api;
})(typeof window !== 'undefined' ? window : globalThis);
