// Live captures for the route engine (tests/fixtures/route_engine_live/*.json): what the app's own planner ranked on the
// live network (the router's candidates and the stage plans it generated, with the context every provider returned),
// captured in headless Chromium against the real services (valhalla1.openstreetmap.de, OpenFreeMap, the Terrarium DEM,
// Open-Meteo; OSM ODbL) on 2026-11-04 with the app's own planner. Rebuilds each candidate as
// the cockpit does (5 m geometry, the fun score with the router's junction turns, the corridor) and ranks it.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'web/apex_core.js'));
globalThis.ApexCore = Core;
globalThis.ApexSun = require(path.join(ROOT, 'web/sun.js'));
const FunRoute = require(path.join(ROOT, 'web/fun_route.js'));
globalThis.ApexFunRoute = FunRoute;
globalThis.ApexContextGrid = require(path.join(ROOT, 'web/route_ctx/context_grid.js'));
const Engine = require(path.join(ROOT, 'web/route_engine.js'));

function decode6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const w of [0, 1]) { let s = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (w === 0) lat += d; else lon += d; }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
const unrle = (runs) => { const out = []; for (const [v, n] of runs) for (let k = 0; k < n; k++) out.push(v == null ? NaN : v); return Float32Array.from(out); };
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/route_engine_live', `${name}.json`), 'utf8'));

/** The capture's candidates as the cockpit holds them (channels decoded; `drop`: providers' channels to leave out). */
function cands(fx, o = {}) {
  return fx.cands.map((raw, k) => {
    const coords = decode6(raw.shape);
    const route = { coords, turns: raw.turns || [], times: raw.times || [], names: new Map(Object.entries(raw.names || {})), has: raw.has || {}, timeS: raw.timeS };
    const c = { label: `${raw.kind}${k}`, kind: raw.kind, highway: raw.highway, route, timeS: raw.timeS, glare: raw.glare, townKm: raw.townKm, weatherCost: raw.weatherCost,
      adjust: raw.adjust, tasteBonus: raw.tasteBonus, preferBonus: raw.preferBonus, plan: raw.plan, via: new Array(raw.via || 0).fill({}) };
    c.t = FunRoute.geometry(coords, Core);
    c.turnsM = route.turns.map(([lon, lat]) => { const h = Core.nearestIndex(lat, lon, c.t.lat, c.t.lon, -1); return h.distM < 40 ? c.t.dist[h.index] : null; });
    c.fun = FunRoute.score(c.t, c.turnsM);
    c.corridor = Engine.corridorFor(c, `cand${k}`, { departAt: fx.departAt });
    if (raw.ctx) {
      const channels = {};
      for (const [name, runs] of Object.entries(raw.ctx.channels)) if (!(o.drop || []).includes(name)) channels[name] = unrle(runs);
      c.ctx = { channels, spans: raw.ctx.spans || [], points: raw.ctx.points || [] };
    }
    return c;
  });
}
function rank(fx, level, o = {}) {
  const list = o.list || cands(fx, o);
  const r = Engine.rank(list, { level: level || fx.level, fresh: true, score: (c, scaleAt) => FunRoute.score(c.t, c.turnsM, null, scaleAt) });
  const quick = r.find((c) => c.extraS === 0) || r[0];
  const w = r.length ? Engine.why(r[0], quick, { metric: false }) : null;
  const roads = (c) => Object.entries(Object.fromEntries(c.route.names)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, km]) => `${n} ${km.toFixed(1)}`);
  return { order: r.map((c) => c.label), quick: quick ? quick.label : null, why: w ? w.text : null, top: r[0] ? roads(r[0]) : null,
    names: r[0] ? Object.fromEntries(r[0].route.names) : null,
    rows: r.map((c) => ({ label: c.label, min: +(c.timeS / 60).toFixed(1), value: +c.value.toFixed(1), q: c.ev && c.ev.quality, poorKm: c.ev && +c.ev.poorKm.toFixed(2),
      biz: c.ev && c.ev.businessKm != null ? +c.ev.businessKm.toFixed(2) : null, roads: roads(c), parts: Object.fromEntries(Object.entries(c.parts).filter(([, v]) => Math.abs(v) > 0.05).map(([k, v]) => [k, +v.toFixed(1)])) })) };
}
module.exports = { load, cands, rank, decode6, Engine, FunRoute };
if (require.main === module) {
  const [name, level] = process.argv.slice(2);
  console.log(JSON.stringify(rank(load(name), level), null, 1));
}
