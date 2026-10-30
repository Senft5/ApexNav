// Writes ApexKit/Tests/Fixtures/car_glide.json from web/car_glide.js: a scripted drive (on a twisty route, off it, a fix
// with no speed or course, a jump, a stop, a new route mid-drive) and where the arrow is drawn every 0.1 s. ApexKit's
// CarGlideTests replays the same inputs through CarGlide.swift and must draw the car in the same place (REVIEW_FEEL.md F-01).
//
//   node tools/make_glide_fixture.js          # rewrite the fixture
//   node tools/make_glide_fixture.js --check  # exit 1 if the fixture is stale (tests/test_car_glide.py)
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../web/car_glide.js');

const OUT = path.join(__dirname, '..', 'ApexKit', 'Tests', 'Fixtures', 'car_glide.json');
const K_LAT = 110540, K_LON = 111320, RAD = Math.PI / 180;

function scenario() {
  // deterministic noise (a small LCG): the GPS a few metres either side of the road
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const route = []; let lat = 35.36, lon = -84.29, h = 30;
  for (let i = 0; i < 400; i++) {
    h += 9 * Math.sin(i / 9); const b = h * RAD;
    lat += 10 * Math.cos(b) / K_LAT; lon += 10 * Math.sin(b) / (K_LON * Math.cos(lat * RAD)); route.push([+lat.toFixed(7), +lon.toFixed(7)]);
  }
  const at = (m) => { const k = Math.min(route.length - 2, Math.floor(m / 10)), f = Math.min(1, m / 10 - k), a = route[k], b = route[k + 1];
    return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, course: (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * RAD), b[0] - a[0]) / RAD + 360) % 360 }; };
  const events = [{ route, now: 0 }];
  let t = 0, m = 20;
  const fixAt = (p, course, mps, age) => events.push({ fix: [+(p.lat + rnd() * 3 / K_LAT).toFixed(8), +(p.lon + rnd() * 3 / K_LON).toFixed(8), course, mps, +(t - age).toFixed(3), +t.toFixed(3)] });
  const queries = (until) => { for (let q = t + 0.1; q < until - 1e-9; q += 0.1) events.push({ query: +q.toFixed(3) }); };
  // 1. on the route at 22 m/s, a fix each second (0.2 s old), the speed changing
  for (let k = 0; k < 20; k++) { const mps = 22 + 3 * Math.sin(k / 3); fixAt(at(m), at(m).course, mps, 0.2); queries(t + 1); t += 1; m += mps; }
  // 2. a late fix (1.9 s): the prediction stops at the cap
  { const p = at(m); fixAt(p, p.course, 20, 0); queries(t + 1.9); t += 1.9; m += 38; }
  // 3. a fix with neither speed nor course (taken from the last fix), then off the route: 60 m to the side, heading away
  { const p = at(m); fixAt(p, null, null, 0); queries(t + 1); t += 1; m += 20; }
  let off = { lat: at(m).lat + 60 / K_LAT, lon: at(m).lon };
  for (let k = 0; k < 6; k++) { fixAt(off, 0, 15, 0.1); queries(t + 1); t += 1; off = { lat: off.lat + 15 / K_LAT, lon: off.lon }; }
  // 4. a jump (a replay seek, out of a tunnel): drawn at once
  { m = 3200; const p = at(m); fixAt(p, p.course, 18, 0); queries(t + 1); t += 1; m += 18; }
  // 5. slowing to a stop and standing, GPS jitter on a standing car
  for (const mps of [12, 6, 2, 0, 0, 0]) { const p = at(m); fixAt(p, mps > 0.5 ? p.course : -1, mps, 0); queries(t + 1); t += 1; m += mps; }
  // 6. moving again, then a new route under the car mid-drive (a reroute): it eases onto the new line
  for (let k = 0; k < 3; k++) { const p = at(m); fixAt(p, p.course, 16, 0); queries(t + 1); t += 1; m += 16; }
  events.push({ route: route.slice(300).map(([a, b]) => [+(a + 4 / K_LAT).toFixed(7), b]), now: +(t - 0.5).toFixed(3) });
  for (let k = 0; k < 3; k++) { const p = at(m); fixAt(p, p.course, 16, 0); queries(t + 1); t += 1; m += 16; }
  return events;
}

function run(events) {
  const g = G.create(), poses = [];
  for (const e of events) {
    if (e.route) g.setRoute(e.route, e.now);
    else if (e.fix) { const [lat, lon, course, mps, t, now] = e.fix; g.push(lat, lon, course, mps, t, now); }
    else { const p = g.pose(e.query); poses.push([e.query, p.lat, p.lon, p.course == null ? null : p.course, p.s == null ? null : p.s, g.moving(e.query) ? 1 : 0]); }
  }
  return poses;
}

const events = scenario();
const text = JSON.stringify({ about: 'web/car_glide.js on a scripted drive (tools/make_glide_fixture.js); CarGlide.swift must match', events, poses: run(events) }) + '\n';
if (process.argv.includes('--check')) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old !== text) { console.error('car_glide.json is stale: run node tools/make_glide_fixture.js'); process.exit(1); }
} else fs.writeFileSync(OUT, text);
