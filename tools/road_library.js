// The road library (big bet #6, 2026-11-15): one public page per great road on vettadrive.app/roads (backend/src/
// road_library.ts renders them). This builds web/data/road_library.json from our live graph tiles: for each area in AREAS
// it runs Best roads nearby's own search (web/graph_router.js explore, 45 min from the area's centre, unpaved avoided, as
// the app does), keeps the named roads, counts each one's corners the way the route card does (apex_core.js
// detectCorners on the line resampled at 5 m), and drops a road two areas both found (same name, ends near). Everything
// on a page is from the map data: length, corners, the line. Nothing measured is claimed, and no road is made up.
//   node tools/road_library.js [area-id ...]      BASE=https://apexnav.senftns.workers.dev OUT=/tmp/road_library KEEP=1
// Tiles are fetched into OUT and deleted after each area unless KEEP=1 (the whole country is ~3 GB). Re-run after a graph
// build that changes the roads (docs/notes/2026-11-15-road-library.md); the JSON is committed so a page never waits on it.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
globalThis.ApexFunRoute = require(path.join(ROOT, 'web/fun_route.js'));
const Core = globalThis.ApexCore = require(path.join(ROOT, 'web/apex_core.js'));
const T = require(path.join(ROOT, 'web/graph_tiles.js'));
globalThis.ApexGraphTiles = T;
const R = require(path.join(ROOT, 'web/graph_router.js'));
const RoadLink = require(path.join(ROOT, 'web/road_link.js'));

const BASE = (process.env.BASE || 'https://apexnav.senftns.workers.dev').replace(/\/$/, '');
const OUT = process.env.OUT || path.join(require('os').tmpdir(), 'road_library');
const FILE = path.join(ROOT, 'web/data/road_library.json');
const MAX_S = 2700, PER_AREA = 10, MIN_KM = 5, LINE_MAX = 160, TOL_M = 8, LINK_PTS = 11, PAD_KM = 70;

// Areas riders drive to, and the places most members live. id, name (the page's "near"), state, centre.
const AREAS = [
  ['robbinsville', 'Robbinsville', 'NC', 35.322, -83.807], ['asheville', 'Asheville', 'NC', 35.595, -82.551],
  ['boone', 'Boone', 'NC', 36.216, -81.675], ['franklin-nc', 'Franklin', 'NC', 35.182, -83.381],
  ['roanoke', 'Roanoke', 'VA', 37.271, -79.941], ['front-royal', 'Front Royal', 'VA', 38.918, -78.194],
  ['tazewell', 'Tazewell', 'VA', 37.115, -81.519], ['damascus', 'Damascus', 'VA', 36.633, -81.784],
  ['marlinton', 'Marlinton', 'WV', 38.223, -80.094], ['davis-wv', 'Davis', 'WV', 39.128, -79.466],
  ['gatlinburg', 'Gatlinburg', 'TN', 35.714, -83.510], ['chattanooga', 'Chattanooga', 'TN', 35.046, -85.309],
  ['tellico', 'Tellico Plains', 'TN', 35.364, -84.297], ['nashville', 'Nashville', 'TN', 36.163, -86.781],
  ['dahlonega', 'Dahlonega', 'GA', 34.533, -83.985], ['hiawassee', 'Hiawassee', 'GA', 34.949, -83.757],
  ['fort-payne', 'Fort Payne', 'AL', 34.444, -85.720], ['cincinnati', 'Cincinnati', 'OH', 39.103, -84.512],
  ['logan-oh', 'Logan', 'OH', 39.540, -82.407], ['marietta-oh', 'Marietta', 'OH', 39.415, -81.455],
  ['columbus', 'Columbus', 'OH', 39.961, -82.999], ['lexington', 'Lexington', 'KY', 38.040, -84.503],
  ['slade', 'Slade', 'KY', 37.795, -83.696], ['louisville', 'Louisville', 'KY', 38.253, -85.759],
  ['bloomington', 'Bloomington', 'IN', 39.165, -86.526], ['madison-in', 'Madison', 'IN', 38.736, -85.380],
  ['pittsburgh', 'Pittsburgh', 'PA', 40.441, -79.996], ['wellsboro', 'Wellsboro', 'PA', 41.749, -77.300],
  ['jim-thorpe', 'Jim Thorpe', 'PA', 40.876, -75.732], ['phoenicia', 'Phoenicia', 'NY', 42.083, -74.311],
  ['lake-placid', 'Lake Placid', 'NY', 44.280, -73.982], ['stowe', 'Stowe', 'VT', 44.465, -72.684],
  ['lincoln-nh', 'Lincoln', 'NH', 44.046, -71.670], ['rangeley', 'Rangeley', 'ME', 44.966, -70.643],
  ['litchfield', 'Litchfield', 'CT', 41.747, -73.189], ['lenox', 'Lenox', 'MA', 42.356, -73.285],
  ['harbor-springs', 'Harbor Springs', 'MI', 45.432, -84.992], ['viroqua', 'Viroqua', 'WI', 43.557, -90.889],
  ['galena', 'Galena', 'IL', 42.417, -90.429], ['duluth', 'Duluth', 'MN', 46.787, -92.100],
  ['eureka-springs', 'Eureka Springs', 'AR', 36.401, -93.738], ['hot-springs', 'Hot Springs', 'AR', 34.503, -93.055],
  ['branson', 'Branson', 'MO', 36.644, -93.218], ['leakey', 'Leakey', 'TX', 29.729, -99.761],
  ['fredericksburg', 'Fredericksburg', 'TX', 30.275, -98.872], ['alpine-tx', 'Alpine', 'TX', 30.359, -103.661],
  ['taos', 'Taos', 'NM', 36.407, -105.573], ['ruidoso', 'Ruidoso', 'NM', 33.332, -105.673],
  ['prescott', 'Prescott', 'AZ', 34.540, -112.468], ['payson', 'Payson', 'AZ', 34.231, -111.325],
  ['moab', 'Moab', 'UT', 38.573, -109.550], ['torrey', 'Torrey', 'UT', 38.300, -111.419],
  ['ouray', 'Ouray', 'CO', 38.023, -107.671], ['estes-park', 'Estes Park', 'CO', 40.378, -105.522],
  ['golden', 'Golden', 'CO', 39.756, -105.221], ['aspen', 'Aspen', 'CO', 39.191, -106.818],
  ['red-lodge', 'Red Lodge', 'MT', 45.185, -109.247], ['west-glacier', 'West Glacier', 'MT', 48.495, -113.982],
  ['jackson', 'Jackson', 'WY', 43.480, -110.762], ['custer', 'Custer', 'SD', 43.767, -103.599],
  ['stanley', 'Stanley', 'ID', 44.216, -114.938], ['hood-river', 'Hood River', 'OR', 45.705, -121.521],
  ['bend', 'Bend', 'OR', 44.058, -121.315], ['ashford', 'Ashford', 'WA', 46.758, -122.031],
  ['winthrop', 'Winthrop', 'WA', 48.478, -120.186], ['mendocino', 'Mendocino', 'CA', 39.308, -123.799],
  ['monterey', 'Monterey', 'CA', 36.600, -121.894], ['santa-barbara', 'Santa Barbara', 'CA', 34.420, -119.698],
  ['la-canada', 'La Cañada Flintridge', 'CA', 34.200, -118.188], ['julian', 'Julian', 'CA', 33.079, -116.602],
  ['los-gatos', 'Los Gatos', 'CA', 37.227, -121.975], ['tahoe', 'South Lake Tahoe', 'CA', 38.940, -119.977],
  ['mammoth', 'Mammoth Lakes', 'CA', 37.649, -118.972], ['eureka-ca', 'Eureka', 'CA', 40.802, -124.164],
];

function get(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const code = execFileSync('curl', ['-sS', '-o', file + '.part', '-w', '%{http_code}', '--retry', '3', url], { encoding: 'utf8' });
  if (code !== '200') { try { fs.unlinkSync(file + '.part'); } catch (_) {} return null; }
  fs.renameSync(file + '.part', file);
  return fs.readFileSync(file);
}

/** A name for a page's address: lower case, a-z 0-9 and dashes. */
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r5 = (x) => Math.round(x * 1e5) / 1e5, r4 = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

/** `n` points evenly along a line by distance (its ends kept). */
function along(lat, lon, n) {
  const d = [0];
  for (let i = 1; i < lat.length; i++) d.push(d[i - 1] + R.distM(lat[i - 1], lon[i - 1], lat[i], lon[i]));
  const out = [], end = d[d.length - 1];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const want = end * k / (n - 1);
    while (j < d.length - 2 && d[j + 1] < want) j++;
    const f = d[j + 1] > d[j] ? Math.min(1, Math.max(0, (want - d[j]) / (d[j + 1] - d[j]))) : 0;
    out.push([r5(lat[j] + f * (lat[j + 1] - lat[j])), r5(lon[j] + f * (lon[j + 1] - lon[j]))]);
  }
  return out;
}

/** The road's line for its page and card: Douglas-Peucker in metres, as loose as needed to keep at most `max` points
 *  (from TOL_M up), so a hairpin keeps its shape and a straight costs two points. */
function simplify(lat, lon, max = LINE_MAX, tol = TOL_M) {
  const k = Math.cos(lat[0] * Math.PI / 180), x = lon.map((v) => v * 111320 * k), y = lat.map((v) => v * 110540);
  for (;; tol *= 1.4) {
    const keep = new Uint8Array(lat.length); keep[0] = keep[lat.length - 1] = 1;
    const stack = [[0, lat.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let far = -1, fd = tol;
      const dx = x[b] - x[a], dy = y[b] - y[a], L = Math.hypot(dx, dy);
      // (a loop road's two ends are one place: its distance from that place)
      for (let i = a + 1; i < b; i++) { const d = L > 0.5 ? Math.abs(dy * (x[i] - x[a]) - dx * (y[i] - y[a])) / L : Math.hypot(x[i] - x[a], y[i] - y[a]); if (d > fd) { fd = d; far = i; } }
      if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    const out = [];
    for (let i = 0; i < lat.length; i++) if (keep[i]) out.push(r4([lat[i], lon[i]]));
    if (out.length <= max) return out;
  }
}

/** Corners as the route card counts them (cockpit.js trackFromPolyline: 5 m resample, curvature, detectCorners). */
function cornerCount(lat, lon) {
  const rs = Core.resamplePolyline(lat, lon, 5);
  const { kappa, ds } = Core.computeCurvature(rs.lat, rs.lon);
  return Core.detectCorners(kappa, ds).length;
}

function area([id, name, state, lat, lon], index) {
  const have = new Set(Object.keys(index.tiles || {}));
  const dLat = PAD_KM / 110.54, dLon = PAD_KM / (111.32 * Math.cos(lat * Math.PI / 180));
  const a = R.tileOf(lat - dLat, lon - dLon), b = R.tileOf(lat + dLat, lon + dLon), tiles = [], files = [];
  for (let i = Math.min(a.i, b.i); i <= Math.max(a.i, b.i); i++) for (let j = Math.min(a.j, b.j); j <= Math.max(a.j, b.j); j++) {
    if (!have.has(`${i}_${j}`)) continue;
    const file = path.join(OUT, `${i}_${j}.vgr`), buf = get(`${BASE}/api/graph/v1/${i}_${j}.vgr`, file);
    if (buf) { tiles.push(T.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))); files.push(file); }
  }
  if (!tiles.length) return { id, off: true, roads: [] };
  const v = R.view(tiles);
  let res;
  try { res = R.explore(v, { start: { lat, lon }, maxS: MAX_S, max: 40, avoid: { unpaved: true } }); } catch (e) { return { id, error: String(e.message || e), roads: [] }; }
  if (!process.env.KEEP) for (const f of files) try { fs.unlinkSync(f); } catch (_) {}
  const roads = [];
  for (const s of res.stages) {
    if (!s.name || s.km < MIN_KM || s.deadEnd) continue;
    // a road on several numbered routes is named by all of them ("US 19;US 129;GA 11"): shown "US 19 / US 129 / GA 11"
    const name = s.name.split(';').map((x) => x.trim()).filter(Boolean).join(' / ');
    roads.push({ name, area: id, km: Math.round(s.km * 10) / 10, corners: cornerCount(s.lat, s.lon), score: s.score,
      line: simplify(s.lat, s.lon), link: RoadLink.encode(along(s.lat, s.lon, LINK_PTS).map(([la, lo]) => ({ lat: la, lon: lo })), name) });
    if (roads.length >= PER_AREA) break;
  }
  return { id, roads };
}

/** The same road twice (two areas found it, or one area found two runs of it): same name, and a third of one's line
 *  within 400 m of the other's, or an end of one within 1 km of an end of the other. */
function sameRoad(a, b) {
  if (a.name !== b.name) return false;
  const near = (p, line) => line.some((q) => Math.abs(p[0] - q[0]) < 0.01 && R.distM(p[0], p[1], q[0], q[1]) < 400);
  const share = (x, y) => x.line.filter((p) => near(p, y.line)).length / x.line.length;
  // two runs of one road end to end (the Blue Ridge Parkway's pieces) read as one road listed twice: the better one stays
  const ends = (r) => [r.line[0], r.line[r.line.length - 1]];
  if (ends(a).some((p) => ends(b).some((q) => R.distM(p[0], p[1], q[0], q[1]) < 1000))) return true;
  return share(a, b) > 0.33 || share(b, a) > 0.33;
}

function main() {
  const index = JSON.parse(get(`${BASE}/api/graph/v1/index.json`, path.join(OUT, 'index.json')).toString('utf8'));
  const only = process.argv.slice(2), byId = new Map(AREAS.map((a) => [a[0], a]));
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const results = new Map(prev && only.length ? prev.areas.map((a) => [a.id, (prev.roads || []).filter((r) => r.area === a.id)]) : []);
  for (const a of AREAS) {
    if (only.length && !only.includes(a[0])) continue;
    const t0 = Date.now(), r = area(a, index);
    results.set(a[0], r.roads);
    console.error(`${a[0]}: ${r.off ? 'off our tiles' : r.error ? r.error : `${r.roads.length} roads`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  // the best first, so a road two areas found keeps its better showing; then one id per road
  const all = [...results.values()].flat().sort((a, b) => b.score - a.score), kept = [], ids = new Set();
  for (const r of all) {
    if (kept.some((k) => sameRoad(k, r))) continue;
    const ar = byId.get(r.area);
    // the area, not a state: a road found from Cincinnati may be in Kentucky, and the page says "near Cincinnati, OH"
    let id = slug(`${r.name} ${ar[1]}`);
    for (let n = 2, base = id; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    kept.push({ id, ...r });
  }
  const out = {
    built: new Date().toISOString().slice(0, 10), graph: index.build,
    areas: AREAS.filter((a) => results.has(a[0])).map(([id, name, state, lat, lon]) => ({ id, name, state, lat, lon })),
    roads: kept.map(({ score, ...r }) => ({ ...r, score: Math.round(score) })),
  };
  fs.writeFileSync(FILE, JSON.stringify(out) + '\n');
  console.error(`${out.roads.length} roads in ${out.areas.length} areas → ${path.relative(ROOT, FILE)} (${(fs.statSync(FILE).size / 1024).toFixed(0)} KB)`);
}

if (require.main === module) main();
module.exports = { AREAS, slug, along, simplify, cornerCount, sameRoad };
