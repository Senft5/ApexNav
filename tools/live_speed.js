// Live planning speed (docs/OWN_ROUTING.md §8 2026-11-08 night). Cold (a fresh profile) then warm (the same profile
// reopened: tiles in IndexedDB) plan per case, against BASE: production by default, or a local serve of a worktree's web/
// (the app's case: its files and shipped tiles local) with /api relayed to production. Dumps apexDebug.timeline, planMarks,
// lastOwn, the ranked pool (lastFun: each candidate's value and its parts, the engine's terms) and EVERY request (page
// and its workers) with its start (ms from Enter) and duration, so network and compute
// can be told apart. Usage: [BASE=...] OUT=dir [AGAIN=1] node tools/live_speed.js case:level ...
// AGAIN=1 also plans a second time in the warm page without a reload (memory warm). HANG=ms holds every request off the
// app's own files from Enter that long, then refuses it (HANGALL=1: from the page's load: a weak signal from launch).
// Public trips only (never commit anyone's own addresses here).
const { chromium } = (() => { try { return require('playwright'); } catch (_) { return require('/opt/node-tools/node_modules/playwright'); } })();
const fs = require('fs'), path = require('path'), os = require('os');
const OUT = process.env.OUT || __dirname, BASE = process.env.BASE || 'https://apexnav.senftns.workers.dev/';
const CASES = {
  subdivision: { from: { lat: 39.248, lon: -84.577 }, to: { lat: 39.269, lon: -84.579 } },
  subdivision4: { from: { lat: 39.24, lon: -84.572 }, to: { lat: 39.278, lon: -84.58 } },
  northgate: { from: { lat: 39.249, lon: -84.596 }, to: { lat: 39.29, lon: -84.54 } },
  colerain: { from: { lat: 39.23, lon: -84.56 }, to: { lat: 39.28, lon: -84.65 } },
  harrison: { from: { lat: 39.262, lon: -84.6 }, to: { lat: 39.2966, lon: -84.7958 } },
};
const runs = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const local = /localhost|127\.0\.0\.1/.test(BASE);

async function planOnce(page, c, reqs, again) {
  if (!again) { await page.click('#destInput'); await page.fill('#destInput', `${c.to.lat}, ${c.to.lon}`); }
  await page.evaluate(() => { window.__first = null; window.apexDebug.lastFun = undefined; window.apexDebug.planMarks = []; const was = window.apexDebug.track; const iv = setInterval(() => { const t = window.apexDebug.track; if (t && t !== was && t.kind === 'route' && t.id === 'route_dest') { window.__first = performance.now(); clearInterval(iv); } }, 10); });
  const wall0 = Date.now(); reqs.length = 0; reqs.t0 = wall0; reqs.hang = true;
  if (again) await page.evaluate((v) => { const i = document.getElementById('destInput'); i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, `${c.to.lat}, ${c.to.lon}`);
  else await page.press('#destInput', 'Enter');
  let timedOut = false;
  try { await page.waitForFunction(() => window.apexDebug.lastFun && (window.apexDebug.planMarks || []).some((m) => m[0] === 'built') && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 60000 }); } catch (_) { timedOut = true; }
  await page.waitForTimeout(4000);                                     // refine, instructions
  const d = await page.evaluate(() => {
    const D = window.apexDebug, enter = D.enterAt, ps = D.planStartAt, t = D.track;
    const built = ((D.planMarks || []).find((m) => m[0] === 'built') || [])[1];
    return { first: window.__first != null ? Math.round(window.__first - enter) : null, card: built != null ? Math.round(ps - enter + built) : null, startLag: Math.round(ps - enter),
      planMarks: D.planMarks, optMarks: D.optMarks, timeline: D.timeline || null, lastCtx: D.lastCtx, lastOwn: D.lastOwn, refine: D.lastRefine || null, warm: D.ownWarm || null,
      track: t ? { timeS: t.timeS, km: +(t.dist[t.dist.length - 1] / 1000).toFixed(2), why: t.why } : null,
      lastFun: (D.lastFun || []).map((y) => ({ kind: y.kind, timeS: y.timeS, value: y.value, parts: y.parts || null, quality: y.quality, poorKm: y.poorKm, hwyKm: y.hwyKm, townKm: y.townKm, ev: y.ev || null })) };
  });
  const net = reqs.slice().map((r) => ({ ...r, t: r.t - wall0 })).sort((a, b) => a.t - b.t);
  return { timedOut, ...d, net };
}

async function open(dir, c, level, reqs) {
  const ctx = await chromium.launchPersistentContext(dir, { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' },
    geolocation: { latitude: c.from.lat, longitude: c.from.lon }, permissions: ['geolocation'], viewport: { width: 430, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const pageErr = [];
  page.on('pageerror', (e) => pageErr.push(String(e).slice(0, 300)));
  const starts = new Map();
  ctx.on('request', (r) => starts.set(r, Date.now()));
  const done = (r, st) => { const s = starts.get(r); if (s == null || !reqs.t0 || s < reqs.t0 - 50) return; reqs.push({ t: s, ms: Date.now() - s, st, url: r.url().replace(/^https?:\/\//, '').slice(0, 110), fromSW: false }); };
  ctx.on('requestfinished', async (r) => { let st = 0; try { const resp = await r.response(); st = resp ? resp.status() : 0; } catch (_) {} done(r, st); });
  ctx.on('requestfailed', (r) => done(r, 'ERR'));
  // HANG=ms: from Enter on, every request but the app's own files is held that long, then refused (a weak signal)
  if (process.env.HANG) await ctx.route('**', async (route) => {
    const u = new URL(route.request().url()), own = /^(localhost|127\.0\.0\.1)$/.test(u.hostname) && !u.pathname.startsWith('/api/');
    if (reqs.hang && !own) { await new Promise((r) => setTimeout(r, +process.env.HANG)); return route.abort().catch(() => {}); }
    if (local && !own && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) { try { const resp = await route.fetch({ url: 'https://apexnav.senftns.workers.dev' + u.pathname + u.search }); return route.fulfill({ response: resp }); } catch (_) { return route.abort().catch(() => {}); } }
    return route.continue().catch(() => {});
  });
  else if (local) await ctx.route(/^http:\/\/(localhost|127\.0\.0\.1):\d+\/api\//, async (route) => {
    const u = new URL(route.request().url()); try { const resp = await route.fetch({ url: 'https://apexnav.senftns.workers.dev' + u.pathname + u.search }); await route.fulfill({ response: resp }); } catch (_) { await route.abort(); } });
  await page.addInitScript((lv) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', lv); } catch (_) {} }, level);
  if (process.env.HANGALL) reqs.hang = true;                          // a weak signal from launch, not only from Enter
  const g0 = Date.now(); 
  await page.goto(BASE, { timeout: 60000 });
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteCtx && window.ApexRouteEngine, null, { timeout: 60000 });
  const loadMs = Date.now() - g0;
  await page.waitForTimeout(+(process.env.PAUSE || 3000));             // a person opens the app and types
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.waitForTimeout(300);
  const warmState = await page.evaluate(() => window.apexDebug.ownWarm || null);
  return { ctx, page, pageErr, loadMs, warmState };
}

(async () => {
  for (const k of runs) {
    const [cs, level] = k.split(':'), c = CASES[cs];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vspeed-'));
    const out = { key: k, base: BASE };
    try {
      for (const label of ['cold', 'warm']) {
        const reqs = [];
        const o = await open(dir, c, level, reqs);
        out[label] = { loadMs: o.loadMs, warmAtPlan: o.warmState, ...(await planOnce(o.page, c, reqs)), pageErr: o.pageErr };
        if (label === 'warm' && process.env.AGAIN) out.again = await planOnce(o.page, c, reqs, true);
        await o.ctx.close();
      }
    } catch (e) { out.error = String(e).slice(0, 400); }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(path.join(OUT, k.replace(':', '_') + '.json'), JSON.stringify(out, null, 1));
    const s = (r) => r ? `first ${r.first} card ${r.card}${r.timedOut ? ' TIMEOUT' : ''} pick ${r.lastFun[0] && r.lastFun[0].kind} ${r.track && r.track.km}km` : '-';
    console.log(k, out.error || `| cold ${s(out.cold)} | warm ${s(out.warm)}${out.again ? ' | again ' + s(out.again) : ''}`);
  }
})();
