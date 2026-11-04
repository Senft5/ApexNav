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
  // edge flag bits (docs/OWN_ROUTING.md §4); the tile reader's own table wins when it has one
  const FLAG_BITS = { oneway: 1, toll: 2, ferry: 4, unpaved: 8, tunnel: 16, bridge: 32, motorway: 64, ramp: 128, roundabout: 256, private: 512, signal: 1024, stop: 2048 };
  const flagBits = () => { const T = root.ApexGraphTiles; return (T && T.FLAGS) || FLAG_BITS; };
  // road classes, Valhalla's codes (the route engine's road_class): 0 motorway .. 7 service
  const CLS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, service: 7 };

  // ---- the objective's knobs ------------------------------------------------------------------------------------------
  const K = {
    UNKNOWN_G: 0.3,          // goodness of an edge nobody knew (conf 0): below the middle, so unknown road can't win
    GATE_LO: 0.25, GATE_HI: 0.6,   // the route engine's corner gate: corners count nothing on quality 0.25, in full from 0.6
    W_QUALITY: 0.5, W_FUN: 0.3, W_SCENERY: 0.2,
    FUN_FULL_PCT: 0.9,       // fun per km that counts as full: the loaded network's 90th percentile of edges with corners
    TURN_RIGHT_S: 2, TURN_RIGHT_K: 4, TURN_LEFT_S: 5, TURN_LEFT_K: 8, STRAIGHT_RAD: 0.35, UTURN_S: 30,
    SIGNAL_S: 10, STOP_S: 5, // at the node an edge ends on, from its flags (only where the tiles mark them)
    PRIVATE_X: 10, PRIVATE_S: 600, FERRY_X: 2, UNPAVED_X: 1.5,
    AVOID_HWY_X: 4, AVOID_TOLL_X: 3, AVOID_FERRY_X: 5, AVOID_UNPAVED_X: 5,
    A_MAX: 24, BISECT: 5,    // the goodness weight is searched in [0, A_MAX] (log steps), at most BISECT more routes
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
  const tileOf = (lat, lon) => ({ i: Math.floor(lat / TILE_DEG), j: Math.floor(lon / TILE_DEG) });
  const keyOf = (i, j) => `${i}_${j}`;

  // ---- the multi-tile view ---------------------------------------------------------------------------------------------
  function refKey(ref) {
    if (ref == null) return null;
    if (typeof ref === 'string') return ref;
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
    const fun = new Float32Array(E), flags = new Uint16Array(E), cls = new Uint8Array(E), speed = new Uint8Array(E);
    let vmax = 1;
    list.forEach((t, k) => {
      const nb = nodeBase[k], eb = edgeBase[k], n = t.nodes.lat.length, ed = t.edges;
      const refs = t.refs || (t.tile && t.tile.refs) || [];
      const refIdx = refs.map((r) => { const key = refKey(r); return key != null && index.has(key) ? index.get(key) : -1; });
      for (let a = 0; a < n; a++) {
        lat[nb + a] = t.nodes.lat[a] / 1e6; lon[nb + a] = t.nodes.lon[a] / 1e6;
        first[nb + a] = eb + t.nodes.firstEdge[a];
        for (let e = t.nodes.firstEdge[a]; e < t.nodes.firstEdge[a + 1]; e++) tail[eb + e] = nb + a;
      }
      for (let e = 0; e < ed.to.length; e++) {
        const g = eb + e, tt = ed.toTile ? ed.toTile[e] : -1;
        if (tt < 0) to[g] = nb + ed.to[e];
        else { const o = refIdx[tt]; to[g] = o >= 0 && o != null ? nodeBase[o] + ed.to[e] : -1; }
        eTile[g] = k;
        len[g] = ed.len_dm[e] / 10; time[g] = Math.max(0.1, ed.t_ds[e] / 10);
        quality[g] = ed.quality[e]; scenery[g] = ed.scenery[e]; conf[g] = ed.conf[e]; fun[g] = ed.fun[e];
        flags[g] = ed.flags[e]; cls[g] = ed.cls[e]; speed[g] = ed.speed ? ed.speed[e] : 0;
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
    // turn restrictions, by the edge they start from (tile-local ids in each tile's table)
    const restr = new Map();
    list.forEach((t, k) => {
      for (const r of t.restrictions || []) {
        const from = edgeBase[k] + r.fromEdge, toE = r.toTile != null && r.toTile >= 0 ? null : edgeBase[k] + r.toEdge;
        if (toE == null) continue;
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
      time, len, quality, scenery, conf, fun, flags, cls, speed, vmax, rfirst, redge, deadEnd, restr, funFull,
      grid: { i0: gi0, j0: gj0, W: GW, H: GH, start: cellStart, nodes: cellNodes },
      hIn: new Float32Array(E).fill(NaN), hOut: new Float32Array(E).fill(NaN),
      scratch: null, bits: flagBits(), hasRestr: new Uint8Array(E),
    };
    for (const e of restr.keys()) v.hasRestr[e] = 1;
    return v;
  }

  /** The edge's line, [lat, lon, ...] in degrees, from its tail node to its head node. */
  function geom(v, e) {
    const k = v.eTile[e], t = v.tiles[k], local = e - v.edgeBase[k];
    let g = null;
    try { g = typeof t.geom === 'function' ? t.geom(local) : null; } catch (_) { g = null; }
    const a = v.tail[e], b = v.to[e];
    const pts = [];
    if (!g || g.length < 4 || distM(g[0], g[1], v.lat[a], v.lon[a]) > 1) pts.push(v.lat[a], v.lon[a]);
    if (g) for (let i = 0; i + 1 < g.length; i += 2) pts.push(g[i], g[i + 1]);
    if (b >= 0 && distM(pts[pts.length - 2], pts[pts.length - 1], v.lat[b], v.lon[b]) > 1) pts.push(v.lat[b], v.lon[b]);
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
    const k = v.eTile[e], t = v.tiles[k], ix = t.edges.name ? t.edges.name[e - v.edgeBase[k]] : null;
    return ix != null && t.names && t.names[ix] ? t.names[ix] : null;
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

  // ---- the objective ---------------------------------------------------------------------------------------------------
  /**
   * Per-edge goodness 0..1 (quality, gated fun and scenery blended with the driver's taste; unknown pulled to UNKNOWN_G by
   * how little was known) as `bad` = 1 − goodness, and the avoid/flag multiplier `mult` (≥ 1) and adder `add` (seconds).
   * prefs: { tight, fast } (−1..1, the corner prefs), taste: { quality, fun, scenery } weights; avoid: the Plan sheet's.
   */
  function objective(v, o = {}) {
    const prefs = o.prefs || {}, taste = o.taste || {}, avoid = o.avoid || {}, B = flagBits();
    const corner = 1 + 0.25 * ((Number(prefs.tight) || 0) + (Number(prefs.fast) || 0));
    const wq = Number.isFinite(taste.quality) ? taste.quality : K.W_QUALITY;
    const wf = (Number.isFinite(taste.fun) ? taste.fun : K.W_FUN) * Math.max(0.3, corner);
    const ws = Number.isFinite(taste.scenery) ? taste.scenery : K.W_SCENERY;
    const wsum = Math.max(1e-6, wq + wf + ws);
    const E = v.E, bad = new Float32Array(E), mult = new Float32Array(E), add = new Float32Array(E);
    let minBad = 1;
    for (let e = 0; e < E; e++) {
      const q = v.quality[e] / 255, s = v.scenery[e] / 255, cf = v.conf[e] / 255;
      const gate = clamp01((q - K.GATE_LO) / (K.GATE_HI - K.GATE_LO));
      const f = Math.min(1, v.fun[e] / Math.max(0.05, v.len[e] / 1000) / v.funFull);
      const raw = (wq * q + wf * f * gate + ws * s * (0.5 + 0.5 * gate)) / wsum;
      const g = cf * raw + (1 - cf) * K.UNKNOWN_G;
      bad[e] = 1 - g;
      if (bad[e] < minBad) minBad = bad[e];
      const fl = v.flags[e];
      let m = 1, ad = 0;
      if (fl & B.private) { m *= K.PRIVATE_X; ad += K.PRIVATE_S; }
      if (fl & B.ferry) m *= avoid.ferries ? K.AVOID_FERRY_X : K.FERRY_X;
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
    if (obj.nodeCosts && ways >= 2) {
      const fl = v.flags[p];
      if (fl & B.signal) c += K.SIGNAL_S;
      else if (fl & B.stop) c += K.STOP_S;
    }
    return c;
  }
  function allowed(v, p, e) {
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
    const hMul = (1 + a * minBad) / v.vmax * 0.995;
    const H = (n) => { if (hs[n] !== S.qid) { hs[n] = S.qid; h[n] = distM(v.lat[n], v.lon[n], tgt.lat, tgt.lon) * hMul; } return h[n]; };
    const base = (e) => (v.time[e] * (1 + a * bad[e]) * mult[e] + add[e]) * (penal ? penal[e] : 1);
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
    let popK = 0, bestGoal = Infinity, bestEdge = -1, direct = null;
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
    while (S.hn > 0) {
      const p = pop();
      if (popK >= bestGoal) break;
      const gp = g[p], node = v.to[p];
      if (popK - H(node) > gp + 1e-6) continue;                          // stale
      if (++settled > maxSettle) break;
      for (let e = v.first[node]; e < v.first[node + 1]; e++) {
        const head = v.to[e];
        if (head < 0 || !allowed(v, p, e)) continue;
        const tc = turnCost(v, p, e, obj);
        if (tc === Infinity) continue;
        const be = base(e), x = gp + tc + be;
        if (stamp[e] !== qid || x < g[e] - 1e-9) {
          stamp[e] = qid; g[e] = x; pred[e] = p;
          push(x + H(head), e);
          if (dstMap.has(e)) {
            const cand = x - (1 - dstMap.get(e)) * be;
            if (cand < bestGoal) { bestGoal = cand; bestEdge = e; direct = null; }
          }
        }
      }
    }
    if (bestEdge < 0) return null;
    if (direct != null) {
      const s = src.find((x) => x.edge === bestEdge && x.frac === direct);
      return { edges: [bestEdge], fs: s.frac, ft: dstMap.get(bestEdge), cost: bestGoal, settled };
    }
    const edges = [];
    for (let e = bestEdge; e >= 0; e = pred[e]) { edges.push(e); if (edges.length > v.E) return null; }
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
    let timeS = 0, distM_ = 0, q = 0, s = 0, f = 0, cf = 0, wsum = 0, junctions = 0, signals = 0;
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
        if (ways >= 2 && (fl & B.signal)) signals++;
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
      for (let i = coords.length ? 1 : 0; i < pts.length; i++) coords.push(pts[i]);
      const m = v.len[e] * share, sec = v.time[e] * share;
      // the first and last edge: their share of the time
      if (k === 0) times.push([pts[0][1], pts[0][0], 0]);
      timeS += sec; distM_ += m;
      const cw = (v.conf[e] / 255) * m;
      q += (v.quality[e] / 255) * cw; s += (v.scenery[e] / 255) * cw; f += v.fun[e] * share; cf += cw; wsum += m;
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
    for (const n of names) if (n.name) nameKm.set(n.name, (nameKm.get(n.name) || 0) + (n.toM - n.fromM));
    const why = { source: 'own', level: meta.level || null, role: meta.role || null, a: meta.a != null ? meta.a : 0,
      quality: cf > 0 ? q / cf : null, scenery: cf > 0 ? s / cf : null, fun: f, conf: wsum > 0 ? cf / wsum : 0, junctions, signals,
      objective: meta.a ? 't*(1+a*(1-goodness))' : 'time' };
    return {
      coords, edges: E.map((e) => edgeId(v, e)), edgeIdx: Int32Array.from(E), timeS, distM: distM_, names, why,
      route: { coords: coords.map(([la, lo]) => [lo, la]), turns, times, steps, names: nameKm, has, timeS, source: 'own' },
    };
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
  function tilesFor(from, to, level = 'fun', o = {}) {
    const L = levels()[level] || levels().fun;
    const crow = distM(from.lat, from.lon, to.lat, to.lon);
    const major = o.majorM || Math.max(crow * (1 + L.budget) * 1.3 + 4000, crow + 6000);
    const pad = (major - crow) / 2 + 1000;
    const midLat = (from.lat + to.lat) / 2, dLat = pad / 110540, dLon = pad / (111320 * Math.cos(midLat * RAD));
    const s = Math.min(from.lat, to.lat) - dLat, n = Math.max(from.lat, to.lat) + dLat, w = Math.min(from.lon, to.lon) - dLon, e = Math.max(from.lon, to.lon) + dLon;
    const out = [];
    for (let i = Math.floor(s / TILE_DEG); i <= Math.floor(n / TILE_DEG); i++) {
      for (let j = Math.floor(w / TILE_DEG); j <= Math.floor(e / TILE_DEG); j++) {
        // the tile's nearest point to the ellipse: sample its rectangle 6 × 6 (tiles are 25 km; the ellipse is wider)
        let hit = false;
        for (let a = 0; a <= 5 && !hit; a++) for (let b = 0; b <= 5 && !hit; b++) {
          const la = Math.min(n, Math.max(s, (i + a / 5) * TILE_DEG)), lo = Math.min(e, Math.max(w, (j + b / 5) * TILE_DEG));
          if (distM(la, lo, from.lat, from.lon) + distM(la, lo, to.lat, to.lon) <= major + 2000) hit = true;
        }
        const ci = tileOf(from.lat, from.lon), cj = tileOf(to.lat, to.lon);
        if (hit || (i === ci.i && j === ci.j) || (i === cj.i && j === cj.j)) out.push({ i, j });
      }
    }
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
    const opts = sc ? { startCost: sc } : {};
    const run = (a, penal = null, role = 'step') => { const r = search(v, obj, src, dst, a, penal, opts); return r ? assemble(v, r, obj, { level, role, a }) : null; };
    const quick = run(0, null, 'quick');
    if (!quick) throw new Error('no route');
    const limitS = quick.timeS * (1 + L.budget) + L.slackS;
    const found = [quick];
    const keep = (r) => { if (r && !found.some((x) => sameRoute(x, r))) found.push(r); return r; };
    // bisect the goodness weight (log steps): the largest a whose route is inside the budget
    let lo = 0, hi = K.A_MAX, best = quick, tries = 0;
    let a = level === 'quick' ? 1 : level === 'fun' ? 3 : 8;
    while (tries < K.BISECT) {
      tries++;
      const r = run(a);
      if (r && r.timeS <= limitS) { lo = a; best = r; keep(r); } else hi = a;
      if (hi - lo < 0.15 * Math.max(lo, 0.25)) break;
      a = lo > 0 ? Math.sqrt(lo * hi) : hi / 4;
    }
    best.why.role = best === quick ? 'quick' : level;
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
    const ordered = [best, ...alts];
    if (!ordered.some((x) => sameRoute(x, quick))) ordered.push(quick);
    for (const r of found) if (!ordered.some((x) => sameRoute(x, r))) ordered.push(r);
    const max = req.max || 5;
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
    const through = (e) => v.cls[e] <= CLS.unclassified && !(v.flags[e] & (B.ramp | B.private)) && v.cls[e] !== CLS.motorway;
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
    const load = (t) => {
      const k = keyOf(t.i, t.j);
      if (!tiles.has(k)) {
        tiles.set(k, Promise.resolve(env.load(t.i, t.j)).catch(() => null));
        if (tiles.size > 64) tiles.delete(tiles.keys().next().value);
      }
      return tiles.get(k);
    };
    async function viewFor(want) {
      const have = await keys();
      const list = want.filter((t) => !have.size || have.has(keyOf(t.i, t.j)));
      const got = (await Promise.all(list.map(load))).filter(Boolean);
      const key = got.map((t) => keyOf(t.tile.i, t.tile.j)).sort().join(',');
      if (last && last.key === key) return last.v;
      last = { key, v: view(got) };
      return last.v;
    }
    async function handle(msg) {
      const { id, type } = msg || {};
      try {
        if (type === 'covers') return { id, covers: covers(await keys(), msg.points || []) };
        if (type === 'plan') {
          const v = await viewFor(tilesFor(msg.from, msg.to, msg.level));
          const r = plan(v, msg);
          return { id, result: { ...strip(r), tiles: v.keys } };
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
    const { edgeIdx, ...rest } = r;
    return { ...rest, route: { ...r.route, names: r.route.names } };
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
      loop: (req) => ask({ type: 'loop', ...req }).then((m) => m.result),
      close: () => { try { if (w) w.terminate(); } catch (_) { /* gone */ } w = null; },
    };
  }

  const api = { VERSION: 1, K, TILE_DEG, FLAG_BITS, CLS, LEVELS_COPY, levels, distM, bearing, turnAngle, tileOf, keyOf, view, geom, snap, objective, search,
    assemble, overlap, sameRoute, tilesFor, loopTiles, plan, loop, indexKeys, covers, host, client, edgeId, twin, turnCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexGraphRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
