// Live, unstubbed runs of the calibration trips in headless Chromium (docs/ROUTE_ENGINE.md, Calibration): the app plans
// each trip against the real services and this records the plan time, when the first route showed, the pick, its why line,
// every request (host, status, time), the context runs, and the candidates the engine last ranked with their context.
//   BASE=https://apexnav.senftns.workers.dev/ OUT=/tmp/live NODE_PATH=$(npm root -g) node tools/route_engine_live.js [case:level ...]
//   FIXTURES=tests/fixtures/route_engine_live also writes each capture there as a fixture (tests/test_route_engine_live.py).
// BASE may be a local static server of web/ (then /api answers 404, as signed out). Needs playwright and Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || __dirname;
const BASE = process.env.BASE || 'https://apexnav.senftns.workers.dev/';
const CASES = {
  subdivision: { from: { lat: 39.2480, lon: -84.5770 }, to: { lat: 39.2690, lon: -84.5790 } },
  subdivision4: { from: { lat: 39.2400, lon: -84.5720 }, to: { lat: 39.2780, lon: -84.5800 } },
  northgate: { from: { lat: 39.2490, lon: -84.5960 }, to: { lat: 39.2900, lon: -84.5400 } },
  colerain: { from: { lat: 39.2300, lon: -84.5600 }, to: { lat: 39.2800, lon: -84.6500 } },
  harrison: { from: { lat: 39.2620, lon: -84.6000 }, to: { lat: 39.2966, lon: -84.7958 } },
};
let KEYS = null;
if (process.env.KEYS === '1') {
  // the production Worker's (a preview has no CTX_KEYS secret of its own)
  const j = JSON.parse(require('child_process').execFileSync('curl', ['-sS', '-H', 'x-apexnav: 1', 'https://apexnav.senftns.workers.dev/api/ctx/keys'], { encoding: 'utf8' }));
  KEYS = JSON.stringify(j.keys || {});
}
const runs = process.argv.slice(2).length ? process.argv.slice(2) : ['subdivision:fun', 'northgate:fun', 'colerain:fun', 'harrison:fun', 'colerain:quick', 'colerain:max'];

async function one(browser, key) {
  const [cs, level] = key.split(':'), c = CASES[cs];
  const ctx = await browser.newContext({ geolocation: { latitude: c.from.lat, longitude: c.from.lon }, permissions: ['geolocation'], viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  const bad = [], consoleErr = [], pageErr = [], failed = [], hosts = {};
  page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErr.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url().slice(0, 140)} ${(r.failure() || {}).errorText}`));
  page.on('response', (r) => { try { const h = new URL(r.url()).host; hosts[h] = hosts[h] || {}; hosts[h][r.status()] = (hosts[h][r.status()] || 0) + 1; if (r.status() >= 400) bad.push(r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 160)); } catch (_) {} });
  await page.addInitScript(() => {
    window.__fetchLog = []; const of = window.fetch.bind(window);
    window.fetch = async (u, o) => { const t = performance.now(), url = String(u && u.url || u); let st = 'ERR';
      try { const r = await of(u, o); st = r.status; return r; } finally { window.__fetchLog.push({ url: url.slice(0, 120), t: Math.round(t), ms: Math.round(performance.now() - t), st }); } };
  });
  // KEYS=1: route context's client keys from the Worker on the page first, as cockpit.js loadKeys puts them; KEYS=0: none
  // (the Worker's answer blocked). 2026-11-14: the engine's picks with and without Mapillary signs, SeatGeek, OHGO, NASS
  if (process.env.KEYS === '0') await page.route('**/api/ctx/keys', (r) => r.fulfill({ status: 404, body: '' }));
  if (KEYS) await page.addInitScript((k) => { try { localStorage.setItem('apex.keys', k); localStorage.setItem('apex.keys.at', String(Date.now())); } catch (_) {} }, KEYS);
  await page.addInitScript((lv) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', lv); } catch (_) {} }, level);
  await page.goto(BASE, { timeout: 60000 });
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteCtx && window.ApexRouteEngine, null, { timeout: 60000 });
  // record every ApexRouteCtx.run call (the page's own function, wrapped to read its result; network untouched)
  await page.evaluate(() => {
    window.__ctxRuns = [];
    const orig = ApexRouteCtx.run.bind(ApexRouteCtx);
    ApexRouteCtx.run = async (cs, opts) => { const t = performance.now(); const r = await orig(cs, opts);
      window.__ctxRuns.push({ at: Math.round(t - (window.__t0 || 0)), stage: !!(opts && opts.stage), n: cs.length, budgetMs: opts && opts.budgetMs, ms: Math.round(performance.now() - t), complete: r.complete, status: JSON.parse(JSON.stringify(r.status)) }); return r; };
    window.__marks = [];
    const wrap = (obj, name, label) => { if (!obj || typeof obj[name] !== 'function') return; const f = obj[name]; obj[name] = function () { const t = performance.now(); const r = f.apply(this, arguments);
      Promise.resolve(r).finally(() => window.__marks.push([label, Math.round(t - (window.__t0 || 0)), Math.round(performance.now() - t)])); return r; }; };
    wrap(window.ApexStages, 'discover', 'discover'); wrap(window.ApexStages, 'addElevations', 'elev'); wrap(window.ApexRouteEngine, 'rank', 'rank'); wrap(window.ApexFunRoute, 'geometry', 'geom'); wrap(window.ApexFunRoute, 'plansFromMatrix', 'plans');
    window.__flag = window.ApexFlags ? ApexFlags.on('route_engine') : 'no ApexFlags';
    // the candidates the engine last ranked with their context (a live capture for tests/fixtures/route_engine_live)
    window.__cands = null;
    const origRank = ApexRouteEngine.rank;
    ApexRouteEngine.rank = function (cands, opts) { if (cands && cands.some((c) => c.ctx)) window.__cands = { cands, level: opts && opts.level }; return origRank.apply(this, arguments); };
    window.apexDebug.lastFun = undefined;
  });
  await page.waitForTimeout(2500);
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.waitForTimeout(500);
  await page.click('#destInput');
  await page.fill('#destInput', `${c.to.lat}, ${c.to.lon}`);
  const t0 = Date.now();
  await page.evaluate(() => { window.__t0 = performance.now(); window.__first = null; const iv = setInterval(() => { const t = window.apexDebug.track; if (t && t.kind === 'route' && t.id === 'route_dest') { window.__first = Math.round(performance.now() - window.__t0); clearInterval(iv); } }, 50); });
  await page.press('#destInput', 'Enter');
  let timedOut = false;
  try { await page.waitForFunction(() => window.apexDebug.lastFun && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 180000 }); }
  catch (_) { timedOut = true; }
  const planMs = Date.now() - t0;
  await page.waitForTimeout(800);
  const data = await page.evaluate(() => {
    const t = window.apexDebug.track, txt = (id) => { const e = document.getElementById(id); return e ? { text: e.textContent.trim(), hidden: e.hidden } : null; };
    const names = {};
    if (t && t.steps) { const st = [...t.steps].sort((a, b) => a.m - b.m), tot = t.dist[t.dist.length - 1];
      st.forEach((s, i) => { const len = ((i + 1 < st.length ? st[i + 1].m : tot) - s.m) / 1000; if (s.street) names[s.street] = +((names[s.street] || 0) + len).toFixed(2); }); }
    const step = t && t.lat ? Math.max(1, Math.floor(t.lat.length / 8)) : 1;
    return {
      flag: window.__flag, firstRouteMs: window.__first,
      track: t ? { kind: t.kind, id: t.id, name: t.name, why: t.why, extraS: t.extraS, timeS: t.timeS, funLevel: t.funLevel, km: +(t.dist[t.dist.length - 1] / 1000).toFixed(2),
        engine: t.engine ? { quality: t.engine.quality, confidence: t.engine.confidence, poorKm: t.engine.poorKm, hard: t.engine.hard } : null,
        names, steps: (t.steps || []).map((s) => [s.type, s.street, Math.round(s.m)]),
        sample: t.lat ? Array.from({ length: Math.ceil(t.lat.length / step) }, (_, i) => [+t.lat[i * step].toFixed(5), +t.lon[i * step].toFixed(5)]).concat([[+t.lat[t.lat.length - 1].toFixed(5), +t.lon[t.lon.length - 1].toFixed(5)]]) : null } : null,
      why: txt('routeCardWhy'), routeBarName: txt('routeBarName'),
      card: (document.getElementById('planPanel') || {}).innerText ? document.getElementById('planPanel').innerText.slice(0, 1500) : null,
      lastFun: (window.apexDebug.lastFun || []).map((x) => ({ kind: x.kind, timeS: x.timeS, value: x.value, quality: x.quality, confidence: x.confidence, poorKm: x.poorKm, parts: x.parts })),
      marks: (window.__marks || []).filter((m) => m[1] >= -50), lastCtx: window.apexDebug.lastCtx || null, ctxRuns: window.__ctxRuns, fetchLog: (window.__fetchLog || []).filter((f) => f.t >= window.__t0 - 50).map((f) => ({ ...f, t: f.t - Math.round(window.__t0) })),
      toast: (document.getElementById('toast') || {}).textContent,
      capture: (() => {
        const x = window.__cands; if (!x) return null;
        const enc = (coords) => { let o = '', pl = 0, po = 0; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let r = ''; while (v >= 0x20) { r += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return r + String.fromCharCode(v + 63); };
          for (const [lon, lat] of coords) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); o += e(la - pl) + e(lo - po); pl = la; po = lo; } return o; };
        const rle = (a) => { const out = []; let prev, n = 0; for (const v0 of a) { const v = Number.isFinite(v0) ? Math.round(v0 * 1000) / 1000 : null; if (n && v === prev) n++; else { if (n) out.push([prev, n]); prev = v; n = 1; } } if (n) out.push([prev, n]); return out; };
        return { level: x.level, departAt: x.cands[0] && x.cands[0].corridor ? x.cands[0].corridor.departAt : null, cands: x.cands.map((c) => ({
          kind: c.kind, highway: !!c.highway, timeS: c.timeS, shape: enc(c.route.coords), turns: c.route.turns, times: c.route.times, names: c.route.names ? Object.fromEntries(c.route.names) : {},
          has: c.route.has, via: (c.via || []).length, plan: c.plan ? c.plan.legs.map((l) => ({ name: l.s.name || null, km: l.s.km, score: l.s.score })) : null,
          glare: c.glare || null, townKm: c.townKm ?? null, weatherCost: c.weatherCost || 0, adjust: c.adjust || 0, tasteBonus: c.tasteBonus ?? null, preferBonus: c.preferBonus || 0,
          match: c.corridor && c.corridor.match || null,
          ctx: c.ctx ? { channels: Object.fromEntries(Object.entries(c.ctx.channels).map(([k, v]) => [k, rle(v)])), spans: c.ctx.spans, points: c.ctx.points, from: c.ctx.from } : null })) };
      })(),
    };
  });
  await page.screenshot({ path: path.join(OUT, `${cs}_${level}.png`) });
  await ctx.close();
  return { key, from: c.from, to: c.to, planMs, timedOut, ...data, consoleErr, pageErr, failed: failed.slice(0, 60), bad, hosts };
}

// a capture as a fixture: continuous channels at a precision the engine can't tell apart, run-length encoded
const Q = { visibility_m: 100, elev_m: 1, population_density: 10, address_density: 10, housing_density: 10, housing_per_km2: 10,
  impervious_pct: 1, canopy_pct: 1, grade_pct: 0.5, gust_mps: 0.5, crosswind_mps: 0.5, wind_mps: 0.5, bldg_per_km: 1, addr_per_km: 1,
  night_lights: 1, relief_m: 1, road_temp_c: 0.5, air_temp_c: 0.5, tpi_m: 1, aspect_rad: 0.05, noise_db: 1, aadt: 50 };
function compact(cap) {
  const q = (k, v) => { if (v == null) return null; const s = Q[k] || 0.01; return Math.round(Math.round(v / s) * s * 1000) / 1000; };
  for (const c of cap.cands) {
    if (!c.ctx) continue;
    for (const [k, runs] of Object.entries(c.ctx.channels)) {
      const out = [];
      for (const [v0, n] of runs) { const v = q(k, v0); if (out.length && out[out.length - 1][0] === v) out[out.length - 1][1] += n; else out.push([v, n]); }
      c.ctx.channels[k] = out;
    }
    for (const p of c.ctx.points || []) if (Number.isFinite(p.atM)) p.atM = Math.round(p.atM * 10) / 10;
    for (const s of c.ctx.spans || []) { if (Number.isFinite(s.fromM)) s.fromM = Math.round(s.fromM * 10) / 10; if (Number.isFinite(s.toM)) s.toM = Math.round(s.toM * 10) / 10; }
    delete c.ctx.from;
  }
  return { level: cap.level, departAt: cap.departAt, cands: cap.cands };
}

(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  for (const k of runs) {
    let r;
    try { r = await one(browser, k); } catch (e) { r = { key: k, error: String(e).slice(0, 500) }; }
    fs.writeFileSync(path.join(OUT, `${k.replace(':', '_')}.json`), JSON.stringify(r, null, 1));
    if (process.env.FIXTURES && r.capture) fs.writeFileSync(path.join(process.env.FIXTURES, `${k.replace(':', '_')}.json`), JSON.stringify(compact(r.capture)));
    console.log(k, r.error || `${r.planMs} ms (first ${r.firstRouteMs}), why=${r.track && r.track.why}, extra=${r.track && r.track.extraS}, names=${JSON.stringify(r.track && r.track.names)}`);
  }
  await browser.close();
})();
