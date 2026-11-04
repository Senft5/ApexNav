// Route context: our own scored road network (docs/OWN_ROUTING.md). Where the graph tiles cover a plan, every edge already
// carries the route engine's own quality and scenery, computed once at build time from the static channels (land use,
// density, businesses, signals, the national grid, the DEM, corners), so a plan routed on them needn't fetch those again.
// This provider lays the tiles' scores on each corridor's 25 m samples, by the nearest same-heading edge (the worker's
// graph_router.js scoreLine), for our routes and the router's alike, so the pool is scored on one scale.
// Channels (Float32Array per sample; NaN = no edge or unknown):
//   graph_quality, graph_scenery  0..1  the engine's per-25 m model, averaged over the edge (route_engine.js fills its
//                                       quality and scenery from these where its own channels don't say enough)
//   graph_conf      0..1   share of the model's weight that was known on that edge (its qConf)
//   speed_limit_kph, speed_limit_est_kph, road_class, toll, bridge, tunnel, signal_node (0/1 at the edge's end)
//   v2 tiles' road channels under the engine's own names (business_per_km, access_per_km, signals_per_km, stops_per_km,
//   crossings_per_km, calming_per_km, sidewalk, density, bldg_per_km, addr_per_km): the side-street, density and
//   business evidence the live model reads, so the engine scores our corridors from them as it does live (the tiles'
//   quality then only fills what they don't say)
// Licence: road data (c) OpenStreetMap contributors, ODbL (About > Sources). Cadence: the tiles' build (index.json).
// opts.graphScore(lines) -> Promise<[per line { quality, scenery, conf, limit, limitEst, cls, toll, bridge, tunnel, signals }]>
// (cockpit.js passes the worker's); without it the provider says 'unavailable' and costs nothing.
(function (root) {
  'use strict';
  const Ctx = root.ApexRouteCtx && root.ApexRouteCtx.register ? root.ApexRouteCtx : typeof require === 'function' ? (() => { try { return require('./registry.js'); } catch (_) { return null; } })() : null;
  // the v2 road channels that are the engine's own (graph_tiles.js CHANNELS); schools, worship and `built` are the build's
  const ROAD = ['business_per_km', 'access_per_km', 'signals_per_km', 'stops_per_km', 'crossings_per_km', 'calming_per_km', 'sidewalk', 'density', 'bldg_per_km', 'addr_per_km'];
  const CH = ['graph_quality', 'graph_scenery', 'graph_conf', 'speed_limit_kph', 'speed_limit_est_kph', 'road_class', 'toll', 'bridge', 'tunnel', 'signal_node', ...ROAD];
  const FROM = { graph_quality: 'quality', graph_scenery: 'scenery', graph_conf: 'conf', speed_limit_kph: 'limit', speed_limit_est_kph: 'limitEst', road_class: 'cls', toll: 'toll', bridge: 'bridge', tunnel: 'tunnel', signal_node: 'signals' };
  const empty = (n, status, note) => ({ status, ...(note ? { note } : {}), channels: Object.fromEntries(CH.map((k) => [k, new Float32Array(n).fill(NaN)])), spans: [], points: [] });

  /** One corridor's channels from the worker's per-sample answer. */
  function channelsOf(n, ans) {
    const channels = {};
    let known = 0;
    for (const k of CH) {
      const src = ans && (FROM[k] ? ans[FROM[k]] : ans.ch && ans.ch[k]), out = new Float32Array(n).fill(NaN);
      if (src) for (let i = 0; i < n && i < src.length; i++) out[i] = Number.isFinite(src[i]) ? src[i] : NaN;
      channels[k] = out;
    }
    for (let i = 0; i < n; i++) if (Number.isFinite(channels.graph_quality[i])) known++;
    return { status: known >= 0.5 * n ? 'ok' : known ? 'partial' : 'unavailable', channels, spans: [], points: [] };
  }

  async function fetchCtx(corridors, opts = {}) {
    const out = {};
    if (typeof opts.graphScore !== 'function') { for (const c of corridors) out[c.id] = empty(c.lat.length, 'unavailable', 'No graph tiles here'); return out; }
    try {
      const res = await opts.graphScore(corridors.map((c) => ({ lat: Array.from(c.lat), lon: Array.from(c.lon) })));
      corridors.forEach((c, k) => { out[c.id] = channelsOf(c.lat.length, res && res[k]); });
    } catch (e) {
      for (const c of corridors) out[c.id] = empty(c.lat.length, 'unavailable', String((e && e.message) || e));
    }
    return out;
  }

  // priority 15: after the router's own edges (10) where it answered, before the DEM and the map tiles
  const provider = { id: 'graph', version: 1, channels: CH, needs: { network: false }, budgetMs: 1000, priority: 15, fetch: fetchCtx };
  if (Ctx && Ctx.register) Ctx.register(provider);
  const api = { provider, CH, ROAD, channelsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexRouteGraph = api;
})(typeof window !== 'undefined' ? window : globalThis);
