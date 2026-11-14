// Famous roads across the US: does Fun (and Long way) take the road a rider would drive there for? Each case is a trip
// whose fun way is a named rider road (the Dragon, the Cherohala, the Blue Ridge Parkway, Beartooth, Going-to-the-Sun,
// Big Sur ...); the tool fetches our live tiles for it (the Worker's /api/graph/v1, cached in OUT), plans it with
// web/graph_router.js at Quick, Fun and Long way, and says how much of each pick (and of the best candidate) is on that
// road, with the extra time. The route engine re-ranks these candidates in the app with the context grid; this is the
// router's side, the part the tiles decide. A pick off the famous road isn't always wrong: in SE Ohio the router leaves
// OH 78 and OH 26 for county ridge roads that bend more (about 220 degrees a km against 110 to 145, 2026-11-14), so read
// the roads it took, not only the share. The telling cases are a famous road against a fast highway (Big Sur, Skyline).
// 2026-11-14, first lower-48 build: 11 of 17 on the famous road at Fun; open gates on through roads (graph_router.js
// openGates) took Angeles Crest from 0.17 to 0.70 and Beartooth's Long way from 0.75 to 0.98, 46 min shorter.
//   node tools/famous_roads.js [case ...]        BASE=https://apexnav.senftns.workers.dev OUT=/tmp/famous JSON=1
// Off our tiles a case says so (index has no tile there) and is skipped, never counted as a miss.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
globalThis.ApexFunRoute = require(path.join(ROOT, 'web/fun_route.js'));
globalThis.ApexCore = require(path.join(ROOT, 'web/apex_core.js'));
const T = require(path.join(ROOT, 'web/graph_tiles.js'));
globalThis.ApexGraphTiles = T;
const R = require(path.join(ROOT, 'web/graph_router.js'));

// K='{"CHANGE_S":20}' tries router constants (web/graph_router.js K) for this run
if (process.env.K) Object.assign(R.K, JSON.parse(process.env.K));
const BASE = (process.env.BASE || 'https://apexnav.senftns.workers.dev').replace(/\/$/, '');
const OUT = process.env.OUT || path.join(require('os').tmpdir(), 'famous_roads');

// from, to: the trip; road: the famous road's names in OSM (a name, else its ref), as one pattern
const CASES = {
  dragon: { name: 'Tail of the Dragon (US 129)', from: { lat: 35.3226, lon: -83.8074 }, to: { lat: 35.6420, lon: -84.0500 }, road: /Tapoco|Calderwood|US 129|Tail of the Dragon/i },
  cherohala: { name: 'Cherohala Skyway', from: { lat: 35.3640, lon: -84.2970 }, to: { lat: 35.3226, lon: -83.8074 }, road: /Cherohala|NC 143|TN 165/i },
  parkway: { name: 'Blue Ridge Parkway (Blowing Rock to Linville Falls)', from: { lat: 36.1350, lon: -81.6780 }, to: { lat: 35.9570, lon: -81.9270 }, road: /Blue Ridge Parkway/i },
  skyline: { name: 'Skyline Drive (Front Royal to Thornton Gap)', from: { lat: 38.9000, lon: -78.1900 }, to: { lat: 38.6630, lon: -78.3200 }, road: /Skyline Drive/i },
  backdragon: { name: 'Back of the Dragon (VA 16)', from: { lat: 36.8340, lon: -81.5150 }, to: { lat: 37.1150, lon: -81.5190 }, road: /\b16\b|Back of the Dragon|B F Buchanan Highway|^Park Boulevard$/i },
  snake: { name: 'The Snake (US 421, Mountain City to Shady Valley)', from: { lat: 36.4750, lon: -81.8050 }, to: { lat: 36.5900, lon: -82.0600 }, road: /421/i },
  nickel: { name: 'Triple Nickel (OH 555)', from: { lat: 39.4890, lon: -81.8660 }, to: { lat: 39.7690, lon: -82.0920 }, road: /555/i },
  nickel2: { name: 'Triple Nickel (OH 555), Little Hocking to Zanesville', from: { lat: 39.2700, lon: -81.7000 }, to: { lat: 39.9400, lon: -82.0130 }, road: /555/i },
  oh78: { name: 'OH 78 (McConnelsville to Woodsfield)', from: { lat: 39.6490, lon: -81.8530 }, to: { lat: 39.7620, lon: -81.1150 }, road: /\b78\b/i },
  oh26: { name: 'OH 26 (Marietta to Woodsfield)', from: { lat: 39.4300, lon: -81.4500 }, to: { lat: 39.7620, lon: -81.1150 }, road: /\b26\b/i },
  beartooth: { name: 'Beartooth Highway (US 212)', from: { lat: 45.1850, lon: -109.2470 }, to: { lat: 45.0200, lon: -109.9330 }, road: /Beartooth|212/i },
  sun: { name: 'Going-to-the-Sun Road', from: { lat: 48.4950, lon: -113.9820 }, to: { lat: 48.7460, lon: -113.4370 }, road: /Going-to-the-Sun/i },
  million: { name: 'Million Dollar Highway (US 550)', from: { lat: 38.0220, lon: -107.6710 }, to: { lat: 37.8120, lon: -107.6640 }, road: /550|Million Dollar|San Juan Skyway/i },
  sisters: { name: 'Three Sisters (RR 337, Leakey to Camp Wood)', from: { lat: 29.7290, lon: -99.7610 }, to: { lat: 29.6680, lon: -100.0120 }, road: /337/i },
  crest: { name: 'Angeles Crest Highway (CA 2)', from: { lat: 34.2120, lon: -118.1880 }, to: { lat: 34.3610, lon: -117.6330 }, road: /Angeles Crest|^CA 2$|^SR 2$|State Route 2\b/i },
  maricopa: { name: 'Maricopa Highway (CA 33)', from: { lat: 34.4480, lon: -119.2470 }, to: { lat: 34.8600, lon: -119.4800 }, road: /Maricopa|\b33\b/i },
  bigsur: { name: 'Big Sur (CA 1, Carmel to Cambria)', from: { lat: 36.5550, lon: -121.9230 }, to: { lat: 35.5640, lon: -121.0810 }, road: /Cabrillo|Shoreline|^CA 1$|^SR 1$|Highway 1\b/i },
  ca36: { name: 'CA 36 (Red Bluff to Fortuna)', from: { lat: 40.1780, lon: -122.2350 }, to: { lat: 40.5980, lon: -124.1570 }, road: /\b36\b/i },
};

function get(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const code = execFileSync('curl', ['-sS', '-o', file + '.part', '-w', '%{http_code}', '--retry', '3', url], { encoding: 'utf8' });
  if (code !== '200') { try { fs.unlinkSync(file + '.part'); } catch (_) {} return null; }
  fs.renameSync(file + '.part', file);
  return fs.readFileSync(file);
}

function names(v) { return (e) => { const ix = v.name[e], t = v.tiles[v.eTile[e]]; return ix >= 0 && t.names && t.names[ix] ? t.names[ix] : null; }; }

function run(key, index) {
  const c = CASES[key], have = new Set(Object.keys(index.tiles || {}).length ? Object.keys(index.tiles) : (index.keys || []));
  const want = R.tilesFor(c.from, c.to, 'max');
  const missing = want.filter((t) => !have.has(`${t.i}_${t.j}`));
  const ends = [R.tileOf(c.from.lat, c.from.lon), R.tileOf(c.to.lat, c.to.lon)];
  if (ends.some((t) => !have.has(`${t.i}_${t.j}`))) return { key, name: c.name, off: true };
  const tiles = [];
  for (const t of want) {
    if (!have.has(`${t.i}_${t.j}`)) continue;
    const b = get(`${BASE}/api/graph/v1/${t.i}_${t.j}.vgr`, path.join(OUT, `${t.i}_${t.j}.vgr`));
    if (b) tiles.push(T.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
  }
  const v = R.view(tiles), nm = names(v);
  const share = (r) => { let on = 0, all = 0; for (const e of r.edgeIdx) { all += v.len[e]; const n = nm(e); if (n && c.road.test(n)) on += v.len[e]; } return all ? on / all : 0; };
  const out = { key, name: c.name, tiles: tiles.length, missing: missing.length };
  for (const level of ['quick', 'fun', 'max']) {
    try {
      // the app's own avoid defaults (fun_route.js AVOID_DEFAULT: unpaved roads avoided), as cockpit.js plans
      const p = R.plan(v, { from: c.from, to: c.to, level, avoid: { ...globalThis.ApexFunRoute.AVOID_DEFAULT } });
      const pick = p.routes[0], shares = p.routes.map(share);
      const top = {};
      let ch = 0, prev;
      for (const e of pick.edgeIdx) { const n = nm(e), k = n ? n.split(';')[0] : null; if (prev !== undefined && k !== prev) ch++; prev = k; }
      for (const e of pick.edgeIdx) { const n = nm(e) || '(no name)'; top[n] = (top[n] || 0) + v.len[e]; }
      out[level] = { on: +share(pick).toFixed(2), bestCand: +Math.max(...shares).toFixed(2), min: +(pick.timeS / 60).toFixed(1), quickMin: +(p.quick.timeS / 60).toFixed(1), km: +(pick.edgeIdx.reduce((s, e) => s + v.len[e], 0) / 1000).toFixed(1), g: +pick.why.goodness.toFixed(3),
        changes: Math.round(ch / Math.max(1, pick.edgeIdx.reduce((s, e) => s + v.len[e], 0) / 1e5)),
        roads: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, m]) => `${n} ${(m / 1000).toFixed(1)}`), ms: p.ms };
    } catch (e) { out[level] = { error: String(e.message || e) }; }
  }
  return out;
}

const index = JSON.parse(get(`${BASE}/api/graph/v1/index.json`, path.join(OUT, 'index.json')).toString('utf8'));
const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
const res = keys.map((k) => run(k, index));
if (process.env.JSON) { console.log(JSON.stringify({ build: index.build, cases: res }, null, 1)); }
else {
  console.log(`build ${index.build}`);
  for (const r of res) {
    if (r.off) { console.log(`--   ${r.name}: off our tiles`); continue; }
    const f = r.fun || {}, x = r.max || {}, q = r.quick || {};
    const mark = f.on >= 0.5 ? 'ok  ' : 'MISS';
    console.log(`${mark} ${r.name}: on it quick ${q.on} fun ${f.on} (best cand ${f.bestCand}) long ${x.on} | min q ${q.min} f ${f.min} l ${x.min} | changes/100 km f ${f.changes} l ${x.changes}${r.missing ? ` | ${r.missing} tiles missing` : ''}`);
    console.log(`     fun: ${(f.roads || [f.error]).join(', ')}`);
  }
}
