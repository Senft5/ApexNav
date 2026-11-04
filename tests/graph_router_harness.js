// Synthetic graph tiles in the decoded shape of web/graph_tiles.js (ApexGraphTiles.decode), for tests/test_graph_router.py:
// a graph given as nodes and directed edges is cut into 0.25° tiles on the tiles' own grid (an edge lives in its first
// node's tile; one into another tile names that tile's packed key), and a brute-force edge-based Dijkstra checks the A*.
'use strict';
const R = require('../web/graph_router.js');

/** Deterministic random numbers (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const packed = (i, j) => ((i << 16) | j) >>> 0;
const q8 = (v) => (v == null ? 255 : Math.max(0, Math.min(254, Math.round(v * 254))));

/**
 * nodes: [{ lat, lon, flags }]; edges: [{ from, to, t (s), len (m, else along the line), quality, scenery (0..1, null
 * unknown), fun (gated corner points, null unknown), conf (0..1), flags, cls, name, geom: [[lat, lon]...] (inner
 * points) }]; restrictions: [{ from, via, to, only }] in edge and node indices. Returns the decoded tiles and where each
 * input node and edge went ([key, local]).
 */
function tiles(nodes, edges, restrictions = []) {
  const key = (p) => { const t = R.tileOf(p.lat, p.lon); return `${t.i}_${t.j}`; };
  const byTile = new Map();
  nodes.forEach((p, n) => { const k = key(p); if (!byTile.has(k)) byTile.set(k, { nodes: [] }); byTile.get(k).nodes.push(n); });
  const nodeAt = new Map();
  for (const [k, t] of byTile) t.nodes.forEach((n, i) => nodeAt.set(n, [k, i]));
  const out = new Map(), edgeAt = new Map();
  for (const [k, t] of byTile) {
    const [i, j] = k.split('_').map(Number), self = packed(i, j);
    const local = t.nodes.map(() => []);
    edges.forEach((e, ix) => { const at = nodeAt.get(e.from); if (at[0] === k) local[at[1]].push(ix); });
    const order = [].concat(...local);
    order.forEach((ix, li) => edgeAt.set(ix, [k, li]));
    const n = t.nodes.length, m = order.length;
    const firstEdge = new Uint32Array(n + 1);
    for (let a = 0; a < n; a++) firstEdge[a + 1] = firstEdge[a] + local[a].length;
    const E = { count: m, to: new Uint32Array(m), toTile: new Uint32Array(m), len_dm: new Uint32Array(m), t_ds: new Uint32Array(m), quality: new Uint8Array(m), scenery: new Uint8Array(m),
      fun: new Uint16Array(m), conf: new Uint8Array(m), flags: new Uint16Array(m), cls: new Uint8Array(m), speed: new Uint8Array(m), name: new Uint16Array(m), hIn: new Uint8Array(m), hOut: new Uint8Array(m) };
    const names = [], nameIx = new Map(), geoms = [];
    order.forEach((ix, li) => {
      const e = edges[ix], [tk, tl] = nodeAt.get(e.to), a = nodes[e.from], b = nodes[e.to];
      E.to[li] = tl;
      const [ti, tj] = tk.split('_').map(Number);
      E.toTile[li] = packed(ti, tj);
      const r6 = (x) => Math.round(x * 1e6) / 1e6;
      const pts = [[r6(a.lat), r6(a.lon)], ...(e.geom || []).map(([la, lo]) => [r6(la), r6(lo)]), [r6(b.lat), r6(b.lon)]];
      let L = 0;
      for (let q = 1; q < pts.length; q++) L += R.distM(pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1]);
      const len = e.len != null ? Math.max(e.len, L) : L;
      E.len_dm[li] = Math.round(len * 10);
      E.t_ds[li] = Math.max(1, Math.round((e.t != null ? e.t : len / 13.4) * 10));
      E.quality[li] = q8(e.quality === undefined ? 0.65 : e.quality); E.scenery[li] = q8(e.scenery === undefined ? 0.5 : e.scenery);
      E.fun[li] = e.fun === null ? 0xffff : Math.round((e.fun || 0) * 100);
      E.conf[li] = Math.round(255 * (e.conf != null ? e.conf : 1)); E.flags[li] = e.flags || 0; E.cls[li] = e.cls != null ? e.cls : 4;
      E.speed[li] = Math.min(255, Math.round(len / (E.t_ds[li] / 10) * 3.6));
      if (e.name) { if (!nameIx.has(e.name)) { nameIx.set(e.name, names.length); names.push(e.name); } E.name[li] = nameIx.get(e.name); } else E.name[li] = 0xffff;
      geoms.push(Float64Array.from([].concat(...pts)));
      // the bearing over the first and last 60 m in 256ths of a turn, as the ETL writes it
      const turn = (b) => ((Math.round(b / (2 * Math.PI) * 256) % 256) + 256) % 256;
      let k = 1;
      while (k < pts.length - 1 && R.distM(pts[0][0], pts[0][1], pts[k][0], pts[k][1]) < 60) k++;
      E.hIn[li] = turn(R.bearing(pts[0][0], pts[0][1], pts[k][0], pts[k][1]));
      let z = pts.length - 2;
      while (z > 0 && R.distM(pts[z][0], pts[z][1], pts[pts.length - 1][0], pts[pts.length - 1][1]) < 60) z--;
      E.hOut[li] = turn(R.bearing(pts[z][0], pts[z][1], pts[pts.length - 1][0], pts[pts.length - 1][1]));
    });
    const lat = Int32Array.from(t.nodes.map((q) => Math.round(nodes[q].lat * 1e6))), lon = Int32Array.from(t.nodes.map((q) => Math.round(nodes[q].lon * 1e6)));
    const flags = Uint8Array.from(t.nodes.map((q) => nodes[q].flags || 0));
    out.set(k, { tile: { i, j, key: self, refs: [] }, nodes: { count: n, lat, lon, firstEdge, flags }, edges: E, restrictions: [], names, geom: (e) => geoms[e] });
  }
  for (const r of restrictions) {
    const [kv, lv] = nodeAt.get(r.via), [kf, lf] = edgeAt.get(r.from), [kt, lt] = edgeAt.get(r.to);
    if (kt !== kv) continue;                                   // the to-edge leaves the via node: always its tile
    const [fi, fj] = kf.split('_').map(Number);
    out.get(kv).restrictions.push({ fromEdge: lf, fromTile: packed(fi, fj), via: lv, toEdge: lt, only: !!r.only });
  }
  return { tiles: [...out.values()], nodeAt, edgeAt };
}

/**
 * A city-like grid: nx × ny junctions `stepDeg` apart from (lat0, lon0), both directions on each street unless one-way
 * (share `oneway`), some streets missing (share `holes`), streets wobbling (a mid point off the line), random quality,
 * scenery, fun and class: arterials every `artEvery` streets are faster and plainer, the rest slower and nicer.
 */
function grid(o = {}) {
  const r = rng(o.seed || 1), nx = o.nx || 10, ny = o.ny || 10, st = o.stepDeg || 0.004, lat0 = o.lat0 != null ? o.lat0 : 39.1, lon0 = o.lon0 != null ? o.lon0 : -84.6;
  const nodes = [], edges = [];
  const id = (x, y) => y * nx + x;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) nodes.push({ lat: lat0 + y * st + (r() - 0.5) * st * 0.2, lon: lon0 + x * st * 1.3 + (r() - 0.5) * st * 0.2, flags: r() < (o.signals || 0) ? 1 : 0 });
  const add = (a, b, art, name) => {
    if (r() < (o.holes || 0)) return;
    const pa = nodes[a], pb = nodes[b], wob = o.wobble !== false ? [[(pa.lat + pb.lat) / 2 + (r() - 0.5) * st * 0.15, (pa.lon + pb.lon) / 2 + (r() - 0.5) * st * 0.15]] : [];
    const len = R.distM(pa.lat, pa.lon, wob.length ? wob[0][0] : pb.lat, wob.length ? wob[0][1] : pb.lon) + (wob.length ? R.distM(wob[0][0], wob[0][1], pb.lat, pb.lon) : 0);
    const v = art ? 20 + r() * 6 : 9 + r() * 8;
    const unk = r() < 0.08;
    const props = { quality: unk ? null : art ? 0.3 + r() * 0.25 : 0.4 + r() * 0.6, scenery: unk ? null : r(), fun: unk ? null : art ? 0 : r() * 4, conf: unk ? 0 : 0.8 + r() * 0.2, cls: art ? 2 : 5, name };
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

/** Decoded tiles as plain JSON for the Python writer (tools/graph_etl/tiles.py Tile / Edge / Restriction fields). */
function dump(list) {
  const un = (k) => [k >>> 16, k & 0xffff];
  const f8 = (b) => (b === 255 ? null : b / 254);
  return list.map((t) => {
    const E = t.edges, edges = [], geoms = [];
    for (let a = 0; a < t.nodes.lat.length; a++) for (let e = t.nodes.firstEdge[a]; e < t.nodes.firstEdge[a + 1]; e++) {
      const g = t.geom(e), poly = [];
      for (let q = 0; q < g.length; q += 2) poly.push([Math.round(g[q] * 1e6), Math.round(g[q + 1] * 1e6)]);
      geoms.push(poly);
      edges.push({ from: a, to: E.to[e], to_tile: E.toTile[e] === t.tile.key ? null : un(E.toTile[e]), len_dm: E.len_dm[e], t_ds: E.t_ds[e], quality: f8(E.quality[e]), scenery: f8(E.scenery[e]),
        fun: E.fun[e] === 0xffff ? null : E.fun[e] / 100, conf: E.conf[e] / 255, flags: E.flags[e], cls: E.cls[e], speed: E.speed[e], name: E.name[e] === 0xffff ? null : t.names[E.name[e]],
        geom: geoms.length - 1, h_in: E.hIn[e], h_out: E.hOut[e] });
    }
    return { i: t.tile.i, j: t.tile.j, lat: Array.from(t.nodes.lat), lon: Array.from(t.nodes.lon), node_flags: Array.from(t.nodes.flags), edges, geoms,
      restrictions: t.restrictions.map((r) => ({ from_edge: r.fromEdge, from_tile: r.fromTile === t.tile.key ? null : un(r.fromTile), via: r.via, to_edge: r.toEdge, only: r.only })) };
  });
}

module.exports = { rng, tiles, grid, brute, dump, packed, q8, R };
