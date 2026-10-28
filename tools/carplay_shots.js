// Screenshots of the iPhone navigation flow for the CarPlay entitlement request (docs/CARPLAY.md): search a destination,
// the route card with its options, then guidance with the next turn and arrival time. The real cockpit with live map
// tiles and the public router; only place search is answered here (with the real town's position). Run:
// node tools/carplay_shots.js  (writes docs/carplay/*.png). Not part of CI (needs the network).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', 'web'), OUT = path.join(__dirname, '..', 'docs', 'carplay');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.m4a': 'audio/mp4', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  let p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
}).listen(0);
const START = { latitude: 35.3626, longitude: -84.2866 };                 // Tellico Plains, TN
const DEST = { name: 'Robbinsville', state: 'North Carolina', lon: -83.8074, lat: 35.3229 };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, timezoneId: 'America/New_York',
    geolocation: START, permissions: ['geolocation'] });
  const newsId = /id: '([^']+)'/.exec(fs.readFileSync(path.join(WEB, 'whats_new.js'), 'utf8'))[1];   // what's new isn't the product
  await ctx.addInitScript((id) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.newsSeen', id); } catch (_) {} }, newsId);
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [DEST.lon, DEST.lat] }, properties: { name: DEST.name, state: DEST.state, county: 'Graham County', type: 'city' } }] }) }));
  const page = await ctx.newPage();
  const hideToast = () => page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log(name); };
  try {
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
    await page.waitForTimeout(2500);
    // 1. destination search
    await page.click('#destInput');
    await page.fill('#destInput', 'Robbinsville');
    await page.waitForSelector('#placeList .place', { timeout: 15000 });
    await page.waitForTimeout(800);
    await hideToast(); await shot('1-search.png');
    // 2. the route card: time, distance, route options
    await page.click('#placeList .place');
    await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.steps && t.steps.length; }, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.click('#routeBar');                                   // the full route card: time, options, climb, forecast
    await page.waitForTimeout(1500);
    await hideToast(); await shot('2-route.png');
    // 3. guidance: start, then drive to just before the first turn the router gave
    await page.click('#routeDriveBtn');
    if (await page.isVisible('#permGo')) await page.click('#permGo');   // the first drive asks for location and motion
    // drive up to a turn the router gave; take the first one whose direction is the first thing in the strip (a turn with a
    // corner called just before it shows the corner first)
    const turns = await page.evaluate(() => window.apexDebug.track.steps.map((s, k) => ({ k, m: s.m, type: s.type })).filter((s) => s.m > 800 && s.type >= 9 && s.type <= 25));
    const VERB = /^(Bear|Turn|Sharp|Keep|Take|Merge|At the)/;
    for (const turn of turns) {
      const pts = await page.evaluate((tm) => {
        const t = window.apexDebug.track; let i = t.dist.findIndex((d) => d >= Math.max(0, tm - 450)); if (i < 1) i = 1;
        return [i - 6, i - 4, i - 2, i].filter((k) => k >= 0).map((k) => ({ latitude: t.lat[k], longitude: t.lon[k] }));
      }, turn.m);
      for (const p of pts) { await ctx.setGeolocation({ ...p, accuracy: 5 }); await page.waitForTimeout(900); }
      await page.waitForTimeout(2500);
      const first = await page.evaluate(() => { const n = document.querySelector('#notes .note, #notes > *'); return n ? n.innerText.replace(/\s+/g, ' ') : ''; });
      if (VERB.test(first.replace(/^[\d.]+\s*(FT|MI|M|KM)\s*/i, ''))) break;
    }
    // the desktop browser has no motion sensor or screen lock, so it warns about both; the app on a phone doesn't
    await page.evaluate(() => { const w = document.getElementById('dsWarn'); if (w) w.style.display = 'none'; });
    await hideToast(); await shot('3-guidance.png');
  } finally { await browser.close(); server.close(); }
})();
