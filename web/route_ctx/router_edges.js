// Route context provider: the router's own edge attributes (Valhalla trace_attributes), docs/ROUTE_ENGINE.md.
// One request per candidate (its exact route line, `walk_or_snap`: an exact edge walk, so every edge is the one the router
// chose, falling back to map matching on the server where the walk fails: a line routed through shaping points, a stage
// plan, turns back on itself at each point and an exact walk answers 400, error 443), attributes filtered to what the
// model reads, six candidates at a time, each answer kept 30 minutes per candidate. At the deadline the candidates that
// have answered are returned and the rest are 'unavailable' (out of time). The router down or slow: 'unavailable', and the
// model ranks as if this source didn't exist.
//
// Channels (per 25 m sample; NaN = unknown, never 0 for unknown):
//   speed_limit_kph      km/h   posted limit (OSM maxspeed as the router has it)
//   speed_limit_est_kph  km/h   class-typical estimate, ONLY where no limit is posted (flagged: weighs less, never shown as posted)
//   speed_kph            km/h   the router's typical speed on the edge
//   road_class           code   0 motorway, 1 trunk, 2 primary, 3 secondary, 4 tertiary, 5 unclassified, 6 residential, 7 service
//   road_use             code   ROAD_USE below (0 road, 1 ramp, 4 driveway, 6 parking aisle, 10 living street, 11 service road …)
//   density              0–15   the router's urban density (0 open country … 15 city centre)
//   lanes                count  lanes in the direction of travel
//   surface              code   0 paved smooth, 1 paved, 2 paved rough, 3 compacted, 4 dirt, 5 gravel, 6 path, 7 impassable
//   sidewalk             0/1    a sidewalk on either side (a built-up street)
//   truck_route          0/1    hgv route
//   bridge, tunnel, toll, ramp, roundabout   0/1
//   signals_per_km       /km    traffic signals within ±500 m
//   access_per_km        /km    driveable side roads and driveways meeting the route within ±500 m (access density)
//   intersections_per_km /km    junctions with another driveable road within ±500 m
// Points: { kind: 'signal' } at each signal, { kind: 'junction', value: side roads } at each junction, { kind: 'driveway' }.
// Spans: bridge, tunnel, toll, roundabout, unpaved; each { fromM, toM, kind }.
// Source: OpenStreetMap via the FOSSGIS Valhalla server (ODbL, © OpenStreetMap contributors; attribution in About > Sources).
// Update cadence: the server's OSM extract (about weekly). Stop signs are not in the router's data (map features provider).
(function (root) {
  'use strict';
  // the registry itself (a provider shim, ctx_util.js / osm_common.js, has only register): in node, require it
  const Ctx = root.ApexRouteCtx && root.ApexRouteCtx.corridor ? root.ApexRouteCtx : typeof require === 'function' ? require('./registry.js') : root.ApexRouteCtx || null;
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const ATTRS = ['edge.speed_limit', 'edge.speed', 'edge.road_class', 'edge.use', 'edge.density', 'edge.lane_count', 'edge.surface', 'edge.unpaved',
    'edge.bridge', 'edge.tunnel', 'edge.toll', 'edge.traffic_signal', 'edge.length', 'edge.roundabout', 'edge.truck_route', 'edge.sidewalk',
    'edge.way_id', 'edge.names', 'node.traffic_signal', 'node.type', 'node.intersecting_edge.use', 'node.intersecting_edge.driveability', 'node.intersecting_edge.road_class'];
  const ROAD_CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, service_other: 7 };
  const ROAD_USE = { road: 0, ramp: 1, turn_channel: 2, track: 3, driveway: 4, alley: 5, parking_aisle: 6, emergency_access: 7, drive_through: 8,
    culdesac: 9, living_street: 10, service_road: 11, cycleway: 20, mountain_bike: 21, footway: 25, steps: 26, path: 27, pedestrian: 28, ferry: 41 };
  const SURFACE = { paved_smooth: 0, paved: 1, paved_rough: 2, compacted: 3, dirt: 4, gravel: 5, path: 6, impassable: 7 };
  const MAX_KM = 200;            // the public server's trace limit
  const RELAY = '/api/ctx/trace', RELAY_POINTS = 600;   // a stage's line through our Worker: at most 600 points (the relay takes 700)
  const TTL_MS = 30 * 60000;
  const kept = Ctx && Ctx.cache ? Ctx.cache(TTL_MS, 60) : null;

  /** Class-typical limit (km/h) where none is posted: US rural/urban practice by class and the router's density. */
  function estimateLimit(rc, use, density) {
    if (use === ROAD_USE.ramp) return 72;
    if (use === ROAD_USE.living_street) return 16;
    if (use === ROAD_USE.parking_aisle || use === ROAD_USE.driveway || use === ROAD_USE.drive_through || use === ROAD_USE.alley) return 16;
    if (use === ROAD_USE.service_road || rc === 7) return 24;
    const urban = Number.isFinite(density) && density >= 6;
    if (rc === 6 && Number.isFinite(density) && density <= 2) return 56;   // a "residential" county road in open country (TIGER)
    const table = { 0: [105, 89], 1: [89, 72], 2: [89, 72], 3: [80, 64], 4: [72, 56], 5: [64, 48], 6: [40, 40] };   // [rural, urban]
    const row = table[rc];
    return row ? row[urban ? 1 : 0] : null;
  }

  // ---- polyline6 (what the router speaks) ----------------------------------------------------------------------
  function encode6(coords) {
    let out = '', plat = 0, plon = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [lon, lat] of coords) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); out += enc(la - plat) + enc(lo - plon); plat = la; plon = lo; }
    return out;
  }
  /** The request body for one route line ([[lon, lat]]). */
  function request(coords, match = 'edge_walk') {
    return { encoded_polyline: encode6(coords), costing: 'auto', shape_match: match, filters: { action: 'include', attributes: ATTRS } };
  }

  // ---- parsing (pure; tests/test_route_ctx_router_edges.py on real responses) -------------------------------
  const flag = (v) => (v === true ? 1 : v === false ? 0 : NaN);
  /**
   * A trace_attributes answer as compact edge spans along the route, in order: { fromM, toM, sl (posted km/h or null), est
   * (estimate or null), speed, rc, use, density, lanes, surface, sidewalk, truck, bridge, tunnel, toll, ramp, roundabout,
   * unpaved, signal (a signal at its end or on it), side (driveable roads meeting at its end), drive (driveways/service there) }.
   * Edge lengths are the lengths driven (the first and last edges partly), so their running sum is the distance along.
   */
  function parse(json) {
    const edges = json && Array.isArray(json.edges) ? json.edges : null;
    if (!edges || !edges.length) return null;
    const unit = json.units === 'miles' ? 1609.344 : 1000;
    let m = 0;
    return edges.map((e) => {
      const len = Number.isFinite(e.length) ? e.length * unit : 0;
      const rc = ROAD_CLASS[e.road_class], use = ROAD_USE[e.use];
      const sl = Number.isFinite(e.speed_limit) && e.speed_limit > 0 && e.speed_limit < 200 ? e.speed_limit : null;
      const node = e.end_node || {};
      let side = 0, drive = 0;
      for (const x of node.intersecting_edges || []) {
        if (!x || !x.driveability || x.driveability === 'none') continue;          // a footway or a one-way you can't turn into
        if (x.use === 'driveway' || x.use === 'parking_aisle' || x.use === 'drive_through' || x.use === 'service_road' || x.use === 'alley') drive++;
        else if (x.use === 'road' || x.use === 'living_street' || x.use === 'culdesac' || x.use === undefined) side++;
      }
      const out = { fromM: m, toM: m + len, sl, est: sl == null && rc != null ? estimateLimit(rc, use, e.density) : null,
        speed: Number.isFinite(e.speed) ? e.speed : null, rc: rc == null ? null : rc, use: use == null ? null : use,
        density: Number.isFinite(e.density) ? e.density : null, lanes: Number.isFinite(e.lane_count) && e.lane_count > 0 ? e.lane_count : null,
        surface: SURFACE[e.surface] == null ? null : SURFACE[e.surface], sidewalk: e.sidewalk === undefined ? null : e.sidewalk && e.sidewalk !== 'none' ? 1 : 0,
        truck: e.truck_route === undefined ? null : e.truck_route ? 1 : 0,
        bridge: e.bridge ? 1 : 0, tunnel: e.tunnel ? 1 : 0, toll: e.toll ? 1 : 0, ramp: use === ROAD_USE.ramp ? 1 : 0, roundabout: e.roundabout ? 1 : 0,
        unpaved: e.unpaved ? 1 : 0, signal: node.traffic_signal === true || e.traffic_signal === true ? 1 : 0,
        junction: node.type === 'street_intersection' || side > 0 ? 1 : 0, side, drive,
        way: Number.isSafeInteger(e.way_id) ? e.way_id : null, name: Array.isArray(e.names) && e.names[0] ? e.names[0] : null, cls: typeof e.road_class === 'string' ? e.road_class : null };   // the OSM way (crowd.js reads members' data by it)
      m += len;
      return out;
    });
  }
  /** Per-km counts of points within ±halfM of each sample (fewer metres near the ends count as what's there). */
  function perKm(distM, totalM, atList, halfM = 500) {
    const out = new Float32Array(distM.length), pos = atList.slice().sort((a, b) => a - b);
    let lo = 0, hi = 0;
    for (let i = 0; i < distM.length; i++) {
      const a = distM[i] - halfM, b = distM[i] + halfM;
      while (hi < pos.length && pos[hi] <= b) hi++;
      while (lo < hi && pos[lo] < a) lo++;
      const span = Math.min(totalM, b) - Math.max(0, a);
      out[i] = span > 0 ? (hi - lo) / (Math.max(span, 250) / 1000) : NaN;   // at least 250 m, so one signal at a trip's end isn't "40 a km"
    }
    return out;
  }
  /**
   * Edge spans onto a corridor ({ distM, totalM }): every channel listed in the header, the points and spans. The edge
   * distances are scaled to the corridor's length (the router's and our haversine sums differ by a fraction of a percent).
   */
  function toChannels(c, edges) {
    const n = c.distM.length, total = c.totalM || c.distM[n - 1];
    const res = { status: 'ok', channels: {}, spans: [], points: [] };
    if (!edges || !edges.length) return { status: 'unavailable', note: 'no edges', channels: {}, spans: [], points: [] };
    const scale = edges[edges.length - 1].toM > 0 ? total / edges[edges.length - 1].toM : 1;
    const names = ['speed_limit_kph', 'speed_limit_est_kph', 'speed_kph', 'road_class', 'road_use', 'density', 'lanes', 'surface', 'sidewalk', 'truck_route', 'bridge', 'tunnel', 'toll', 'ramp', 'roundabout'];
    const key = { speed_limit_kph: 'sl', speed_limit_est_kph: 'est', speed_kph: 'speed', road_class: 'rc', road_use: 'use', density: 'density', lanes: 'lanes', surface: 'surface', sidewalk: 'sidewalk', truck_route: 'truck', bridge: 'bridge', tunnel: 'tunnel', toll: 'toll', ramp: 'ramp', roundabout: 'roundabout' };
    for (const nm of names) res.channels[nm] = new Float32Array(n).fill(NaN);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const m = c.distM[i] / scale;
      while (k < edges.length - 1 && edges[k].toM <= m) k++;
      const e = edges[k];
      for (const nm of names) { const v = e[key[nm]]; if (v != null && Number.isFinite(v)) res.channels[nm][i] = v; }
    }
    const signals = [], access = [], junctions = [];
    for (const e of edges) {
      const at = e.toM * scale;
      if (e.signal) { signals.push(at); res.points.push({ atM: at, kind: 'signal' }); }
      if (e.side + e.drive > 0 && !e.ramp) for (let j = 0; j < e.side + e.drive; j++) access.push(at);
      if (e.side > 0) { junctions.push(at); res.points.push({ atM: at, kind: 'junction', value: e.side }); }
      if (e.drive > 0) res.points.push({ atM: at, kind: 'driveway', value: e.drive });
    }
    res.channels.signals_per_km = perKm(c.distM, total, signals);
    res.channels.access_per_km = perKm(c.distM, total, access);
    res.channels.intersections_per_km = perKm(c.distM, total, junctions);
    for (const kind of ['bridge', 'tunnel', 'toll', 'roundabout', 'unpaved']) {
      let open = null;
      for (const e of edges) {
        if (e[kind] && open == null) open = e.fromM;
        if (!e[kind] && open != null) { res.spans.push({ fromM: open * scale, toM: e.fromM * scale, kind }); open = null; }
      }
      if (open != null) res.spans.push({ fromM: open * scale, toM: total, kind });
    }
    return res;
  }

  // ---- fetching ------------------------------------------------------------------------------------------------
  async function one(c, opts) {
    const f = opts.fetch || root.fetch;
    if (!c.coords || c.coords.length < 2) return { status: 'unavailable', note: 'no route line' };
    if ((c.totalM || 0) > MAX_KM * 1000) return { status: 'unavailable', note: 'too long for the router' };
    const key = Ctx.keyOf(c.coords);
    let edges = kept && kept.get(key);
    // a stage (a stretch cut from the map tiles, the same for everyone near it, never the driver's route) through our
    // Worker's relay (backend/src/trace_relay.ts), kept there per shape: the next plan nearby has its edges at once
    if (!edges && c.match === 'map_snap' && typeof opts.apiGet === 'function') {
      try {
        const j = await Promise.race([opts.apiGet(`${RELAY}?shape=${encodeURIComponent(encode6(thin(c.coords, RELAY_POINTS)))}`),
          new Promise((r) => { if (!opts.signal) return; if (opts.signal.aborted) r(null); else opts.signal.addEventListener('abort', () => r(null), { once: true }); })]);
        edges = j ? parse(j) : null;
        if (edges) kept && kept.set(key, edges);
      } catch (_) { edges = null; }
    }
    if (!edges) {
      for (const match of c.match ? [c.match] : ['walk_or_snap', 'map_snap']) {     // a line from the map tiles (a stage) is snapped
        if (opts.signal && opts.signal.aborted) return { status: 'unavailable', note: 'out of time' };
        try {
          const body = match === 'edge_walk' || match === 'walk_or_snap' ? request(c.coords, match) : request(thin(c.coords, 2000), match);
          const r = await f(`${VALHALLA}/trace_attributes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
          if (!r.ok) continue;
          edges = parse(await r.json());
          if (edges) break;
        } catch (e) { if (opts.signal && opts.signal.aborted) return { status: 'unavailable', note: 'out of time' }; }
      }
      if (!edges) return { status: 'unavailable', note: 'router gave no edges' };
      kept && kept.set(key, edges);
    }
    c.edges = edges;
    return toChannels(c, edges);
  }
  /** At most `max` points, ends kept (for map matching a line the router didn't draw). */
  function thin(coords, max) {
    if (coords.length <= max) return coords;
    const step = (coords.length - 1) / (max - 1), out = [];
    for (let i = 0; i < max; i++) out.push(coords[Math.round(i * step)]);
    return out;
  }
  // PARALLEL requests in flight in all, across the plan's context runs at once (the routes', the stages', each stage
  // plan's): live, ten at a time made the public server answer each in 1.5 s and the stages' run came back empty
  const PARALLEL = 6;
  let active = 0;
  const waiting = [];
  const slot = () => (active < PARALLEL ? (active++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const free = () => { const next = waiting.shift(); if (next) next(); else active--; };
  /** Every corridor's edges, PARALLEL at a time; when opts.signal fires, what has answered (the rest out of time). */
  async function fetchAll(corridors, opts = {}) {
    const out = {}, queue = corridors.slice();
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        await slot();
        try { if (opts.signal && opts.signal.aborted) return; const r = await one(c, opts); if (!(c.id in out)) out[c.id] = r; } finally { free(); }
      }
    };
    const all = Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    const sig = opts.signal;
    const stop = sig ? new Promise((resolve) => { if (sig.aborted) resolve(); else sig.addEventListener('abort', resolve, { once: true }); }) : null;
    await (stop ? Promise.race([all, stop]) : all);
    for (const c of corridors) if (!(c.id in out)) out[c.id] = { status: 'unavailable', note: 'out of time' };
    return out;
  }

  const provider = { id: 'router', version: 1, priority: 10, stageOk: true, budgetMs: 2400, needs: { network: true },
    channels: ['speed_limit_kph', 'speed_limit_est_kph', 'speed_kph', 'road_class', 'road_use', 'density', 'lanes', 'surface', 'sidewalk', 'truck_route',
      'bridge', 'tunnel', 'toll', 'ramp', 'roundabout', 'signals_per_km', 'access_per_km', 'intersections_per_km'],
    fetch: fetchAll };
  const api = { ...provider, PARALLEL, RELAY, ATTRS, ROAD_CLASS, ROAD_USE, SURFACE, estimateLimit, encode6, request, parse, perKm, toChannels, thin };
  if (Ctx) Ctx.register(provider);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexRouteCtxRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
