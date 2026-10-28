// Screenshots for the landing page (web/about.html, IDEAS O-08): the real cockpit at phone size, from the bundled replay,
// with live map tiles. Run: node tools/landing_shots.js  (writes web/brand/shots/*.png). Not part of CI (needs the network).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', 'web'), OUT = path.join(WEB, 'brand', 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.m4a': 'audio/mp4' };
const server = http.createServer((q, r) => {
  let p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
}).listen(0);
(async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  await ctx.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.newsSeen', 'x'); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full' })); } catch (_) {} });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  try {
    // 1. the cockpit on the twisty part of the bundled Dry Ridge replay
    await page.goto(`${base}/index.html?drive=dry_ridge&play=1`);
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
    await page.evaluate((f) => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * f; }, Number(process.env.SHOT_AT || 0.45));
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });   // service notices aren't the product
    await page.screenshot({ path: path.join(OUT, 'cockpit.png') });
    console.log('cockpit.png');
    // 2. crew drives (an example crew, the Worker stubbed)
    // a Saturday sunrise and a Sunday morning, a few days out
    const day = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() + ((n - d.getDay() + 7) % 7 || 7)); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const starts = day(6, 7, 30);
    await ctx.unroute('**/api/**');
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'nate' });
      if (u.pathname === '/api/crews') return json([{ id: 'C1', name: 'Ridge Runners', role: 'owner', members: 6, visibility: 'public' }]);
      if (u.pathname === '/api/events') return json([{ id: 'E1AAAAAAAAAAAAAA', crew_id: 'C1', crew_name: 'Ridge Runners', title: 'Cherohala Skyway, sunrise', starts_at: starts,
        meet_name: 'Tellico Plains', meet_lat: 35.36, meet_lon: -84.29, route_id: 'R1', notes: 'Full tank. Quiet through town.', by_handle: 'nate', mine: true, can_cancel: true, my_rsvp: 'going', going: ['nate', 'sam', 'ali', 'jo'], maybe: 2, public: true }]);
      if (u.pathname === '/api/events/near') return json([{ id: 'M1AAAAAAAAAAAAAA', crew_id: 'C2', crew_name: 'Knoxville Coffee & Cars', title: 'Sunday coffee', starts_at: day(0, 9, 0),
        meet_name: 'Turkey Creek lot', meet_lat: 35.88, meet_lon: -84.15, notes: null, going: 23, member: false, km: 18 }]);
      return json([]);
    });
    await page.goto(`${base}/index.html?view=crew`);
    await page.waitForSelector('.drive-card');
    await page.evaluate(() => document.querySelector('.drive-card').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'crew.png') });
    console.log('crew.png');
  } finally { await browser.close(); server.close(); }
})();
