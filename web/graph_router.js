// ApexGraphRouter: Vetta's own routing on the phone, over our own pre-scored road network (docs/OWN_ROUTING.md §5).
//
// The graph tiles (web/graph_tiles.js, ApexGraphTiles.decode) carry every drivable edge with its time, length and the
// route engine's own quality, scenery and fun scores. This file is pure (no DOM, no fetch of its own) so node tests it:
//   view(tiles)        the loaded tiles as one flat graph (CSR), cross-tile edges stitched, a node grid for snapping
//   tilesFor(a, b, lv) the 0.25° tiles under the corridor ellipse the level's detour budget can reach
//   search(...)        edge-based A* (the state is the edge you arrived on, so turn restrictions, U-turns and turn costs are
//                      exact); the heuristic is straight-line distance over the network's top speed, times the objective's
//                      smallest per-second cost, so it stays admissible for every objective
//   plan(view, req)    Quick, Fun and Max fun: the quickest, then t × (1 + a × (1 − goodness)) with `a` bisected so the time
//                      stays inside the level's budget (fun_route.js LEVELS), then 2 alternates by the penalty method
//   loop(view, req)    a ring of waypoints back to the start, sized by the requested length
//   host(env), client  the Web Worker's message protocol (web/graph_worker.js) and the page's side of it
// Each route comes back with its line at the edges' geometry, its edge ids, time, distance, names per stretch, the inputs
// of its choice (why), and `route`: the same shape cockpit.js routeOf() makes of a Valhalla trip, so the route engine's
// corridors, ranking and why line take it as they take the router's.
(function (root) {
  'use strict';
  const FunRoute = () => root.ApexFunRoute || (typeof require === 'function' ? (() => { try { return require('./fun_route.js'); } catch (_) { return null; } })() : null);
  // the same budgets as the route engine (fun_route.js LEVELS); this copy only when that file isn't loaded (the worker)
  const LEVELS_COPY = {
    quick: { budget: 0, slackS: 60, perMin: 3.0 },
    fun: { budget: 0.35, slackS: 240, perMin: 1.0, noHighway: true },
    max: { budget: 0.90, slackS: 600, perMin: 0.35, noHighway: true },
  };
  const levels = () => { const F = FunRoute(); return (F && F.LEVELS) || LEVELS_COPY; };
  const TILE_DEG = 0.25;
  // the tile format's tables (web/graph_tiles.js, tools/graph_etl/tiles.py): edge flags, node flags, classes, unknowns
  const FLAG_BITS = { oneway: 1, toll: 2, ferry: 4, unpaved: 8, tunnel: 16, bridge: 32, motorway: 64, ramp: 128, roundabout: 256, private: 512,
    geomRev: 1024, speedEst: 2048, barrier: 4096, destination: 8192, expressway: 16384 };
  const NODE_BITS = { signal: 1, stop: 2, giveWay: 4, barrier: 8, levelCrossing: 16, deadEnd: 32, crossing: 64, calming: 128 };
  const flagBits = () => { const T = root.ApexGraphTiles; return (T && T.FLAGS) || FLAG_BITS; };
  const nodeBits = () => { const T = root.ApexGraphTiles; return (T && T.NODE_FLAGS) || NODE_BITS; };
  // road classes, the router's codes (the route engine's road_class) plus track and ferry
  const CLS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, service: 7, track: 8, ferry: 9 };
  const UNKNOWN_U8 = 255, UNKNOWN_FUN = 0xffff, NO_NAME = 0xffff;

  // ---- the objective's knobs ------------------------------------------------------------------------------------------
  const K = {
    UNKNOWN_G: 0.3,          // goodness of an edge nobody knew (conf 0): below the middle, so unknown road can't win
    GATE_LO: 0.25, GATE_HI: 0.6,   // the route engine's corner gate: corners count nothing on quality 0.25, in full from 0.6
    // goodness = not a side street (the engine's poor cost: quality 0.25 -> 0.45) + quality + corners + scenery. Corners
    // carry most of it: a motorway is good road (quality ~0.8) but no fun, and must not soak up the Fun objective
    W_NOTPOOR: 0.2, W_QUALITY: 0.15, W_FUN: 0.45, W_SCENERY: 0.2, POOR_LO: 0.25, POOR_HI: 0.45,
    FUN_FULL_PCT: 0.5,       // fun per km that counts as full: the loaded network's median of edges with corners
    // members' data (crowd.js channels) per edge, with the route engine's own weights (route_engine.js QUALITY/SCENERY)
    // against the share of the model the tile's score already knew (conf x the model's weight)
    CROWD_W: { rough: 1, flow: 1, loved: 1.5, bank: 0.5 }, MODEL_WQ: 37.1, MODEL_WS: 12.8,
    TURN_RIGHT_S: 2, TURN_RIGHT_K: 4, TURN_LEFT_S: 5, TURN_LEFT_K: 8, STRAIGHT_RAD: 0.35, UTURN_S: 30,
    // passing a node with a signal, a stop sign, give way, a level crossing, calming or a crossing (the tiles' node flags;
    // the same seconds the ETL adds for those inside an edge, tools/graph_etl/build.py DELAY_S; end nodes are ours)
    SIGNAL_S: 15, STOP_S: 7, GIVE_WAY_S: 2, LEVEL_CROSSING_S: 4, CALMING_S: 3, CROSSING_S: 1, BARRIER_S: 120,
    // the search's weight on a signal's, stop's and give way's seconds (Route tuning's "Traffic lights and stops",
    // web/route_tuning.js): 1 counts their wait as it is; above it the search keeps off them, while the route's time (the
    // card's, the ETA's) still counts only the real wait
    STOP_AVOID_X: 1,
    PRIVATE_X: 10, PRIVATE_S: 600, DESTINATION_X: 2, DESTINATION_S: 60, FERRY_X: 2, UNPAVED_X: 1.5,
    AVOID_HWY_X: 4, AVOID_TOLL_X: 3, AVOID_FERRY_X: 5, AVOID_UNPAVED_X: 5,
    // the goodness weight is searched in [0, A_MAX] (log steps from A_FIRST), at most BISECT more routes. At Fun and Long
    // way the pick is then by the goodness the extra time buys (pick(): BUY per 100 % more time over the level's quickest,
    // never under BUY_MIN), among those routes and the spread's (SPREAD: penalty alternates of the first step's route)
    A_MAX: { quick: 40, fun: 40, max: 80 }, A_FIRST: { quick: 1, fun: 5, max: 5 }, BISECT: 6,
    SPREAD: { fun: [0.6], max: [1.5] }, BUY: { fun: 0.12, max: 0.03 }, BUY_MIN: 0.1,
    // and the road's length, as the route engine counts it (route_engine.js W): ROAD.poor points per km of side street
    // (quality 0.45 -> 0.25), ROAD.good per km of good road (quality 0.5 -> 0.65, never a motorway or ramp), each point over
    // the level's quickest worth ROAD.w of G. G is a mean: a longer way's extra suburb thins out in it, as does its extra
    // good road, while the engine pays for every km of both (2026-11-08, engine-rank: subdivision4's 17 min Long way and
    // colerain's 20 min Fun drove more side street for their G; harrison's 42 min Long way more good road)
    ROAD: { poor: 10, good: 1.5, goodLo: 0.5, goodHi: 0.65, w: 0.003 },
    LOWER: [0.9, 0.75],      // then these fractions of the weight found: cheaper ways to the road the budget-filler found
    ALT_PENALTIES: [0.6, 1.5, 4], ALT_MIN_DIFF: 0.3, ALTS: 2,
    LOOP_A: { quick: 0.6, fun: 3, max: 8 }, LOOP_ROAD_FACTOR: 1.35, LOOP_RETRACE_X: 3,
    // there and back (roundTrip): the way out costs ROUND_RETRACE_X on the way back (both directions), so the return finds
    // other road; a pair driving more than ROUND_MAX_RETRACED of itself twice is not offered as a round trip
    ROUND_RETRACE_X: 4, ROUND_MAX_RETRACED: 0.5, ROUND_A: { quick: [0, 1], fun: [1, 3, 8], max: [3, 8, 20] }, ROUND_PAIRS: 3,
    // levels (the owner, 2026-11-08: "fun should never go on the highway. Quick should essentially be a normal route"):
    // at Fun and Long way (NO_HWY) a motorway, trunk or one of their links is never driven: a hard filter in the search, not a
    // cost. Only where no way without one exists in the level's corridor (a river crossed only by an interstate bridge, a
    // start or end on a ramp) is one used, each highway second x HWY_LINK_X so the link is the shortest there is; a
    // highway-free way over HWY_ABSURD x the quickest's time is still the level's way (the card says Quick is the way); the
    // budget never shuts out the highway-free quickest (+ HWY_FREE_SLACK_S). A point snapped onto a highway moves to the
    // nearest other road within HWY_SNAP_M (a car on the highway, heading given and within HWY_ON_M of it, stays on it)
    NO_HWY: { fun: true, max: true }, HWY_LINK_X: 25, HWY_ABSURD: 2, HWY_FREE_SLACK_S: 60, HWY_SNAP_M: 150, HWY_ON_M: 25,
    // loops (loop()): at Quick motorway and trunk cost x LOOP_HWY_X on every leg (a short link to good roads, never the
    // bulk), at Fun and Long way they are never driven (NO_HWY, the same exception); the
    // stages within reach of half the length at LOOP_REACH_MS; at most LOOP_STAGES of them chained, LOOP_TRIES loops
    // routed, each stage driven through a point every LOOP_ALONG_M; a loop with more than LOOP_MAX_RETRACED driven twice
    // is dropped
    LOOP_HWY_X: { quick: 2.5 }, LOOP_REACH_MS: 15, LOOP_STAGES: 8, LOOP_TRIES: 6, LOOP_ALONG_M: 1500, LOOP_MAX_RETRACED: 0.4,
    LOOP_CONN_FACTOR: 1.7, LOOP_CONN_A: 3, LOOP_MAX_OFF: 0.6,   // a connector's road length over its crow line, the router's detours to good road in it (Cincinnati, 2026-11-04)
    SNAP_M: 1500, GRID_DEG: 0.01,
    OUT_BACK_KM: 2,          // Best roads nearby: a dead-end run of good road this long stays (driven there and back); the stage minimum
  };

  // ---- geometry -------------------------------------------------------------------------------------------------------
  const R_EARTH = 6371008.8, RAD = Math.PI / 180;
  function distM(lat1, lon1, lat2, lon2) {
    const p = (lat1 + lat2) * 0.5 * RAD, x = (lon2 - lon1) * RAD * Math.cos(p), y = (lat2 - lat1) * RAD;
    return R_EARTH * Math.sqrt(x * x + y * y);
  }
  /** Bearing a -> b, radians clockwise from north. */
  function bearing(lat1, lon1, lat2, lon2) {
    const p = (lat1 + lat2) * 0.5 * RAD;
    return Math.atan2((lon2 - lon1) * Math.cos(p), lat2 - lat1);
  }
  /** Signed turn from heading h1 to h2 in (-π, π]: positive is a right turn (clockwise). */
  function turnAngle(h1, h2) {
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // the tiles' grid (graph_tiles.js tileOf): i from longitude, j from latitude; files and index keys are "i_j"
  const tileOf = (lat, lon) => ({ i: Math.floor((lon + 180) / TILE_DEG), j: Math.floor((lat + 90) / TILE_DEG) });
  const keyOf = (i, j) => `${i}_${j}`;
  const packedKey = (k) => `${k >>> 16}_${k & 0xffff}`;              // graph_tiles.js keyOf: (i << 16) | j

  // ---- the multi-tile view ---------------------------------------------------------------------------------------------
  function refKey(ref) {
    if (ref == null) return null;
    if (typeof ref === 'string') return ref;
    if (typeof ref === 'number') return packedKey(ref);
    if (Array.isArray(ref)) return keyOf(ref[0], ref[1]);
    if (typeof ref === 'object' && Number.isFinite(ref.i)) return keyOf(ref.i, ref.j);
    return null;
  }
  /**
   * The decoded tiles as one graph: global node and edge ids (tile by tile, in the order given; the order is sorted by
   * tile key so the same tiles always make the same ids), cross-tile edges stitched to the loaded neighbour (an edge into
   * a tile that isn't loaded can't be used), the reverse adjacency, dead ends, and a node grid for snapping.
   */
  function view(tiles) {
    const list = (tiles || []).filter((t) => t && t.nodes && t.edges).slice().sort((a, b) => (keyOf(a.tile.i, a.tile.j) < keyOf(b.tile.i, b.tile.j) ? -1 : 1));
    const T = list.length, index = new Map();
    const nodeBase = new Int32Array(T + 1), edgeBase = new Int32Array(T + 1);
    list.forEach((t, k) => {
      index.set(keyOf(t.tile.i, t.tile.j), k);
      nodeBase[k + 1] = nodeBase[k] + t.nodes.lat.length;
      edgeBase[k + 1] = edgeBase[k] + t.edges.to.length;
    });
    const N = nodeBase[T], E = edgeBase[T];
    const lat = new Float64Array(N), lon = new Float64Array(N), first = new Int32Array(N + 1);
    const to = new Int32Array(E), tail = new Int32Array(E), eTile = new Uint16Array(E);
    const time = new Float32Array(E), len = new Float32Array(E), quality = new Uint8Array(E), scenery = new Uint8Array(E), conf = new Uint8Array(E);
    const fun = new Float32Array(E), flags = new Uint16Array(E), cls = new Uint8Array(E), speed = new Uint8Array(E), name = new Int32Array(E);
    const nflags = new Uint8Array(N), hIn = new Float32Array(E).fill(NaN), hOut = new Float32Array(E).fill(NaN);
    // v2 tiles' road channels per edge (graph_tiles.js edges.ch: businesses, driveways, signals, sidewalks, density ...),
    // one Float32Array per channel over the whole view, NaN where a tile doesn't carry it
    const chNames = [...new Set(list.flatMap((t) => Object.keys((t.edges && t.edges.ch) || {})))];
    const roadCh = Object.fromEntries(chNames.map((k) => [k, new Float32Array(E).fill(NaN)]));
    let vmax = 1;
    list.forEach((t, k) => {
      const nb = nodeBase[k], eb = edgeBase[k], n = t.nodes.lat.length, ed = t.edges;
      const self = t.tile.key != null ? t.tile.key : (((t.tile.i << 16) | t.tile.j) >>> 0);
      const other = new Map();                                         // packed key -> view tile index (-1: not loaded)
      for (let a = 0; a < n; a++) {
        lat[nb + a] = t.nodes.lat[a] / 1e6; lon[nb + a] = t.nodes.lon[a] / 1e6;
        if (t.nodes.flags) nflags[nb + a] = t.nodes.flags[a];
        first[nb + a] = eb + t.nodes.firstEdge[a];
        for (let e = t.nodes.firstEdge[a]; e < t.nodes.firstEdge[a + 1]; e++) tail[eb + e] = nb + a;
      }
      for (let e = 0; e < ed.to.length; e++) {
        const g = eb + e, tt = ed.toTile ? ed.toTile[e] : self;
        if (tt === self) to[g] = nb + ed.to[e];
        else {
          if (!other.has(tt)) other.set(tt, index.has(packedKey(tt)) ? index.get(packedKey(tt)) : -1);
          const o = other.get(tt);
          // an edge into a tile that isn't loaded can't be used; one naming a node the tile doesn't have, neither
          to[g] = o >= 0 && ed.to[e] < nodeBase[o + 1] - nodeBase[o] ? nodeBase[o] + ed.to[e] : -1;
        }
        eTile[g] = k;
        len[g] = ed.len_dm[e] / 10; time[g] = Math.max(0.1, ed.t_ds[e] / 10);
        quality[g] = ed.quality[e]; scenery[g] = ed.scenery[e]; conf[g] = ed.conf[e];
        fun[g] = ed.fun[e] === UNKNOWN_FUN ? NaN : ed.fun[e] / 100;     // gated corner points (x 100 in the tile)
        flags[g] = ed.flags[e]; cls[g] = ed.cls[e]; speed[g] = ed.speed ? ed.speed[e] : 0;
        name[g] = ed.name && ed.name[e] !== NO_NAME ? ed.name[e] : -1;
        if (ed.hIn && ed.hOut) { hIn[g] = ed.hIn[e] / 256 * 2 * Math.PI; hOut[g] = ed.hOut[e] / 256 * 2 * Math.PI; }
        if (ed.ch) for (const k in ed.ch) roadCh[k][g] = ed.ch[k][e];
        const v = len[g] / time[g];
        if (v > vmax) vmax = v;
      }
    });
    first[N] = E;
    // reverse adjacency: the edges into each node
    const rfirst = new Int32Array(N + 1), redge = new Int32Array(E);
    for (let e = 0; e < E; e++) if (to[e] >= 0) rfirst[to[e] + 1]++;
    for (let a = 0; a < N; a++) rfirst[a + 1] += rfirst[a];
    const fill = rfirst.slice(0, N);
    for (let e = 0; e < E; e++) if (to[e] >= 0) redge[fill[to[e]]++] = e;
    // dead ends: one neighbour, in or out (the only place a U-turn is allowed)
    const deadEnd = new Uint8Array(N);
    for (let a = 0; a < N; a++) {
      let nb = -1, many = false;
      for (let e = first[a]; e < first[a + 1] && !many; e++) { const b = to[e]; if (b < 0 || b === a) continue; if (nb < 0) nb = b; else if (b !== nb) many = true; }
      for (let r = rfirst[a]; r < rfirst[a + 1] && !many; r++) { const b = tail[redge[r]]; if (b === a) continue; if (nb < 0) nb = b; else if (b !== nb) many = true; }
      deadEnd[a] = many ? 0 : 1;
    }
    // turn restrictions, by the edge they start from: each lives in its via node's tile (the to-edge local there), its
    // from-edge in fromTile (a packed key; the same tile when absent)
    const restr = new Map();
    list.forEach((t, k) => {
      for (const r of t.restrictions || []) {
        const fk = r.fromTile != null && r.fromTile !== t.tile.key ? index.get(packedKey(r.fromTile)) : k;
        if (fk == null || r.fromEdge >= edgeBase[fk + 1] - edgeBase[fk] || r.toEdge >= edgeBase[k + 1] - edgeBase[k]) continue;
        const from = edgeBase[fk] + r.fromEdge, toE = edgeBase[k] + r.toEdge;
        let x = restr.get(from);
        if (!x) restr.set(from, (x = { only: [], no: [] }));
        (r.only ? x.only : x.no).push(toE);
      }
    });
    // the node grid for snapping (counting sort by cell)
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (let a = 0; a < N; a++) { if (lat[a] < minLat) minLat = lat[a]; if (lat[a] > maxLat) maxLat = lat[a]; if (lon[a] < minLon) minLon = lon[a]; if (lon[a] > maxLon) maxLon = lon[a]; }
    const gi0 = Math.floor(minLat / K.GRID_DEG), gj0 = Math.floor(minLon / K.GRID_DEG);
    const GW = N ? Math.floor(maxLon / K.GRID_DEG) - gj0 + 1 : 0, GH = N ? Math.floor(maxLat / K.GRID_DEG) - gi0 + 1 : 0;
    const cellStart = new Int32Array(GW * GH + 1), cellNodes = new Int32Array(N), cellOf = new Int32Array(N);
    for (let a = 0; a < N; a++) { cellOf[a] = (Math.floor(lat[a] / K.GRID_DEG) - gi0) * GW + (Math.floor(lon[a] / K.GRID_DEG) - gj0); cellStart[cellOf[a] + 1]++; }
    for (let c = 0; c < GW * GH; c++) cellStart[c + 1] += cellStart[c];
    const cfill = cellStart.slice(0, GW * GH);
    for (let a = 0; a < N; a++) cellNodes[cfill[cellOf[a]]++] = a;
    // fun per km that counts as full: the network's own 90th percentile of edges with corners (scale-free: the tiles' fun
    // unit is the builder's)
    const dens = [];
    for (let e = 0; e < E; e += Math.max(1, Math.floor(E / 20000))) if (fun[e] > 0 && len[e] > 20) dens.push(fun[e] / (len[e] / 1000));
    dens.sort((a, b) => a - b);
    const funFull = dens.length ? Math.max(1e-6, dens[Math.min(dens.length - 1, Math.floor(K.FUN_FULL_PCT * dens.length))]) : 1;
    const v = {
      tiles: list, keys: list.map((t) => keyOf(t.tile.i, t.tile.j)), index, nodeBase, edgeBase, N, E, lat, lon, first, to, tail, eTile,
      time, len, quality, scenery, conf, fun, flags, cls, speed, name, nflags, vmax, rfirst, redge, deadEnd, restr, funFull,
      grid: { i0: gi0, j0: gj0, W: GW, H: GH, start: cellStart, nodes: cellNodes },
      hIn, hOut, roadCh, scratch: null, bits: flagBits(), nbits: nodeBits(), hasRestr: new Uint8Array(E), gcache: new Map(),
    };
    for (const e of restr.keys()) v.hasRestr[e] = 1;
    // via-way restrictions (v3 tiles: restrictionsVia [{ from, via: [edges], to, only }], tile-local edges; a packed
    // tile key per part, fromTile / viaTile[] / toTile, where one lies in another tile), by their last via edge
    v.restrVia = new Map(); v.hasVia = new Uint8Array(E);
    list.forEach((t, k) => {
      const at = (key) => (key != null && key !== t.tile.key ? index.get(packedKey(key)) : k);
      const g = (tk, e) => { const x = at(tk); return x == null || e == null || e >= edgeBase[x + 1] - edgeBase[x] ? -1 : edgeBase[x] + e; };
      for (const r of t.restrictionsVia || []) {
        const vias = (r.via || []).map((e, i) => g(r.viaTile ? r.viaTile[i] : null, e));
        const seq = [g(r.fromTile, r.from), ...vias], to = g(r.toTile, r.to);
        if (!vias.length || to < 0 || seq.some((e) => e < 0)) continue;
        const last = seq[seq.length - 1];
        if (!v.restrVia.has(last)) v.restrVia.set(last, []);
        v.restrVia.get(last).push({ seq, to, only: !!r.only });
        v.hasVia[last] = 1;
      }
    });
    return v;
  }

  /** The edge's line, [lat, lon, ...] in degrees, from its tail node to its head node. */
  function geom(v, e) {
    const hit = v.gcache && v.gcache.get(e);
    if (hit) return hit;
    const k = v.eTile[e], t = v.tiles[k], local = e - v.edgeBase[k];
    let g = null;
    try { g = typeof t.geom === 'function' ? t.geom(local) : null; } catch (_) { g = null; }
    const a = v.tail[e], b = v.to[e];
    const pts = [];
    if (!g || g.length < 4 || distM(g[0], g[1], v.lat[a], v.lon[a]) > 1) pts.push(v.lat[a], v.lon[a]);
    if (g) for (let i = 0; i + 1 < g.length; i += 2) pts.push(g[i], g[i + 1]);
    if (b >= 0 && distM(pts[pts.length - 2], pts[pts.length - 1], v.lat[b], v.lon[b]) > 1) pts.push(v.lat[b], v.lon[b]);
    if (v.gcache) { if (v.gcache.size > 200000) v.gcache.clear(); v.gcache.set(e, pts); }
    return pts;
  }
  /** Heading leaving the tail (first ~20 m) and arriving at the head (last ~20 m), cached. */
  function headings(v, e) {
    if (!Number.isNaN(v.hIn[e])) return;
    const g = geom(v, e), n = g.length / 2;
    if (n < 2) { v.hIn[e] = 0; v.hOut[e] = 0; return; }
    let j = 1;
    while (j < n - 1 && distM(g[0], g[1], g[2 * j], g[2 * j + 1]) < 20) j++;
    v.hIn[e] = bearing(g[0], g[1], g[2 * j], g[2 * j + 1]);
    let i = n - 2;
    while (i > 0 && distM(g[2 * i], g[2 * i + 1], g[2 * n - 2], g[2 * n - 1]) < 20) i--;
    v.hOut[e] = bearing(g[2 * i], g[2 * i + 1], g[2 * n - 2], g[2 * n - 1]);
  }
  /** Stable edge id: "<tile i>_<tile j>:<local edge>". */
  const edgeId = (v, e) => `${v.keys[v.eTile[e]]}:${e - v.edgeBase[v.eTile[e]]}`;
  function nameOf(v, e) {
    const ix = v.name[e], t = v.tiles[v.eTile[e]];
    return ix >= 0 && t.names && t.names[ix] ? t.names[ix] : null;
  }
  /** The other direction of the same road (v -> u with about the same length), or -1. */
  function twin(v, e) {
    const b = v.to[e], a = v.tail[e];
    if (b < 0) return -1;
    for (let x = v.first[b]; x < v.first[b + 1]; x++) if (v.to[x] === a && Math.abs(v.len[x] - v.len[e]) <= Math.max(3, 0.03 * v.len[e])) return x;
    return -1;
  }

  // ---- snapping --------------------------------------------------------------------------------------------------------
  /** Nearest point on edge e to (la, lo): { d metres, frac along its length, lat, lon }. */
  function project(v, e, la, lo) {
    const g = geom(v, e), n = g.length / 2, c = Math.cos(la * RAD);
    let best = { d: Infinity, frac: 0, lat: g[0], lon: g[1] }, run = 0, total = 0;
    const seg = [];
    for (let i = 0; i < n - 1; i++) { const s = distM(g[2 * i], g[2 * i + 1], g[2 * i + 2], g[2 * i + 3]); seg.push(s); total += s; }
    for (let i = 0; i < n - 1; i++) {
      const ax = g[2 * i + 1] * c, ay = g[2 * i], bx = g[2 * i + 3] * c, by = g[2 * i + 2], px = lo * c, py = la;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const u = L2 > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / L2) : 0;
      const qlat = ay + u * dy, qlon = (ax + u * dx) / c, d = distM(la, lo, qlat, qlon);
      if (d < best.d) best = { d, frac: total > 0 ? (run + u * seg[i]) / total : 0, lat: qlat, lon: qlon };
      run += seg[i];
    }
    return best;
  }
  /**
   * The road nearest a point: [{ edge, frac, d, lat, lon }] for the nearest edge and its other direction (both are ways to
   * leave or reach it). `filter(e)` limits which edges count (loops' waypoints: through roads only); service roads and
   * private ones count 25 m and 60 m further, so a start beside the main road takes the main road.
   */
  function snap(v, la, lo, filter = null, maxM = K.SNAP_M) {
    const G = v.grid, B = flagBits();
    if (!v.N || !G.W) return [];
    const ci = Math.floor(la / K.GRID_DEG) - G.i0, cj = Math.floor(lo / K.GRID_DEG) - G.j0;
    const seen = new Set();
    let best = null;
    for (let ring = 0; ring <= Math.ceil(maxM / (K.GRID_DEG * 111000 * Math.cos(la * RAD))) + 1; ring++) {
      for (let di = -ring; di <= ring; di++) for (let dj = -ring; dj <= ring; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= G.H || j >= G.W) continue;
        const c = i * G.W + j;
        for (let p = G.start[c]; p < G.start[c + 1]; p++) {
          const a = G.nodes[p];
          const consider = (e) => {
            if (seen.has(e) || v.to[e] < 0) return;
            seen.add(e);
            if (filter && !filter(e)) return;
            const pr = project(v, e, la, lo);
            const score = pr.d + (v.cls[e] >= CLS.service ? 25 : 0) + (v.flags[e] & B.private ? 60 : 0);
            if (pr.d <= maxM && (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && e < best.edge))) best = { edge: e, ...pr, score };
          };
          for (let e = v.first[a]; e < v.first[a + 1]; e++) consider(e);
          for (let r = v.rfirst[a]; r < v.rfirst[a + 1]; r++) consider(v.redge[r]);
        }
      }
      // a found edge within this ring's reach can't be beaten by a node two rings out (edges are short next to the grid)
      if (best && best.d < (ring - 1) * K.GRID_DEG * 111000 * Math.cos(la * RAD)) break;
    }
    if (!best) return [];
    const out = [{ edge: best.edge, frac: best.frac, d: best.d, lat: best.lat, lon: best.lon }];
    const tw = twin(v, best.edge);
    if (tw >= 0 && (!filter || filter(tw))) out.push({ edge: tw, frac: 1 - best.frac, d: best.d, lat: best.lat, lon: best.lon });
    return out;
  }

  /**
   * Our quickest alone (one search): the first route on screen. At a level that never drives a highway (NO_HWY), the
   * quickest way without one (freeQuickest), so the first route up is already the level's kind of route.
   */
  function quickest(v, req) { return withTune(req && req.tune, () => quickestNow(v, req)); }
  /**
   * A tune (req.tune: the driver's Route tuning, web/route_tuning.js, and a developer's Dev panel overrides on top,
   * web/dev_panel.js) laid on K and the levels' budgets for this one call (a plan, a quickest, a loop), and put back after,
   * whatever happens. No tune: fn() as written.
   */
  function withTune(tune, fn) {
    const F = FunRoute();
    if (!tune || !F || !F.tuned || !F.tuned(tune)) return fn();
    const undo = F.tuneOnto(K, tune.router);
    F.tuneOnto(levels(), tune.levels, undo);
    try { return fn(); } finally { F.untune(undo); }
  }
  function quickestNow(v, req) {
    const level = levels()[req.level] ? req.level : 'fun', obj = objective(v, req);
    const { src, dst } = snapBoth(v, req.from, req.to);
    const sc = startCostFor(v, req.from.heading != null ? req.from.heading : req.heading);
    const opts = { ...(sc ? { startCost: sc } : {}), ellipse: ellipseFor(req.from, req.to, level) };
    if (noHighway(level)) {
      const f = freeQuickest(v, obj, req, src, dst, opts);
      if (!f) throw new Error('no route');
      v.quickMemo = { key: quickKey(req, level, obj, 'free'), f };
      const out = assemble(v, f.r, obj, { level, role: 'quickest', a: 0 });
      if (f.mode === 'link') out.route.hwyReason = hwyReason(v, out);
      return out;
    }
    const r = search(v, obj, src, dst, 0, null, opts);
    if (!r) throw new Error('no route');
    v.quickMemo = { key: quickKey(req, level, obj), r };
    return assemble(v, r, obj, { level, role: 'quickest', a: 0 });
  }
  // The time-only search (a = 0) reads only the trip, the start heading, the level's ellipse and the objective's per-edge
  // multipliers and adds (the avoid choices) and node costs: goodness and members' data weigh nothing at a = 0. So the
  // first route's search (quickest) is the plan's own a = 0 search when the view and these are the same (the plan asked
  // right behind it, on the tiles already in view: 60-80 ms of the worker's critical path, live 2026-11-08); same answer.
  function quickKey(req, level, obj, kind = 'any') {
    const h = req.from.heading != null ? req.from.heading : req.heading;
    // (a developer's tune changes the turn and node costs: a quickest made under another one isn't this plan's)
    return JSON.stringify([req.from.lat, req.from.lon, req.to.lat, req.to.lon, Number.isFinite(h) ? h : null, level, req.avoid || null, obj.nodeCosts, kind, req.tune || null]);
  }
  /**
   * The quickest way from `from` through req.via (in order) to `to`: each leg's search starts on the edge the last one
   * arrived on, driven on (no U-turn at a via), as the loops' legs are joined. A reroute along the planned route's points,
   * a stage's or a shared road's points, or a drive again, on our tiles (offline as well as on). At Fun and Long way (a
   * reroute of a route planned there) no leg drives a highway unless it has no other way (each leg as freeQuickest).
   * Throws when a point has no road near it or a leg has no way.
   */
  function through(v, req) {
    const level = levels()[req.level] ? req.level : 'fun', obj = objective(v, req), free = noHighway(level), is = free ? hwyOf(v) : null;
    const h0 = req.from.heading != null ? req.from.heading : req.heading;
    let prev = snap(v, req.from.lat, req.from.lon);
    if (!prev.length) throw new Error('no road near the start');
    if (free) prev = snapOff(v, req.from, prev, h0);
    const sc = startCostFor(v, h0);
    const legs = [], pts = [...(req.via || []), req.to];
    let at = req.from;
    for (const [k, p] of pts.entries()) {
      let dst = snap(v, p.lat, p.lon);
      if (!dst.length) { if (k === pts.length - 1) throw new Error('no road near the end'); continue; }   // a via off the network: passed by
      if (free) dst = snapOff(v, p, dst);
      const o = { ...(!legs.length && sc ? { startCost: sc } : {}), ellipse: ellipseFor(at, p, 'quick') };
      let res = search(v, obj, prev, dst, 0, null, free ? { ...o, ban: is } : o);
      if (!res && free) res = search(v, obj, prev, dst, 0, null, { ...o, hwyX: { is, x: K.HWY_LINK_X } });
      if (!res) throw new Error('no route');
      legs.push(res);
      prev = [{ edge: res.edges[res.edges.length - 1], frac: res.ft, lat: 0, lon: 0 }];
      at = p;
    }
    const edges = [];
    for (const [k, l] of legs.entries()) for (const [m, e] of l.edges.entries()) if (!(k > 0 && m === 0 && edges[edges.length - 1] === e)) edges.push(e);
    const out = assemble(v, { edges, fs: legs[0].fs, ft: legs[legs.length - 1].ft }, obj, { level, role: 'through', a: 0 });
    if (free && out.hwyKm > 0) out.route.hwyReason = hwyReason(v, out);
    return out;
  }
  /**
   * The tiles' own scores along any line (ours, or the router's routes in the same pool): each sample lands on the
   * nearest edge within 20 m heading the same way (within 60°). Per sample: quality, scenery and conf (0..1, NaN where
   * no edge or unknown), the posted limit (or the class estimate, flagged apart), the road class and the edge's flags.
   */
  function scoreLine(v, lat, lon) {
    const n = lat.length, B = v.bits;
    const out = { quality: new Float32Array(n).fill(NaN), scenery: new Float32Array(n).fill(NaN), conf: new Float32Array(n).fill(NaN),
      limit: new Float32Array(n).fill(NaN), limitEst: new Float32Array(n).fill(NaN), cls: new Float32Array(n).fill(NaN), toll: new Float32Array(n).fill(NaN),
      bridge: new Float32Array(n).fill(NaN), tunnel: new Float32Array(n).fill(NaN), signals: new Float32Array(n).fill(NaN), ch: {} };
    for (const k in v.roadCh || {}) out.ch[k] = new Float32Array(n).fill(NaN);
    let last = -1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      if (a === b) continue;
      const h = bearing(lat[a], lon[a], lat[b], lon[b]);
      const ok = (e) => { headings(v, e); const pr = project(v, e, lat[i], lon[i]); if (pr.d > 20) return false;
        // the edge's heading where the sample is: its first, last or straight-line bearing, whichever is nearest
        const g = geom(v, e), m = g.length / 2;
        let best = 0, bd = Infinity;
        for (let q = 0; q < m - 1; q++) { const d = distM(lat[i], lon[i], (g[2 * q] + g[2 * q + 2]) / 2, (g[2 * q + 1] + g[2 * q + 3]) / 2); if (d < bd) { bd = d; best = q; } }
        return Math.abs(turnAngle(h, bearing(g[2 * best], g[2 * best + 1], g[2 * best + 2], g[2 * best + 3]))) < 1.05; };
      // the edge the last sample was on, or the next one along it, first: a line is mostly the same edge for a while
      // the plan's candidates share most of their line: a sample already placed (same 5 m spot, same heading) is reused
      const mk = `${Math.round(lat[i] * 2e4)},${Math.round(lon[i] * 2e4)},${Math.round(h * 4)}`;
      const memo = v.scoreMemo || (v.scoreMemo = new Map());
      let e = memo.has(mk) ? memo.get(mk) : -2;
      if (e === -2) {
        e = -1;
        if (last >= 0 && ok(last)) e = last;
        else if (last >= 0 && v.to[last] >= 0) for (let x = v.first[v.to[last]]; x < v.first[v.to[last] + 1] && e < 0; x++) if (v.to[x] >= 0 && ok(x)) e = x;
        if (e < 0) { const s = snap(v, lat[i], lon[i], ok, 20); e = s.length ? s[0].edge : -1; }
        if (memo.size > 300000) memo.clear();
        memo.set(mk, e);
      }
      if (e < 0) continue;
      last = e;
      if (v.quality[e] !== UNKNOWN_U8) { out.quality[i] = v.quality[e] / 254; out.conf[i] = v.conf[e] / 255; }
      if (v.scenery[e] !== UNKNOWN_U8) out.scenery[i] = v.scenery[e] / 254;
      if (v.speed[e]) { if (v.flags[e] & B.speedEst) out.limitEst[i] = v.speed[e]; else out.limit[i] = v.speed[e]; }
      out.cls[i] = v.cls[e];
      out.toll[i] = v.flags[e] & B.toll ? 1 : 0; out.bridge[i] = v.flags[e] & B.bridge ? 1 : 0; out.tunnel[i] = v.flags[e] & B.tunnel ? 1 : 0;
      out.signals[i] = v.nflags[v.to[e]] & v.nbits.signal ? 1 : 0;
      for (const k in out.ch) out.ch[k][i] = v.roadCh[k][e];
    }
    return out;
  }

  // ---- members' data on the edges ------------------------------------------------------------------------------------
  /**
   * Members' road data (crowd.js: /api/roads by 0.1° cells, VI-1) laid on our edges. The tiles hold no OSM way ids, so
   * each way's line is walked every 10 m in its measured direction (dir 0 along the line, 1 against it) and each point
   * lands on the nearest edge within 15 m heading the same way (within 50°). Bins are 5 m along the line, as the server
   * keeps them. An edge counts as measured where 40 % of it (or 150 m) was matched; its values are the matched points'
   * means. items: [{ line: [[lat, lon]], dir, i: [bins], rough: [g], cam: [deg], flow: [0..1], loved }].
   */
  function crowdOnto(v, items) {
    const E = v.E, n = new Float32Array(E), sum = { rough: new Float32Array(E), cam: new Float32Array(E), flow: new Float32Array(E) }, cnt = { rough: new Uint16Array(E), cam: new Uint16Array(E), flow: new Uint16Array(E) };
    const loved = new Float32Array(E).fill(NaN);
    let any = false;
    for (const it of items || []) {
      const L = it && it.line;
      if (!Array.isArray(L) || L.length < 2) continue;
      const bins = new Map((it.i || []).map((b, j) => [b, j]));
      const cum = [0];
      for (let k = 1; k < L.length; k++) cum.push(cum[k - 1] + distM(L[k - 1][0], L[k - 1][1], L[k][0], L[k][1]));
      const total = cum[cum.length - 1];
      let seg = 0;
      for (let off = 5; off < total; off += 10) {
        while (seg < L.length - 2 && cum[seg + 1] < off) seg++;
        const u = cum[seg + 1] > cum[seg] ? (off - cum[seg]) / (cum[seg + 1] - cum[seg]) : 0;
        const la = L[seg][0] + u * (L[seg + 1][0] - L[seg][0]), lo = L[seg][1] + u * (L[seg + 1][1] - L[seg][1]);
        let h = bearing(L[seg][0], L[seg][1], L[seg + 1][0], L[seg + 1][1]);
        if (it.dir === 1) h += Math.PI;
        const s = snap(v, la, lo, (e) => {
          const g = geom(v, e), pr = project(v, e, la, lo), m = g.length / 2;
          // the heading of the edge's segment nearest the point
          let best = 0, bd = Infinity;
          for (let q = 0; q < m - 1; q++) { const d = distM(la, lo, (g[2 * q] + g[2 * q + 2]) / 2, (g[2 * q + 1] + g[2 * q + 3]) / 2); if (d < bd) { bd = d; best = q; } }
          return pr.d <= 15 && Math.abs(turnAngle(h, bearing(g[2 * best], g[2 * best + 1], g[2 * best + 2], g[2 * best + 3]))) < 0.87;
        }, 15);
        if (!s.length) continue;
        const e = s[0].edge;
        n[e] += 10;
        const j = bins.get(Math.floor(off / 5));
        if (j != null) for (const k of ['rough', 'cam', 'flow']) { const x = it[k] && it[k][j]; if (Number.isFinite(x)) { sum[k][e] += x; cnt[k][e]++; } }
        if (Number.isFinite(it.loved)) loved[e] = Number.isFinite(loved[e]) ? Math.max(loved[e], it.loved) : it.loved;
      }
    }
    const has = new Uint8Array(E), rough = new Float32Array(E).fill(NaN), bank = new Float32Array(E).fill(NaN), flow = new Float32Array(E).fill(NaN);
    for (let e = 0; e < E; e++) {
      if (!(n[e] >= Math.min(150, 0.4 * v.len[e]))) { loved[e] = NaN; continue; }
      if (cnt.rough[e]) rough[e] = sum.rough[e] / cnt.rough[e];
      if (cnt.cam[e]) bank[e] = sum.cam[e] / cnt.cam[e];
      if (cnt.flow[e]) flow[e] = sum.flow[e] / cnt.flow[e];
      if (Number.isFinite(rough[e]) || Number.isFinite(bank[e]) || Number.isFinite(flow[e]) || Number.isFinite(loved[e])) { has[e] = 1; any = true; }
    }
    return any ? { has, rough, bank, flow, loved, edges: has.reduce((a, b) => a + b, 0) } : null;
  }

  // ---- the objective ---------------------------------------------------------------------------------------------------
  /**
   * Per-edge goodness 0..1 (quality, gated fun and scenery blended with the driver's taste; unknown pulled to UNKNOWN_G by
   * how little was known) as `bad` = 1 − goodness, and the avoid/flag multiplier `mult` (≥ 1) and adder `add` (seconds).
   * prefs: { tight, fast } (−1..1, the corner prefs), taste: { quality, fun, scenery } weights; avoid: the Plan sheet's.
   */
  /** Per edge, the built evidence two of the tiles' road channels agree on (route_engine.js builtEvidence's readings). */
  const BUILT_READ = [['density', (x) => clamp01((x - 2) / 5)], ['sidewalk', (x) => (x >= 0.5 ? 1 : 0)], ['business_per_km', (x) => clamp01(x / 8)],
    ['bldg_per_km', (x) => clamp01(x / 50)], ['addr_per_km', (x) => clamp01(x / 50)]];
  function builtAgreeOf(v) {
    const F = FunRoute(), ch = v.roadCh || {}, rd = BUILT_READ.filter(([k]) => ch[k]).map(([k, fn]) => [ch[k], fn]);
    if (!F || !F.builtAgree || rd.length < 2) return null;
    const dens = ch.density || null, cls = v.cls || null, xs = new Array(rd.length + 1);
    return (e) => {
      for (let k = 0; k < rd.length; k++) { const x = rd[k][0][e]; xs[k] = Number.isFinite(x) ? rd[k][1](x) : NaN; }
      // the class: a residential or service road is built (0.8), but a "residential" county road in open country isn't
      xs[rd.length] = !cls ? NaN : cls[e] >= 6 ? (cls[e] === 6 && dens && dens[e] <= 2 ? 0 : 0.8) : 0;
      return F.builtAgree(xs);
    };
  }
  // the per-edge arrays are a pass over every edge in the view (400k+ with the preloaded area): kept per view for the
  // same driver choices, and rebuilt only when members' data is on the edges (that differs per plan)
  function objective(v, o = {}) {
    if (v.crowd) return objectiveOf(v, o);
    // (and the weights it reads from K: a tune, Route tuning's or the Dev panel's, changes them for its plan only, and the
    // view is kept for the next plan, so an objective made under one tune must not be served to a plan under another)
    const key = JSON.stringify([o.prefs || null, o.taste || null, o.avoid || null, o.crowdWeights || null, o.nodeCosts !== false, OBJ_KNOBS.map((k) => K[k])]);
    if (!v.objCache) v.objCache = new Map();
    if (!v.objCache.has(key)) { if (v.objCache.size > 8) v.objCache.clear(); v.objCache.set(key, objectiveOf(v, o)); }
    return v.objCache.get(key);
  }
  const OBJ_KNOBS = ['W_NOTPOOR', 'W_QUALITY', 'W_FUN', 'W_SCENERY', 'POOR_LO', 'POOR_HI', 'GATE_LO', 'GATE_HI', 'UNKNOWN_G', 'MODEL_WQ', 'MODEL_WS', 'PRIVATE_X', 'PRIVATE_S',
    'DESTINATION_X', 'DESTINATION_S', 'FERRY_X', 'UNPAVED_X', 'AVOID_HWY_X', 'AVOID_TOLL_X', 'AVOID_FERRY_X', 'AVOID_UNPAVED_X'];
  function objectiveOf(v, o = {}) {
    const prefs = o.prefs || {}, taste = o.taste || {}, avoid = o.avoid || {}, B = flagBits();
    const corner = 1 + 0.25 * ((Number(prefs.tight) || 0) + (Number(prefs.fast) || 0));
    const tq = Number.isFinite(taste.quality) ? taste.quality / (K.W_NOTPOOR + K.W_QUALITY) : 1;
    const wp = K.W_NOTPOOR * tq, wq = K.W_QUALITY * tq;
    const wf = (Number.isFinite(taste.fun) ? taste.fun : K.W_FUN) * Math.max(0.3, corner);
    const ws = Number.isFinite(taste.scenery) ? taste.scenery : K.W_SCENERY;
    const crowd = v.crowd || null, CW = (o.crowdWeights) || K.CROWD_W;
    const E = v.E, bad = new Float32Array(E), mult = new Float32Array(E), add = new Float32Array(E);
    // corners between houses (fun_route.js builtKeep, as the route engine): the tiles' fun was baked with the quality gate
    // only, so the built-up cut is applied here from the v2 tiles' road channels, read as route_engine.js builtEvidence
    // reads them (density, sidewalk, businesses, buildings, addresses: two agreeing)
    const builtAt = builtAgreeOf(v), F = FunRoute();
    let minBad = 1;
    for (let e = 0; e < E; e++) {
      // unknown (255, 65535) is unknown: its weight drops out; nothing known at all is UNKNOWN_G
      const qk = v.quality[e] !== UNKNOWN_U8, sk = v.scenery[e] !== UNKNOWN_U8, fk = Number.isFinite(v.fun[e]);
      let q = qk ? v.quality[e] / 254 : K.UNKNOWN_G, s = sk ? v.scenery[e] / 254 : 0, cf = qk ? v.conf[e] / 255 : 0;
      // members' measurements on this edge: smooth and flowing raise its quality, loved and banked its scenery
      if (crowd && crowd.has[e]) {
        const c = crowd, kq = cf * K.MODEL_WQ, ks = (sk ? cf : 0) * K.MODEL_WS;
        let nq = q * kq, dq = kq, ns = s * ks, ds = ks;
        if (Number.isFinite(c.rough[e])) { nq += CW.rough * clamp01((0.38 - c.rough[e]) / 0.33); dq += CW.rough; }
        if (Number.isFinite(c.flow[e])) { nq += CW.flow * clamp01(c.flow[e]); dq += CW.flow; }
        if (Number.isFinite(c.loved[e])) { ns += CW.loved * clamp01(c.loved[e]); ds += CW.loved; }
        if (Number.isFinite(c.bank[e])) { const b = c.bank[e]; ns += CW.bank * (b <= 0 ? clamp01((b + 3) / 3) * 0.5 : 0.5 + 0.5 * clamp01(b / 4)); ds += CW.bank; }
        if (dq > kq) { q = nq / dq; cf = Math.max(cf, dq > 0 ? (kq + (dq - kq)) / (K.MODEL_WQ + (dq - kq)) : cf); }
        if (ds > ks && ds > 0) s = ns / ds;
      }
      const gate = clamp01((q - K.GATE_LO) / (K.GATE_HI - K.GATE_LO));
      const notPoor = clamp01((q - K.POOR_LO) / (K.POOR_HI - K.POOR_LO));
      // fun is already gated by quality in the tiles (corners only count on good road); per km against the network's own
      const keep = builtAt && F && F.builtKeep ? F.builtKeep(builtAt(e)) : 1;
      const f = fk ? Math.min(1, v.fun[e] * keep / Math.max(0.05, v.len[e] / 1000) / v.funFull) : 0;
      const w = wp + wq + (fk ? wf : 0) + (sk ? ws : 0);
      const raw = (wp * notPoor + wq * q + (fk ? wf * f : 0) + (sk ? ws * s * (0.5 + 0.5 * gate) : 0)) / Math.max(1e-6, w);
      const g = cf * raw + (1 - cf) * K.UNKNOWN_G;
      bad[e] = 1 - g;
      if (bad[e] < minBad) minBad = bad[e];
      const fl = v.flags[e];
      let m = 1, ad = 0;
      if (fl & (B.private | B.barrier)) { m *= K.PRIVATE_X; ad += K.PRIVATE_S; }
      else if (fl & B.destination) { m *= K.DESTINATION_X; ad += K.DESTINATION_S; }
      if ((fl & B.ferry) || v.cls[e] === CLS.ferry) m *= avoid.ferries ? K.AVOID_FERRY_X : K.FERRY_X;
      if (fl & B.unpaved) m *= avoid.unpaved ? K.AVOID_UNPAVED_X : K.UNPAVED_X;
      if (avoid.highways && ((fl & B.motorway) || v.cls[e] === CLS.motorway)) m *= K.AVOID_HWY_X;
      if (avoid.tolls && (fl & B.toll)) m *= K.AVOID_TOLL_X;
      mult[e] = m; add[e] = ad;
    }
    return { bad, mult, add, minBad, nodeCosts: o.nodeCosts !== false };
  }

  // ---- the search ------------------------------------------------------------------------------------------------------
  function scratch(v) {
    if (v.scratch) return v.scratch;
    v.scratch = { stamp: new Uint32Array(v.E), g: new Float64Array(v.E), pred: new Int32Array(v.E), hs: new Uint32Array(v.N), h: new Float64Array(v.N), qid: 0,
      hk: new Float64Array(1024), hv: new Int32Array(1024), hn: 0 };
    return v.scratch;
  }
  /** Seconds a turn from edge p onto edge e costs at their node (time, not scaled); Infinity when it isn't allowed. */
  function turnCost(v, p, e, obj) {
    const B = v.bits, node = v.to[p];
    if (v.to[e] === v.tail[p] && v.to[e] !== node) {                       // straight back the way you came
      if (!v.deadEnd[node]) return Infinity;
      return K.UTURN_S;
    }
    headings(v, p); headings(v, e);
    const d = turnAngle(v.hOut[p], v.hIn[e]), ad = Math.abs(d);
    // a junction: more than one way on (a node that only splits an edge, a tile edge or a name change, is no junction)
    let ways = 0;
    for (let x = v.first[node]; x < v.first[node + 1]; x++) if (v.to[x] >= 0 && v.to[x] !== v.tail[p]) ways++;
    let c = 0;
    if (ways >= 2 || ad > 1.2) {
      if (ad > 2.9) c = K.UTURN_S;
      else if (ad > K.STRAIGHT_RAD) c = d > 0 ? K.TURN_RIGHT_S + K.TURN_RIGHT_K * Math.min(2, ad / (Math.PI / 2)) : K.TURN_LEFT_S + K.TURN_LEFT_K * Math.min(2, ad / (Math.PI / 2));
    }
    if (obj.nodeCosts) c += nodeCost(v, node);
    return c;
  }
  /** Seconds passing node n costs for what's on it (signal, stop, give way, level crossing, calming, a barrier). */
  function nodeCost(v, n) {
    const f = v.nflags[n];
    if (!f) return 0;
    const N = v.nbits;
    let c = f & N.signal ? K.SIGNAL_S : f & N.stop ? K.STOP_S : f & N.giveWay ? K.GIVE_WAY_S : 0;
    if (f & N.levelCrossing) c += K.LEVEL_CROSSING_S;
    if (f & N.calming) c += K.CALMING_S;
    if (f & N.crossing) c += K.CROSSING_S;
    if (f & N.barrier) c += K.BARRIER_S;
    return c;
  }
  /** The seconds of a node's signal, stop sign or give way alone (what STOP_AVOID_X weighs in the search). */
  function stopCost(v, n) {
    const f = v.nflags[n];
    if (!f) return 0;
    const N = v.nbits;
    return f & N.signal ? K.SIGNAL_S : f & N.stop ? K.STOP_S : f & N.giveWay ? K.GIVE_WAY_S : 0;
  }
  function allowed(v, p, e, back) {
    // a via-way rule: the edges driven so far (back(k): the edge before k on the best way here) end with its from-and-via
    // sequence; then only its to-edge (only_*), or anything but it (no_*)
    if (back && v.hasVia && v.hasVia[p]) {
      for (const r of v.restrVia.get(p)) {
        let k = p, match = true;
        for (let i = r.seq.length - 2; i >= 0 && match; i--) { k = back(k); match = k === r.seq[i]; }
        if (match && (r.only ? e !== r.to : e === r.to)) return false;
      }
    }
    if (!v.hasRestr[p]) return true;
    const r = v.restr.get(p);
    if (!r) return true;
    if (r.only.length) return r.only.includes(e);
    return !r.no.includes(e);
  }
  /**
   * Edge-based A*. src/dst: snaps ([{ edge, frac }]). a: the goodness weight (0: time only). penal: optional Float32Array of
   * extra cost factors per edge (alternates, loops). opts.ban: a Uint8Array, edges never driven (Fun's highways);
   * opts.hwyX: { is, x }, edges with is[e] cost x times more (the highway exception). Returns { edges, fs, ft, cost,
   * settled } or null.
   */
  function search(v, obj, src, dst, a = 0, penal = null, opts = {}) {
    const S = scratch(v), qid = ++S.qid;
    if (qid === 0xffffffff) { S.stamp.fill(0); S.hs.fill(0); S.qid = 1; }
    const { stamp, g, pred, hs, h } = S;
    const { bad, mult, add, minBad } = obj;
    const tgt = dst[0];
    const hMul = Math.exp(a * minBad) / v.vmax * 0.995;
    const H = (n) => { if (hs[n] !== S.qid) { hs[n] = S.qid; h[n] = distM(v.lat[n], v.lon[n], tgt.lat, tgt.lon) * hMul; } return h[n]; };
    const ban = opts.ban || null, hx = opts.hwyX || null, stopX = Math.max(-1, (Number.isFinite(K.STOP_AVOID_X) ? K.STOP_AVOID_X : 1) - 1);
    const base = hx ? (e) => (v.time[e] * Math.exp(a * bad[e]) * mult[e] + add[e]) * (penal ? penal[e] : 1) * (hx.is[e] ? hx.x : 1)
      : (e) => (v.time[e] * Math.exp(a * bad[e]) * mult[e] + add[e]) * (penal ? penal[e] : 1);
    const dstMap = new Map();
    for (const d of dst) if (!dstMap.has(d.edge) || dstMap.get(d.edge) > d.frac) dstMap.set(d.edge, d.frac);
    // heap
    S.hn = 0;
    const push = (k, e) => {
      if (S.hn >= S.hk.length) { const nk = new Float64Array(S.hk.length * 2); nk.set(S.hk); S.hk = nk; const nv = new Int32Array(S.hv.length * 2); nv.set(S.hv); S.hv = nv; }
      const hk = S.hk, hv = S.hv;
      let i = S.hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] < k || (hk[p] === k && hv[p] <= e)) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = k; hv[i] = e;
    };
    const pop = () => {
      const hk = S.hk, hv = S.hv, e = hv[0], k = hk[0], lk = hk[--S.hn], le = hv[S.hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= S.hn) break;
        if (c + 1 < S.hn && (hk[c + 1] < hk[c] || (hk[c + 1] === hk[c] && hv[c + 1] < hv[c]))) c++;
        if (hk[c] > lk || (hk[c] === lk && hv[c] >= le)) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = lk; hv[i] = le;
      popK = k;
      return e;
    };
    let popK = 0, bestGoal = Infinity, bestEdge = -1, bestPred = -1, direct = null;
    for (const s of src) {
      if (ban && ban[s.edge]) continue;
      const e = s.edge, x = (1 - s.frac) * base(e) + (opts.startCost ? opts.startCost(e) : 0);
      if (stamp[e] !== qid || x < g[e]) { stamp[e] = qid; g[e] = x; pred[e] = -1; if (v.to[e] >= 0) push(x + H(v.to[e]), e); }
      if (dstMap.has(e) && dstMap.get(e) >= s.frac) {
        const c = (dstMap.get(e) - s.frac) * base(e);
        if (c < bestGoal) { bestGoal = c; bestEdge = e; direct = s.frac; }
      }
    }
    let settled = 0;
    const maxSettle = opts.maxSettle || 4e6;
    const back = (k) => (k >= 0 && stamp[k] === qid ? pred[k] : -1);
    // the corridor ellipse (opts.ellipse { a, b, major } in degrees and metres): a node outside it is never entered, so a
    // weak heuristic (a large goodness weight) can't flood the whole loaded network
    const el = opts.ellipse || null, inS = S.inS || (S.inS = new Uint32Array(v.N)), inV = S.inV || (S.inV = new Uint8Array(v.N));
    const bound = el ? (n) => { if (inS[n] !== qid) { inS[n] = qid; inV[n] = distM(v.lat[n], v.lon[n], el.a.lat, el.a.lon) + distM(v.lat[n], v.lon[n], el.b.lat, el.b.lon) <= el.major ? 1 : 0; } return inV[n] === 1; } : null;
    while (S.hn > 0) {
      const p = pop();
      if (popK >= bestGoal) break;
      const gp = g[p], node = v.to[p];
      if (popK - H(node) > gp + 1e-6) continue;                          // stale
      if (++settled > maxSettle) break;
      for (let e = v.first[node]; e < v.first[node + 1]; e++) {
        const head = v.to[e];
        if (head < 0 || (ban && ban[e]) || !allowed(v, p, e, back) || (bound && !bound(head))) continue;
        let tc = turnCost(v, p, e, obj);
        if (tc === Infinity) continue;
        if (stopX !== 0 && obj.nodeCosts) tc += stopX * stopCost(v, node);
        const be = base(e), x = gp + tc + be;
        // the goal is part way along a target edge: reached from p whatever the edge's own best (a start on the same
        // edge, further on, has a lower g for its end but can't reach a point behind it)
        if (dstMap.has(e)) {
          const cand = gp + tc + dstMap.get(e) * be;
          if (cand < bestGoal) { bestGoal = cand; bestEdge = e; bestPred = p; direct = null; }
        }
        if (stamp[e] !== qid || x < g[e] - 1e-9) {
          stamp[e] = qid; g[e] = x; pred[e] = p;
          push(x + H(head), e);
        }
      }
    }
    if (bestEdge < 0) return null;
    if (direct != null) {
      const s = src.find((x) => x.edge === bestEdge && x.frac === direct);
      return { edges: [bestEdge], fs: s.frac, ft: dstMap.get(bestEdge), cost: bestGoal, settled };
    }
    const edges = [bestEdge];
    for (let e = bestPred; e >= 0; e = pred[e]) { edges.push(e); if (edges.length > v.E + 1) return null; }
    edges.reverse();
    const s0 = src.filter((x) => x.edge === edges[0]).reduce((m, x) => (!m || x.frac < m.frac ? x : m), null);
    return { edges, fs: s0 ? s0.frac : 0, ft: dstMap.get(bestEdge), cost: bestGoal, settled };
  }

  // ---- a found path as a route ------------------------------------------------------------------------------------------
  /** Part of a polyline [lat, lon, ...] between length fractions f0..f1, as [[lat, lon]]. */
  function cut(g, f0, f1) {
    const n = g.length / 2, seg = [];
    let total = 0;
    for (let i = 0; i < n - 1; i++) { const s = distM(g[2 * i], g[2 * i + 1], g[2 * i + 2], g[2 * i + 3]); seg.push(s); total += s; }
    const at = (m) => {
      let run = 0;
      for (let i = 0; i < n - 1; i++) {
        if (run + seg[i] >= m || i === n - 2) { const u = seg[i] > 0 ? clamp01((m - run) / seg[i]) : 0; return [i, [g[2 * i] + u * (g[2 * i + 2] - g[2 * i]), g[2 * i + 1] + u * (g[2 * i + 3] - g[2 * i + 1])]]; }
        run += seg[i];
      }
      return [0, [g[0], g[1]]];
    };
    if (f0 <= 0 && f1 >= 1) { const out = []; for (let i = 0; i < n; i++) out.push([g[2 * i], g[2 * i + 1]]); return out; }
    const [i0, p0] = at(f0 * total), [i1, p1] = at(f1 * total);
    const out = [p0];
    for (let i = i0 + 1; i <= i1; i++) out.push([g[2 * i], g[2 * i + 1]]);
    out.push(p1);
    return out;
  }
  // Valhalla maneuver types (web/directions.js VERB), so the planner's spoken directions read ours as they read the router's
  function maneuverType(d, fromRamp, toRamp, fromMotorway, toMotorway) {
    const ad = Math.abs(d), right = d > 0;
    if (toRamp && !fromRamp) return fromMotorway ? (right ? 20 : 21) : ad < K.STRAIGHT_RAD ? 17 : right ? 18 : 19;
    if (fromRamp && toMotorway) return 25;
    if (ad > 2.9) return 13;
    if (ad < K.STRAIGHT_RAD) return 8;
    if (ad < 0.8) return right ? 9 : 16;
    if (ad < 2.2) return right ? 10 : 15;
    return right ? 11 : 14;
  }
  /**
   * The route of a search result: coords [[lat, lon]] along the edges' geometry, edge ids, time (edge times by the share
   * driven plus the turn, signal and stop seconds), distance, names per stretch, the why inputs, and `route` in the shape of
   * cockpit.js routeOf (coords [[lon, lat]], turns, times, steps, names Map, has, timeS) with offline maneuvers as steps.
   */
  function assemble(v, res, obj, meta = {}) {
    const B = flagBits(), coords = [], names = [], steps = [], turns = [], times = [];
    let lineM = 0;
    const gEnd = [], gEdge = [];
    let timeS = 0, distM_ = 0, q = 0, s = 0, sw = 0, f = 0, cf = 0, wsum = 0, junctions = 0, signals = 0, hwyM = 0, gm = 0, poorM = 0, goodM = 0;
    const hwyBy = new Map();                                            // metres per highway name (the card's "Uses 0.4 mi of I-275")
    const has = { highways: false, tolls: false, ferries: false, unpaved: false };
    let roundabout = null;
    const E = res.edges;
    for (let k = 0; k < E.length; k++) {
      const e = E[k], f0 = k === 0 ? res.fs : 0, f1 = k === E.length - 1 ? res.ft : 1, share = Math.max(0, f1 - f0);
      if (k > 0) {
        const p = E[k - 1], tc = turnCost(v, p, e, obj);
        if (Number.isFinite(tc)) timeS += tc;
        const node = v.to[p];
        headings(v, p); headings(v, e);
        const d = turnAngle(v.hOut[p], v.hIn[e]);
        let ways = 0;
        for (let x = v.first[node]; x < v.first[node + 1]; x++) if (v.to[x] >= 0 && v.to[x] !== v.tail[p]) ways++;
        const fl = v.flags[p];
        if (v.nflags[node] & v.nbits.signal) signals++;
        const n0 = nameOf(v, p), n1 = nameOf(v, e);
        const inR = !!(v.flags[e] & B.roundabout), wasR = !!(v.flags[p] & B.roundabout);
        if (ways >= 2) junctions++;
        if (inR && !wasR) roundabout = { lat: v.lat[node], lon: v.lon[node], exits: 0, at: steps.length };
        else if (inR && wasR && ways >= 2) { if (roundabout) roundabout.exits++; }
        else if (!inR && wasR && roundabout) {
          roundabout.exits++;
          steps.push({ lon: roundabout.lon, lat: roundabout.lat, type: 26, street: n1, exits: roundabout.exits });
          times.push([roundabout.lon, roundabout.lat, Math.round(timeS)]);
          roundabout = null;
        } else if (!inR && (ways >= 2 && Math.abs(d) > K.STRAIGHT_RAD || (n1 && n0 !== n1 && ways >= 2))) {
          const type = maneuverType(d, !!(fl & B.ramp), !!(v.flags[e] & B.ramp), v.cls[p] === CLS.motorway, v.cls[e] === CLS.motorway);
          steps.push({ lon: v.lon[node], lat: v.lat[node], type, street: n1 });
          times.push([v.lon[node], v.lat[node], Math.round(timeS)]);
          if (Math.abs(d) > 0.5) turns.push([v.lon[node], v.lat[node]]);
        }
      }
      const pts = cut(geom(v, e), f0, f1);
      for (let i = coords.length ? 1 : 0; i < pts.length; i++) { if (coords.length) lineM += distM(coords[coords.length - 1][0], coords[coords.length - 1][1], pts[i][0], pts[i][1]); coords.push(pts[i]); }
      // the tiles' own scores per edge, by where each ends along the line (route_ctx/graph.js reads them on the page)
      gEnd.push(lineM); gEdge.push(e);
      const m = v.len[e] * share, sec = v.time[e] * share;
      // the first and last edge: their share of the time
      if (k === 0) times.push([pts[0][1], pts[0][0], 0]);
      timeS += sec; distM_ += m;
      const cw = (v.conf[e] / 255) * m;
      if (v.quality[e] !== UNKNOWN_U8) {
        const qe = v.quality[e] / 254;
        q += qe * cw; cf += cw;
        poorM += clamp01((K.POOR_HI - qe) / (K.POOR_HI - K.POOR_LO)) * m;
        if (v.cls[e] !== CLS.motorway && !(v.flags[e] & B.ramp)) goodM += clamp01((qe - K.ROAD.goodLo) / (K.ROAD.goodHi - K.ROAD.goodLo)) * m;
      }
      if (v.scenery[e] !== UNKNOWN_U8) { s += (v.scenery[e] / 254) * m; sw += m; }
      if (Number.isFinite(v.fun[e])) f += v.fun[e] * share;
      if (obj && obj.bad) gm += (1 - obj.bad[e]) * m;
      wsum += m;
      const nm = nameOf(v, e), last = names[names.length - 1];
      if (last && last.name === nm) last.toM = distM_; else names.push({ name: nm, fromM: distM_ - m, toM: distM_ });
      const fl = v.flags[e];
      if (fl & B.motorway || v.cls[e] === CLS.motorway) has.highways = true;
      // (named by the highway itself, not its ramps: a ramp's metres count a thousandth, so they only name an all-ramp link)
      if (isHwyEdge(v, e)) { hwyM += m; const hn = nm || 'the highway'; hwyBy.set(hn, (hwyBy.get(hn) || 0) + (fl & B.ramp ? m / 1000 : m)); }
      if (fl & B.toll) has.tolls = true;
      if (fl & B.ferry) has.ferries = true;
      if (fl & B.unpaved) has.unpaved = true;
    }
    const end = coords[coords.length - 1];
    if (coords.length) {
      steps.unshift({ lon: coords[0][1], lat: coords[0][0], type: 1, street: names[0] ? names[0].name : null });
      steps.push({ lon: end[1], lat: end[0], type: 4, street: null });
      times.push([end[1], end[0], Math.round(timeS)]);
    }
    const nameKm = new Map();
    for (const n of names) if (n.name) nameKm.set(n.name, (nameKm.get(n.name) || 0) + (n.toM - n.fromM) / 1000);   // km, as routeOf has them (Valhalla lengths)
    const why = { source: 'own', level: meta.level || null, role: meta.role || null, a: meta.a != null ? meta.a : 0,
      quality: cf > 0 ? q / cf : null, scenery: sw > 0 ? s / sw : null, fun: f, conf: wsum > 0 ? cf / wsum : 0, goodness: wsum > 0 ? gm / wsum : null, poorKm: poorM / 1000, goodKm: goodM / 1000, junctions, signals,
      objective: meta.a ? 't*(1+a*(1-goodness))' : 'time', hwyKm: hwyM / 1000 };
    // motorway, trunk and their links driven (km) and the one most of it is on, by name (NO_HWY levels report it)
    const hwyName = hwyM > 0 ? [...hwyBy].sort((x, y) => y[1] - x[1])[0][0] : null;
    return {
      coords, edges: E.map((e) => edgeId(v, e)), edgeIdx: Int32Array.from(E), fs: res.fs, ft: res.ft, timeS, distM: distM_, names, why, hwyKm: hwyM / 1000,
      route: { coords: coords.map(([la, lo]) => [lo, la]), turns, times, steps, names: nameKm, has, timeS, source: 'own', graph: edgeTable(v, gEdge, gEnd), hwyKm: hwyM / 1000, hwyName },
    };
  }

  /** The scores route_ctx/graph.js lays on a corridor, per edge of a route (Float32Arrays; `end` metres along its line). */
  function edgeTable(v, edges, ends) {
    const n = edges.length, B = v.bits, f = () => new Float32Array(n).fill(NaN);
    const t = { end: Float32Array.from(ends), quality: f(), scenery: f(), conf: f(), limit: f(), limitEst: f(), cls: f(), toll: f(), bridge: f(), tunnel: f(), signals: f(), ch: {} };
    for (const k in v.roadCh || {}) t.ch[k] = f();
    edges.forEach((e, i) => {
      if (v.quality[e] !== UNKNOWN_U8) { t.quality[i] = v.quality[e] / 254; t.conf[i] = v.conf[e] / 255; }
      if (v.scenery[e] !== UNKNOWN_U8) t.scenery[i] = v.scenery[e] / 254;
      if (v.speed[e]) { if (v.flags[e] & B.speedEst) t.limitEst[i] = v.speed[e]; else t.limit[i] = v.speed[e]; }
      t.cls[i] = v.cls[e]; t.toll[i] = v.flags[e] & B.toll ? 1 : 0; t.bridge[i] = v.flags[e] & B.bridge ? 1 : 0; t.tunnel[i] = v.flags[e] & B.tunnel ? 1 : 0;
      t.signals[i] = v.to[e] >= 0 && (v.nflags[v.to[e]] & v.nbits.signal) ? 1 : 0;
      for (const k in t.ch) t.ch[k][i] = v.roadCh[k][e];
    });
    return t;
  }
  /** Per sample (metres along the line) from an edge table: the scoreLine shape, without the worker. */
  function fromTable(t, distM) {
    const n = distM.length, out = { ch: {} }, keys = ['quality', 'scenery', 'conf', 'limit', 'limitEst', 'cls', 'toll', 'bridge', 'tunnel', 'signals'];
    for (const k of keys) out[k] = new Float32Array(n).fill(NaN);
    for (const k in t.ch) out.ch[k] = new Float32Array(n).fill(NaN);
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < t.end.length - 1 && t.end[j] < distM[i]) j++;
      for (const k of keys) out[k][i] = t[k][j];
      for (const k in t.ch) out.ch[k][i] = t.ch[k][j];
    }
    return out;
  }
  /** Share of route b's length on edges route a also uses (0: nothing shared, 1: all of it). */
  function overlap(v, a, b) {
    const set = new Set(a.edgeIdx);
    let shared = 0, total = 0;
    for (const e of b.edgeIdx) { total += v.len[e]; if (set.has(e)) shared += v.len[e]; }
    return total > 0 ? shared / total : 1;
  }
  const sameRoute = (a, b) => a.edgeIdx.length === b.edgeIdx.length && a.edgeIdx.every((e, i) => e === b.edgeIdx[i]);

  // ---- the corridor's tiles -------------------------------------------------------------------------------------------
  /**
   * Tiles under the corridor ellipse (foci at start and end) the level's budget can reach: the sum of the distances to
   * both ends at most crow × (1 + budget) × ROAD + 4 km (a road is about 1.25-1.4 × the crow line; the slack lets a short
   * trip reach a good road). A loop: the circle its length can reach.
   */
  /** The corridor ellipse a level's budget can reach (as tilesFor sizes it): foci at the ends, the sum of distances. */
  function ellipseFor(from, to, level = 'fun') {
    const L = levels()[level] || levels().fun, crow = distM(from.lat, from.lon, to.lat, to.lon);
    return { a: from, b: to, major: Math.max(crow * (1 + Math.max(0.1, L.budget)) * 1.3 + 4000, crow + 6000) };
  }
  function tilesFor(from, to, level = 'fun', o = {}) {
    const L = levels()[level] || levels().fun;
    const crow = distM(from.lat, from.lon, to.lat, to.lon);
    const major = o.majorM || Math.max(crow * (1 + Math.max(0.1, L.budget)) * 1.3 + 4000, crow + 6000);   // (Quick's 0 budget: the quickest's own corridor)
    const pad = (major - crow) / 2 + 1000;
    const midLat = (from.lat + to.lat) / 2, dLat = pad / 110540, dLon = pad / (111320 * Math.cos(midLat * RAD));
    const s = Math.min(from.lat, to.lat) - dLat, n = Math.max(from.lat, to.lat) + dLat, w = Math.min(from.lon, to.lon) - dLon, e = Math.max(from.lon, to.lon) + dLon;
    const out = [];
    const sw = tileOf(s, w), ne = tileOf(n, e), ci = tileOf(from.lat, from.lon), cj = tileOf(to.lat, to.lon);
    for (let i = sw.i; i <= ne.i; i++) {
      for (let j = sw.j; j <= ne.j; j++) {
        // the tile's nearest point to the ellipse: sample its rectangle 6 × 6 (tiles are 25 km; the ellipse is wider);
        // tile (i, j) spans longitude i × 0.25 − 180 and latitude j × 0.25 − 90
        let hit = false;
        for (let a = 0; a <= 5 && !hit; a++) for (let b = 0; b <= 5 && !hit; b++) {
          const la = Math.min(n, Math.max(s, (j + a / 5) * TILE_DEG - 90)), lo = Math.min(e, Math.max(w, (i + b / 5) * TILE_DEG - 180));
          if (distM(la, lo, from.lat, from.lon) + distM(la, lo, to.lat, to.lon) <= major + 2000) hit = true;
        }
        if (hit || (i === ci.i && j === ci.j) || (i === cj.i && j === cj.j)) out.push({ i, j });
      }
    }
    return out;
  }
  /** The tiles under the straight line from a to b (sampled every 2 km), the ends' first. */
  function lineTiles(a, b) {
    const n = Math.max(1, Math.ceil(distM(a.lat, a.lon, b.lat, b.lon) / 2000)), out = [], seen = new Set();
    const add = (la, lo) => { const t = tileOf(la, lo), k = keyOf(t.i, t.j); if (!seen.has(k)) { seen.add(k); out.push(t); } };
    add(a.lat, a.lon); add(b.lat, b.lon);
    for (let k = 1; k < n; k++) add(a.lat + (b.lat - a.lat) * k / n, a.lon + (b.lon - a.lon) * k / n);
    return out;
  }
  function loopTiles(start, km) {
    const r = Math.max(3000, km * 1000 / (2 * Math.PI) * 2 + 2000);
    const p = (b) => ({ lat: start.lat + r * Math.cos(b) / 110540, lon: start.lon + r * Math.sin(b) / (111320 * Math.cos(start.lat * RAD)) });
    return tilesFor(p(-Math.PI / 4), p(3 * Math.PI / 4), 'quick', { majorM: 2 * r * 1.5 });
  }

  // ---- highways (NO_HWY levels) ---------------------------------------------------------------------------------------
  /** A motorway, trunk or one of their links (the tiles give a link its road's class; the ETL's motorway flag too), or an
   *  expressway of a lower class (`motorroad=yes` / `expressway=yes`: the tiles' expressway flag, in builds from 2026-11-09). */
  function isHwyEdge(v, e) { const B = v.bits || flagBits(); return v.cls[e] <= CLS.trunk || !!(v.flags[e] & (B.motorway | B.expressway)); }
  /** Per edge, 1 on a highway (kept per view). */
  function hwyOf(v) {
    if (v.isHwy) return v.isHwy;
    const h = new Uint8Array(v.E);
    for (let e = 0; e < v.E; e++) if (isHwyEdge(v, e)) h[e] = 1;
    v.isHwy = h;
    return h;
  }
  const noHighway = (level) => !!K.NO_HWY[level];
  /**
   * A snap for a level that never drives a highway: the nearest road when it isn't one; else the nearest other road within
   * HWY_SNAP_M (a house beside the interstate is reached by its own street). A moving car (a heading) within HWY_ON_M of
   * the highway is on it: that snap stays (the route then leaves it by the shortest way: the exception).
   */
  function snapOff(v, p, s, heading = null) {
    if (!s.length) return s;
    const is = hwyOf(v);
    if (!is[s[0].edge]) return s;
    if (Number.isFinite(heading) && s[0].d <= K.HWY_ON_M) return s;
    const f = snap(v, p.lat, p.lon, (e) => !is[e], Math.max(K.HWY_SNAP_M, s[0].d * 3 + 50));
    return f.length ? f : s;
  }
  /**
   * The quickest way that never drives a highway (search opts with `ban`), else, where none exists in the corridor, the one
   * with the least highway (each highway second x HWY_LINK_X: `hwyX`). { r, mode: 'free' | 'link', src, dst, xo } (xo: the
   * opts every later search of this plan adds), or null when there is no way at all.
   */
  function freeQuickest(v, obj, req, src, dst, opts) {
    const is = hwyOf(v), h = req.from.heading != null ? req.from.heading : req.heading;
    const fs = snapOff(v, req.from, src, h), ft = snapOff(v, req.to, dst);
    const xf = { ban: is };
    const r = search(v, obj, fs, ft, 0, null, { ...opts, ...xf });
    if (r) return { r, mode: 'free', src: fs, dst: ft, xo: xf };
    const xl = { hwyX: { is, x: K.HWY_LINK_X } };
    const l = search(v, obj, src, dst, 0, null, { ...opts, ...xl });
    return l ? { r: l, mode: 'link', src, dst, xo: xl } : null;
  }
  /** Why a route with the exception drives a highway: it starts on one, ends on one, or there is no other way across. */
  function hwyReason(v, r) {
    const E = r.edgeIdx;
    if (!E || !E.length || !(r.hwyKm > 0)) return null;
    return isHwyEdge(v, E[0]) ? 'start' : isHwyEdge(v, E[E.length - 1]) ? 'end' : 'across';
  }

  // ---- plans -----------------------------------------------------------------------------------------------------------
  function snapBoth(v, from, to) {
    const src = snap(v, from.lat, from.lon), dst = snap(v, to.lat, to.lon);
    if (!src.length) throw new Error('no road near the start');
    if (!dst.length) throw new Error('no road near the end');
    return { src, dst };
  }
  /** A start heading (a moving car): leaving against it costs a minute, so the route leaves the way the car is going. */
  function startCostFor(v, heading) {
    if (!Number.isFinite(heading)) return null;
    const h = heading * RAD;
    return (e) => { headings(v, e); return Math.abs(turnAngle(h, v.hIn[e])) > Math.PI / 2 ? 60 : 0; };
  }
  /**
   * Routes from `from` to `to` at a level: { routes: [best, alternates..., quickest, other steps], quick, limitS, ms }.
   * Quick also bisects (inside its 60 s), so a better road at no real cost is offered; the route engine ranks them.
   * At Fun and Long way (NO_HWY) every route but `quick` keeps off the highways (freeQuickest: the hard filter, or the
   * exception's shortest highway link), and `quick` stays in the pool as the level's measure and Quick's card;
   * `hwy` says which: { mode: 'any' | 'free' | 'link', absurd, quickS, freeS }.
   * req: { from, to, level, prefs, taste, avoid, heading, max }.
   */
  function plan(v, req) { return withTune(req && req.tune, () => planNow(v, req)); }
  function planNow(v, req) {
    const t0 = Date.now(), level = levels()[req.level] ? req.level : 'fun', L = levels()[level];
    const obj = objective(v, req);
    const snaps = snapBoth(v, req.from, req.to);
    let { src, dst } = snaps;
    const sc = startCostFor(v, req.from.heading != null ? req.from.heading : req.heading);
    const opts0 = { ...(sc ? { startCost: sc } : {}), ellipse: ellipseFor(req.from, req.to, level) };
    let opts = opts0;
    const run = (a, penal = null, role = 'step') => { const r = search(v, obj, src, dst, a, penal, opts); return r ? assemble(v, r, obj, { level, role, a }) : null; };
    const free = noHighway(level);
    const memoOf = (kind) => (v.quickMemo && v.quickMemo.key === quickKey(req, level, obj, kind) ? v.quickMemo : null);
    const memo = free ? null : memoOf('any');
    const quick = memo ? assemble(v, memo.r, obj, { level, role: 'quickest', a: 0 }) : run(0, null, 'quickest');
    if (!quick) throw new Error('no route');
    // the level's own quickest: at Fun and Long way the quickest way off the highways (the first route's search when it
    // was the same: quickest() made it), else `quick` itself
    let base = quick, hwy = { mode: 'any', absurd: false, quickS: quick.timeS, freeS: null };
    if (free) {
      const is = hwyOf(v);
      let f = quick.hwyKm > 0 ? (memoOf('free') || {}).f : { r: null, mode: 'free', src, dst, xo: { ban: is } };
      if (!f) f = freeQuickest(v, obj, req, src, dst, opts0);
      if (!f) throw new Error('no route');
      ({ src, dst } = f);
      opts = { ...opts0, ...f.xo };
      base = f.r ? assemble(v, f.r, obj, { level, role: 'quickest', a: 0 }) : quick;
      if (base !== quick) quick.why.role = 'quickest-highway';
      hwy = { mode: f.mode, absurd: f.mode === 'free' && base.timeS > K.HWY_ABSURD * quick.timeS, quickS: quick.timeS, freeS: f.mode === 'free' ? base.timeS : null };
    }
    // the budget over the quickest; never so tight it shuts out the level's own quickest (a highway-free way)
    const limitS = Math.max(quick.timeS * (1 + L.budget) + L.slackS, base === quick ? 0 : base.timeS + K.HWY_FREE_SLACK_S);
    const found = [base];
    const keep = (r) => { if (r && !found.some((x) => sameRoute(x, r))) found.push(r); return r; };
    // bisect the goodness weight (log steps): the largest a whose route is inside the budget
    let lo = 0, hi = typeof K.A_MAX === 'number' ? K.A_MAX : (K.A_MAX[level] || 40), best = base, tries = 0;
    let a = K.A_FIRST[level] || 1, first = null;
    // no highway-free way in a sensible time: that way alone (and the quickest, for Quick's card); nothing longer
    if (hwy.absurd) tries = K.BISECT;
    while (tries < K.BISECT) {
      tries++;
      const r = run(a);
      if (!first) first = r;
      if (r && r.timeS <= limitS) { lo = a; best = r; keep(r); } else hi = a;
      if (hi - lo < 0.15 * Math.max(lo, 0.25)) break;
      a = lo > 0 ? Math.sqrt(lo * hi) : hi / 4;
    }
    // and the cheaper end of the spectrum: the bisection only tries weights from its first one up, so the routes that buy a
    // little good road for a little time were never offered, only the one that spends the whole budget (live 2026-11-04,
    // a cross-suburb trip at Fun: a 9-minute I-275 loop came back and the 7-minute way to the same county road didn't)
    for (const k of K.LOWER) if (lo * k > 0.05) { const r = run(lo * k); if (r && r.timeS <= limitS) keep(r); }
    best.why.role = best === quick ? 'quickest' : best === base ? 'quickest-free' : 'best';
    // alternates by the penalty method: the chosen route's edges cost more, until a route differs by ALT_MIN_DIFF
    const alts = [], chosen = [best];
    const penal = new Float32Array(v.E).fill(1);
    for (const p of hwy.absurd ? [] : K.ALT_PENALTIES) {
      if (alts.length >= K.ALTS) break;
      for (const r of chosen) for (const e of r.edgeIdx) penal[e] = Math.max(penal[e], 1 + p);
      const r = run(lo, penal, 'alternate');
      if (!r) continue;
      // its real time and cost, not the penalised ones
      if (r.timeS > limitS) continue;
      if (chosen.every((c) => 1 - overlap(v, c, r) >= K.ALT_MIN_DIFF)) { alts.push(r); chosen.push(r); }
    }
    // the spread (Fun and Long way): penalty alternates of the first step's route (a moderate weight, the good road near
    // the quickest way), which find the next good road over: the bisection's large weights shun the worst stretches
    // rather than seek the best, so they leave this road unfound (2026-11-08, the levels audit)
    const free2 = free && !hwy.absurd;
    if (free2 && first && first.timeS <= limitS) {
      for (const p of K.SPREAD[level] || []) {
        const pen = new Float32Array(v.E).fill(1);
        for (const e of first.edgeIdx) pen[e] = 1 + p;
        const r = run(first.why.a, pen, 'spread');
        if (r && r.timeS <= limitS) keep(r);
      }
    }
    // the pick at Fun and Long way: the goodness the extra time buys (pick()), not the largest weight inside the budget
    if (free2 && K.BUY[level] != null) {
      const was = best;
      best = pick(base, [...found, ...alts], limitS, K.BUY[level]);
      if (best !== was) {
        if (was.why.role === 'best') was.why.role = 'step';
        // an alternate is a route that differs from the pick (ALT_MIN_DIFF); one that doesn't any more is a step
        for (const r of alts) if (r !== best && 1 - overlap(v, best, r) < K.ALT_MIN_DIFF) r.why.role = 'step';
      }
      best.why.role = best === quick ? 'quickest' : best === base ? 'quickest-free' : 'best';
    }
    // the pick, the quickest, every step of the bisection (a spectrum from quick to the most good road the budget buys:
    // the route engine, not this objective, has the last word), then the alternates
    const ordered = [best];
    for (const r of [quick, ...found.slice().sort((x, y) => x.why.a - y.why.a), ...alts]) if (!ordered.some((x) => sameRoute(x, r))) ordered.push(r);
    const max = req.max || 7;
    // the exception's routes say why they drive a highway (the card: "Uses 0.4 mi of I-275 (no other way across)")
    if (hwy.mode === 'link') for (const r of ordered) if (r !== quick && r.hwyKm > 0) r.route.hwyReason = hwyReason(v, r);
    return { routes: ordered.slice(0, max), quick, limitS, a: lo, hwy, ms: Date.now() - t0 };
  }
  /**
   * The pick among a level's routes inside its budget: each route's length-weighted goodness G less `price` x its extra time
   * over the level's own quickest (`base`) as a share of that time, plus ROAD.w x the road points it gains over `base` (the
   * route engine's per-km terms: good road gained, side street avoided), the largest wins; a route whose extra time buys less
   * than BUY_MIN of goodness per 100 % more time (on average, over the quickest) is never the pick. So Fun takes good road
   * that's near (price 0.12: 10 % more time must buy 0.012 of goodness), Long way also the good road further off (0.03),
   * and neither lengthens a trip for road no better than the quickest's (2026-11-08, the levels audit).
   */
  function pick(base, routes, limitS, price) {
    const rel = (r) => (r.timeS - base.timeS) / Math.max(1, base.timeS);
    const road = (r) => K.ROAD.good * (r.why.goodKm || 0) - K.ROAD.poor * (r.why.poorKm || 0);
    const g = (r) => r.why.goodness + K.ROAD.w * (road(r) - road(base));
    const u = (r) => g(r) - price * rel(r);
    let best = base;
    for (const r of routes) {
      if (r === base || r.timeS > limitS || !Number.isFinite(r.why.goodness)) continue;
      const x = rel(r), dg = g(r) - base.why.goodness;
      if (x > 0 && dg < K.BUY_MIN * x) continue;
      if (x <= 0 && dg <= 0) continue;
      if (u(r) > u(best) + 1e-9) best = r;
    }
    return best;
  }
  // ---- there and back ------------------------------------------------------------------------------------------------
  /**
   * A destination and home again, never the same way twice where another way exists (the owner's ask for the best fun
   * routing: a drive out to a café or a viewpoint is two drives, and the second should be new road). The way out is the
   * level's own plan (planNow: its pick and its alternates). The way back starts at the destination (either direction: you
   * stopped there, turning round is free), its search costs the way out's edges ROUND_RETRACE_X both ways, at the weights
   * ROUND_A (at Fun and Long way off the highways, as loops' legs), and is picked by the level's own rule (pick(): the
   * goodness its extra time buys over the quickest way back that avoids the way out). Each out is paired with its best
   * back; the pairs are ranked: a fifth or less driven twice first, then by goodness. Returns
   * { routes: [round trip: { ...route, retraced, out: { timeS, distM }, back: { timeS, distM } }], out, ms }.
   */
  function roundTrip(v, req) { return withTune(req && req.tune, () => roundNow(v, req)); }
  function roundNow(v, req) {
    const t0 = Date.now(), level = levels()[req.level] ? req.level : 'fun', L = levels()[level];
    const there = planNow(v, req);
    const obj = objective(v, req), free = noHighway(level), is = hwyOf(v);
    let home = snap(v, req.from.lat, req.from.lon), at = snap(v, req.to.lat, req.to.lon);
    if (!home.length || !at.length) throw new Error('no road near the ends');
    if (free) { home = snapOff(v, req.from, home); at = snapOff(v, req.to, at); }
    const base = loopBase(v, level), out = [];
    // the ways out worth pairing: the plan's pick first, then its alternates (a way out that leaves the best road for the
    // way back can be the better pair), never two the same
    const outs = [];
    for (const r of there.routes) if (r.why.role !== 'quickest-highway' && !(free && r.hwyKm > 0 && there.hwy.mode !== 'link') && !outs.some((x) => sameRoute(x, r))) outs.push(r);
    for (const o of outs.slice(0, K.ROUND_PAIRS)) {
      const penal = Float32Array.from(base);
      for (const e of o.edgeIdx) { penal[e] *= K.ROUND_RETRACE_X; const tw = twin(v, e); if (tw >= 0) penal[tw] *= K.ROUND_RETRACE_X; }
      const ell = { ellipse: ellipseFor(req.to, req.from, level === 'quick' ? 'fun' : level) };
      const backs = [];
      for (const a of K.ROUND_A[level] || [0]) {
        const res = loopLeg(v, obj, at, home, a, penal, ell, level);
        if (!res) continue;
        const r = assemble(v, res, obj, { level, role: 'back', a });
        if (!backs.some((x) => sameRoute(x, r))) backs.push(r);
      }
      if (!backs.length) continue;
      const quickBack = backs.reduce((x, y) => (y.timeS < x.timeS ? y : x));
      const limitS = quickBack.timeS * (1 + L.budget) + L.slackS;
      const back = K.BUY[level] != null ? pick(quickBack, backs, limitS, K.BUY[level]) : quickBack;
      const r = loopRoute(v, obj, [{ edges: Array.from(o.edgeIdx), fs: o.fs, ft: o.ft }, { edges: Array.from(back.edgeIdx), fs: back.fs, ft: back.ft }], level, back.why.a);
      r.kind = 'round'; r.why.role = 'round';
      r.out = { timeS: o.timeS, distM: o.distM, role: o.why.role }; r.back = { timeS: back.timeS, distM: back.distM, a: back.why.a };
      // the turn at the destination is a stop, not a manoeuvre: the two legs' times, not the joined search's turn there
      r.timeS = o.timeS + back.timeS; r.route.timeS = r.timeS;
      if (!out.some((x) => sameRoute(x, r))) out.push(r);
    }
    const ok = out.filter((r) => r.retraced <= K.ROUND_MAX_RETRACED);
    // little driven twice first (a fifth or less is a different drive home); among those the most good road (goodness);
    // the route engine has the last word on the page
    const twice = (r) => (r.retraced <= 0.2 ? 0 : 1), good = (r) => (Number.isFinite(r.why.goodness) ? r.why.goodness : 0);
    const list = (ok.length ? ok : out).sort((x, y) => twice(x) - twice(y) || good(y) - good(x) || x.timeS - y.timeS);
    return { routes: list.slice(0, req.max || 3), out: there.routes[0], quick: there.quick, ms: Date.now() - t0 };
  }

  // ---- loops ----------------------------------------------------------------------------------------------------------
  /**
   * A loop (the owner, 2026-11-04: "the loops don't at all need to be a circle they just need to start and end at the same
   * place without too much overlap"): any route from the start back to it, little of it driven twice, built from the best
   * roads within reach of the length. Out on good road, back on other good road: one stage (out on one connector, back on
   * another), two or three chained (a lollipop, a figure-eight through the start, two parallel roads out and back). The
   * stages are the tiles' best roads (explore: quality x corners); nothing rewards roundness. Each leg is the level's
   * goodness search, with motorway and trunk costing LOOP_HWY_X at Quick (a short link to the good roads, never the bulk)
   * and never driven at Fun and Long way (NO_HWY: a leg with no other way takes the shortest highway link, as a route
   * does), and what earlier legs drove costing LOOP_RETRACE_X. Rings round the start only where no stage loop can be built.
   * { routes: [{ ...route, retraced, hwyShare, kind: 'stages' | 'ring', stages: [names] }], ms }.
   */
  function loop(v, req) { return withTune(req && req.tune, () => loopNow(v, req)); }
  function loopNow(v, req) {
    const t0 = Date.now(), level = levels()[req.level] ? req.level : 'fun', km = Math.max(3, Number(req.km) || 30);
    const obj = objective(v, req);
    let s0 = snap(v, req.start.lat, req.start.lon);
    if (!s0.length) throw new Error('no road near the start');
    if (noHighway(level)) s0 = snapOff(v, req.start, s0, req.start.heading);
    const hwy = loopBase(v, level);
    const out = [];
    for (const c of loopCombos(v, req.start, km, req.max || K.LOOP_TRIES)) {
      const r = loopAlong(v, obj, s0, req.start, c.pts, hwy, level);
      if (!r || r.retraced > K.LOOP_MAX_RETRACED) continue;
      r.kind = 'stages'; r.stages = c.stages.map((x) => x.name);
      if (!out.some((x) => sameRoute(x, r))) out.push(r);
    }
    if (!out.length) out.push(...rings(v, req, obj, s0, hwy, level, km));
    // the length is a guess until routed: one more than 60 % off it isn't the loop asked for
    const routes = out.filter((r) => Math.abs(r.distM / 1000 - km) / km <= K.LOOP_MAX_OFF);
    return { routes, ms: Date.now() - t0 };
  }
  /**
   * Per-edge cost factors a loop starts from: motorway and trunk (and their ramps) x LOOP_HWY_X at Quick; 1 at Fun and
   * Long way, whose legs never drive them (loopLeg's ban).
   */
  function loopBase(v, level) {
    const p = new Float32Array(v.E).fill(1), x = K.LOOP_HWY_X[level];
    if (noHighway(level) || !x) return p;
    const is = hwyOf(v);
    for (let e = 0; e < v.E; e++) if (is[e]) p[e] = x;
    return p;
  }
  /**
   * One leg of a loop: at Fun and Long way off the highways; where the last leg's arrival leaves only a highway ahead (a
   * street that meets the motorway and nothing else), turned round there first (a U-turn's seconds); else (no other way)
   * the shortest highway link.
   */
  function loopLeg(v, obj, prev, dst, a, penal, o, level) {
    if (!noHighway(level)) return search(v, obj, prev, dst, a, penal, o);
    const is = hwyOf(v);
    const free = search(v, obj, prev, dst, a, penal, { ...o, ban: is });
    if (free) return free;
    const back = prev.map((x) => ({ x, tw: twin(v, x.edge) })).filter((y) => y.tw >= 0 && !is[y.tw]);
    if (back.length) {
      const tws = new Set(back.map((y) => y.tw));
      const round = search(v, obj, back.map((y) => ({ edge: y.tw, frac: 1 - y.x.frac, lat: 0, lon: 0 })), dst, a, penal, { ...o, ban: is, startCost: (e) => (tws.has(e) ? K.UTURN_S : 0) });
      if (round) return round;
    }
    return search(v, obj, prev, dst, a, penal, { ...o, hwyX: { is, x: K.HWY_LINK_X } });
  }
  /**
   * The best roads within reach, chained into loops: explore's stages that a loop of `km` can reach and come back from
   * (twice the crow line to its nearer end plus the stage within the length), as singles, ordered pairs and triples, each
   * stage driven either way. A chain's length is guessed as its stages plus LOOP_CONN_FACTOR x each connector's crow line;
   * its value is the stages' scores (quality x corners) times how near that guess is to the length. The best `n` with
   * different sets of stages; each as the points to drive through (each stage every LOOP_ALONG_M, with its heading).
   */
  function loopCombos(v, start, km, n) {
    const reachS = Math.max(600, km * 1000 / 2 / K.LOOP_REACH_MS);
    let stages;
    try { stages = explore(v, { start, maxS: reachS, max: 3 * K.LOOP_STAGES }).stages; } catch (_) { return []; }
    const crow = (a, b) => distM(a.lat, a.lon, b.lat, b.lon) / 1000;
    const near = (s) => Math.min(crow(start, { lat: s.lat[0], lon: s.lon[0] }), crow(start, { lat: s.lat[s.lat.length - 1], lon: s.lon[s.lon.length - 1] }));
    // explore's out-and-back roads (deadEnd: a long good road that ends) are a Best road nearby, not a loop's link: a loop
    // through one drives it twice. Its streets are never stages at all.
    const list = stages.filter((s) => !s.deadEnd && s.km <= km * 0.8 && 2 * near(s) + s.km <= km * 1.2).slice(0, K.LOOP_STAGES);
    const ends = (s, rev) => { const L = s.lat.length - 1; return rev ? [{ lat: s.lat[L], lon: s.lon[L] }, { lat: s.lat[0], lon: s.lon[0] }] : [{ lat: s.lat[0], lon: s.lon[0] }, { lat: s.lat[L], lon: s.lon[L] }]; };
    const combos = [];
    const consider = (idx) => {
      // the best way round for this order: each stage forward or back, the shortest connectors
      let best = null;
      for (let m = 0; m < (1 << idx.length); m++) {
        let at = start, conn = 0, len = 0;
        for (let k = 0; k < idx.length; k++) { const [a, b] = ends(list[idx[k]], (m >> k) & 1); conn += crow(at, a); len += list[idx[k]].km; at = b; }
        conn += crow(at, start);
        const est = len + K.LOOP_CONN_FACTOR * conn;
        if (!best || est < best.est) best = { est, mask: m };
      }
      const fit = Math.max(0, 1 - 1.5 * Math.abs(best.est - km) / km);
      if (fit <= 0) return;
      const score = idx.reduce((a, i) => a + list[i].score, 0) * fit;
      combos.push({ idx, mask: best.mask, est: best.est, score });
    };
    const N = list.length;
    for (let i = 0; i < N; i++) {
      consider([i]);
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        consider([i, j]);
        if (km >= 25) for (let k = 0; k < N; k++) if (k !== i && k !== j) consider([i, j, k]);
      }
    }
    combos.sort((a, b) => b.score - a.score || a.est - b.est);
    const picked = [], seen = new Set();
    for (const c of combos) {
      const key = c.idx.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key); picked.push(c);
      if (picked.length >= n) break;
    }
    return picked.map((c) => ({ stages: c.idx.map((i) => list[i]), est: c.est, pts: [].concat(...c.idx.map((i, k) => alongStage(list[i], (c.mask >> k) & 1))) }));
  }
  /** Points along a stage every LOOP_ALONG_M (its two ends included), driven forward or back, each with its heading. */
  function alongStage(s, rev) {
    const n = s.lat.length, idx = [...Array(n).keys()];
    if (rev) idx.reverse();
    const out = [];
    let run = 0, next = 0;
    for (let q = 0; q < n; q++) {
      const i = idx[q];
      if (q > 0) run += distM(s.lat[idx[q - 1]], s.lon[idx[q - 1]], s.lat[i], s.lon[i]);
      if (run >= next || q === n - 1) {
        const j = idx[Math.min(n - 1, q + 1)], h = q < n - 1 ? bearing(s.lat[i], s.lon[i], s.lat[j], s.lon[j]) : bearing(s.lat[idx[q - 1]], s.lon[idx[q - 1]], s.lat[i], s.lon[i]);
        out.push({ lat: s.lat[i], lon: s.lon[i], h, conn: !out.length });   // the leg to its first point is a connector
        next = run + K.LOOP_ALONG_M;
      }
    }
    return out;
  }
  /** The edge's heading where it passes nearest a point (radians). */
  function headingNear(v, e, la, lo) {
    const g = geom(v, e), m = g.length / 2;
    let best = 0, bd = Infinity;
    for (let q = 0; q < m - 1; q++) { const d = distM(la, lo, (g[2 * q] + g[2 * q + 2]) / 2, (g[2 * q + 1] + g[2 * q + 3]) / 2); if (d < bd) { bd = d; best = q; } }
    return m > 1 ? bearing(g[2 * best], g[2 * best + 1], g[2 * best + 2], g[2 * best + 3]) : 0;
  }
  /**
   * A loop from s0 through `pts` ({ lat, lon, h }: snapped to the road there heading that way) and back: each leg the level's
   * search on the loop's costs, earlier legs' edges (both ways) x LOOP_RETRACE_X. The route with `retraced` (share of its
   * length on road driven twice) and `hwyShare` (on motorway or trunk), or null.
   */
  function loopAlong(v, obj, s0, start, pts, hwy, level) {
    const a = K.LOOP_A[level], penal = Float32Array.from(hwy), is = hwyOf(v);
    const snaps = [];
    for (const p of pts) {
      // the stage's own road, the way it is driven (never a motorway beside it)
      let x = Number.isFinite(p.h) ? snap(v, p.lat, p.lon, (e) => !is[e] && Math.abs(turnAngle(p.h, headingNear(v, e, p.lat, p.lon))) < 0.87, 60) : [];
      if (!x.length) x = snap(v, p.lat, p.lon, noHighway(level) ? (e) => !is[e] : null, 200);
      if (x.length) snaps.push({ s: x, lat: p.lat, lon: p.lon, conn: !!p.conn });
    }
    if (!snaps.length) return null;
    snaps.push({ s: s0, lat: start.lat, lon: start.lon, conn: true });
    const legs = [];
    let prev = s0, at = start;
    for (const nx of snaps) {
      // a connector (to a stage, back to the start) at most LOOP_CONN_A: at Long way's weight it wandered 100 km of back
      // roads to reach the next stage (a 175 mi loop for 90 asked, live 2026-11-06); the stages themselves at the level's
      const res = loopLeg(v, obj, prev, nx.s, nx.conn ? Math.min(a, K.LOOP_CONN_A) : a, penal, { ellipse: ellipseFor(at, nx, nx.conn ? 'fun' : 'max') }, level);
      if (!res) return null;
      legs.push(res);
      for (const e of res.edges) { penal[e] = hwy[e] * K.LOOP_RETRACE_X; const tw = twin(v, e); if (tw >= 0) penal[tw] = hwy[tw] * K.LOOP_RETRACE_X; }
      const last = res.edges[res.edges.length - 1];
      prev = [{ edge: last, frac: res.ft, lat: 0, lon: 0 }];
      at = nx;
    }
    return loopRoute(v, obj, legs, level, a);
  }
  /** Legs joined into one route (a leg's first edge is the last one's arrival edge, driven on), with retraced and hwyShare. */
  function loopRoute(v, obj, legs, level, a) {
    const edges = [];
    for (const [k, l] of legs.entries()) for (const [m, e] of l.edges.entries()) if (!(k > 0 && m === 0 && edges[edges.length - 1] === e)) edges.push(e);
    const route = assemble(v, { edges, fs: legs[0].fs, ft: legs[legs.length - 1].ft }, obj, { level, role: 'loop', a });
    const used = new Map(), B = v.bits || flagBits();
    const key = (e) => Math.min(e, twin(v, e) >= 0 ? twin(v, e) : e);
    let retr = 0, hw = 0, all = 0;
    for (const e of edges) used.set(key(e), (used.get(key(e)) || 0) + 1);
    for (const e of edges) { if (used.get(key(e)) > 1) retr += v.len[e]; all += v.len[e]; if (isHwyEdge(v, e)) hw += v.len[e]; }
    route.retraced = route.distM > 0 ? Math.min(1, retr / route.distM) : 0;
    route.hwyShare = all > 0 ? hw / all : 0;
    if (noHighway(level) && route.hwyKm > 0) route.route.hwyReason = hwyReason(v, route);
    return route;
  }
  /** The fallback where no stage loop exists: rings through the start, 3 waypoints each snapped to through roads. */
  function rings(v, req, obj, s0, hwy, level, km) {
    const B = flagBits(), a = K.LOOP_A[level];
    const through = (e) => v.cls[e] <= CLS.unclassified && !(v.flags[e] & (B.ramp | B.private | B.destination)) && v.cls[e] > CLS.trunk;
    const r = km * 1000 / (2 * Math.PI * K.LOOP_ROAD_FACTOR), out = [];
    for (const deg of req.dirs || [0, 90, 180, 270]) {
      const th = deg * RAD, c = Math.cos(req.start.lat * RAD);
      const cen = { lat: req.start.lat + r * Math.cos(th) / 110540, lon: req.start.lon + r * Math.sin(th) / (111320 * c) };
      const pts = [1, 2, 3].map((k) => { const b = th + Math.PI + k * Math.PI / 2; return { lat: cen.lat + r * Math.cos(b) / 110540, lon: cen.lon + r * Math.sin(b) / (111320 * c) }; });
      const snaps = pts.map((p) => { const x = snap(v, p.lat, p.lon, through, 3000); return x.length ? x : snap(v, p.lat, p.lon, noHighway(level) ? (e) => !hwyOf(v)[e] : null); });
      if (snaps.some((x) => !x.length)) continue;
      const penal = Float32Array.from(hwy), legs = [];
      let prev = s0, ok = true;
      for (const nx of [...snaps, s0]) {
        const res = loopLeg(v, obj, prev, nx, a, penal, {}, level);
        if (!res) { ok = false; break; }
        legs.push(res);
        for (const e of res.edges) { penal[e] = hwy[e] * K.LOOP_RETRACE_X; const tw = twin(v, e); if (tw >= 0) penal[tw] = hwy[tw] * K.LOOP_RETRACE_X; }
        prev = [{ edge: res.edges[res.edges.length - 1], frac: res.ft, lat: 0, lon: 0 }];
      }
      if (!ok) continue;
      const route = loopRoute(v, obj, legs, level, a);
      route.kind = 'ring'; route.dir = deg;
      if (!out.some((x) => sameRoute(x, route))) out.push(route);
    }
    return out;
  }

  // ---- best roads nearby (Explore) ------------------------------------------------------------------------------------
  /** Drive time (s) from a snap to every node, up to maxS (Dijkstra on edge times; no turn costs: a reach, not a route). */
  function reach(v, src, maxS) {
    const T = new Float64Array(v.N).fill(Infinity), heap = [];
    const push = (k, n) => { heap.push([k, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const s of src) { const n = v.to[s.edge], k = (1 - s.frac) * v.time[s.edge]; if (n >= 0 && k < T[n]) { T[n] = k; push(k, n); } }
    while (heap.length) {
      const [k, n] = pop();
      if (k > T[n] || k > maxS) continue;
      for (let e = v.first[n]; e < v.first[n + 1]; e++) {
        const b = v.to[e];
        if (b < 0 || (v.flags[e] & (v.bits.private | v.bits.barrier))) continue;
        const x = k + v.time[e];
        if (x < T[b] && x <= maxS) { T[b] = x; push(x, b); }
      }
    }
    return T;
  }
  /**
   * Is edge e a neighbourhood street (fun_route.js streetSample: residential class in built-up frontage)? true / false /
   * null (unknown: a v1 tile without the road channels, or no ApexFunRoute here).
   */
  function streetEdge(v, e) {
    const F = FunRoute();
    if (!F || !F.streetSample) return null;
    const ch = v.roadCh || {}, at = (k) => (ch[k] ? ch[k][e] : NaN);
    const limit = v.speed[e] && !(v.flags[e] & v.bits.speedEst) ? v.speed[e] : NaN;   // a posted limit, not the class's estimate
    return F.streetSample({ cls: v.cls[e], limit, addr: at('addr_per_km'), bldg: at('bldg_per_km'), density: at('density') });
  }
  /** A real dead end at node n (one neighbour), not the edge of the tiles loaded (an edge into a tile not in the view). */
  function deadEndAt(v, n) {
    if (n < 0 || !v.deadEnd[n]) return false;
    for (let e = v.first[n]; e < v.first[n + 1]; e++) if (v.to[e] < 0) return false;
    return true;
  }
  /** A junction: three or more neighbouring nodes (or a way into tiles not loaded, which may be one). */
  function junctionAt(v, n) {
    if (n < 0) return false;
    const nb = new Set();
    for (let e = v.first[n]; e < v.first[n + 1]; e++) { if (v.to[e] < 0) return true; if (v.to[e] !== n) nb.add(v.to[e]); }
    for (let r = v.rfirst[n]; r < v.rfirst[n + 1]; r++) { const a = v.tail[v.redge[r]]; if (a !== n) nb.add(a); }
    return nb.size >= 3;
  }
  /**
   * Stages from our tiles (Best roads nearby): edges scored quality x corners (fun per km, only on road the engine calls
   * good: quality 0.45 or more, and never a neighbourhood street: streetEdge) are chained from the best down, each chain
   * growing forward and back along the best continuing edge (a turn under 60°, at least a third of the seed's score, or
   * the same road), until it runs out or reaches 15 km; chains of 2 km or more within reach (maxS) that go somewhere
   * (an end into a dead end is cut back to the last junction unless that run is OUT_BACK_KM of good road) are the stages, as stages.js shapes them ({ lat, lon,
   * name, km, score, good }) plus the drive time to each end (aS, bS). req: { start, maxKm, maxS, max }.
   */
  function explore(v, req) {
    const t0 = Date.now(), B = v.bits, maxS = req.maxS || 1800, max = req.max || 12;
    const s0 = snap(v, req.start.lat, req.start.lon);
    if (!s0.length) throw new Error('no road near you');
    const T = reach(v, s0, maxS);
    const score = new Float32Array(v.E);
    const seeds = [];
    for (let e = 0; e < v.E; e++) {
      if (v.to[e] < 0 || v.quality[e] === UNKNOWN_U8 || !Number.isFinite(v.fun[e]) || v.fun[e] <= 0) continue;
      const q = v.quality[e] / 254;
      if (q < K.POOR_HI || (v.flags[e] & (B.private | B.barrier | B.ramp | B.destination | B.expressway)) || v.cls[e] === CLS.motorway || v.cls[e] >= CLS.service) continue;
      if (streetEdge(v, e) === true) continue;
      score[e] = q * v.fun[e] / Math.max(0.05, v.len[e] / 1000);
      if (Number.isFinite(T[v.tail[e]]) || Number.isFinite(T[v.to[e]])) seeds.push(e);
    }
    seeds.sort((a, b) => score[b] - score[a] || a - b);
    const used = new Uint8Array(v.E), out = [];
    const take = (e) => { used[e] = 1; const tw = twin(v, e); if (tw >= 0) used[tw] = 1; };
    const ok = (p, e, seed) => {
      if (used[e] || v.to[e] < 0 || score[e] <= 0) return false;
      if (v.to[e] === v.tail[p]) return false;
      headings(v, p); headings(v, e);
      if (Math.abs(turnAngle(v.hOut[p], v.hIn[e])) > 1.05) return false;
      return score[e] >= score[seed] / 3 || (v.name[e] >= 0 && v.name[e] === v.name[p] && v.eTile[e] === v.eTile[p]);
    };
    for (const seed of seeds) {
      if (out.length >= max * 3) break;
      if (used[seed]) continue;
      const chain = [seed];
      take(seed);
      let km = v.len[seed] / 1000;
      for (let p = seed; km < 15;) {                                 // forward
        const n = v.to[p];
        let best = -1;
        for (let e = v.first[n]; e < v.first[n + 1]; e++) if (ok(p, e, seed) && (best < 0 || score[e] > score[best])) best = e;
        if (best < 0) break;
        chain.push(best); take(best); km += v.len[best] / 1000; p = best;
      }
      for (let q = seed; km < 15;) {                                 // back
        const n = v.tail[q];
        let best = -1;
        for (let r = v.rfirst[n]; r < v.rfirst[n + 1]; r++) { const e = v.redge[r]; if (!used[e] && v.to[e] >= 0 && score[e] > 0 && v.tail[q] === v.to[e] && v.tail[e] !== v.to[q]) { headings(v, e); headings(v, q); if (Math.abs(turnAngle(v.hOut[e], v.hIn[q])) <= 1.05 && (score[e] >= score[seed] / 3 || v.name[e] === v.name[q]) && (best < 0 || score[e] > score[best])) best = e; } }
        if (best < 0) break;
        chain.unshift(best); take(best); km += v.len[best] / 1000; q = best;
      }
      // a through road, not a cul-de-sac: an end that runs into a dead end is cut back to the last junction on the way (a
      // spur off a good road goes), unless the dead-end run itself is OUT_BACK_KM or more of good road: a long rural road
      // that ends is still worth driving there and back (Cook Road, Mudlick Road). Streets, service and destination-only
      // edges are never in a chain, so their dead ends never count as good road.
      let outBack = false;
      const cut = (atEnd) => {
        const endNode = () => (atEnd ? v.to[chain[chain.length - 1]] : v.tail[chain[0]]);
        if (!chain.length || !deadEndAt(v, endNode())) return;
        let i = atEnd ? chain.length - 1 : 0, run = 0;
        const step = atEnd ? -1 : 1, nodeOf = (k) => (atEnd ? v.tail[chain[k]] : v.to[chain[k]]);
        for (; i >= 0 && i < chain.length; i += step) { run += v.len[chain[i]] / 1000; if (junctionAt(v, nodeOf(i))) break; }
        if (run >= K.OUT_BACK_KM) { outBack = true; return; }
        while (chain.length && !junctionAt(v, endNode())) km -= v.len[atEnd ? chain.pop() : chain.shift()] / 1000;
      };
      cut(true); cut(false);
      if (!chain.length || km < 2) continue;
      const aS = T[v.tail[chain[0]]], bS = T[v.to[chain[chain.length - 1]]];
      if (!Number.isFinite(aS) && !Number.isFinite(bS)) continue;
      const lat = [], lon = [], names = new Map();
      let fun = 0, qs = 0;
      for (const e of chain) {
        const g = geom(v, e);
        for (let i = lat.length ? 2 : 0; i < g.length; i += 2) { lat.push(g[i]); lon.push(g[i + 1]); }
        fun += v.fun[e]; qs += (v.quality[e] / 254) * v.len[e];
        const nm = nameOf(v, e);
        if (nm) names.set(nm, (names.get(nm) || 0) + v.len[e]);
      }
      const name = [...names].sort((a, b) => b[1] - a[1])[0];
      out.push({ lat, lon, name: name ? name[0] : null, km, good: Math.round(fun), quality: qs / (km * 1000), score: fun * (qs / (km * 1000)),
        aS: Number.isFinite(aS) ? aS : null, bS: Number.isFinite(bS) ? bS : null, source: 'own', ...(outBack ? { deadEnd: true } : {}) });
    }
    out.sort((a, b) => b.score - a.score);
    return { stages: out.slice(0, max), ms: Date.now() - t0 };
  }

  // ---- coverage -------------------------------------------------------------------------------------------------------
  /** Tile keys present, from the tiles' index.json ({ tiles: ["i_j" | [i, j] | {i, j}] }). */
  function indexKeys(idx) {
    const list = idx && (Array.isArray(idx.tiles) ? idx.tiles : idx.tiles && typeof idx.tiles === 'object' ? Object.keys(idx.tiles) : []);
    return new Set((list || []).map(refKey).filter(Boolean));
  }
  /** Do the tiles cover every one of `points`? */
  function covers(keys, points) {
    return !!keys && keys.size > 0 && points.every((p) => { const t = tileOf(p.lat, p.lon); return keys.has(keyOf(t.i, t.j)); });
  }

  // ---- the worker's message protocol ----------------------------------------------------------------------------------
  /**
   * The worker's side: env { load(i, j) -> Promise<decoded|null>, index() -> Promise<index.json|null> }. Messages:
   *   { id, type: 'covers', points }                -> { id, covers }
   *   { id, type: 'plan', from, to, level, ... }    -> { id, result: { routes, quick, limitS, ms, tiles } }
   *   { id, type: 'loop', start, km, level, ... }   -> { id, result: { routes, ms, tiles } }
   * and { id, error } for anything that fails. Tiles are kept (the last 64) and the last view is reused for the same set.
   */
  function host(env) {
    const tiles = new Map();
    let keysP = null, last = null;
    const keys = () => (keysP || (keysP = Promise.resolve(env.index ? env.index() : null).then(indexKeys).catch(() => { keysP = null; return new Set(); })));
    const ready = new Set();                                          // tiles loaded and decoded (or known missing)
    const load = (t) => {
      const k = keyOf(t.i, t.j);
      if (!tiles.has(k)) {
        tiles.set(k, Promise.resolve(env.load(t.i, t.j)).catch(() => null).then((x) => { ready.add(k); return x; }));
        if (tiles.size > 64) tiles.delete(tiles.keys().next().value);
      }
      return tiles.get(k);
    };
    // the view is kept and grown: a plan inside the tiles already viewed (the preloaded area round you) reuses it; one
    // that needs more builds the union once (at most MAX_VIEW tiles, else just what it needs)
    const MAX_VIEW = 20;
    // a view of just these tiles (the first route's), kept for the next ask of the same set
    let small = null;
    async function smallView(want) {
      const have = await keys();
      const need = want.filter((t) => !have.size || have.has(keyOf(t.i, t.j)));
      const key = need.map((t) => keyOf(t.i, t.j)).sort().join(',');
      if (small && small.key === key) return small.v;
      const got = (await Promise.all(need.map(load))).filter(Boolean);
      small = { key, v: view(got) };
      return small.v;
    }
    async function viewFor(want) {
      const have = await keys();
      const need = want.filter((t) => !have.size || have.has(keyOf(t.i, t.j)));
      if (last && need.every((t) => last.keys.has(keyOf(t.i, t.j)))) return last.v;
      const union = last && last.keys.size + need.length <= MAX_VIEW ? [...need, ...[...last.keys].map((k) => { const [i, j] = k.split('_').map(Number); return { i, j }; })] : need;
      const seen = new Set(), list = union.filter((t) => { const k = keyOf(t.i, t.j); if (seen.has(k)) return false; seen.add(k); return true; });
      const got = (await Promise.all(list.map(load))).filter(Boolean);
      const v = view(got);
      last = { keys: new Set(v.keys), v };
      return v;
    }
    let inflight = 0;
    async function handle(msg) {
      const busy = msg && msg.type !== 'preload' && msg.type !== 'covers' && msg.type !== 'keep';
      if (busy) inflight++;
      try { return await handleOne(msg); } finally { if (busy) inflight--; }
    }
    // the first route's tiles being read: a plan asked at once loaded the whole corridor's alongside them and held the
    // first route 0.1-0.3 s on a first visit (live 2026-11-07), so its own loading waits for them
    let quickBusy = Promise.resolve();
    async function handleOne(msg) {
      const { id, type } = msg || {};
      try {
        if (type === 'covers') return { id, covers: covers(await keys(), msg.points || []) };
        if (type === 'quick') {
          // the first route: the tiles already in view when they cover the trip; else only those under the straight line
          // (the ends' and the ones between, loaded in parallel, a small view of their own), the rest come with the plan
          // (the plan asked right behind it waits for these tiles first: quickBusy)
          let done;
          quickBusy = new Promise((r) => { done = r; });
          const t0 = Date.now(), line = lineTiles(msg.from, msg.to);
          let v;
          try { v = last && line.every((t) => last.keys.has(keyOf(t.i, t.j))) ? last.v : await smallView(line); } finally { done(); }
          const t1 = Date.now();
          let r = null;
          try { r = quickest(v, msg); } catch (_) { r = null; }
          if (!r) { v = await viewFor(tilesFor(msg.from, msg.to, msg.level)); r = quickest(v, msg); }   // the line alone had no way
          return { id, result: { route: plain(r), loadMs: t1 - t0, ms: Date.now() - t1, tiles: v.keys } };
        }
        if (type === 'through') {
          const all = [msg.from, ...(msg.via || []), msg.to], pad = 3000;
          const s = all.reduce((m, p) => ({ lat: Math.min(m.lat, p.lat), lon: Math.min(m.lon, p.lon) }), all[0]), n = all.reduce((m, p) => ({ lat: Math.max(m.lat, p.lat), lon: Math.max(m.lon, p.lon) }), all[0]);
          const sw = tileOf(s.lat - pad / 110540, s.lon - pad / (111320 * Math.cos(s.lat * RAD))), ne = tileOf(n.lat + pad / 110540, n.lon + pad / (111320 * Math.cos(n.lat * RAD))), box = [];
          for (let i = sw.i; i <= ne.i; i++) for (let j = sw.j; j <= ne.j; j++) box.push({ i, j });
          const t0 = Date.now(), v = await viewFor(box);
          return { id, result: { route: plain(through(v, msg)), ms: Date.now() - t0, tiles: v.keys } };
        }
        if (type === 'score') {
          const lines = msg.lines || [];
          const pts = lines.flatMap((l) => (l.lat.length ? [{ lat: l.lat[0], lon: l.lon[0] }, { lat: l.lat[l.lat.length - 1], lon: l.lon[l.lon.length - 1] }] : []));
          if (!pts.length) return { id, result: [] };
          const s = pts.reduce((m, p) => ({ lat: Math.min(m.lat, p.lat), lon: Math.min(m.lon, p.lon) }), pts[0]), n = pts.reduce((m, p) => ({ lat: Math.max(m.lat, p.lat), lon: Math.max(m.lon, p.lon) }), pts[0]);
          const v = await viewFor(tilesFor(s, n, 'quick'));
          return { id, result: lines.map((l) => scoreLine(v, l.lat, l.lon)) };
        }
        if (type === 'explore') {
          const c = msg.start, d = (msg.maxKm || 14) * 1000 + 2000;
          const at = (dy, dx) => ({ lat: c.lat + dy / 110540, lon: c.lon + dx / (111320 * Math.cos(c.lat * RAD)) });
          const sw = tileOf(at(-d, -d).lat, at(-d, -d).lon), ne = tileOf(at(d, d).lat, at(d, d).lon), box = [];
          for (let i = sw.i; i <= ne.i; i++) for (let j = sw.j; j <= ne.j; j++) box.push({ i, j });
          const v = await viewFor(box);
          return { id, result: { ...explore(v, msg), tiles: v.keys } };
        }
        if (type === 'preload') {
          const t0 = Date.now(), c = { lat: msg.lat, lon: msg.lon }, d = (msg.km || 15) * 1000;
          const at = (dy, dx) => ({ lat: c.lat + dy / 110540, lon: c.lon + dx / (111320 * Math.cos(c.lat * RAD)) });
          const sw = tileOf(at(-d, -d).lat, at(-d, -d).lon), ne = tileOf(at(d, d).lat, at(d, d).lon), box = [];
          for (let i = sw.i; i <= ne.i; i++) for (let j = sw.j; j <= ne.j; j++) box.push({ i, j });
          // the tiles fetched and decoded (each its own task, so a plan asked meanwhile is answered between them); the
          // view of them is built after, in a task of its own, unless a plan has built what it needs by then
          const have = await keys();
          // one at a time, yours first, then the nearest: a plan asked meanwhile shares the bandwidth with one tile, not six
          const mine = tileOf(c.lat, c.lon), near = (t) => Math.hypot(t.i - mine.i, t.j - mine.j);
          const got = [];
          // and it waits while a plan is being answered: the plan's own tiles get the bandwidth and the worker
          for (const t of box.filter((x) => !have.size || have.has(keyOf(x.i, x.j))).sort((a, b) => near(a) - near(b))) {
            while (inflight > 0) await new Promise((r) => setTimeout(r, 50));
            const x = await load(t); if (x) got.push(x);
          }
          while (inflight > 0) await new Promise((r) => setTimeout(r, 50));
          await new Promise((r) => setTimeout(r, 0));
          const v = await viewFor(box);
          return { id, result: { tiles: v.keys, edges: v.E, loaded: got.length, ms: Date.now() - t0 } };
        }
        if (type === 'keep') {
          // the region's tiles round you kept on the phone (bytes only, not decoded: graph_tiles.js keepArea), after the
          // tile you're in is read, and never while a plan is answered (the app starting, 2026-11-08)
          if (!env.keep) return { id, result: null };
          while (inflight > 0) await new Promise((r) => setTimeout(r, 100));
          const c = { lat: msg.lat, lon: msg.lon }, d = (msg.km || 15) * 1000;
          const dLat = d / 110540, dLon = d / (111320 * Math.cos(c.lat * RAD));
          return { id, result: await env.keep([c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon]) };
        }
        if (type === 'plan') {
          // scope 'first': with the corridor's tiles not all in yet, the plan is made on those under the straight line
          // (as the first route was) and says so (partial); the page asks again for the whole corridor meanwhile
          await quickBusy;
          const corridor = tilesFor(msg.from, msg.to, msg.level), have = await keys();
          const notReady = () => corridor.filter((t) => (!have.size || have.has(keyOf(t.i, t.j))) && !ready.has(keyOf(t.i, t.j)));
          let missing = notReady();
          // (waitMs: the corridor's tiles get that long to come in first: the app's own and IndexedDB's are a few hundred ms
          // away, and a plan on the line's tiles alone can miss the quickest way and so the level's budget)
          if (msg.scope === 'first' && missing.length && msg.waitMs > 0) {
            let timer;
            await Promise.race([Promise.all(missing.map(load)), new Promise((r) => { timer = setTimeout(r, msg.waitMs); })]);
            clearTimeout(timer);
            missing = notReady();
          }
          const partial = msg.scope === 'first' && missing.length > 0;
          if (partial) for (const t of missing) load(t);                 // fetched now, for the whole-corridor plan
          const t0 = Date.now(), v = partial ? await smallView(lineTiles(msg.from, msg.to)) : await viewFor(corridor), viewMs = Date.now() - t0;
          // members' data for this plan only (the view is kept for the next one, signed in or not)
          v.crowd = msg.crowd ? crowdOnto(v, msg.crowd) : null;
          try {
            const r = plan(v, msg), t1 = Date.now();
            // each route's light geometry (fun_route.js geometry: 5 m samples and corners, what the ranking scores) made
            // here, off the page, which is drawing the first route meanwhile (the worker imports apex_core.js for it)
            const Core = root.ApexCore, F = FunRoute();
            if (Core && F && F.geometry && msg.geometry !== false) for (const x of r.routes || []) {
              try { const g = F.geometry(x.route.coords, Core); x.geo = { lat: Float64Array.from(g.lat), lon: Float64Array.from(g.lon), events: g.events }; } catch (_) { /* made on the page */ }
            }
            return { id, result: { ...strip(r), tiles: v.keys, partial, viewMs, geoMs: Date.now() - t1, crowdEdges: v.crowd ? v.crowd.edges : 0 } };
          } finally { v.crowd = null; }
        }
        if (type === 'round') {
          const v = await viewFor(tilesFor(msg.from, msg.to, msg.level === 'quick' ? 'fun' : msg.level));
          const r = roundTrip(v, msg);
          return { id, result: { ...strip({ routes: r.routes, quick: r.quick }), outTimeS: r.out ? r.out.timeS : null, ms: r.ms, tiles: v.keys } };
        }
        if (type === 'loop') {
          const v = await viewFor(loopTiles(msg.start, msg.km));
          return { id, result: { ...strip(loop(v, msg)), tiles: v.keys } };
        }
        return { id, error: `unknown message ${type}` };
      } catch (err) {
        return { id, error: String((err && err.message) || err) };
      }
    }
    return { handle, onmessage: async (e, post) => post(await handle(e.data)) };
  }
  // what crosses the worker boundary: plain arrays (structured clone keeps Maps, but edgeIdx is view-local)
  function plain(r) {
    if (!r) return r;
    // the line as one Float64Array [lon, lat, ...] (route.flat): a structured clone of thousands of little arrays is the
    // page's work as the message lands, and it held the first route's draw up (own_routing.js gives route.coords back)
    const { edgeIdx, coords, ...rest } = r;
    const { coords: line, ...route } = r.route;
    const flat = new Float64Array(line.length * 2);
    line.forEach(([lo, la], k) => { flat[2 * k] = lo; flat[2 * k + 1] = la; });
    return { ...rest, route: { ...route, flat } };
  }
  function strip(res) {
    return { ...res, routes: (res.routes || []).map(plain), quick: res.quick ? plain(res.quick) : undefined };
  }

  /**
   * The page's side: a worker (web/graph_worker.js) asked by message id, each call with a timeout; the worker failing to
   * start falls back to the same host in the page when the tile reader is loaded there, else every call rejects (the
   * planner then uses Valhalla). o: { url, timeoutMs, Worker, env }.
   */
  function client(o = {}) {
    let w = null, inline = null, seq = 0;
    const waiting = new Map();
    const W = o.Worker || root.Worker;
    try {
      if (W) {
        w = new W(o.url || 'graph_worker.js');
        w.onmessage = (e) => { const m = e.data || {}, p = waiting.get(m.id); if (p) { waiting.delete(m.id); p(m); } };
        w.onerror = () => { for (const p of waiting.values()) p({ error: 'worker failed' }); waiting.clear(); w = null; };
      }
    } catch (_) { w = null; }
    const inlineHost = () => {
      if (inline) return inline;
      const T = root.ApexGraphTiles;
      const env = o.env || (T && T.load ? { load: (i, j) => T.load(i, j), index: T.index ? () => T.index() : null } : null);
      inline = env ? host(env) : null;
      return inline;
    };
    function ask(msg, timeoutMs = o.timeoutMs || 8000) {
      const id = ++seq;
      const full = { ...msg, id };
      if (!w) {
        const h = inlineHost();
        if (!h) return Promise.reject(new Error('no graph router here'));
        return h.handle(full).then((m) => (m.error ? Promise.reject(new Error(m.error)) : m));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('graph router timed out')); }, timeoutMs);
        waiting.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(m.error)); else resolve(m); });
        try { w.postMessage(full); } catch (err) { clearTimeout(timer); waiting.delete(id); reject(err); }
      });
    }
    return {
      covers: (points) => ask({ type: 'covers', points }, 4000).then((m) => !!m.covers),
      // the worker reads its tiles' index now (the app starting), so a first plan doesn't wait for it
      ready: () => ask({ type: 'covers', points: [] }, 10000).then(() => true),
      plan: (req) => ask({ type: 'plan', ...req }).then((m) => m.result),
      quick: (req) => ask({ type: 'quick', ...req }).then((m) => m.result),
      through: (req) => ask({ type: 'through', ...req }).then((m) => m.result),
      score: (lines) => ask({ type: 'score', lines }, 3000).then((m) => m.result),
      preload: (at) => ask({ type: 'preload', ...at }, 20000).then((m) => m.result),
      keep: (at) => ask({ type: 'keep', ...at }, 120000).then((m) => m.result),
      explore: (req) => ask({ type: 'explore', ...req }).then((m) => m.result),
      loop: (req) => ask({ type: 'loop', ...req }).then((m) => m.result),
      round: (req) => ask({ type: 'round', ...req }, 12000).then((m) => m.result),
      close: () => { try { if (w) w.terminate(); } catch (_) { /* gone */ } w = null; },
    };
  }

  const api = { VERSION: 1, K, withTune, BUILT_READ, builtAgreeOf, lineTiles, edgeTable, fromTable, crowdOnto, project, quickest, scoreLine, reach, explore, streetEdge, deadEndAt, junctionAt, TILE_DEG, FLAG_BITS, NODE_BITS, CLS, UNKNOWN_U8, UNKNOWN_FUN, NO_NAME, packedKey, nodeCost, LEVELS_COPY, levels, distM, bearing, turnAngle, tileOf, keyOf, view, geom, snap, objective, search,
    assemble, through, overlap, sameRoute, tilesFor, loopTiles, plan, pick, loop, roundTrip, hwyOf, isHwyEdge, snapOff, freeQuickest, indexKeys, covers, host, client, edgeId, twin, turnCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexGraphRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
