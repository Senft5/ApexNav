// Along the way, live: on a planned route, the co-driver says the places the route card counted (scenic.js along, the
// route's t.scenic) when they come up. Two kinds of line:
// - the last fuel before a long stretch with none (80 km or more to the next pump or the end): "Last fuel for 52 miles,
//   in half a mile, on the right.", or "Last fuel of the route, …" when none follows. An electric car hears its chargers
//   ("Last charger for…"; t.scenic is already the car's own kind, scenic.js forCar). Once per stop, about 45 s out.
// - a viewpoint or a waterfall, by name when the map has a short one: "Wiseman's View on the left, in a quarter mile."
//   At most one every 5 minutes (a parkway has an overlook every mile), about 20 s out.
// Map data, labelled as such elsewhere: a station may be closed, so the fuel line says what the map has. Pure
// (tests/test_along_ahead.py).
(function (root) {
  'use strict';
  const FUEL_GAP_M = 80 * 1000, FUEL_LEAD_S = 45, VIEW_LEAD_S = 20, MIN_LEAD_M = 250, LATE_M = 120, VIEW_EVERY_S = 300;
  const SIDE_M = 25, NAME_MAX = 32;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  const far = (m, metric) => `${Math.round(m / (metric ? 1000 : 1609.344))} ${metric ? 'kilometres' : 'miles'}`;

  function idxAt(dist, m) {
    let lo = 0, hi = dist.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dist[mid] < m) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** 'left', 'right' or null (on the road, or no geometry): which side of track t place p ({ lat, lon, m }) lies on. */
  function side(t, p) {
    if (!t || !Array.isArray(t.lat) || t.lat.length < 2 || !finite(p.m) || !finite(p.lat) || !finite(p.lon)) return null;
    const i = idxAt(t.dist, p.m), a = Math.max(0, i - 4), b = Math.min(t.lat.length - 1, i + 4);
    if (a === b) return null;
    const c = Math.cos(t.lat[i] * Math.PI / 180);
    const hx = (t.lon[b] - t.lon[a]) * 111320 * c, hy = (t.lat[b] - t.lat[a]) * 110540;
    const dx = (p.lon - t.lon[i]) * 111320 * c, dy = (p.lat - t.lat[i]) * 110540;
    const h = Math.hypot(hx, hy), cross = (hx * dy - hy * dx) / (h || 1);
    if (!h || Math.abs(cross) < SIDE_M) return null;
    return cross > 0 ? 'left' : 'right';
  }

  /** The fuel (or charger) stops on list that are the last before 80 km or more with none: [{ ...p, gapM }]. */
  function lastStops(list, totalM, kind) {
    const stops = (Array.isArray(list) ? list : []).filter((p) => p && p.kind === kind && finite(p.m)).sort((a, b) => a.m - b.m);
    const out = [];
    stops.forEach((p, k) => {
      const nextM = k + 1 < stops.length ? stops[k + 1].m : totalM;
      if (finite(nextM) && nextM - p.m >= FUEL_GAP_M) out.push({ ...p, gapM: nextM - p.m });
    });
    return out;
  }

  /**
   * The line due now on track t ({ scenic, dist, lat, lon }) from the car at cursorM at vMps, or null: { key, text, view }.
   * said: a Set of keys already said; lastViewS: when a viewpoint was last said (seconds), nowS: now; electric: an EV;
   * spoken(m): a distance in the driver's units (units.js spokenShort); metric: kilometres, else miles.
   */
  function due(t, cursorM, vMps, o) {
    const d = t && t.dist;
    if (!Array.isArray(d) || d.length < 2 || !Array.isArray(t.scenic) || !finite(cursorM) || !finite(vMps) || vMps < 5) return null;
    const said = o.said || new Set(), say = (m) => String(o.spoken(m)).replace(/(\d)\.0\b/, '$1').replace(/^1 kilometres$/, 'a kilometre');
    const inReach = (p, leadS) => { const left = p.m - cursorM; return left >= LATE_M && left <= Math.max(MIN_LEAD_M, vMps * leadS); };
    const where = (p) => { const s = side(t, p), w = say(p.m - cursorM); return s ? `in ${w}, on the ${s}` : `in ${w}`; };
    const kind = o.electric ? 'charge' : 'fuel';
    for (const p of lastStops(t.scenic, d[d.length - 1], kind)) {
      const key = `${kind}:${Math.round(p.m)}`;
      if (said.has(key) || !inReach(p, FUEL_LEAD_S)) continue;
      const what = kind === 'charge' ? 'charger' : 'fuel', toEnd = p.m + p.gapM >= d[d.length - 1] - 1;
      return { key, view: false, text: `Last ${what} ${toEnd ? 'of the route' : `for ${far(p.gapM, o.metric)}`}, ${where(p)}.` };
    }
    if (finite(o.lastViewS) && finite(o.nowS) && o.nowS - o.lastViewS < VIEW_EVERY_S) return null;
    for (const p of t.scenic) {
      if (!p || (p.kind !== 'view' && p.kind !== 'falls') || !finite(p.m)) continue;
      const key = `${p.kind}:${Math.round(p.m)}`;
      if (said.has(key) || !inReach(p, VIEW_LEAD_S)) continue;
      const name = typeof p.name === 'string' && p.name.trim() && p.name.trim().length <= NAME_MAX ? p.name.trim() : null;
      const what = name || (p.kind === 'falls' ? 'A waterfall' : 'A viewpoint'), s = side(t, p), w = say(p.m - cursorM);
      // bare: the line without the name, which the voice packs can say from their clips (the name stays on the screen)
      const plain = p.kind === 'falls' ? 'A waterfall' : 'A viewpoint', line = (x) => (s ? `${x} on the ${s}, in ${w}.` : `${x} in ${w}.`);
      return { key, view: true, text: line(what), ...(name ? { bare: line(plain) } : {}) };
    }
    return null;
  }

  const api = { due, side, lastStops, FUEL_GAP_M, VIEW_EVERY_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAlongAhead = api;
})(typeof window !== 'undefined' ? window : globalThis);
