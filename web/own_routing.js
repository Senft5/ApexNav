// The planner's side of our own routing (docs/OWN_ROUTING.md §5): whether it's on, our routes as the route engine's
// candidates, and their turn instructions. cockpit.js funRoute and buildLoop call these; web/graph_router.js finds the
// routes (in web/graph_worker.js).
//   on        the `own_routing` server flag (backend/src/flags.ts) and the phone's own switch (localStorage
//             apex.ownRouting = "0" turns it off); only where the shipped tiles cover the trip does it do anything
//   plan      covers? then our routes, as candidates { kind: 'own', own, route, timeS, via: [] }; any failure or no tiles:
//             { cands: [], reason }, and the planner takes today's Valhalla path unchanged
//   instruct  online, Valhalla trace_route on our line gives the chosen route's maneuvers (spoken directions, lanes,
//             exit signs); offline, the router's own maneuvers from name changes and turn angles stay
(function (root) {
  'use strict';
  const OFF_KEY = 'apex.ownRouting';
  function on(o = {}) {
    const flags = o.flags || root.ApexFlags, store = o.storage || (() => { try { return root.localStorage; } catch (_) { return null; } })();
    try { if (store && store.getItem(OFF_KEY) === '0') return false; } catch (_) { /* storage off: the flag decides */ }
    if (!(o.router || root.ApexGraphRouter)) return false;
    return !flags || typeof flags.on !== 'function' ? true : flags.on('own_routing', true);
  }
  /** Our routes as candidates, the router's best first (the route engine ranks them with everything else). */
  function candidates(result) {
    return ((result && result.routes) || []).filter((r) => r && r.route && Array.isArray(r.route.coords) && r.route.coords.length >= 2 && Number.isFinite(r.timeS))
      .map((r, i) => ({ kind: 'own', own: r, ownRole: (r.why && r.why.role) || (i ? 'alternate' : 'best'), route: { ...r.route, names: r.route.names instanceof Map ? r.route.names : new Map(Object.entries(r.route.names || {})) }, timeS: r.timeS, via: [] }));
  }
  // ---- members' data for the search ------------------------------------------------------------------------------------
  const CELL = 0.1, MAX_CELLS = 16, LOVE_LEVEL = [NaN, 0.4, 0.7, 1.0], CROWD_MS = 1500;
  const AGREE = { cam: 1.5, rough: 0.05 };                             // as crowd.js / contributor.js: disputed bins are unknown
  /** The 0.1° cells ("i_j", crowd.js's keys) round a trip, nearest its middle first, at most MAX_CELLS (VI-1). */
  function cellsFor(from, to) {
    const pad = 0.05, s = Math.min(from.lat, to.lat) - pad, n = Math.max(from.lat, to.lat) + pad, w = Math.min(from.lon, to.lon) - pad, e = Math.max(from.lon, to.lon) + pad;
    const mid = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 }, out = [];
    for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i++) for (let j = Math.floor(w / CELL); j <= Math.floor(e / CELL); j++) {
      const la = (i + 0.5) * CELL, lo = (j + 0.5) * CELL, d = Math.hypot(la - mid.lat, (lo - mid.lon) * Math.cos(mid.lat * Math.PI / 180));
      out.push([d, `${i}_${j}`]);
    }
    return out.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).slice(0, MAX_CELLS).map((x) => x[1]);
  }
  const flowConf = (fl, hb, fn) => {                                   // crowd.js flowConfidence
    if (!(fn >= 1) || !Number.isFinite(fl)) return NaN;
    const base = fl * (1 - (Number.isFinite(hb) ? hb : 0));
    return 0.5 + (base - 0.5) * Math.min(1, fn / 3);
  };
  /** The /api/roads answer ({ ways, lines }) as the router's items: one per way and direction with members' bins. */
  function crowdItems(got) {
    if (!got || !got.ways || !got.lines) return null;
    const out = [];
    for (const [way, dirs] of Object.entries(got.ways)) {
      const line = got.lines[way];
      if (!Array.isArray(line) || line.length < 2) continue;
      for (const dir of [0, 1]) {
        const d = dirs && dirs[dir];
        if (!d || !Array.isArray(d.i)) continue;
        const at = (a, j) => (a && a[j] != null ? a[j] : NaN), n = (j) => (d.n ? d.n[j] : 1);
        const rough = d.i.map((_, j) => (n(j) >= 2 && at(d.rsd, j) > AGREE.rough ? NaN : at(d.rough, j)));
        const cam = d.i.map((_, j) => ((d.cn ? at(d.cn, j) : n(j)) >= 2 && at(d.csd, j) > AGREE.cam ? NaN : at(d.cam, j)));
        const flow = d.i.map((_, j) => flowConf(at(d.fl, j), at(d.hb, j), at(d.fn, j)));
        out.push({ line, dir, i: d.i, rough, cam, flow, loved: Number.isFinite(d.ag) ? LOVE_LEVEL[d.ag] || NaN : NaN });
      }
    }
    return out.length ? out : null;
  }
  /** Members' data round a trip for the search, or null (signed out, offline, nothing measured, slower than CROWD_MS). */
  async function crowdFor(lookupCells, from, to, timeoutMs = CROWD_MS) {
    if (typeof lookupCells !== 'function') return null;
    let timer;
    try {
      const got = await Promise.race([lookupCells(cellsFor(from, to)), new Promise((r) => { timer = setTimeout(() => r(null), timeoutMs); })]);
      return crowdItems(got);
    } catch (_) { return null; } finally { clearTimeout(timer); }
  }

  /**
   * Our candidates for a trip, or none with the reason (out: no tiles here; off; failed: the router's error). client:
   * ApexGraphRouter.client(); req: { from, to, level, prefs, taste, avoid, heading }.
   */
  async function plan(client, req, o = {}) {
    const t0 = Date.now();
    if (!client) return { cands: [], reason: 'off', ms: 0 };
    let covered = false;
    try { covered = await client.covers([req.from, req.to]); } catch (_) { covered = false; }
    if (!covered) return { cands: [], reason: 'out', covered: false, ms: Date.now() - t0 };
    try {
      // members' data (a promise, fetched alongside the coverage check), into the search itself
      const crowd = req.crowd && typeof req.crowd.then === 'function' ? await req.crowd.catch(() => null) : req.crowd || null;
      const res = await client.plan({ ...req, crowd });
      const cands = candidates(res);
      return { cands, reason: cands.length ? 'ok' : 'failed', covered: true, ms: Date.now() - t0, result: res };
    } catch (err) {
      return { cands: [], reason: 'failed', error: String((err && err.message) || err), covered: true, ms: Date.now() - t0 };
    }
  }
  /** Our quickest alone (one search in the worker), as a candidate for the first route on screen; null on any failure. */
  async function quick(client, req) {
    if (!client || typeof client.quick !== 'function') return null;
    try {
      const res = await client.quick(req);
      const c = res && res.route ? candidates({ routes: [res.route] })[0] : null;
      if (c) { c.ownRole = 'quickest'; c.ownMs = res.ms; c.ownLoadMs = res.loadMs; }
      return c || null;
    } catch (_) { return null; }
  }
  /** Loops from our router, as routes in the shape the loop planner routes (coords [[lon, lat]], turns, times). */
  async function loops(client, req) {
    if (!client) return [];
    try {
      if (!(await client.covers([req.start]))) return [];
      const res = await client.loop(req);
      return ((res && res.routes) || []).filter((r) => r && r.route && r.route.coords && r.route.coords.length > 2);
    } catch (_) { return []; }
  }

  // ---- one clock --------------------------------------------------------------------------------------------------------
  /** Share of line a ([[lon, lat]]) within `tolM` of line b, sampled every ~40 m. */
  function sharedShare(a, b, tolM = 25) {
    if (!a || !b || a.length < 2 || b.length < 2) return 0;
    const G = 0.0005, grid = new Map(), key = (la, lo) => `${Math.floor(la / G)}_${Math.floor(lo / G)}`;
    for (let k = 0; k + 1 < b.length; k++) {                          // b's segments, densified to ~10 m points in the grid
      const [lo0, la0] = b[k], [lo1, la1] = b[k + 1], n = Math.max(1, Math.ceil(Math.hypot((la1 - la0) * 110540, (lo1 - lo0) * 85000) / 10));
      for (let s = 0; s <= n; s++) { const la = la0 + (la1 - la0) * s / n, lo = lo0 + (lo1 - lo0) * s / n, kk = key(la, lo); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([la, lo]); }
    }
    let hit = 0, all = 0, acc = 40;
    for (let k = 1; k < a.length; k++) {
      acc += Math.hypot((a[k][1] - a[k - 1][1]) * 110540, (a[k][0] - a[k - 1][0]) * 85000);
      if (acc < 40) continue;
      acc = 0; all++;
      const [lo, la] = a[k], i = Math.floor(la / G), j = Math.floor(lo / G);
      let near = false;
      for (let di = -1; di <= 1 && !near; di++) for (let dj = -1; dj <= 1 && !near; dj++) for (const p of grid.get(`${i + di}_${j + dj}`) || []) if (Math.hypot((p[0] - la) * 110540, (p[1] - lo) * 85000) <= tolM) { near = true; break; }
      if (near) hit++;
    }
    return all ? hit / all : 0;
  }
  /**
   * One clock for the pool: the ranking compares times, and Valhalla's and ours are different models of the same drive
   * (live, 2026-11-04: our clock ran 12 % slower than Valhalla's on the same roads, so at Quick our copy of the router's own
   * route lost to it by the minute it didn't really take). Where our quickest and Valhalla's are the same way (80 % of
   * it within 25 m), every one of our candidates is put on Valhalla's clock (the ratio, kept within 0.75..1.33).
   * Returns the ratio applied, or null.
   */
  function oneClock(cands, vRoutes) {
    const quick = (cands || []).find((c) => c.ownRole === 'quickest') || null;
    const list = (Array.isArray(vRoutes) ? vRoutes : [vRoutes]).filter((r) => r && Number.isFinite(r.timeS) && Array.isArray(r.coords));
    if (!quick || !(quick.timeS > 0)) return null;
    // the Valhalla route that is the same way as our quickest (its default or its highway-friendly costing)
    const vRoute = list.find((r) => sharedShare(r.coords, quick.route.coords) >= 0.8 && sharedShare(quick.route.coords, r.coords) >= 0.8);
    if (!vRoute) return null;
    const k = Math.min(1.33, Math.max(0.75, vRoute.timeS / quick.timeS));
    for (const c of cands) {
      c.timeS *= k; c.route.timeS = c.timeS;
      if (Array.isArray(c.route.times)) c.route.times = c.route.times.map(([lo, la, s]) => [lo, la, Math.round(s * k)]);
      if (c.own) c.own.clock = k;
    }
    return k;
  }

  // ---- instructions ---------------------------------------------------------------------------------------------------
  /** Google polyline, precision 6 (Valhalla's encoded_polyline), of [[lon, lat]]. */
  function polyline6(coords) {
    let out = '', pl = 0, po = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let r = ''; while (v >= 0x20) { r += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return r + String.fromCharCode(v + 63); };
    for (const [lon, lat] of coords) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); out += enc(la - pl) + enc(lo - po); pl = la; po = lo; }
    return out;
  }
  /** Our line thinned to at most `max` points (every corner kept first: points where the heading turns) for trace_route. */
  function thin(coords, max = 3000) {
    if (coords.length <= max) return coords;
    const step = coords.length / max, out = [];
    for (let k = 0; k < max - 1; k++) out.push(coords[Math.floor(k * step)]);
    out.push(coords[coords.length - 1]);
    return out;
  }
  /** The trace_route request for our line: map-matched to Valhalla's own graph, the app's costing. */
  function traceBody(route, costing) {
    return { encoded_polyline: polyline6(thin(route.coords)), shape_match: 'map_snap', ...(costing || { costing: 'auto' }), turn_lanes: true };
  }
  /**
   * Valhalla's maneuvers onto our route (its steps, junction turns and clock), our line and time kept. `trace(body)`
   * resolves Valhalla's JSON; `parse(trip)` is cockpit.js routeOf. Offline or any failure: ours stay. Resolves where they
   * came from: 'valhalla' or 'own'.
   */
  async function instruct(route, trace, parse, costing, timeoutMs = 3000) {
    if (!route || route.instructions === 'valhalla') return route ? route.instructions : 'own';
    let timer;
    try {
      const json = await Promise.race([trace(traceBody(route, costing)), new Promise((r) => { timer = setTimeout(() => r(null), timeoutMs); })]);
      const r = json && json.trip ? parse(json.trip) : null;
      if (r && Array.isArray(r.steps) && r.steps.length) {
        route.steps = r.steps; route.turns = r.turns || route.turns; route.times = r.times && r.times.length ? r.times : route.times;
        route.instructions = 'valhalla';
        return 'valhalla';
      }
    } catch (_) { /* offline: our own maneuvers */ } finally { clearTimeout(timer); }
    route.instructions = 'own';
    return 'own';
  }

  const api = { OFF_KEY, on, candidates, plan, quick, loops, cellsFor, crowdItems, crowdFor, sharedShare, oneClock, polyline6, thin, traceBody, instruct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexOwnRouting = api;
})(typeof window !== 'undefined' ? window : globalThis);
