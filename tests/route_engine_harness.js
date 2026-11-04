// Calibration harness for the route engine (tests/test_route_engine_calibration.py). Loads a real-data fixture
// (tools/route_engine_fixtures.js), rebuilds each candidate exactly as the app would (5 m geometry and the fun score with
// the router's junction turns, the 25 m corridor, the router's edge channels, the DEM channels, businesses beside it) and
// ranks them with the engine and, for comparison, with the old ApexFunRoute.rank.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'web/apex_core.js'));
globalThis.ApexCore = Core;
globalThis.ApexSun = require(path.join(ROOT, 'web/sun.js'));
const FunRoute = require(path.join(ROOT, 'web/fun_route.js'));
globalThis.ApexFunRoute = FunRoute;
const Ctx = require(path.join(ROOT, 'web/route_ctx/registry.js'));
const Router = require(path.join(ROOT, 'web/route_ctx/router_edges.js'));
const Engine = require(path.join(ROOT, 'web/route_engine.js'));

function decode6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const w of [0, 1]) { let s = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (w === 0) lat += d; else lon += d; }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/route_engine', `${name}.json`), 'utf8'));

/** One fixture candidate as the planner's candidate, with its context. `channels`: extra stub channels (name → fn(i, c)). */
function candidate(fx, raw, o = {}) {
  const coords = decode6(raw.shape);
  const route = { coords, turns: raw.turns, times: raw.times, names: new Map(Object.entries(raw.names || {})), has: raw.has, timeS: raw.timeS };
  const cand = { label: raw.label, kind: raw.kind, route, timeS: raw.timeS };
  cand.t = FunRoute.geometry(coords, Core);
  const turnsM = raw.turns.map(([lon, lat]) => { const h = Core.nearestIndex(lat, lon, cand.t.lat, cand.t.lon, -1); return h.distM < 40 ? cand.t.dist[h.index] : null; });
  cand.turnsM = turnsM;
  cand.fun = FunRoute.score(cand.t, turnsM, o.prefs || null);
  cand.corridor = Engine.corridorFor(cand, raw.label, { departAt: o.departAt || fx.departAt, car: o.car || null });
  if (o.noContext) return cand;
  const c = cand.corridor, ctx = { channels: {}, spans: [], points: [] };
  if (!o.skip || !o.skip.includes('router')) {
    // the class estimate as today's code makes it (the fixture keeps what the router said, not our estimate)
    const edges = raw.edges.map((e) => Object.fromEntries(fx.edgeFields.map((k, i) => [k, e[i]]))).map((e) => ({ ...e, est: e.sl == null && e.rc != null ? Router.estimateLimit(e.rc, e.use, e.density) : null }));
    const r = Router.toChannels(c, edges);
    Object.assign(ctx.channels, r.channels); ctx.spans.push(...r.spans); ctx.points.push(...r.points);
  }
  if ((!o.skip || !o.skip.includes('dem')) && raw.dem && raw.dem.elev_m) {
    const n = c.distM.length, f = (arr, stride) => Float32Array.from({ length: n }, (_, i) => { const v = arr[Math.min(arr.length - 1, Math.floor(i / stride))]; return v == null ? NaN : v; });
    ctx.channels.elev_m = f(raw.dem.elev_m, 1);
    for (const k of ['relief_m', 'tpi_m', 'aspect_rad']) ctx.channels[k] = f(raw.dem[k], raw.dem.stride || 1);
  }
  if ((!o.skip || !o.skip.includes('business')) && Array.isArray(raw.business_at)) ctx.channels.business_per_km = Router.perKm(c.distM, c.totalM, raw.business_at);
  for (const [name, fn] of Object.entries(o.channels || {})) ctx.channels[name] = Float32Array.from({ length: c.distM.length }, (_, i) => fn(i, c, cand));
  for (const s of o.spans ? o.spans(cand) : []) ctx.spans.push(s);
  for (const p of o.points ? o.points(cand) : []) ctx.points.push(p);
  cand.ctx = ctx;
  return cand;
}
function cands(name, o = {}) {
  const fx = load(name);
  return fx.candidates.filter((r) => !o.only || o.only.includes(r.label)).map((r) => candidate(fx, r, o));
}
/** The labels best first under the engine and under the old ranking, plus each one's parts and the why line. */
function compare(name, level, o = {}) {
  const list = o.list || cands(name, o);
  const opts = { level, prefs: o.prefs || {}, score: (cand, scaleAt) => FunRoute.score(cand.t, cand.turnsM, o.prefs || null, scaleAt) };
  const ranked = Engine.rank(list, { ...opts, fresh: true });
  const quick = ranked.find((c) => c.extraS === 0) || ranked.reduce((a, b) => (b.timeS < a.timeS ? b : a), ranked[0]);
  const old = FunRoute.rank(list.map((c) => ({ ...c })), level);
  const w = Engine.why(ranked[0], quick, { metric: false });
  return {
    engine: ranked.map((c) => c.label), old: old.map((c) => c.label), why: w ? w.text : null,
    parts: Object.fromEntries(ranked.map((c) => [c.label, { value: +c.value.toFixed(1), ...Object.fromEntries(Object.entries(c.parts).map(([k, v]) => [k, +v.toFixed(1)])),
      qual: c.ev && c.ev.quality, poorKm: c.ev && +c.ev.poorKm.toFixed(2), conf: c.ev && +c.ev.confidence.toFixed(2), good: c.ev && c.ev.funGated ? c.ev.funGated.good : null, rawGood: c.fun ? c.fun.good : null, min: +(c.timeS / 60).toFixed(1) }])),
  };
}
/** C's context grid (web/data/ctx/v1, the real Cincinnati bundles) laid on each candidate's context, as the app would. */
const Grid = require(path.join(ROOT, 'web/route_ctx/context_grid.js'));
async function addGrid(list) {
  const fetchFn = async (url) => {
    const p = path.join(ROOT, 'web', url);
    if (!fs.existsSync(p)) return { ok: false, status: 404 };
    const b = fs.readFileSync(p);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), json: async () => JSON.parse(b.toString()) };
  };
  const res = await Grid.fetch(list.map((c) => c.corridor), { fetchFn, apiBase: null, budgetMs: 20000 });
  for (const c of list) {
    const r = res[c.corridor.id];
    if (!r || !c.ctx) continue;
    for (const [k, v] of Object.entries(r.channels || {})) c.ctx.channels[k] = Float32Array.from(v, (x) => (x == null ? NaN : x));
    c.ctx.spans.push(...(r.spans || [])); c.ctx.points.push(...(r.points || []));
    c.ev = null;
  }
  return res;
}
/** compare() with C's grid loaded. */
async function compareGrid(name, level, o = {}) {
  const list = cands(name, o);
  const res = await addGrid(list);
  const out = compare(name, level, { ...o, list });
  out.gridStatus = Object.values(res).map((r) => r.status);
  return out;
}
module.exports = { load, candidate, cands, compare, compareGrid, addGrid, Engine, FunRoute, Ctx, Router, decode6 };
if (require.main === module) {
  const [name, level] = process.argv.slice(2);
  console.log(JSON.stringify(compare(name, level || 'fun'), null, 1));
}
