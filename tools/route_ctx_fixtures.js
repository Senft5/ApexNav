// Real fixtures for the OSM route-context providers (tests/test_route_ctx_*.py), cut small:
//   node tools/route_ctx_fixtures.js tiles <name> <route.json> <tileDir>
//     route.json = [[lat, lon], ...] (a Valhalla route shape); tileDir holds z14 tiles as 14_<x>_<y>.pbf from
//     https://tiles.openfreemap.org/planet. Writes tests/fixtures/route_ctx/<name>.json: { route, tiles } where tiles are
//     web/route_ctx/osm_tiles.js decodeTile() output, kept to what can reach a sample: lines within 60 m (streams 160 m), points within their band, polygons cut to
//     the route's box plus 300 m (rounded to 1e-5 deg for lines and rings).
//   node tools/route_ctx_fixtures.js overpass <name> <response.json>
//     Adds the Overpass answer to that file as `overpass` (the reply to osm_overpass.js query() for the route), with
//     ways and nodes more than 900 m from the route dropped, ways cut to their vertices within 100 m, and only the tags
//     the provider reads.
// Data © OpenStreetMap contributors, ODbL 1.0.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.ApexCore = globalThis.ApexCore || {};
require(ROOT + '/web/stages.js');
const G = require(ROOT + '/web/route_ctx/osm_common.js');
const T = require(ROOT + '/web/route_ctx/osm_tiles.js');
const OUT = ROOT + '/tests/fixtures/route_ctx/';

/** The route resampled every `step` metres as a corridor. */
function corridor(pts, step = 25) {
  const lat = [], lon = [], dist = [];
  const D = Math.PI / 180, R = 6371000;
  const hav = (a, b) => { const h = Math.sin((b[0] - a[0]) * D / 2) ** 2 + Math.cos(a[0] * D) * Math.cos(b[0] * D) * Math.sin((b[1] - a[1]) * D / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  let acc = 0, next = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = hav(pts[i], pts[i + 1]);
    while (next <= acc + L) { const t = L ? (next - acc) / L : 0; lat.push(pts[i][0] + t * (pts[i + 1][0] - pts[i][0])); lon.push(pts[i][1] + t * (pts[i + 1][1] - pts[i][1])); dist.push(next); next += step; }
    acc += L;
  }
  return { id: 'r', lat: Float64Array.from(lat), lon: Float64Array.from(lon), distM: Float64Array.from(dist) };
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;

function tiles(name, routeFile, dir) {
  const route = JSON.parse(fs.readFileSync(routeFile, 'utf8'));
  const c = corridor(route), idx = G.sampleIndex(c, 200);
  const near = (lon, lat, r) => idx.near(idx.P.x(lon), idx.P.y(lat), r).length > 0;
  const lineNear = (l, r) => { let hit = false; G.walkLine(idx, l, 20, (px, py) => { if (!hit && idx.near(px, py, r).length) hit = true; }); return hit; };
  // polygons are cut to the route's box plus 300 m (Sutherland-Hodgman), which keeps every in/out answer inside it
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < c.lat.length; i++) box = [Math.min(box[0], c.lon[i]), Math.min(box[1], c.lat[i]), Math.max(box[2], c.lon[i]), Math.max(box[3], c.lat[i])];
  const padLat = 300 / 110540, padLon = 300 / (111320 * Math.cos(c.lat[0] * Math.PI / 180));
  box = [box[0] - padLon, box[1] - padLat, box[2] + padLon, box[3] + padLat];
  const clip = (ring) => {
    let pts = ring;
    for (const [axis, v, keepLess] of [[0, box[0], false], [0, box[2], true], [1, box[1], false], [1, box[3], true]]) {
      const inside = (p) => (keepLess ? p[axis] <= v : p[axis] >= v), out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const cut = () => { const t = (v - a[axis]) / (b[axis] - a[axis]); return axis === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v]; };
        if (inside(a)) { out.push(a); if (!inside(b)) out.push(cut()); } else if (inside(b)) out.push(cut());
      }
      pts = out;
      if (!pts.length) break;
    }
    return pts;
  };
  const r5 = (v) => Math.round(v * 1e5) / 1e5, rl5 = (l) => l.map(([a, b]) => [r5(a), r5(b)]);
  const polyCut = (p) => { const rings = p.rings.map(clip).filter((r) => r.length > 2).map(rl5); if (!rings.length) return null; const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of rings) for (const [x, y] of r) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return { ...p, rings, box: b }; };
  const out = {};
  for (const k of T.tilesFor(c)) {
    const [x, y] = k.split('/').map(Number);
    const t = T.decodeTile(new Uint8Array(fs.readFileSync(`${dir}/14_${x}_${y}.pbf`)), x, y);
    out[k] = {
      key: k,
      roads: t.roads.filter((r) => lineNear(r.line, 60)).map((r) => ({ ...r, line: rl5(r.line) })),
      names: t.names.filter((r) => lineNear(r.line, 40)).map((r) => ({ ...r, line: rl5(r.line) })),
      pois: t.pois.filter((p) => near(p.lon, p.lat, 320)).map((p) => ({ ...p, lon: r6(p.lon), lat: r6(p.lat) })),
      places: t.places.filter((p) => near(p.lon, p.lat, 420)).map((p) => ({ ...p, lon: r6(p.lon), lat: r6(p.lat) })),
      addr: t.addr.filter(([lo, la]) => near(lo, la, 80)).map(([a, b]) => [r6(a), r6(b)]),
      buildings: t.buildings.filter(([lo, la]) => near(lo, la, 80)).map(([a, b]) => [r6(a), r6(b)]),
      polys: t.polys.map(polyCut).filter(Boolean),
      waterPolys: t.waterPolys.map(polyCut).filter(Boolean),
      waterways: t.waterways.filter((r) => lineNear(r.line, 160)).map((r) => ({ ...r, line: rl5(r.line) })),
    };
  }
  fs.mkdirSync(OUT, { recursive: true });
  const file = OUT + name + '.json';
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...prev, route, tiles: out }));
  console.log(file, fs.statSync(file).size, 'bytes,', Object.keys(out).length, 'tiles');
}

function overpass(name, respFile) {
  const file = OUT + name + '.json';
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = corridor(fx.route), idx = G.sampleIndex(c, 200);
  const near = (lat, lon, r = 900) => idx.near(idx.P.x(lon), idx.P.y(lat), r).length > 0;
  const j = JSON.parse(fs.readFileSync(respFile, 'utf8'));
  const keep = [];
  let rel = false;
  for (const e of j.elements) {
    if (e.type === 'relation') { rel = true; keep.push(e); continue; }
    if (e.type === 'way' && !e.tags && !e.geometry) { if (rel) keep.push(e); continue; }
    if (e.type === 'node' && !near(e.lat, e.lon)) continue;
    if (e.center && !near(e.center.lat, e.center.lon)) continue;
    if (e.geometry && !e.geometry.some((p) => near(p.lat, p.lon))) continue;
    if (e.geometry && e.type === 'way') {
      // a side street's far end can't reach the route: keep its vertices within 100 m (and their node ids, in step)
      const keepIdx = e.geometry.map((p, i) => i).filter((i) => [i - 1, i, i + 1].some((k) => e.geometry[k] && near(e.geometry[k].lat, e.geometry[k].lon, 100)));
      const ge = keepIdx.map((i) => e.geometry[i]);
      keep.push({ ...e, geometry: ge, ...(e.nodes ? { nodes: keepIdx.map((i) => e.nodes[i]) } : {}), bounds: undefined });
      continue;
    }
    keep.push(e);
  }
  // only the tags the provider reads (osm_overpass.js KEEP): names in other languages, TIGER and source tags dropped
  const KEEP = require(ROOT + '/web/route_ctx/osm_overpass.js').KEEP;
  for (const e of keep) if (e.tags) e.tags = Object.fromEntries(Object.entries(e.tags).filter(([k]) => KEEP.has(k)));
  fx.overpass = { osm3s: j.osm3s, elements: keep };
  fs.writeFileSync(file, JSON.stringify(fx));
  console.log(file, fs.statSync(file).size, 'bytes,', keep.length, 'of', j.elements.length, 'elements');
}

/**
 * Road names over a block of z14 tiles, each with its length and whether it dead-ends, for the name-age validation
 * (tests/test_route_ctx_road_name_age.py). A dead end: a public road's end that no other public road ends at or passes
 * through within 4 m, away from the tile edges (where lines are clipped). Proxy labels, not age records:
 *   old = 2 km or more of the name in the block (a through road of the township network);
 *   new = a residential ('minor') street under 1 km that dead-ends (a cul-de-sac subdivision street).
 */
function names(dir, x0, x1, y0, y1) {
  [x0, x1, y0, y1] = [x0, x1, y0, y1].map(Number);
  const PUBLIC = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
  const b0 = T.tileBounds(x0, y1), b1 = T.tileBounds(x1, y0);
  const P = G.projector((b0[1] + b1[3]) / 2, (b0[0] + b1[2]) / 2);
  const xy = ([lo, la]) => [P.x(lo), P.y(la)];
  const lines = [], named = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const f = `${dir}/14_${x}_${y}.pbf`;
    if (!fs.existsSync(f)) continue;
    const t = T.decodeTile(new Uint8Array(fs.readFileSync(f)), x, y), bounds = T.tileBounds(x, y);
    for (const r of t.roads) if (PUBLIC.has(r.cls) && !r.ramp) lines.push(r.line.map(xy));
    for (const r of t.names) if (PUBLIC.has(r.cls)) named.push({ name: r.name, cls: r.cls, line: r.line, bounds });
  }
  const cell = 50, grid = new Map();
  lines.forEach((l, k) => { for (const p of l) { const key = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell); let a = grid.get(key); if (!a) grid.set(key, (a = new Set())); a.add(k); } });
  const segD = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0; return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]); };
  const deadEnd = (e) => {
    let ending = 0, through = false;
    const gx = Math.floor(e[0] / cell), gy = Math.floor(e[1] / cell), seen = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get((gx + a) + ',' + (gy + b)) || []) {
      if (seen.has(k)) continue; seen.add(k);
      const l = lines[k];
      let near = false;
      for (let i = 0; i + 1 < l.length; i++) if (segD(e, l[i], l[i + 1]) <= 4) { near = true; break; }
      if (!near) continue;
      if (Math.hypot(l[0][0] - e[0], l[0][1] - e[1]) <= 4 || Math.hypot(l[l.length - 1][0] - e[0], l[l.length - 1][1] - e[1]) <= 4) ending++; else through = true;
    }
    return !through && ending <= 1;
  };
  const by = new Map();
  for (const r of named) {
    const [w, s, e, n] = r.bounds, mw = (e - w) * 0.03, mh = (n - s) * 0.03;   // ends this close to a tile edge are clip artefacts
    let o = by.get(r.name);
    if (!o) by.set(r.name, (o = { name: r.name, cls: {}, lenM: 0, deadEnd: false }));
    o.cls[r.cls] = (o.cls[r.cls] || 0) + 1;
    for (let i = 0; i + 1 < r.line.length; i++) {
      const mx = (r.line[i][0] + r.line[i + 1][0]) / 2, my = (r.line[i][1] + r.line[i + 1][1]) / 2;
      if (mx >= w && mx < e && my > s && my <= n) { const a = xy(r.line[i]), b = xy(r.line[i + 1]); o.lenM += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    }
    for (const end of [r.line[0], r.line[r.line.length - 1]]) {
      if (end[0] < w + mw || end[0] > e - mw || end[1] < s + mh || end[1] > n - mh) continue;
      if (deadEnd(xy(end))) o.deadEnd = true;
    }
  }
  const rows = [...by.values()].map((o) => {
    const cls = Object.entries(o.cls).sort((a, b) => b[1] - a[1])[0][0];
    const label = o.lenM >= 2000 ? 'old' : cls === 'minor' && o.lenM < 1000 && o.deadEnd ? 'new' : null;
    return { name: o.name, cls, lenM: Math.round(o.lenM), deadEnd: o.deadEnd, label };
  }).filter((r) => r.lenM > 0).sort((a, b) => a.name.localeCompare(b.name));
  const file = OUT + 'road_names_cincinnati.json';
  fs.writeFileSync(file, JSON.stringify({ source: `OpenFreeMap z14 tiles x ${x0}-${x1}, y ${y0}-${y1} (Colerain, Green, Springfield townships, Hamilton County OH), © OpenStreetMap contributors, ODbL`, rows }));
  const k = (l) => rows.filter((r) => r.label === l).length;
  console.log(file, rows.length, 'names,', k('old'), 'old,', k('new'), 'new');
}

module.exports = { corridor };
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'tiles') tiles(...args); else if (cmd === 'overpass') overpass(...args); else if (cmd === 'names') names(...args);
  else console.error('usage: tiles <name> <route.json> <tileDir> | overpass <name> <response.json> | names <tileDir> x0 x1 y0 y1');
}
