// Is a posted time attack loop on real through roads? (ta_fixed.ts fixedMake, time_attack.ts makeCircuit.) The server can't
// route, so the first phone in an area builds a loop with Vetta's router and posts it; nothing stopped a hand-drawn one, through
// fields or a housing estate, from becoming the area's loop for a season. This samples the loop every SAMPLE_M (at most MAX_SAMPLES points) and finds the
// nearest road to each sample in Vetta's own graph tiles (the same tiles the phone routed on: web/data/graph/v1 shipped with
// the site, the rest of the region relayed from the graph-data branch, graph.ts). A loop passes when every sample but a few
// lies within NEAR_M of a road and most samples' nearest road is a through road (class unclassified or bigger), as the
// router's `best` loops are. A tile that can't be had is not checked (unknown stays unknown) and the result says so.
//
// The tile reader is a cut-down port of web/graph_tiles.js decode(): only the edge classes and the polylines are read, with
// the same offsets and alignment (tools/graph_etl/tiles.py write_tile is the format). test/loop_check.test.ts checks it on a
// tile written by tiles.py.

import { graphTile } from "./graph";
import { Env, HttpError } from "./util";

export const TILE_DEG = 0.25, SAMPLE_M = 200, NEAR_M = 30;
/** A long loop is sampled more sparsely, to this many points: the check's cost (a free-plan Worker has 10 ms of CPU) grows with them. */
export const MAX_SAMPLES = 60;
/** At most this share of samples may be off every road (the router's line and the tile's can differ by a few metres). */
export const MAX_OFF = 0.03;
/** At most this share of samples may have a residential, service or track road as their nearest. */
export const MAX_MINOR = 0.25;
/** Classes (web/graph_tiles.js CLASS): 0 motorway .. 5 unclassified are through roads; 6 residential, 7 service, 8 track, 9 ferry. */
export const THROUGH_MAX_CLS = 5;
const GEOM_Q = 5, M_LAT = 111195;

export const tileName = (lat: number, lon: number) => `${Math.floor((lon + 180) / TILE_DEG)}_${Math.floor((lat + 90) / TILE_DEG)}`;

type Poly = { cls: number; pts: Float64Array };

/** Degrees: south, west, north, east. */
export type Box = [number, number, number, number];

/** The polylines of a VGR1 tile (versions 1-3) with the lowest class of the edges using each; throws on anything else. With
 *  `box`, only edges that can reach it (their start node within their own length of it) are read: decoding every line of a
 *  tile costs tens of milliseconds, the few near a loop next to nothing. With `near` (the loop's samples) too, only edges that
 *  can come within NEAR_M of a sample. */

export function tilePolylines(u8: Uint8Array, box?: Box, near?: [number, number][]): Poly[] {
  if (u8.length < 64 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "VGR1") throw new Error("not a VGR1 tile");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint16(4, true);
  if (version < 1 || version > 3) throw new Error(`graph tile version ${version}`);
  const hb = dv.getUint16(6, true), ti = dv.getInt32(8, true), tj = dv.getInt32(12, true);
  const n = dv.getUint32(16, true), e = dv.getUint32(20, true), r = dv.getUint32(24, true), nn = dv.getUint32(28, true);
  const nb = dv.getUint32(32, true), gb = dv.getUint32(36, true), nref = dv.getUint32(40, true), wide = dv.getUint8(52) & 1;
  let p = hb + 4 * nref;
  const align = () => { p += (4 - (p % 4)) % 4; };
  const qlat = p; p += 2 * n; const qlon = p; p += 2 * n; align();
  const firstEdge = p; p += 4 * (n + 1) + n; align();            // firstEdge, node flags
  const geomOff = p; p += 4 * e;
  p += (wide ? 4 : 2) * e; const lenAt = p; p += 2 * e + 2 * e + 2 * e + 2 * e + 2 * e; align();   // to, len, t, fun, flags, name
  p += 3 * e; const clsAt = p; p += 5 * e; align();               // quality, scenery, conf, cls, speed, toRef, hIn, hOut
  p += 16 * r;                                                    // restrictions
  p += 4 * (nn + 1) + nb; align();                                // names
  const geo = p;
  if (geo + gb > u8.length) throw new Error("short tile");
  const oLat = Math.round((tj * TILE_DEG - 90) * 1e6), oLon = Math.round((ti * TILE_DEG - 180) * 1e6);
  const seen = new Map<number, number>(), out: Poly[] = [];
  // typed views over the columns (every column starts 4-aligned in the file; a view needs the buffer aligned too)
  const buf = u8.byteOffset % 4 === 0 ? u8 : u8.slice();
  const col16 = (at: number, count: number) => new Uint16Array(buf.buffer, buf.byteOffset + at, count);
  const qa = col16(qlat, n), qo = col16(qlon, n), lens = col16(lenAt, e);
  const fe = new Uint32Array(buf.buffer, buf.byteOffset + firstEdge, n + 1), go = new Uint32Array(buf.buffer, buf.byteOffset + geomOff, e);
  const cos = box ? Math.cos((((box[0] + box[2]) / 2) * Math.PI) / 180) : 1;
  // in quantised tile units (GEOM_Q microdegrees): the box, and the longest an edge can be (len_dm is 16 bits: 6.5 km) plus some
  const U = 1e6 / GEOM_Q, far = ((6600 / M_LAT) * U) / Math.min(cos, 1);
  const bq = box && [(box[0] * 1e6 - oLat) / GEOM_Q, (box[1] * 1e6 - oLon) / GEOM_Q, (box[2] * 1e6 - oLat) / GEOM_Q, (box[3] * 1e6 - oLon) / GEOM_Q];
  const one = (k: number) => {
    const off = go[k], cls = u8[clsAt + k];
    const had = seen.get(off);
    if (had !== undefined) { if (cls < out[had].cls) out[had].cls = cls; return; }     // both directions share a line
    let q = geo + off;
    const rd = () => { let v = 0, s = 0, c; do { c = u8[q++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c >= 0x80); return v; };
    const zz = (v: number) => (v % 2 ? -(v + 1) / 2 : v / 2);
    const cnt = rd(), pts = new Float64Array(cnt * 2);
    let la = Math.floor(oLat / GEOM_Q), lo = Math.floor(oLon / GEOM_Q);
    for (let m = 0; m < cnt; m++) { la += zz(rd()); lo += zz(rd()); pts[2 * m] = (la * GEOM_Q) / 1e6; pts[2 * m + 1] = (lo * GEOM_Q) / 1e6; }
    seen.set(off, out.length);
    out.push({ cls, pts });
  };
  if (!bq) { for (let k = 0; k < e; k++) one(k); return out; }
  if (!near) {
    for (let v = 0; v < n; v++) {
      const a = qa[v], o = qo[v];
      if (a < bq[0] - far || a > bq[2] + far || o < bq[1] - far || o > bq[3] + far) continue;   // no edge from here can reach it
      for (let k = fe[v]; k < fe[v + 1]; k++) {
        const rLat = ((lens[k] / 10 + 50) / M_LAT) * U, rLon = rLat / cos;                    // this edge's length, and some
        if (a < bq[0] - rLat || a > bq[2] + rLat || o < bq[1] - rLon || o > bq[3] + rLon) continue;
        one(k);
      }
    }
    return out;
  }
  // A loop's box is mostly fields and towns it doesn't touch, and the cost of a cold Worker is the scan and the lines read, so
  // it is a bitmap: cells CELL_Q tile units (about 220 m) a side over the box and `far` around it, counting the samples in
  // each (`sum`, summed over [0, i) x [0, j)). An edge is read when a cell within its reach (its length, and NEAR_M) of its
  // start node holds a sample: four reads.
  const CELL_Q = 400, s0 = bq[0] - far, w0 = bq[1] - far, n0 = bq[2] + far, e0 = bq[3] + far;
  const GI = Math.floor((n0 - s0) / CELL_Q) + 1, GJ = Math.floor((e0 - w0) / CELL_Q) + 1, H = GJ + 1;
  const sum = new Int32Array((GI + 1) * H);
  for (const [la, lo] of near) {
    const i = Math.floor(((la * 1e6 - oLat) / GEOM_Q - s0) / CELL_Q), j = Math.floor(((lo * 1e6 - oLon) / GEOM_Q - w0) / CELL_Q);
    if (i >= 0 && j >= 0 && i < GI && j < GJ) sum[(i + 1) * H + j + 1]++;
  }
  for (let i = 1; i <= GI; i++) for (let j = 1; j <= GJ; j++) sum[i * H + j] += sum[(i - 1) * H + j] + sum[i * H + j - 1] - sum[(i - 1) * H + j - 1];
  const picked = scanEdges(qa, qo, fe, lens, n, s0, w0, n0, e0, ((NEAR_M / M_LAT) * U), U, cos, CELL_Q, GI, GJ, sum);
  for (let m = 0; m < picked.length; m++) one(picked[m]);
  return out;
}

/** The edges whose reach (their length, and NEAR_M) from their start node holds a sample cell (tilePolylines). A function of
 *  its own over typed arrays, so V8 optimises it early: the scan is most of a cold check. */
function scanEdges(qa: Uint16Array, qo: Uint16Array, fe: Uint32Array, lens: Uint16Array, n: number, s0: number, w0: number, n0: number,
  e0: number, nearQ: number, U: number, cos: number, CELL_Q: number, GI: number, GJ: number, sum: Int32Array): number[] {
  const H = GJ + 1, kLat = U / M_LAT / 10, bLat = (50 * U) / M_LAT + nearQ, inv = 1 / CELL_Q, icos = 1 / cos, out: number[] = [];
  for (let v = 0; v < n; v++) {
    const a = qa[v], o = qo[v];
    if (a < s0 || a > n0 || o < w0 || o > e0) continue;
    const ca = (a - s0) * inv, co = (o - w0) * inv;
    for (let k = fe[v], k1 = fe[v + 1]; k < k1; k++) {
      const rLat = (lens[k] * kLat + bLat) * inv, rLon = rLat * icos;
      // a node is inside the grid, so i1, j1 >= 0 and | 0 floors them; i0, j0 are only clamped up to 0
      let i0 = (ca - rLat) | 0, i1 = (ca + rLat) | 0, j0 = (co - rLon) | 0, j1 = (co + rLon) | 0;
      if (i0 < 0) i0 = 0;
      if (j0 < 0) j0 = 0;
      if (i1 >= GI) i1 = GI - 1;
      if (j1 >= GJ) j1 = GJ - 1;
      if (sum[(i1 + 1) * H + j1 + 1] - sum[i0 * H + j1 + 1] - sum[(i1 + 1) * H + j0] + sum[i0 * H + j0] > 0) out.push(k);
    }
  }
  return out;
}

const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Points every SAMPLE_M along the line (its first point included), or farther apart on a line longer than MAX_SAMPLES of them. */
export function samplesOf(geom: [number, number][]): [number, number][] {
  let total = 0;
  for (let i = 1; i < geom.length; i++) total += hav(geom[i - 1], geom[i]);
  const step = Math.max(SAMPLE_M, total / MAX_SAMPLES);
  const out: [number, number][] = [geom[0]];
  let carry = 0;
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1], b = geom[i], d = hav(a, b);
    let t = step - carry;
    while (t <= d) { const f = t / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); t += step; }
    carry = d - (t - step);
  }
  return out;
}

export type LoopCheck = { checked: boolean; ok: boolean; samples: number; off: number; minor: number; missing: string[] };

/**
 * Checks the loop against the tiles `load` returns (null: not to be had). A sample whose tile is missing isn't counted; when
 * no sample could be checked the answer is checked: false, ok: true (unknown, not refused).
 */
export async function loopOnRoads(geom: [number, number][], load: (name: string) => Promise<Uint8Array | null>): Promise<LoopCheck> {
  const samples = samplesOf(geom);
  // the tiles the samples are in, and the next tile where a sample is near its edge (an edge is kept in its start node's tile)
  const EDGE_DEG = 0.005, names = [...new Set(samples.flatMap(([la, lo]) =>
    [[0, 0], [EDGE_DEG, 0], [-EDGE_DEG, 0], [0, EDGE_DEG], [0, -EDGE_DEG]].map(([a, b]) => tileName(la + a, lo + b))))];
  const best = samples.map(() => ({ d: Infinity, cls: 255 }));
  const missing: string[] = [];
  const cosLat = Math.cos((samples[0][0] * Math.PI) / 180), mLon = M_LAT * cosLat;
  // samples by a coarse grid (about 110 m), so a road segment looks only at the samples near it
  const CELL = 0.001, grid = new Map<number, number[]>();
  const cellKey = (la: number, lo: number) => Math.floor(la / CELL) * 1e6 + Math.floor(lo / CELL);
  samples.forEach(([la, lo], i) => { const k = cellKey(la, lo); const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); });
  const padLat = NEAR_M / M_LAT, padLon = NEAR_M / mLon;
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [la, lo] of samples) { box[0] = Math.min(box[0], la); box[1] = Math.min(box[1], lo); box[2] = Math.max(box[2], la); box[3] = Math.max(box[3], lo); }
  const inTile = new Set<number>();
  for (const name of names) {
    let bytes: Uint8Array | null = null;
    try { bytes = await load(name); } catch { bytes = null; }
    let polys: Poly[] | null = null;
    if (bytes) { try { polys = tilePolylines(bytes, box, samples); } catch { polys = null; } }
    if (!polys) { missing.push(name); continue; }
    samples.forEach(([la, lo], i) => { if (tileName(la, lo) === name) inTile.add(i); });
    // roads near a tile's edge are in the next tile too (each tile carries the whole of its edges), so any tile's roads count
    for (const { cls, pts } of polys) {
      for (let m = 2; m < pts.length; m += 2) {
        const aLa = pts[m - 2], aLo = pts[m - 1], bLa = pts[m], bLo = pts[m + 1];
        const la0 = Math.min(aLa, bLa) - padLat, la1 = Math.max(aLa, bLa) + padLat;
        const lo0 = Math.min(aLo, bLo) - padLon, lo1 = Math.max(aLo, bLo) + padLon;
        for (let gi = Math.floor(la0 / CELL); gi <= Math.floor(la1 / CELL); gi++) for (let gj = Math.floor(lo0 / CELL); gj <= Math.floor(lo1 / CELL); gj++) {
          const near = grid.get(gi * 1e6 + gj);
          if (!near) continue;
          for (const s of near) {
            const [sLa, sLo] = samples[s];
            // point to segment, flat earth in metres around the sample
            const ax = (aLo - sLo) * mLon, ay = (aLa - sLa) * M_LAT, bx = (bLo - sLo) * mLon, by = (bLa - sLa) * M_LAT;
            const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
            const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
            const d = Math.hypot(ax + t * dx, ay + t * dy);
            const b = best[s];
            // the nearest road wins; within a couple of metres a through road wins over a lane beside it
            if (d < b.d - 2 || (d <= b.d + 2 && cls < b.cls)) { b.d = Math.min(d, b.d); b.cls = cls; }
          }
        }
      }
    }
  }
  const counted = [...inTile];
  if (!counted.length) return { checked: false, ok: true, samples: 0, off: 0, minor: 0, missing };
  const off = counted.filter((i) => best[i].d > NEAR_M).length;
  const minor = counted.filter((i) => best[i].d <= NEAR_M && best[i].cls > THROUGH_MAX_CLS).length;
  const ok = off <= Math.floor(counted.length * MAX_OFF) && minor <= Math.floor(counted.length * MAX_MINOR);
  return { checked: true, ok, samples: counted.length, off, minor, missing };
}

const VGR1 = (u8: Uint8Array) => u8.length >= 4 && u8[0] === 0x56 && u8[1] === 0x47 && u8[2] === 0x52 && u8[3] === 0x31;

/** A tile for the Worker: the copy shipped with the site (ASSETS) when there is one, else the region relay (graph.ts). */
export function workerTiles(env: Env, fetcher: typeof fetch = fetch) {
  return async (name: string): Promise<Uint8Array | null> => {
    if (env.ASSETS) {
      try {
        const r = await env.ASSETS.fetch(new Request(`https://assets.local/data/graph/v1/${name}.vgr`));
        if (r.ok) { const u8 = new Uint8Array(await r.arrayBuffer()); if (VGR1(u8)) return u8; }
      } catch { /* not shipped: the relay */ }
    }
    const r = await graphTile(new Request("https://apexnav.local/"), `${name}.vgr`, fetcher);
    if (!r.ok) return null;
    const u8 = new Uint8Array(await r.arrayBuffer());
    return VGR1(u8) ? u8 : null;
  };
}

/** Throws 400 not_on_roads when the tiles show the loop leaving the through roads; a loop the tiles can't check passes. */
export async function requireOnRoads(env: Env, geom: [number, number][], fetcher: typeof fetch = fetch): Promise<LoopCheck> {
  const res = await loopOnRoads(geom, workerTiles(env, fetcher));
  if (res.checked && !res.ok) throw new HttpError(400, "not_on_roads");
  return res;
}
