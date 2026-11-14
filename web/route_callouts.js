// The routes' time callouts on the map (as Apple and Google Maps label each route they offer): a small tag on every route
// the plan found, at the stretch where it runs apart from the others, with its time and its corners. The picked route's
// tag is filled; a tap on another's takes it, as a tap on its faint line does (cockpit.js paintCallouts).
// Pure (tests/test_route_callouts.py): coordinates in, a spot per route out. A route that never leaves the others gets no
// tag, since its tag would sit on theirs.
(function (root) {
  'use strict';
  const R = 6371008.8, RAD = Math.PI / 180;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const okPt = (p) => Array.isArray(p) && finite(p[0]) && finite(p[1]);

  /** Metres between two [lon, lat] points (flat-earth: routes are a few km apart at most). */
  function metres(a, b) {
    const k = Math.cos(((a[1] + b[1]) / 2) * RAD);
    return Math.hypot((b[0] - a[0]) * RAD * k, (b[1] - a[1]) * RAD) * R;
  }
  /** At most `n` points of a line, evenly by index, the last one kept. */
  function thin(line, n) {
    if (line.length <= n) return line;
    const out = [], step = (line.length - 1) / (n - 1);
    for (let i = 0; i < n; i++) out.push(line[Math.round(i * step)]);
    return out;
  }

  /**
   * One spot per route: [lon, lat] on that route, in its middle part (20-80 % of its length), as far from every other route
   * as it gets; null for a route that stays within `apartM` metres of another all along (or a line too short to place).
   * `routes`: arrays of [lon, lat].
   */
  function anchors(routes, apartM = 40) {
    const lines = (Array.isArray(routes) ? routes : []).map((r) => (Array.isArray(r) ? r.filter(okPt) : []));
    const others = lines.map((l) => thin(l, 300));
    return lines.map((line, i) => {
      if (line.length < 2) return null;
      const cum = [0];
      for (let j = 1; j < line.length; j++) cum.push(cum[j - 1] + metres(line[j - 1], line[j]));
      const total = cum[cum.length - 1];
      if (!(total > 0)) return null;
      const rest = others.filter((_, k) => k !== i && others[k].length);
      let best = null, bestD = -1, bestMid = Infinity;
      const N = 41;
      for (let s = 0; s < N; s++) {
        const f = 0.2 + (0.6 * s) / (N - 1), want = f * total;
        let j = 0;
        while (j < cum.length - 1 && cum[j] < want) j++;
        const p = line[j];
        let d = Infinity;
        for (const o of rest) for (const q of o) { const m = metres(p, q); if (m < d) d = m; }
        const mid = Math.abs(f - 0.5);
        if (d > bestD + 1 || (Math.abs(d - bestD) <= 1 && mid < bestMid)) { best = p; bestD = d; bestMid = mid; }
      }
      return rest.length && bestD < apartM ? null : best && [best[0], best[1]];
    });
  }

  /** "7 min" or "1:05 h"; null when unknown. */
  function time(s) {
    if (!finite(s) || s < 0) return null;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
  }
  /** "5 corners", "1 corner"; null when unknown. */
  const corners = (n) => (finite(n) && n >= 0 ? `${n} corner${n === 1 ? '' : 's'}` : null);

  /**
   * The tags to draw: { i, lon, lat, time, corners, on, label } per route that gets one. `list`: the plan's routes
   * ({ route: { coords }, timeS, corners }), `picked`: the index on the card. Unknown numbers stay '--'.
   */
  function tags(list, picked) {
    if (!Array.isArray(list) || list.length < 2) return [];
    const spots = anchors(list.map((c) => (c && c.route && c.route.coords) || []));
    const out = [];
    list.forEach((c, i) => {
      const at = spots[i];
      if (!at) return;
      const t = time(c && c.timeS) || '--', n = corners(c && c.corners) || '--';
      out.push({ i, lon: at[0], lat: at[1], time: t, corners: n, on: i === picked,
        label: `${i === picked ? 'This route' : 'Take this route'}: ${t === '--' ? 'time unknown' : t}, ${n === '--' ? 'corners unknown' : n}` });
    });
    return out;
  }

  const api = { anchors, tags, time, corners, metres };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCallouts = api;
})(typeof window !== 'undefined' ? window : globalThis);
