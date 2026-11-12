// Screenshots for the landing page (web/about.html, IDEAS O-08): the real cockpit at phone size, from the bundled replay,
// with live map tiles. Run: node tools/landing_shots.js  (writes web/brand/shots/*.png). Not part of CI (needs the network).
// For the App Store listing: STORE=1 SHOTS_OUT=store-shots node tools/landing_shots.js (1320 x 2868, docs/LISTING.md).
process.env.TZ = 'America/New_York';   // the example crew's drive is at 7:30 in the morning there, as the page shows it
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', 'web'), OUT = process.env.SHOTS_OUT || path.join(WEB, 'brand', 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  let p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
}).listen(0);
(async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  // STORE=1: App Store Connect's 6.9" iPhone size (1320 x 2868: 440 x 956 points at 3x, the iPhone 16 Pro Max), docs/LISTING.md
  const store = process.env.STORE === '1';
  const ctx = await browser.newContext({ viewport: store ? { width: 440, height: 956 } : { width: 390, height: 844 }, deviceScaleFactor: store ? 3 : 2, timezoneId: 'America/New_York' });
  // past the welcome, the permissions note and What's new (its current id, or it covers the page)
  const news = require(path.join(WEB, 'whats_new.js')).NEWS.id;
  await ctx.addInitScript((news) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.newsSeen', news);
    localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full' })); } catch (_) {} }, news);
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  try {
    // 1. the cockpit on the twisty part of the bundled Dry Ridge replay
    // by day (the page is paper), whatever the hour the tool runs at; the boot cover gone first
    await page.goto(`${base}/index.html?drive=dry_ridge&play=1&night=0`);
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length && !document.getElementById('boot'), null, { timeout: 30000 });
    await page.evaluate((f) => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * f; }, Number(process.env.SHOT_AT || 0.45));
    await page.waitForTimeout(4000);   // the call's arrival (the pen) finished, not caught half drawn
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });   // service notices aren't the product
    await page.screenshot({ path: path.join(OUT, 'cockpit.png') });
    console.log('cockpit.png');
    // 2. a crew's page (an example crew, the Worker stubbed): its livery, the next drive with who is going, members, chat
    const day = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() + ((n - d.getDay() + 7) % 7 || 7)); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const next = { id: 'E1AAAAAAAAAAAAAA', crew_id: 'k1', crew_name: 'Ridge Runners', title: 'Cherohala Skyway, sunrise', starts_at: day(6, 7, 30),
      meet_name: 'Tellico Plains', meet_lat: 35.36, meet_lon: -84.29, notes: 'Full tank. Quiet through town.', by_handle: 'nate', mine: true, can_cancel: true,
      my_rsvp: 'going', going: ['nate', 'sam', 'ali', 'jo'], maybe: 2 };
    await ctx.unroute('**/api/**');
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'nate' });
      if (u.pathname === '/api/crews') return json([{ id: 'k1', name: 'Ridge Runners', role: 'owner', visibility: 'private', members: 6 }]);
      if (u.pathname === '/api/crews/k1/page') return json({ id: 'k1', name: 'Ridge Runners', motto: 'Slow in, smooth out.', visibility: 'private', area_name: null, members: 6,
        is_owner: true, crest: null, crest_photo_id: null, stripe: null, cover_photo_id: null, livery: 'plain', sharing_scores: true, next, board: [] });
      if (u.pathname === '/api/crews/k1/members') return json(['nate', 'sam', 'ali', 'jo', 'mel', 'kit'].map((h, i) => ({ handle: h, role: i ? 'member' : 'owner', mine: !i, photo_id: null })));
      if (u.pathname === '/api/events') return json([next]);
      if (u.pathname === '/api/crews/k1/chat') return json([{ id: 'm1', handle: 'sam', body: 'Fuel at the Shell in Tellico, then up the hill.', mine: false, at: new Date().toISOString() }]);
      return json([]);
    });
    await page.goto(`${base}/index.html?view=people&night=0`);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 30000 });
    await page.evaluate(() => document.querySelector('[data-people="crews"]').click());
    // one crew opens on its page; with more, the list comes first
    await page.waitForSelector('.drive-card, .cd-open');
    await page.evaluate(() => { const k = document.querySelector('.cd-open'); if (k && !document.querySelector('.drive-card')) k.click(); });
    await page.waitForSelector('.drive-card');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'crew.png') });
    console.log('crew.png');
  } finally { await browser.close(); server.close(); }
})();
