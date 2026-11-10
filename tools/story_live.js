// What the route card's overview says on real trips (web/route_story.js; docs/ROUTE_ENGINE.md "What this drive is like").
// Serves this checkout's web/ (the shipped tiles and context grid), blocks every other host, plans each trip in headless
// Chromium as a person would, waits for the refined ranking, and prints the card's lines beside the route itself: per
// 400 m its setting (t town, s suburban, c country, h highway, ? unknown), the engine's quality and the street. For
// reading the words against the road and tuning ApexRouteStory.T. DUMP=1 also writes the place channels per 400 m.
// Usage: [OUT=file.json] [DUMP=1] node tools/story_live.js colerain:fun harrison:max ...   (levels: quick, fun, max)
// Public places only (never commit anyone's own addresses here).
const { chromium } = (() => { try { return require('playwright'); } catch (_) { return require('/opt/node-tools/node_modules/playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const WEB = path.resolve(process.env.WEB || path.join(__dirname, '..', 'web'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const CASES = {
  subdivision: { from: { lat: 39.248, lon: -84.577 }, to: { lat: 39.269, lon: -84.579 } },
  subdivision4: { from: { lat: 39.24, lon: -84.572 }, to: { lat: 39.278, lon: -84.58 } },
  northgate: { from: { lat: 39.249, lon: -84.596 }, to: { lat: 39.29, lon: -84.54 } },
  colerain: { from: { lat: 39.23, lon: -84.56 }, to: { lat: 39.28, lon: -84.65 } },
  harrison: { from: { lat: 39.262, lon: -84.6 }, to: { lat: 39.2966, lon: -84.7958 } },
  // more public places: Fountain Square to Eden Park, Miami Whitewater Forest to Oxford, Loveland to Milford,
  // Sharon Woods to Winton Woods, Anderson Ferry to Lawrenceburg
  downtown: { from: { lat: 39.1017, lon: -84.5125 }, to: { lat: 39.1163, lon: -84.4925 } },
  oxford: { from: { lat: 39.2555, lon: -84.7445 }, to: { lat: 39.507, lon: -84.745 } },
  loveland: { from: { lat: 39.269, lon: -84.2638 }, to: { lat: 39.1753, lon: -84.2944 } },
  parks: { from: { lat: 39.2797, lon: -84.3916 }, to: { lat: 39.2576, lon: -84.5177 } },
  river: { from: { lat: 39.0957, lon: -84.6194 }, to: { lat: 39.1553, lon: -84.8217 } },
};
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'api/graph/v1/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"version":3,"build":"none","tiles":{}}'); return; }
    if (rel === 'api/ctx/v1/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"v":1,"bundles":{}}'); return; }
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}
(async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const out = {};
  for (const k of process.argv.slice(2)) {
    const [cs, level] = k.split(':'), c = CASES[cs];
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, geolocation: { latitude: c.from.lat, longitude: c.from.lon }, permissions: ['geolocation'] });
    await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await page.addInitScript((lv) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', lv); if (!localStorage.getItem('apex.newsSeen')) localStorage.setItem('apex.newsSeen', 'x'); } catch (_) {} }, level);
    try {
      await page.goto(base, { timeout: 60000 });
      await page.waitForFunction(() => window.apexDebug && window.ApexRouteCtx && window.ApexRouteEngine, null, { timeout: 60000 });
      await page.waitForTimeout(2500);
      for (const nm of ['Got it', 'Close', 'OK']) { const b = page.getByRole('button', { name: nm }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
      await page.click('#destInput'); await page.fill('#destInput', `${c.to.lat}, ${c.to.lon}`);
      await page.press('#destInput', 'Enter');
      await page.waitForFunction(() => window.apexDebug.lastFun && (window.apexDebug.planMarks || []).some((m) => m[0] === 'built') && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 60000 });
      await page.waitForTimeout(6000);
      const d = await page.evaluate((dump) => {
        const D = window.apexDebug, t = D.track, s = t.__story && t.__story.s, R = window.ApexRouteStory, E = window.ApexRouteEngine;
        const r = t.ranked, o = { timeMin: +(t.timeS / 60).toFixed(1), km: +(t.dist[t.dist.length - 1] / 1000).toFixed(1), why: t.why, kind: (D.lastFun[0] || {}).kind,
          card: document.getElementById('routeCardStory').hidden ? null : [document.getElementById('routeCardStoryLead').textContent, ...[...document.querySelectorAll('#routeCardStoryMore p')].map((p) => p.textContent)],
          lines: s ? s.lines.map((l) => ({ kind: l.kind, text: l.text, facts: l.facts })) : null, coverage: s && s.coverage };
        if (r && r.corridor && r.ctx) {
          const n = r.corridor.distM.length, set = R.settings(r.ctx, n), ch = (k) => E.channel(r.ctx, k);
          const smp = (r.ev && r.ev.samples) || E.samples(r.corridor, r.ctx), Q = smp.quality;
          const names = R.namesAlong(t.steps, r.corridor.edges, r.corridor.totalM);
          const nameAt = (m) => { for (const x of names) if (m >= x.fromM && m < x.toM) return x.name; return null; };
          const segs = []; const W = 16;
          for (let i = 0; i < n; i += W) {
            let q = 0, qn = 0; const c = {};
            for (let j = i; j < Math.min(n, i + W); j++) { if (Number.isFinite(Q[j])) { q += Q[j]; qn++; } c[set[j]] = (c[set[j]] || 0) + 1; }
            const top = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
            segs.push([+(r.corridor.distM[i] / 1000).toFixed(1), top === 'null' ? '?' : top[0], qn ? +(q / qn).toFixed(2) : null, nameAt(r.corridor.distM[i])]);
          }
          o.segs = segs;
          o.corners = (t.events || []).filter((e) => e.type === 'corner').length;
          o.poorBy = r.ev && r.ev.poorBy; o.signalPts = [...(r.ctx.points || []), ...(r.ctx.spans || [])].filter((p) => p && p.kind === 'signal').length;
          o.steps = (t.steps || []).map((x) => [Math.round(x.m), x.street || null]);
          if (dump) {
            const keys = ['road_class', 'road_use', 'sidewalk', 'business_per_km', 'landuse_urban', 'landuse_residential', 'density', 'impervious_pct', 'signals_per_km', 'housing_per_km2', 'address_per_km', 'address_density', 'bldg_per_km', 'night_lights', 'speed_limit_kph', 'lanes', 'signal_node', 'forest_share', 'canopy_pct', 'open_country', 'cropland_class', 'water_near', 'creek_follow'];
            o.ch = {};
            for (const k of keys) { const v = ch(k); if (!v) { o.ch[k] = null; continue; } const a = []; for (let i = 0; i < n; i += W) { let s2 = 0, c2 = 0; for (let j = i; j < Math.min(n, i + W); j++) if (Number.isFinite(v[j])) { s2 += v[j]; c2++; } a.push(c2 ? +(s2 / c2).toFixed(2) : null); } o.ch[k] = a; }
          }
        }
        return o;
      }, !!process.env.DUMP);
      d.errs = errs; out[k] = d;
    } catch (e) { out[k] = { error: String(e).slice(0, 300), errs }; }
    await ctx.close();
  }
  await browser.close(); server.close();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  for (const [k, d] of Object.entries(out)) {
    console.log(`\n== ${k}: ${d.error || `${d.timeMin} min ${d.km} km (${d.kind}) corners ${d.corners} | why: ${d.why && (d.why.text || JSON.stringify(d.why).slice(0, 160))}`}`);
    if (d.card) d.card.forEach((l) => console.log('   · ' + l)); else console.log('   (no overview) lines=' + JSON.stringify(d.lines && d.lines.map((l) => l.text)));
    if (d.coverage) console.log('   coverage ' + JSON.stringify(d.coverage) + ' poorBy ' + JSON.stringify(d.poorBy) + ' signalPts ' + d.signalPts);
    if (d.segs) { let last = null; const parts = []; for (const s of d.segs) { const key = s[1] + '|' + s[3]; if (key !== last) { parts.push(`${s[0]}km ${s[1]} q${s[2]} ${s[3] || '-'}`); last = key; } } console.log('   ' + parts.join(' / ')); }
  }
})();
