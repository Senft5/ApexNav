// Synthetic graph tiles in the decoded shape of web/graph_tiles.js (ApexGraphTiles.decode), for tests/test_graph_router.py:
// a graph given as nodes and directed edges is cut into 0.25° tiles (an edge lives in its first node's tile; one into
// another tile names it through the tile's refs), and a brute-force edge-based Dijkstra checks the router's A*.
'use strict';
const R = require('../web/graph_router.js');

/** Deterministic random numbers (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * nodes: [{ lat, lon }]; edges: [{ from, to, t (s), len (m, else the straight line), quality, scenery, fun, conf (0..255),
 * flags, cls, name, geom: [[lat, lon]...] (inner points) }]; restrictions: [{ from, via, to, only }] in edge indices.
 * Returns decoded tiles, and maps from the input's node and edge indices to [tileKey, local].
 */
function tiles(nodes, edges, restrictions = []) {
  const D = R.TILE_DEG, key = (p) => `${Math.floor(p.lat / D)}_${Math.floor(p.lon / D)}`;
  const byTile = new Map();
  nodes.forEach((p, n) => { const k = key(p); if (!byTile.has(k)) byTile.set(k, { nodes: [], edges: [] }); byTile.get(k).nodes.push(n); });
  const nodeAt = new Map();                                   // input node -> [key, local]
  for (const [k, t] of byTile) t.nodes.forEach((n, i) => nodeAt.set(n, [k, i]));
  const out = [], edgeAt = new Map();
  for (const [k, t] of byTile) {
    const [i, j] = k.split('_').map(Number);
    const local = t.nodes.map(() => []);
    edges.forEach((e, ix) => { const at = nodeAt.get(e.from); if (at[0] === k) local[at[1]].push(ix); });
    const order = [].concat(...local);
    order.forEach((ix, li) => edgeAt.set(ix, [k, li]));
    const n = t.nodes.length, m = order.length;
    const firstEdge = new Uint32Array(n + 1);
    for (let a = 0; a < n; a++) firstEdge[a + 1] = firstEdge[a] + local[a].length;
    const refs = [], refIx = new Map();
    const E = { to: new Uint32Array(m), toTile: new Int32Array(m), len_dm: new Uint32Array(m), t_ds: new Uint32Array(m), quality: new Uint8Array(m), scenery: new Uint8Array(m),
      fun: new Uint16Array(m), conf: new Uint8Array(m), flags: new Uint16Array(m), cls: new Uint8Array(m), speed: new Uint8Array(m), name: new Uint32Array(m) };
    const names = [''], nameIx = new Map([['', 0]]), geoms = [];
    order.forEach((ix, li) => {
      const e = edges[ix], [tk, tl] = nodeAt.get(e.to), a = nodes[e.from], b = nodes[e.to];
      E.to[li] = tl;
      if (tk === k) E.toTile[li] = -1;
      else { if (!refIx.has(tk)) { refIx.set(tk, refs.length); const [ri, rj] = tk.split('_').map(Number); refs.push({ i: ri, j: rj }); } E.toTile[li] = refIx.get(tk); }
      const pts = [[a.lat, a.lon], ...(e.geom || []), [b.lat, b.lon]];
      let L = 0;
      for (let q = 1; q < pts.length; q++) L += R.distM(pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1]);
      const len = e.len != null ? Math.max(e.len, L) : L;
      E.len_dm[li] = Math.round(len * 10);
      E.t_ds[li] = Math.max(1, Math.round((e.t != null ? e.t : len / 13.4) * 10));
      E.quality[li] = e.quality != null ? e.quality : 160; E.scenery[li] = e.scenery != null ? e.scenery : 128; E.fun[li] = e.fun || 0;
      E.conf[li] = e.conf != null ? e.conf : 255; E.flags[li] = e.flags || 0; E.cls[li] = e.cls != null ? e.cls : 4; E.speed[li] = Math.round(len / (E.t_ds[li] / 10) * 3.6);
      const nm = e.name || '';
      if (!nameIx.has(nm)) { nameIx.set(nm, names.length); names.push(nm); }
      E.name[li] = nameIx.get(nm);
      geoms.push(Float64Array.from([].concat(...pts)));
    });
    const lat = Int32Array.from(t.nodes.map((q) => Math.round(nodes[q].lat * 1e6))), lon = Int32Array.from(t.nodes.map((q) => Math.round(nodes[q].lon * 1e6)));
    // geometry endpoints at the nodes' stored (microdegree) positions, as the tiles store them
    geoms.forEach((g, li) => { const ix = order[li]; const a = nodes[edges[ix].from], b = nodes[edges[ix].to];
      g[0] = Math.round(a.lat * 1e6) / 1e6; g[1] = Math.round(a.lon * 1e6) / 1e6; g[g.length - 2] = Math.round(b.lat * 1e6) / 1e6; g[g.length - 1] = Math.round(b.lon * 1e6) / 1e6; });
    out.push({ tile: { i, j }, refs, nodes: { lat, lon, firstEdge }, edges: E, restrictions: [], names, geom: (e) => geoms[e] });
  }
  for (const r of restrictions) {
    const [k, lf] = edgeAt.get(r.from), [k2, lt] = edgeAt.get(r.to);
    if (k !== k2) continue;
    out.find((t) => `${t.tile.i}_${t.tile.j}` === k).restrictions.push({ fromEdge: lf, viaNode: nodeAt.get(r.via)[1], toEdge: lt, only: !!r.only });
  }
  return { tiles: out, nodeAt, edgeAt };
}

/**
 * A city-like grid: nx × ny junctions `stepDeg` apart from (lat0, lon0), both directions on each street unless one-way
 * (share `oneway`), some streets missing (share `holes`), streets wobbling (inner geometry points), with random quality,
 * scenery, fun and class: arterials every `artEvery` streets are faster and plainer, the rest slower and nicer.
 */
function grid(o = {}) {
  const r = rng(o.seed || 1), nx = o.nx || 10, ny = o.ny || 10, st = o.stepDeg || 0.004, lat0 = o.lat0 != null ? o.lat0 : 39.1, lon0 = o.lon0 != null ? o.lon0 : -84.6;
  const nodes = [], edges = [];
  const id = (x, y) => y * nx + x;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) nodes.push({ lat: lat0 + y * st + (r() - 0.5) * st * 0.2, lon: lon0 + x * st * 1.3 + (r() - 0.5) * st * 0.2 });
  const add = (a, b, art, name) => {
    if (r() < (o.holes || 0)) return;
    const pa = nodes[a], pb = nodes[b], wob = o.wobble !== false ? [[(pa.lat + pb.lat) / 2 + (r() - 0.5) * st * 0.15, (pa.lon + pb.lon) / 2 + (r() - 0.5) * st * 0.15]] : [];
    const len = R.distM(pa.lat, pa.lon, wob.length ? wob[0][0] : pb.lat, wob.length ? wob[0][1] : pb.lon) + (wob.length ? R.distM(wob[0][0], wob[0][1], pb.lat, pb.lon) : 0);
    const v = art ? 20 + r() * 6 : 9 + r() * 8;
    const props = { quality: art ? 70 + Math.floor(r() * 60) : 100 + Math.floor(r() * 150), scenery: Math.floor(r() * 255), fun: art ? 0 : Math.floor(r() * 400), conf: r() < 0.1 ? 0 : 200 + Math.floor(r() * 55), cls: art ? 2 : 5, name };
    const one = r() < (o.oneway || 0) ? (r() < 0.5 ? 1 : -1) : 0;
    if (one >= 0) edges.push({ from: a, to: b, t: len / v, geom: wob, ...props, flags: one ? 1 : 0 });
    if (one <= 0) edges.push({ from: b, to: a, t: len / v, geom: wob.slice().reverse(), ...props, flags: one ? 1 : 0 });
  };
  const ae = o.artEvery || 4;
  for (let y = 0; y < ny; y++) for (let x = 0; x + 1 < nx; x++) add(id(x, y), id(x + 1, y), y % ae === 0, `Row ${y}`);
  for (let x = 0; x < nx; x++) for (let y = 0; y + 1 < ny; y++) add(id(x, y), id(x, y + 1), x % ae === 0, `Col ${x}`);
  return { nodes, edges };
}

/** Brute-force edge-based Dijkstra (linear scan, no heuristic) with the router's own costs: the optimum A* must match. */
function brute(v, obj, src, dst, a = 0, penal = null) {
  const base = (e) => (v.time[e] * (1 + a * obj.bad[e]) * obj.mult[e] + obj.add[e]) * (penal ? penal[e] : 1);
  const g = new Float64Array(v.E).fill(Infinity), done = new Uint8Array(v.E);
  for (const s of src) g[s.edge] = Math.min(g[s.edge], (1 - s.frac) * base(s.edge));
  let best = Infinity;
  for (const s of src) for (const d of dst) if (d.edge === s.edge && d.frac >= s.frac) best = Math.min(best, (d.frac - s.frac) * base(s.edge));
  const dstF = new Map(dst.map((d) => [d.edge, d.frac]));
  for (;;) {
    let p = -1, m = Infinity;
    for (let e = 0; e < v.E; e++) if (!done[e] && g[e] < m) { m = g[e]; p = e; }
    if (p < 0) break;
    done[p] = 1;
    const node = v.to[p];
    if (node < 0) continue;
    for (let e = v.first[node]; e < v.first[node + 1]; e++) {
      if (v.to[e] < 0) continue;
      const rr = v.restr.get(p);
      if (rr && (rr.only.length ? !rr.only.includes(e) : rr.no.includes(e))) continue;
      const tc = R.turnCost(v, p, e, obj);
      if (tc === Infinity) continue;
      const x = g[p] + tc + base(e);
      if (x < g[e]) g[e] = x;
      if (dstF.has(e)) best = Math.min(best, g[p] + tc + dstF.get(e) * base(e));
    }
  }
  return best;
}

module.exports = { rng, tiles, grid, brute, R };
