#!/usr/bin/env node
// Real-data calibration fixtures for the route engine (docs/ROUTE_ENGINE.md, tests/test_route_engine_calibration.py).
// For each case below: the router's candidates (its own costing with alternates, the highway-friendly costing, and any
// plan through shaping points), each candidate's edge attributes from the router (trace_attributes, parsed by
// web/route_ctx/router_edges.js), its terrain from the Terrarium DEM (web/route_ctx/dem.js on the real tiles), and the
// businesses beside it from OpenStreetMap (map tiles: shops, food, services, offices, excluding fuel and cafés; the map-features
// provider's channel, captured here so the model is calibrated on real counts). Written small: compact edges, not the
// raw answers. Run from the repo root with network: node tools/route_engine_fixtures.js [case ...]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const Router = require(path.join(ROOT, 'web/route_ctx/router_edges.js'));
const Dem = require(path.join(ROOT, 'web/route_ctx/dem.js'));
const Ctx = require(path.join(ROOT, 'web/route_ctx/registry.js'));
const OUT = path.join(ROOT, 'tests/fixtures/route_engine');
const VALHALLA = 'https://valhalla1.openstreetmap.de';

const UA = { 'User-Agent': 'Vetta route engine calibration (tools/route_engine_fixtures.js)' };
const DEPART = Date.parse('2026-11-01T14:00:00-05:00');   // a Sunday afternoon in daylight, fixed so the fixtures don't depend on today

// The owner's bad cases and the repo's fixture drive, around Cincinnati (ROUTE_ENGINE.md §Calibration says what each checks).
const CASES = {
  // I-275/I-74 and Carolina Trace vs the back roads (New Haven, Day, Lees Creek): highway 22 min vs back roads 26 min.
  harrison: { from: { lat: 39.2620, lon: -84.6000 }, to: { lat: 39.2966, lon: -84.7958 } },
  // Springdale and Mill Roads (signals, driveways, shops) vs I-275 a minute quicker: the router's own costing gave the arterial.
  northgate: { from: { lat: 39.2490, lon: -84.5960 }, to: { lat: 39.2900, lon: -84.5400 } },
  // Colerain Avenue's strip malls (18 signals) vs Pippin and Struble Roads 1.4 min longer.
  colerain: { from: { lat: 39.2300, lon: -84.5600 }, to: { lat: 39.2800, lon: -84.6500 } },
  // a curvy subdivision street (Menominee Drive, five good corners in 1.3 km, found in the map tiles the stage search reads)
  // as a "stage" vs Pippin Road: the old ranking took the corners.
  subdivision: { from: { lat: 39.2480, lon: -84.5770 }, to: { lat: 39.2690, lon: -84.5790 },
    plans: [{ label: 'subdivision', stageKm: 1.29, via: [{ lat: 39.25264, lon: -84.57659 }, { lat: 39.25988, lon: -84.57848 }, { lat: 39.26384, lon: -84.57831 }] }] },
};

const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...UA, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return r.json();
};
function decode6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const w of [0, 1]) { let s = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (w === 0) lat += d; else lon += d; }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
/** The cockpit's routeOf, the parts the engine needs: coords, junction turns, the maneuver clock, names, time. */
const TURN_TYPES = new Set([9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 26, 27]);
function routeOf(trip) {
  const coords = [], turns = [], times = [], names = {};
  let cumS = 0;
  trip.legs.forEach((leg, i) => {
    const shape = decode6(leg.shape);
    for (const m of leg.maneuvers || []) {
      const p = shape[m.begin_shape_index];
      if (p && TURN_TYPES.has(m.type)) turns.push(p);
      if (p) times.push([...p, Math.round(cumS * 10) / 10]);
      if (Number.isFinite(m.time)) cumS += m.time;
      const n = m.street_names && m.street_names[0];
      if (n && Number.isFinite(m.length)) names[n] = Math.round(((names[n] || 0) + m.length) * 100) / 100;
    }
    coords.push(...shape.slice(i ? 1 : 0));
  });
  return { coords, turns, times, names, timeS: trip.summary.time, has: { highways: trip.summary.has_highway, tolls: trip.summary.has_toll } };
}

// ---- a minimal PNG decoder for the Terrarium tiles (8-bit RGB/RGBA, not interlaced) --------------------------------
function png(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('png colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      cur[x] = (line[x] + pr) & 0xff;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * bpp]; out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]; out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]; out[(y * w + x) * 4 + 3] = 255; }
    prev.set(cur);
  }
  return out;
}
const tiles = new Map();
async function demTiles(keys) {
  for (const k of keys) {
    if (tiles.has(k)) continue;
    const [x, y] = k.split('/');
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Dem.Z}/${x}/${y}.png`, { headers: UA, signal: AbortSignal.timeout(30000) });
    tiles.set(k, r.ok ? png(Buffer.from(await r.arrayBuffer())) : null);
  }
}

// ---- businesses beside the route (the map-features provider's channel, real counts) -------------------------------
// From the OpenMapTiles `poi` layer of the OpenFreeMap z14 tiles the app already reads (ApexStages.pois): shops, food,
// services and offices; NOT fuel or cafés (the owner: those don't make a road worse), nor parks, schools, churches and
// other places that aren't businesses. (Overpass, the map-features provider's live source, timed out from the capture
// machine on 2026-11-03.)
const NOT_BUSINESS = new Set(['fuel', 'cafe', 'park', 'school', 'college', 'kindergarten', 'place_of_worship', 'cemetery', 'toilets', 'drinking_water',
  'bus', 'railway', 'aerialway', 'entrance', 'campsite', 'playground', 'information', 'viewpoint', 'picnic_site', 'attraction', 'castle', 'monument',
  'swimming', 'golf', 'harbor', 'stadium', 'town_hall', 'library', 'post', 'hospital', 'police', 'fire_station', 'parking', 'bicycle', 'shelter', 'bench',
  'ferry_terminal', 'waste_basket', 'recycling', 'garden', 'zoo', 'marina', 'pitch', 'sports_centre', 'dog_park', 'fountain']);
globalThis.ApexCore = require(path.join(ROOT, 'web/apex_core.js'));
globalThis.ApexRouteLoading = {};
require(path.join(ROOT, 'web/stages.js'));
let tileUrl = null;
async function businesses(bbox) {
  if (!tileUrl) tileUrl = (await (await fetch('https://tiles.openfreemap.org/planet', { headers: UA, signal: AbortSignal.timeout(20000) })).json()).tiles[0];
  const z = 14, n = 2 ** z, tx = (lon) => Math.floor((lon + 180) / 360 * n);
  const ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  const out = [];
  for (let x = tx(bbox[1]); x <= tx(bbox[3]); x++) for (let y = ty(bbox[2]); y <= ty(bbox[0]); y++) {
    const r = await fetch(tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    for (const f of globalThis.ApexStages.decodeLayer(new Uint8Array(await r.arrayBuffer()), 'poi', z, x, y, 1)) {
      if (NOT_BUSINESS.has(f.props.class) || NOT_BUSINESS.has(f.props.subclass)) continue;
      for (const l of f.lines) for (const [lon, lat] of l) out.push({ lat, lon });
    }
  }
  return out;
}
/** Business positions within 80 m of the corridor, as metres along it. */
function businessAlong(c, list) {
  const at = [];
  const kx = 111320 * Math.cos(c.lat[0] * Math.PI / 180), ky = 110540;
  for (const p of list) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < c.lat.length; i++) { const d = Math.hypot((c.lon[i] - p.lon) * kx, (c.lat[i] - p.lat) * ky); if (d < best) { best = d; bi = i; } }
    if (best <= 80) at.push(Math.round(c.distM[bi]));
  }
  return at.sort((a, b) => a - b);
}

const round = (v, k = 1) => (Number.isFinite(v) ? Math.round(v * k) / k : null);
const every4 = (a, k) => [...a].filter((_, i) => i % 4 === 0).map((v) => round(v, k));
async function candidate(label, kind, trip, extra = {}) {
  const r = routeOf(trip);
  const c = Ctx.corridor(label, r.coords, { timeS: r.timeS, departAt: DEPART });
  let ta = await post(`${VALHALLA}/trace_attributes`, Router.request(r.coords));
  if (!Router.parse(ta)) ta = await post(`${VALHALLA}/trace_attributes`, Router.request(Router.thin(r.coords, 2000), 'map_snap'));   // as the provider does
  const edges = Router.parse(ta);
  if (!edges) throw new Error(`${label}: no edges (${JSON.stringify(ta).slice(0, 200)})`);
  await demTiles(Dem.tilesFor(c));
  const dem = Dem.channelsFrom(c, Dem.sampler(tiles));
  const enc = Router.encode6(r.coords);
  return {
    label, kind, ...extra, timeS: r.timeS, km: round(c.totalM / 1000, 100), shape: enc, turns: r.turns.map(([lo, la]) => [round(lo, 1e6), round(la, 1e6)]), times: r.times, names: r.names, has: r.has,
    edges: edges.map((e) => [Math.round(e.fromM), Math.round(e.toM), e.sl, e.est, e.speed, e.rc, e.use, e.density, e.lanes, e.surface, e.sidewalk, e.truck, e.bridge, e.tunnel, e.toll, e.roundabout, e.unpaved, e.signal, e.side, e.drive]),
    // elevation per sample; the ring statistics are computed every 4th sample (100 m) and held, so they are stored that way
    dem: dem.channels.elev_m ? { status: dem.status, stride: 4, elev_m: [...dem.channels.elev_m].map((v) => round(v)), relief_m: every4(dem.channels.relief_m, 1),
      tpi_m: every4(dem.channels.tpi_m, 1), aspect_rad: every4(dem.channels.aspect_rad, 100) } : { status: dem.status },
    _corridor: c,
  };
}
const EDGE_FIELDS = ['fromM', 'toM', 'sl', 'est', 'speed', 'rc', 'use', 'density', 'lanes', 'surface', 'sidewalk', 'truck', 'bridge', 'tunnel', 'toll', 'roundabout', 'unpaved', 'signal', 'side', 'drive'];

async function capture(name, spec) {
  const auto = { use_highways: 0.15, use_tolls: 0.3, exclude_unpaved: true };   // FunRoute.costing defaults
  const cands = [];
  const def = await post(`${VALHALLA}/route`, { locations: [spec.from, spec.to], costing: 'auto', costing_options: { auto }, alternates: 2 });
  if (!def.trip) throw new Error(`${name}: ${def.error}`);
  const trips = [def.trip, ...(def.alternates || []).map((a) => a.trip)];
  for (const [i, t] of trips.entries()) cands.push(await candidate(`router${i}`, 'router', t));
  const hwy = await post(`${VALHALLA}/route`, { locations: [spec.from, spec.to], costing: 'auto', costing_options: { auto: { ...auto, use_highways: 1.0 } } });
  if (hwy.trip) cands.push(await candidate('highway', 'highway', hwy.trip));
  for (const [i, plan] of (spec.plans || []).entries()) {
    const locs = [spec.from, ...plan.via.map((v) => ({ ...v, type: 'through', radius: 25 })), spec.to];
    const t = await post(`${VALHALLA}/route`, { locations: locs, costing: 'auto', costing_options: { auto: { ...auto, use_highways: 0.6 } } });
    if (t.trip) cands.push(await candidate(plan.label || `plan${i}`, 'stages', t.trip, { stageKm: plan.stageKm || null }));
  }
  // businesses for the union box
  const box = Ctx.unionBox(cands.map((c) => c._corridor), 0.002);
  const biz = await businesses(box);
  for (const c of cands) { c.business_at = biz ? businessAlong(c._corridor, biz) : null; delete c._corridor; }
  const out = { case: name, captured: new Date().toISOString().slice(0, 10), departAt: DEPART, from: spec.from, to: spec.to, note: spec.note || null,
    sources: 'OpenStreetMap contributors (ODbL) via valhalla1.openstreetmap.de and Overpass; Terrarium DEM (Mapzen terrain tiles, AWS Open Data)',
    edgeFields: EDGE_FIELDS, candidates: cands };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(out));
  console.log(name, cands.map((c) => `${c.label} ${(c.timeS / 60).toFixed(1)} min ${c.km} km biz ${c.business_at ? c.business_at.length : '?'}`).join(' | '));
}

(async () => {
  const want = process.argv.slice(2);
  for (const [name, spec] of Object.entries(CASES)) {
    if (!spec || (want.length && !want.includes(name))) continue;
    await capture(name, spec);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
