// Benchmark roads (IDEAS R-32 / Q-19): saves the map's road pieces around famous driving roads as test fixtures, so CI can
// check that the stage scorer still ranks each in its region's top tenth, with no network. Run when the scorer's inputs or
// the benchmark list change:  node tools/make_benchmark_fixture.js
// Uses curl for the tiles (Node's fetch ignores the proxy settings here). OpenStreetMap data via OpenFreeMap (ODbL).
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.ApexCore = require(path.join(ROOT, 'web/apex_core.js'));
const curl = (url) => execFileSync('curl', ['-sSf', '--max-time', '60', url], { maxBuffer: 64 << 20 });
global.ApexRouteLoading = { json: async (u) => JSON.parse(curl(u).toString()), arrayBuffer: async (u) => { const b = curl(u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  yieldToUI: async () => {}, optional: async (p) => p };
require(path.join(ROOT, 'web/stages.js'));
const S = global.ApexStages;
const { BENCHMARKS } = require(path.join(ROOT, 'tests/benchmarks.js'));

(async () => {
  const out = path.join(ROOT, 'tests/fixtures/benchmarks');
  fs.mkdirSync(out, { recursive: true });
  for (const b of BENCHMARKS) {
    const pieces = await S.roadPieces({ lat: b.lat, lon: b.lon }, b.radiusKm, null, true);
    const slim = pieces.map((p) => ({ c: p.cls, p: p.pts.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) }));
    // the benchmark road itself: points (every ~100 m) along the tiles' name lines whose ref or name matches
    const on = [];
    for (const f of pieces.names) {
      const pr = f.properties || {};
      if (![pr.ref, pr.name, pr['name:latin'], pr.name_en].some((v) => typeof v === 'string' && b.match.test(v))) continue;
      for (const line of f.geometry.coordinates) for (let i = 0; i < line.length; i += 1) {
        const [lon, lat] = line[i];
        if (!on.length || Math.hypot((lat - on[on.length - 1][0]) * 110540, (lon - on[on.length - 1][1]) * 111320 * Math.cos(lat * Math.PI / 180)) >= 100) on.push([+lat.toFixed(5), +lon.toFixed(5)]);
      }
    }
    fs.writeFileSync(path.join(out, `${b.id}.json`), JSON.stringify({ id: b.id, source: 'OpenStreetMap contributors via OpenFreeMap (ODbL)', on, pieces: slim }));
    console.log(b.id, slim.length, 'pieces', on.length, 'points on the road');
  }
})().catch((e) => { console.error(e); process.exit(1); });
