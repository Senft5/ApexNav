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

flow('Where to?: with the search and routing services unreachable, a search fails politely', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.click('#destInput');
  await page.fill('#destInput', 'Knoxville');
  await page.press('#destInput', 'Enter');
  await page.waitForFunction(() => /Search is offline/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('Where to?: a suggestion builds a route with a card and a Start button (search and router stubbed)', async (page, base) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
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
  // the router's turn is on the track for spoken directions (IDEAS V-04): halfway along, onto Hollow Creek Road
  const steps = await page.evaluate(() => { const t = window.apexDebug.track; return { steps: t.steps, total: t.dist[t.dist.length - 1] }; });
  const turn = steps.steps.find((x) => x.type === 10);
  check(turn && turn.street === 'Hollow Creek Road' && Math.abs(turn.m / steps.total - 0.5) < 0.1, 'the turn is placed halfway: ' + JSON.stringify(steps.steps));
  check(steps.steps.some((x) => x.type === 4) && !steps.steps.some((x) => x.type === 1), 'arrival kept, the start left out');
  // pin it as Home (IDEAS U-20): first in Where to?, on this phone; Unpin removes it
  page.once('dialog', (d) => d.accept('Home'));
  await page.evaluate(() => document.getElementById('routePinBtn').click());
  await page.waitForFunction(() => /Pinned as Home/.test(document.getElementById('toast').textContent));
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
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('avoid cameras: with the chip on, the cameras near the trip go to the router as exclusions (camera map and router stubbed, IDEAS R-35)', async (page, base) => {
  const asked = [];
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://overpass-api.de/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.85, lon: -83.94 }, { type: 'node', id: 2, lat: 37.5, lon: -83.9 }] }) }));
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
  await page.evaluate(() => document.getElementById('permGo').click());
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
  await page.click('.tab[data-view="setup"]');
  await page.click('#zoneRadius [data-zone-r="200"]');
  page.once('dialog', (d) => d.accept('Home'));
  await page.click('#zoneMapBtn');
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
    const g = ApexGarageUI.mount({ el, btn, toast: () => {}, apiCall: async () => ok([]), jsonOf: (r) => r.json() });
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
      await new Promise(r => setTimeout(r, 20)); }
  });
  await page.waitForFunction(() => !document.getElementById('hzAsk').hidden, null, { timeout: 5000 });
  check(/Gravel still there\?/.test(await page.textContent('#hzAsk')), 'asks after passing it');
  await page.click('#hzGone');
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
  await page.click('.tab[data-view="setup"]');
  await page.waitForFunction(() => /1 drive \(0.2 mi\)/.test(document.getElementById('myDataNote').textContent));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#myGpxBtn')]);
  const gpx = require('fs').readFileSync(await dl.path(), 'utf8');
  check(/<trk><name>Test road<\/name>/.test(gpx) && (gpx.match(/<trkpt /g) || []).length === 3, 'the GPX holds the drive');
  page.once('dialog', (d) => d.accept());
  await page.click('#myDrivesDelBtn');
  await page.waitForFunction(() => /0 drives/.test(document.getElementById('myDataNote').textContent));
  // offline data (IDEAS F-06): a saved route counted, then deleted; the drives are not touched by it
  await page.evaluate(() => { localStorage.setItem('apex.savedRoutes', JSON.stringify([{ id: 'r1', coords: [[0, 0], [1, 1]] }])); document.querySelector('.tab[data-view="setup"]').click(); });
  await page.waitForFunction(() => /Offline data: 1 saved route /.test(document.getElementById('myOfflineNote').textContent));
  page.once('dialog', (d) => d.accept());
  await page.click('#myOfflineDelBtn');
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
  const starts = new Date(Date.now() + 26 * 3600e3).toISOString();
  let mine = null;
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/crews' && m === 'GET') return json([{ id: 'CREW1', name: 'Ridge Runners', role: 'member', members: 3, visibility: 'private' }]);
    if (u.pathname === '/api/events/near') return json([{ id: 'MEET1AAAAAAAAAAA', crew_id: 'CREW9', crew_name: 'Coffee & Cars', title: 'Sunday coffee', starts_at: starts,
      meet_name: 'Kroger lot', meet_lat: 35.76, meet_lon: -83.96, notes: null, going: 7, member: false, km: 12 }]);
    if (u.pathname === '/api/events') return json([{ id: 'EVT1AAAAAAAAAAAA', crew_id: 'CREW1', crew_name: 'Ridge Runners', title: 'Cherohala <i>Saturday</i>', starts_at: starts,
      meet_name: 'Tellico Shell', meet_lat: 35.36, meet_lon: -84.29, route_id: null, notes: null, by_handle: 'bob', mine: false, can_cancel: false, my_rsvp: mine, going: ['bob', 'cara'], maybe: 1 }]);
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
  await page.waitForSelector('.drive-card');
  const card = await page.textContent('.drive-card');
  check(card.includes('Cherohala <i>Saturday</i>') && /Tomorrow|Today/.test(card) && card.includes('Going: @bob, @cara · 1 maybe'), 'the drive, as text: ' + card);
  await page.waitForSelector('.meet-card');
  check(/Sunday coffee/.test(await page.textContent('.meet-card')) && /7 going/.test(await page.textContent('.meet-card')) && /Meets near you/.test(await page.textContent('#sheet')), 'a public meet nearby');
  await page.click('.drive-card:not(.meet-card) button:has-text("Going")');
  await page.waitForFunction(() => document.querySelector('.drive-card:not(.meet-card) button[aria-pressed="true"]')?.textContent === 'Going');
  check(posted.some(([p, b]) => p === '/api/events/EVT1AAAAAAAAAAAA/rsvp' && b.status === 'going'), 'the answer was sent');
  // spots near you (IDEAS S-12): best rated first, as text, filterable; a rating is sent
  await page.waitForSelector('.spot-card');
  const spots = await page.$$eval('.spot-card', (els) => els.map((e) => e.textContent));
  check(spots.length === 2 && spots[0].includes('Look Rock <b>view</b>') && /4\.5★ \(6\) · Overlook · [\d.]+ km · 9 visited/.test(spots[0]) && spots[0].includes('Best at sunset'), 'the spots: ' + spots.join(' | '));
  check(!/Report/.test(spots[1]) && !/5★/.test(spots[1]), 'no rating or report on your own spot');
  await page.click('button:has-text("Café")');
  check((await page.$$('.spot-card')).length === 1, 'the café filter');
  await page.click('button:has-text("All")');
  await page.click('button[aria-label="Rate Look Rock <b>view</b> 5 stars"]');
  await page.waitForFunction(() => /Rated/.test(document.getElementById('toast').textContent));
  check(posted.some(([p, b]) => p === '/api/highlights/HL1/rating' && b.stars === 5), 'the rating was sent');
  // plan one: map centre as the meeting point
  await page.click('button:has-text("Plan a drive")');
  await page.fill('input[aria-label="Drive name"]', 'Dragon run');
  await page.click('button:has-text("Map centre")');
  await page.click('button:has-text("Plan it")');
  await page.waitForFunction(() => /Drive planned/.test(document.getElementById('toast').textContent));
  const plan = posted.find(([p]) => p === '/api/crews/CREW1/events');
  check(plan && plan[1].title === 'Dragon run' && /Z$/.test(plan[1].starts_at) && Number.isFinite(plan[1].meet.lat) && plan[1].route_id === null && plan[1].public === false, 'the plan was sent: ' + JSON.stringify(plan));
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
  await page.waitForSelector('#challengePanel:not([hidden])');
  check(/Drive 5 roads you haven't driven before · [12] of 5/.test(await page.textContent('#challengeList')), 'a new road this month');
  check(/^\d+(\.\d)? mi in 1 drive · 1 new road/.test(await page.textContent('#weekLines')), 'your week: ' + await page.textContent('#weekLines'));
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
  await page.click('.tab[data-view="setup"]');
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
  await page.click('.tab[data-view="setup"]');
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
  await page.click('.profile-view button:has-text("Back")');
  await page.waitForSelector('.side-pop.open button:has-text("Profile")');
});

flow('units: kilometres in Settings redraw the dial, the notes and the replay in metric (IDEAS U-22)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  check(await page.evaluate(() => ApexUnits.system()) === 'imperial', 'miles by default in en-US');
  await page.click('.tab[data-view="setup"]');
  await Promise.all([page.waitForNavigation(), page.click('[data-units="metric"]')]);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  check(await page.evaluate(() => localStorage.getItem('apex.units')) === 'metric', 'saved');
  const dial = await page.textContent('#cluster');
  check(/KM\/H/.test(dial) && /Trip km/.test(dial) && /200/.test(dial), 'the dial in km/h: ' + dial.slice(0, 200));
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForTimeout(1500);
  const notes = await page.textContent('#notes');
  check(/\d\s*(M|KM)/.test(notes) && !/\d\s*(FT|MI)/.test(notes), 'note distances in metres: ' + notes);
  check(/ km$/.test(await page.getAttribute('#scrubber', 'aria-valuetext')), 'the replay position in km');
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
  // during a drive the report sheet opens
  await page.evaluate((f) => window.apex.live(f), frame(1));
  await page.waitForFunction(() => window.apexDebug.state.mode === 'live');
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'report' } }));
  await page.waitForSelector('#hzOverlay.show');
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

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  for (const { name, fn, ctxOpts } of flows) {
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
  console.log(`${flows.length - failed}/${flows.length} flows passed`);
  process.exit(failed ? 1 : 0);
})();
