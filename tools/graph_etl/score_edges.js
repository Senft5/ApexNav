// Scores every edge of the graph with the app's own model (docs/OWN_ROUTING.md §3): web/route_engine.js per 25 m
// sample (quality, scenery and their confidences), web/fun_route.js's corners gated by that quality, the app's terrain
// code (web/route_ctx/dem.js) on the Terrarium tiles and the context grid (web/route_ctx/context_grid.js) on the shipped
// bundles. No second model: this file only lays each edge out as a corridor, fills the channels the ETL measured, and
// reads the engine's answers back. Loaded as tests/route_engine_harness.js loads them.
//
//   node tools/graph_etl/score_edges.js --in edges.ndjson --out scores.ndjson [--dem DIR] [--ctx web/data/ctx/v1]
//
// In (one JSON per line, tools/graph_etl/build.py chain_record): { k, c: [[lon, lat]...], pre, post: the road's
// continuation outward from each end (up to 100 m, for corners split across a join), ch: { channel: value | null }
// constant along the edge, smp: { channel: [per 25 m sample] }, delay_s (point features inside the edge), name, hw,
// ferry_s }.
// Out: a first line { meta: { model, files } }, then per edge { k, q, s, c, f, t, v, est }: quality and scenery (0..1,
// the length-weighted mean of the known samples, null when none), c the engine's confidence (share of the weight known),
// f the gated corner points (sum of corner weight x quality gate, corners whose apex lies on this edge), t seconds,
// v the posted limit (or the class estimate, est 1) in km/h.
'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const ROOT = path.resolve(__dirname, '..', '..');
const Core = require(path.join(ROOT, 'web/apex_core.js'));
globalThis.ApexCore = Core;
globalThis.ApexSun = require(path.join(ROOT, 'web/sun.js'));
const FunRoute = require(path.join(ROOT, 'web/fun_route.js'));
globalThis.ApexFunRoute = FunRoute;
const Ctx = require(path.join(ROOT, 'web/route_ctx/registry.js'));
const Router = require(path.join(ROOT, 'web/route_ctx/router_edges.js'));
const Dem = require(path.join(ROOT, 'web/route_ctx/dem.js'));
const Grid = require(path.join(ROOT, 'web/route_ctx/context_grid.js'));
globalThis.ApexContextGrid = Grid;
let NameAge = null;
try { globalThis.ApexOsmCommon = require(path.join(ROOT, 'web/route_ctx/osm_common.js')); NameAge = require(path.join(ROOT, 'web/route_ctx/road_name_age.js')); } catch (_) { NameAge = null; }
const Engine = require(path.join(ROOT, 'web/route_engine.js'));

// ---- the travel-time model ----------------------------------------------------------------------------------------
// Free speed: the posted limit (else the app's class estimate) times how fast traffic runs against it; corners capped
// at a comfortable lateral grip (MU_TRAVEL, well under the pace-note envelope's 0.6), braking into them at 2.5 m/s²
// and accelerating out at 1.5; the point features inside the edge add their delay (build.py DELAY_S). The edge's end
// nodes (signals, stops, the turn) are the router's turn cost at query time, not here.
const MU_TRAVEL = 0.3, BRAKE = 2.5, ACCEL = 1.5, MIN_MPS = 2;
const FLOW = { 0: 1.05, 1: 1.03, 2: 1.0, 3: 1.0, 4: 0.97, 5: 0.92, 6: 0.85, 7: 0.75 };
const FERRY_MPS = 4, FERRY_WAIT_S = 300;

function args() {
  const a = {}, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, '')] = v[i + 1];
  return a;
}
/** A stable hash of the model's weights (QUALITY, SCENERY, W, gate, corner weights): index.json's `model`. */
function modelHash() {
  const strip = (t) => ({ ch: t.ch, w: t.w, family: t.family, unless: t.unless || null, probe: [0, 0.5, 1, 2, 5, 10, 30, 56, 72, 89, 105, 1000].map((x) => { try { const g = t.g(x); return Number.isFinite(g) ? +g.toFixed(4) : null; } catch (_) { return null; } }) });
  const body = JSON.stringify({ v: Engine.VERSION, Q: Engine.QUALITY.map(strip), S: Engine.SCENERY.map(strip), W: Engine.W,
    corners: ['HP', 1, 2, 3, 4, 5, 6].map((s) => FunRoute.cornerWeight(s)), time: { MU_TRAVEL, BRAKE, ACCEL, FLOW } });
  return crypto.createHash('sha256').update(body).digest('hex');
}

// ---- data sources the app reads on the phone -----------------------------------------------------------------------
function demTiles(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const lru = new Map(), MAX = 600;
  return {
    get(key) {
      if (lru.has(key)) { const v = lru.get(key); lru.delete(key); lru.set(key, v); return v; }
      const [x, y] = key.split('/'), p = path.join(dir, `${Dem.Z}_${x}_${y}.rgba`);
      const v = fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
      lru.set(key, v);
      while (lru.size > MAX) lru.delete(lru.keys().next().value);
      return v;
    },
  };
}
function gridBundles(dir) {
  const out = new Map();
  if (!dir || !fs.existsSync(path.join(dir, 'index.json'))) return out;
  const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const key of Object.keys(ix.bundles || {})) {
    const p = path.join(dir, String(Grid.project ? 8 : 8), `${key}.vcg`);
    if (!fs.existsSync(p)) continue;
    let b = fs.readFileSync(p);
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
    out.set(key, Grid.parse(new Uint8Array(b.buffer, b.byteOffset, b.length)));
  }
  return out;
}

// ---- one edge -----------------------------------------------------------------------------------------------------
const hav = (a, b) => {
  const r = Math.PI / 180, dp = (b[1] - a[1]) * r, dl = (b[0] - a[0]) * r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const lenOf = (cs) => { let s = 0; for (let i = 1; i < cs.length; i++) s += hav(cs[i - 1], cs[i]); return s; };
const fill = (n, v) => new Float32Array(n).fill(v == null || !Number.isFinite(v) ? NaN : v);
function resampleTo(arr, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = arr[Math.min(arr.length - 1, Math.round(i * (arr.length - 1) / Math.max(1, n - 1)))]; out[i] = v == null ? NaN : v; }
  return out;
}
const DEPART = Date.UTC(2026, 5, 10, 16, 0, 0);     // a June weekday noon: nothing time-dependent is baked in (§3)

function score(rec, src) {
  const coords = rec.c, c = Ctx.corridor(`e${rec.k}`, coords, { departAt: DEPART });
  const lenM = lenOf(coords);
  if (!c) return { k: rec.k, q: null, s: null, c: 0, f: 0, t: Math.max(1, lenM / 10), v: null, est: 1 };
  const n = c.distM.length, ch = {};
  for (const [k, v] of Object.entries(rec.ch || {})) if (v != null) ch[k] = fill(n, v);
  for (const [k, arr] of Object.entries(rec.smp || {})) ch[k] = arr.length === n ? Float32Array.from(arr, (x) => (x == null ? NaN : x)) : resampleTo(arr, n);
  // the speed limit: posted where OSM has it, else the app's class estimate (router_edges.js), flagged
  const posted = rec.ch && Number.isFinite(rec.ch.speed_limit_kph) ? rec.ch.speed_limit_kph : null;
  const rc = rec.ch && rec.ch.road_class, use = rec.ch && rec.ch.road_use;
  if (posted == null) ch.speed_limit_est_kph = Float32Array.from({ length: n }, (_, i) => { const e = Router.estimateLimit(rc, use, ch.density ? ch.density[i] : NaN); return e == null ? NaN : e; });
  if (NameAge && rec.name) { const r = NameAge.score(rec.name, rec.hw); if (r && Number.isFinite(r.score)) ch.name_age = fill(n, r.score); }
  if (src.grid.size) {
    const g = Grid.sampleCorridor(src.grid, c);
    for (const [k, v] of Object.entries(g.channels)) if (v.some(Number.isFinite)) ch[k] = v;
  }
  if (src.dem) {
    const d = Dem.channelsFrom(c, Dem.sampler(src.dem));
    if (d.status !== 'unavailable') for (const [k, v] of Object.entries(d.channels)) ch[k] = v;
  }
  const ctx = { channels: ch, spans: [], points: [] };
  const s = Engine.samples(c, ctx);
  let qs = 0, qn = 0, ss = 0, sn = 0, conf = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(s.quality[i])) { qs += s.quality[i]; qn++; }
    if (Number.isFinite(s.scenery[i])) { ss += s.scenery[i]; sn++; }
    conf += (2 * s.qConf[i] + s.sConf[i]) / 3;
  }
  // corners: on the edge with its road's continuation either side, so a corner across a join is seen whole; counted
  // here only where the apex is on this edge, gated by this edge's quality there
  const pre = (rec.pre || []).slice().reverse(), post = rec.post || [];
  const line = [...pre, ...coords, ...post];
  const preM = pre.length ? lenOf([...pre, coords[0]]) : 0;
  let fun = 0, t = 0;
  if (line.length >= 2) {
    const geo = FunRoute.geometry(line, Core);
    const scale = lenM > 0 && geo.dist.length > 1 ? geo.dist[geo.dist.length - 1] / lenOf(line) : 1;   // 5 m local metres vs haversine
    const a = preM * scale, b = (preM + lenM) * scale;
    for (const e of geo.events) {
      if (!(e.dist_m >= a && e.dist_m < b)) continue;
      const w = FunRoute.cornerWeight(e.severity);
      if (!w) continue;
      const i = Math.max(0, Math.min(n - 1, Math.round((e.dist_m - a) / scale / 25)));
      fun += w * Engine.gate(s.quality[i]);
    }
    // time over the edge's own 5 m samples
    if (rec.ferry_s || rec.hw === 'ferry') t = rec.ferry_s || lenM / FERRY_MPS + FERRY_WAIT_S;
    else {
      const { kappa, ds } = Core.computeCurvature(geo.lat, geo.lon), m = geo.lat.length, v = new Float64Array(m);
      const flow = FLOW[rc] != null ? FLOW[rc] : 0.9;
      for (let k = 0; k < m; k++) {
        const i = Math.max(0, Math.min(n - 1, Math.round((geo.dist[k] - a) / scale / 25)));
        const lim = posted != null ? posted : ch.speed_limit_est_kph ? ch.speed_limit_est_kph[i] : NaN;
        const free = (Number.isFinite(lim) ? lim : 40) / 3.6 * flow;
        const r = 1 / Math.max(Math.abs(kappa[k]), 1e-6);
        v[k] = Math.max(MIN_MPS, Math.min(free, Core.apexSpeedMps(r, 0, MU_TRAVEL)));
      }
      for (let k = m - 2; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * BRAKE * ds[k]));
      for (let k = 1; k < m; k++) v[k] = Math.min(v[k], Math.sqrt(v[k - 1] ** 2 + 2 * ACCEL * ds[k]));
      for (let k = 1; k < m; k++) if (geo.dist[k] > a && geo.dist[k - 1] < b) {
        const seg = Math.min(b, geo.dist[k]) - Math.max(a, geo.dist[k - 1]);
        t += seg / scale / (0.5 * (v[k] + v[k - 1]));
      }
      if (!(t > 0)) t = lenM / ((posted || 40) / 3.6);
      t += rec.delay_s || 0;
    }
  } else t = lenM / 10;
  const mid = Math.floor(n / 2);
  const vv = posted != null ? posted : ch.speed_limit_est_kph ? ch.speed_limit_est_kph[mid] : NaN;
  return { k: rec.k, q: qn ? +(qs / qn).toFixed(4) : null, s: sn ? +(ss / sn).toFixed(4) : null, c: +(conf / n).toFixed(4), f: +fun.toFixed(3), t: +t.toFixed(2), v: Number.isFinite(vv) ? Math.round(vv) : null, est: posted == null ? 1 : 0 };
}

async function main() {
  const a = args();
  const src = { dem: demTiles(a.dem), grid: gridBundles(a.ctx) };
  const out = fs.createWriteStream(a.out);
  const files = ['web/route_engine.js', 'web/fun_route.js', 'web/apex_core.js', 'web/route_ctx/dem.js', 'web/route_ctx/context_grid.js', 'tools/graph_etl/score_edges.js']
    .map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 12)]);
  out.write(JSON.stringify({ meta: { model: modelHash(), files: Object.fromEntries(files), grid: src.grid.size, dem: !!src.dem } }) + '\n');
  const rl = readline.createInterface({ input: fs.createReadStream(a.in), crlfDelay: Infinity });
  let k = 0;
  const t0 = Date.now();
  for await (const line of rl) {
    if (!line) continue;
    out.write(JSON.stringify(score(JSON.parse(line), src)) + '\n');
    if (++k % 20000 === 0) console.log(`  scored ${k} edges, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await new Promise((ok) => out.end(ok));
  console.log(`  scored ${k} edges in ${((Date.now() - t0) / 1000).toFixed(0)} s (grid bundles ${src.grid.size}, DEM ${src.dem ? 'on' : 'off'})`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { score, modelHash, gridBundles, demTiles };
