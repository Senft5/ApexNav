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
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...ctxOpts });
    // Only our own server: maps, routers, fonts and voices are blocked, so the result doesn't depend on the network.
    await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
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
