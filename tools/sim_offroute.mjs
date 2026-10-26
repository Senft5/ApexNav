// Browser simulation of live-mode rerouting (route-6). Drives web/index.html in headless Edge/Chrome
// with a simulated 1 Hz GPS track pushed through window.apex.live(), and reports what the pace-note
// strip showed, and when, for: leaving a route, rejoining it, driving the route backwards,
// GPS jitter, and a failed / successful / real reroute request.
//
// Run:   node tools/sim_offroute.mjs [--drive pebble_ridge|dry_ridge | --all-drives] [--browser <path>] [--json]
// Needs: Node >= 22 (global WebSocket + fetch) and Edge or Chrome installed. No npm packages: it speaks the
//        DevTools protocol directly, serves web/ itself, and uses a throwaway browser profile in the OS temp dir.
// Time:  Date.now is replaced by a virtual clock advanced 1000 ms per frame, so "5 s" is exact and the run
//        takes ~15 s per scenario of real time. The router is intercepted per scenario (fail / stub / real network);
//        the "stub" router returns a straight line from the fix onto the old route, which is test data only.
// Exit:  1 if any check fails; scenarios that could not run (e.g. no network) are reported as SKIP, not PASS.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const driveArg = arg('--drive', 'pebble_ridge');
const DRIVES = process.argv.includes('--all-drives') ? ['pebble_ridge', 'dry_ridge'] : [driveArg];
const AS_JSON = process.argv.includes('--json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- timeline (seconds, 1 Hz): ON_S on the track, OFF_S drifting 150 -> 300 m to the left at 15 m/s, then BACK_S on it
const ON_S = 30, OFF_S = 20, BACK_S = 30, SPEED = 15, FRAME_REAL_MS = 220;   // > 150 ms: the strip repaints at most every 150 ms

function findBrowser() {
  const c = [arg('--browser'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
  return c.find(p => fs.existsSync(p));
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.onnx': 'application/octet-stream' };
  const srv = http.createServer((req, res) => {
    const p = path.join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.on = {}; ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && this.pending.has(d.id)) { const { ok, bad } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? bad(new Error(d.error.message)) : ok(d.result); }
    else if (d.method && this.on[d.method]) this.on[d.method](d.params);
  }; }
  send(method, params = {}) { return new Promise((ok, bad) => { const id = ++this.id; this.pending.set(id, { ok, bad }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

// ---- geometry on the loaded track (equirectangular, fine over a few hundred metres)
const M_LAT = 111320;
function pointAt(tr, s) {
  const d = tr.dist; let lo = 0, hi = d.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= s) lo = m; else hi = m; }
  const f = Math.min(1, Math.max(0, (s - d[lo]) / ((d[hi] - d[lo]) || 1)));
  const lat = tr.lat[lo] + f * (tr.lat[hi] - tr.lat[lo]), lon = tr.lon[lo] + f * (tr.lon[hi] - tr.lon[lo]);
  const mLon = M_LAT * Math.cos(lat * Math.PI / 180);
  const brg = Math.atan2((tr.lon[hi] - tr.lon[lo]) * mLon, (tr.lat[hi] - tr.lat[lo]) * M_LAT);   // radians, clockwise from north
  return { lat, lon, brg, mLon };
}
// leftM metres to the left of travel (negative = right)
function offset(p, leftM) {
  const a = p.brg - Math.PI / 2;
  return { lat: p.lat + leftM * Math.cos(a) / M_LAT, lon: p.lon + leftM * Math.sin(a) / p.mLon };
}
function lcg(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }

const SNAP = `(() => { const n = document.getElementById('notes');
  const t = apexDebug.track, l = apexDebug.state.live;
  const match = t && l ? ApexCore.nearestIndex(l.lat, l.lon, t.lat, t.lon, -1, 600) : null;
  return { strip: n.innerText.replace(/\\s+/g, ' ').trim().replace(/^Clear /, ''), orig: !!(t && t.__orig), cursorIdx: apexDebug.state.cursorIdx, cursorM: apexDebug.state.cursorM,
           matchedM: match ? t.dist[match.index] : null,
           notesBlank: !!n.querySelector('.note-quiet') && !n.querySelector('.pn, .rb-box, .tm-note'), track: apexDebug.track && apexDebug.track.id, mode: apexDebug.state.mode,
           toast: document.getElementById('toast').innerText.trim() }; })()`;

async function main() {
  if (DRIVES.some(d => !['pebble_ridge', 'dry_ridge'].includes(d))) { console.error(`Unknown drive: ${driveArg}`); process.exit(2); }
  const browserPath = findBrowser();
  if (!browserPath) { console.error('No Edge/Chrome found; pass --browser <path>. Nothing was exercised.'); process.exit(2); }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-sim-'));
  const proc = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--disable-gpu',
    '--no-default-browser-check', '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch (_) {} srv.close(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} }, 1500); };
  try {
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (_) { await sleep(200); } }
    if (!targets) throw new Error('browser did not expose a DevTools port');
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

    // Virtual clock for the monitor + a log of every strip text change and every spoken phrase.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => { const real = Date.now.bind(Date); window.__vt = null; Date.now = () => (window.__vt == null ? real() : window.__vt);
        window.__spoken = []; window.__strip = [];
        try { localStorage.setItem('apex.prefs', JSON.stringify({ voiceId: 'device', toggles: { voice: true } })); } catch (_) {}
        try { speechSynthesis.speak = (u) => { window.__spoken.push({ vt: window.__vt, text: u.text }); setTimeout(() => u.onend && u.onend(), 0); }; speechSynthesis.cancel = () => {}; } catch (_) {}
        document.addEventListener('DOMContentLoaded', () => { const n = document.getElementById('notes'); let last = null;
          new MutationObserver(() => { const t = n.innerText.replace(/\\s+/g, ' ').trim(); if (t !== last) { last = t; window.__strip.push({ vt: window.__vt, text: t }); } }).observe(n, { childList: true, subtree: true, characterData: true }); }); })();` });

    let routerMode = 'fail', routerHits = [], stubTrack = null, routerDelayMs = 0;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*valhalla*' }, { urlPattern: '*router.project-osrm.org*' }] });
    cdp.on['Fetch.requestPaused'] = async (e) => {
      const isOsrm = e.request.url.includes('osrm');
      routerHits.push({ vt: await cdp.eval('window.__vt'), url: e.request.url.slice(0, 60) });
      try {
        if (routerMode === 'real') await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
        else if (routerMode === 'stub' && isOsrm) {
          await sleep(routerDelayMs);
          const from = e.request.url.split('/driving/')[1].split('?')[0].split(';')[0].split(',').map(Number);   // lon,lat
          const coords = [from, ...stubTrack];
          await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: Buffer.from(JSON.stringify({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: coords } }] })).toString('base64') });
        } else { await sleep(routerMode === 'fail' ? routerDelayMs : 0); await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionFailed' }); }
      } catch (_) {}
    };

    const results = [];
    let currentDrive;
    const record = (scenario, check, status, detail) => { scenario = `${currentDrive}: ${scenario}`; results.push({ scenario, check, status, detail }); if (!AS_JSON) console.log(`${status.padEnd(4)} [${scenario}] ${check}: ${detail}`); };

    for (const DRIVE of DRIVES) {
    currentDrive = DRIVE;

    async function load() {
      await cdp.send('Page.navigate', { url: `${base}/index.html?drive=${DRIVE}` });
      for (let i = 0; i < 100; i++) { await sleep(200); try { if (await cdp.eval('!!(window.apexDebug && apexDebug.track && window.apex)')) break; } catch (_) {} }
      await cdp.eval('apexDebug.track.__orig = true');
      return JSON.parse(await cdp.eval(`JSON.stringify({ id: apexDebug.track.id, lat: Array.from(apexDebug.track.lat), lon: Array.from(apexDebug.track.lon), dist: Array.from(apexDebug.track.dist) })`));
    }

    // frames(k) -> { leftM } | null ; runs ON_S + OFF_S + BACK_S frames at 1 Hz virtual time
    let chosenStart = 0;
    const driveStart = () => chosenStart;
    const T0 = 1_700_000_000_000;
    async function feed(k, lat, lon, courseDeg) {
      await cdp.eval(`window.__vt = ${T0 + k * 1000}; window.apex.live(${JSON.stringify({ lat, lon, speed_mps: SPEED, course_deg: (courseDeg + 360) % 360, accuracy_m: 8, has_fix: true })})`);
      await sleep(FRAME_REAL_MS);
      return { k, ...(await cdp.eval(SNAP)) };
    }
    async function drive(tr, leftAt, total) {
      const rows = []; const startS = driveStart(tr, total);
      for (let k = 0; k < total; k++) {
        const p = pointAt(tr, startS + k * SPEED), o = offset(p, leftAt(k));
        rows.push(await feed(k, o.lat, o.lon, p.brg * 180 / Math.PI));
      }
      await sleep(400);
      return rows;
    }
    const isOffText = (s) => /Off route|Wrong way|Rerouting|Checking route/.test(s);
    const isConfirmedOff = (s) => /Off route|Wrong way|Rerouting/.test(s);
    const firstK = (rows, from, pred) => { const r = rows.find(x => x.k >= from && pred(x)); return r ? r.k : null; };
    const stripLog = async () => JSON.parse(await cdp.eval('JSON.stringify(window.__strip)')).map(l => ({ ...l, text: l.text.replace(/^Clear /, '') }));
    const spoken = async () => JSON.parse(await cdp.eval('JSON.stringify(window.__spoken)'));
    const secs = (vt) => vt == null ? null : (vt - 1_700_000_000_000) / 1000;
    const LEAVE = ON_S, REJOIN = ON_S + OFF_S, TOTAL = ON_S + OFF_S + BACK_S;
    // Drift to whichever side keeps >= 60 m from every route vertex for the whole off phase (a winding road can fold back
    // within 300 m of itself; touching it would be a legitimate rejoin, not a bug).
    function chooseSide(tr) {
      const len = tr.dist[tr.dist.length - 1]; let best = null;
      for (let startS = 0; startS + TOTAL * SPEED + 20 < len; startS += 100) for (const sign of [1, -1]) {
        let min = Infinity;
        for (let k = LEAVE; k < REJOIN; k++) {
          const p = pointAt(tr, startS + k * SPEED), o = offset(p, sign * (150 + 150 * (k - LEAVE) / (OFF_S - 1)));
          for (let i = 0; i < tr.lat.length; i++) min = Math.min(min, Math.hypot((tr.lat[i] - o.lat) * M_LAT, (tr.lon[i] - o.lon) * p.mLon));
        }
        if (!best || min > best.min) best = { sign, min, startS };
        if (min >= 100) return best;
      }
      return best;
    }
    const leftPathFor = (sign) => (k) => k < LEAVE || k >= REJOIN ? 0 : sign * (150 + 150 * (k - LEAVE) / (OFF_S - 1));
    // Shared assertions for any scenario that leaves and rejoins the route.
    function checkLeaveAndRejoin(name, rows, log, says, { expectOffText, expectRejoin }) {
      const before = rows.filter(r => r.k < LEAVE);
      const bad = before.find(r => isOffText(r.strip));
      record(name, 'on route before leaving: no off-route text', bad ? 'FAIL' : 'PASS', bad ? `k=${bad.k}: "${bad.strip}"` : `0..${LEAVE - 1} s strip "${before[before.length - 1].strip}"`);
      const offK = firstK(rows, LEAVE, r => isConfirmedOff(r.strip));
      const early = rows.find(r => r.k > LEAVE && r.k < LEAVE + 5 && isConfirmedOff(r.strip));
      record(name, 'strip goes off route ~5 s after leaving, not before', offK === LEAVE + 5 && !early ? 'PASS' : 'FAIL',
        `left at k=${LEAVE}; first off-route strip at +${offK == null ? 'never' : offK - LEAVE} s ("${offK == null ? '' : rows[offK].strip}")${early ? `; EARLY at +${early.k - LEAVE} s` : ''}`);
      const offRows = rows.filter(r => r.k >= LEAVE + 5 && r.k < REJOIN);
      const blank = offRows.every(r => r.cursorIdx < 0) && offRows.every(r => isConfirmedOff(r.strip));
      record(name, 'notes/pace blank while off route (no cursor on the route, strip is only the off-route line)', blank ? 'PASS' : 'FAIL',
        `cursorIdx while off: ${[...new Set(offRows.map(r => r.cursorIdx))].join(',')}; strips: ${[...new Set(offRows.map(r => r.strip))].join(' | ')}`);
      const stripTexts = log.map(l => ({ at: secs(l.vt), text: l.text }));
      record(name, 'strip text transitions (seconds on the virtual clock)', 'INFO', stripTexts.map(l => `${l.at}s "${l.text.slice(0, 60)}"`).join(' ; '));
      if (expectOffText) record(name, `strip shows "${expectOffText}"`, log.some(l => l.text.includes(expectOffText)) ? 'PASS' : 'FAIL', log.some(l => l.text.includes(expectOffText)) ? 'seen' : 'never seen');
      if (expectRejoin) {
        const backK = firstK(rows, REJOIN, r => !isOffText(r.strip) && r.cursorIdx >= 0);
        const backSay = says.find(s => /Back on route/.test(s.text));
        record(name, 'coming back: strip leaves off-route and notes return', backK != null ? 'PASS' : 'FAIL',
          backK != null ? `rejoined at k=${REJOIN}; notes back at +${backK - REJOIN} s ("${rows[backK].strip.slice(0, 50)}")` : `still "${rows[rows.length - 1].strip}" at the end`);
        record(name, 'says "Back on route"', backSay ? 'PASS' : 'FAIL', backSay ? `spoken at ${secs(backSay.vt)} s (rejoin frame ${REJOIN} s)` : `spoken: ${says.map(s => s.text).join(', ') || 'nothing (speechSynthesis hook saw no calls)'}`);
      }
    }

    // ---------- 1. recorded drive: no request plan -> never reroutes
    {
      const name = 'recorded drive';
      routerMode = 'fail'; routerHits = [];
      const tr = await load();
      const planned = await cdp.eval('apexDebug.track.request == null');
      record(name, `${tr.id} loaded as a recorded drive (no request)`, planned ? 'PASS' : 'FAIL', `${tr.dist[tr.dist.length - 1].toFixed(0)} m long`);
      const side = chooseSide(tr); chosenStart = side.startS; record(name, 'drift side chosen', 'INFO', `${side.sign > 0 ? 'left' : 'right'}, start ${side.startS} m along the route, closest approach to the route during the off phase ${side.min.toFixed(0)} m`);
      const rows = await drive(tr, leftPathFor(side.sign), TOTAL);
      checkLeaveAndRejoin(name, rows, await stripLog(), await spoken(), { expectOffText: 'Off route', expectRejoin: true });
      const rer = (await stripLog()).some(l => /Rerouting/.test(l.text)); const says = (await spoken()).some(s => /Rerouting/.test(s.text));
      record(name, 'never requests a reroute', !rer && !says && routerHits.length === 0 ? 'PASS' : 'FAIL', `router requests: ${routerHits.length}; "Rerouting…" shown: ${rer}; "Rerouting" spoken: ${says}`);
    }

    // ---------- 2/3/4. planned route (request set): router fails / stub answers / real network
    for (const [name, mode] of [['planned, router unreachable', 'fail'], ['planned, stub router', 'stub'], ['planned, real network', 'real']]) {
      routerMode = mode; routerHits = []; routerDelayMs = mode === 'real' ? 0 : 600;
      const tr = await load();
      stubTrack = tr.lon.map((lo, i) => [lo, tr.lat[i]]);
      await cdp.eval(`apexDebug.track.request = { from: null, to: { lat: ${tr.lat[tr.lat.length - 1]}, lon: ${tr.lon[tr.lon.length - 1]} }, via: [] }`);
      const side = chooseSide(tr); chosenStart = side.startS; record(name, 'drift side chosen', 'INFO', `${side.sign > 0 ? 'left' : 'right'}, start ${side.startS} m along the route, closest approach to the route during the off phase ${side.min.toFixed(0)} m`);
      let rows, log, says;
      if (mode === 'fail') {
        rows = await drive(tr, leftPathFor(side.sign), TOTAL);
        log = await stripLog(); says = await spoken();
        const reqAt = routerHits[0] ? secs(routerHits[0].vt) : null;
        checkLeaveAndRejoin(name, rows, log, says, { expectOffText: 'Off route · no signal to reroute', expectRejoin: true });
        record(name, 'shows "Rerouting…" then "Off route · no signal to reroute"', log.some(l => /Rerouting/.test(l.text)) && log.some(l => /no signal to reroute/.test(l.text)) ? 'PASS' : 'FAIL',
          `router requests: ${routerHits.length} (first at ${reqAt} s, expected ${LEAVE + 5} s); the failed request's retry backoff is 20 s`);
      } else {
        // Drift until the monitor's reroute lands (a new track object), then drive the new route for 20 s.
        rows = []; const startS = driveStart(tr, TOTAL); const leftAt = leftPathFor(side.sign); let swappedK = null, k = 0;
        for (; k < LEAVE + 40; k++) {
          const p = pointAt(tr, startS + k * SPEED), o = offset(p, k < LEAVE ? 0 : leftAt(LEAVE + Math.min(k - LEAVE, OFF_S - 1)));
          const r = await feed(k, o.lat, o.lon, p.brg * 180 / Math.PI); rows.push(r);
          if (!r.orig) { swappedK = k; break; }
        }
        log = await stripLog(); says = await spoken();
        const sawRerouting = log.find(l => /Rerouting/.test(l.text));
        const off = firstK(rows, LEAVE, r => isConfirmedOff(r.strip));
        record(name, 'strip goes off route ~5 s after leaving, not before', off === LEAVE + 5 ? 'PASS' : 'FAIL', `first off-route strip at +${off == null ? 'never' : off - LEAVE} s ("${off == null ? '' : rows[off].strip}")`);
        record(name, 'shows "Rerouting…"', sawRerouting ? 'PASS' : 'FAIL', sawRerouting ? `at ${secs(sawRerouting.vt)} s; first router request at ${secs((routerHits[0] || {}).vt)} s` : 'never');
        record(name, 'router requests', routerHits.length >= 1 ? 'INFO' : 'FAIL', `${routerHits.length}: ${routerHits.map(h => h.url.replace(/https:\/\//, '').slice(0, 40)).join(' ; ')}`);
        if (swappedK == null) {
          const last = rows[rows.length - 1];
          if (mode === 'real') record(name, 'new route loaded from the real router', 'SKIP', `no new route within ${k - LEAVE} s of drifting (network/router unreachable or slow?); strip "${last.strip}"`);
          else record(name, 'new route loaded', 'FAIL', `no new route within ${k - LEAVE} s; strip "${last.strip}"`);
        } else {
          const nt = JSON.parse(await cdp.eval(`JSON.stringify({ id: apexDebug.track.id, lat: Array.from(apexDebug.track.lat), lon: Array.from(apexDebug.track.lon), dist: Array.from(apexDebug.track.dist), len: apexDebug.track.dist[apexDebug.track.dist.length-1] })`));
          const after = [];
          for (let j = 1; j <= 20; j++) { const p = pointAt(nt, Math.min(nt.len - 1, j * SPEED)); after.push(await feed(swappedK + j, p.lat, p.lon, p.brg * 180 / Math.PI)); }
          const logAfter = (await stripLog()).filter(l => secs(l.vt) >= swappedK - 1).map(l => `${secs(l.vt)}s "${l.text.slice(0, 40)}"`).join(' ; ');
          // The reroute is built from the fix at request time; the car moves on while it is fetched, so the first frame can sit
          // a few tens of metres off the new line ("Checking route…") until the next fix. One frame of grace, reported if used.
          const bad = after.slice(1).filter(r => isOffText(r.strip) || r.cursorIdx < 0);
          const graceUsed = after[0] && (isOffText(after[0].strip) || after[0].cursorIdx < 0) ? ` (grace frame k+1 showed "${after[0].strip}")` : '';
          record(name, 'new route loaded at', 'INFO', `+${swappedK - LEAVE} s after leaving (+${swappedK - LEAVE - 5} s after the request); new route ${(nt.len / 1000).toFixed(2)} km`);
          record(name, 'on the new route: notes return, no off-route text for 20 s (first frame excepted)', bad.length === 0 ? 'PASS' : 'FAIL', bad.length ? `${bad.length} bad frame(s): ${bad.map(b => `k+${b.k - swappedK} "${b.strip}" cursorIdx ${b.cursorIdx}`).join(' ; ')}; strip log from the swap: ${logAfter}` : `strip "${after[after.length - 1].strip.slice(0, 60)}"; cursorIdx ${after[after.length - 1].cursorIdx}${graceUsed}`);
          record(name, 'no further reroute request after the new route', routerHits.filter(h => /route/.test(h.url) && secs(h.vt) > secs(T0 + swappedK * 1000)).length === 0 ? 'PASS' : 'FAIL', `requests after swap: ${routerHits.filter(h => secs(h.vt) > swappedK).length} (incl. speed-limit lookups)`);
        }
      }
    }

    // ---------- 5. GPS jitter +-30 m around the route, planned request present
    {
      const name = 'jitter +-30 m';
      routerMode = 'fail'; routerHits = [];
      const tr = await load();
      await cdp.eval(`apexDebug.track.request = { from: null, to: { lat: ${tr.lat[tr.lat.length - 1]}, lon: ${tr.lon[tr.lon.length - 1]} }, via: [] }`);
      const rnd = lcg(7);
      const jit = Array.from({ length: 80 }, (_, k) => (k % 4 === 0 ? 30 : k % 4 === 2 ? -30 : (rnd() * 2 - 1) * 30));   // metres left of the track, extremes included
      const rows = await drive(tr, (k) => jit[k], 80);
      const log = await stripLog();
      const bad = rows.find(r => isOffText(r.strip)) || log.find(l => isOffText(l.text));
      record(name, '80 s of +-30 m jitter at 15 m/s never triggers off route', !bad && routerHits.length === 0 ? 'PASS' : 'FAIL', bad ? `off-route text "${bad.strip || bad.text}"` : `strip stayed "${rows[rows.length - 1].strip.slice(0, 50)}"; router requests ${routerHits.length}`);
    }

    // ---------- 6. A U-turn stays on the road but drops progress by 100 m.
    {
      const name = 'wrong way, stub router';
      routerMode = 'stub'; routerHits = []; routerDelayMs = 7000;
      const tr = await load();
      stubTrack = tr.lon.map((lo, i) => [lo, tr.lat[i]]);
      await cdp.eval(`apexDebug.track.request = { from: null, to: { lat: ${tr.lat.at(-1)}, lon: ${tr.lon.at(-1)} }, via: [] }`);
      // Use the same clear part of the selected road as the drift tests. Forty seconds forward
      // gives the monitor a stable best; 20 seconds backwards is enough to cross the threshold.
      const side = chooseSide(tr), startS = side.startS;
      const rows = [];
      for (let k = 0; k < 60; k++) {
        const s = startS + (k < 40 ? k : 80 - k) * SPEED;
        const p = pointAt(tr, s);
        rows.push(await feed(k, p.lat, p.lon, p.brg * 180 / Math.PI + (k < 40 ? 0 : 180)));
      }
      const forward = rows.slice(0, 40), reverse = rows.slice(40);
      const best = Math.max(...rows.slice(0, 41).map(r => r.matchedM)); // the U-turn fix is the farthest point
      const threshold = reverse.find(r => best - r.matchedM >= 100);
      const wrong = reverse.find(r => r.strip.includes('Wrong way'));
      const early = rows.find(r => r.k < 40 && isOffText(r.strip)) || reverse.find(r => best - r.matchedM < 100 && isOffText(r.strip));
      record(name, '40 s forward then U-turn at 15 m/s', !early && forward.every(r => r.cursorIdx >= 0) ? 'PASS' : 'FAIL',
        early ? `early off-route text at k=${early.k}: "${early.strip}"; best ${best.toFixed(0)} m` : `forward best ${best.toFixed(0)} m; reverse fixes ${reverse.length}`);
      record(name, 'Wrong way begins at 100 m lost progress, never before', threshold && wrong && wrong.k === threshold.k ? 'PASS' : 'FAIL',
        `threshold k=${threshold?.k ?? 'never'} (lost ${threshold ? (best - threshold.matchedM).toFixed(0) : '--'} m); first Wrong way k=${wrong?.k ?? 'never'}; first off-route text k=${early?.k ?? 'none'}`);
      const offRows = threshold ? reverse.filter(r => r.k >= threshold.k) : [];
      record(name, 'pace notes blank throughout wrong-way episode', offRows.length && offRows.every(r => r.notesBlank && r.cursorIdx < 0 && r.strip === 'Wrong way') ? 'PASS' : 'FAIL',
        `bad frames: ${offRows.filter(r => !r.notesBlank || r.cursorIdx >= 0 || r.strip !== 'Wrong way').map(r => `k=${r.k} "${r.strip}" cursor=${r.cursorIdx}`).join(' ; ') || 'none'}`);
      const routing = routerHits.filter(h => /\/route(?:\/|$)/.test(h.url));
      const says = (await spoken()).filter(s => /Rerouting/.test(s.text));
      record(name, 'exactly one reroute request for the episode', routing.length === 2 && says.length === 1 ? 'PASS' : 'FAIL',
        `router HTTP attempts ${routing.length} (Valhalla then OSRM stub), Rerouting spoken ${says.length}; request times ${routing.map(h => secs(h.vt)).join(', ')}`);
      routerDelayMs = 0;
    }
    }

    if (AS_JSON) console.log(JSON.stringify(results, null, 1));
    const failed = results.filter(r => r.status === 'FAIL').length;
    if (!AS_JSON) console.log(`\n${results.filter(r => r.status === 'PASS').length} pass, ${failed} fail, ${results.filter(r => r.status === 'SKIP').length} skipped`);
    cleanup();
    process.exit(failed ? 1 : 0);
  } catch (e) { console.error(e); cleanup(); process.exit(2); }
}
main();
