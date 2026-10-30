// End-to-end smoke tests of the web app's main flows in headless Chromium (docs/IDEAS.md Y-11).
// Serves web/ itself and blocks every other host, so a run needs no network and a third-party outage can't fail it;
// the app must still boot without its map tiles, routers and fonts. Any uncaught page error fails the flow.
//   node e2e/smoke.js            (needs the `playwright` package and its Chromium; CI installs both)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WEB = path.resolve(__dirname, '..', 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch (_) { res.writeHead(400); res.end(); return; }
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// Polyline6 as Valhalla encodes shapes, for the stub router below.
function polyline6(points) {
  let out = '', pLat = 0, pLon = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e6), b = Math.round(lon * 1e6);
    out += enc(a - pLat) + enc(b - pLon); pLat = a; pLon = b;
  }
  return out;
}
// A stand-in for the public Valhalla server: a winding road from the first location to the last, about 12 km,
// with a few named maneuvers. Enough for the app to score it, draw the card and offer Start.
function stubTrip(locs) {
  const a = locs[0], b = locs[locs.length - 1], n = 400, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, wig = Math.sin(t * Math.PI * 9) * 0.004 * Math.sin(t * Math.PI);
    pts.push([a.lat + (b.lat - a.lat) * t + wig, a.lon + (b.lon - a.lon) * t + wig]);
  }
  const lenKm = 12;
  return { trip: { legs: [{ shape: polyline6(pts), maneuvers: [
    { type: 1, begin_shape_index: 0, length: lenKm / 2, street_names: ['Test Ridge Road'] },
    { type: 10, begin_shape_index: 200, length: lenKm / 2, street_names: ['Hollow Creek Road'] },
    { type: 4, begin_shape_index: n, length: 0 }] }],
    summary: { length: lenKm, time: 900, has_highway: false, has_toll: false, has_ferry: false } } };
}

const flows = [];
const flow = (name, fn, ctxOpts = {}) => flows.push({ name, fn, ctxOpts });
function check(cond, msg) { if (!cond) throw new Error(msg); }

// A driving frame like the iOS shell pushes every 0.1 s (ApexNavApp.swift pushLiveFrame).
const frame = (i, extra = {}) => ({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true,
  lat_g: 0.1, lon_g: 0, calibration: 'locked', thermal: 0, low_power_mode: false, recording: false, segments: 0, ...extra });

flow('first run: onboarding, Watch a replay loads the bundled drive and Play moves along it', async (page, base) => {
  await page.goto(base + '/index.html');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  await page.click('#obAlt');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.state.mode === 'replay', null, { timeout: 15000 });
  check(!(await page.isVisible('#onboard.show')), 'onboarding should close');
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForFunction(() => window.apexDebug.state.playing && window.apexDebug.state.cursorM > 0, null, { timeout: 10000 });
  // REVIEW2.md U-45: Play is one slide switch, speed a detent, and a replay is full-screen like a drive (the plate's × is the exit)
  const tp = await page.evaluate(() => { document.querySelector('#rateDetents [data-rate="4"]').click();
    const tb = document.querySelector('.tabbar');
    return { on: document.getElementById('playBtn').getAttribute('aria-checked'), rate: window.apexDebug.state.rate,
      lit: [...document.querySelectorAll('#rateDetents [aria-checked="true"]')].map((b) => b.dataset.rate).join(),
      tabbar: tb ? getComputedStyle(tb).display : 'none' }; });
  check(tp.on === 'true' && tp.rate === 4 && tp.lit === '4', `the Play switch and the speed detent should drive the replay: ${JSON.stringify(tp)}`);
  check(tp.tabbar === 'none', 'the tab bar should hide during a replay');
});

flow('returning driver: live frames switch to the cockpit, big targets and no keyboard while moving', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  check(!(await page.isVisible('#onboard.show')), 'no onboarding for a returning driver');
  // 5 s of frames at 12 m/s (27 mph): the in-car gate needs 3 s above 10 mph.
  await page.evaluate(async () => {
    const f = (i) => ({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked' });
    for (let i = 0; i < 50; i++) { window.apex.live(f(i)); await new Promise(r => setTimeout(r, 100)); }
  });
  check(await page.evaluate(() => document.body.classList.contains('moving')), 'body.moving after 3 s above 10 mph');
  check(await page.evaluate(() => window.apexDebug.state.mode === 'live'), 'frames switch the cockpit to live');
  // A text field must not open the keyboard while moving (IDEAS C-08).
  // (the Plan sheet's fields are hidden in the cockpit, so focus a plain field: the guard is document-wide)
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'e2eField'; document.body.append(i); i.focus(); });
  await page.waitForFunction(() => /Typing is off/.test(document.getElementById('toast').textContent));
  check(await page.evaluate(() => document.activeElement !== document.getElementById('e2eField')), 'the field gives up focus while moving');
});

flow('a hot phone turns the battery saver on and back off', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate((f) => window.apex.live(f), frame(0, { thermal: 3 }));
  await page.waitForFunction(() => /saving battery/.test(document.getElementById('toast').textContent));
  await page.evaluate((f) => window.apex.live(f), frame(1, { thermal: 0 }));
  await page.waitForFunction(() => /Full map detail/.test(document.getElementById('toast').textContent));
});

flow('the co-driver reads the road: the first note is called before the car moves, the quiet line names the road and the next corner (REVIEW4 U-58, U-67, U-74)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    // as in the app (the shell feeds GPS); APEX_REVIEW: every line said is posted, as the review recording logs it
    window.__said = []; window.APEX_REVIEW = true;
    window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'said') window.__said.push(m.text); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport && window.apex && window.apex.live);
  // a tight right 30 m from the start, then 3 km straight east, then a tight left: a GPX route, followed as drawn
  const KY = 110540, KX = 111320 * Math.cos(35.5 * Math.PI / 180), pts = [];
  for (let y = 0; y <= 30; y += 5) pts.push([y, 0]);
  for (let a = 5; a <= 90; a += 5) { const r = a * Math.PI / 180; pts.push([30 + 20 * Math.sin(r), 20 - 20 * Math.cos(r)]); }
  for (let x = 25; x <= 3000; x += 5) pts.push([50, x]);
  for (let a = 5; a <= 90; a += 5) { const r = a * Math.PI / 180; pts.push([50 + 20 * (1 - Math.cos(r)), 3000 + 20 * Math.sin(r)]); }
  for (let y = 75; y <= 400; y += 5) pts.push([y, 3020]);
  const gpx = pts.map(([n, e]) => `<trkpt lat="${(35.5 + n / KY).toFixed(7)}" lon="${(-83.9 + e / KX).toFixed(7)}"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'ridge.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Ridge run</name><trkseg>${gpx}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Ridge run', null, { timeout: 10000 });
  check(await page.evaluate(() => apexDebug.track.events.some((e) => e.type === 'corner' && (e.severity === 'HP' || e.severity <= 3))), 'the route has its tight corners');
  // the map's own road names (ApexRoadNames): one named line along the route
  await page.evaluate(() => { const m = apexDebug.map, t = apexDebug.track, q = m.querySourceFeatures.bind(m);
    const line = { properties: { name: 'Test Ridge Road' }, geometry: { type: 'LineString', coordinates: t.lat.map((la, i) => [t.lon[i], la]) } };
    m.querySourceFeatures = (src, o) => (o && o.sourceLayer === 'transportation_name' ? [line] : q(src, o)); });
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start' }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  const at = (i, v, cal) => page.evaluate(([i, v, cal]) => { const t = apexDebug.track;
    window.apex.live({ lat: t.lat[i], lon: t.lon[i], accuracy_m: 5, speed_mps: v, course_deg: i < 12 ? 0 : 90, has_fix: true, lat_g: 0, lon_g: 0, calibration: cal, thermal: 0 }); }, [i, v, cal]);
  // stopped at the start, still calibrating: the first line of the drive is the corner, before the car moves
  for (let k = 0; k < 10; k++) { await at(0, 0, 'default'); await page.waitForTimeout(100); }
  const first = await page.evaluate(() => window.__said.slice());
  check(first.length >= 1 && /right/i.test(first[0]), 'the first line of the drive is its first corner: ' + JSON.stringify(first));
  check(/right/i.test(await page.textContent('#notes')), 'the strip shows the first corner: ' + await page.textContent('#notes'));
  // the mount locks as the car pulls away: the status line says so, no toast over the map (U-74)
  await at(2, 3, 'locked');
  check(/Mount set/.test(await page.textContent('#dsMain')), 'the status line says the mount is set: ' + await page.textContent('#dsMain'));
  check(!/Mount set/.test(await page.textContent('#toast')), 'no mount toast over the map');
  // drive up to the corner and wait at its entry (a ramp's queue): after ~3 s at 0 ft the strip moves on (U-86)
  const entry = await page.evaluate(() => { const t = apexDebug.track, e = t.events.filter((x) => x.type === 'corner').sort((a, b) => a.dist_m - b.dist_m)[0];
    const m = Number.isFinite(e.start_m) ? e.start_m : e.dist_m; return t.dist.findIndex((d) => d >= m + 1); });
  for (let i = 3; i <= entry; i++) { await at(i, 4, 'locked'); await page.waitForTimeout(150); }
  const leadBox = () => page.evaluate(() => { const b = document.querySelector('#notes .rb-box.now'); return b ? b.textContent : ''; });
  const waiting = await leadBox();
  check(/^0\s*FT/i.test(waiting.trim()), 'at the corner the lead reads 0 ft: ' + waiting);
  for (let k = 0; k < 22; k++) { await at(entry, 0, 'locked'); await page.waitForTimeout(200); }
  check(await leadBox() !== waiting, 'a passed note advances while the car waits: ' + await leadBox());
  // out onto the straight at 30 m/s, the first corner behind and its 30 s hold over: quiet, said once, with the road and the
  // next corner (2.6 km on) in the strip and the road on the binnacle
  const n = await page.evaluate(() => apexDebug.track.lat.length);
  for (let i = 4, k = 0; i < Math.min(n - 1, 90) && k < 40; i += 3, k++) { await at(i, 30, 'locked'); await page.waitForTimeout(60); }
  await page.evaluate(() => { apexDebug.state.spiritedAt = -Infinity; });
  for (let k = 0; k < 8; k++) { await at(90 + k, 30, 'locked'); await page.waitForTimeout(120); }
  await page.waitForFunction(() => /Quiet · Test Ridge Road · next corner \d/.test(document.getElementById('notes').textContent), null, { timeout: 5000 })
    .catch(async () => { throw new Error('the quiet line: ' + await page.textContent('#notes')); });
  const strip = await page.textContent('#notes');
  check(/Clear/.test(strip) && !/Ridge run/.test(strip), 'the quiet line names the road, not the route: ' + strip);
  check(/Road: Test Ridge Road/.test(await page.textContent('#cluster')), 'the binnacle names the road: ' + await page.textContent('#cluster'));
  const said = await page.evaluate(() => window.__said.slice());
  check(said.filter((s) => s === 'Quiet from here. Bumps and cameras only.').length === 1, 'going quiet is said once: ' + JSON.stringify(said));
  check(!said.includes('Full notes.'), 'the drive began awake, so it never said the notes came on: ' + JSON.stringify(said));
});

flow('Where to?: with the search and routing services unreachable, a search fails politely', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.click('#destInput');
  await page.fill('#destInput', 'Knoxville');
  await page.press('#destInput', 'Enter');
  await page.waitForFunction(() => /Search is offline/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('Where to?: your own stages match by name, even with the map search offline (IDEAS U-19)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1');
    localStorage.setItem('apex.segments', JSON.stringify([{ id: 's1', name: 'Tail of the Dragon (US 129)', lat0: 35.47, lon0: -83.92, lat1: 35.52, lon1: -83.95, length_m: 17000 }])); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.click('#destInput');
  await page.fill('#destInput', 'tail dragon');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  const first = await page.textContent('#placeList .place');
  check(/Tail of the Dragon \(US 129\)/.test(first) && /Your stage/.test(first), 'your stage first: ' + first);
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('Where to?: a suggestion builds a route with a card and a Start button (search and router stubbed)', async (page, base) => {
  // a road on the route closed at all hours by the map's conditional tags (IDEAS R-22)
  await page.route('https://overpass-api.de/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'way', id: 9, center: { lat: 35.7565, lon: -83.97 }, tags: { highway: 'tertiary', name: 'Gate Road', 'access:conditional': 'no @ (00:00-23:59)' } }] }) }));
  // weather along the route (IDEAS R-21): rain everywhere, every hour
  await page.route('https://api.open-meteo.com/**', (route) => {
    const n = new URL(route.request().url()).searchParams.get('latitude').split(',').length, now = Math.floor(Date.now() / 3600e3) * 3600;
    const one = { hourly: { time: Array.from({ length: 72 }, (_, i) => now - 3600 * 12 + i * 3600), precipitation_probability: Array(72).fill(85), precipitation: Array(72).fill(1.5),
      temperature_2m: Array(72).fill(14), visibility: Array(72).fill(9000), weather_code: Array(72).fill(63) } };
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.from({ length: n }, () => one)) });
  });
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  const asked = [];
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput');
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50; }, null, { timeout: 20000 });
  const name = await page.textContent('#routeBarName');
  check(/Maryville/.test(name), `route bar names the destination (got "${name}")`);
  check(await page.isVisible('#startDrive'), 'Start is offered');
  check(await page.evaluate(() => ApexAnalysis.stats.worker >= 1 && ApexAnalysis.stats.inline === 0), 'the route was analysed in the Web Worker (IDEAS P-05)');
  // the router's turn is on the track for spoken directions (IDEAS V-04): halfway along, onto Hollow Creek Road
  const steps = await page.evaluate(() => { const t = window.apexDebug.track; return { steps: t.steps, total: t.dist[t.dist.length - 1] }; });
  const turn = steps.steps.find((x) => x.type === 10);
  check(turn && turn.street === 'Hollow Creek Road' && Math.abs(turn.m / steps.total - 0.5) < 0.1, 'the turn is placed halfway: ' + JSON.stringify(steps.steps));
  check(steps.steps.some((x) => x.type === 4) && !steps.steps.some((x) => x.type === 1), 'arrival kept, the start left out');
  await page.waitForFunction(() => /Forecast: Rain likely at the start/.test(document.getElementById('routeCardWeather').textContent), null, { timeout: 10000 });
  await page.waitForFunction(() => /Closed when you'd get there \(map data\): Gate Road \(00:00-23:59\)/.test(document.getElementById('routeCardClosures').textContent), null, { timeout: 10000 });
  // Route around it (R-22): the closed road goes to the router as an exclusion
  await page.evaluate(() => document.querySelector('#routeCardClosures button').click());
  for (let k = 0; k < 50 && !asked.some((r) => (r.exclude_locations || []).some((e) => Math.abs(e.lat - 35.7565) < 1e-4)); k++) await page.waitForTimeout(100);
  check(asked.some((r) => (r.exclude_locations || []).some((e) => Math.abs(e.lat - 35.7565) < 1e-4 && Math.abs(e.lon + 83.97) < 1e-4)), 'the closed road is excluded');
  // pin it as Home (IDEAS U-20): first in Where to?, on this phone; Unpin removes it
  await page.evaluate(() => document.getElementById('routePinBtn').click());
  await page.fill('.confirm-sheet .cs-field', 'Home'); await page.click('.confirm-sheet .cs-ok');   // the name is asked for on the app's own sheet, not the browser's prompt
  // the pin itself, not its toast: the replan around the closure can toast over it
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('apex.pinnedPlaces') || '[]') || []).length === 1);
  const pinned = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.pinnedPlaces')));
  check(pinned.length === 1 && pinned[0].name === 'Home' && pinned[0].label === 'Maryville' && Math.abs(pinned[0].lat - 35.7565) < 1e-6, 'pinned: ' + JSON.stringify(pinned));
  await page.click('#planClear');
  await page.click('#destInput');
  await page.waitForSelector('#placeList .pinned-row');
  check((await page.textContent('#placeList .pinned-row .place b')) === 'Home', 'Home is first');
  await page.click('#placeList .pinned-row button:has-text("Unpin")');
  await page.waitForFunction(() => !document.querySelector('#placeList .pinned-row'));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('drag to reshape: dragging the planned route with the mouse adds a stop where it is let go (router stubbed, IDEAS R-18)', async (page, base) => {
  const asked = [];
  // the real map style is offline here: a bare one, so the app's own route layers draw
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req.locations);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput');
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50; }, null, { timeout: 20000 });
  await page.evaluate(() => { const t = window.apexDebug.track, i = Math.round(t.lat.length / 2); window.apexDebug.map.jumpTo({ center: [t.lon[i], t.lat[i]], zoom: 13 }); });
  await page.waitForTimeout(800);                                    // drawn there
  // a point on the drawn route that is on screen and not under the route card
  const pt = await page.evaluate(() => {
    const t = window.apexDebug.track, m = window.apexDebug.map, r = m.getContainer().getBoundingClientRect();
    for (let k = 2; k < 9; k++) {
      const i = Math.round(t.lat.length * k / 10), p = m.project([t.lon[i], t.lat[i]]), x = r.left + p.x, y = r.top + p.y;
      const el = document.elementFromPoint(x, y);
      if (el && el.classList.contains('maplibregl-canvas') && m.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ['apex-route'] }).length) return { x, y };
    }
    return null;
  });
  check(pt, 'the route is on screen');
  const before = asked.length;
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 40, pt.y + 30, { steps: 4 });
  await page.mouse.move(pt.x + 70, pt.y + 60, { steps: 4 });
  await page.mouse.up();
  for (let k = 0; k < 50 && asked.length === before; k++) await page.waitForTimeout(100);
  const locs = asked[asked.length - 1];
  check(asked.length > before && locs.length === 3, 'the router was asked through a new stop: ' + JSON.stringify(locs));
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.request && t.request.via.length === 1; }, null, { timeout: 10000 });
  // the stop is listed on the route card (IDEAS R-17); Remove rebuilds the route without it
  await page.waitForSelector('#routeStops:not([hidden]) .stop-row');
  check((await page.textContent('#routeStops')).startsWith('1. Stop 1'), 'the stop listed: ' + await page.textContent('#routeStops'));
  const n = asked.length;
  await page.evaluate(() => document.querySelector('#routeStops button[aria-label="Remove Stop 1"]').click());
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.request && t.request.via.length === 0; }, null, { timeout: 10000 });
  check(asked.length > n && asked[asked.length - 1].length === 2, 'routed again without it');
  check(await page.isHidden('#routeStops'), 'no stops, no list');
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('avoid cameras: with the chip on, the cameras near the trip go to the router as exclusions (camera map and router stubbed, IDEAS R-35)', async (page, base) => {
  const asked = [];
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://overpass-api.de/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.85, lon: -83.94, tags: { 'surveillance:type': 'ALPR' } }, { type: 'node', id: 2, lat: 37.5, lon: -83.9, tags: { 'surveillance:type': 'ALPR' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.avoid', JSON.stringify({ cameras: true })); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput');
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50; }, null, { timeout: 20000 });
  const ex = asked.map((r) => r.exclude_locations || []);
  check(ex.some((e) => e.length === 1 && e[0].lat === 35.85 && e[0].lon === -83.94), 'the camera near the trip was excluded, the far one not: ' + JSON.stringify(ex));
  check(await page.evaluate(() => document.querySelector('[data-avoid="cameras"]').getAttribute('aria-pressed')) === 'true', 'the chip shows it');
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('saved for offline: Save on the route card, then with no signal it opens from Where to? with its directions (IDEAS F-03)', async (page, base) => {
  let online = true;
  await page.route('https://photon.komoot.io/**', (route) => (online ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }) : route.abort()));
  await page.route('https://valhalla1.openstreetmap.de/**', (route) => {
    if (!online) return route.abort();
    const req = JSON.parse(route.request().postData() || '{}');
    if (!req.locations) return route.abort();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.steps && t.steps.length; }, null, { timeout: 20000 });
  const [name, notesBefore] = await page.evaluate(() => [window.apexDebug.track.name, window.apexDebug.track.events.length]);
  await page.evaluate(() => document.getElementById('routeSaveBtn').click());
  await page.waitForFunction(() => document.getElementById('routeSaveBtn').textContent === 'Saved');
  // no signal, a fresh start with nothing planned
  online = false;
  await page.evaluate(() => { localStorage.removeItem('apex.plannedRoute'); sessionStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput');
  await page.waitForSelector('#placeList .place:has-text("Saved")', { timeout: 5000 });
  check((await page.textContent('#placeList')).includes(name), 'the saved route is listed');
  await page.click('#placeList .place:has-text("Saved")');
  await page.waitForFunction((n) => { const t = window.apexDebug.track; return t && t.name === n && t.kind === 'route'; }, name, { timeout: 10000 });
  check(await page.evaluate(() => window.apexDebug.track.events.length) === notesBefore, 'the same notes, worked out on the phone: ' + notesBefore);
  const steps = await page.evaluate(() => window.apexDebug.track.steps);
  check(steps.some((x) => x.type === 10 && x.street === 'Hollow Creek Road'), 'directions came back with it');
  check(/map needs signal/.test(await page.textContent('#toast')), 'says the map still needs signal');
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('a reported road closure: routing asks the router to go around it (Worker and router stubbed, IDEAS Q-17)', async (page, base) => {
  const bodies = [];
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}'); bodies.push(req);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/hazards') return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { id: 'c1', kind: 'closure', lat: 35.86, lon: -83.95, heading: null, confirms: 3, clears: 0, m: 0 }, { id: 'g1', kind: 'gravel', lat: 35.86, lon: -83.95, heading: null, confirms: 1, clears: 0, m: 0 }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route'; }, null, { timeout: 20000 });
  check(bodies.length && bodies.every((b) => JSON.stringify(b.exclude_locations) === JSON.stringify([{ lat: 35.86, lon: -83.95 }])), 'every route request goes around the closure, and only the closure: ' + JSON.stringify(bodies.map((b) => b.exclude_locations)));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('share your ETA: the route card makes a link; its page says who and when, never where (Worker stubbed, IDEAS S-19)', async (page, base) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(JSON.parse(route.request().postData()).locations)) }));
  const posts = [];
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/eta' && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return json({ token: 'TOKENTOKENTOKENTOKENTOKEN123' }, 201); }
    if (u.pathname === '/api/eta/TOKENTOKENTOKENTOKENTOKEN123') return json({ handle: 'nate', arrive_at: new Date(Date.now() + 14 * 60000).toISOString(), updated_at: new Date().toISOString(), ended: null });
    return json([]);
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => !document.getElementById('etaShareBtn').hidden, null, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('etaShareBtn').click());
  await page.waitForFunction(() => document.getElementById('etaShareBtn').textContent === 'Stop sharing ETA');
  check(posts.length === 1 && posts[0].left_s === 900, 'started with the route time: ' + JSON.stringify(posts));
  await page.goto(base + '/eta.html?t=TOKENTOKENTOKENTOKENTOKEN123');
  await page.waitForFunction(() => /@nate is about 1[34] min away/.test(document.getElementById('title').textContent));
  check(/Arriving around/.test(await page.textContent('#sub')) && /not where they are/.test(await page.textContent('footer')), 'who, when, and the promise');
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('routes from elsewhere: a GPX track is followed as drawn; a pasted Google Maps link routes through its stops (router stubbed, IDEAS R-25/R-26)', async (page, base) => {
  const bodies = [];
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => { const req = JSON.parse(route.request().postData()); bodies.push(req); route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) }); });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport);
  const pts = Array.from({ length: 300 }, (_, i) => `<trkpt lat="${(35.5 + i * 2e-4 + Math.sin(i / 9) * 3e-4).toFixed(6)}" lon="${(-83.9 + i * 2e-4).toFixed(6)}"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'dragon.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Dragon run</name><trkseg>${pts}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Dragon run', null, { timeout: 10000 });
  check(bodies.length === 0, 'a GPX track is followed as drawn, no router');
  await page.click('#planClear');
  await page.click('#destInput');
  await page.fill('#destInput', 'https://www.google.com/maps/dir/35.9606,-83.9207/35.80,-83.95/35.7565,-83.97/@35.8,-83.9,11z');
  await page.press('#destInput', 'Enter');
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.id === 'route_link', null, { timeout: 20000 });
  const locs = bodies[bodies.length - 1].locations.map((l) => [l.lat, l.lon]);
  check(JSON.stringify(locs) === JSON.stringify([[35.9606, -83.9207], [35.8, -83.95], [35.7565, -83.97]]), 'the link\'s stops, in order: ' + JSON.stringify(locs));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('CarPlay feed: a planned route sends its line, every corner and the theme; the car can mute and ask again (CarPlay/ApexCarPlay.swift)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__car = []; window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'car') window.__car.push(m); } } } }; });
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    if (!req.locations) return route.abort();
    const t = stubTrip(req.locations), a = req.locations[0], b = req.locations[req.locations.length - 1], pts = [];
    for (let i = 0; i <= 3000; i++) {   // a mountain road: tight bends (about 70 m radius), so the route has corners to rate
      const f = i / 3000, w = Math.sin(f * Math.PI * 220) * 0.0007 * Math.sin(f * Math.PI);
      pts.push([a.lat + (b.lat - a.lat) * f + w, a.lon + (b.lon - a.lon) * f - w]);
    }
    t.trip.legs[0].shape = polyline6(pts); t.trip.legs[0].maneuvers[1].begin_shape_index = 1500; t.trip.legs[0].maneuvers[2].begin_shape_index = 3000;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(t) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  const kinds = () => page.evaluate(() => window.__car.map((m) => m.kind));
  check((await kinds()).includes('look'), 'the theme goes to the car at start');
  await page.evaluate(() => window.apex.live({ lat: 35.6, lon: -84.1, accuracy_m: 5, speed_mps: 0, course_deg: 0, has_fix: true }));   // the shell's fix, as in the app
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'go', lat: 35.7565, lon: -83.97, name: 'Maryville' }));
  await page.waitForFunction(() => window.__car.some((m) => m.kind === 'route') && window.__car.some((m) => m.kind === 'corners' && m.list.length), null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ route: window.__car.find((m) => m.kind === 'route'), corners: window.__car.filter((m) => m.kind === 'corners').pop(),
    look: window.__car.filter((m) => m.kind === 'look').pop() }));
  check(r.route.options[0].detail.includes('corner'), 'the route choice says its corners: ' + JSON.stringify(r.route.options[0]));
  check(r.corners.list.every((c) => Array.isArray(c.at) && /^[LR](HP|\d)$/.test(c.text)), 'every corner placed and rated: ' + JSON.stringify(r.corners.list.slice(0, 3)));
  check(r.look.theme === 'roadbook' && r.look.voice === true && /^#/.test(r.look.card) && r.look.units === 'imperial', 'the look: ' + JSON.stringify(r.look));
  // the tulip is drawn at once (Path2D), so it rides on the first guide message; the car showed Apple's arrow without it
  const png = await page.evaluate(() => { const svg = ApexCarPlay.cornerTulipSVG('R', 1, '#EDE4D3'); return document.createElement('canvas') && apexDebug.tulipPNG ? apexDebug.tulipPNG(svg) : null; });
  check(typeof png === 'string' && png.length > 400, 'a corner tulip as a PNG, synchronously: ' + (png ? png.length : png));
  // a car screen that connects later asks again and gets the route and the look again
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'hello' }); });
  await page.waitForFunction(() => ['route', 'corners', 'look', 'places'].every((k) => window.__car.some((m) => m.kind === k)));
  // the mute map button
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'voice' }); });
  await page.waitForFunction(() => window.__car.some((m) => m.kind === 'look' && m.voice === false));
  check(await page.evaluate(() => apexDebug.state.toggles.voice === false), 'the voice is off on the phone too');
});

flow('the sight-line speed rides under the position arrow, on the phone and on the car map (the owner, 2026-10-29)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  await page.waitForFunction(() => { const t = document.querySelector('.sight-tag'); return t && !t.hidden; }, null, { timeout: 10000 });
  const tag = await page.textContent('.sight-tag');
  const cell = await page.textContent('#cluster');
  check(/^(\d+(MPH|KM\/H)|OPEN)$/.test(tag.trim()), 'the tag reads a speed or OPEN: ' + tag);
  check(/OPEN/.test(tag) ? /Open/.test(cell) : cell.includes(tag.replace(/\D/g, '')), 'the same value as the Sight cell: ' + tag);
  // the car's map: the same tag under its arrow, hidden when unknown, red when short
  await page.goto(base + '/carmap.html');
  await page.waitForFunction(() => window.car && document.querySelector('.car-sight'));
  const read = () => page.evaluate(() => { const t = document.querySelector('.car-sight'); return { hidden: t.hidden, text: t.textContent, short: t.classList.contains('short') }; });
  await page.evaluate(() => { car.position(35.4, -84.1, 90); car.sight({ text: null }); });
  check((await read()).hidden, 'unknown: no tag');
  await page.evaluate(() => car.sight({ text: '43', unit: 'MPH', short: true }));
  const r = await read();
  check(!r.hidden && r.text === '43MPH' && r.short, 'the car tag: ' + JSON.stringify(r));
  // plates never pile up: three corners on one spot show one plate, the tight one when there is no car to measure from
  await page.evaluate(() => { car.mode('preview'); car.corners([{ at: [35.4, -84.1], text: 'R4', tight: false }, { at: [35.4, -84.1], text: 'L2', tight: true }, { at: [35.40001, -84.1], text: 'R3', tight: false }]); });
  await page.waitForTimeout(300);
  const vis = await page.evaluate(() => [...document.querySelectorAll('.car-corner')].filter((e) => e.style.visibility !== 'hidden').map((e) => e.textContent));
  check(vis.length === 1, 'one plate where three overlap: ' + vis.join());
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.car-puck')).zIndex === '3'), 'the car above the plates');
});

flow('a route being driven comes back after the app is closed; a planned one, or a finished drive, does not (the owner, 2026-10-30)', async (page, base) => {
  const ctx = page.context();
  await ctx.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage() {} } } }; });   // as in the app: the shell feeds GPS
  await ctx.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await ctx.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    if (!req.locations) return route.abort();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  await page.evaluate(() => window.apex.live({ lat: 35.6, lon: -84.1, accuracy_m: 5, speed_mps: 0, course_deg: 0, has_fix: true }));
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'go', lat: 35.7565, lon: -83.97, name: 'Maryville' }));
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route'; }, null, { timeout: 20000 });
  const name = await page.evaluate(() => window.apexDebug.track.name);
  const relaunch = async () => {                                    // a new tab: no session left, like opening the app again
    const p = await ctx.newPage();
    await p.goto(base + '/index.html');
    await p.waitForFunction(() => window.apexDebug && window.apexDebug.map);
    await p.waitForTimeout(2500);
    const t = await p.evaluate(() => (window.apexDebug.track && window.apexDebug.track.kind === 'route' ? window.apexDebug.track.name : null));
    await p.close();
    return t;
  };
  check(await relaunch() === null, 'a planned route does not come back on a fresh open');
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start' }));   // started from the car
  await page.waitForFunction(() => window.apexDebug.driveActive);
  check(await relaunch() === name, 'the route being driven comes back');
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'end' }));
  await page.waitForFunction(() => !window.apexDebug.driveActive);
  check(await relaunch() === null, 'after the drive ends, a fresh open has no route');
}, { geolocation: { latitude: 35.6, longitude: -84.1 }, permissions: ['geolocation'] });

flow('the car connects: CarPlay offers Start drive, and an apexnav://open?go=drive link starts one', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  await page.evaluate(() => window.apex.onNative({ type: 'car', via: 'carplay' }));
  await page.waitForFunction(() => /CarPlay connected/.test(document.getElementById('toast').textContent));
  await page.click('#toast a');
  await page.waitForSelector('#permSheet.show');                 // first drive: the permissions sheet comes first
  await page.evaluate(() => document.getElementById('permNo').click());
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForSelector('#permSheet.show');
  // The offer is up when the drive starts some other way: starting it takes the offer down, so it can't hold back
  // other toasts, and no new offer comes while driving.
  await page.evaluate(() => window.apex.onNative({ type: 'car', via: 'carplay' }));
  await page.waitForSelector('#toast a');
  await page.evaluate(() => { document.querySelector('.tab[data-view="garage"]').click(); });   // the phone on another screen
  await page.waitForSelector('#sheet.open');
  await page.evaluate(() => document.getElementById('permGo').click());
  await page.waitForFunction(() => !document.querySelector('#sheet.open'), null, { timeout: 3000 });   // the drive takes the whole screen
  await page.waitForFunction(() => !document.querySelector('#toast a') && !(document.getElementById('toast')._holdUntil > performance.now()), null, { timeout: 3000 });   // well inside the offer's 10 s
  await page.evaluate(() => window.apex.onNative({ type: 'car', via: 'carplay' }));
  check(!(await page.isVisible('#toast a')), 'no offer while a drive is running');
  // Cold start from the link on a fresh install: the page opens with ?go=drive and goes straight to Start drive,
  // without onboarding on top.
  const fresh = await page.context().browser().newContext();
  await fresh.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  try {
    const cold = await fresh.newPage();
    const errors = [];
    cold.on('pageerror', (e) => errors.push(e.message));
    await cold.goto(base + '/index.html?go=drive');
    await cold.waitForSelector('#permSheet.show');
    check(!(await cold.isVisible('#onboard.show')), 'no onboarding over a go=drive start');
    check(!errors.length, 'no page errors on a go=drive start: ' + errors.join('; '));
  } finally { await fresh.close(); }
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('privacy zones: add one at the map centre, kept on the phone only, then remove it (IDEAS Z-02)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.click('.tab[data-view="garage"]');
  await page.click('#zoneRadius [data-zone-r="200"]');
  await page.click('#zoneMapBtn');
  await page.fill('.confirm-sheet .cs-field', 'Home'); await page.click('.confirm-sheet .cs-ok');
  await page.waitForFunction(() => /Home · 200 m/.test(document.getElementById('zoneList').textContent));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.privacyZones')));
  check(saved.length === 1 && saved[0].name === 'Home' && saved[0].r === 200, 'the zone is saved on the phone');
  await page.click('#zoneList .linkbtn');
  await page.waitForFunction(() => /No zones yet/.test(document.getElementById('zoneList').textContent));
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('apex.privacyZones')))).length === 0, 'removed from the phone too');
});

flow('convoy: an in-app invite toasts and Join gets you in, no link (Worker stubbed, IDEAS S-22)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const id = 'AAAAAAAAAAAAAAAAAAAAAA', until = Date.now() + 20 * 60000;
  let accepted = false;
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/convoy/invites') return json(accepted ? [] : [{ id, name: 'Sunday run', from: 'lead', expiresAtMs: until }]);
    if (u.pathname === `/api/convoy/${id}/accept` && m === 'POST') {
      accepted = JSON.parse(route.request().postData()).consent === true;
      return json({ sessionId: id, name: 'Sunday run', role: 'member', you: 'k2', leaderKey: 'k1', expiresAtMs: until, seq: 0, leaderEpoch: 1,
                    members: [{ key: 'k1', handle: 'lead', role: 'leader', online: true }, { key: 'k2', handle: 'me', role: 'member', online: true }] });
    }
    if (u.pathname === `/api/convoy/${id}/ticket`) return json({ ticket: 't'.repeat(32), expiresAtMs: Date.now() + 60000 }, 201);   // the socket itself stays offline here
    if (u.pathname === `/api/convoy/${id}`) return json(accepted ? { sessionId: id, name: 'Sunday run', role: 'member', you: 'k2', leaderKey: 'k1', expiresAtMs: until, seq: 0, leaderEpoch: 1,
      members: [{ key: 'k1', handle: 'lead', role: 'leader', online: true }, { key: 'k2', handle: 'me', role: 'member', online: true }] } : {}, accepted ? 200 : 404);
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.addInitScript(() => {   // every toast the page shows, so a later one can't hide the invite's
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => window.__toasts.push(document.getElementById('toast').textContent))
      .observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }));
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__toasts.some((t) => /@lead invited you to a convoy: Sunday run/.test(t)), null, { timeout: 10000 });
  await page.evaluate(() => window.apexDebug && window.apexDebug.showView ? window.apexDebug.showView('crew') : document.querySelector('.tab[data-view="crew"]').click());
  await page.waitForSelector('button:has-text("Join")');
  check(/@lead invited you: Sunday run/.test(await page.textContent('#sheet')), 'the Crew sheet says who invited you and to what');
  await page.click('button:has-text("Join")');
  await page.waitForFunction(() => /you are following/.test(document.getElementById('sheet').textContent), null, { timeout: 5000 });
  check(accepted, 'joined with consent, without a link');
});

flow('crew page: the tab opens your crew; going, chat and the livery reach the Worker (Worker stubbed, REVIEW.md roadmap 20)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const sent = [], soon = new Date(Date.now() + 3 * 86400e3).toISOString();
  const crewPage = { id: 'k1', name: 'Ridge Runners', motto: 'Slow in, smooth out.', visibility: 'private', area_name: null, members: 3, is_owner: true,
    crest: null, crest_photo_id: null, stripe: null, cover_photo_id: null, livery: 'plain', sharing_scores: true,
    board: [{ handle: 'sam', score: 811, car: 'Mazda MX-5', mine: false }, { handle: 'me', score: null, car: null, mine: true }],
    next: { id: 'e1', title: 'Dawn run', starts_at: soon, meet_name: 'The Hardee\'s', going: ['sam'], my_rsvp: null } };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') { sent.push({ m, p: u.pathname, b: route.request().postData() }); return m === 'POST' ? json({ id: 'x' }, 201) : route.fulfill({ status: 204 }); }
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/crews') return json([{ id: 'k1', name: 'Ridge Runners', role: 'owner', visibility: 'private', members: 3 }]);
    if (u.pathname === '/api/crews/k1/page') return json(crewPage);
    if (u.pathname === '/api/crews/k1/chat') return json([{ id: 'm1', handle: 'sam', body: '<b>Fog</b> by 7?', created_at: '2026-10-29 10:00:00', mine: false, photo_id: null }]);
    return json([]);
  });
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-page .cp-title h2');
  check((await page.textContent('.crew-page h2')) === 'Ridge Runners', 'the Crew tab opens the crew');
  const rows = await page.$$eval('.cp-board-row', (r) => r.map((x) => [x.querySelector('.who b').textContent, x.querySelector('.score').textContent]));
  check(JSON.stringify(rows) === JSON.stringify([['@sam', '811'], ['@me', '--']]), 'the board: a Score, then -- for no Score: ' + JSON.stringify(rows));
  check(await page.$eval('.cp-msg p', (p) => p.textContent === '<b>Fog</b> by 7?' && !p.querySelector('b')), 'chat is set as text');
  await page.click('.cp-drive button:has-text("going")');
  await page.fill('.cp-say textarea', 'Saturday it is');
  await page.click('.cp-say button:has-text("Send")');
  await page.click('.cp-edit');
  await page.click('.cp-crests button[aria-label="Peak"]');
  await page.click('.cp-swatches button[aria-label="Blue"]');
  await page.click('.cp-livery-ed button:has-text("Save")');
  const find = (p) => sent.find((x) => x.p === p);
  for (let i = 0; i < 50 && !(find('/api/events/e1/rsvp') && find('/api/crews/k1/chat') && find('/api/crews/k1/page')); i++) await page.waitForTimeout(100);
  check(find('/api/events/e1/rsvp') && JSON.parse(find('/api/events/e1/rsvp').b).status === 'going', 'I\'m going sends going');
  check(find('/api/crews/k1/chat') && JSON.parse(find('/api/crews/k1/chat').b).body === 'Saturday it is', 'the message is sent');
  const liv = find('/api/crews/k1/page');
  check(liv && liv.m === 'PUT' && JSON.parse(liv.b).crest === 'peak' && JSON.parse(liv.b).stripe === '#1f5fa8', 'the livery saves the crest and stripe: ' + (liv && liv.b));
  check(!('stripe2' in JSON.parse(liv.b)) && !('pattern' in JSON.parse(liv.b)), 'a Plain crew sends nothing past the Plain livery');
  check(/Plain livery/.test(await page.textContent('.cp-livery-line')) && /Decals come from crew-mates with Vetta Pro/.test(await page.textContent('.cp-livery-line')), 'the livery box says Plain and where Decals come from');
});

flow('build threads: start one from a car, add a step, a friend suggests and it shows on a red rule (Worker stubbed, REVIEW.md roadmap 23)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const sent = [];
  let build = null;
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') {
      const b = JSON.parse(route.request().postData() || 'null'); sent.push({ m, p, b });
      if (p === '/api/builds') { build = { id: 'b1', mine: true, stages: b.stages, make: 'Mazda', model: 'Miata', year: 2004, nickname: null, mods: null, handle: 'me', followers: 0, following: false, posts: [] }; return json({ id: 'b1' }, 201); }
      if (p === '/api/builds/b1/posts') { build.posts.unshift({ id: 'po1', n: 1, stage: b.stage, title: b.title, body: b.body, parts: b.parts, score: b.score, created_at: '2026-10-29 08:00:00', photos: [], replies: [] }); return json({ id: 'po1', n: 1 }, 201); }
      if (p === '/api/builds/posts/po1/replies') { build.posts[0].replies.push({ id: 'r1', handle: 'sam', body: b.body, suggestion: b.suggestion, tried: null, created_at: '2026-10-29 09:00:00', mine: true }); return json({ id: 'r1' }, 201); }
      return route.fulfill({ status: 204 });
    }
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (p === '/api/garage') return json([{ id: 'c1', make: 'Mazda', model: 'Miata', year: 2004, is_primary: 1, shared: 1, cover_photo_id: null, build_id: build ? 'b1' : null }]);
    if (p === '/api/builds/b1') return json(build);
    return json([]);
  });
  await page.goto(base + '/index.html?view=garage');
  await page.click('button:has-text("Start a build thread")');
  for (const st of ['Suspension', 'Brakes']) { await page.fill('input[aria-label="New stage"]', st); await page.click('.bv-form button:has-text("Add")'); }
  await page.click('button:has-text("Start the thread")');
  await page.waitForSelector('.build-view .bv-head h2');
  check(JSON.stringify(sent.find((x) => x.p === '/api/builds').b) === JSON.stringify({ car_id: 'c1', stages: ['Suspension', 'Brakes'] }), 'the thread starts with its stages');
  check(/2 stages planned/.test(await page.textContent('.bv-stages')), 'the stage bar before any step');
  await page.click('button:has-text("Add a step")');
  await page.fill('input[aria-label="Step title"]', 'Coilovers <b>in</b>');
  await page.click('.build-view .row-pick[aria-label^="Stage"]'); await page.click('.row-pick-sheet [role="option"]:has-text("Suspension")');   // the app's row list
  await page.fill('input[aria-label="Parts"]', 'Ohlins DFV R&T, 7k / 5k springs');
  await page.click('button:has-text("Post the step")');
  await page.waitForSelector('.bv-post h3');
  const step = sent.find((x) => x.p === '/api/builds/b1/posts').b;
  check(step.title === 'Coilovers <b>in</b>' && step.stage === 0 && JSON.stringify(step.parts) === JSON.stringify(['Ohlins DFV R&T', '7k / 5k springs']) && step.score === null, 'the step: ' + JSON.stringify(step));
  check(await page.$eval('.bv-post h3', (h) => h.textContent === 'Coilovers <b>in</b>' && !h.querySelector('b')), 'the title is set as text');
  check(/Stage 1 of 2 · Suspension/.test(await page.textContent('.bv-stages')), 'the stage bar moves');
  // a friend's view: suggestion on
  build.mine = false; build.handle = 'nate';
  await page.click('.bv-top button:has-text("Back")');
  await page.evaluate(() => document.querySelectorAll('.build-view').forEach((o) => o.remove()));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Build thread').click());
  await page.waitForSelector('.bv-say input');
  await page.fill('.bv-say input', 'One click softer on the rear rebound');
  await page.click('.bv-say button:has-text("Suggestion")');
  await page.click('.bv-say button:has-text("Post")');
  await page.waitForSelector('.bv-reply.sugg');
  const r = sent.find((x) => x.p === '/api/builds/posts/po1/replies').b;
  check(r.suggestion === true && r.body === 'One click softer on the rear rebound', 'the suggestion is sent');
  // the thread's chat, folded away until opened
  await page.click('.bv-chat summary');
  await page.waitForSelector('.bv-chat input[aria-label="Chat message"]');
  await page.fill('.bv-chat input[aria-label="Chat message"]', 'Which pads?');
  await page.click('.bv-chat button:has-text("Send")');
  await page.waitForTimeout(300);
  check(sent.some((x) => x.p === '/api/builds/b1/chat' && x.b.body === 'Which pads?'), 'a chat message is sent');
});

flow('friends on the map: off by default; the first time on explains both choices; Show me to sends no zones for Nobody; pucks say how old (Worker stubbed, REVIEW.md roadmap 24)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.privacyZones', JSON.stringify([{ id: 'z1', name: 'Home', lat: 35.37, lon: -84.28, r: 300 }])); } catch (_) {} });
  const sent = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') { sent.push({ m, p, b: JSON.parse(route.request().postData() || 'null') }); return route.fulfill({ status: 204 }); }
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (p === '/api/presence/settings') return json({ audience: 'nobody', delay_s: 600, fuzz: true });
    if (p === '/api/presence') return json([{ handle: 'sam', photo_id: null, delay_s: 600, fuzz: true, lat: 35.36, lon: -84.29, road: null, at: new Date(Date.now() - 12 * 60000).toISOString() }]);
    return json([]);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  check(await page.evaluate(() => apexDebug.state.toggles.friends === false && !document.querySelector('.fm-puck')), 'the layer is off by default');
  await page.waitForFunction(() => document.querySelector('#app') && window.apexDebug);
  await page.waitForTimeout(1500);                                                        // the account is known
  await page.click('#swTab');
  await page.click('[data-toggle="friends"]');
  await page.waitForSelector('[aria-label="Friends on the map"]');
  check(/Nobody sees you until you choose/.test(await page.textContent('[aria-label="Friends on the map"]')), 'the first time, the sheet explains: seeing is not sharing');
  await page.waitForSelector('.fm-puck');
  check(/@sam, about 12 min ago · within a mile/.test(await page.$eval('.fm-puck', (e) => e.closest('[aria-label]').getAttribute('aria-label'))), 'the puck says how old and how rough');
  // a friend near the right edge: the label goes on the face's left, clear of the Layers key and the screen
  const edge = await page.evaluate(async () => { const m = apexDebug.map, w = m.getContainer().clientWidth, mk = document.querySelector('.fm-puck').parentElement;
    apexDebug.state.follow = false;
    m.jumpTo({ pitch: 0, bearing: 0 });
    const at = m.project([-84.29, 35.36]), h = m.getContainer().clientHeight;
    m.jumpTo({ center: m.unproject([w / 2 + at.x - (w - 40), h / 2]) });
    await new Promise((r) => setTimeout(r, 300));
    const t = document.querySelector('.fm-tag').getBoundingClientRect(), k = document.getElementById('swTab').getBoundingClientRect();
    return { x: Math.round(m.project([-84.29, 35.36]).x), flip: document.querySelector('.fm-puck').classList.contains('flip'), right: Math.round(t.right), w, clear: t.right <= k.left || t.top >= k.bottom || t.bottom <= k.top }; });
  check(edge.flip && edge.right <= edge.w && edge.clear, 'a friend at the right edge keeps the label on screen and off the Layers key: ' + JSON.stringify(edge));
  await page.click('[aria-label="Show me to"] button:has-text("Friends")');
  await page.waitForFunction(() => /Your friends see you 10 minutes late, within a mile/.test(document.querySelector('[aria-label="Friends on the map"]').textContent));
  const put = sent.find((x) => x.p === '/api/presence/settings');
  check(put && put.b.audience === 'friends' && put.b.delay_s === 600 && put.b.fuzz === true && put.b.zones.length === 1, 'sharing sends the choices and the home zones: ' + JSON.stringify(put && put.b));
  await page.click('[aria-label="Show me to"] button:has-text("Nobody")');
  await page.waitForTimeout(300);
  const off = sent.filter((x) => x.p === '/api/presence/settings').pop();
  check(JSON.stringify(off.b) === JSON.stringify({ audience: 'nobody' }), 'Nobody sends nothing else');
  check(!sent.some((x) => x.p === '/api/presence' && x.m === 'POST'), 'nothing is sent while not driving');
});

flow('drive ended: your best on this road on the card, and the pack closes with the score from its own clips (REVIEW.md 4.4)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    const S = window.speechSynthesis; if (S) S.speak = (u) => setTimeout(() => u.onend && u.onend(), 20); });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording && window.ApexEndLine && window.ApexVoice);
  const out = await page.evaluate(async () => {
    // the score of a drive here is its sample count, so the newest (200) beats the earlier one (100) on the same road
    ApexCore.driverScore = (v) => ({ score: v.length, components: {} });
    window.__played = null;
    ApexVoice.load = async () => { ApexVoice.bank = ApexVoice.bank || { style: 'codriver', engine: 'kokoro', tokens: {} }; };
    ApexVoice.play = async (t) => { window.__played = t; return true; };
    ApexVoice.joins = () => 0;
    apexDebug.state.toggles.voice = true;
    const rec = (id, n) => { const lat = [], lon = []; for (let i = 0; i < n; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
      return { id, name: 'Cherohala Skyway', date: '2026-10-2' + (n > 150 ? '9' : '0') + 'T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
        lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }; };
    await ApexRecording.store(rec('old1', 100));
    const d = rec('new1', 200);
    await ApexRecording.store(d);
    apexDebug.showEndCard(d, Date.now() - 30 * 60000);
    for (let i = 0; i < 50 && !window.__played; i++) await new Promise((r) => setTimeout(r, 100));
    return { line: document.getElementById('endLine').textContent, score: document.getElementById('endScore').textContent, played: window.__played };
  });
  check(out.score === '200' && /^Your best on this road\./.test(out.line), 'the card: ' + JSON.stringify(out));
  check(JSON.stringify(out.played) === JSON.stringify(['sys:end', 'end:score', 'n:h2', 'end:best']), 'Marguerite closes with the score from her clips: ' + JSON.stringify(out.played));
});

flow('convoy: the leader shows a QR code of the link (Worker stubbed, IDEAS S-22)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const id = 'BBBBBBBBBBBBBBBBBBBBBB', until = Date.now() + 120 * 60000;
  const ctx = { sessionId: id, name: 'Convoy', role: 'leader', you: 'k1', leaderKey: 'k1', expiresAtMs: until, seq: 0, leaderEpoch: 1,
                members: [{ key: 'k1', handle: 'me', role: 'leader', online: true }] };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/convoy' && m === 'POST') return json({ invite: `${id}.${'s'.repeat(32)}`, context: ctx }, 201);
    if (u.pathname === `/api/convoy/${id}/ticket`) return json({ ticket: 't'.repeat(32), expiresAtMs: Date.now() + 60000 }, 201);
    if (u.pathname === `/api/convoy/${id}`) return json(ctx);
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => window.apexDebug && window.apexDebug.showView ? window.apexDebug.showView('crew') : document.querySelector('.tab[data-view="crew"]').click());
  await page.click('button:has-text("Start a convoy")');
  await page.click('button:has-text("Show QR")');
  await page.waitForSelector('canvas.cv-qr');
  const dark = await page.evaluate(() => { const c = document.querySelector('canvas.cv-qr'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n / (d.length / 4); });
  check(dark > 0.2 && dark < 0.6, `a QR code is drawn (${(dark * 100).toFixed(0)} % dark)`);
});

flow('garage: a VIN fills the car in, the owner keeps the colour (NHTSA stubbed, IDEAS S-21)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route('https://vpic.nhtsa.dot.gov/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Results: [
    { ModelYear: '2022', Make: 'MAZDA', Model: 'MX-5', Trim: 'Grand Touring', DriveType: 'RWD/Rear-Wheel Drive', TransmissionStyle: '', EngineHP: '181' }] }) }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexGarageUI && window.ApexCarLookup);
  await page.evaluate(() => {   // the garage section on its own, with a signed-in member's empty garage
    const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
    const btn = (text, onclick, className = 'ink-btn') => el('button', { textContent: text, onclick, className });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    window.__garage = { calls: [], cars: null };
    const g = ApexGarageUI.mount({ el, btn, toast: () => {}, apiCall: async (m, p, b) => { window.__garage.calls.push({ m, p, b }); return ok(m === 'POST' ? { id: 'c1' } : []); },
      jsonOf: (r) => r.json(), onCars: (list) => { window.__garage.cars = list; } });
    const host = el('div', { id: 'e2eGarage' }); document.body.prepend(host); host.append(g.section());
  });
  await page.click('#e2eGarage button:has-text("Add a car")');
  await page.fill('#e2eGarage input[name="color"]', 'Soul Red');
  await page.fill('#e2eGarage input[name="vin"]', 'JM1NDAD75N0500000');
  await page.click('#e2eGarage button:has-text("Look up VIN")');
  await page.waitForFunction(() => document.querySelector('#e2eGarage input[name="power_hp"]').value === '181');
  const v = await page.evaluate(() => Object.fromEntries(['year', 'make', 'model', 'trim', 'power_hp', 'weight_lb', 'color'].map((k) =>
    [k, document.querySelector(`#e2eGarage [name="${k}"]`).value]).concat([['drive', document.querySelector('#e2eGarage [name="drivetrain"]').value]])));
  check(v.year === '2022' && v.make === 'Mazda' && v.model === 'MX-5' && v.trim === 'Grand Touring', 'year, make, model and trim filled');
  check(v.drive === 'rwd' && v.weight_lb !== '', 'drive from the VIN, weight from typical specs');
  check(v.color === 'Soul Red', 'the colour the owner typed is kept');
  check(/typical factory specs/.test(await page.textContent('#e2eGarage [role="status"]')), 'says the specs are typical');
  // ride height and width for routing (IDEAS R-20), in inches by default, kept in cm
  await page.click('#e2eGarage .row-pick[aria-label^="Ride height"]'); await page.click('.row-pick-sheet [role="option"]:has-text("Lowered")');   // the app's row list
  await page.fill('#e2eGarage input[name="width"]', '75');
  await page.click('#e2eGarage button:has-text("Add car")');
  const sent = await page.evaluate(() => window.__garage.calls.find((c) => c.m === 'POST'));
  check(sent && sent.b.clearance === 'low' && sent.b.width_cm === 191, 'ride height and width saved: ' + JSON.stringify(sent && sent.b));
  check(await page.evaluate(() => Array.isArray(window.__garage.cars)), 'the planner hears about your cars');
});

flow('garage photos: a big photo with a GPS tag goes up small and clean, and becomes the cover (Worker stubbed, REVIEW.md 5.2)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexGarageUI && window.ApexPhotos && window.ApexSync);
  await page.evaluate(() => {
    const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
    const btn = (text, onclick, className = 'ink-btn') => el('button', { textContent: text, onclick, className });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob([]) });
    window.__ph = { sent: null, toasts: [], rendered: 0 };
    ApexSync.apiFetch = async (path, opts = {}) => {
      if (opts.method === 'POST') { window.__ph.sent = { path, type: opts.headers['content-type'], body: opts.body }; return ok({ id: 'p1', w: 1600, h: 1067 }); }
      return ok([]);
    };
    const car = { id: 'c1', make: 'Mazda', model: 'MX-5', year: 2022, is_primary: 1, cover_photo_id: null };
    const g = ApexGarageUI.mount({ el, btn, toast: (t) => window.__ph.toasts.push(t), jsonOf: (r) => r.json(), onPhotos: () => { window.__ph.rendered++; },
      apiCall: async (m, p) => ok(p === '/api/garage' ? [car] : []) });
    const host = el('div', { id: 'e2ePhotos' }); document.body.prepend(host); host.append(g.section());
  });
  await page.waitForSelector('#e2ePhotos label.photo-pick');
  check(/Add a cover photo/.test(await page.textContent('#e2ePhotos label.photo-pick')), 'a car without photos asks for a cover');
  // a 3000 x 2000 JPEG with an EXIF segment naming a place, put on the picker
  await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 }), x = c.getContext('2d');
    x.fillStyle = '#c33'; x.fillRect(0, 0, 3000, 2000);
    const raw = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
    const tag = [...'Exif\0\0GPS 35.61 -83.92 home'].map((ch) => ch.charCodeAt(0)), seg = [0xff, 0xe1, 0, tag.length + 2, ...tag];
    const file = new File([raw.subarray(0, 2), new Uint8Array(seg), raw.subarray(2)], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('#e2ePhotos label.photo-pick input'), dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => window.__ph.sent && window.__ph.rendered > 0, null, { timeout: 15000 });
  const sent = await page.evaluate(async () => {
    const s = window.__ph.sent, buf = new Uint8Array(await s.body.arrayBuffer()), bmp = await createImageBitmap(s.body);
    return { path: s.path, type: s.type, size: buf.length, w: bmp.width, h: bmp.height, gps: new TextDecoder('latin1').decode(buf).includes('GPS'), soi: buf[0] === 0xff && buf[1] === 0xd8 };
  });
  check(sent.path === '/api/photos?kind=car&ref=c1&cover=1' && sent.type === 'image/jpeg' && sent.soi, 'sends a JPEG as the car\'s cover: ' + sent.path);
  check(sent.w === 1600 && sent.h === 1067 && sent.size <= 650000, `redrawn to 1600 px and under the cap: ${sent.w}x${sent.h} ${sent.size} B`);
  check(!sent.gps, 'the GPS tag never leaves the phone');
  check(await page.evaluate(() => window.__ph.toasts.some((t) => /location data stayed/.test(t))), 'says the location stayed behind');
});

flow('reported hazards: a call ahead, "still there?" after passing, and a one-tap report (Worker stubbed, IDEAS Q-15/Q-16)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__said = []; const S = window.speechSynthesis;   // what the co-driver says, whatever voice is set
    if (S) S.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); }; });
  const N = (m) => m / 110540, votes = [], reports = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/hazards' && m === 'GET') return json([{ id: 'h1', kind: 'gravel', lat: 35.6 + N(200), lon: -83.9, heading: 0, confirms: 2, clears: 0, m: 200 }]);
    if (u.pathname === '/api/hazards' && m === 'POST') { reports.push(JSON.parse(route.request().postData())); return json({ id: 'mine1', confirmed: false }, 201); }
    if (u.pathname === '/api/hazards/h1/vote') { votes.push(JSON.parse(route.request().postData())); return json({ ok: true }); }
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(async () => {   // heading north at 15 m/s, 1.5 m per 100 ms, from 0 m to 330 m
    for (let i = 0; i <= 220; i++) { window.apex.live({ lat: 35.6 + (i * 1.5) / 110540, lon: -83.9, accuracy_m: 5, speed_mps: 15, course_deg: 0, has_fix: true, calibration: 'locked' });
      const k = window.apexDebug.state.kitLine;   // a line the voice pack says (web/voice_lines.js) never reaches speechSynthesis
      if (k && window.__said[window.__said.length - 1] !== k) window.__said.push(k);
      await new Promise(r => setTimeout(r, 20)); }
  });
  await page.waitForFunction(() => !document.getElementById('hzAsk').hidden, null, { timeout: 5000 });
  check(/Gravel still there\?/.test(await page.textContent('#hzAsk')), 'asks after passing it');
  await page.click('#hzGone');
  for (let i = 0; i < 40 && !votes.length; i++) await page.waitForTimeout(50);   // the vote is a request: let it land
  check(votes.length === 1 && votes[0].still === false, 'the vote is sent');
  check(await page.evaluate(() => window.__said.some((t) => /gravel reported ahead/i.test(t)) || /Gravel reported ahead/.test(document.body.textContent)), 'the hazard was called ahead');
  await page.click('#hzReportBtn');
  await page.click('#hzKinds button:has-text("Pothole")');
  await page.waitForFunction(() => /Pothole reported/.test(document.getElementById('toast').textContent));
  check(reports.length === 1 && reports[0].kind === 'pothole' && Math.abs(reports[0].lat - (35.6 + 330 / 110540)) < 1e-4 && reports[0].heading === 0, 'reported at your position and heading');
});

flow('your data: Settings counts what the phone holds and downloads drives as GPX, offline data deleted (IDEAS Z-03/Z-04, F-06)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexRecording && window.ApexMyData);
  await page.evaluate(() => ApexRecording.store({ id: 'e2e_drive', name: 'Test road', date: '2026-10-20T15:00:00Z',
    lat: [35.6, 35.601, 35.602], lon: [-83.9, -83.901, -83.902], elev: null, dist: [0, 150, 300] }));
  await page.click('.tab[data-view="garage"]');
  await page.waitForFunction(() => /1 drive \(0.2 mi\)/.test(document.getElementById('myDataNote').textContent));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#myGpxBtn')]);
  const gpx = require('fs').readFileSync(await dl.path(), 'utf8');
  check(/<trk><name>Test road<\/name>/.test(gpx) && (gpx.match(/<trkpt /g) || []).length === 3, 'the GPX holds the drive');
  await page.click('#myDrivesDelBtn');
  await page.click('.confirm-sheet .cs-yes:has-text("Delete drives")');             // the confirm sheet, not a system alert (REVIEW.md 1.2)
  await page.waitForFunction(() => /0 drives/.test(document.getElementById('myDataNote').textContent));
  // offline data (IDEAS F-06): a saved route counted, then deleted; the drives are not touched by it
  await page.evaluate(() => { localStorage.setItem('apex.savedRoutes', JSON.stringify([{ id: 'r1', coords: [[0, 0], [1, 1]] }])); document.querySelector('.tab[data-view="garage"]').click(); });
  await page.waitForFunction(() => /Offline data: 1 saved route /.test(document.getElementById('myOfflineNote').textContent));
  await page.click('#myOfflineDelBtn');
  await page.click('.confirm-sheet .cs-yes');
  await page.waitForFunction(() => /Offline data: 0 saved routes/.test(document.getElementById('myOfflineNote').textContent));
  check((await page.evaluate(() => localStorage.getItem('apex.savedRoutes'))) === null, 'saved routes gone');
});

flow('shared routes: one a friend shared shows in Crew and opens as a planned route with notes (Worker stubbed, IDEAS S-05)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const geom = Array.from({ length: 120 }, (_, i) => [-83.9 + i * 4e-4 + Math.sin(i / 6) * 3e-4, 35.6 + i * 3e-4]);
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/routes/shared') return json([{ id: 'RRRRRRRRRRRRRRRR', name: 'Cherohala loop', created_at: '2026-10-28 05:00:00', from_handle: 'alice' }]);
    if (u.pathname === '/api/routes/RRRRRRRRRRRRRRRR') return json({ id: 'RRRRRRRRRRRRRRRR', name: 'Cherohala loop', geom, from_handle: 'alice' });
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => window.apexDebug && window.apexDebug.showView ? window.apexDebug.showView('crew') : document.querySelector('.tab[data-view="crew"]').click());
  await page.waitForSelector('text=Cherohala loop · from @alice');
  await page.click('button:has-text("Open")');
  await page.waitForFunction(() => /Cherohala loop/.test(document.getElementById('routeCardName').textContent), null, { timeout: 8000 });
  check(/corners/.test(await page.textContent('#routeCardMeta')), 'the route card has its corners (notes rebuilt from the shape)');
});

flow('crash check: a hard impact then a stop asks "Are you OK?"; no answer offers a call and a text to the contact (IDEAS D-17)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.crashContact', JSON.stringify({ name: 'Sam', phone: '+1 555 010 2030' })); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function' && window.ApexIncident);
  await page.evaluate(() => {   // 1 Hz frames: cruising at 20 m/s, a 12 g hit, to rest, then still
    const sp = [...Array(8).fill(20), 18, 8, 2, ...Array(12).fill(0)];
    sp.forEach((v, i) => window.apex.live({ t: 1e9 + i * 1000, lat: 35.6 + i * 1e-4, lon: -83.9, accuracy_m: 5, speed_mps: v, course_deg: 0, has_fix: true,
      impact_g: i === 8 ? 12 : 0.2 }));
  });
  await page.waitForSelector('.crash-sheet[role="alertdialog"]');
  check(/Are you OK\?/.test(await page.textContent('.crash-sheet')), 'asks if you are OK');
  await page.click('.crash-sheet button:has-text("Get help")');
  check(await page.getAttribute('.crash-sheet a[href^="tel:"]', 'href') === 'tel:911', 'offers the emergency call');
  const sms = await page.getAttribute('.crash-sheet a[href^="sms:"]', 'href');
  check(sms.startsWith('sms:+15550102030') && /maps\.apple\.com/.test(decodeURIComponent(sms)), 'the text to Sam carries where you are');
  await page.click('.crash-sheet button:has-text("OK")');
  check(!(await page.$('.crash-sheet')), 'closes');
});

flow('no signal: a hazard report waits on the phone and goes when the connection is back, with its age (IDEAS F-05)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  let offline = true; const posted = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    if (offline) return route.abort('internetdisconnected');
    if (u.pathname === '/api/hazards' && m === 'POST') { posted.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'q1', confirmed: false }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => window.apex.live({ lat: 35.6, lon: -83.9, accuracy_m: 5, speed_mps: 15, course_deg: 90, has_fix: true }));
  await page.click('#hzReportBtn');
  await page.click('#hzKinds button:has-text("Debris")');
  await page.waitForFunction(() => /Debris saved/.test(document.getElementById('toast').textContent));
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('apex.outbox')).length) === 1, 'kept on the phone');
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => /Sent what you reported/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  check(posted.length === 1 && posted[0].kind === 'debris' && posted[0].heading === 90 && Number.isInteger(posted[0].age_s), 'sent with its age');
  check(await page.evaluate(() => localStorage.getItem('apex.outbox')) === null, 'and gone from the phone');
});

flow('a saved stage: the live delta shows while you drive it and the result at the end (native frames, IDEAS D-05)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && window.ApexStageDelta && window.ApexRecording);
  // a winding road and a stored best pass over it, with the stage marked in the Log
  await page.evaluate(async () => {
    const Core = window.ApexCore, MPH = 2.2369362921, lat = [], lon = [];
    let la = 35.6, lo = -83.9, h = 0;
    for (let i = 0; i < 800; i++) { if (i > 100 && i < 700) h += 0.05 * Math.sin((i - 100) / 25);
      la += 5 * Math.cos(h) / 110540; lo += 5 * Math.sin(h) / (111320 * Math.cos(35.6 * Math.PI / 180)); lat.push(la); lon.push(lo); }
    const { kappa } = Core.computeCurvature(lat, lon);
    const v = kappa.map((k) => Math.max(9, 22 - 300 * Math.abs(k))), latG = v.map((x, i) => x * x * kappa[i] / 9.80665);
    const lonG = v.map((x, i) => (i ? (x * x - v[i - 1] ** 2) / 10 / 9.80665 : 0));
    const prof = Core.profileRecording({ lat, lon, distance_m: lat.map((_, i) => i * 5), speed_mph: v.map((x) => x * MPH), lon_g: lonG, lat_g: latG });
    await ApexRecording.store({ id: 'e2e_best', name: 'Esses run', date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: v, lon_g: lonG, lat_g: latG,
      g_known: null, events: prof.events, elev: null, hz: 1 });
    const a = 110, b = 690;
    localStorage.setItem('apex.segments', JSON.stringify([{ id: 'seg_e2e', name: 'Esses', lat0: lat[a], lon0: lon[a], lat1: lat[b], lon1: lon[b], length_m: (b - a) * 5,
      geom: JSON.stringify(Array.from({ length: 60 }, (_, k) => { const i = a + Math.round(k * (b - a) / 59); return [lat[i], lon[i]]; })) }]));
    window.__road = { lat, lon, v, latG, lonG };
  });
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForTimeout(300);
  if (await page.isVisible('#permSheet.show')) await page.click('#permGo');
  // drive the same road the same way, as the app's frames (half a bin apart), in bursts a second apart
  let seenBar = false;
  for (let burst = 0; burst < 10; burst++) {
    await page.evaluate((burst) => {
      const r = window.__road;
      for (let j = burst * 160; j < Math.min(1600, (burst + 1) * 160); j++) {
        const i = Math.min(799, Math.floor(j / 2)), f = (j % 2) / 2, k = Math.min(799, i + 1);
        window.apex.live({ lat: r.lat[i] + (r.lat[k] - r.lat[i]) * f, lon: r.lon[i] + (r.lon[k] - r.lon[i]) * f, accuracy_m: 4, speed_mps: r.v[i], course_deg: 0,
          lat_g: r.latG[i], lon_g: r.lonG[i], has_fix: true, calibration: 'locked' });
      }
    }, burst);
    await page.waitForTimeout(1050);
    if (!seenBar && await page.isVisible('#stageBar')) { seenBar = /Esses/.test(await page.textContent('#stageBar')); }
  }
  check(seenBar, 'the stage bar showed during the stage');
  await page.waitForFunction(() => /Esses: (level with|\d+ points (up|down) on) your best/.test(document.getElementById('toast').textContent), null, { timeout: 4000 });
  check(!(await page.isVisible('#stageBar')), 'the bar goes when the stage ends');
});

flow("friends' activity: the Log lists who drove your stages lately and where you stand, as text; kudos (Worker stubbed, IDEAS S-03, S-07)", async (page, base) => {
  const kudos = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/kudos' && route.request().method() === 'GET') return json([{ from_handle: 'dan', stage: 'Esses <i>x</i>', canon_id: 'seg_1', driven_on: '2026-10-24' }]);
    if (u.pathname === '/api/kudos') { kudos.push([route.request().method(), JSON.parse(route.request().postData())]); return route.fulfill({ status: 204 }); }
    if (u.pathname === '/api/board/activity') return json([
      { handle: 'bob', name: 'Bob', canon_id: 'seg_1', stage: 'Esses <b>bold</b>', driver_score: 812, driven_on: '2026-10-26', you: { rank: 2, of: 3, mine: 700 } },
      { handle: 'cara', name: null, canon_id: 'seg_2', stage: 'Dry Ridge', driver_score: 640, driven_on: '2026-10-25', you: { rank: null, of: 1, mine: null } }]);
    return json([]);
  });
  await page.goto(base + '/analysis.html?tab=log');
  await page.waitForSelector('#friendsPanel:not([hidden])');
  const text = await page.textContent('#friendsList');
  check(/@bob drove Esses <b>bold<\/b> · 812 · .* · you're 2nd of 3/.test(text), 'bob, the stage as typed (not as HTML), your rank: ' + text);
  check(/@cara drove Dry Ridge · 640 .*you haven't posted a score here/.test(text), 'no rank when you have no score');
  check(!(await page.$('#friendsList b b')), 'a stage name never becomes markup');
  await page.click('button[aria-label="Kudos to @bob for Esses <b>bold</b>"]');
  await page.waitForSelector('button[aria-label="Kudos to @bob for Esses <b>bold</b>"][aria-pressed="true"]');
  check(kudos.length === 1 && kudos[0][0] === 'POST' && kudos[0][1].handle === 'bob' && kudos[0][1].canon_id === 'seg_1' && kudos[0][1].driven_on === '2026-10-26', 'kudos sent: ' + JSON.stringify(kudos));
  check(/@dan gave you kudos for Esses <i>x<\/i>/.test(await page.textContent('#kudosList')), 'kudos for you, as text');
});

flow("what's new: shown once after an update, not on a first install, not over a link that opened the app (IDEAS O-10)", async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); if (!localStorage.getItem('apex.newsSeen')) localStorage.setItem('apex.newsSeen', 'an-older-release'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#newsSheet', { timeout: 5000 });
  check(/What's new/.test(await page.textContent('#newsSheet')) && (await page.$$('#newsSheet p')).length <= 4, 'one screen, at most four lines');
  await page.click('#newsSheet button');
  const id = await page.evaluate(() => localStorage.getItem('apex.newsSeen'));
  check(id === require('../web/whats_new.js').NEWS.id, 'marked seen');
  await page.reload(); await page.waitForTimeout(1800);
  check(!(await page.$('#newsSheet')), 'not again');
  // a first install: onboarding, never news; the release is marked seen so the next one is the first news
  const fresh = await page.context().browser().newContext();
  try {
    const p2 = await fresh.newPage();
    await p2.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await p2.goto(base + '/index.html'); await p2.waitForSelector('#onboard.show'); await p2.waitForTimeout(1800);
    check(!(await p2.$('#newsSheet')), 'no news on a first install');
    check(await p2.evaluate(() => localStorage.getItem('apex.newsSeen')) === require('../web/whats_new.js').NEWS.id, 'first install marks it seen');
  } finally { await fresh.close(); }
}, { news: true });

flow('crew drives: an upcoming drive shows in Crew with who is going; Going answers it; Plan a drive posts one; spots near you (Worker stubbed, IDEAS S-06, S-12)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const posted = [];
  // tomorrow at noon (now + 26 h is the day after tomorrow when the run starts after 22:00)
  const noon = new Date(); noon.setDate(noon.getDate() + 1); noon.setHours(12, 0, 0, 0);
  const starts = noon.toISOString();
  let mine = null;
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/crews' && m === 'GET') return json([{ id: 'CREW1', name: 'Ridge Runners', role: 'member', members: 3, visibility: 'private' }]);
    if (u.pathname === '/api/events/near') return json([{ id: 'MEET1AAAAAAAAAAA', crew_id: 'CREW9', crew_name: 'Coffee & Cars', title: 'Sunday coffee', starts_at: starts,
      meet_name: 'Kroger lot', meet_lat: 35.76, meet_lon: -83.96, notes: null, going: 7, member: false, km: 12 }]);
    if (u.pathname === '/api/events') return json([{ id: 'EVT1AAAAAAAAAAAA', crew_id: 'CREW1', crew_name: 'Ridge Runners', title: 'Cherohala <i>Saturday</i>', starts_at: starts,
      meet_name: 'Tellico Shell', meet_lat: 35.36, meet_lon: -84.29, route_id: null, notes: null, by_handle: 'bob', mine: false, can_cancel: false, my_rsvp: mine, going: ['bob', 'cara'], maybe: 1,
      lead: 'bob', sweep: null, regroup: [{ name: 'The overlook', lat: 35.33, lon: -84.12 }] }]);
    if (u.pathname === '/api/crews/CREW1/members') return json([{ handle: 'me', mine: true }, { handle: 'bob', mine: false }]);
    if (u.pathname === '/api/highlights' && m === 'GET') return json([{ id: 'HL1', name: 'Look Rock <b>view</b>', lat: 35.64, lon: -83.94, score: 4.5, ratings: 6, mine: false,
      category: 'overlook', note: 'Best at sunset', visits: 9, my_stars: null }, { id: 'HL2', name: 'Bean Stop', lat: 35.75, lon: -83.97, score: 3.9, ratings: 2, mine: true, category: 'cafe' }]);
    if (m === 'POST') { posted.push([u.pathname, JSON.parse(route.request().postData() || 'null')]); return u.pathname.endsWith('/rsvp') ? (mine = 'going', route.fulfill({ status: 204 })) : json({ id: 'NEWEVTAAAAAAAAAA' }, 201); }
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => document.querySelector('.tab[data-view="crew"]').click());
  await page.waitForSelector('text=Crew drives');
  // in a crew, Crew drives and Spots near you are rows on its page that open their lists (REVIEW2.md U-30)
  const openRow = (name) => page.evaluate((n) => { document.querySelectorAll('.side-pop.open').forEach((x) => x.classList.remove('open'));
    const r = [...document.querySelectorAll('.nav-row')].find((b) => b.textContent.includes(n)); if (r) r.click(); }, name).then(() => page.waitForTimeout(350));
  await openRow('Crew drives');
  await page.waitForSelector('.drive-card');
  const card = await page.textContent('.drive-card');
  check(card.includes('Cherohala <i>Saturday</i>') && /Tomorrow|Today/.test(card) && card.includes('Going: @bob, @cara · 1 maybe'), 'the drive, as text: ' + card);
  await page.waitForSelector('.meet-card');
  check(/Sunday coffee/.test(await page.textContent('.meet-card')) && /7 going/.test(await page.textContent('.meet-card')) && /Meets near you/.test(await page.evaluate(() => document.querySelector('.meet-card').closest('.side-pop, #sheet').textContent)), 'a public meet nearby');   // in a crew: the Crew drives row's sheet
  await page.click('.drive-card:not(.meet-card) button:has-text("Going")');
  await page.waitForFunction(() => document.querySelector('.drive-card:not(.meet-card) .switch button[aria-checked="true"]')?.textContent === 'Going');   // the answer is a slide switch
  check(posted.some(([p, b]) => p === '/api/events/EVT1AAAAAAAAAAAA/rsvp' && b.status === 'going'), 'the answer was sent');
  // roles and regroup points (roadmap 21)
  const roles = await page.textContent('.drive-card:not(.meet-card)');
  check(roles.includes('Lead @bob · Sweep open') && roles.includes('The overlook'), 'roles and the regroup point show: ' + roles);
  await page.click('.drive-card:not(.meet-card) button:has-text("I\'ll sweep")');
  await page.waitForTimeout(300);
  check(posted.some(([p, b]) => p === '/api/events/EVT1AAAAAAAAAAAA/role' && b.role === 'sweep' && b.take === true), 'I\'ll sweep was sent');
  // spots near you (IDEAS S-12): best rated first, as text, filterable; a rating is sent
  await openRow('Spots near you');
  await page.waitForSelector('.spot-card');
  const spots = await page.$$eval('.spot-card', (els) => els.map((e) => e.textContent));
  check(spots.length === 2 && spots[0].includes('Look Rock <b>view</b>') && /4\.5★ \(6\) · Overlook · [\d.]+ km · 9 visited/.test(spots[0]) && spots[0].includes('Best at sunset'), 'the spots: ' + spots.join(' | '));
  check(!/Report/.test(spots[1]) && !/5★/.test(spots[1]), 'no rating or report on your own spot');
  await page.click('.side-pop.open button:has-text("Café")');
  check((await page.$$('.spot-card')).length === 1, 'the café filter');
  await page.click('.side-pop.open button:text-is("All")');
  await page.click('.side-pop.open button[aria-label="Rate Look Rock <b>view</b> 5 stars"]');
  await page.waitForFunction(() => /Rated/.test(document.getElementById('toast').textContent));
  check(posted.some(([p, b]) => p === '/api/highlights/HL1/rating' && b.stars === 5), 'the rating was sent');
  // plan one: map centre as the meeting point
  await openRow('Crew drives');
  await page.click('.side-pop.open button:has-text("Plan a drive")');
  await page.fill('.side-pop.open input[aria-label="Drive name"]', 'Dragon run');
  await page.click('.side-pop.open button:has-text("Map centre")');
  // the sweep is picked from the app's row list (row_select.js), the select underneath only holds the value
  await page.waitForSelector('.side-pop.open select[aria-label="Sweep"] option[value="bob"]', { state: 'attached' });
  check(!(await page.$$('.side-pop.open select:not(.row-pick-native), .side-pop.open input[type=checkbox], .side-pop.open input[type=date], .side-pop.open input[type=time]')).length, 'the form shows none of the browser\'s own controls');
  await page.click('.side-pop.open .row-pick[aria-label^="Sweep"]');
  await page.click('.row-pick-sheet [role="option"]:has-text("@bob sweeps")');
  check(/Tmrw|Today/.test(await page.textContent('.side-pop.open .detents.scroll [aria-checked="true"]')), 'tomorrow is the day by default');
  await page.fill('.side-pop.open input[aria-label="Regroup point name"]', 'Gas at Robbinsville');
  await page.click('.side-pop.open button:has-text("Add at the map centre")');
  await page.click('.side-pop.open button:has-text("Plan it")');
  await page.waitForFunction(() => /Drive planned/.test(document.getElementById('toast').textContent));
  const plan = posted.find(([p]) => p === '/api/crews/CREW1/events');
  check(plan && plan[1].title === 'Dragon run' && /Z$/.test(plan[1].starts_at) && Number.isFinite(plan[1].meet.lat) && plan[1].route_id === null && plan[1].public === false, 'the plan was sent: ' + JSON.stringify(plan));
  check(plan[1].lead === undefined && plan[1].sweep === 'bob' && plan[1].regroup.length === 1 && plan[1].regroup[0].name === 'Gas at Robbinsville', 'with roles and a regroup point');
});

flow('crew drive morning: the idle map offers directions to today\'s meeting point instead of the loop (Worker stubbed, REVIEW.md roadmap 21)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const at = new Date(Date.now() + 40 * 60000);   // 40 minutes from now, today (unless that crosses midnight)
  if (at.getDate() !== new Date().getDate() || new Date().getHours() < 4) { check(true, 'skipped: too close to midnight or before 4 AM'); return; }
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/events') return json([{ id: 'EVT1AAAAAAAAAAAA', crew_id: 'C', crew_name: 'Ridge Runners', title: 'Dawn run', starts_at: at.toISOString(), meet_name: 'Tellico Shell',
      meet_lat: 35.36, meet_lon: -84.29, my_rsvp: 'going', going: ['me', 'bob'], maybe: 0, lead: 'bob', sweep: null, regroup: [] }]);
    return json([]);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => document.querySelector('.tab[data-view="crew"]').click());   // signs the page in (renderAccount)
  await page.evaluate(() => document.querySelector('.tab[data-view="map"]').click());
  await page.waitForSelector('#driveToday:not([hidden])', { timeout: 15000 });
  const t = await page.textContent('#driveToday');
  check(/Dawn run/.test(t) && /Meet at Tellico Shell/.test(t) && /2 going/.test(t) && /Lead @bob/.test(t), 'the reminder: ' + t);
  check(await page.$eval('#loopSuggest', (b) => getComputedStyle(b).display === 'none'), 'it takes the loop invitation\'s place');
});

flow('drive tags: tag a drive in the Log, filter by it, the note stays on the phone (IDEAS D-23)', async (page, base) => {
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await page.evaluate(async () => {
    const lat = [], lon = [];
    for (let i = 0; i < 200; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9); }
    const rec = (id, name) => ({ id, name, date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps' });
    await ApexRecording.store(rec('t1', 'Wet one <i>x</i>'));
    await ApexRecording.store(rec('t2', 'Dry one'));
  });
  await page.goto(base + '/analysis.html?drive=t1');
  await page.waitForSelector('#dvTags button');
  await page.click('#dvTags button:has-text("Wet")');
  await page.fill('#dvTagNew', 'E46');
  await page.press('#dvTagNew', 'Enter');
  await page.waitForSelector('#dvTags button[aria-pressed="true"]:has-text("E46")');
  await page.click('.dv-notebox summary');                            // the note folds under the tag row (REVIEW.md 14)
  await page.fill('#dvNoteText', 'Puddles at the bridge');
  await page.dispatchEvent('#dvNoteText', 'change');
  await page.waitForFunction(() => /Note saved/.test(document.getElementById('dvTagsNote').textContent));
  const rec = await page.evaluate(async () => (await ApexRecording.all()).find((d) => d.id === 't1'));
  check(JSON.stringify(rec.tags) === '["Wet","E46"]' && rec.note === 'Puddles at the bridge', 'saved on the drive: ' + JSON.stringify([rec.tags, rec.note]));
  await page.click('a.back[data-to="history"]');
  await page.waitForSelector('#historyFilter button');
  check((await page.$$('#historyTable tr.row-link')).length === 2, 'both drives listed');
  check((await page.textContent('#historyTable')).includes('Wet one <i>x</i>'), 'a drive name shows as text');
  await page.click('#historyFilter button:has-text("E46")');
  const rows = await page.$$eval('#historyTable tr.row-link', (els) => els.map((e) => e.dataset.drive));
  check(rows.length === 1 && rows[0] === 't1', 'filtered to the tagged drive: ' + rows);
  // which road was better (IDEAS S-17): asked on the newer drive, answered once, ranked in the Log
  await page.goto(base + '/analysis.html?drive=t2');
  await page.waitForSelector('#dvVote:not([hidden])');
  await page.click('#dvVoteBtns button:has-text("Wet one")');
  await page.waitForSelector('#dvVote[hidden]', { state: 'attached' });
  await page.click('a.back[data-to="history"]');
  await page.waitForSelector('#roadsPanel:not([hidden])');
  check((await page.textContent('#roadsList')).startsWith('1. Wet one <i>x</i>2. Dry one'), 'your roads: ' + await page.textContent('#roadsList'));
});

flow('flyby: a friend on the same stage that day shows on the drive, as text; challenges this month (Worker stubbed, IDEAS S-20, S-11)', async (page, base) => {
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/board/activity') return json([{ handle: 'bob', canon_id: 'CANON1', stage: 'Straight <b>run</b>', driver_score: 812, driven_on: '2026-10-20', you: { rank: null, of: 1, mine: null } },
      { handle: 'cara', canon_id: 'CANON1', stage: 'Straight <b>run</b>', driver_score: 600, driven_on: '2026-10-19', you: { rank: null, of: 1, mine: null } }]);
    return json([]);
  });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await page.evaluate(async () => {
    const lat = [], lon = [];
    for (let i = 0; i < 200; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9); }
    await ApexRecording.store({ id: 'f1', name: 'Morning run', date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps' });
    const a = 20, b = 180;
    localStorage.setItem('apex.segments', JSON.stringify([{ id: 'seg_f', origin: 'CANON1', synced: true, name: 'Straight run', lat0: lat[a], lon0: lon[a], lat1: lat[b], lon1: lon[b], length_m: (b - a) * 5,
      geom: JSON.stringify(Array.from({ length: 20 }, (_, k) => { const i = a + Math.round(k * (b - a) / 19); return [lat[i], lon[i]]; })) }]));
  });
  await page.goto(base + '/analysis.html?drive=f1');
  await page.waitForSelector('#dvFlyby:not([hidden])');
  const t = await page.textContent('#dvFlybyList');
  check(t === 'Straight <b>run</b>: @bob 812', 'only the same day, as text: ' + t);
  // this month's challenges (IDEAS S-11): a drive dated now makes the panel, a new road counted (f1 counts too in October 2026)
  await page.evaluate(async () => { const f = (await ApexRecording.all()).find((d) => d.id === 'f1'); await ApexRecording.store({ ...f, id: 'f2', name: 'Fresh road', date: new Date().toISOString() }); });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => !document.getElementById('challengePanel').hidden);   // inside the Log's summary row (closed until tapped)
  check(/challenge/.test(await page.textContent('#yearTitle')), 'the summary row counts the challenges: ' + await page.textContent('#yearTitle'));
  check(/Drive 5 roads you haven't driven before · [12] of 5/.test(await page.textContent('#challengeList')), 'a new road this month');
  check(/^Your week: \d+(\.\d)? mi in 1 drive · 1 new road/.test(await page.textContent('#weekSum')), 'your week: ' + await page.textContent('#weekSum'));
});

flow('feedback: Settings sends what you typed with the diagnostics, never a place (Worker stubbed, IDEAS L-05)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  let sent = null;
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/feedback') { sent = JSON.parse(route.request().postData()); return route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":1}' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(u.pathname === '/api/me' ? { signed_in: false } : []) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexFeedback && document.querySelector('#feedbackBox textarea'));
  await page.click('.tab[data-view="garage"]');
  await page.click('#feedbackBox button:has-text("An idea")');
  await page.fill('#feedbackBox textarea', 'A night theme please');
  await page.click('#feedbackBox button:has-text("Send")');
  await page.waitForFunction(() => /Thanks/.test(document.getElementById('toast').textContent));
  check(sent && sent.kind === 'idea' && sent.message === 'A night theme please' && sent.app === 'web' && !sent.reply, 'sent: ' + JSON.stringify(sent));
  check(sent.diag && sent.diag.screen && !('lat' in sent.diag) && !('lon' in sent.diag), 'diagnostics without a place: ' + JSON.stringify(sent.diag));
  check(await page.isHidden('#feedbackBox label:has-text("reply")'), 'no reply option signed out');
});

flow('landscape mount: the map takes the left, the instruments a column on the right, a sheet leaves a tab rail (IDEAS U-16)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  const box = (sel) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const stage = await box('.stage'), bin = await box('#binnacle'), notes = await box('#notes');
  check(stage.w > 0.5 * 844 && stage.h > 250, 'the map is big: ' + JSON.stringify(stage));
  check(bin.x >= stage.x + stage.w - 1 && bin.y < 120, 'the instruments are a column on the right: ' + JSON.stringify(bin));
  check(notes.w > 800, 'the notes run across the top');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 844), 'no sideways scroll');
  await page.click('#modePlate');                                   // a replay is full-screen: its plate is the way back to the tabs (U-45)
  await page.click('.tab[data-view="garage"]');
  await page.waitForTimeout(400);
  const rail = await box('#binnacle');
  check(rail.w < 100, 'a sheet leaves a narrow tab rail: ' + JSON.stringify(rail));
}, { viewport: { width: 844, height: 390 } });

flow('friend profile: Friends → Profile shows what the friend shares, as text, and Back returns (Worker stubbed, IDEAS S-15)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/friends') return json([{ id: 'U1', handle: 'bob', name: 'Bob', status: 'accepted', incoming: 0 }]);
    if (u.pathname === '/api/friends/U1/profile') return json({ handle: 'bob', name: 'Bob <b>S</b>', friends_since: '2026-09-01', crews: ['Ridge Runners'], cars: [],
      stages: [{ stage: 'Esses', best: 812, days_month: 3, last: '2026-10-27' }], totals: { stages: 1, days_month: 3, best: 812 } });
    if (u.pathname === '/api/points') return json({ total: 0 });
    return json([]);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => document.querySelector('.tab[data-view="crew"]').click());
  await page.click('button:has-text("Friends · 1")');
  await page.click('.side-pop.open button:has-text("Profile")');
  await page.waitForSelector('.profile-view');
  const t = await page.textContent('.profile-view');
  check(t.includes('@bob') && t.includes('Bob <b>S</b> · friends since 2026-09-01') && t.includes('Esses · best 812 · 3 days this month') && t.includes('Ridge Runners'), 'the profile, as text: ' + t);
  await page.click('.profile-view button:has-text("Friends")');   // one back glyph and where it goes (REVIEW2.md)
  await page.waitForSelector('.side-pop.open button:has-text("Profile")');
});

flow('units: kilometres in Settings redraw the dial, the notes and the replay in metric (IDEAS U-22)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  check(await page.evaluate(() => ApexUnits.system()) === 'imperial', 'miles by default in en-US');
  await page.click('#modePlate');                                   // out of the full-screen replay to the tabs (U-45)
  await page.click('.tab[data-view="garage"]');
  await page.evaluate(() => { window.__samePage = true; });
  await page.click('[data-units="metric"]');                       // redrawn in place, no reload (the owner, 2026-10-29)
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__samePage === true), 'the page was not reloaded');
  check(await page.evaluate(() => localStorage.getItem('apex.units')) === 'metric', 'saved');
  check(await page.getAttribute('[data-units="metric"]', 'aria-checked') === 'true', 'the switch shows metric');
  check((await page.$$eval('[data-loop-mi]', (b) => b.map((x) => x.textContent))).join() === '25 km,50 km,75 km', 'the loop lengths in km');
  const dial = await page.textContent('#cluster');
  check(/KM\/H/.test(dial) && /Trip km/.test(dial) && /200/.test(dial), 'the dial in km/h, redrawn in place: ' + dial.slice(0, 200));
  await page.goto(base + '/index.html?drive=dry_ridge');            // the replay again: the setting is kept
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForTimeout(1500);
  const notes = await page.textContent('#notes');
  check(/\d\s*(M|KM)/.test(notes) && !/\d\s*(FT|MI)/.test(notes), 'note distances in metres: ' + notes);
  check(/ km$/.test(await page.getAttribute('#scrubber', 'aria-valuetext')), 'the replay position in km');
});

flow('the Log opens over the map and its tabs come back without loading the map again; switches read on and off (the owner, 2026-10-29)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && window.apexDebug);
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 });
  await page.evaluate(() => { window.__samePage = true; });
  await page.click('.tab[data-view="log"]');
  await page.waitForSelector('#logFrame:not([hidden])');
  const log = page.frameLocator('#logFrame');
  await log.locator('nav.tabbar a:has-text("Garage")').waitFor();
  check(/\/index\.html$/.test(page.url()), 'the map page stays: ' + page.url());
  // the frame gets the map page's safe areas (env() is zero inside a frame)
  check(await page.waitForFunction(() => /px$/.test(document.getElementById('logFrame').contentDocument.documentElement.style.getPropertyValue('--sa-bottom')), null, { timeout: 5000 }).then(() => true, () => false), 'insets handed to the Log');
  await log.locator('nav.tabbar a:has-text("Garage")').click();
  await page.waitForSelector('#logFrame', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#sheet.open[data-view="garage"]'));
  check(await page.evaluate(() => window.__samePage === true), 'the map page was never reloaded');
  check(await page.textContent('#sheetTitle') === 'Garage', 'the Garage tab opened');
  // back to the Log: the same frame, shown again as it was (not loaded again)
  await page.evaluate(() => { document.getElementById('logFrame').contentWindow.__kept = true; });
  await page.click('.tab[data-view="log"]');
  await page.waitForSelector('#logFrame:not([hidden])');
  check(await page.evaluate(() => document.getElementById('logFrame').contentWindow.__kept === true), 'the Log was kept, not loaded again');
  await log.locator('nav.tabbar a:has-text("Crew")').click();
  await page.waitForFunction(() => document.querySelector('#sheet.open[data-view="crew"]'));
  check(await page.evaluate(() => window.__samePage === true), 'Crew from the Log: still no reload');
  // a switch: off is hollow with a dim border, on is filled with ink (two cues besides the thumb's position)
  const sw = await page.evaluate(() => {
    const b = document.querySelector('.sw[data-toggle]'); if (!b) return null;
    const i = b.querySelector('i'), read = () => { const c = getComputedStyle(i); return { bg: c.backgroundColor, border: c.borderTopColor, mark: getComputedStyle(i, '::before').width }; };
    const was = b.classList.contains('on'); b.classList.remove('on'); const off = read(); b.classList.add('on'); const on = read(); b.classList.toggle('on', was);
    return { off, on };
  });
  check(sw && sw.off.bg !== sw.on.bg && sw.off.border !== sw.on.border && sw.off.mark !== sw.on.mark, 'on and off differ in fill, border and mark: ' + JSON.stringify(sw));
});

flow('Siri links: report and end act only during a drive, and say so otherwise (IDEAS V-07)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'report' } }));
  await page.waitForFunction(() => /Start a drive to report a hazard/.test(document.getElementById('toast').textContent));
  check(!(await page.isVisible('#hzOverlay.show')), 'no report sheet outside a drive');
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'end' } }));
  await page.waitForFunction(() => /No drive to end/.test(document.getElementById('toast').textContent));
  // next stage / skip a stage (no fun route with stages here): it says so, nothing else happens
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'nextstage' } }));
  await page.waitForFunction(() => /no stages|No route/i.test(document.getElementById('toast').textContent));
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'skipstage' } }));
  await page.waitForFunction(() => /Skip a stage during a drive/.test(document.getElementById('toast').textContent));
  // during a drive the report sheet opens
  await page.evaluate((f) => window.apex.live(f), frame(1));
  await page.waitForFunction(() => window.apexDebug.state.mode === 'live');
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'report' } }));
  await page.waitForSelector('#hzOverlay.show');
});

flow('3D terrain: the switch raises the map into relief and tilts it; off by default (IDEAS U-14)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getSource('apex-dem'), null, { timeout: 15000 });
  check(await page.evaluate(() => !window.apexDebug.map.getTerrain()), 'flat by default');
  await page.evaluate(() => document.querySelector('[data-toggle="terrain"]').click());
  await page.waitForFunction(() => { const m = window.apexDebug.map; return m.getTerrain() && m.getTerrain().source === 'apex-dem' && m.getPitch() > 40; }, null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-toggle="terrain"]').click());
  await page.waitForFunction(() => !window.apexDebug.map.getTerrain());
});

flow('measured roads: the switch draws the roads members have measured around the view (IDEAS Q-14)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  const boxes = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/coverage') {
      boxes.push(u.searchParams.get('bbox'));
      const [s, w, n, e] = u.searchParams.get('bbox').split(',').map(Number), lat = (s + n) / 2, lon = (w + e) / 2;
      return json({ ways: [{ way: 1, line: [[lat, lon], [lat + 0.01, lon]], conf: [2, 3] }] });
    }
    return json({ error: 'not_found' }, 404);
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getLayer('apex-coverage'), null, { timeout: 15000 });
  await page.evaluate(() => window.apexDebug.map.jumpTo({ center: [-83.5, 35.5], zoom: 12 }));
  check(boxes.length === 0, 'nothing asked while the switch is off');
  await page.evaluate(() => document.querySelector('[data-toggle="coverage"]').click());
  await page.waitForFunction(() => window.apexDebug.map.getSource('apex-coverage-src')._data && (window.apexDebug.map.getSource('apex-coverage-src')._data.features || []).length === 1, null, { timeout: 8000 });
  const [s, w, n, e] = boxes[0].split(',').map(Number);
  check(n - s <= 0.5 && e - w <= 0.5 && s < 35.5 && n > 35.5, 'a small box around the view: ' + boxes[0]);
  check(await page.evaluate(() => window.apexDebug.map.getLayoutProperty('apex-coverage', 'visibility')) === 'visible', 'drawn');
  await page.evaluate(() => document.querySelector('[data-toggle="coverage"]').click());
  check(await page.evaluate(() => window.apexDebug.map.getLayoutProperty('apex-coverage', 'visibility')) === 'none', 'hidden when off');
});

flow('road page: About a road shows its archetype, axes and how sure it is (IDEAS Q-13)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.openRoadPage);
  await page.evaluate(() => {   // a run of tight alternating hairpins
    const lat = [], lon = []; let x = 0, y = 0, h = Math.PI / 2;
    const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / 91190); } };
    step(20, 0); for (let k = 0; k < 8; k++) { step(10, (k % 2 ? 1 : -1) * Math.PI / 10); step(16, 0); } step(20, 0);
    window.apexDebug.openRoadPage({ lat, lon, name: 'Test Pass', km: lat.length * 5 / 1000, junctionsPerKm: 0.2 });
  });
  await page.waitForSelector('aside.side-pop.open[aria-label="About this road"]');
  const text = await page.textContent('aside.side-pop.open');
  check(/Test Pass/.test(text) && /Switchbacks/.test(text), 'name and archetype: ' + text.slice(0, 200));
  check(/TECH/.test(text) && /FLOW/.test(text) && /L0 · From the map only/.test(text), 'axes and confidence');
  check(/SURF--/.test(text.replace(/\s+/g, '')), 'no member data: SURF unknown');
  await page.click('aside.side-pop.open button:has-text("Close")');
  check(!(await page.isVisible('aside.side-pop.open[aria-label="About this road"]')), 'closes');
});

flow('track day: on a mapped raceway, Start/finish here times laps (IDEAS D-15)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage() {} } } };   // the iOS shell's bridge, faked: frames come from window.apex.live
    window.__said = []; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function' && window.ApexStages);
  await page.evaluate(() => {
    const R = 1000 / (2 * Math.PI), c = Math.cos(35 * Math.PI / 180);
    window.__pos = (a) => ({ lat: 35 + R * Math.sin(a) / 110540, lon: -83 + R * Math.cos(a) / (111320 * c) });
    const ring = Array.from({ length: 73 }, (_, i) => { const p = window.__pos(i / 72 * 2 * Math.PI); return [p.lon, p.lat]; });
    ApexStages.transportationAt = async () => [{ props: { class: 'raceway' }, lines: [ring] }];
  });
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForFunction(() => document.getElementById('permSheet') && (document.getElementById('permSheet').classList.contains('show') || window.apexDebug.state.mode === 'live'), null, { timeout: 5000 }).catch(() => {});
  if (await page.isVisible('#permSheet.show')) await page.evaluate(() => document.getElementById('permGo').click());
  const R = 1000 / (2 * Math.PI);
  const feed = (a, t, course) => page.evaluate(([a, t, course]) => window.apex.live({ ...window.__pos(a), t, accuracy_m: 4, speed_mps: 25, course_deg: course, has_fix: true, calibration: 'locked' }), [a, t, course]);
  let t = 1e6, a = -Math.PI / 2 - 0.5;
  for (let i = 0; i < 3; i++) { a += 25 / R; t += 1000; await feed(a, t, 90); }
  await page.waitForFunction(() => !document.getElementById('lapSetBtn').hidden, null, { timeout: 5000 });
  // drive round to just short of the line, tap Start/finish when the car is at it, then two laps at 25 m/s (40 s each)
  while (a < -Math.PI / 2 - 0.02) { a += 25 / R; t += 1000; await feed(a, t, 90); }
  await page.evaluate(() => document.getElementById('lapSetBtn').click());
  for (let k = 0; k < 2 * 40 + 6; k++) { a += 25 / R; t += 1000; await feed(a, t, (a * 180 / Math.PI + 90) % 360); }
  await page.waitForFunction(() => /best/.test(document.getElementById('lapInfo').textContent), null, { timeout: 5000 });
  const info = await page.textContent('#lapInfo');
  check(/last 0:(39|40)\.\d\d/.test(info) && /best 0:(39|40)\.\d\d/.test(info), 'laps timed: ' + info);
});

flow('no colour swaps or Octane: an accent picked before is cleared, Settings sells nothing (REVIEW.md roadmap 8)', async (page, base) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.accent', 'rally_blue'); } catch (_) {} });
  await page.goto(base + '/index.html?view=setup');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map, null, { timeout: 30000 });
  check(await page.evaluate(() => localStorage.getItem('apex.accent')) === null, 'the old accent is cleared');
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--route').trim().toLowerCase()) !== '#1f4fa8', 'the route line is the theme\'s own');
  check(!/Octane/.test(await page.evaluate(() => document.body.innerText)), 'no Octane anywhere on screen');
  check(!(await page.$('#lookRow')), 'no colour-swap Look section');
});

flow('theme contract on the page: the hazard plate, the speed, the call and the binnacle floors, day and night (REVIEW.md 4.3)', async (page, base) => {
  for (const night of [false, true]) {
    await page.addInitScript((n) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full', nightMode: n ? 'on' : 'off' })); } catch (_) {} }, night);
    await page.goto(base + '/index.html?drive=dry_ridge&play=1');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
    await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * 0.45; });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const p = document.getElementById('hzPlate'); p.hidden = false; document.getElementById('hzPlateTitle').textContent = 'Gravel';
      const cs = getComputedStyle(p), pr = p.getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
      const speed = document.querySelector('.dial-digital').getBoundingClientRect().height;
      const call = document.querySelector('.rb-box.now .rb-call span');
      // the Limit sign's SPEED LIMIT legend is part of the drawn sign (REVIEW.md 4.3.5); its number is what you read
      const small = [...document.querySelectorAll('#cluster *')].filter((n) => !(n instanceof SVGElement) && !n.closest('.ro-limit') && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
        .map((n) => [n.className, parseFloat(getComputedStyle(n).fontSize)]).filter(([, px]) => px < 13);
      const bank = document.querySelector('.dial-digital.small'), bankPx = bank ? bank.getBoundingClientRect().height : 99;
      return { bg: cs.backgroundColor, edge: cs.borderTopColor, ink: cs.color, top: Math.round(pr.top - st.top), left: Math.round(pr.left - st.left),
               speed, call: call ? parseFloat(getComputedStyle(call).fontSize) : 0, small, bankPx, limit: (() => { const l = document.querySelector('.ro-limit'); if (!l) return null; const b = l.getBoundingClientRect(), c = getComputedStyle(l);
                 return { w: Math.round(b.width), h: Math.round(b.height), bg: c.backgroundColor, unknown: l.classList.contains('unknown') }; })() };
    });
    const m = night ? 'night' : 'day';
    check(r.bg === 'rgb(17, 17, 17)' && r.edge === 'rgb(255, 122, 26)' && r.ink === 'rgb(255, 255, 255)', `${m}: the hazard plate's colours ` + JSON.stringify(r));
    check(r.top === 14 && r.left === 10, `${m}: the plate sits top-left, 14 px under the strip: ${r.top},${r.left}`);
    check(r.speed >= 40, `${m}: speed numeral ${r.speed} px`);
    check(r.call >= 21, `${m}: the call ${r.call} px`);
    check(!r.small.length && r.bankPx >= 13, `${m}: nothing on the binnacle under 13 px: ` + JSON.stringify(r.small) + ' bank ' + r.bankPx);
    check(r.limit && r.limit.w === 44 && r.limit.h === 52 && (r.limit.unknown || r.limit.bg === 'rgb(255, 255, 255)'), `${m}: the Limit sign is the white sign: ` + JSON.stringify(r.limit));
    // night is a mode (REVIEW2.md U-36): a 46 px numeral, Limit and Sight on one row, the trip behind its Trip key
    const nm = await page.evaluate(() => { const d = document.querySelector('.dial-speed .dial-digital'), vis = (q) => { const e = document.querySelector(q); return !!e && e.getClientRects().length > 0; };
      const l = document.querySelector('.ro-limit').getBoundingClientRect(), g = document.querySelector('.ro-sight').getBoundingClientRect();
      return { px: Math.round(parseFloat(getComputedStyle(d).fontSize) * d.getScreenCTM().a), oneRow: Math.abs(l.top - g.top) < 12, odo: vis('#cluster .odo'), key: vis('#cluster .trip-peek') }; });
    if (night) {
      check(nm.px >= 46 && nm.oneRow && !nm.odo && nm.key, 'night: a 46 px numeral, Limit and Sight in a row, the trip behind its key: ' + JSON.stringify(nm));
      await page.click('#cluster .trip-peek');
      check(await page.evaluate(() => document.querySelector('#cluster .odo').getClientRects().length > 0), 'night: the Trip key shows the trip');
    } else check(nm.odo && !nm.key, 'day: the trip shows and there is no Trip key: ' + JSON.stringify(nm));
  }
  // the Pro themes, tried on the demo replay from the picker: the same floors and the same hazard plate
  for (const id of ['tapedeck', 'billet']) {
    await page.evaluate((t) => window.apexDebug.tryTheme(t), id);
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, id);
    await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.events.length);
    await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * 0.45; });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const p = document.getElementById('hzPlate'); p.hidden = false;
      const cs = getComputedStyle(p), speed = document.querySelector('.dial-digital, .vfd-seg');
      const call = document.querySelector('.rb-box.now .rb-call span');
      // the Limit sign's SPEED LIMIT legend is part of the drawn sign (REVIEW.md 4.3.5); its number is what you read
      const small = [...document.querySelectorAll('#cluster *')].filter((n) => !(n instanceof SVGElement) && !n.closest('.ro-limit') && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
        .map((n) => [n.className, parseFloat(getComputedStyle(n).fontSize)]).filter(([, px]) => px < 13);
      const seg = document.querySelector('.vfd-seg'), segH = seg ? seg.getBoundingClientRect().height * 100 / 200 : null;   // the digits are 100 of the 200 units
      return { bg: cs.backgroundColor, edge: cs.borderTopColor, speed: segH != null ? segH : speed.getBoundingClientRect().height,
               call: call ? parseFloat(getComputedStyle(call).fontSize) : 0, small, limit: (() => { const l = document.querySelector('.ro-limit'); if (!l) return null; const b = l.getBoundingClientRect(), c = getComputedStyle(l);
                 return { w: Math.round(b.width), h: Math.round(b.height), bg: c.backgroundColor, unknown: l.classList.contains('unknown') }; })() };
    });
    check(r.bg === 'rgb(17, 17, 17)' && r.edge === 'rgb(255, 122, 26)', `${id}: the same hazard plate ` + JSON.stringify(r));
    check(r.speed >= 40 && r.call >= 21 && !r.small.length, `${id}: speed ${r.speed}, call ${r.call}, small ` + JSON.stringify(r.small));
    check(r.limit && r.limit.w === 44 && r.limit.h === 52 && (r.limit.unknown || r.limit.bg === 'rgb(255, 255, 255)'), `${id}: the same Limit sign: ` + JSON.stringify(r.limit));
    const sc = await page.evaluate(() => { const g = document.querySelector('#cluster .g-score'), b = g && g.getBoundingClientRect(), m = document.querySelector('#cluster .dial-g').getBoundingClientRect();
      return g && { text: g.textContent, inside: b.bottom <= m.bottom + 1 && b.top >= m.top - 1 }; });
    check(sc && /^--SCORE$/.test(sc.text) && sc.inside, `${id}: the Score sits under the meter, -- on a replay: ` + JSON.stringify(sc));   // REVIEW.md 4.3
    if (id === 'tapedeck') {                                        // REVIEW2.md U-38: Kit on 16 x 14, and his line wraps to two, never cut
      // 80 px, except upright on a phone, where the instruments give the map its room: 40 px (the owner, 2026-10-30)
      const kit = await page.evaluate(() => { const k = document.querySelector('#cluster .kit'), b = document.querySelector('#cluster .kit-says b');
        return { w: Math.round(k.getBoundingClientRect().width), phone: innerWidth <= 480, dots: k.querySelectorAll('circle').length, clamp: getComputedStyle(b).webkitLineClamp, ellipsis: getComputedStyle(b).textOverflow }; });
      check(kit.w === (kit.phone ? 40 : 80) && kit.dots === 16 * 14 && kit.clamp === '2' && kit.ellipsis !== 'ellipsis', 'tapedeck: Kit at his size and a two-line call: ' + JSON.stringify(kit));
    }
  }
});

flow('flyover video: Video records the replay with the note on it and hands over a file (IDEAS D-10)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.map && window.apexDebug.map.loaded(), null, { timeout: 20000 });
  check(!(await page.evaluate(() => document.getElementById('videoBtn').hidden)), 'Video is offered where the browser can record');
  await page.evaluate(() => { window.__saved = null; ApexSaveFile.saveFile = async (blob, name, type) => { window.__saved = { size: blob.size, name, type }; return 'saved'; }; });
  await page.evaluate(() => document.getElementById('videoBtn').click());
  await page.waitForFunction(() => window.apexDebug.state.playing && document.getElementById('videoBtn').textContent === 'Stop');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.getElementById('videoBtn').click());
  await page.waitForFunction(() => window.__saved, null, { timeout: 8000 });
  const saved = await page.evaluate(() => window.__saved);
  check(saved.size > 1000 && /^Dry_Ridge.*\.(webm|mp4)$/.test(saved.name) && /^video\//.test(saved.type), 'a video file: ' + JSON.stringify(saved));
  check(!(await page.evaluate(() => window.apexDebug.state.playing)), 'the replay stops with it');
});

flow('offline area: Save the map here keeps the map, labels and terrain; with no signal the map still opens (IDEAS F-02)', async (page, base) => {
  let online = true, tiles = 0;
  const style = { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }, { id: 'names', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Regular'] } }] };
  await page.route('https://tiles.openfreemap.org/**', (route) => {
    if (!online) return route.abort();
    const u = route.request().url();
    if (u.includes('/styles/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(style) });
    if (u.endsWith('/planet')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    tiles++;
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  await page.route('https://s3.amazonaws.com/**', (route) => (online ? route.fulfill({ contentType: 'image/png', body: Buffer.alloc(8) }) : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.loaded(), null, { timeout: 15000 });
  await page.evaluate(() => { window.apexDebug.map.jumpTo({ center: [-83.5, 35.6], zoom: 11 }); document.getElementById('myAreaBtn').click(); });
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('apex.offlineAreas') || '[]')).length === 1, null, { timeout: 60000 });
  const area = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.offlineAreas'))[0]);
  check(area.tiles > 500 && area.tiles <= 2500 && Math.abs(area.lat - 35.6) < 0.01, 'an area of tiles round the map: ' + JSON.stringify(area));
  check(tiles > 400, 'the tiles were fetched: ' + tiles);
  await page.waitForFunction(() => /1 map area/.test(document.getElementById('myOfflineNote').textContent), null, { timeout: 5000 });
  // no signal: the map opens from the saved style and tiles
  online = false;
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getStyle() && window.apexDebug.map.getLayer('names'), null, { timeout: 15000 });
  check(await page.evaluate(() => !!window.apexDebug.map.getSource('openmaptiles')), 'the saved style and its source loaded offline');
}, { viewport: { width: 1280, height: 900 } });

flow('desk: on a big screen Where to? is a column on the left and sheets a panel on the right, the map in view (IDEAS A-05)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?view=route');
  await page.waitForSelector('#planPanel.open');
  const box = (sel) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }, sel);
  // the column grows open over 0.25 s: measure once it has (CI caught it mid-way at 565 px)
  await page.waitForFunction(() => document.getElementById('planPanel').getBoundingClientRect().height > 600, null, { timeout: 3000 }).catch(() => {});
  const plan = await box('#planPanel');
  check(plan.w === 440 && plan.x < 40 && plan.h > 600, 'Where to? is a left column: ' + JSON.stringify(plan));
  await page.click('.tab[data-view="garage"]');
  await page.waitForTimeout(400);
  const sheet = await box('.sheet.open');
  check(sheet.w === 480 && sheet.x > 900, 'Settings is a right panel: ' + JSON.stringify(sheet));
}, { viewport: { width: 1440, height: 900 } });

flow('recce: keep a drive\'s notes, change a call, and the cockpit reads yours on that road (IDEAS V-09)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await page.evaluate(async () => {
    const lat = [], lon = [];
    for (let i = 0; i < 300; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9); }
    await ApexRecording.store({ id: 'rc1', name: 'Recce road', date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, elev: null, hz: 1, source: 'web-gps',
      events: [{ type: 'corner', code: 'L4', call: 'Left 4', index: 100, dist_m: 500, start_m: 480, end_m: 520, radius_m: 80, apex_mph: 30, dir: 'L', severity: 4 }] });
  });
  await page.goto(base + '/analysis.html?drive=rc1');
  await page.waitForSelector('#dvRecce:not([hidden]) button:has-text("Keep these notes as mine")');
  await page.click('#dvRecceActs button:has-text("Keep these notes as mine")');
  await page.waitForSelector('#dvRecceList input');
  await page.fill('#dvRecceList input', 'Left 3 tightens, care');
  await page.dispatchEvent('#dvRecceList input', 'change');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('dvRecceNote').textContent));
  // the cockpit, replaying that drive, reads your call
  await page.goto(base + '/index.html?drive=rc1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.id === 'rc1', null, { timeout: 15000 });
  const ev = await page.evaluate(() => window.apexDebug.track.events.find((e) => e.type === 'corner'));
  check(ev && ev.call === 'Left 3 tightens, care' && ev.recce && ev.mapCall === 'Left 4', 'your call read: ' + JSON.stringify(ev && { call: ev.call, mapCall: ev.mapCall }));
  // shown as you wrote it in either words mode (review fix: plain words rebuilt it from the map's corner)
  await page.evaluate(() => { window.apexDebug.state.noteWords = 'plain'; window.apexDebug.state.notesMode = 'full'; });
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForFunction(() => /Left 3 tightens, care/.test(document.getElementById('notes').textContent), null, { timeout: 8000 });
});

flow('spot photo: a camera photo with GPS in its EXIF is kept without it, shows on the spot and goes with Erase (IDEAS S-18)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexSpotPhotos && window.apexDebug);
  // a 2000 x 1500 JPEG with an Exif APP1 segment spliced in after SOI, as a phone camera writes it
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 2000, 1500); g.fillStyle = '#fff'; g.fillRect(100, 100, 400, 300);
    const raw = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const payload = [...'Exif\0\0MM\0*GPS 35.96N 83.92W'].map((ch) => ch.charCodeAt(0));
    const app1 = [0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
    const out = [...raw.subarray(0, 2), ...app1, ...raw.subarray(2)];
    if (window.ApexSpotPhotos.exifSegments(new Uint8Array(out))[0] !== 'exif') throw new Error('test photo lacks EXIF');
    return out;
  });
  await page.evaluate(() => document.getElementById('hlOpenBtn').click());
  await page.waitForSelector('#hlOverlay.show', { timeout: 10000 });
  await page.setInputFiles('#hlPhoto', { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => /Photo ready/.test(document.getElementById('hlPhotoNote').textContent), null, { timeout: 10000 });
  await page.fill('#hlName', 'Red barn');
  await page.evaluate(() => document.getElementById('hlAddBtn').click());
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('apex.highlights') || '[]').some((h) => h.name === 'Red barn' && h.photo));
  const kept = await page.evaluate(async () => {
    const h = JSON.parse(localStorage.getItem('apex.highlights')).find((x) => x.name === 'Red barn');
    const blob = await window.ApexSpotPhotos.get(h.id), b = new Uint8Array(await blob.arrayBuffer());
    const bmp = await createImageBitmap(blob);
    return { segs: window.ApexSpotPhotos.exifSegments(b), gps: new TextDecoder('latin1').decode(b).includes('GPS 35.96'), w: bmp.width, h: bmp.height };
  });
  check(kept.segs.length === 0 && !kept.gps, `kept photo still carries metadata: ${JSON.stringify(kept)}`);
  check(kept.w === 1600 && kept.h === 1200, `kept photo scaled to 1600 px: ${kept.w}x${kept.h}`);
  await page.waitForSelector('#hlList .spot-thumb img', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.getElementById('myEraseBtn').click());
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('.confirm-sheet .cs-yes:has-text("Erase everything")')]);   // Erase reloads the page
  await page.waitForFunction(() => window.ApexSpotPhotos);
  check(await page.evaluate(() => window.ApexSpotPhotos.count()) === 0, 'Erase everything clears spot photos');
}, { geolocation: { latitude: 35.96, longitude: -83.92 }, permissions: ['geolocation'] });

flow('dashcam overlay: a video from the drive gets its speed, g and calls drawn on and comes out as a new video (IDEAS D-11)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await page.evaluate(async () => {
    const lat = [], lon = [];
    for (let i = 0; i < 300; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9); }
    await ApexRecording.store({ id: 'dc1', name: 'Dashcam road', date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => -0.1), lat_g: lat.map((_, i) => Math.sin(i / 10) * 0.3), g_known: null, elev: null, hz: 1, source: 'web-gps',
      events: [{ type: 'corner', code: 'L4', call: 'Left 4', index: 100, dist_m: 500, start_m: 480, end_m: 520, radius_m: 80, apex_mph: 30, dir: 'L', severity: 4 }] });
  });
  await page.goto(base + '/analysis.html?drive=dc1');
  await page.waitForSelector('#dvDashcam input[type=file]', { state: 'attached' });   // behind the Pick a video key
  // a 2 s video made right here, put in the file box as if picked
  await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }), g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' }), parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stop = new Promise((ok) => { rec.onstop = ok; });
    rec.start(); let f = 0; const t = setInterval(() => { g.fillStyle = `hsl(${f++ * 12},60%,50%)`; g.fillRect(0, 0, 320, 180); }, 66);
    await new Promise((r) => setTimeout(r, 2000)); clearInterval(t); rec.stop(); await stop;
    const file = new File(parts, 'dash.webm', { type: 'video/webm' }), dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#dvDashcam input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    window.__saved = null; ApexSaveFile.saveFile = async (blob, name, type) => { window.__saved = { size: blob.size, name, type }; return 'saved'; };
  });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('#dvDashcam button')].find((x) => /Make the video/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('#dvDashcam button')].find((x) => /Make the video/.test(x.textContent)).click());
  await page.waitForFunction(() => window.__saved, null, { timeout: 20000 });
  const saved = await page.evaluate(() => window.__saved);
  check(saved.size > 500 && /^Dashcam_road-dashcam-.*\.(webm|mp4)$/.test(saved.name), 'a new video: ' + JSON.stringify(saved));
});

flow('the Log page opens', async (page, base) => {
  await page.goto(base + '/analysis.html');
  await page.waitForLoadState('load');
  check((await page.title()).length > 0, 'analysis.html has a title');
});

flow('Your records: unknown dates and unscored drives never make a "new best", and the record fits a phone', async (page, base) => {
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded());
  await page.waitForTimeout(100);                                   // the library's own render (deferred) has run: it cannot overwrite the seed
  const r = await page.evaluate(() => {
    const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const c = (s, b) => ({ pace: 0.8, smoothness: s, braking: b, consistency: 0.8 });
    const d = (id, name, date, score, comp, extra = {}) => ({ id, name, date, ds: { score, components: comp }, ...extra });
    // road A: 880 then 910 dated, an unscored drive after both (the latest), and an undated import scoring 930
    const seed = [d('a1', 'Mulholland Highway', '2020-08-01T09:00:00', 880, c(0.5, 0.5)), d('a2', 'Mulholland Highway', '2020-08-02T09:00:00', 910, c(0.5, 0.5)),
      d('a3', 'Mulholland Highway', '2020-08-03T09:00:00', null, null), d('a4', 'Mulholland Highway', '2026-01-01T00:00:00.000Z', 930, c(0.5, 0.5), { date_known: false }),
      // road B: the dated latest is the best
      d('b1', 'Tail of the Dragon', '2020-07-01T09:00:00', 700, c(0.5, 0.5)), d('b2', 'Tail of the Dragon', '2020-09-01T09:00:00', 750, c(0.5, 0.5)),
      // this month: smoothness measured on two, braking on one only
      d('m1', 'Town loop', `${ym}-01T09:00:00`, 600, c(0.6, NaN)), d('m2', 'Back road', `${ym}-02T09:00:00`, 650, c(0.7, 0.9))];
    window.apexLogDebug.records(seed);
    const rows = [...document.querySelectorAll('#recordsTable tr')].map((tr) => [tr.dataset.drive, tr.textContent]);
    const t = document.getElementById('recordsTable').closest('.scroll');
    return { rows, overflow: t.scrollWidth - t.clientWidth };
  });
  const text = r.rows.map(([id, t]) => `${id}: ${t}`).join('\n');
  check(r.rows.length === 3, `two roads and one month record (got\n${text})`);
  check(r.rows[0][0] === 'b2' && /a new best/.test(r.rows[0][1]), `the dated latest best is new (got\n${text})`);
  check(r.rows[1][0] === 'a4' && !/new best/.test(r.rows[1][1]) && /date unknown/.test(r.rows[1][1]) && /of 3 scored drives/.test(r.rows[1][1]), `an undated import is no "latest" (got\n${text})`);
  check(r.rows[2][0] === 'm2' && /Smoothest drive this month, of 2/.test(r.rows[2][1]), `braking measured once is no record (got\n${text})`);
  check(r.overflow <= 1, `the records table fits a 390 px screen (overflows by ${r.overflow} px)`);
});

// REVIEW.md 1.2, screen by screen: each row's "what it should be", checked on the running app. Rows with a flow of
// their own are named there (Driving: the theme contract; Drive ended; Crew member: crew page; Hazard plate colours).
flow('REVIEW.md 1.2 screen by screen: first run, the map, planning, the route, driving, the hazard report and replay', async (page, base) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-84.10, 35.40] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(JSON.parse(route.request().postData()).locations)) }));
  await page.route(base + '/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed_out"}' }));
  // Onboarding 1: the notes strip calling corners, one button (Start); Onboarding 2 and 3 are gone
  await page.goto(base + '/index.html');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  const ob = await page.evaluate(() => { const o = document.getElementById('onboard');
    return { steps: [...o.querySelectorAll('[data-step]')].map((s) => s.dataset.step), keys: [...o.querySelectorAll('button')].filter((b) => b.offsetParent && !b.classList.contains('linkbtn')).map((b) => b.textContent.trim()),
      notes: document.getElementById('obNotes').children.length, voices: /Marguerite|Phone voice|My Voice/.test(o.innerText), signIn: /Sign in/.test(o.innerText) }; });
  check(JSON.stringify(ob.steps) === '["1"]' && JSON.stringify(ob.keys) === '["Start"]' && ob.notes >= 2 && !ob.voices && !ob.signIn, 'Onboarding: ' + JSON.stringify(ob));
  await page.click('#obNext');
  check(!(await page.isVisible('#onboard.show')) && !(await page.isVisible('#permSheet.show')), 'Start goes straight to the map: no voice step, no sign-in wall');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  // Map idle: four tabs, Layers and Recenter as keys, the deck with the search and the record key, one suggested loop
  const idle = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('#tabbar .tab')].map((t) => t.textContent), layers: document.getElementById('swTab').className,
    recenter: document.getElementById('recenterBtn').className, start: document.getElementById('startDrive').className, loop: document.getElementById('loopSuggest').innerText }));
  check(JSON.stringify(idle.tabs) === '["Map","Log","Crew","Garage"]', 'four tabs: ' + idle.tabs);
  check(/map-key/.test(idle.layers) && /map-key/.test(idle.recenter) && /btn-start/.test(idle.start), 'Layers and Recenter are keys, Start the record key: ' + JSON.stringify(idle));
  check(/^Loop from here · \d+ mi/.test(idle.loop) && /map only until driven/.test(idle.loop), 'one suggested loop: ' + idle.loop);
  await page.evaluate(() => apexDebug.map.getCanvasContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  const keys = await page.evaluate(() => { const a = document.getElementById('swTab').getBoundingClientRect(), b = document.getElementById('recenterBtn').getBoundingClientRect(); return { a: [a.left, a.right, a.width], b: [b.left, b.right, b.width], gap: b.top - a.bottom }; });
  check(JSON.stringify(keys.a) === JSON.stringify(keys.b) && keys.gap > 0 && keys.gap < 30, 'Recenter is the second key, under Layers: ' + JSON.stringify(keys));
  // Map menu: Layers are map things; the theme, units and the rest of Settings are not there (Notes and Voice stay, CALL_SHEET)
  const layers = await page.evaluate(() => document.getElementById('swPanel').innerText);
  check(/Friends/.test(layers) && /Cameras/.test(layers) && /Twisty roads/.test(layers) && /3D terrain/.test(layers) && !/Night|Theme|Units|Look/.test(layers), 'Layers: ' + layers);
  // Plan sheet: the loop dial (five detents), one Route style switch, and one "More" row, closed
  await page.click('#destInput');
  const plan = await page.evaluate(() => { const more = document.getElementById('planMore');
    return { detents: document.querySelectorAll('#loopDetents button').length, open: more.open, more: more.querySelector('summary').textContent,
      chips: [...document.getElementById('planBody').querySelectorAll('.chip')].filter((c) => c.offsetParent && !more.contains(c)).length }; });
  check(plan.detents === 5 && !plan.open && /^More: avoid/.test(plan.more) && plan.chips === 0, 'Plan sheet: ' + JSON.stringify(plan));
  // Route bar: no toast repeating it; Route card: three numbers, four dials with unknowns as --, Drive it and Preview, the rest text links
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50; }, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, bar: document.getElementById('routeBarName').textContent,
    stats: [...document.querySelectorAll('#routeCardStats > *')].length, dials: document.getElementById('routeCardBars').innerText.replace(/\s+/g, ' '),
    keys: [...document.querySelectorAll('#routeCard button')].filter((b) => /Drive it|Preview|Save|Share|GPX|Pin/.test(b.textContent)).map((b) => b.textContent.trim() + ':' + b.className) }));
  check(!card.toast.includes('Maryville'), 'the bar is the toast: ' + card.toast);
  check(card.stats === 3 && /TWIST/.test(card.dials) && /FLOW/.test(card.dials) && /-- SURFACE/.test(card.dials) && /-- CAMERAS/.test(card.dials), 'Route card: ' + JSON.stringify(card));
  check(card.keys[0] === 'Drive it:rec-key' && card.keys[1] === 'Preview:ink-btn' && card.keys.slice(2).every((k) => /:linkbtn$/.test(k)), 'Drive it and Preview, then text links: ' + card.keys);
  // Driving: no tab bar; Report and End; Limit, the Score under the g-ball
  await page.click('#planClear');
  await page.evaluate(async () => { for (let i = 0; i < 40; i++) { window.apex.live({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 100)); } });
  const drv = await page.evaluate(() => { const tb = document.getElementById('tabbar'); return { tabbar: !!(tb.offsetWidth || tb.offsetHeight), limit: !!document.querySelector('#cluster .ro-limit'), score: document.querySelector('#cluster .g-score').textContent, report: !!document.getElementById('hzReportBtn').offsetParent, end: !!document.getElementById('driveEnd').offsetParent }; });
  check(!drv.tabbar && drv.limit && /SCORE$/.test(drv.score) && drv.report && drv.end, 'Driving: ' + JSON.stringify(drv));
  // Hazard report: six plate-style keys, one tap, no confirm, Undo on the Report key for 3 s
  await page.click('#hzReportBtn');
  const hz = await page.evaluate(() => { const b = [...document.querySelectorAll('#hzKinds button')], cs = getComputedStyle(b[0]); return { n: b.length, bg: cs.backgroundColor, edge: cs.borderTopColor }; });
  check(hz.n === 6 && hz.bg === 'rgb(17, 17, 17)' && hz.edge === 'rgb(255, 122, 26)', 'Hazard report: ' + JSON.stringify(hz));
  await page.click('#hzKinds button');
  check(!(await page.isVisible('#hzOverlay.show')) && !(await page.$('.confirm-sheet')) && /^Undo /.test(await page.textContent('#hzReportBtn')), 'one tap, no confirm, Undo in the status line');
  await page.click('#hzReportBtn');
  check((await page.textContent('#hzReportBtn')) === 'Report', 'Undo takes it back');
  // Replay: crest and dip pins wear the hazard plate; the transport is shaped controls (a switch, detents, keys; U-45); no unlabelled "Fast & open"
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
  const rp = await page.evaluate(() => { const pin = document.createElement('div'); pin.className = 'pin crest'; document.body.append(pin); const cs = getComputedStyle(pin);
    return { pin: cs.backgroundColor + '/' + cs.borderTopColor, transport: [...document.querySelectorAll('#transport button')].map((b) => b.className || b.parentElement.className), fast: /Fast & open/.test(document.getElementById('cluster').innerText) }; });
  check(rp.pin === 'rgb(17, 17, 17)/rgb(255, 122, 26)' && rp.transport.every((c) => /\b(key|sw|detents)\b/.test(c)) && !rp.fast, 'Replay: ' + JSON.stringify(rp));
}, { geolocation: { latitude: 35.3626, longitude: -84.2866 }, permissions: ['geolocation'] });

flow('REVIEW.md 1.2 screen by screen: the Log, drive detail, Stages, Crew signed out and the Garage with its confirm sheet', async (page, base) => {
  await page.route('**/api/**', (route) => { const p = new URL(route.request().url()).pathname;
    if (p === '/api/me') return route.fulfill({ contentType: 'application/json', body: '{"signed_in":false}' });
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed_out"}' }); });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexRecording);
  await page.evaluate(async () => { const lat = [], lon = []; for (let i = 0; i < 400; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 20) * 0.0005); }
    await ApexRecording.store({ id: 'd1', name: 'Cherohala Skyway', date: new Date(Date.now() - 86400e3).toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map((_, i) => Math.sin(i / 20) * 3), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }); });
  // Log: one hero number, then quiet one-line rows (the year, challenges, your week), the drives as an index; Stages a segment, not a tab
  await page.goto(base + '/analysis.html?tab=log');
  await page.waitForSelector('.road-index tbody tr');
  const log = await page.evaluate(() => ({ hero: document.querySelector('.log-hero').innerText, seg: [...document.querySelectorAll('#tab-history .log-seg button, .log-seg button')].map((b) => b.textContent),
    panels: [...document.querySelectorAll('#tab-history .panel, main > section:not([hidden]) .panel')].filter((p) => !p.hidden && p.offsetParent).map((p) => p.id),
    quiet: [...document.querySelectorAll('details.quiet')].filter((d) => !d.hidden).map((d) => d.querySelector('summary').textContent.split(':')[0]),
    old: /Driver Score|Import \.csv/.test(document.body.innerText) }));
  check(/Latest Vetta Score/.test(log.hero) && log.seg.slice(0, 2).join() === 'Drives,Stages' && !log.old, 'Log: ' + JSON.stringify(log));
  check(JSON.stringify(log.panels) === '["historyPanel"]' && log.quiet.includes('Your week'), 'one bordered list, the rest quiet lines: ' + JSON.stringify(log));
  // Drive detail: the Score first, Replay the primary, tags as stamps; nothing wider than the phone
  await page.click('.road-index tbody tr');
  await page.waitForSelector('#dvReplay');
  const dv = await page.evaluate(() => { const ids = [...document.querySelectorAll('#tab-drive [id^="dv"]')].filter((e) => e.offsetParent).map((e) => e.id);
    const score = document.querySelector('.dv-score'), tags = document.getElementById('dvTags');
    return { first: score && score.compareDocumentPosition(document.getElementById('dvTagsPanel')) & Node.DOCUMENT_POSITION_FOLLOWING, replay: document.getElementById('dvReplay').className,
      tags: tags && tags.className, wide: [...document.querySelectorAll('#tab-drive *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className).slice(0, 5), ids: ids.length }; });
  check(dv.first && /solid/.test(dv.replay) && /stamps/.test(dv.tags) && !dv.wide.length, 'Drive detail: ' + JSON.stringify(dv));
  // Crew signed out: what you get in three glyphs, then sign-in
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-gets');
  const gets = await page.$$eval('.crew-gets span', (s) => s.map((x) => x.textContent + ':' + !!x.querySelector('svg')));
  check(JSON.stringify(gets) === '["Friends on the map:true","The board:true","Crew drives:true"]', 'Crew signed out: ' + gets);
  // Settings are the Garage: the theme picker, help folded under "How this works", no Octane, Erase is red text behind a confirm sheet
  await page.goto(base + '/index.html?view=garage');
  await page.waitForSelector('#myEraseBtn');
  const g = await page.evaluate(() => { const s = document.getElementById('sheet'), e = getComputedStyle(document.getElementById('myEraseBtn'));
    return { title: s.querySelector('h2').textContent, themes: document.querySelectorAll('#themeCards > *').length, how: s.querySelectorAll('details.how').length, octane: /Octane/.test(s.innerText), erase: e.color + '/' + e.textDecorationLine + '/' + e.borderTopStyle }; });
  check(g.title === 'Garage' && g.themes === 3 && g.how >= 2 && !g.octane && g.erase === 'rgb(200, 16, 46)/none/none', 'Garage: ' + JSON.stringify(g));
  let alerted = false; page.on('dialog', (d) => { alerted = true; d.dismiss(); });
  await page.evaluate(() => document.getElementById('myEraseBtn').click());
  await page.waitForSelector('.confirm-sheet [role="alertdialog"], .confirm-sheet .cs-box[role="alertdialog"]');
  const cs = await page.evaluate(() => ({ yes: document.querySelector('.confirm-sheet .cs-yes').textContent, color: getComputedStyle(document.querySelector('.confirm-sheet .cs-yes')).color, focus: document.activeElement.className }));
  check(!alerted && cs.yes === 'Erase everything' && cs.color === 'rgb(200, 16, 46)' && cs.focus === 'cs-no', 'the confirm sheet: ' + JSON.stringify(cs));
  await page.keyboard.press('Escape');
  check(!(await page.$('.confirm-sheet')) && (await page.evaluate(() => ApexRecording.all())).length === 1, 'Cancel (Escape) keeps everything');
});

// Safe areas (iPhone 15 Pro): nothing you read or tap sits under the Dynamic Island, the home indicator or the rounded
// display corners, upright or on its side. The map and panel backgrounds run edge to edge; text and controls don't.
// Content inside a scroller may pass under the home indicator while it scrolls, as on iOS.
const SAFE = { portrait: { w: 393, h: 852, R: 55, i: { top: 59, bottom: 34, left: 0, right: 0 } }, landscape: { w: 852, h: 393, R: 55, i: { top: 0, bottom: 21, left: 59, right: 59 } },
  'mini on its side': { w: 812, h: 375, R: 44, i: { top: 0, bottom: 21, left: 50, right: 50 } }, SE: { w: 375, h: 667, R: 0, i: { top: 20, bottom: 0, left: 0, right: 0 } } };
const unsafe = (page, d) => page.evaluate(({ d, R }) => {
    const out = [], keys = [], W = innerWidth, H = innerHeight, i = d.i;
    const inCornerOut = (x, y) => { const cx = x < R ? R : x > W - R ? W - R : null, cy = y < R ? R : y > H - R ? H - R : null; return cx !== null && cy !== null && Math.hypot(x - cx, y - cy) > R; };
    const vis = (e) => { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W; };
    const covered = (e, r) => { const x = Math.min(Math.max(r.left + r.width / 2, 0), W - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), H - 1); const t = document.elementFromPoint(x, y); return t && t !== e && !e.contains(t) && !t.contains(e); };
    const nodes = [...document.querySelectorAll('button, a, input, textarea, select, summary, [role="button"], [role="radio"], [role="tab"]')]
      .concat([...document.querySelectorAll('body *')].filter((n) => !(n instanceof SVGElement) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())));
    for (const e of new Set(nodes)) {
      if (!vis(e) || e.closest('.maplibregl-ctrl-attrib, .maplibregl-canvas-container, .maplibregl-marker, #map .maplibregl-popup, .sr-only')) continue;
      // an element inside a scroller is fine when the scroller itself sits in the safe area (it scrolls into view)
      const fixedAnc = (() => { for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; })();
      const se = document.scrollingElement, bodyScr = document.body.scrollHeight > document.body.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(document.body).overflowY);
      const docScrolled = !fixedAnc && (se.scrollHeight > innerHeight + 1 || bodyScr);
      const bb = getComputedStyle(document.body, '::before'), band = bb.position === 'fixed' ? parseFloat(bb.height) || 0 : 0;
      const inSheet = !!e.closest('.overlay, .confirm-sheet, .crash-sheet, .report-sheet, .photo-view');   // a sheet's keys are where they are, not "after a scroll"
      let sc = e.parentElement, scrolled = docScrolled && !inSheet; for (; sc && sc !== document.body; sc = sc.parentElement) { const cs = getComputedStyle(sc); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (sc.scrollHeight > sc.clientHeight + 1 || sc.scrollWidth > sc.clientWidth + 1)) { scrolled = !inSheet; break; } }
      const r = e.getBoundingClientRect();
      // clipped by an overflow ancestor (an ellipsis box): only the visible part counts
      let clipR = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) { const s = a.getBoundingClientRect(); clipR = { left: Math.max(clipR.left, s.left), right: Math.min(clipR.right, s.right), top: Math.max(clipR.top, s.top), bottom: Math.min(clipR.bottom, s.bottom) }; } }
      if (clipR.right <= clipR.left + 1 || clipR.bottom <= clipR.top + 1) continue;
      let box = clipR; if (scrolled) { const s = sc.getBoundingClientRect(); box = { left: Math.max(clipR.left, s.left), right: Math.min(clipR.right, s.right), top: Math.max(clipR.top, s.top), bottom: Math.min(clipR.bottom, s.bottom) }; if (box.right <= box.left || box.bottom <= box.top) continue; }
      if (covered(e, r)) continue;
      const why = [];
      if (box.top < i.top - 0.5 && !(docScrolled && band >= i.top - 0.5)) why.push('top ' + Math.round(box.top));   // under the status-bar band while scrolling
      if (box.bottom > H - i.bottom + 0.5 && !scrolled) why.push('bottom ' + Math.round(H - box.bottom));   // scrolled content may pass under the home indicator, as on iOS
      if (box.left < i.left - 0.5) why.push('left ' + Math.round(box.left));
      if (box.right > W - i.right + 0.5) why.push('right ' + Math.round(W - box.right));
      for (const [x, y] of (scrolled ? [[box.left, box.top], [box.right, box.top]] : [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]])) if (inCornerOut(x, y) && !(docScrolled && y < band) && !(scrolled && y > H - R)) { why.push('corner'); break; }
      // the gap test: text and keys at least 8 pt from a display edge the insets don't already cover (REVIEW2.md 1, U-23)
      const sideScroll = sc && sc !== document.body && sc.scrollWidth > sc.clientWidth + 1;   // a row that scrolls sideways may run to the edge
      if (!sideScroll && !fixedAnc && !e.closest('.tabbar, .map-key, .edge, .plates, .place-plate, .hz-plate, .toast')) {
        const g = 7.5;
        if (i.left < 1 && box.left < g && box.left > -1) why.push('gap left ' + Math.round(box.left));
        if (i.right < 1 && W - box.right < g && W - box.right > -1) why.push('gap right ' + Math.round(W - box.right));
      }
      const label = `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ')[0]} "${(e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 24)}"`;
      if (why.length) out.push(`${label} ${why.join(',')}`);
      const pinned = (() => { for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).position === 'sticky') return true; return false; })();
      if (e.matches('button, a, input, textarea, select, summary, [role="button"], [role="radio"], [role="tab"]')) keys.push({ e, box, label, pinned, scrolled });
    }
    // the overlap test: two keys you can see never sit on each other (a panel under a panel, a plate over a key)
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      const A = keys[a], B = keys[b];
      if (A.e.contains(B.e) || B.e.contains(A.e)) continue;
      if ((A.pinned && B.scrolled && !B.pinned) || (B.pinned && A.scrolled && !A.pinned)) continue;   // content scrolling under a pinned bar, as on iOS
      const w = Math.min(A.box.right, B.box.right) - Math.max(A.box.left, B.box.left), h = Math.min(A.box.bottom, B.box.bottom) - Math.max(A.box.top, B.box.top);
      if (w > 2 && h > 2) out.push(`${A.label} overlaps ${B.label}`);
    }
    return out;
  }, { d, R: d.R });
flow('safe areas: the Dynamic Island, the home indicator and the rounded corners clear every control, upright, on its side and on small phones', async (page, base) => {
  await page.route(base + '/api/**', (route) => { const p = new URL(route.request().url()).pathname;
    route.fulfill({ contentType: 'application/json', body: p === '/api/me' ? '{"signed_in":true,"member":true,"handle":"kit_r"}' : '[]' }); });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', localStorage.getItem('e2e.fresh') ? '' : '1'); } catch (_) {} });
  const cdp = await page.context().newCDPSession(page);
  const live = 'for (let i = 0; i < 40; i++) { window.apex.live({ lat: 35.36 + i * 1e-5, lon: -84.29, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: "locked", lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 40)); }';
  const endCard = 'const lat = [], lon = []; for (let i = 0; i < 300; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); } apexDebug.showEndCard({ id: "x", name: "Cherohala Skyway", date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15), lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: "web-gps", corners: [] }, Date.now() - 1800e3);';
  const screens = [
    ['onboarding', '/index.html', null, true],
    ['map idle', '/index.html', null],
    ['Layers open', '/index.html', 'document.getElementById("swTab").click()'],
    ['plan sheet, More open', '/index.html', 'document.getElementById("destInput").focus(); document.getElementById("planMore").open = true;'],
    ['driving', '/index.html', live],
    ['hazard report', '/index.html', live + ' document.getElementById("hzReportBtn").click();'],
    ['drive ended', '/index.html', endCard],
    ['permission sheet', '/index.html', 'document.getElementById("permSheet").classList.add("show")'],
    ['replay, Tapedeck', '/index.html?drive=dry_ridge&play=1', 'apexDebug.tryTheme("tapedeck")'],
    ['replay, Billet', '/index.html?drive=dry_ridge&play=1', 'apexDebug.tryTheme("billet")'],
    ['garage', '/index.html?view=garage', null],
    ['confirm sheet', '/index.html?view=garage', 'document.getElementById("myEraseBtn").click()'],
    ['log', '/analysis.html?tab=log', null],
    ['privacy', '/privacy.html', null],
  ];
  // the scanner catches what it says it does: two planted keys that overlap, and one 3 pt from the edge
  await page.setViewportSize({ width: SAFE.portrait.w, height: SAFE.portrait.h });
  await page.goto(base + '/privacy.html');
  await page.evaluate(() => { const k = (l, t) => { const b = document.createElement('button'); b.textContent = 'X'; b.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:60px;height:60px;z-index:99`; document.body.append(b); };
    k(100, 300); k(150, 330); k(3, 500); });
  const planted = await unsafe(page, SAFE.portrait);
  check(planted.some((b) => /X" overlaps/.test(b)) && planted.some((b) => /gap left 3/.test(b)), 'the scanner finds a planted overlap and gap: ' + planted.join(' | '));
  const bad = [], shots = [];
  for (const [orient, d] of Object.entries(SAFE)) {
    await page.setViewportSize({ width: d.w, height: d.h });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.i });
    for (const [name, url, act, fresh] of screens) {
      await page.goto(base + '/index.html?blank=1');
      await page.evaluate((f) => { if (f) localStorage.setItem('e2e.fresh', '1'); else localStorage.removeItem('e2e.fresh'); }, !!fresh);
      await page.goto(base + url);
      await page.waitForFunction(() => document.readyState === 'complete' && (!document.getElementById('app') || (window.apex && window.apexDebug)));
      await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 });   // the opening cover (boot.js) hides everything for up to 2.5 s
      await page.waitForTimeout(300);
      if (act) { await page.evaluate('(async () => { ' + act + ' })()'); await page.waitForTimeout(700); }
      for (const b of await unsafe(page, d)) bad.push(`${orient} · ${name}: ${b}`);
      if (process.env.SHOTS) shots.push({ orient, name, png: (await page.screenshot()).toString('base64'), w: d.w });
    }
  }
  // SHOTS=<dir>: one contact sheet per phone shape, for the next design review (CI keeps them as an artefact, U-05)
  if (process.env.SHOTS) {
    require('fs').mkdirSync(process.env.SHOTS, { recursive: true });
    for (const orient of Object.keys(SAFE)) {
      const set = shots.filter((x) => x.orient === orient), w = Math.round(set[0].w / 2);
      await page.setViewportSize({ width: 4 * (w + 16) + 16, height: 600 });
      await page.setContent(`<body style="margin:0;padding:8px;background:#2b2b2b;font:12px sans-serif;color:#ddd;display:flex;flex-wrap:wrap;gap:16px">${
        set.map((x) => `<figure style="margin:0;width:${w}px"><img style="width:100%" src="data:image/png;base64,${x.png}"><figcaption>${x.name}</figcaption></figure>`).join('')}</body>`);
      await page.screenshot({ path: `${process.env.SHOTS}/${orient.replace(/\W+/g, '-')}.png`, fullPage: true });
    }
  }
  check(!bad.length, 'under the island, the home indicator or a corner:\n  ' + bad.join('\n  '));
}, { hasTouch: true });


(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  // FLOW=<text> runs only the flows whose name contains it; REPEAT=<n> runs each n times (for chasing a flaky one).
  const only = process.env.FLOW ? flows.filter((f) => f.name.includes(process.env.FLOW)) : flows;
  const runs = only.flatMap((f) => Array.from({ length: Math.max(1, Number(process.env.REPEAT) || 1) }, () => f));
  for (const { name, fn, ctxOpts } of runs) {
    const { news, ...browserOpts } = ctxOpts;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...browserOpts });
    // Only our own server: maps, routers, fonts and voices are blocked, so the result doesn't depend on the network.
    await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    // "What's new" (IDEAS O-10) would sit over every flow; it is seen already unless a flow says otherwise (ctxOpts.news).
    const newsId = require('../web/whats_new.js').NEWS.id;
    if (!ctxOpts.news) await ctx.addInitScript((id) => { try { if (!localStorage.getItem('apex.newsSeen')) localStorage.setItem('apex.newsSeen', id); } catch (_) {} }, newsId);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
    // Content-Security-Policy (tools/csp.py, IDEAS Z-11): anything the policy blocks is a failure, so a new host can't slip in.
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text()); });
    // A missing file of our own (a renamed script, a typo'd path) is a failure even when nothing throws. /api/* has no
    // Worker behind this server, so its 404s are expected.
    page.on('response', (res) => { const u = res.url(); if (u.startsWith(base) && !u.startsWith(base + '/api/') && res.status() >= 400) errors.push(`${res.status()} ${u.slice(base.length)}`); });
    const t0 = Date.now();
    try {
      await fn(page, base);
      await page.waitForTimeout(300);   // let late async errors surface
      check(!errors.length, `page errors or missing files:\n  ${errors.join('\n  ')}`);
      console.log(`ok   ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(e.message || e).split('\n').join('\n     ')}`);
      if (errors.length && !String(e.message).includes('page errors')) console.log(`     page errors:\n       ${errors.join('\n       ')}`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(`${runs.length - failed}/${runs.length} flows passed`);
  process.exit(failed ? 1 : 0);
})();
