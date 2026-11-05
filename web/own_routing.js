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
  // our routes' lines, each to its route (a track built from the line finds its posted limits in the tiles: routeOfLine)
  const lines = new WeakMap();
  const own = (line, route) => { if (Array.isArray(line) && route && route.graph) lines.set(line, route); return line; };
  /** route.coords [[lon, lat]] from the worker's route.flat, built when first read (not as the message lands). */
  function withCoords(route) {
    if (!route) return route;
    if (Array.isArray(route.coords) || !route.flat) { own(route.coords, route); return route; }
    const flat = route.flat;
    let cache = null;
    Object.defineProperty(route, 'coords', { configurable: true, enumerable: true,
      get() { if (!cache) { cache = new Array(flat.length / 2); for (let k = 0; k < cache.length; k++) cache[k] = [flat[2 * k], flat[2 * k + 1]]; own(cache, route); } return cache; },
      set(v) { cache = v; own(v, route); } });
    return route;
  }
  /** The route of ours a line ([[lon, lat]], route.coords) is, or null (a line from Valhalla, a GPX file, a drive). */
  const routeOfLine = (line) => (line && typeof line === 'object' ? lines.get(line) || null : null);

  // ---- posted limits from our tiles (OWN_ROUTING.md §5) ----------------------------------------------------------------
  const RAD = Math.PI / 180, EARTH_M = 6371008.8, LIMIT_OFF_M = 30, LIMIT_LOOK = 60;
  const lineM = (la1, lo1, la2, lo2) => {                             // graph_router.js distM: how the router measured `end`
    const p = (la1 + la2) * 0.5 * RAD, x = (lo2 - lo1) * RAD * Math.cos(p), y = (la2 - la1) * RAD;
    return EARTH_M * Math.sqrt(x * x + y * y);
  };
  /**
   * The posted limit (m/s) at each sample of a track along one of our routes, from the tiles the route was planned on
   * (route.graph: graph_router.js edgeTable, each edge's posted limit and where it ends along the line), so the limit sign
   * and the ETA have limits offline and without Valhalla's map matching. null where the tiles have no posted limit for
   * the edge (an estimate from the road's class is not a posted limit) or the sample is off the line (over 30 m); the
   * whole answer null when the route carries no table. Samples are matched to the line in order, so a track with a spur
   * cut out (a loop) still finds its place.
   */
  function limitsAlong(lat, lon, route) {
    const g = route && route.graph, line = route && route.coords;
    if (!g || !g.limit || !g.end || !g.end.length || !Array.isArray(line) || line.length < 2 || !lat || !lat.length) return null;
    const n = line.length, cum = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n);
    const kx = 111320 * Math.cos(lat[0] * RAD), ky = 110540, lo0 = line[0][0], la0 = line[0][1];
    for (let k = 0; k < n; k++) {
      x[k] = (line[k][0] - lo0) * kx; y[k] = (line[k][1] - la0) * ky;
      if (k) cum[k] = cum[k - 1] + lineM(line[k - 1][1], line[k - 1][0], line[k][1], line[k][0]);
    }
    // the nearest point on segments [a, b) to (px, py): its distance into bestD, its segment and metres along the line
    let bestD = Infinity, bestK = 0, bestM = 0;
    const near = (px, py, a, b) => {
      bestD = Infinity;
      for (let k = a; k < b; k++) {
        const ax = x[k] - px, ay = y[k] - py, dx = x[k + 1] - x[k], dy = y[k + 1] - y[k], L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const ex = ax + t * dx, ey = ay + t * dy, d = ex * ex + ey * ey;
        if (d < bestD) { bestD = d; bestK = k; bestM = cum[k] + t * (cum[k + 1] - cum[k]); }
      }
      bestD = Math.sqrt(bestD);
    };
    const out = new Array(lat.length).fill(null);
    let seg = 0;
    for (let i = 0; i < lat.length; i++) {
      const px = (lon[i] - lo0) * kx, py = (lat[i] - la0) * ky;
      near(px, py, seg, Math.min(n - 1, seg + LIMIT_LOOK));
      if (bestD > LIMIT_OFF_M) {                                       // lost the line (a stretch cut out): the whole of it
        const d0 = bestD, k0 = bestK, m0 = bestM;
        near(px, py, 0, n - 1);
        if (bestD >= d0) { bestD = d0; bestK = k0; bestM = m0; }
      }
      if (bestD > LIMIT_OFF_M) continue;
      seg = bestK;
      let lo = 0, hi = g.end.length - 1;                             // the first edge ending at or past here
      while (lo < hi) { const mid = (lo + hi) >> 1; if (g.end[mid] < bestM - 0.01) lo = mid + 1; else hi = mid; }
      const v = g.limit[lo];
      out[i] = Number.isFinite(v) && v > 0 ? v / 3.6 : null;
    }
    return out;
  }
  /** Our routes as candidates, the router's best first (the route engine ranks them with everything else). */
  function candidates(result) {
    const n = (r) => (r.route.flat ? r.route.flat.length / 2 : Array.isArray(r.route.coords) ? r.route.coords.length : 0);
    return ((result && result.routes) || []).filter((r) => r && r.route && n(r) >= 2 && Number.isFinite(r.timeS))
      .map((r, i) => {
        const { coords, ...rest } = r.route;
        const route = withCoords({ ...rest, ...(Array.isArray(coords) ? { coords } : {}), names: r.route.names instanceof Map ? r.route.names : new Map(Object.entries(r.route.names || {})) });
        return { kind: 'own', own: r, ownRole: (r.why && r.why.role) || (i ? 'alternate' : 'best'), route, timeS: r.timeS, via: [] };
      });
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
  // Kept per 0.1° cell, so a plan needn't wait on the network for it: the server answers the ways whose box meets a cell,
  // and the same test splits an answer back into its cells. In memory and IndexedDB (vetta-crowd): a cell asked within
  // CROWD_TTL isn't asked again; one kept within CROWD_KEEP_MS is used at once (offline too) and asked again behind the
  // plan. Nothing new is asked: only the cells a plan crosses, as before (VI-1).
  const CROWD_TTL = 30 * 60e3, CROWD_KEEP_MS = 24 * 3600e3, cellMemo = new Map(), cellAsk = new Map();
  const boxOfCell = (key) => { const [i, j] = key.split('_').map(Number); return [i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL]; };   // s w n e
  let crowdDb = null;
  function cdb(mode, key, val) {
    try {
      if (!root.indexedDB) return Promise.resolve(null);
      if (!crowdDb) {
        crowdDb = new Promise((ok) => {
          try {
            const rq = root.indexedDB.open('vetta-crowd', 1);
            rq.onupgradeneeded = () => { try { rq.result.createObjectStore('cells'); } catch (_) {} };
            rq.onsuccess = () => ok(rq.result);
            rq.onerror = () => ok(null);
            rq.onblocked = () => ok(null);
          } catch (_) { ok(null); }
        });
      }
      return crowdDb.then((d) => (d ? new Promise((ok) => {
        try {
          const st = d.transaction('cells', mode).objectStore('cells'), rq = mode === 'readonly' ? st.get(key) : st.put(val, key);
          rq.onsuccess = () => ok(mode === 'readonly' ? rq.result || null : true);
          rq.onerror = () => ok(null);
        } catch (_) { ok(null); }
      }) : null));
    } catch (_) { return Promise.resolve(null); }
  }
  function rememberCells(cells, got, at = Date.now()) {
    const per = new Map(cells.map((c) => [c, { at, ways: {}, lines: {} }]));
    for (const [way, line] of Object.entries((got && got.lines) || {})) {
      if (!Array.isArray(line) || !got.ways || !got.ways[way]) continue;
      let s = 90, n = -90, w = 180, e = -180;
      for (const p of line) { if (!Array.isArray(p)) continue; s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
      for (const c of cells) { const b = boxOfCell(c); if (s <= b[2] && n >= b[0] && w <= b[3] && e >= b[1]) { per.get(c).ways[way] = got.ways[way]; per.get(c).lines[way] = line; } }
    }
    for (const [c, v] of per) { cellMemo.set(c, v); cdb('readwrite', c, v); }
  }
  const freshCell = (c, now = Date.now()) => { const m = cellMemo.get(c); return !!m && now - m.at < CROWD_TTL; };
  const keptCell = (c, now = Date.now()) => { const m = cellMemo.get(c); return !!m && now - m.at < CROWD_KEEP_MS; };
  /** The cells kept on the phone (IndexedDB) that memory hasn't, read in. */
  async function readKept(cells) {
    const now = Date.now(), want = cells.filter((c) => !keptCell(c, now));
    await Promise.all(want.map(async (c) => { const v = await cdb('readonly', c); if (v && v.ways && now - v.at < CROWD_KEEP_MS && !keptCell(c, now)) cellMemo.set(c, v); }));
  }
  function mergedCells(cells) {
    const ways = {}, lines = {}, now = Date.now();
    for (const c of cells) { const m = cellMemo.get(c); if (m && now - m.at < CROWD_KEEP_MS) { Object.assign(ways, m.ways); Object.assign(lines, m.lines); } }
    return { ways, lines };
  }
  /** Fetch the cells not asked within CROWD_TTL (or being asked); resolves true when every one of `cells` is fresh. */
  function fetchCells(lookupCells, cells, timeoutMs = CROWD_MS) {
    const now = Date.now(), need = cells.filter((c) => !freshCell(c, now) && !cellAsk.has(c));
    if (need.length) {
      let timer;
      const p = Promise.race([Promise.resolve().then(() => lookupCells(need)), new Promise((r) => { timer = setTimeout(() => r(null), timeoutMs); })])
        .then((got) => { if (got && got.ways && got.lines) rememberCells(need, got); }, () => {})
        .finally(() => { clearTimeout(timer); for (const c of need) cellAsk.delete(c); });
      for (const c of need) cellAsk.set(c, p);
    }
    const waits = [...new Set(cells.map((c) => cellAsk.get(c)).filter(Boolean))];
    return Promise.all(waits).then(() => cells.every((c) => freshCell(c)));
  }
  /**
   * Members' data for a plan without waiting on the network: { now, late }. `now` resolves with the cells asked within
   * CROWD_TTL when all of them are; else with what the network gives within budgetMs, or failing that the cells kept on
   * the phone (a day at most), or null. `late` resolves the fresh answer when `now` didn't have it and it differs (null
   * otherwise), so the planner can plan again with it after the card.
   */
  function crowdSoon(lookupCells, from, to, budgetMs = 250) {
    if (typeof lookupCells !== 'function') return { now: Promise.resolve(null), late: Promise.resolve(null) };
    const cells = cellsFor(from, to);
    let lateP = Promise.resolve(null);
    const now = (async () => {
      if (cells.every((c) => freshCell(c))) return crowdItems(mergedCells(cells));
      await readKept(cells);
      if (cells.every((c) => freshCell(c))) return crowdItems(mergedCells(cells));
      const before = JSON.stringify(mergedCells(cells));
      const all = fetchCells(lookupCells, cells).catch(() => false);
      let timer, inTime = false;
      await Promise.race([all.then(() => { inTime = true; }), new Promise((r) => { timer = setTimeout(r, budgetMs); })]);
      clearTimeout(timer);
      if (!inTime) lateP = all.then((ok) => { const m = mergedCells(cells); return ok && JSON.stringify(m) !== before ? crowdItems(m) : null; });
      return crowdItems(mergedCells(cells));
    })();
    return { now, late: now.then(() => lateP, () => null) };
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
  /**
   * Our quickest way through `points` ([from, ...via, to], as the planner hands Valhalla), as a route in routeOf's shape
   * (coords [[lon, lat]], turns, times, steps, names, timeS, source 'own'), or null where the tiles don't cover every
   * point, or on any failure (the caller then asks Valhalla). Works offline: the tiles are on the phone.
   */
  async function through(client, points, o = {}) {
    if (!client || typeof client.through !== 'function' || !Array.isArray(points) || points.length < 2) return null;
    try {
      if (!(await client.covers(points))) return null;
      const from = points[0], to = points[points.length - 1];
      const res = await client.through({ from, to, via: points.slice(1, -1).map((p) => ({ lat: p.lat, lon: p.lon })), level: o.level || 'quick', avoid: o.avoid, prefs: o.prefs, heading: from.heading });
      const c = res && res.route ? candidates({ routes: [res.route] })[0] : null;
      return c ? Object.assign(c.route, { timeS: c.timeS, own: c.own }) : null;
    } catch (_) { return null; }
  }
  /** Loops from our router, as routes in the shape the loop planner routes (coords [[lon, lat]], turns, times). */
  async function loops(client, req) {
    if (!client) return [];
    try {
      if (!(await client.covers([req.start]))) return [];
      const res = await client.loop(req);
      return ((res && res.routes) || []).map((r) => (r && r.route ? { ...r, route: withCoords(r.route) } : r)).filter((r) => r && r.route && r.route.coords && r.route.coords.length > 2);
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

  const api = { OFF_KEY, on, withCoords, routeOfLine, limitsAlong, candidates, plan, quick, through, loops, cellsFor, crowdItems, crowdFor, crowdSoon, _cells: cellMemo, sharedShare, oneClock, polyline6, thin, traceBody, instruct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexOwnRouting = api;
})(typeof window !== 'undefined' ? window : globalThis);
