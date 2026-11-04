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
      const res = await client.plan(req);
      const cands = candidates(res);
      return { cands, reason: cands.length ? 'ok' : 'failed', covered: true, ms: Date.now() - t0, result: res };
    } catch (err) {
      return { cands: [], reason: 'failed', error: String((err && err.message) || err), covered: true, ms: Date.now() - t0 };
    }
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

  const api = { OFF_KEY, on, candidates, plan, loops, polyline6, thin, traceBody, instruct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexOwnRouting = api;
})(typeof window !== 'undefined' ? window : globalThis);
