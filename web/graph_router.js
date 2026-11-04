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
    quick: { budget: 0.10, slackS: 60, perMin: 3.0 },
    fun: { budget: 0.35, slackS: 240, perMin: 1.0 },
    max: { budget: 0.90, slackS: 600, perMin: 0.35 },
  };
  const levels = () => { const F = FunRoute(); return (F && F.LEVELS) || LEVELS_COPY; };
  const TILE_DEG = 0.25;
  // the tile format's tables (web/graph_tiles.js, tools/graph_etl/tiles.py): edge flags, node flags, classes, unknowns
  const FLAG_BITS = { oneway: 1, toll: 2, ferry: 4, unpaved: 8, tunnel: 16, bridge: 32, motorway: 64, ramp: 128, roundabout: 256, private: 512,
    geomRev: 1024, speedEst: 2048, barrier: 4096, destination: 8192 };
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
    PRIVATE_X: 10, PRIVATE_S: 600, DESTINATION_X: 2, DESTINATION_S: 60, FERRY_X: 2, UNPAVED_X: 1.5,
    AVOID_HWY_X: 4, AVOID_TOLL_X: 3, AVOID_FERRY_X: 5, AVOID_UNPAVED_X: 5,
    A_MAX: 40, BISECT: 6,    // the goodness weight is searched in [0, A_MAX] (log steps), at most BISECT more routes
    ALT_PENALTIES: [0.6, 1.5, 4], ALT_MIN_DIFF: 0.3, ALTS: 2,
    LOOP_A: { quick: 0.6, fun: 3, max: 8 }, LOOP_ROAD_FACTOR: 1.35, LOOP_RETRACE_X: 3,
    SNAP_M: 1500, GRID_DEG: 0.01,
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

  /** Our quickest alone (one search): the first route on screen. */
  function quickest(v, req) {
    const level = levels()[req.level] ? req.level : 'fun', obj = objective(v, req);
    const { src, dst } = snapBoth(v, req.from, req.to);
    const sc = startCostFor(v, req.from.heading != null ? req.from.heading : req.heading);
    const r = search(v, obj, src, dst, 0, null, { ...(sc ? { startCost: sc } : {}), ellipse: ellipseFor(req.from, req.to, level) });
    if (!r) throw new Error('no route');
    return assemble(v, r, obj, { level, role: 'quickest', a: 0 });
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
  // the per-edge arrays are a pass over every edge in the view (400k+ with the preloaded area): kept per view for the
  // same driver choices, and rebuilt only when members' data is on the edges (that differs per plan)
  function objective(v, o = {}) {
    if (v.crowd) return objectiveOf(v, o);
    const key = JSON.stringify([o.prefs || null, o.taste || null, o.avoid || null, o.crowdWeights || null, o.nodeCosts !== false]);
    if (!v.objCache) v.objCache = new Map();
    if (!v.objCache.has(key)) { if (v.objCache.size > 8) v.objCache.clear(); v.objCache.set(key, objectiveOf(v, o)); }
    return v.objCache.get(key);
  }
  function objectiveOf(v, o = {}) {
    const prefs = o.prefs || {}, taste = o.taste || {}, avoid = o.avoid || {}, B = flagBits();
    const corner = 1 + 0.25 * ((Number(prefs.tight) || 0) + (Number(prefs.fast) || 0));
    const tq = Number.isFinite(taste.quality) ? taste.quality / (K.W_NOTPOOR + K.W_QUALITY) : 1;
    const wp = K.W_NOTPOOR * tq, wq = K.W_QUALITY * tq;
    const wf = (Number.isFinite(taste.fun) ? taste.fun : K.W_FUN) * Math.max(0.3, corner);
    const ws = Number.isFinite(taste.scenery) ? taste.scenery : K.W_SCENERY;
    const crowd = v.crowd || null, CW = (o.crowdWeights) || K.CROWD_W;
    const E = v.E, bad = new Float32Array(E), mult = new Float32Array(E), add = new Float32Array(E);
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
      const f = fk ? Math.min(1, v.fun[e] / Math.max(0.05, v.len[e] / 1000) / v.funFull) : 0;
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
   * extra cost factors per edge (alternates, loops). Returns { edges, fs, ft, cost, settled } or null.
   */
  function search(v, obj, src, dst, a = 0, penal = null, opts = {}) {
    const S = scratch(v), qid = ++S.qid;
    if (qid === 0xffffffff) { S.stamp.fill(0); S.hs.fill(0); S.qid = 1; }
    const { stamp, g, pred, hs, h } = S;
    const { bad, mult, add, minBad } = obj;
    const tgt = dst[0];
    const hMul = Math.exp(a * minBad) / v.vmax * 0.995;
    const H = (n) => { if (hs[n] !== S.qid) { hs[n] = S.qid; h[n] = distM(v.lat[n], v.lon[n], tgt.lat, tgt.lon) * hMul; } return h[n]; };
    const base = (e) => (v.time[e] * Math.exp(a * bad[e]) * mult[e] + add[e]) * (penal ? penal[e] : 1);
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
        if (head < 0 || !allowed(v, p, e, back) || (bound && !bound(head))) continue;
        const tc = turnCost(v, p, e, obj);
        if (tc === Infinity) continue;
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
    let timeS = 0, distM_ = 0, q = 0, s = 0, sw = 0, f = 0, cf = 0, wsum = 0, junctions = 0, signals = 0;
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
      if (v.quality[e] !== UNKNOWN_U8) { q += (v.quality[e] / 254) * cw; cf += cw; }
      if (v.scenery[e] !== UNKNOWN_U8) { s += (v.scenery[e] / 254) * m; sw += m; }
      if (Number.isFinite(v.fun[e])) f += v.fun[e] * share;
      wsum += m;
      const nm = nameOf(v, e), last = names[names.length - 1];
      if (last && last.name === nm) last.toM = distM_; else names.push({ name: nm, fromM: distM_ - m, toM: distM_ });
      const fl = v.flags[e];
      if (fl & B.motorway || v.cls[e] === CLS.motorway) has.highways = true;
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
      quality: cf > 0 ? q / cf : null, scenery: sw > 0 ? s / sw : null, fun: f, conf: wsum > 0 ? cf / wsum : 0, junctions, signals,
      objective: meta.a ? 't*(1+a*(1-goodness))' : 'time' };
    return {
      coords, edges: E.map((e) => edgeId(v, e)), edgeIdx: Int32Array.from(E), timeS, distM: distM_, names, why,
      route: { coords: coords.map(([la, lo]) => [lo, la]), turns, times, steps, names: nameKm, has, timeS, source: 'own', graph: edgeTable(v, gEdge, gEnd) },
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
    return { a: from, b: to, major: Math.max(crow * (1 + L.budget) * 1.3 + 4000, crow + 6000) };
  }
  function tilesFor(from, to, level = 'fun', o = {}) {
    const L = levels()[level] || levels().fun;
    const crow = distM(from.lat, from.lon, to.lat, to.lon);
    const major = o.majorM || Math.max(crow * (1 + L.budget) * 1.3 + 4000, crow + 6000);
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
   * Quick also bisects (inside its 10 % + 60 s), so a better road at no real cost is offered; the route engine ranks them.
   * req: { from, to, level, prefs, taste, avoid, heading, max }.
   */
  function plan(v, req) {
    const t0 = Date.now(), level = levels()[req.level] ? req.level : 'fun', L = levels()[level];
    const obj = objective(v, req);
    const { src, dst } = snapBoth(v, req.from, req.to);
    const sc = startCostFor(v, req.from.heading != null ? req.from.heading : req.heading);
    const opts = { ...(sc ? { startCost: sc } : {}), ellipse: ellipseFor(req.from, req.to, level) };
    const run = (a, penal = null, role = 'step') => { const r = search(v, obj, src, dst, a, penal, opts); return r ? assemble(v, r, obj, { level, role, a }) : null; };
    const quick = run(0, null, 'quickest');
    if (!quick) throw new Error('no route');
    const limitS = quick.timeS * (1 + L.budget) + L.slackS;
    const found = [quick];
    const keep = (r) => { if (r && !found.some((x) => sameRoute(x, r))) found.push(r); return r; };
    // bisect the goodness weight (log steps): the largest a whose route is inside the budget
    let lo = 0, hi = K.A_MAX, best = quick, tries = 0;
    let a = level === 'quick' ? 1 : level === 'fun' ? 2 : 4;
    while (tries < K.BISECT) {
      tries++;
      const r = run(a);
      if (r && r.timeS <= limitS) { lo = a; best = r; keep(r); } else hi = a;
      if (hi - lo < 0.15 * Math.max(lo, 0.25)) break;
      a = lo > 0 ? Math.sqrt(lo * hi) : hi / 4;
    }
    best.why.role = best === quick ? 'quickest' : 'best';
    // alternates by the penalty method: the chosen route's edges cost more, until a route differs by ALT_MIN_DIFF
    const alts = [], chosen = [best];
    const penal = new Float32Array(v.E).fill(1);
    for (const p of K.ALT_PENALTIES) {
      if (alts.length >= K.ALTS) break;
      for (const r of chosen) for (const e of r.edgeIdx) penal[e] = Math.max(penal[e], 1 + p);
      const r = run(lo, penal, 'alternate');
      if (!r) continue;
      // its real time and cost, not the penalised ones
      if (r.timeS > limitS) continue;
      if (chosen.every((c) => 1 - overlap(v, c, r) >= K.ALT_MIN_DIFF)) { alts.push(r); chosen.push(r); }
    }
    // the pick, the quickest, every step of the bisection (a spectrum from quick to the most good road the budget buys:
    // the route engine, not this objective, has the last word), then the alternates
    const ordered = [best];
    for (const r of [quick, ...found.slice().sort((x, y) => x.why.a - y.why.a), ...alts]) if (!ordered.some((x) => sameRoute(x, r))) ordered.push(r);
    const max = req.max || 7;
    return { routes: ordered.slice(0, max), quick, limitS, a: lo, ms: Date.now() - t0 };
  }
  /**
   * Loops from `start` of about `km`: for each of `dirs` directions a ring through the start (radius from the length and
   * how much longer roads are than the circle), three waypoints round it snapped to through roads, each leg on the level's
   * fixed goodness weight with what earlier legs drove costing LOOP_RETRACE_X. { routes: [{ ...route, retraced, dir }] }.
   */
  function loop(v, req) {
    const t0 = Date.now(), level = levels()[req.level] ? req.level : 'fun', km = Math.max(3, Number(req.km) || 30);
    const obj = objective(v, req), B = flagBits();
    const a = K.LOOP_A[level];
    const dirs = req.dirs || [0, 90, 180, 270];
    const through = (e) => v.cls[e] <= CLS.unclassified && !(v.flags[e] & (B.ramp | B.private | B.destination)) && v.cls[e] !== CLS.motorway;
    const s0 = snap(v, req.start.lat, req.start.lon);
    if (!s0.length) throw new Error('no road near the start');
    const r = km * 1000 / (2 * Math.PI * K.LOOP_ROAD_FACTOR);
    const out = [];
    for (const deg of dirs) {
      const th = deg * RAD, c = Math.cos(req.start.lat * RAD);
      const cen = { lat: req.start.lat + r * Math.cos(th) / 110540, lon: req.start.lon + r * Math.sin(th) / (111320 * c) };
      const pts = [1, 2, 3].map((k) => { const b = th + Math.PI + k * Math.PI / 2; return { lat: cen.lat + r * Math.cos(b) / 110540, lon: cen.lon + r * Math.sin(b) / (111320 * c) }; });
      const snaps = pts.map((p) => { const x = snap(v, p.lat, p.lon, through, 3000); return x.length ? x : snap(v, p.lat, p.lon); });
      if (snaps.some((x) => !x.length)) continue;
      const penal = new Float32Array(v.E).fill(1);
      const legs = [];
      let prev = s0, ok = true;
      for (const nx of [...snaps, s0]) {
        const res = search(v, obj, prev, nx, a, penal);
        if (!res) { ok = false; break; }
        legs.push(res);
        for (const e of res.edges) { penal[e] = K.LOOP_RETRACE_X; const tw = twin(v, e); if (tw >= 0) penal[tw] = K.LOOP_RETRACE_X; }
        // the next leg leaves from where this one arrived, on the edge it arrived on
        const last = res.edges[res.edges.length - 1];
        prev = [{ edge: last, frac: res.ft, lat: 0, lon: 0 }];
      }
      if (!ok) continue;
      // one path: the legs' edges joined (a leg's first edge is the last one's arrival edge, driven on)
      const edges = [], fsAll = legs[0].fs;
      for (const [k, l] of legs.entries()) for (const [m, e] of l.edges.entries()) if (!(k > 0 && m === 0 && edges[edges.length - 1] === e)) edges.push(e);
      const res = { edges, fs: fsAll, ft: legs[legs.length - 1].ft };
      const route = assemble(v, res, obj, { level, role: 'loop', a });
      const used = new Map();
      let retr = 0;
      for (const e of edges) { const k2 = Math.min(e, twin(v, e) >= 0 ? twin(v, e) : e); used.set(k2, (used.get(k2) || 0) + 1); }
      for (const e of edges) { const k2 = Math.min(e, twin(v, e) >= 0 ? twin(v, e) : e); if (used.get(k2) > 1) retr += v.len[e]; }
      route.retraced = route.distM > 0 ? retr / route.distM : 0;
      route.dir = deg;
      if (!out.some((x) => sameRoute(x, route))) out.push(route);
    }
    return { routes: out, ms: Date.now() - t0 };
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
   * Stages from our tiles (Best roads nearby): edges scored quality x corners (fun per km, only on road the engine calls
   * good: quality 0.45 or more) are chained from the best down, each chain growing forward and back along the best
   * continuing edge (a turn under 60°, at least a third of the seed's score, or the same road), until it runs out or
   * reaches 15 km; chains of 2 km or more within reach (maxS) are the stages, as stages.js shapes them ({ lat, lon,
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
      if (q < K.POOR_HI || (v.flags[e] & (B.private | B.barrier | B.ramp)) || v.cls[e] === CLS.motorway || v.cls[e] >= CLS.service) continue;
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
      if (km < 2) continue;
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
        aS: Number.isFinite(aS) ? aS : null, bS: Number.isFinite(bS) ? bS : null, source: 'own' });
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
      const busy = msg && msg.type !== 'preload' && msg.type !== 'covers';
      if (busy) inflight++;
      try { return await handleOne(msg); } finally { if (busy) inflight--; }
    }
    async function handleOne(msg) {
      const { id, type } = msg || {};
      try {
        if (type === 'covers') return { id, covers: covers(await keys(), msg.points || []) };
        if (type === 'quick') {
          // the first route: the tiles already in view when they cover the trip; else only those under the straight line
          // (the ends' and the ones between, loaded in parallel, a small view of their own), the rest come with the plan
          const t0 = Date.now(), line = lineTiles(msg.from, msg.to);
          let v = last && line.every((t) => last.keys.has(keyOf(t.i, t.j))) ? last.v : await smallView(line);
          const t1 = Date.now();
          let r = null;
          try { r = quickest(v, msg); } catch (_) { r = null; }
          if (!r) { v = await viewFor(tilesFor(msg.from, msg.to, msg.level)); r = quickest(v, msg); }   // the line alone had no way
          return { id, result: { route: plain(r), loadMs: t1 - t0, ms: Date.now() - t1, tiles: v.keys } };
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
        if (type === 'plan') {
          // scope 'first': with the corridor's tiles not all in yet, the plan is made on those under the straight line
          // (as the first route was) and says so (partial); the page asks again for the whole corridor meanwhile
          const corridor = tilesFor(msg.from, msg.to, msg.level), have = await keys();
          const missing = corridor.filter((t) => (!have.size || have.has(keyOf(t.i, t.j))) && !ready.has(keyOf(t.i, t.j)));
          const partial = msg.scope === 'first' && missing.length > 0;
          if (partial) for (const t of missing) load(t);                 // fetched now, for the whole-corridor plan
          const v = partial ? await smallView(lineTiles(msg.from, msg.to)) : await viewFor(corridor);
          // members' data for this plan only (the view is kept for the next one, signed in or not)
          v.crowd = msg.crowd ? crowdOnto(v, msg.crowd) : null;
          try {
            const r = plan(v, msg);
            return { id, result: { ...strip(r), tiles: v.keys, partial, crowdEdges: v.crowd ? v.crowd.edges : 0 } };
          } finally { v.crowd = null; }
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
      plan: (req) => ask({ type: 'plan', ...req }).then((m) => m.result),
      quick: (req) => ask({ type: 'quick', ...req }).then((m) => m.result),
      score: (lines) => ask({ type: 'score', lines }, 3000).then((m) => m.result),
      preload: (at) => ask({ type: 'preload', ...at }, 20000).then((m) => m.result),
      explore: (req) => ask({ type: 'explore', ...req }).then((m) => m.result),
      loop: (req) => ask({ type: 'loop', ...req }).then((m) => m.result),
      close: () => { try { if (w) w.terminate(); } catch (_) { /* gone */ } w = null; },
    };
  }

  const api = { VERSION: 1, K, lineTiles, edgeTable, fromTable, crowdOnto, project, quickest, scoreLine, reach, explore, TILE_DEG, FLAG_BITS, NODE_BITS, CLS, UNKNOWN_U8, UNKNOWN_FUN, NO_NAME, packedKey, nodeCost, LEVELS_COPY, levels, distM, bearing, turnAngle, tileOf, keyOf, view, geom, snap, objective, search,
    assemble, overlap, sameRoute, tilesFor, loopTiles, plan, loop, indexKeys, covers, host, client, edgeId, twin, turnCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexGraphRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
