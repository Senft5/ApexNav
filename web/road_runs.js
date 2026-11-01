// The roads a drive was on, whole (the owner's TestFlight note 09: "select any full road you drive from start to finish as
// a stage, like Bank Road uphill"). The drive is matched to the road graph (contributor.js matchDrive, with the roads'
// names), then each road is one run from where you joined it to where you left it. A crossing or a short unnamed link
// (under GAP samples) doesn't split a road. The first and last km never leave the phone (privacy.html: map matching), so
// those stay unnamed. Pure parts tested (tests/test_road_runs.py); fetchNames is the network shell.
(function (root) {
  'use strict';
  const GAP = 12, MIN = 40, EDGE = 200, CLIMB_M = 15;    // 60 m, 200 m (a hand-marked stage's minimum), 1 km, metres
  const keyOf = (s) => String(s).trim().toLowerCase();

  /** Runs of one road name over per-sample names (null unknown): [{ name, a, b, length_m }], longest roads only (≥ MIN). */
  function runs(names) {
    const out = [];
    (names || []).forEach((name, i) => {
      if (!name) return;
      const L = out[out.length - 1], P = out[out.length - 2];
      if (L && keyOf(L.name) === keyOf(name) && i - L.b <= GAP + 1) { L.b = i; return; }
      // a short interlude on another name (a junction's other road) between two stretches of this one: one road
      if (L && P && keyOf(P.name) === keyOf(name) && i - P.b <= GAP + 1) { out.pop(); P.b = i; return; }
      out.push({ name, a: i, b: i });
    });
    return out.filter((r) => r.b - r.a >= MIN).map((r) => ({ ...r, length_m: (r.b - r.a) * 5 }));
  }

  /** Height gained over [a, b] (m), or null when the drive has no heights. */
  function climb(elev, a, b) {
    const z0 = elev && elev[a], z1 = elev && elev[b];
    return Number.isFinite(z0) && Number.isFinite(z1) ? z1 - z0 : null;
  }
  /** "Bank Road uphill" (15 m or more up), "… downhill", or just the name. */
  function label(run, elev) {
    const dz = climb(elev, run.a, run.b);
    return `${run.name}${dz != null && dz >= CLIMB_M ? ' uphill' : dz != null && dz <= -CLIMB_M ? ' downhill' : ''}`;
  }

  /** Per-sample road names for drive d ({ lat, lon }), with the first and last `edge` samples never sent. */
  async function fetchNames(d, matchDrive, fetchFn, edge = EDGE) {
    const n = d.lat.length, names = new Array(n).fill(null);
    if (n - 2 * edge < MIN) return names;
    const lat = d.lat.slice(edge, n - edge), lon = d.lon.slice(edge, n - edge);
    const match = await matchDrive({ lat, lon }, fetchFn);
    match.forEach((m, k) => { if (m && m.name) names[edge + k] = m.name; });
    return names;
  }

  const api = { runs, climb, label, fetchNames, GAP, MIN, EDGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadRuns = api;
})(typeof window !== 'undefined' ? window : globalThis);
