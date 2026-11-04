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
    if (finite(totalM) && gap.m >= FUEL_WARN_M) {
      const U = root.ApexUnits, k = U && U.metric() ? 1000 : MI, u = U && U.metric() ? 'km' : 'mi';   // units.js, U-22
      const n = (m) => Math.round(m / k), atStart = gap.fromM < 500, atEnd = totalM - gap.toM < 500;
      parts.push(atStart && atEnd ? 'no fuel on the way' : atStart ? `no fuel for the first ${n(gap.m)} ${u}`
        : atEnd ? `no fuel for the last ${n(gap.m)} ${u}` : `no fuel from ${u} ${n(gap.fromM)} to ${n(gap.toM)}`);
    }
    const line = parts.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  /**
   * Which pins the map shows so none overlap (the owner, 2026-11-04: "a pile of overlapping FUEL labels"). `pins` =
   * [{ kind, named, m, x, y, w, h }]: the pin's centre and size on screen, `m` its place along the route; `view` = { w, h }.
   * The most useful first: named viewpoints, other viewpoints, cafés, fuel; within a kind, spread along the route (the
   * first, then each time the one farthest from those already kept). A pin that would touch one already shown is hidden
   * (PAD px apart, PAD_SAME between two of a kind), and at most KEEP of a kind are shown on screen at once. Pins off the
   * screen don't count and stay as they are. Returns a boolean per pin, true = shown.
   */
  const KIND_RANK = { view: 0, cafe: 1, fuel: 2 }, KEEP = { view: 6, cafe: 4, fuel: 4 }, PAD = 4, PAD_SAME = 24;
  function declutter(pins, view = null) {
    const list = pins || [], show = list.map(() => true);
    const on = list.map((p, i) => i).filter((i) => {
      const p = list[i];
      if (!p || !finite(p.x) || !finite(p.y)) return false;
      return !view || (p.x >= 0 && p.y >= 0 && p.x <= view.w && p.y <= view.h);
    });
    const order = [];
    for (const kind of Object.keys(KIND_RANK).sort((a, b) => KIND_RANK[a] - KIND_RANK[b])) {
      for (const named of kind === 'view' ? [true, false] : [null]) {
        const left = on.filter((i) => list[i].kind === kind && (named == null || !!list[i].named === named)).sort((a, b) => (list[a].m || 0) - (list[b].m || 0));
        const kept = [];
        while (left.length) {
          let k = 0;
          if (kept.length) {
            let far = -1;
            left.forEach((i, j) => { const d = Math.min(...kept.map((m) => Math.abs((list[i].m || 0) - m))); if (d > far) { far = d; k = j; } });
          }
          const [i] = left.splice(k, 1);
          kept.push(list[i].m || 0); order.push(i);
        }
      }
    }
    for (const i of on) if (!(list[i].kind in KIND_RANK)) order.push(i);   // another kind: last, still kept off the others
    const placed = [], count = {};
    for (const i of order) {
      const p = list[i], w = finite(p.w) ? p.w : 40, h = finite(p.h) ? p.h : 16;
      const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - h / 2, y1: p.y + h / 2, kind: p.kind };
      const hit = placed.some((b) => { const g = b.kind === box.kind ? PAD_SAME : PAD; return box.x0 < b.x1 + g && b.x0 < box.x1 + g && box.y0 < b.y1 + g && b.y0 < box.y1 + g; });
      if (hit || (count[p.kind] || 0) >= (KEEP[p.kind] || Infinity)) { show[i] = false; continue; }
      placed.push(box); count[p.kind] = (count[p.kind] || 0) + 1;
    }
    return show;
  }

  const api = { along, fuelGap, summary, declutter, NEAR_M, FUEL_WARN_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexScenic = api;
})(typeof window !== 'undefined' ? window : globalThis);
