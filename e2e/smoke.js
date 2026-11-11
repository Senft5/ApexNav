// End-to-end smoke tests of the web app's main flows in headless Chromium (docs/IDEAS.md Y-11).
// Serves web/ itself and blocks every other host, so a run needs no network and a third-party outage can't fail it;
// the app must still boot without its map tiles, routers and fonts. Any uncaught page error fails the flow.
//   node e2e/smoke.js            (needs the `playwright` package and its Chromium; CI installs both)
const http = require('http');
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
// BROWSER=webkit runs the flows in Safari's engine (the iOS app is a WKWebView); chromium by default, as CI runs
const chromium = playwright[process.env.BROWSER || 'chromium'];

const WEB = path.resolve(__dirname, '..', 'web');
// The private themes' looks (migration 0044): the server sends them in /api/me only to a granted account; the stubs below do the same
const PRIVATE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'backend', 'src', 'private_themes.json'), 'utf8'));
const PRIVATE_IDS = Object.keys(PRIVATE);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };

// Our own routing's graph tiles (docs/OWN_ROUTING.md): a flow can serve synthetic ones (graphDir, written by
// tests/graph_fixture.py with the real writer); with none here, an empty index, as a build without tiles answers.
let graphDir = null;
const GRAPH = 'data/graph/v1/';
function graphFixture(motorway = false) {
  const key = motorway ? 'motorwayDir' : 'dir';
  if (graphFixture[key]) return graphFixture[key];
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vetta-graph-'));
  // motorway: the same grid with its arterials as motorways (tests/graph_fixture.py)
  require('child_process').execFileSync('python3', [path.resolve(__dirname, '..', 'tests', 'graph_fixture.py'), dir, ...(motorway ? ['3', '30', '30', '0.004', '39.15', '-84.62', '1'] : [])]);
  return (graphFixture[key] = dir);
}

function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch (_) { res.writeHead(400); res.end(); return; }
    if (rel.startsWith(GRAPH) && (graphDir || !fs.existsSync(path.resolve(WEB, rel)))) {
      const f = graphDir && graphDir !== 'none' ? path.join(graphDir, path.basename(rel)) : null;   // 'none': a build without tiles
      if (f && fs.existsSync(f)) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); return; }
      if (rel === GRAPH + 'index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"tiles":{}}'); return; }
    }
    // the Worker's region routes (backend/src/graph.ts, context_grid.ts): offline here, as on a phone with no region yet
    if (rel === 'api/graph/v1/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"version":3,"build":"none","tiles":{}}'); return; }
    if (rel === 'api/ctx/v1/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"v":1,"bundles":{}}'); return; }
    if (rel.startsWith('api/graph/') || rel.startsWith('api/ctx/')) { res.writeHead(404); res.end(); return; }
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
// F-04 (REVIEW_FEEL): the end card is up at once and gets its score when the analysis worker has parsed and saved the drive
const scoredCard = (page, timeout = 20000) => page.waitForFunction(() => { const s = document.getElementById('endScore'); return s && !s.hasAttribute('aria-busy'); }, null, { timeout });
const flow = (name, fn, ctxOpts = {}) => flows.push({ name, fn, ctxOpts });
function check(cond, msg) { if (!cond) throw new Error(msg); }
// A sheet that slides up (.overlay.dim, sheet-up 0.2 s) is open and at rest: shown, nothing in it still animating, and in
// the same place two frames running. Click a key in it only after this: on a slow runner a click aimed while it slid
// landed where the key had been, on the dimmed backdrop, and the backdrop closes the sheet (CI, 2026-11-10: "a pin has a
// name" found the spot dialog shut with its stars untouched; "Location off" likewise).
async function sheetSettled(page, id) {
  // One evaluate that loops (page.evaluate awaits its promise; a waitForFunction predicate that is async does not wait:
  // its promise is truthy at once, which is how this once returned with the sheet still at the bottom of its slide).
  const ok = await page.evaluate(async (id) => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const end = performance.now() + 10000;
    while (performance.now() < end) {
      const o = document.getElementById(id);
      if (o && o.classList.contains('show') && !o.getAnimations({ subtree: true }).some((a) => a.playState === 'running' || a.playState === 'pending')) {
        const top = () => (o.firstElementChild || o).getBoundingClientRect().top, a = top();
        await frames();
        if (o.classList.contains('show') && top() === a) return true;
      } else await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }, id);
  check(ok, `the ${id} sheet is open and at rest`);
}
// A car's own cluster (instruments.js carGauge): nothing printed on it overlaps. In each gauge's own units, every word and
// numeral (its inked glyphs, measured), every tick, the hubs and the lamp, and each needle lying at rest (a needle that reads
// moves over the face, as a real one does). Returns the clashes as "gauge: a / b".
const GAUGE_CLASH = (root) => `(() => {
  const out = [], cv = document.createElement('canvas').getContext('2d');
  const inBox = (b, x, y) => x > b.x0 + 0.5 && x < b.x1 - 0.5 && y > b.y0 + 0.5 && y < b.y1 - 0.5;
  const seg = (x1, y1, x2, y2, n = 24) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
  [...document.querySelectorAll('${root} svg.car-gauge')].forEach((s, si) => {
    const name = (s.closest('.tp-g') ? 'card ' : '') + s.getAttribute('class').split(' ').pop() + si;
    const texts = [], ticks = [], rounds = [], rests = [];
    for (const t of s.querySelectorAll('text')) {
      const cs = getComputedStyle(t);
      if (!t.getClientRects().length || cs.display === 'none') continue;
      cv.font = cs.fontWeight + ' ' + parseFloat(cs.fontSize) + 'px ' + cs.fontFamily; cv.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      const spans = t.querySelectorAll('tspan').length ? [...t.querySelectorAll('tspan')] : [t];
      let y = parseFloat(t.getAttribute('y'));
      for (const l of spans) {
        if (l !== t) y += parseFloat(l.getAttribute('dy') || 0);
        const txt = l.textContent; if (!txt.trim()) continue;
        const m = cv.measureText(txt), tl = l === t && t.getAttribute('textLength'), w = tl ? Math.min(m.width, parseFloat(tl)) : m.width;
        const x = parseFloat(l.getAttribute('x') || t.getAttribute('x')), a = cs.textAnchor, x0 = a === 'middle' ? x - w / 2 : a === 'end' ? x - w : x;
        texts.push({ k: txt.trim(), x0, x1: x0 + w, y0: y - m.actualBoundingBoxAscent, y1: y + m.actualBoundingBoxDescent });
      }
    }
    for (const l of s.querySelectorAll('.car-scale line')) ticks.push(['x1', 'y1', 'x2', 'y2'].map((k) => parseFloat(l.getAttribute(k))));
    for (const c of s.querySelectorAll('.car-hub, .car-lamp')) rounds.push({ k: c.getAttribute('class'), x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') });
    for (const g of s.querySelectorAll('.car-needle')) {
      if (g.style.opacity !== '0.25') continue;
      const m = /rotate\\(([-\\d.]+) ([-\\d.]+) ([-\\d.]+)\\)/.exec(g.getAttribute('transform') || ''); if (!m) continue;
      const [a, cx, cy] = m.slice(1).map(Number), b = g.firstChild.getBBox(), r = a * Math.PI / 180;
      const rot = (x, y) => [cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r), cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r)];
      rests.push({ pts: seg(...rot(cx, b.y + b.height), ...rot(cx, b.y), 40).filter(([x, y]) => Math.hypot(x - cx, y - cy) > 14) });
    }
    for (let i = 0; i < texts.length; i++) {
      const A = texts[i];
      for (let j = i + 1; j < texts.length; j++) { const B = texts[j]; if (Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 0.5 && Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > 0.5) out.push(name + ': ' + A.k + ' / ' + B.k); }
      if (ticks.some((t) => seg(...t, 8).some(([x, y]) => inBox(A, x, y)))) out.push(name + ': ' + A.k + ' / a tick');
      for (const c of rounds) { const nx = Math.max(A.x0, Math.min(c.x, A.x1)), ny = Math.max(A.y0, Math.min(c.y, A.y1)); if (Math.hypot(nx - c.x, ny - c.y) < c.r - 0.5) out.push(name + ': ' + A.k + ' / ' + c.k); }
      if (rests.some((n) => n.pts.some(([x, y]) => inBox(A, x, y)))) out.push(name + ': ' + A.k + ' / a needle at rest');
    }
    for (const c of rounds) if (/lamp/.test(c.k) && rests.some((n) => n.pts.some(([x, y]) => Math.hypot(x - c.x, y - c.y) < c.r))) out.push(name + ': the lamp / a needle at rest');
  });
  return out;
})()`;
// REVIEW5 §2: a setting lives behind the Garage's one gear; open its sheet as a driver does (the Garage open): the gear, then its row
// Text a driver could read, or a screen reader say, that is a value the code failed to format: in every open page of the flow.
async function leftovers(page) {
  const out = [];
  for (const p of page.context().pages()) {
    if (p.isClosed()) continue;
    const found = await p.evaluate(() => {
      const BAD = /\[object [A-Za-z]+\]|\bundefined\b|\bNaN\b/;
      const shown = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (n.hidden || n.getAttribute('aria-hidden') === 'true') return false; }
        const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && el.getClientRects().length > 0; };
      const hits = [], where = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        const el = t.parentElement;
        if (!el || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName) || !BAD.test(t.nodeValue) || !shown(el)) continue;
        hits.push(`${where(el)}: "${t.nodeValue.trim().slice(0, 80)}"`);
      }
      for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
        for (const a of ['aria-label', 'placeholder', 'title', 'alt']) { const v = el.getAttribute(a); if (v && BAD.test(v) && shown(el)) hits.push(`${where(el)} ${a}="${v.slice(0, 80)}"`); }
      }
      return hits.slice(0, 8);
    }).catch(() => []);
    out.push(...found);
  }
  return out;
}

async function openSetting(page, key) {
  await page.click('#garageGear');
  await page.click(`#garageSettings .nav-row[data-setting="${key}"]`);
  await page.waitForSelector(`.garage-pop.open[data-setting="${key}"]`);
  await page.waitForTimeout(250);                                    // the sheet's slide
}

// A driving frame like the iOS shell pushes every 0.1 s (ApexNavApp.swift pushLiveFrame).
// a message the app gave: in a drive it is the status line's (REVIEW4 U-74 / U-102, its whole text in dsNote's label), else a toast
const saidOn = (page, re, opts) => page.waitForFunction((src) => { const r = new RegExp(src), n = document.getElementById('dsNote');
  return r.test(document.getElementById('toast').textContent) || r.test((n && n.getAttribute('aria-label')) || ''); }, re.source, opts);
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

flow('the strip never cuts where the meaning is: a three-word call keeps its direction, the welcome loop reads whole (REVIEW4 U-92, U-105)', async (page, base) => {
  await page.goto(base + '/index.html');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  // the welcome's demo strip: every lead call of the loop whole (it cut "LEFT HAIRP…")
  const seen = new Map();
  for (let k = 0; k < 6; k++) {
    const r = await page.evaluate(() => { const s = document.querySelector('#obNotes .rb-box.now .rb-call span');
      return s ? { text: s.textContent, cut: s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1 } : null; });
    if (r) seen.set(r.text, r.cut);
    await page.waitForTimeout(1850);
  }
  check(seen.size >= 4 && [...seen.values()].every((c) => !c), 'the welcome loop reads whole: ' + JSON.stringify([...seen]));
  // REVIEW5 U-107: the welcome's next cells print codes, whole ("CR…" was the crest), and a call's head sits on one line
  // ("RIGHT / 3" wrapped where "LEFT 2" fit); U-133: the strip keeps one height through the loop
  const ob = { codes: new Set(), wrapped: [], heights: new Set() };
  for (let k = 0; k < 6; k++) {
    const r = await page.evaluate(() => { const el = document.getElementById('obNotes'), h = el.querySelector('.rb-box.now .rb-call span'), fs = h && parseFloat(getComputedStyle(h).fontSize);
      return { codes: [...el.querySelectorAll('.rb-code')].filter((c) => c.getClientRects().length).map((c) => ({ t: c.textContent, cut: c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > el.getBoundingClientRect().right + 1 })),
        head: h && h.textContent, lines: h ? Math.round(h.getBoundingClientRect().height / (fs * 1.05)) : 0, words: !!el.querySelector('.rb-box:not(.now) .rb-call'), h: Math.round(el.getBoundingClientRect().height) }; });
    r.codes.forEach((c) => ob.codes.add(c.t + (c.cut ? ' CUT' : '')));
    if (r.lines > 2 || r.words) ob.wrapped.push(r);   // plain words (panel M-1): "MEDIUM / RIGHT", two whole words, never a cut one
    ob.heights.add(r.h);
    await page.waitForTimeout(1850);
  }
  // P-2 / M-3 (panel round 1): a new driver gets plain words, so the next cells are plain words too ("OPEN L", "CREST"), never "L4"
  check(ob.codes.size >= 3 && [...ob.codes].every((t) => /^(?:[A-Z]{3,7} [LR]|CREST)$/.test(t)), 'the welcome\'s next cells are whole plain-word codes: ' + JSON.stringify([...ob.codes]));
  check(!ob.wrapped.length && ob.heights.size === 1, 'the welcome\'s heads in two lines at most, no words in a next cell, one height: ' + JSON.stringify({ w: ob.wrapped, h: [...ob.heights] }));
  // the plain words a sharp corner gets, at the lead's size, in every theme on the narrowest phone: nothing cut
  await page.setViewportSize({ width: 375, height: 667 });
  for (const theme of ['roadbook', 'tapedeck', 'billet']) {
    const r = await page.evaluate((theme) => {
      const look = ApexThemes.apply(theme, false), el = document.getElementById('notes'), out = [];
      for (const [call, mods] of [['Slow right down, hairpin left, long', ['long']], ['Careful, medium right, tightens, slopes away', ['tightens', 'off-camber']], ['Square left', []]]) {
        ApexInstruments.renderNotes(el, look.theme, [{ key: call, type: 'corner', dir: call.includes('left') ? 'L' : 'R', severity: 1, mods, call, code: 'L1', dist: '400', unit: 'FT', distM: 120 }]);
        const cut = (x) => !!x && (x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth + 1);
        const head = el.querySelector('.rb-box.now .rb-call span'), tail = el.querySelector('.rb-box.now .rb-mods');
        out.push({ head: head.textContent, cut: cut(head) || cut(tail), px: parseFloat(getComputedStyle(head).fontSize) });
      }
      return out;
    }, theme);
    check(r.every((x) => !x.cut && x.px >= 21), `${theme}: the lead call whole at 21 px or more: ` + JSON.stringify(r));
    // U-100: the quiet line in two rows at most, its compact form when the full one needs a third (Tapedeck's wide font)
    const q = await page.evaluate((theme) => {
      const look = ApexThemes.apply(theme, false), el = document.getElementById('notes'), n = [];
      n.quietText = 'Quiet · Northwest Expressway · next corner 0.7 mi'; n.quietShort = 'Quiet · Northwest Expy · corner 0.7 mi';
      ApexInstruments.renderNotes(el, look.theme, n);
      const sp = el.querySelector('.note-quiet span'), fs = parseFloat(getComputedStyle(sp).fontSize);
      return { text: sp.textContent, rows: Math.round(sp.clientHeight / (fs * 1.2)), cut: sp.scrollHeight > sp.clientHeight + 1, fs };
    }, theme);
    check(!q.cut && q.rows <= 2 && q.fs >= 13, `${theme}: the quiet line in two rows, whole: ` + JSON.stringify(q));
  }
});

// Location off (2026-11-10): the app never said it. A drive sat on "Finding GPS…" for ever, and in a browser the sheet said
// "Location is off. Settings → …" twice over a greyed-out key, and Just drive went grey with no word.
flow('Location off, in the app: Just drive says so once and opens Settings, and the sheet goes away by itself when Location comes on', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.__posted = []; window.webkit = { messageHandlers: { apex: { postMessage(m) { window.__posted.push(m); } } } }; });
  await page.route(base + '/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed_out"}' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function' && window.apexDebug && window.apexDebug.map);
  await page.evaluate(() => window.apex.live({ has_fix: false, location_off: true, thermal: 0 }));
  const key = await page.evaluate(() => { const b = document.getElementById('startDrive'); return { disabled: b.disabled, text: b.textContent.trim() }; });
  check(!key.disabled && key.text === 'Just drive', 'Just drive stays a key (never greyed out without a word): ' + JSON.stringify(key));
  await page.evaluate(() => document.getElementById('startDrive').click());
  await page.waitForSelector('#permSheet.show');
  const off = await page.evaluate(() => { const s = document.getElementById('permSheet'), go = document.getElementById('permGo');
    return { title: document.getElementById('permTitle').textContent, label: s.getAttribute('aria-label'), text: s.innerText, go: go.textContent, goDisabled: go.disabled,
      rows: getComputedStyle(s.querySelector('.perm')).display, mode: window.apexDebug.state.mode }; });
  check(off.title === 'Location is off' && off.label === 'Location is off' && off.rows === 'none' && off.mode !== 'live', 'the sheet is "Location is off", the first-drive list put away, no drive started: ' + JSON.stringify(off));
  check((off.text.match(/In Settings, set Location to While Using the App\./g) || []).length === 1 && (off.text.match(/Location is off/g) || []).length === 1, 'it is said once, with the way back: ' + JSON.stringify(off.text));
  check(off.go === 'Open Settings' && !off.goDisabled, 'the key is Open Settings, alive: ' + JSON.stringify(off));
  await page.evaluate(() => document.getElementById('permGo').click());
  check(await page.evaluate(() => window.__posted.some((m) => m && m.cmd === 'openSettings')) && await page.isVisible('#permSheet.show'), 'the key asks the app for Settings; the sheet waits');
  // back from Settings with Location on: the next frame says so, the sheet goes by itself and a drive starts as ever
  await page.evaluate(() => window.apex.live({ has_fix: true, location_off: false, lat: 35.96, lon: -83.92, accuracy_m: 5, speed_mps: 0, course_deg: 0, calibration: 'locked', thermal: 0 }));
  await page.waitForFunction(() => !document.getElementById('permSheet').classList.contains('show'), null, { timeout: 3000 }).catch(() => {});
  check(!(await page.isVisible('#permSheet.show')), 'the sheet closes itself once Location is on');
  await page.evaluate(() => document.getElementById('startDrive').click());
  await page.waitForFunction(() => window.apexDebug.state.mode === 'live', null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => window.apexDebug.state.mode === 'live'), 'and Just drive starts the drive');
  // turned off mid-drive (left for Settings and came back): the drive's line says it, once, with the way back
  await page.evaluate(() => window.apex.live({ has_fix: false, location_off: true, thermal: 0 }));
  const line = await page.evaluate(() => document.getElementById('dsMain').textContent + ' | ' + document.getElementById('dsWarn').textContent);
  check(/^Location is off/.test(line) && /\| Settings → Vetta → Location → Allow$/.test(line) && (line.match(/Location is off/g) || []).length === 1, 'a drive with Location turned off says so, not "Finding GPS": ' + line);
});

flow('Location off, in a browser: the sheet says it once and its key tries again; nothing is greyed out', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.__geo = 0; const deny = (ok, err) => { window.__geo++; setTimeout(() => err && err({ code: 1, message: 'denied' }), 0); return 1; };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: deny, getCurrentPosition: deny, clearWatch() {} } }); });
  await page.route(base + '/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed_out"}' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && window.apexDebug && window.apexDebug.map);
  await page.evaluate(() => document.getElementById('startDrive').click());
  await page.waitForSelector('#permSheet.show.loc-off', { timeout: 8000 }).catch(() => {});
  const off = await page.evaluate(() => { const s = document.getElementById('permSheet'), go = document.getElementById('permGo');
    return { title: document.getElementById('permTitle').textContent, text: s.innerText, go: go.textContent, goDisabled: go.disabled, mode: window.apexDebug.state.mode, start: document.getElementById('startDrive').disabled }; });
  check(off.title === 'Location is off' && (off.text.match(/Settings → Safari → Location → Allow/g) || []).length === 1 && (off.text.match(/Location is off/g) || []).length === 1 && off.mode !== 'live',
    'a browser that says no gets the sheet, said once: ' + JSON.stringify(off));
  check(off.go === 'Try again' && !off.goDisabled && !off.start, 'its key is Try again, alive, and Just drive is not greyed out: ' + JSON.stringify(off));
  const before = await page.evaluate(() => window.__geo);
  await page.evaluate(() => document.getElementById('permGo').click());
  await page.waitForFunction((n) => window.__geo > n && document.getElementById('permSheet').classList.contains('show'), before, { timeout: 8000 }).catch(() => {});
  check(await page.evaluate((n) => window.__geo > n, before) && await page.isVisible('#permSheet.show.loc-off'), 'Try again asks the browser again, and the sheet comes back while it still says no');
  await sheetSettled(page, 'permSheet');                          // Try again brought it back: at rest before the next key
  check((await page.textContent('#permNo')).trim() === 'Not now', 'the sheet\'s other key is Not now');
  await page.click('#permNo');
  await page.waitForFunction(() => !document.getElementById('permSheet').classList.contains('show'), null, { timeout: 3000 }).catch(() => {});
  check(!(await page.isVisible('#permSheet.show')), 'Not now puts it away');
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

flow('standing still, the map sleeps: the follow camera stops moving it once settled, and wakes for a new fix or a moved map (perf, 2026-10-30)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function' && window.apexDebug && window.apexDebug.map);
  await page.evaluate(() => { const m = window.apexDebug.map, j = m.jumpTo.bind(m); window.__jumps = 0; m.jumpTo = (o) => { window.__jumps++; return j(o); }; });
  const still = { lat: 35.96, lon: -83.92, accuracy_m: 5, speed_mps: 0, course_deg: 0, has_fix: true, calibration: 'locked' };
  const jumpsOver = (ms, feed) => page.evaluate(async ([ms, feed]) => {
    window.__jumps = 0; const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (feed) window.apex.live(feed); await new Promise(r => setTimeout(r, 100)); }
    return window.__jumps;
  }, [ms, feed]);
  await jumpsOver(4000, still);                                        // the springs settle on the fix
  const asleep = await jumpsOver(1500, still);
  check(asleep === 0, `a settled camera leaves the map alone (moved it ${asleep} times in 1.5 s)`);
  const woke = await jumpsOver(600, { ...still, lat: 35.9605 });       // 55 m on: the camera follows again
  check(woke > 3, `a new fix moves the camera (${woke})`);
  await jumpsOver(4000, { ...still, lat: 35.9605 });
  // something else moves the map while following (counted from that moment): the camera takes it back
  const back = await page.evaluate(async () => {
    window.__jumps = 0; window.apexDebug.map.setZoom(12);
    await new Promise(r => setTimeout(r, 300));
    return { moves: window.__jumps, zoom: window.apexDebug.map.getZoom() };
  });
  check(back.moves > 0 && back.zoom > 15, `the follow camera takes the map back (${JSON.stringify(back)})`);
  // the strip: the same notes leave its page as it is; a new distance rewrites only the number
  const same = await page.evaluate(() => {
    const el = document.createElement('div'); document.body.append(el);
    const theme = { notes: 'roadbook' }, n = (dist) => [{ key: 'c1', type: 'corner', code: 'L3', call: 'Left 3', sub: '', dist, unit: 'FT', distM: 100, dir: 'L', severity: 3, mods: [] }];
    ApexInstruments.renderNotes(el, theme, n('400'));
    const box = el.firstChild;
    ApexInstruments.renderNotes(el, theme, n('400'));
    const kept = el.firstChild === box;
    ApexInstruments.renderNotes(el, theme, n('350'));
    return { kept, keptOnDist: el.firstChild === box, dist: el.querySelector('.rb-dist b').textContent };
  });
  check(same.kept && same.keptOnDist && same.dist === '350', `the strip is rewritten in place (${JSON.stringify(same)})`);
});

flow('the map is a fixed stage: tabs, sheets and the drive never resize it; a drive draws at 2x without contours at speed (REVIEW_FEEL F-02, F-05, F-14)', async (page, base) => {
  // a style with one of the labels a drive hides at speed (the real one has more; see AT_SPEED_HIDE)
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: { n: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }, { id: 'highway-name-minor', type: 'symbol', source: 'n', layout: {} }] }) })
    : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getLayer('apex-contours'), null, { timeout: 15000 });
  await page.evaluate(() => { window.__resizes = 0; window.apexDebug.map.on('resize', () => { window.__resizes++; }); });
  const canvas = () => page.evaluate(() => { const c = window.apexDebug.map.getCanvas(); return `${c.width}x${c.height}`; });
  const before = await canvas();
  check(before === '1170x2532', `the idle map is full-bleed at the screen's 3x (${before})`);
  // every tab and sheet, there and back
  for (const v of ['people', 'garage', 'map', 'people', 'map']) { await page.click(`#tabbar .tab[data-view="${v}"]`); await page.waitForTimeout(250); }
  await page.click('#destInput'); await page.waitForTimeout(400);
  await page.click('#planCancel'); await page.waitForTimeout(400);
  await page.click('#tabbar .tab[data-view="log"]'); await page.waitForFunction(() => document.documentElement.classList.contains('log-open'));
  await page.evaluate(() => window.ApexLogHost.close('map')); await page.waitForTimeout(400);
  const idle = await page.evaluate(() => window.__resizes);
  check(idle === 0 && await canvas() === before, `no tab or sheet resizes the map (${idle} resizes, ${await canvas()})`);
  // a drive at speed: one resize at its start (2x pixels, the map ending under its chrome), none after
  const fix = (i, v) => ({ lat: 35.96 + i * 1.2e-5, lon: -83.92, accuracy_m: 5, speed_mps: v, course_deg: 0, has_fix: true, calibration: 'locked', recording: true, lat_g: 0.1, lon_g: 0 });
  const feed = (from, n, v) => page.evaluate(async ([from, n, v, f]) => { const mk = new Function('i', 'v', `return (${f})(i, v)`);
    for (let i = from; i < from + n; i++) { window.apex.live(mk(i, v)); await new Promise((r) => setTimeout(r, 100)); } }, [from, n, v, fix.toString()]);
  await feed(0, 20, 14);
  await page.waitForFunction(() => window.apexDebug.state.mode === 'live');
  const start = await page.evaluate(() => { const m = window.apexDebug.map; return { dpr: m.getPixelRatio(), resizes: window.__resizes,
    contours: m.getLayoutProperty('apex-contours', 'visibility'), labels: m.getLayer('apex-contour-labels') ? m.getLayoutProperty('apex-contour-labels', 'visibility') : 'none',   // (no glyphs in this style: no label layer)
    minor: m.getLayoutProperty('highway-name-minor', 'visibility'), hillshade: m.getLayoutProperty('apex-hillshade', 'visibility') || 'visible',
    px: m.getCanvas().width * m.getCanvas().height }; });
    check(start.dpr === 2, `a drive draws at 2x pixels (${start.dpr})`);
  check(start.resizes === 1, `the drive's start is one resize (its pixels and its edges together): ${start.resizes}`);
  check(start.contours === 'none' && start.labels === 'none' && start.minor === 'none' && start.hillshade === 'visible',
    `at speed the contours and minor labels go, the hillshade stays (${JSON.stringify(start)})`);
  check(start.px <= 0.45 * 1170 * 2532, `the drive's canvas is under half the idle one's pixels (${start.px})`);
  await page.evaluate(() => { window.__resizes = 0; });
  await feed(20, 30, 20);                                              // the strip and the status line change; the map does not
  await feed(50, 45, 0);                                               // stopped for over 3 s: the contours come back
  const stopped = await page.evaluate(() => ({ resizes: window.__resizes, contours: window.apexDebug.map.getLayoutProperty('apex-contours', 'visibility'), dpr: window.apexDebug.map.getPixelRatio() }));
  check(stopped.resizes === 0, `no resize in the drive (${stopped.resizes})`);
  check(stopped.contours === 'visible' && stopped.dpr === 2, `stopped, the contours are back; still 2x in the drive (${JSON.stringify(stopped)})`);
  // F-14: a replay at 8x, its strip and gauges changing every frame, never resizes the map either
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.state.playing && window.apexDebug.state.cursorM > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__resizes = 0; window.apexDebug.map.on('resize', () => { window.__resizes++; }); document.querySelector('#rateDetents [data-rate="8"]').click(); });
  await page.waitForTimeout(3000);
  const replay = await page.evaluate(() => ({ resizes: window.__resizes, playing: window.apexDebug.state.playing, dpr: window.apexDebug.map.getPixelRatio() }));
  check(replay.playing && replay.resizes === 0, `no resize in a replay (${JSON.stringify(replay)})`);
}, { deviceScaleFactor: 3 });

flow('a replay opens on its trail and says when it has finished (REVIEW5 U-110, U-128)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 20000 });
  // U-128: by the time the clock starts the trail is on the map; while it waits the strip names the drive, never a roadless quiet line
  await page.waitForFunction(() => window.apexDebug.state.playing, null, { timeout: 20000 });
  const first = await page.evaluate(() => { const src = window.apexDebug.map.getSource('apex-route-src'), data = src ? src._data : null;
    return { loaded: !!src, trail: !!(data && data.features && data.features.length) }; });
  // (this server blocks the map's tiles and style, so the map may never load here: then the clock starts after the wait)
  check(!first.loaded || first.trail, 'the trail is drawn before the first tick: ' + JSON.stringify(first));
  // U-110: run it to its end
  await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] - 20; });
  await page.waitForFunction(() => !window.apexDebug.state.playing, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => ({ plate: document.getElementById('modePlate').textContent, strip: document.getElementById('notes').textContent,
    play: document.querySelector('#playBtn span').textContent, again: document.getElementById('playBtn').classList.contains('again'),
    speed: (document.querySelector('.dial-digital') || {}).textContent, sight: (document.querySelector('.ro-sight b') || {}).textContent }));
  check(/^Replay finished/.test(end.plate) && /That.s the drive/.test(end.strip) && end.play === 'Again' && end.again, 'the replay says it finished: ' + JSON.stringify(end));
  check(end.speed === '0' && (end.sight == null || end.sight === '--'), 'the dial at rest and Sight -- (U-130): ' + JSON.stringify(end));
  // Again plays it from the start, and the finished state goes
  await page.click('#playBtn');
  await page.waitForFunction(() => window.apexDebug.state.playing && !document.getElementById('playBtn').classList.contains('again'), null, { timeout: 5000 });
  check(!/finished/.test(await page.textContent('#modePlate')), 'Again clears the finished plate');
});

flow('a hot phone turns the battery saver on and back off', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate((f) => window.apex.live(f), frame(0, { thermal: 3 }));
  await saidOn(page, /saving battery/);
  await page.evaluate((f) => window.apex.live(f), frame(1, { thermal: 0 }));
  // the frames put up the drive screen, so this one is said in its status line, not as a toast over the map (REVIEW4 U-102)
  await page.waitForFunction(() => /Full map detail/.test(document.getElementById('dsNote').getAttribute('aria-label') || ''));
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
  // stopped at the start, still calibrating: the drive opens with the road's name (panel round 2 DA-3), then the first
  // corner, before the car moves
  for (let k = 0; k < 10; k++) { await at(0, 0, 'default'); await page.waitForTimeout(100); }
  const first = await page.evaluate(() => window.__said.filter((s) => !/^\[chime/.test(s)));
  check(first.length >= 2 && first[0] === 'Test Ridge Road. Full notes.' && /right/i.test(first[1]), 'the drive opens with the road, then its first corner: ' + JSON.stringify(first));
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
  // U-100: Kit's line was about the corner the strip has moved on from: it clears rather than reading stale
  check(await page.evaluate(() => apexDebug.state.kitLine) === null, 'Kit falls quiet once the strip moves on: ' + await page.evaluate(() => apexDebug.state.kitLine));
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
  // panel round 2 LA-4 / MA-1: going quiet is the falling chime once, with how far the quiet lasts when that is known
  check(said.filter((s) => s === '[chime: sleep]').length === 1 && !said.includes('Quiet from here. Bumps and cameras only.')
    && said.filter((s) => /^Quiet for /.test(s)).length <= 1, 'going quiet is a chime, once: ' + JSON.stringify(said));
  check(!said.includes('Full notes.'), 'the drive began awake, so it never said the notes came on: ' + JSON.stringify(said));
});

flow('a route that doubles back on its own road: no "Wrong way", no "Back on route", the cursor follows it past the turnaround (REVIEW4 U-90)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__said = []; window.APEX_REVIEW = true;
    window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'said') window.__said.push(m.text); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport && window.apex && window.apex.live);
  // the review drive's shape: 1.5 km east, a V turnaround, 1.2 km back west along the same road (6 m over), then a left
  // turn away south. Handed to the page as a GPX, as the recording does.
  const KY = 110540, KX = 111320 * Math.cos(35.5 * Math.PI / 180), pts = [];
  for (let x = 0; x <= 1500; x += 5) pts.push([0, x]);
  pts.push([-3, 1520], [-6, 1500]);
  for (let x = 1495; x >= 300; x -= 5) pts.push([-6, x]);
  for (let a = 5; a <= 90; a += 5) { const r = a * Math.PI / 180; pts.push([-31 + 25 * Math.cos(r), 300 - 25 * Math.sin(r)]); }
  for (let y = 35; y <= 600; y += 5) pts.push([-y, 275]);
  const gpx = pts.map(([n, e]) => `<trkpt lat="${(35.5 + n / KY).toFixed(7)}" lon="${(-83.9 + e / KX).toFixed(7)}"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'outback.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Out and back</name><trkseg>${gpx}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Out and back', null, { timeout: 10000 });
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start' }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  // drive it at 15 m/s with GPS noise (a fixed +-4 m wobble), the course from the road, every fix 15 m on
  const n = await page.evaluate(() => apexDebug.track.lat.length);
  const strips = new Set(), cursor = [];
  for (let i = 0, k = 0; i < n - 1; i += 3, k++) {
    const c = await page.evaluate(([i, k]) => { const t = apexDebug.track, a = Math.max(0, i - 2), b = Math.min(t.lat.length - 1, i + 2);
      const crs = (Math.atan2((t.lon[b] - t.lon[a]) * Math.cos(t.lat[i] * Math.PI / 180), t.lat[b] - t.lat[a]) * 180 / Math.PI + 360) % 360;
      const wob = [3, -4, 1, -2, 4, -3, 2, 0][k % 8] / 110540;
      window.apex.live({ lat: t.lat[i] + wob, lon: t.lon[i] - wob, accuracy_m: 6, speed_mps: 15, course_deg: crs, has_fix: true, lat_g: 0, lon_g: 0, calibration: 'locked', thermal: 0 });
      return apexDebug.state.cursorM; }, [i, k]);
    await page.waitForTimeout(40);
    cursor.push(c);
    strips.add(await page.textContent('#notes'));
  }
  const said = await page.evaluate(() => window.__said.slice());
  check(!said.some((s) => /Back on route|Wrong way|Rerouting/.test(s)), 'nothing said about the route: ' + JSON.stringify(said));
  check(![...strips].some((s) => /Wrong way|Off route/.test(s)), 'the strip never reads off route: ' + [...strips].filter((s) => /Wrong way|Off route/.test(s)).join(' | '));
  const total = await page.evaluate(() => apexDebug.track.dist[apexDebug.track.dist.length - 1]);
  let fell = 0; for (let j = 1; j < cursor.length; j++) fell = Math.max(fell, cursor[j - 1] - cursor[j]);
  check(fell < 30 && cursor[cursor.length - 1] > total - 40, `the cursor follows the route past the turnaround (fell ${Math.round(fell)} m, ended ${Math.round(cursor[cursor.length - 1])} of ${Math.round(total)})`);
});

flow('for this drive (route context): Passenger aboard and the rest are ✓ stamps under Prefer in Options, kept on the phone, the providers registered; Loop to fit is app-only', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?view=route');
  await page.waitForSelector('#planPanel.open');
  await page.click('#planOptionsChip');                                // the plan flow: Options is one bottom sheet
  await page.waitForSelector('#optSheet.open [data-driver="passenger"]');
  const before = await page.evaluate(() => [...document.querySelectorAll('[data-driver]')].map((b) => [b.dataset.driver, b.textContent, b.getAttribute('aria-pressed')]));
  check(JSON.stringify(before) === JSON.stringify([['passenger', 'Passenger aboard', 'false'], ['lit', 'Lit roads at night', 'false'], ['cyclists', 'Cyclist courtesy', 'false'], ['tunnels', 'Tunnels', 'false']]),
    'four stamps, all off by default: ' + JSON.stringify(before));
  await page.click('[data-driver="passenger"]');
  await page.click('[data-driver="tunnels"]');
  await page.waitForFunction(() => document.querySelector('[data-driver="passenger"]').getAttribute('aria-pressed') === 'true');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.driverPrefs')));
  check(kept.passenger === true && kept.tunnels === true && kept.lit === false && kept.cyclists === false, 'kept on the phone: ' + JSON.stringify(kept));
  await page.click('[data-driver="tunnels"]');
  await page.waitForFunction(() => document.querySelector('[data-driver="tunnels"]').getAttribute('aria-pressed') === 'false');
  await page.reload();
  await page.waitForSelector('#planPanel.open');
  // what is on stays in view once the sheet is shut (finding 5): a chip on the plan sheet
  check(await page.evaluate(() => [...document.querySelectorAll('#planOptsOn .chip')].map((c) => c.textContent).includes('✓ Passenger aboard')), 'the stamp shows as a chip on the plan sheet');
  const after = await page.evaluate(() => ({ p: document.querySelector('[data-driver="passenger"]').getAttribute('aria-pressed'), t: document.querySelector('[data-driver="tunnels"]').getAttribute('aria-pressed'),
    fit: document.getElementById('fitRow').hidden, skill: document.getElementById('skillNote').hidden,
    providers: ((window.ApexRouteCtx && (window.ApexRouteCtx.pending || window.ApexRouteCtx.providers)) || []).map((x) => x.id || x),
    tags: window.ApexRouteDriver.driveTags(window.ApexRouteDriver.load(localStorage)) }));
  check(after.p === 'true' && after.t === 'false', 'the stamps come back as left: ' + JSON.stringify(after));
  check(after.fit === true, 'My free time / This album are only in the app (no calendar or music on the web)');
  check(after.skill === true, 'no drives in the Log: no skill line, never a guess');
  for (const id of ['crowd', 'driver', 'car', 'ios_context', 'crew_meet']) check(JSON.stringify(after.providers).includes(id), `provider ${id} registered: ` + JSON.stringify(after.providers));
  check(JSON.stringify(after.tags) === '["Passenger"]', 'a drive recorded now is tagged Passenger: ' + JSON.stringify(after.tags));
});

flow('a deliberate detour: one quiet "Rerouting", the new route goes the way the car is heading, and the swap is seamless (TestFlight: "it tweaks when finding a new route")', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  // The router: the plan goes north; a reroute from a moving car leaves along the heading it was given (400 m), then to the
  // destination. Without a heading it would head straight for the destination: back across the car's path (the U-turn).
  const asked = [];
  const KY = 110540, KX = 111320 * Math.cos(35.96 * Math.PI / 180);
  await page.route('https://valhalla1.openstreetmap.de/route', async (route) => {
    const req = JSON.parse(route.request().postData() || '{}'), locs = req.locations;
    asked.push(req);
    const a = locs[0], b = locs[locs.length - 1];
    if (asked.length === 1) { route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(locs)) }); return; }
    const pts = [], h = Number.isFinite(a.heading) ? a.heading * Math.PI / 180 : null;
    let lat = a.lat, lon = a.lon;
    if (h != null) for (let d = 0; d <= 400; d += 5) pts.push([lat = a.lat + d * Math.cos(h) / KY, lon = a.lon + d * Math.sin(h) / KX]);
    for (let i = 1; i <= 300; i++) pts.push([lat + (b.lat - lat) * i / 300, lon + (b.lon - lon) * i / 300]);
    await new Promise((r) => setTimeout(r, 1500));                    // a slow signal: the old route must stay up meanwhile
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trip: { legs: [{ shape: polyline6(pts), maneuvers: [
      { type: 1, begin_shape_index: 0, length: 3, street_names: ['Detour Lane'] }, { type: 4, begin_shape_index: pts.length - 1, length: 0 }] }],
      summary: { length: 12, time: 900, has_highway: false, has_toll: false, has_ferry: false } } }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.__said = []; window.APEX_REVIEW = true;
    window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'said') window.__said.push(m.text); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.loaded() && window.apex && window.apex.live, null, { timeout: 20000 });
  await page.evaluate(() => apexDebug.buildRoute([{ lat: 35.96, lon: -83.92 }, { lat: 36.06, lon: -83.92 }], 'route_dest', 'To the ridge', null,
    { from: null, to: { lat: 36.06, lon: -83.92 }, via: [] }));
  await page.waitForFunction(() => apexDebug.track && apexDebug.track.kind === 'route' && apexDebug.track.request, null, { timeout: 20000 });
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start' }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  // what the driver sees, counted: route-line redraws (and clears), camera fits, the camera's step from frame to frame
  await page.evaluate(() => {
    const m = apexDebug.map, src = m.getSource('apex-route-src'), set = src.setData.bind(src);
    window.__lines = []; window.__fits = 0; window.__steps = []; window.__plan = apexDebug.track;
    src.setData = (d) => { window.__lines.push(d && d.features ? d.features.length : -1); return set(d); };
    for (const k of ['fitBounds', 'flyTo', 'easeTo']) { const f = m[k].bind(m); m[k] = (...a) => { window.__fits++; return f(...a); }; }
    let last = null;
    // the camera's step from one frame to the next, in metres, over frames under 40 ms apart (a stalled frame on a slow
    // machine is not the app's jump): the springs move it about a metre a frame; a snap leaps several
    m.on('move', () => { const c = m.getCenter(), t = performance.now();
      if (last && t - last.t < 40) window.__steps.push(Math.hypot((c.lat - last.lat) * 110540, (c.lng - last.lng) * 111320 * Math.cos(c.lat * Math.PI / 180)));
      last = { lat: c.lat, lng: c.lng, t }; });
  });
  const fix = (lat, lon, crs) => page.evaluate(([lat, lon, crs]) => {
    window.apex.live({ lat, lon, accuracy_m: 5, speed_mps: 15, course_deg: crs, has_fix: true, lat_g: 0, lon_g: 0, calibration: 'locked', thermal: 0 });
    const n = document.getElementById('notes'), ds = document.getElementById('dsMain');
    return { strip: n ? n.textContent : '', eta: ds ? ds.textContent : '' };
  }, [lat, lon, crs]);
  const seen = [];
  // 1. along the plan, north, for 3 s (4 fixes a second at 15 m/s, in real time: the monitor's 5 s hold is on the clock)
  const route0 = await page.evaluate(() => ({ lat: apexDebug.track.lat.slice(0, 200), lon: apexDebug.track.lon.slice(0, 200), dist: apexDebug.track.dist.slice(0, 200) }));
  let i = 0, lat = route0.lat[0], lon = route0.lon[0];
  for (let k = 0; k < 12; k++) {
    while (i < route0.dist.length - 1 && route0.dist[i] < k * 3.75) i++;
    lat = route0.lat[i]; lon = route0.lon[i];
    const a = Math.max(0, i - 2), b = Math.min(route0.lat.length - 1, i + 2);
    const crs = (Math.atan2((route0.lon[b] - route0.lon[a]) * Math.cos(lat * Math.PI / 180), route0.lat[b] - route0.lat[a]) * 180 / Math.PI + 360) % 360;
    seen.push(await fix(lat, lon, crs));
    await page.waitForTimeout(250);
  }
  const etaBefore = seen[seen.length - 1].eta;
  check(/left/.test(etaBefore), 'the plan has an arrival: ' + etaBefore);
  const linesBefore = await page.evaluate(() => { window.__steps = []; window.__resets = apexDebug.camResets; return window.__lines.length; });   // the camera is following by now
  // 2. the driver turns east on purpose and keeps going, until the new route is up (and 2 s more)
  let swapped = -1;
  for (let k = 0; k < 80; k++) {
    lon += 3.75 / KX;
    seen.push(await fix(lat, lon, 90));
    if (swapped < 0 && asked.length > 1 && await page.evaluate(() => apexDebug.track !== window.__plan)) swapped = k;
    if (swapped >= 0 && k > swapped + 8) break;
    await page.waitForTimeout(250);
  }
  check(swapped >= 0, 'a new route arrived: ' + asked.length + ' router calls');
  // 3. on along the new route (it leaves east, the way the car was going) for 3 s
  const nt = await page.evaluate(() => ({ lat: apexDebug.track.lat.slice(), lon: apexDebug.track.lon.slice() }));
  let j = 0, best = Infinity;
  nt.lat.forEach((la, q) => { const d = Math.hypot((la - lat) * KY, (nt.lon[q] - lon) * KX); if (d < best) { best = d; j = q; } });
  check(best < 25, `the new route starts where the car is, going its way (${Math.round(best)} m from it)`);
  for (let k = 0; k < 12 && j < nt.lat.length - 1; k++) { j++; seen.push(await fix(nt.lat[j], nt.lon[j], 90)); await page.waitForTimeout(250); }
  const out = await page.evaluate(() => ({ said: window.__said.slice(), lines: window.__lines.slice(), fits: window.__fits, steps: window.__steps.slice(), resets: apexDebug.camResets - window.__resets }));
  // the router was asked from the car, heading east, with a tolerance
  const re = asked[1].locations[0];
  check(asked.length === 2 && Math.abs(re.heading - 90) <= 1 && re.heading_tolerance > 0 && re.heading_tolerance <= 90,
    'one reroute, from the car with its heading: ' + JSON.stringify(asked.map((a) => a.locations[0])));
  // the voice: "Rerouting" once, no nagging, no U-turn, no "Back on route"
  check(out.said.filter((s) => /Rerouting/.test(s)).length === 1, '"Rerouting" said once: ' + JSON.stringify(out.said));
  check(!out.said.some((s) => /U-turn|Wrong way|Off route|Back on route/.test(s)), 'no nagging: ' + JSON.stringify(out.said));
  // the status line: the one off-route word, in one run; never "Checking route…", "Off route" or "Wrong way"
  const strips = seen.map((s) => s.strip);
  check(!strips.some((s) => /Checking route|Off route|Wrong way/.test(s)), 'no flip-flop words: ' + [...new Set(strips)].join(' | '));
  const runs = strips.map((s) => /Rerouting/.test(s)).reduce((n, on, q, a) => n + (on && !a[q - 1] ? 1 : 0), 0);
  check(runs === 1, `"Rerouting…" on the status line once, in one run (${runs}): ` + [...new Set(strips)].join(' | '));
  // the map: the old line until the new one, swapped in one redraw, never cleared; no camera fit while driving, no jump
  const during = out.lines.slice(linesBefore);
  check(during.length === 1 && during[0] > 0 && !out.lines.includes(0), 'the route line replaced once, never cleared: ' + JSON.stringify(out.lines));
  check(out.fits === 0, `no camera fit while driving (${out.fits})`);
  const jump = Math.max(...out.steps);
  if (process.env.DEBUG_DETOUR) console.log('detour camera steps', out.steps.slice().sort((a, b) => b - a).slice(0, 6).map((x) => x.toFixed(2)).join(' '), out.steps.length);
  check(out.resets === 0, `the follow camera is never reset or snapped by the new route (${out.resets})`);
  check(out.steps.length > 100 && jump < 15, `the follow camera never leaps (largest step ${jump.toFixed(1)} m in ${out.steps.length} frames)`);
  // the arrival stays up through the reroute, then the new route's
  const etas = seen.slice(12).map((s) => /left/.test(s.eta));
  check(etas.every(Boolean), 'the arrival never blanks during the reroute: ' + JSON.stringify(seen.slice(12).map((s) => s.eta)));
}, { geolocation: { latitude: 35.96, longitude: -83.92 }, permissions: ['geolocation'] });

flow('while Vetta speaks: Lower music or Pause music, beside Voice in Layers, kept and sent to the shell (TestFlight: "my music played a little too loud over it")', async (page, base) => {
  // a plain browser can't touch other apps' audio: no such switch there
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  check(await page.evaluate(() => document.getElementById('musicCtl').hidden), 'no music switch in a browser');
  await page.addInitScript(() => { window.__posted = [];
    window.webkit = { messageHandlers: { apex: { postMessage(m) { window.__posted.push(m); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  const music = () => page.evaluate(() => window.__posted.filter((m) => m && m.cmd === 'voiceMusic').map((m) => m.mode));
  check(JSON.stringify(await music()) === '["lower"]', 'the shell hears the default at launch: ' + JSON.stringify(await music()));
  await page.click('#swTab');
  await page.waitForSelector('#musicCtl:not([hidden]) [data-music="pause"]', { state: 'visible' });
  check((await page.textContent('#musicCtl .ctl-label')) === 'While Vetta speaks', 'its label');
  await page.click('#musicCtl [data-music="pause"]');
  const after = await page.evaluate(() => ({ checked: [...document.querySelectorAll('[data-music]')].map((b) => `${b.dataset.music}:${b.getAttribute('aria-checked')}`).join(),
    kept: JSON.parse(localStorage.getItem('apex.prefs')).musicMode }));
  check(after.checked === 'lower:false,pause:true' && after.kept === 'pause', 'Pause music is chosen and kept: ' + JSON.stringify(after));
  check(JSON.stringify(await music()) === '["lower","pause"]', 'and sent: ' + JSON.stringify(await music()));
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  check(JSON.stringify(await music()) === '["pause"]', 'a launch sends the kept choice: ' + JSON.stringify(await music()));
});

flow('Where to?: with the search and routing services unreachable, a search fails politely', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.click('#destInput');
  await page.fill('#destInput', 'Knoxville');
  await page.press('#destInput', 'Enter');
  await page.waitForFunction(() => /Search is offline/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

// 2026-11-10: a place you pin or tap on the map is called by its name, in the field and on the route, never by coordinates
flow('a pin has a name: Go here routes "To <the road>", a tap on the map is a "Dropped pin", neither is coordinates; a spot rating fills its stars; the notes name the Search key', async (page, base) => {
  // the real map style is offline here: a bare one (with a glyphs address, so the app's own labelled layers are taken and its
  // load handler runs to the end, where the map's tap is wired), so the map loads and takes a tap
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.route('https://nominatim.openstreetmap.org/reverse**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: '', address: { road: 'Foothills Parkway' } }) }));
  let found = 'none';
  await page.route('https://photon.komoot.io/**', (route) => (found === 'fail' ? route.abort() : route.fulfill({ contentType: 'application/json', body: '{"features":[]}' })));
  const asked = [];
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && !document.getElementById('boot'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);                                   // the camera goes to the fix; a hold while it moves is no hold
  await page.waitForFunction(() => !window.apexDebug.map.isMoving());
  const box = await page.locator('#map').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height * 0.3;
  const routed = () => page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50 && !document.getElementById('planPanel').classList.contains('busy'); }, null, { timeout: 20000 });
  // hold the map: the pin's sheet names the road; Save is "as a spot", the word the rest of the app uses
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('pinOverlay').classList.contains('show') && document.getElementById('pinPlace').textContent === 'Foothills Parkway', null, { timeout: 10000 });
  check((await page.textContent('#pinSaveBtn')).trim() === 'Save as a spot', 'the pin saves "as a spot"');
  // the spot dialog: a rating is stars filled up to it
  await page.click('#pinSaveBtn');
  await sheetSettled(page, 'hlOverlay');
  // CI (2026-11-10): a star tap once shut the dialog. The press began on the star but the click went to the backdrop, so
  // the backdrop now closes a sheet only on a press that began on it. Say what lies under the star just before the tap.
  const under = await page.evaluate(() => {
    const b = document.querySelector('#hlRating [data-rating="3"]'), r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], hit: hit ? (hit.id || hit.className || hit.tagName) : null, onStar: !!hit && (hit === b || b.contains(hit)) };
  });
  check(under.onStar, 'the third star is what lies under its own centre: ' + JSON.stringify(under));
  await page.click('#hlRating [data-rating="3"]');
  check(await page.evaluate(() => document.getElementById('hlOverlay').classList.contains('show')), 'the spot dialog is still open after a star is tapped: ' + JSON.stringify(under));
  // a press on a key that lifts on the backdrop is not a tap on the backdrop
  const drag = await page.evaluate(() => {
    const o = document.getElementById('hlOverlay'), star = document.querySelector('#hlRating [data-rating="2"]');
    star.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    o.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return o.classList.contains('show');
  });
  check(drag, 'a press on a star that lifts on the backdrop leaves the spot dialog open');
  const stars = await page.evaluate(() => [...document.querySelectorAll('#hlRating button')].map((b) => [b.classList.contains('on'), b.getAttribute('aria-pressed'), Math.round(b.getBoundingClientRect().height)]));
  check(stars.map((s) => s[0]).join() === 'true,true,true,false,false' && stars.map((s) => s[1]).join() === 'false,false,true,false,false' && stars.every((s) => s[2] >= 44), 'three stars: three filled, the third pressed, 44 pt each: ' + JSON.stringify(stars));
  const keys = await page.evaluate(() => ['hlAddBtn', 'hlCancelBtn'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; }));
  check(keys[0][0] === keys[1][0] && keys[0][1] === keys[1][1] && keys[0][2] > keys[1][2], 'Save and Cancel are one row at one height, Save the wide one: ' + JSON.stringify(keys));
  await page.click('#hlCancelBtn');
  // Go here: the field and the route carry the name the sheet showed, and the router got the pin's own point
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('pinOverlay').classList.contains('show') && document.getElementById('pinPlace').textContent === 'Foothills Parkway', null, { timeout: 10000 });
  const pin = await page.evaluate(([px, py]) => { const r = document.getElementById('map').getBoundingClientRect(), ll = window.apexDebug.map.unproject([px - r.left, py - r.top]); return { lat: ll.lat, lon: ll.lng }; }, [x, y]);
  await page.click('#pinGoBtn');
  await routed();
  let got = await page.evaluate(() => ({ field: document.getElementById('destInput').value, name: window.apexDebug.track.name, bar: document.getElementById('routeBarName').textContent, recent: localStorage.getItem('apex.recentPlaces') || '' }));
  check(got.name === 'To Foothills Parkway' && /Foothills Parkway/.test(got.bar) && !/\d\.\d{3}/.test(got.field + got.name + got.bar), 'the route is "To Foothills Parkway", no coordinates: ' + JSON.stringify(got));
  const last = asked[asked.length - 1].locations, end = last[last.length - 1];
  check(Math.abs(end.lat - pin.lat) < 1e-3 && Math.abs(end.lon - pin.lon) < 1e-3, 'the router was asked for the pin itself: ' + JSON.stringify([end, pin]));
  check(/Foothills Parkway/.test(got.recent), 'a named pin is a recent place');
  // Tap the map: no lookup is waited for, so it is a "Dropped pin"; never kept as a recent place
  const again = async () => { await page.click('#planCancel'); await page.click('#planClear'); await page.click('#destInput'); };   // the card down, the route cleared
  await again();
  await page.click('#tapRouteBtn');
  await page.waitForTimeout(800);
  await page.mouse.click(x + 40, y + 30);
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'To a dropped pin', null, { timeout: 20000 });
  await routed();
  got = await page.evaluate(() => ({ field: document.getElementById('destInput').value, name: window.apexDebug.track.name, recent: localStorage.getItem('apex.recentPlaces') || '' }));
  check(got.name === 'To a dropped pin' && !/\d\.\d{3}/.test(got.field) && !/ropped pin/.test(got.recent), 'a tapped place is a dropped pin, not a recent place: ' + JSON.stringify(got));
  // the notes under what is typed name the key that is on the screen (it says Search)
  await again();
  await page.fill('#destInput', 'Zzyzxqq');
  await page.waitForFunction(() => /Press Search to look everywhere/.test(document.getElementById('placeList').textContent), null, { timeout: 10000 });
  check((await page.textContent('#findGoBtn')).trim() === 'Search', 'the key under the note says Search');
  found = 'fail';
  await page.fill('#destInput', 'Zzyzxqqq');
  await page.waitForFunction(() => /Suggestions didn't load\. Press Search to try\./.test(document.getElementById('placeList').textContent), null, { timeout: 10000 });
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

flow('a short trip with one route finishes: the plan ends, busy clears and Searching goes, within seconds (live check of PR #293)', async (page, base) => {
  // under 3 km, so no stages; the router offers one route, which goes up at once as the quickest and is the only option
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
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route'; }, null, { timeout: 10000 });
  const done = await page.waitForFunction(() => Array.isArray(window.apexDebug.lastFun) && !document.getElementById('planPanel').classList.contains('busy')
    && !(document.getElementById('toast').classList.contains('show') && /Searching/.test(document.getElementById('toast').textContent)), null, { timeout: 12000 }).then(() => true, () => false);
  check(done, 'the plan finished (ranked, busy cleared, Searching gone) within 12 s of the route going up');
}, { geolocation: { latitude: 35.7400, longitude: -83.9700 }, permissions: ['geolocation'] });

// Our own routing (docs/OWN_ROUTING.md §5): the same trip with our graph tiles and without them.
async function ownTrip(page, base, level = null) {
  const calls = { route: [], trace: [], matrix: 0 };
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-84.57, 39.19] }, properties: { name: 'Forest Park', state: 'Ohio' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const u = route.request().url(), req = JSON.parse(route.request().postData() || '{}');
    if (u.endsWith('/route')) {
      calls.route.push(req);
      const t = stubTrip(req.locations);
      t.trip.summary.time = 3000;                                   // a slow way round: a check, not a contender
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(t) });
    }
    if (u.endsWith('/trace_route')) {
      // Valhalla's maneuvers on the line it was sent (our own)
      calls.trace.push(req);
      const n = (() => { let k = 0, i = 0; const s = req.encoded_polyline || ''; while (i < s.length) { for (let c = 0; c < 2; c++) { let b; do { b = s.charCodeAt(i++) - 63; } while (b >= 0x20); } k++; } return k; })();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trip: { legs: [{ shape: req.encoded_polyline, maneuvers: [
        { type: 1, begin_shape_index: 0, length: 1, street_names: ['Row 0'] }, { type: 15, begin_shape_index: Math.floor(n / 2), length: 1, street_names: ['Instruction Lane'] },
        { type: 4, begin_shape_index: n - 1, length: 0 }] }], summary: { length: 5, time: 400 } } }) });
    }
    if (u.includes('sources_to_targets')) calls.matrix++;
    return route.abort();
  });
  await page.addInitScript((lv) => { try { localStorage.setItem('apex.onboarded', '1'); if (lv) localStorage.setItem('apex.funLevel', lv); } catch (_) {} }, level);
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.click('#destInput');
  await page.fill('#destInput', 'Forest Park');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => Array.isArray(window.apexDebug.lastFun) && window.apexDebug.lastOwn && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ own: window.apexDebug.lastOwn, kinds: window.apexDebug.lastFun.map((c) => c.kind), track: window.apexDebug.track.kind,
    steps: (window.apexDebug.track.steps || []).map((s) => s.street), via: ((window.apexDebug.track.request || {}).via || []).length }));
  return { r, calls };
}
flow('design pass 2: the route card\'s last row is one ruled strip of keys, and the map\'s credit is a plate on the look\'s own tokens (IDEAS U-53)', async (page, base) => {
  graphDir = graphFixture();
  try {
    await ownTrip(page, base);
    const k = await page.evaluate(() => { const row = document.querySelector('.rc-links'), keys = [...row.querySelectorAll('.linkbtn')].filter((b) => !b.hidden).map((b) => { const r = b.getBoundingClientRect(), c = getComputedStyle(b);
        return { t: b.textContent, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), u: c.textDecorationLine, over: b.scrollWidth > b.clientWidth + 1 }; });
      return { keys, row: Math.round(row.getBoundingClientRect().width) }; });
    check(k.keys.length >= 4 && new Set(k.keys.map((x) => x.top)).size === 1 && Math.abs(k.keys.reduce((n, x) => n + x.w, 0) - k.row) <= 3, 'one row of keys, edge to edge: ' + JSON.stringify(k));
    check(k.keys.every((x) => x.h >= 44 && x.u === 'none' && !x.over), '44 pt keys, no underlines, every word whole: ' + JSON.stringify(k.keys));
    await page.click('#routeSaveBtn');
    const saved = await page.evaluate(() => { const b = document.getElementById('routeSaveBtn'), c = getComputedStyle(b), ink = getComputedStyle(document.documentElement).getPropertyValue('--panel-ink').trim();
      const probe = document.createElement('i'); probe.style.color = ink; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove();
      return { t: b.textContent, pressed: b.getAttribute('aria-pressed'), bg: c.backgroundColor, want }; });
    check(saved.t === 'Saved' && saved.pressed === 'true' && saved.bg === saved.want, 'a key that is on is inked in: ' + JSON.stringify(saved));
    const credit = await page.evaluate(() => { const a = document.querySelector('.maplibregl-ctrl-attrib'); if (!a) return null;
      a.classList.remove('maplibregl-attrib-empty', 'maplibregl-compact-show'); a.classList.add('maplibregl-compact');
      const c = getComputedStyle(a), b = a.querySelector('.maplibregl-ctrl-attrib-button'), cb = getComputedStyle(b), panel = getComputedStyle(document.querySelector('.plan')).backgroundColor;
      return { radius: c.borderTopLeftRadius, bg: c.backgroundColor, panel, border: c.borderTopWidth, img: cb.backgroundImage, i: getComputedStyle(b, '::before').content, bradius: cb.borderTopLeftRadius }; });
    check(credit && credit.radius === '0px' && credit.bradius === '0px' && credit.bg === credit.panel && parseFloat(credit.border) >= 1 && credit.img === 'none' && credit.i === '"i"', 'the credit is a square plate on the page\'s paper with its own "i": ' + JSON.stringify(credit));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

flow('own routing: where our graph tiles cover the trip, our route wins and Valhalla only gives the turn instructions (docs/OWN_ROUTING.md)', async (page, base) => {
  graphDir = graphFixture();
  try {
    const { r, calls } = await ownTrip(page, base);
    check(r.own.covered && r.own.used && r.own.n >= 2, 'our router planned it: ' + JSON.stringify(r.own));
    check(r.kinds[0] === 'own' && r.track === 'route', 'our route won the ranking: ' + JSON.stringify(r.kinds));
    // (its stand-in here takes 50 min, past every budget, so the ranking drops it)
    check(calls.route.length >= 1 && calls.route.length <= 2, "Valhalla's quickest (and its highway-friendly one) asked for as a check: " + calls.route.length);
    check(calls.matrix === 0 && calls.route.every((q) => q.locations.length === 2), 'no stage plans or matrix: ' + calls.route.map((q) => q.locations.length));
    check(calls.trace.length >= 1 && calls.trace.every((q) => q.shape_match === 'map_snap' && q.encoded_polyline), 'instructions from trace_route on our line');
    check(r.steps.includes('Instruction Lane'), "the route's spoken directions are Valhalla's: " + JSON.stringify(r.steps));
    check(r.via >= 1, 'pinned with shaping points, so a reroute keeps to it: ' + r.via);
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

// What this drive is like (web/route_story.js, the owner 2026-11-09): a planned route's card carries a few plain lines
// built from the ranking's own data, in your units, after the card is up; nothing it says is unknown to the data.
flow('route overview: the card says what the drive is like in plain words, from the route\'s own data', async (page, base) => {
  graphDir = graphFixture();
  try {
    await ownTrip(page, base, 'fun');
    await page.waitForFunction(() => !document.getElementById('routeCardStory').hidden, null, { timeout: 5000 });
    const r = await page.evaluate(() => {
      const t = window.apexDebug.track, s = t.__story && t.__story.s, box = document.getElementById('routeCardStory');
      return { lines: s ? s.lines : [], coverage: s && s.coverage, lead: document.getElementById('routeCardStoryLead').textContent,
        more: [...document.querySelectorAll('#routeCardStoryMore p')].map((p) => p.textContent), open: box.open, one: box.classList.contains('one'),
        streets: (t.steps || []).map((x) => x.street).filter(Boolean), cardW: document.getElementById('routeCard').scrollWidth - document.getElementById('routeCard').clientWidth };
    });
    const texts = r.lines.map((l) => l.text);
    if (process.env.STORY_LOG) console.log(JSON.stringify({ texts, coverage: r.coverage, streets: [...new Set(r.streets)] }));
    check(texts.length >= 1 && texts.length <= 5, 'one to five lines: ' + JSON.stringify(texts));
    check(r.lead === texts[0] && JSON.stringify(r.more) === JSON.stringify(texts.slice(1)), 'the first line in view, the rest under it: ' + JSON.stringify([r.lead, r.more]));
    check(!r.open, 'the rest is a tap away, not open by default');
    check(texts.every((x) => /^[A-Z0-9]/.test(x) && /\.$/.test(x) && !/goodness|NaN|undefined|null|\bG\b/.test(x)), 'plain sentences, no jargon or unknowns: ' + JSON.stringify(texts));
    check(!texts.some((x) => /\bkm\b|km\/h/.test(x)), 'in the default units (miles): ' + JSON.stringify(texts));
    // every name it says is a street the route drives; every highlight lies on the route
    for (const l of r.lines) for (const n of (l.facts && l.facts.names) || []) check(r.streets.includes(n), `"${n}" is on the route: ` + JSON.stringify(r.streets));
    const hl = r.lines.find((l) => l.kind === 'highlight');
    if (hl) check(hl.facts.m >= 1500 && hl.facts.toM <= r.coverage.km * 1000 + 30, 'the best part is a real stretch of this route: ' + JSON.stringify(hl.facts));
    // the grid's tiles carry no weather, deer or members' data here: nothing said about them
    check(!r.lines.some((l) => l.kind === 'members' || l.kind === 'conditions'), 'no members\' or conditions line without their data: ' + JSON.stringify(texts));
    check(r.cardW <= 1, 'the card does not grow sideways: ' + r.cardW);
    // a tap opens the rest
    if (texts.length > 1) {
      await page.click('#routeCardStoryLead');
      check(await page.evaluate(() => document.getElementById('routeCardStory').open), 'a tap on the line opens the rest');
    }
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

// The levels (the owner, 2026-11-08: "fun should never go on the highway. Quick should essentially be a normal route"): on
// the grid whose arterials are motorways, Quick drives them; Fun and Long way never do, in the plan, the card's pick and
// the level cards; the shown route's samples on our tiles carry no motorway at Fun
async function hwyOfTrack(page) {
  return page.evaluate(async () => {
    const t = window.apexDebug.track, c = ApexGraphRouter.client({ url: 'graph_worker.js', timeoutMs: 20000 });
    try { const [s] = await c.score([{ lat: Array.from(t.lat), lon: Array.from(t.lon) }]); let n = 0; for (let i = 0; i < s.cls.length; i++) if (s.cls[i] <= 1) n++; return n * 5 / 1000; } finally { c.close(); }
  });
}
for (const level of ['quick', 'fun', 'max']) {
  flow(`levels: ${level === 'quick' ? 'Quick drives the motorway, the quickest way' : `${level === 'fun' ? 'Fun' : 'Long way'} never drives the motorway`} (the owner, 2026-11-08)`, async (page, base) => {
    graphDir = graphFixture(true);
    try {
      const { r } = await ownTrip(page, base, level);
      check(r.own.covered && r.own.used, 'our router planned it: ' + JSON.stringify(r.own));
      const x = await page.evaluate(() => ({ pick: window.apexDebug.lastFun[0], all: window.apexDebug.lastFun.map((c) => [c.kind, c.hwyKm, Math.round(c.timeS)]), quickS: window.apexDebug.lastQuickS,
        timeS: window.apexDebug.track.timeS, why: (document.getElementById('routeCardWhy') || {}).textContent || '', cards: (document.getElementById('routeCardFun') || {}).innerText || '' }));
      const km = await hwyOfTrack(page);
      if (level === 'quick') {
        check(km > 1 && x.pick.hwyKm > 1, `Quick takes the motorway: ${km} km on the track, ${JSON.stringify(x.all)}`);
        check(x.timeS - x.quickS <= 61, `Quick is the quickest, a minute at most for a nicer road: ${x.timeS} vs ${x.quickS}`);
      } else {
        check(km === 0 && x.pick.hwyKm === 0 && x.pick.hwyRule === 'free', `no motorway on the ${level} route: ${km} km on the track, ${JSON.stringify(x.all)}`);
        check(x.all.every(([, k]) => k === 0), 'nothing the level ranks drives a motorway: ' + JSON.stringify(x.all));
        check(x.quickS < x.timeS, 'measured against the quickest (the motorway): ' + JSON.stringify([x.quickS, x.timeS]));
        check(!/Uses .* of /.test(x.why) && !/No highway-free way/.test(x.why), 'no exception on a grid with other ways: ' + x.why);
      }
      if (level === 'fun') {
        // the Quick card puts the motorway route up; the Fun card brings the highway-free one back
        await page.click('#routeCardFun [data-fun="quick"]');
        await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.funLevel === 'quick' && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 20000 });
        const kq = await hwyOfTrack(page);
        await page.click('#routeCardFun [data-fun="fun"]');
        await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.funLevel === 'fun' && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 20000 });
        const kf = await hwyOfTrack(page);
        check(kq > 1 && kf === 0, `the cards: Quick ${kq} km of motorway, Fun ${kf}`);
      }
    } finally { graphDir = null; }
  }, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });
}

flow('own routing: best roads nearby from our tiles, timed by our router (no map stage search, no Valhalla matrix)', async (page, base) => {
  graphDir = graphFixture();
  try {
    let matrix = 0, discovered = 0;
    await page.route('https://valhalla1.openstreetmap.de/**', (route) => { if (route.request().url().includes('sources_to_targets')) matrix++; return route.abort(); });
    await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexStages);
    await page.evaluate(() => { const d = ApexStages.discover; ApexStages.discover = (...a) => { window.__discovered = (window.__discovered || 0) + 1; return d(...a); }; });
    await page.click('#deckNearby');
    await page.waitForFunction(() => window.apexDebug.lastExploreOwn != null && !document.getElementById('nearbyStatus').classList.contains('busy'), null, { timeout: 20000 });
    const r = await page.evaluate(() => ({ own: window.apexDebug.lastExploreOwn, rows: document.querySelectorAll('#exploreList .nb-go').length, status: document.getElementById('nearbyStatus').textContent, discovered: window.__discovered || 0 }));
    discovered = r.discovered;
    check(r.own > 0 && r.rows > 0, 'roads from our tiles in the list: ' + JSON.stringify(r));
    check(matrix === 0 && discovered === 0, `no Valhalla matrix (${matrix}) and no map stage search (${discovered})`);
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.205, longitude: -84.55 }, permissions: ['geolocation'] });

flow('own routing: a loop from our tiles is built from the best roads and keeps off the motorway (the owner, 2026-11-04: "mostly highway for loops")', async (page, base) => {
  graphDir = graphFixture(true);
  try {
    await page.route('https://valhalla1.openstreetmap.de/**', (route) => route.abort());   // our tiles alone
    await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', 'fun'); } catch (_) {} });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexStages, null, { timeout: 20000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#loopDetents [data-loop-mi]')][0];      // 15 mi
      b.click(); document.getElementById('findLoopBtn').click();
    });
    await page.waitForFunction(() => Array.isArray(window.apexDebug.lastLoop) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ loops: window.apexDebug.lastLoop, name: apexDebug.track && apexDebug.track.name,
      ends: apexDebug.track ? [[apexDebug.track.lat[0], apexDebug.track.lon[0]], [apexDebug.track.lat[apexDebug.track.lat.length - 1], apexDebug.track.lon[apexDebug.track.lon.length - 1]]] : null }));
    const own = r.loops.filter((d) => d.kind === 'own'), won = r.loops.find((d) => d.picked);
    check(own.length >= 1 && won && won.kind === 'own' && /loop$/.test(r.name), 'a loop from our tiles won: ' + JSON.stringify(r.loops));
    check(own.every((d) => Number.isFinite(d.hwyShare) && d.hwyShare <= 0.1), 'every loop of ours keeps motorway to a short link (at most a tenth at Fun): ' + JSON.stringify(own.map((d) => d.hwyShare)));
    check(won.hwyShare === 0, 'the Fun pick drives no motorway (the owner, 2026-11-08: "fun should never go on the highway"): ' + won.hwyShare);
    check(!r.loops.some((d) => d.kind === 'circle'), 'no circle drawn round the start when real loops exist: ' + JSON.stringify(r.loops.map((d) => d.kind)));
    check(Math.hypot(r.ends[0][0] - r.ends[1][0], r.ends[0][1] - r.ends[1][1]) < 0.003, 'it ends where it starts: ' + JSON.stringify(r.ends));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.205, longitude: -84.55 }, permissions: ['geolocation'] });

// Offline (docs/OWN_ROUTING.md §5): once the app and its tiles are on the phone, planning needs no network at all. The
// iOS app bundles web/, so "offline" here is every request but the app's own files refused (no /api, no Valhalla, no
// search, no weather), as a phone with no signal; then the browser's own offline switch on top, which refuses those too.
flow('offline: plan a route and a loop from our tiles with no network', async (page, base) => {
  graphDir = graphFixture();
  try {
    let offline = false;
    const refused = [];
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (offline && !(u.startsWith(base) && !u.startsWith(base + '/api/'))) { refused.push(u.replace(base, '').slice(0, 80)); return route.abort('internetdisconnected'); }
      return route.fallback();
    });
    await page.addInitScript(() => { try {
      localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', 'quick');
      localStorage.setItem('apex.pinnedPlaces', JSON.stringify([{ name: 'Work', label: 'Work', lat: 39.19, lon: -84.57 }]));
    } catch (_) {} });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexOwnRouting);
    const finished = () => page.waitForFunction(() => Array.isArray(window.apexDebug.lastFun) && window.apexDebug.lastOwn && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 10000 });
    // the card down and the route cleared, as a person would before planning again (whichever key is showing)
    const clearPlan = async () => {
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => { for (const id of ['planCancel', 'planClear']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); } });
        await page.waitForTimeout(300);
      }
    };
    // one plan with the signal on (the tiles land in IndexedDB as they do on any first plan); then the signal goes
    await page.fill('#destInput', '39.2400, -84.5300');
    await page.press('#destInput', 'Enter');
    await finished();
    await page.waitForTimeout(500);
    await clearPlan();
    offline = true;
    // (the weather line is read the moment it shows, within 6 s: a route replaced meanwhile hides it again until its own
    // forecast is refused, and under a loaded full run a read between the two saw it hidden)
    const read = async () => page.evaluate(async () => { const w = document.getElementById('routeCardWeather');
      for (let k = 0; k < 120 && w.hidden; k++) await new Promise((r) => setTimeout(r, 50));
      const t = window.apexDebug.track; return { own: window.apexDebug.lastOwn, kinds: window.apexDebug.lastFun.map((c) => c.kind), kind: t && t.kind, funLevel: t && t.funLevel,
      steps: ((t && t.steps) || []).map((s) => s.type), instructions: t && t.instructions,
      limits: t && Array.isArray(t.limitMps) ? [t.limitMps.filter((x) => x > 0).length, t.limitMps.length, t.limitSource || null] : null, weather: w.hidden ? null : w.textContent }; });
    const plans = [];
    // 1. Quick, to a saved place (Where to?'s pinned row): no search needed
    await page.click('#destInput');
    await page.waitForSelector('#placeList .pinned-row');
    let t0 = Date.now();
    await page.evaluate(() => { window.apexDebug.lastFun = undefined; });
    await page.click('#placeList .pinned-row .place');
    await finished();
    plans.push({ level: 'quick', ms: Date.now() - t0, ...(await read()) });
    // 2. Fun and Long way, from the card's level switch (each a plan of its own: their detours reach past Quick's routes)
    for (const level of ['fun', 'max']) {
      await page.evaluate(() => { window.apexDebug.lastFun = undefined; });
      t0 = Date.now();
      await page.click(`#routeCardFun [data-fun="${level}"]`);
      await finished();
      await page.waitForTimeout(200);
      plans.push({ level, ms: Date.now() - t0, ...(await read()) });
    }
    for (const p of plans) {
      check(p.own.covered && p.own.used && p.kinds[0] === 'own' && p.kind === 'route', `${p.level}: our route, from our tiles: ` + JSON.stringify(p));
      check(p.ms < 8000, `${p.level}: no hang (${p.ms} ms)`);
      check(p.steps.length >= 1 && p.steps.includes(4), `${p.level}: our own turn instructions on the route: ` + JSON.stringify(p.steps));
      check(p.weather && /aren't known|not known/i.test(p.weather), `${p.level}: the card says the weather isn't known, not a made-up forecast: ` + p.weather);
      // the limit sign and the ETA: the posted limits from our tiles, with no map matching (offline it never could)
      check(p.limits && p.limits[2] === 'tiles' && p.limits[0] > p.limits[1] / 2, `${p.level}: a posted limit is known on the planned route, from our tiles: ` + JSON.stringify(p.limits));
    }
    check(plans.every((p) => p.funLevel === p.level), 'each plan at its level: ' + JSON.stringify(plans.map((p) => [p.level, p.funLevel])));
    // 3. typed search can't work offline, and says so; a map tap's coordinates (what a tap puts in Where to?) do
    await clearPlan();
    await page.click('#destInput');
    await page.fill('#destInput', 'Forest Park');
    await page.press('#destInput', 'Enter');
    await page.waitForFunction(() => /offline|no signal|tap the map/i.test(document.getElementById('toast').textContent), null, { timeout: 12000 });
    await page.evaluate(() => { window.apexDebug.lastFun = undefined; });
    await page.fill('#destInput', '39.2100, -84.5500');
    await page.press('#destInput', 'Enter');
    await finished();
    const tap = await read();
    check(tap.own.used && tap.kind === 'route', 'a map tap\'s place, routed offline: ' + JSON.stringify(tap.own));
    // 4. a loop from our tiles
    await clearPlan();
    t0 = Date.now();
    await page.evaluate(() => { window.apexDebug.lastLoop = undefined; const b = [...document.querySelectorAll('#loopDetents [data-loop-mi]')][0]; b.click(); document.getElementById('findLoopBtn').click(); });
    await page.waitForFunction(() => Array.isArray(window.apexDebug.lastLoop) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 15000 });
    const loop = await page.evaluate(() => ({ loops: window.apexDebug.lastLoop, kind: apexDebug.track && apexDebug.track.kind, name: apexDebug.track && apexDebug.track.name }));
    const won = loop.loops.find((d) => d.picked);
    check(won && won.kind === 'own' && /loop$/.test(loop.name || ''), 'a loop from our tiles, offline: ' + JSON.stringify(loop.loops));
    check(Date.now() - t0 < 12000, 'the loop: no hang (' + (Date.now() - t0) + ' ms)');
    // 5. the browser's own offline switch (the app's files refused too): still plans, from what's on the phone
    await clearPlan();
    await page.context().setOffline(true);
    try {
      await page.evaluate(() => { window.apexDebug.lastFun = undefined; });
      await page.click('#destInput');
      await page.fill('#destInput', '39.1900, -84.5700');
      t0 = Date.now();
      await page.press('#destInput', 'Enter');
      await finished();
      const off = await read();
      check(off.own.used && off.kind === 'route' && Date.now() - t0 < 8000, 'with the browser offline as well: ' + JSON.stringify(off.own));
    } finally { await page.context().setOffline(false); }
    check(refused.some((u) => /valhalla/.test(u)), 'Valhalla was asked and refused (no signal), and nothing waited on it: ' + refused.length);
    check(!refused.some((u) => /trace_attributes/.test(u)), "no map matching asked for our routes' limits: " + JSON.stringify(refused.filter((u) => /trace_attributes/.test(u))));
    check(tap.limits && tap.limits[0] > 0, "the map tap's route has its posted limits: " + JSON.stringify(tap.limits));
    if (process.env.OFFLINE_LOG) console.log(JSON.stringify({ plans: plans.map((p) => [p.level, p.ms, p.own.ms, p.steps.length]), loop: loop.loops.map((d) => [d.kind, d.picked]), refused: [...new Set(refused.map((u) => u.split('?')[0]))] }));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

// The owner (2026-11-07): "No dependence on a free server that can slow down or go away." Valhalla and OSRM down, two
// ways: first every request refused at once, then every request left hanging (a server that has slowed to nothing, the
// harder case: nothing errors, so anything that waits on it waits). Planning inside our tiles must not notice: the first
// route and the final card within the targets (OWN_ROUTING.md §8: the card 1.0 s cold and 0.7 s warm, the first route
// 0.4 s warm, from Enter), our own turn instructions on the route, the posted limits from the tiles.
flow('valhalla down: planning inside our tiles is unaffected', async (page, base) => {
  graphDir = graphFixture();
  try {
    let mode = 'abort';
    const asked = { abort: [], stall: [] };
    const ROUTERS = /^https:\/\/(valhalla1\.openstreetmap\.de|router\.project-osrm\.org)\//;
    await page.route(ROUTERS, (route) => {
      const u = new URL(route.request().url());
      asked[mode].push(u.host + u.pathname.split('/').slice(0, 3).join('/'));
      return mode === 'abort' ? route.abort('connectionrefused') : new Promise(() => {});   // stall: never answered
    });
    await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', 'fun'); } catch (_) {} });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexOwnRouting);
    await page.waitForTimeout(1500);                                   // a person opens the app and taps Where to?
    const clearPlan = async () => {
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => { for (const id of ['planCancel', 'planClear']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); } });
        await page.waitForTimeout(300);
      }
    };
    const planTo = async (to) => {
      await page.click('#destInput');
      await page.fill('#destInput', to);
      await page.evaluate(() => { window.apexDebug.lastFun = undefined; window.apexDebug.planMarks = []; window.apexDebug.optMarks = []; });
      await page.press('#destInput', 'Enter');
      await page.waitForFunction(() => Array.isArray(window.apexDebug.lastFun) && window.apexDebug.lastOwn && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 10000 });
      return page.evaluate(() => {
        const D = window.apexDebug, t = D.track, lag = D.planStartAt - D.enterAt;
        const at = (marks, k) => { const m = (marks || []).find((x) => x[0] === k); return m ? Math.round(m[1] + lag) : null; };
        return { first: at(D.optMarks, 'drawn'), card: at(D.planMarks, 'built'), own: D.lastOwn, kinds: D.lastFun.map((c) => c.kind), kind: t && t.kind,
          steps: ((t && t.steps) || []).map((x) => x.type), limits: t && Array.isArray(t.limitMps) ? t.limitMps.filter((x) => x > 0).length : null,
          toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '' };
      });
    };
    const runs = [];
    runs.push({ mode, warm: false, ...(await planTo('39.2400, -84.5300')) });   // cold: the tiles fetched for the first time
    await page.waitForTimeout(600);
    await clearPlan();
    runs.push({ mode, warm: true, ...(await planTo('39.2500, -84.5500')) });
    await page.waitForTimeout(600);
    await clearPlan();
    mode = 'stall';
    runs.push({ mode, warm: true, ...(await planTo('39.2300, -84.5200')) });
    await page.waitForTimeout(600);
    await clearPlan();
    runs.push({ mode, warm: true, ...(await planTo('39.2600, -84.5400')) });
    // the turn instructions' wait (OWN_INSTRUCT_MS) and the checks' (OWN_CHECK_MS) run out after the card: ours stay
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({ steps: ((window.apexDebug.track || {}).steps || []).map((x) => x.type), kind: (window.apexDebug.track || {}).kind }));
    // a loop from our tiles with Valhalla hanging: its context doesn't wait on Valhalla's map matching (the map's stage
    // loops, Valhalla's, come after the card and here never)
    await clearPlan();
    const loopAt = Date.now();
    await page.evaluate(() => { window.apexDebug.lastLoop = undefined; const b = [...document.querySelectorAll('#loopDetents [data-loop-mi]')][0]; b.click(); document.getElementById('findLoopBtn').click(); });
    await page.waitForFunction(() => Array.isArray(window.apexDebug.lastLoop) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 15000 });
    const loopMs = Date.now() - loopAt;
    const loop = await page.evaluate(() => ({ won: (window.apexDebug.lastLoop.find((d) => d.picked) || {}).kind, name: apexDebug.track && apexDebug.track.name, steps: ((apexDebug.track || {}).steps || []).length }));
    check(loop.won === 'own' && /loop$/.test(loop.name || '') && loopMs <= 1500, `a loop from our tiles within 1.5 s with Valhalla hanging (${loopMs} ms): ` + JSON.stringify(loop));
    for (const r of runs) {
      const lab = `${r.mode} ${r.warm ? 'warm' : 'cold'}`;
      check(r.own.covered && r.own.used && r.kinds[0] === 'own' && r.kind === 'route', `${lab}: our route, from our tiles: ` + JSON.stringify(r));
      check(Number.isFinite(r.card) && r.card <= (r.warm ? 700 : 1000), `${lab}: the final card within ${r.warm ? 700 : 1000} ms of Enter (${r.card} ms; first route ${r.first} ms)`);
      if (r.warm) check(Number.isFinite(r.first) && r.first <= 400, `${lab}: the first route within 400 ms of Enter (${r.first} ms)`);
      check(r.steps.length >= 2 && r.steps.includes(4), `${lab}: turn instructions on the route (ours): ` + JSON.stringify(r.steps));
      check(r.limits > 0, `${lab}: the posted limits from our tiles: ` + r.limits);
      check(!/couldn.t|check signal/i.test(r.toast), `${lab}: no failure said: ` + r.toast);
    }
    check(after.kind === 'route' && after.steps.length >= 2 && after.steps.includes(4), 'after Valhalla\'s waits ran out, the route keeps our instructions: ' + JSON.stringify(after));
    check(asked.abort.length >= 1 && asked.stall.length >= 1, 'Valhalla was asked (as a check, for instructions) and failed both ways: ' + JSON.stringify(asked));
    if (process.env.DOWN_LOG) console.log(JSON.stringify({ runs: runs.map((r) => [r.mode, r.warm, r.first, r.card]), loopMs, asked }));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

flow('weak signal: with every request off the app hanging, nothing on the network sits before our first route or the card', async (page, base) => {
  // (prod-speed, 2026-11-08) the app's own files answer; everything else (our Worker's /api, weather, search, Valhalla,
  // the map) is left hanging, as on a phone with one bar. Avoid towns is on (the towns are the map's tiles: network).
  graphDir = graphFixture();
  try {
    let hang = false;
    const held = new Set();
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (hang && !(u.startsWith(base) && !u.startsWith(base + '/api/'))) { held.add(u.replace(base, '').split('?')[0].slice(0, 60)); return new Promise(() => {}); }
      return route.fallback();
    });
    await page.addInitScript(() => { try {
      localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', 'fun');
      localStorage.setItem('apex.avoid', JSON.stringify({ towns: true }));
    } catch (_) {} });
    const finished = () => page.waitForFunction(() => Array.isArray(window.apexDebug.lastFun) && window.apexDebug.lastOwn && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 12000 })
      .catch(async (e) => { if (process.env.DOWN_LOG) console.log(JSON.stringify(await page.evaluate(() => ({ marks: window.apexDebug.planMarks, opt: window.apexDebug.optMarks, tl: (window.apexDebug.timeline || []).filter((x) => !/track route_dest/.test(x[0])), own: window.apexDebug.lastOwn, busy: document.getElementById('planPanel').className, toast: document.getElementById('toast').textContent })))); throw e; });
    const clearPlan = async () => {
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => { for (const id of ['planCancel', 'planClear']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); } });
        await page.waitForTimeout(300);
      }
    };
    const planTo = async (to) => {
      await page.fill('#destInput', to);
      await page.evaluate(() => { window.apexDebug.lastFun = undefined; window.apexDebug.planMarks = []; window.apexDebug.optMarks = []; });
      await page.press('#destInput', 'Enter');
      await finished();
      return page.evaluate(() => {
        const D = window.apexDebug, t = D.track, lag = D.planStartAt - D.enterAt;
        const at = (marks, k) => { const m = (marks || []).find((x) => x[0] === k); return m ? Math.round(m[1] + lag) : null; };
        return { first: at(D.optMarks, 'drawn'), card: at(D.planMarks, 'built'), own: D.lastOwn, kinds: D.lastFun.map((c) => c.kind), kind: t && t.kind,
          steps: ((t && t.steps) || []).length, townKm: (D.lastFun[0] || {}).townKm };
      });
    };
    const open = async () => {
      await page.goto(base + '/index.html');
      await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexOwnRouting);
      await page.waitForTimeout(1500);
    };
    // an earlier launch with the signal on: the tiles and their index kept on the phone, as after any plan
    await open();
    await planTo('39.2400, -84.5300');
    // then one bar: the app opened again, two plans
    hang = true;
    await open();
    const runs = [{ warm: false, ...(await planTo('39.2500, -84.5500')) }];
    await page.waitForTimeout(600);
    await clearPlan();
    runs.push({ warm: true, ...(await planTo('39.2300, -84.5200')) });
    for (const r of runs) {
      const lab = r.warm ? 'warm' : 'reopened';
      check(r.own.covered && r.own.used && r.kinds[0] === 'own' && r.kind === 'route' && r.steps >= 2, `${lab}: our route with our instructions: ` + JSON.stringify(r));
      check(Number.isFinite(r.card) && r.card <= (r.warm ? 700 : 1000), `${lab}: the card within ${r.warm ? 700 : 1000} ms of Enter with the network hanging (${r.card} ms; first route ${r.first} ms)`);
      check(Number.isFinite(r.first) && r.first <= (r.warm ? 400 : 600), `${lab}: the first route within ${r.warm ? 400 : 600} ms (${r.first} ms)`);
    }
    // a first launch (nothing kept) with one bar: the region's index is given INDEX_WAIT_MS (3 s, from launch), then
    // the app's own tiles plan alone; before, every tile load waited on it for as long as the request hung
    await page.evaluate(() => new Promise((ok) => { const rq = indexedDB.deleteDatabase('vetta-graph'); rq.onsuccess = rq.onerror = rq.onblocked = () => ok(); }));
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexOwnRouting);
    await page.waitForTimeout(3500);
    const fresh = await planTo('39.2450, -84.5350');
    check(fresh.own.used && fresh.kind === 'route' && Number.isFinite(fresh.card) && fresh.card <= 1500, 'a first launch with the network hanging still plans on our tiles: ' + JSON.stringify(fresh));
    check(held.has('/api/graph/v1/index.json'), 'the region index was asked and left hanging: ' + [...held].join(' '));
    if (process.env.DOWN_LOG) console.log(JSON.stringify({ runs: runs.map((r) => [r.warm, r.first, r.card]), fresh: [fresh.first, fresh.card], held: [...held] }));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

flow('own routing: with no graph tiles for the trip, Valhalla plans it as before', async (page, base) => {
  graphDir = 'none';                                              // the shipped Cincinnati tiles cover this trip: hide them
  let out;
  try { out = await ownTrip(page, base); } finally { graphDir = null; }
  const { r, calls } = out;
  check(!r.own.covered && !r.own.used, 'not covered: ' + JSON.stringify(r.own));
  check(r.kinds.length >= 1 && !r.kinds.includes('own'), 'only the router\'s candidates: ' + JSON.stringify(r.kinds));
  check(calls.trace.length === 0 && calls.route.length >= 1, 'no instructions asked for: the router gave its own');
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

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
  // U-70: the card rises with the route, Start on it; Cancel puts it down to the bar, where Start is
  check(await page.isVisible('#routeDriveBtn') && await page.evaluate(() => document.getElementById('planPanel').classList.contains('open') && document.getElementById('routeDriveBtn').textContent.trim() === 'Start'), 'the route card is up with Start');
  // U-73: the place's name has the row, its town under it in pencil, the distance as the stamp
  check(await page.evaluate(() => { const r = document.querySelector('#placeList .place'); return !r || (r.querySelector('small') || {}).textContent === 'Tennessee'; }), 'the suggestion row: name, then town');
  await page.click('#planCancel');
  check(await page.isVisible('#startDrive') && await page.evaluate(() => document.getElementById('startDrive').textContent.trim()) === 'Start', 'Start is offered');
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
  // the re-plan round the closure ranks with the route context (up to its 4 s budget): wait for it, then put its card down
  await page.waitForFunction(() => !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 15000 });
  if (await page.isVisible('#planCancel')) await page.click('#planCancel');   // the rebuilt route's card is up (U-70)
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

flow('the chosen route stays whole on screen: above the card when it opens, above the bar when it goes down (panel round 2 DA-2)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(JSON.parse(route.request().postData() || '{}').locations)) }));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.loaded() && window.apex, null, { timeout: 20000 });
  await page.waitForFunction(() => !!apexDebug.state.lastPosition, null, { timeout: 10000 });
  await page.evaluate(() => apexDebug.buildRoute([{ lat: 35.9606, lon: -83.9207 }, { lat: 36.06, lon: -83.80 }], 'to_x', 'To Winton Woods Middle School'));
  await page.waitForFunction(() => document.getElementById('planPanel').classList.contains('open') && apexDebug.track && apexDebug.track.kind === 'route', null, { timeout: 20000 });
  // the camera (not just the fit asked): both ends and the middle, and the car, inside the map above `edge`
  const framed = (edgeOf) => page.evaluate((edgeOf) => { const m = apexDebug.map, t = apexDebug.track, c = m.getContainer().getBoundingClientRect(), p = document.getElementById('planPanel');
    const edge = (edgeOf === 'card' ? p.getBoundingClientRect().top : document.getElementById('planBar').getBoundingClientRect().top) - c.top;
    const pts = [0, Math.floor(t.lat.length / 2), t.lat.length - 1].map((i) => m.project([t.lon[i], t.lat[i]]));
    return { ok: pts.every((q) => q.x >= 0 && q.x <= c.width && q.y >= 0 && q.y <= edge + 1), pts: pts.map((q) => [Math.round(q.x), Math.round(q.y)]), edge: Math.round(edge),
      open: p.classList.contains('open'), roomy: c.height - p.offsetHeight >= 120, follow: apexDebug.state.follow }; }, edgeOf);
  await page.waitForTimeout(1200);
  const up = await framed('card');
  check(!up.roomy || up.ok, 'open: the route whole above the card (when the card leaves room to see it): ' + JSON.stringify(up));
  await page.click('#routeBar');
  await page.waitForTimeout(1200);
  const down = await framed('bar');
  check(!down.open && down.ok && down.follow === false, 'down: the route whole above the bar, the car with it (planning/phone/006): ' + JSON.stringify(down));
  await page.click('#routeBar');
  await page.waitForTimeout(1200);
  const again = await framed('card');
  check(again.open && (!again.roomy || again.ok), 'up again: refitted above the card: ' + JSON.stringify(again));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('a road someone sent (#road=) opens as a route card: its name, through its points, nothing of the drive (panel round 2 DA-4)', async (page, base) => {
  const asked = [];
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req.locations);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  const L = require('../web/road_link.js'), lat = [], lon = [], dist = [];
  for (let i = 0; i < 1200; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 40) * 0.002); dist.push(i * 5); }
  const pts = L.roadPoints(lat, lon, dist), token = L.encode(pts, 'Cherohala Skyway');
  await page.goto(base + '/index.html#road=' + token);
  await page.waitForFunction(() => /Cherohala Skyway/.test(document.getElementById('routeCardName').textContent), null, { timeout: 20000 });
  const locs = asked[asked.length - 1];
  check(locs.length === pts.length + 1 && Math.abs(locs[0].lat - 35.9606) < 1e-3 && Math.abs(locs[1].lat - pts[0].lat) < 1e-5 && Math.abs(locs[locs.length - 1].lat - pts[pts.length - 1].lat) < 1e-5,
    'from here, then through the road: ' + JSON.stringify(locs));
  check(await page.evaluate(() => !/road=/.test(location.href)), 'the link leaves the address once read (a reload plans nothing)');
  await page.goto(base + '/index.html#road=r1.@@');
  await page.waitForFunction(() => /incomplete/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('your roads (panel D-1, R-1, D-2): a road you drove is on the deck and its page, Drive it again routes it, twisty roads on, the reminder only in the app', async (page, base) => {
  const asked = [];
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')   // a map that loads (DA-1 draws on it)
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    asked.push(req.locations);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  const fresh = await page.evaluate(() => ({ twisty: apexDebug.state.toggles.twisty, nudge: apexDebug.state.toggles.nudge, roads: document.querySelectorAll('#yourRoads .your-road').length }));
  check(fresh.twisty === true && fresh.nudge === false && fresh.roads === 0, 'first run: twisty roads on, the reminder off, no roads of yours yet: ' + JSON.stringify(fresh));
  await page.evaluate(async () => { const lat = [], lon = []; for (let i = 0; i < 400; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 20) * 0.0005); }
    await ApexRecording.store({ id: 'yr1', name: 'Cherohala Skyway', date: new Date(Date.now() - 86400e3).toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map((_, i) => Math.sin(i / 20) * 3), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }); });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#yourRoads .your-road', { timeout: 15000 });
  const deck = await page.evaluate(() => ({ first: document.getElementById('loopSuggest').innerText, rows: [...document.querySelectorAll('#yourRoads .your-road')].map((b) => b.innerText.replace(/\s+/g, ' ')) }));
  check(/^Loop from here/.test(deck.first) && deck.rows.length === 1 && /^Cherohala Skyway 1\.2 mi · 1 run Plan$/.test(deck.rows[0]),
    'the deck: the loop (no score, so no reason to name a road), then the road you drove: ' + JSON.stringify(deck));
  // DA-1 / KE-2 (panel round 2): the row's glyph is the road's own shape; its body draws the road on the map, fitted with you
  // in view, and a second tap clears it; the key routes it
  await page.waitForSelector('#yourRoads .your-road .ls-glyph svg.road-shape', { timeout: 10000 });
  await page.click('#yourRoads .your-road .ls-show');
  await page.waitForFunction(() => apexDebug.map.getSource('apex-deckroad-src') && apexDebug.map.getLayoutProperty('apex-deckroad', 'visibility') === 'visible', null, { timeout: 8000 });
  await page.waitForTimeout(1000);
  const shown = await page.evaluate(() => { const m = apexDebug.map, top = document.getElementById('planPanel').getBoundingClientRect().top - m.getContainer().getBoundingClientRect().top;
    const ends = [[-84.29, 35.36], [-84.29 + Math.sin(399 / 20) * 0.0005, 35.36 + 399 * 5 / 110540]].map((c) => m.project(c));
    return { pressed: document.querySelector('#yourRoads .ls-show').getAttribute('aria-pressed'), inView: ends.every((p) => p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= top), dash: !!m.getPaintProperty('apex-deckroad', 'line-dasharray'),
      ends: ends.map((p) => [Math.round(p.x), Math.round(p.y)]), top, route: !!apexDebug.track && apexDebug.track.kind === 'route' }; });
  check(shown.pressed === 'true' && shown.inView && shown.dash && !shown.route, 'the row draws its road, dashed, whole above the deck, and routes nothing: ' + JSON.stringify(shown));
  await page.click('#yourRoads .your-road .ls-show');
  check(await page.evaluate(() => apexDebug.map.getLayoutProperty('apex-deckroad', 'visibility') === 'none' && document.querySelector('#yourRoads .ls-show').getAttribute('aria-pressed') === 'false'), 'a second tap clears it');
  await page.click('#yourRoads .your-road .ls-go');
  await page.waitForFunction(() => /Cherohala Skyway/.test(document.getElementById('routeCardName').textContent), null, { timeout: 20000 });
  const locs = asked[asked.length - 1];
  check(locs.length >= 4 && Math.abs(locs[0].lat - 35.9606) < 1e-3 && Math.abs(locs[1].lat - 35.36) < 1e-3 && Math.abs(locs[locs.length - 1].lat - (35.36 + 399 * 5 / 110540)) < 1e-3,
    'Drive it again: from here to the drive\'s start, then along it to its end: ' + JSON.stringify(locs));
  // the reminder is the app's: on the website the switch says so and stays off
  await page.goto(base + '/index.html?view=garage');
  await page.waitForSelector('#garageGear', { state: 'visible' });
  await openSetting(page, 'nudge');
  await page.click('.garage-pop.open [data-toggle="nudge"]');
  const nudge = await page.evaluate(() => ({ on: apexDebug.state.toggles.nudge, note: document.getElementById('nudgeState').textContent }));
  check(nudge.on === false && /Vetta app on iPhone/.test(nudge.note), 'the reminder needs the app, and stays off: ' + JSON.stringify(nudge));
  // the drive's page: Drive it again next to Replay, and it plans the drive on the map
  await page.goto(base + '/analysis.html?tab=drive&drive=yr1');
  await page.waitForSelector('#dvAgain:not([hidden])', { timeout: 15000 });
  const n = asked.length;
  await page.click('#dvAgain');
  for (let t = 0; t < 100 && asked.length === n; t++) await page.waitForTimeout(200);   // the map page loads with ?again= and routes it
  check(asked.length > n, 'the drive\'s page planned it again');
  await page.waitForFunction(() => window.apexDebug && apexDebug.track && apexDebug.track.id === 'again' && /Cherohala Skyway/.test(document.getElementById('routeCardName').textContent), null, { timeout: 20000 });
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

flow('avoid police reports: with the chip on, live police reports near the trip go to the router as exclusions and the card says it went round (Worker and router stubbed, IDEAS R-35)', async (page, base) => {
  const bodies = [];
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}'); bodies.push(req);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(req.locations)) });
  });
  const soon = new Date(Date.now() + 40 * 60000).toISOString(), gone = new Date(Date.now() - 60000).toISOString();
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url());
    // a slow Worker (1.5 s): the plan never waits more than 0.2 s for it, and the router's requests still go round
    if (u.pathname === '/api/hazards') return new Promise((r) => setTimeout(r, 1500)).then(() => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { id: 'p1', kind: 'police', lat: 35.86, lon: -83.90, heading: null, confirms: 1, clears: 0, expires_at: soon, m: 0 },
      { id: 'p2', kind: 'police', lat: 35.80, lon: -83.91, heading: null, confirms: 0, clears: 3, expires_at: soon, m: 0 },
      { id: 'p3', kind: 'police', lat: 35.83, lon: -83.89, heading: null, confirms: 0, clears: 0, expires_at: gone, m: 0 }]) })).catch(() => {});
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.signedIn', '1'); localStorage.setItem('apex.avoid', JSON.stringify({ police: true })); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  check(await page.evaluate(() => document.querySelector('[data-avoid="police"]').getAttribute('aria-pressed')) === 'true', 'the Police reports chip shows it is on');
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route'; }, null, { timeout: 20000 });
  check(bodies.length && bodies.every((b) => JSON.stringify(b.exclude_locations) === JSON.stringify([{ lat: 35.86, lon: -83.90 }])),
    'every route request goes around the live report, not the cleared or the expired one: ' + JSON.stringify(bodies.map((b) => b.exclude_locations)));
  await page.waitForFunction(() => /Around a police report/.test(document.getElementById('routeCardSub').textContent), null, { timeout: 10000 });
  check(!/checkpoint/i.test(await page.textContent('#planPanel')), 'no checkpoint anywhere');
  const waited = await page.evaluate(() => apexDebug.policeWaitMs);
  check(Number.isFinite(waited) && waited <= 260, 'the route card\'s budget holds: the plan waited ' + waited + ' ms for the police reports');
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

// IN-1 / GR-2 (panel round 2): the pages that carry the drive follow the phone's text size, and hold a floor.
// What a page measures for a text size, set by hand: Chromium has no -apple-system-body (format.js applyTypeScale).
const TYPE_AT = (scale) => `(() => { const r = document.documentElement, t = ApexFormat.typeScales(${17 * scale});
  r.style.setProperty('--type-scale', String(t.scale)); r.style.setProperty('--type-scale-fit', String(t.fit));
  if (t.size) r.setAttribute('data-type-size', t.size); else r.removeAttribute('data-type-size');
  const st = document.querySelector('.stage'); if (st) st.scrollLeft = 0;   // headless Chromium scrolls the stage sideways on a click into Where to? (so does the base build)
  return t; })()`;
// Every visible element with words of its own under `sel`: cut off at the screen's sides, or inside its own box
const CUT = (sel) => `(() => { const W = innerWidth, out = [];
  for (const e of document.querySelectorAll('${sel} *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]')) continue;
    if (e.closest('.garage-pop:not(.open)')) continue;   // a closed Garage panel, parked off the screen
    const clips = /hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
    if (r.left < -1 || r.right > W + 1 || (clips && e.scrollWidth > e.clientWidth + 1)) out.push((e.id || e.className || e.tagName) + ':' + e.textContent.trim().slice(0, 24) + ' ' + [r.left, r.right, e.scrollWidth, e.clientWidth].map(Math.round).join('/'));
  }
  return out; })()`;
// prose under 17 px, or a key under 44 px either way
const FLOOR = (sel, prose) => `(() => { const out = [];
  for (const e of document.querySelectorAll('${sel} :is(${prose})')) {
    const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]')) continue;
    if (parseFloat(getComputedStyle(e).fontSize) < 17) out.push('text ' + (e.id || e.className) + ' ' + getComputedStyle(e).fontSize);
  }
  for (const e of document.querySelectorAll('${sel} button, ${sel} a.ink-btn, ${sel} a.linkbtn')) {
    const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]') || getComputedStyle(e).visibility === 'hidden') continue;
    if (r.height < 43.5 || r.width < 43.5) out.push('key ' + (e.id || e.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out; })()`;

flow('Dynamic Type (IN-1, GR-2): the route card, plan sheet, end card and the drive\'s page grow with the text size, cut nothing, and hold a 17 px and 44 pt floor', async (page, base) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubTrip(JSON.parse(route.request().postData()).locations)) }));
  await page.route(base + '/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  // the plan sheet: its floor at the normal size, nothing cut at 2x
  await page.click('#destInput');
  const planFloor = await page.evaluate(FLOOR('#planBody .plan-search-section', '.ctl-label small, p.note, .linkbtn, .plan-more > summary'));
  check(!planFloor.length, 'the plan sheet\'s floor: ' + JSON.stringify(planFloor));
  await page.evaluate(TYPE_AT(2));
  const planCut = await page.evaluate(CUT('#planBody'));
  check(!planCut.length, 'the plan sheet at 2x cuts nothing: ' + JSON.stringify(planCut));
  await page.evaluate(TYPE_AT(1));
  // the plan flow: what was the plan sheet's More is the Options sheet, held to the same floor and growing the same way
  await page.click('#planOptionsChip');
  await page.waitForSelector('#optSheet.open');
  const optFloor = await page.evaluate(FLOOR('#optSheet', '.ctl-label small, p.note, .linkbtn, .opt-mix > span'));
  check(!optFloor.length, 'the Options sheet\'s floor: ' + JSON.stringify(optFloor));
  await page.evaluate(TYPE_AT(2));
  const optCut = await page.evaluate(CUT('#optSheet'));
  check(!optCut.length, 'the Options sheet at 2x cuts nothing: ' + JSON.stringify(optCut));
  await page.evaluate(TYPE_AT(1));
  await page.click('#optDone');
  // the route card
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => !document.getElementById('routeCard').hidden && document.querySelector('#routeCardStats > div span'), null, { timeout: 20000 });
  const size = () => page.evaluate(() => { const f = document.querySelector('#routeCardStats > div span'), s = document.getElementById('routeCardStats');
    return {
      factH: f.getBoundingClientRect().height, cols: getComputedStyle(s).gridTemplateColumns.split(' ').length }; });
  const one = await size();
  const cardFloor = await page.evaluate(FLOOR('#routeCard', '.fact, .route-meta, p.note, .linkbtn, .rc-levels > button > b, .rc-levels-note, .rc-levels > button.further .rc-lv, .rc-progress'));
  check(!cardFloor.length, 'the route card\'s floor: ' + JSON.stringify(cardFloor));
  await page.evaluate(TYPE_AT(2));
  const two = await size();
  check(two.factH >= 1.5 * one.factH && two.cols === 2 && one.cols === 3, `the route card at 2x: its words at least 1.5x as big, the stats two a row: ${JSON.stringify({ one, two })}`);
  const cardCut = await page.evaluate(CUT('#routeCard'));
  check(!cardCut.length, 'the route card at 2x cuts nothing: ' + JSON.stringify(cardCut));
  check(await page.evaluate(() => { const b = document.getElementById('routeDriveBtn').getBoundingClientRect(); return b.height >= 44 && b.bottom <= innerHeight + 1; }), 'Start is whole and on screen at 2x');
  // the cockpit keeps its size (IN-2's rule: it does not scale)
  check(await page.evaluate(() => getComputedStyle(document.getElementById('notes')).zoom === '1'), 'the road book strip is not zoomed');
  // the end card: 1.6x at most, scrolls to its last key
  await page.evaluate(TYPE_AT(1));
  await page.evaluate(() => { const lat = [], lon = []; for (let i = 0; i < 300; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
    apexDebug.showEndCard({ id: 'dt1', name: 'Cherohala Skyway', date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }, Date.now() - 1800e3); });
  await page.waitForSelector('#endCard.show', { timeout: 8000 });
  const endFloor = await page.evaluate(FLOOR('#endCard', '.end-meta, .end-line, .linkbtn'));
  check(!endFloor.length, 'the end card\'s floor: ' + JSON.stringify(endFloor));
  const meta1 = await page.evaluate(() => document.getElementById('endMeta').getBoundingClientRect().height);
  await page.evaluate(TYPE_AT(2));
  const end = await page.evaluate(() => ({ zoom: getComputedStyle(document.querySelector('#endCard .end-card')).zoom, meta: document.getElementById('endMeta').getBoundingClientRect().height }));
  check(end.zoom === '1.6' && end.meta >= 1.5 * meta1, 'the end card at the largest size is 1.6x: ' + JSON.stringify({ end, meta1 }));
  const endCut = await page.evaluate(CUT('#endCard'));
  check(!endCut.length, 'the end card at 1.6x cuts nothing: ' + JSON.stringify(endCut));
  await page.evaluate(() => { const o = document.getElementById('endCard'); o.scrollTop = o.scrollHeight; });
  check(await page.evaluate(() => { const b = document.getElementById('endDone').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1; }), 'Done is reachable by scrolling the card');
  // the drive's page in the Log
  await page.evaluate(async () => { const lat = [], lon = []; for (let i = 0; i < 300; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
    await ApexRecording.store({ id: 'dt2', name: 'Cherohala Skyway', date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }); });
  await page.goto(base + '/analysis.html?tab=drive&drive=dt2');
  await page.waitForSelector('.dv-head', { timeout: 15000 });
  const logFloor = await page.evaluate(FLOOR('#tab-drive', '.note, .dv-meta, .linkbtn'));
  check(!logFloor.length, 'the drive page\'s floor: ' + JSON.stringify(logFloor));
  const t1 = await page.evaluate(() => document.getElementById('dvTitle').getBoundingClientRect().height);
  await page.evaluate(TYPE_AT(2));
  const t2 = await page.evaluate(() => document.getElementById('dvTitle').getBoundingClientRect().height);
  check(t2 >= 1.5 * t1, `the drive's page grows: title ${t1} -> ${t2}`);
  const logCut = await page.evaluate(CUT('#tab-drive'));
  check(!logCut.length, 'the drive page at 2x cuts nothing: ' + JSON.stringify(logCut));
  // GR-2: the Garage at the largest size fits too (its sections no longer set a width wider than the screen)
  await page.goto(base + '/index.html?view=garage');
  await page.waitForSelector('#garageGear', { state: 'visible' });
  await page.evaluate(TYPE_AT(2));
  await page.waitForTimeout(800);                                            // the sheet slides in
  const garageCut = await page.evaluate(CUT('#sheet .body'));
  check(!garageCut.length, 'the Garage at 2x cuts nothing: ' + JSON.stringify(garageCut));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('VoiceOver (AM-1/2/3): shut doors are out of reach, dialogs take focus and give it back, the strip and every instrument are said', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDoors && window.apexDebug && window.apexDebug.map);
  const reach = () => page.evaluate(() => {
    const out = (sel) => { const n = document.querySelector(sel); return !!n && !n.closest('[inert]') && getComputedStyle(n).visibility !== 'hidden'; };
    return { sheet: out('#sheet .body'), notes: out('#notes'), plan: out('#destInput'), map: out('#map'), tabs: out('#tabbar'), announcer: out('#announcer'),
      current: [...document.querySelectorAll('#tabbar .tab')].filter((t) => t.getAttribute('aria-current') === 'page').map((t) => t.dataset.view),
      focus: document.activeElement && (document.activeElement.id || document.activeElement.className) };
  });
  // AM-1: the closed Menu is out of the swipe order; the tab bar says where you are
  let r = await reach();
  check(!r.sheet && r.plan && r.tabs && JSON.stringify(r.current) === '["map"]', 'the closed Menu is unreachable, the map is current: ' + JSON.stringify(r));
  await page.click('#tabbar .tab[data-view="garage"]');
  await page.waitForTimeout(300);
  r = await reach();
  check(r.sheet && !r.notes && !r.plan && !r.map && r.tabs && r.announcer && JSON.stringify(r.current) === '["garage"]',
    'the open Garage is all that is reachable, with the tab bar and the announcer: ' + JSON.stringify(r));
  check(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), 'focus moves into the Garage');
  await page.click('#tabbar .tab[data-view="map"]');
  await page.waitForTimeout(400);
  r = await reach();
  check(!r.sheet && r.plan && r.map && !(await page.evaluate(() => document.querySelectorAll('[inert]').length)), 'closed again: nothing left inert, the Menu hidden: ' + JSON.stringify(r));
  // a dialog: focus into it, nothing behind it, and focus back to its opener
  await page.focus('#swTab');
  await page.evaluate(() => { const lat = [], lon = []; for (let i = 0; i < 200; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
    apexDebug.showEndCard({ id: 'am1', name: 'Cherohala Skyway', date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }, Date.now() - 1800e3); });
  await page.waitForSelector('#endCard.show');
  await page.waitForTimeout(200);
  const dlg = await page.evaluate(() => ({ inCard: document.getElementById('endCard').contains(document.activeElement), focus: document.activeElement.id,
    tabs: !!document.getElementById('tabbar').closest('[inert]'), notes: !!document.getElementById('notes').closest('[inert]'), card: !!document.getElementById('endCard').closest('[inert]') }));
  check(dlg.inCard && dlg.tabs && dlg.notes && !dlg.card, 'the end card takes focus and shuts everything behind it: ' + JSON.stringify(dlg));
  await page.click('#endDone');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ focus: document.activeElement.id, inert: document.querySelectorAll('[inert]').length }));
  check(after.focus === 'swTab' && after.inert === 0, 'Done gives focus back to what opened it: ' + JSON.stringify(after));
  // AM-2 and AM-3 in a drive: the strip and the instruments, said
  await page.evaluate(async () => {
    const f = (i) => ({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked' });
    for (let i = 0; i < 30; i++) { window.apex.live(f(i)); await new Promise(r => setTimeout(r, 60)); }
  });
  await page.waitForTimeout(1100);   // the names change at most once a second
  const said = await page.evaluate(() => {
    const n = document.getElementById('notes'), s = document.getElementById('notesSaid'), a = (sel) => { const e = document.querySelector(sel); return e && e.getAttribute('aria-label'); };
    const sight = document.querySelector('#cluster .ro-sight');
    return { role: n.getAttribute('role'), label: n.getAttribute('aria-label'), live: n.getAttribute('aria-live') || (s && s.getAttribute('aria-live')),
      said: s && s.textContent, last: n.lastElementChild === s, boxes: [...n.children].filter((c) => c !== s).every((c) => c.getAttribute('aria-hidden') === 'true'),
      speed: a('#cluster .dial-speed'), limit: a('#cluster .ro-limit'), sight: a('#cluster .ro-sight'), score: a('#cluster .g-score'), grip: a('#cluster .dial-g > svg'),
      means: sight && sight.getAttribute('aria-describedby') && (document.getElementById(sight.getAttribute('aria-describedby')) || {}).textContent,
      map: document.getElementById('map').getAttribute('aria-hidden'), live2: document.getElementById('app').classList.contains('live') };
  });
  check(said.role === 'group' && said.label === 'Road book' && !said.live && said.said && said.last && said.boxes, 'the road book is one named group, said on demand, its boxes hidden: ' + JSON.stringify(said));
  check(/^27 miles per hour, Speed$/.test(said.speed) && /^(\d+ miles per hour|unknown), Speed limit$/.test(said.limit) && /, Sight/.test(said.sight) && /^(\d+|unknown), Vetta Score$/.test(said.score) && /, Grip$/.test(said.grip),
    'every instrument named value first: ' + JSON.stringify(said));
  check(/stop from within what you can see/.test(said.means || ''), 'Sight says what it means');
  check(!said.live2 || said.map === 'true', 'the map is hidden from VoiceOver while driving: ' + JSON.stringify(said));
});

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
  check(await page.evaluate(() => document.getElementById('planPanel').classList.contains('open')), 'the GPX route opens its card (U-70)');
  await page.click('#planCancel');
  await page.click('#planClear');
  await page.click('#destInput');
  await page.fill('#destInput', 'https://www.google.com/maps/dir/35.9606,-83.9207/35.80,-83.95/35.7565,-83.97/@35.8,-83.9,11z');
  await page.press('#destInput', 'Enter');
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.id === 'route_link', null, { timeout: 20000 });
  const locs = bodies[bodies.length - 1].locations.map((l) => [l.lat, l.lon]);
  check(JSON.stringify(locs) === JSON.stringify([[35.9606, -83.9207], [35.8, -83.95], [35.7565, -83.97]]), 'the link\'s stops, in order: ' + JSON.stringify(locs));
}, { geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });

flow('a GPX route has a time from its own envelope (U-64); the Live Activity reads QUIET and the next corner on it, REC in a free drive, never "--" (U-61)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__act = []; window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'activity') window.__act.push(m); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport && window.apex);
  // 4 km straight north, then a winding 1.5 km: no note in the first 3 km, a corner further on
  const pts = [];
  for (let i = 0; i <= 200; i++) pts.push([35.5 + i * 2e-4, -83.9]);
  for (let i = 1; i <= 150; i++) pts.push([35.54 + i * 1e-4, -83.9 + Math.sin(i / 6) * 6e-4]);
  const gpx = pts.map(([la, lo]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'ridge.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Ridge run</name><trkseg>${gpx}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Ridge run', null, { timeout: 10000 });
  const t = await page.evaluate(() => ({ s: apexDebug.track.timeS, from: apexDebug.track.timeFrom, bar: document.getElementById('routeBarMeta').textContent, card: document.getElementById('routeCardMeta').textContent }));
  check(t.from === 'envelope' && t.s > 60 && t.s < 3600, 'the envelope\'s time: ' + JSON.stringify(t));
  check(/ · \d+ min · \d+ corners/.test(t.bar) && /\d+ min/.test(t.card) && !/traffic/i.test(t.bar + t.card), 'the bar and the card show it: ' + JSON.stringify(t));
  // on the route, nothing within 3 km: a short word and the next corner, the island's distance left to the record dot
  await page.evaluate(() => window.apex.live({ lat: 35.5, lon: -83.9, accuracy_m: 5, speed_mps: 0, course_deg: 0, has_fix: true }));
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start' }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  await page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.apex.live({ lat: 35.5 + i * 1e-5, lon: -83.9, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked' }); await new Promise(r => setTimeout(r, 120)); } });
  await page.waitForFunction(() => window.__act.some((m) => m.action === 'update'), null, { timeout: 5000 });
  const q = await page.evaluate(() => window.__act.filter((m) => m.action === 'update').pop());
  check(q.short === 'QUIET' && q.distance === '' && /^Quiet · next corner \d+(\.\d)? (mi|km)$/.test(q.note), 'quiet on the route: ' + JSON.stringify(q));
  check(/min/.test(q.etaShort), 'the envelope\'s time reaches the island: ' + JSON.stringify(q));
  check(/^\d+(\.\d)? (MI|KM)$/.test(q.trail), 'U-131: the compact island shows the next corner\'s distance, not a clipped QUIET: ' + JSON.stringify(q));
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  await page.waitForFunction(() => !window.apexDebug.driveActive);
  // a free drive: REC, and how far you have driven
  await page.click('#planClear');
  await page.evaluate(() => { window.__act = []; window.apex.onNative({ type: 'carplay', action: 'start' }); });
  await page.waitForFunction(() => window.apexDebug.driveActive);
  await page.evaluate(async () => { for (let i = 0; i < 12; i++) { window.apex.live({ lat: 35.6 + i * 1e-4, lon: -84.1, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked' }); await new Promise(r => setTimeout(r, 120)); } });
  await page.waitForFunction(() => window.__act.some((m) => m.action === 'update'), null, { timeout: 5000 });
  const r = await page.evaluate(() => window.__act.filter((m) => m.action === 'update').pop());
  check(r.short === 'REC' && r.distance === '' && /^Recording( · \d+\.\d (mi|km))?$/.test(r.note), 'a free drive: ' + JSON.stringify(r));
}, { geolocation: { latitude: 35.5, longitude: -83.9 }, permissions: ['geolocation'] });

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
  check(r.corners.list.every((c) => Array.isArray(c.at) && /^(HAIRPIN|SQUARE|TIGHT|MEDIUM|OPEN|EASY|SLIGHT) [LR]$/.test(c.text)), 'every corner placed and rated, in the plain words a new driver gets (panel M-3): ' + JSON.stringify(r.corners.list.slice(0, 3)));
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

flow('CarPlay: the car is in every drive: a free drive from its Drive key, a continue step, End goes idle (U-59, U-62, U-63, U-79)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__car = []; window.webkit = { messageHandlers: { apex: { postMessage(m) { if (m && m.cmd === 'car') window.__car.push(m); } } } }; });
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.9700, 35.7565] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    if (!req.locations) return route.abort();
    // a straight road for 10 km, then a right turn: the first card is a continue step, not a turn 6 miles away
    const t = stubTrip(req.locations), a = req.locations[0], b = req.locations[req.locations.length - 1], pts = [];
    for (let i = 0; i <= 400; i++) pts.push([a.lat + (b.lat - a.lat) * i / 400, a.lon + (b.lon - a.lon) * i / 400]);
    t.trip.legs[0].shape = polyline6(pts);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(t) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  const fix = (speed = 0) => page.evaluate((v) => window.apex.live({ lat: 35.6, lon: -84.1, accuracy_m: 5, speed_mps: v, course_deg: 45, has_fix: true }), speed);
  await fix();
  // the idle car's Drive key sends start: a free drive, and the car is told it has begun, with the record card
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'start' }); });
  await page.waitForFunction(() => window.apexDebug.driveActive);
  check(await page.evaluate(() => window.__car.some((m) => m.kind === 'start' && m.title === 'Drive')), 'a free drive tells the car: ' + JSON.stringify(await page.evaluate(() => window.__car.map((m) => m.kind))));
  await fix(); await page.waitForTimeout(250); await fix();
  await page.waitForFunction(() => window.__car.some((m) => m.kind === 'guide' && m.recording), null, { timeout: 5000 });
  const rec = await page.evaluate(() => window.__car.find((m) => m.kind === 'guide' && m.recording));
  check(rec.instruction === 'Recording · the road ahead' && JSON.stringify(rec.short) === '["Recording"]' && rec.distM === undefined && typeof rec.symbol === 'string' && rec.symbol.length > 200,
    'the record card, no distance to a maneuver that is not there, the record dot drawn: ' + JSON.stringify({ ...rec, symbol: !!rec.symbol }));
  // I-3: the car's End has the phone's Undo window: the drive goes on, the car is told (its alert's one action is Undo)
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'end' }); });
  const ending = await page.evaluate(() => ({ active: window.apexDebug.driveActive, kinds: window.__car.map((m) => m.kind), key: document.getElementById('driveEnd').textContent }));
  check(ending.active && ending.kinds.includes('ending') && !ending.kinds.includes('end') && ending.key === 'Undo', 'End from the car: the Undo window, the drive still on: ' + JSON.stringify(ending));
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'undo' }); });
  const undone = await page.evaluate(() => ({ active: window.apexDebug.driveActive, kinds: window.__car.map((m) => m.kind), key: document.getElementById('driveEnd').textContent }));
  check(undone.active && undone.kinds.includes('resumed') && undone.key === 'End', 'Undo from the car: the drive goes on: ' + JSON.stringify(undone));
  await page.evaluate(() => { window.__car = []; for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  await page.waitForFunction(() => !window.apexDebug.driveActive);
  check(await page.evaluate(() => window.__car.some((m) => m.kind === 'end')), 'End from the car, End again: it ends now');
  // a route: planned from the car, driven, a continue step while its first turn is 6 miles off; after End the car goes idle
  await fix();
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'go', lat: 35.7565, lon: -83.97, name: 'Maryville' }));
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && window.__car.some((m) => m.kind === 'route'); }, null, { timeout: 20000 });
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'start' }); });
  await page.waitForFunction(() => window.apexDebug.driveActive);
  await fix(); await page.waitForTimeout(250); await fix(0.5);
  await page.waitForFunction(() => window.__car.some((m) => m.kind === 'guide'), null, { timeout: 5000 });
  const kinds = await page.evaluate(() => window.__car.map((m) => m.kind));
  check(kinds.indexOf('start') >= 0 && kinds.indexOf('start') < kinds.indexOf('guide'), 'start before the first maneuver: ' + kinds.join());
  const g = await page.evaluate(() => window.__car.find((m) => m.kind === 'guide'));
  check(g.follow === true && g.type === 8 && /^Follow /.test(g.instruction) && g.distM > 2000 && !g.corner, 'a continue step to the far turn: ' + JSON.stringify({ ...g, symbol: !!g.symbol }));
  await page.evaluate(() => { window.__car = []; for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  await page.waitForFunction(() => !window.apexDebug.driveActive);
  const after = await page.evaluate(() => window.__car.map((m) => m.kind));
  check(after.indexOf('end') >= 0 && after.indexOf('clear') > after.indexOf('end') && !after.includes('route'), 'after End the car is idle, no preview of the finished route: ' + after.join());
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'hello' }); });
  await page.waitForTimeout(200);
  check(!(await page.evaluate(() => window.__car.some((m) => m.kind === 'route' || m.kind === 'start'))), 'a car that connects later is not offered the finished route either');
  // the idle car's Drive now is a free drive, not the finished route guided along unseen
  await page.evaluate(() => { window.__car = []; window.apex.onNative({ type: 'carplay', action: 'start', free: true }); });
  await page.waitForFunction(() => window.apexDebug.driveActive);
  await fix(); await page.waitForTimeout(250); await fix();
  await page.waitForFunction(() => window.__car.some((m) => m.kind === 'guide'), null, { timeout: 5000 });
  const free = await page.evaluate(() => ({ start: window.__car.find((m) => m.kind === 'start'), guide: window.__car.find((m) => m.kind === 'guide'), track: window.apexDebug.track ? window.apexDebug.track.kind : null }));
  check(free.start.title === 'Drive' && free.guide.recording === true && free.track !== 'route', 'Drive from the idle car is a free drive: ' + JSON.stringify({ ...free, guide: free.guide.instruction }));
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  await page.waitForFunction(() => !window.apexDebug.driveActive);
});

flow('turn by turn in road order: exit 19, then the sharp right a mile on, on the car and in the voice, a ladder said once each (the owner\'s drive, 2026-10-30)', async (page, base) => {
  // the owner on CarPlay: "'take exit 19 in 0.1 miles', then 'sharp right in 1 mile', then 'take exit 19'. This is bad and
  // confusing." A motorway north, exit 19 at 5 km, a right bend on the ramp, a sharp right onto Main St a mile past the exit.
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    window.__car = []; window.__said = []; window.APEX_REVIEW = true;
    window.webkit = { messageHandlers: { apex: { postMessage(m) {
      const at = window.apexDebug ? window.apexDebug.state.cursorM : null;
      if (m && m.cmd === 'car') window.__car.push({ ...m, symbol: undefined, at });
      if (m && m.cmd === 'said') window.__said.push({ text: m.text, at });
    } } } }; });
  const KY = 110540, KX = 111320 * Math.cos(35.5 * Math.PI / 180), P = [];   // [north m, east m]
  for (let y = 0; y <= 5150; y += 10) P.push([y, 0]);
  const EXIT = 500;                                                    // the shape index at 5000 m
  for (let a = 6; a <= 90; a += 6) { const r = a * Math.PI / 180; P.push([5150 + 60 * Math.sin(r), 60 - 60 * Math.cos(r)]); }
  for (let x = 70; x <= 1430; x += 10) P.push([5210, x]);
  const SHARP = P.length - 1;                                          // 1.6 km (a mile) past the exit
  for (let k = 1; k <= 100; k++) P.push([5210 - k * 10 * Math.SQRT1_2, 1430 - k * 10 * Math.SQRT1_2]);
  const LL = P.map(([n, e]) => [35.5 + n / KY, -83.9 + e / KX]), end = LL[LL.length - 1];
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [end[1], end[0]] }, properties: { name: 'Downtown', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    if (!req.locations) return route.abort();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trip: { legs: [{ shape: polyline6(LL), maneuvers: [
      { type: 1, begin_shape_index: 0, length: 5, time: 160, street_names: ['I-75 North'] },
      { type: 20, begin_shape_index: EXIT, length: 1.6, time: 80, street_names: ['Exit 19'], sign: { exit_number_elements: [{ text: '19' }], exit_toward_elements: [{ text: 'Downtown' }] } },
      { type: 11, begin_shape_index: SHARP, length: 1, time: 60, street_names: ['Main St'] },
      { type: 4, begin_shape_index: LL.length - 1, length: 0, time: 0 }] }],
      summary: { length: 7.6, time: 300, has_highway: true, has_toll: false, has_ferry: false } } }) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function' && window.apexDebug);
  await page.evaluate(([lat, lon]) => window.apex.live({ lat, lon, accuracy_m: 5, speed_mps: 0, course_deg: 0, has_fix: true }), LL[0]);
  await page.evaluate(([lat, lon]) => window.apex.onNative({ type: 'carplay', action: 'go', lat, lon, name: 'Downtown' }), end);
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && (t.steps || []).length >= 3; }, null, { timeout: 20000 });
  const steps = await page.evaluate(() => apexDebug.track.steps.map((s) => ({ m: s.m, type: s.type })));
  const exitM = steps.find((s) => s.type === 20).m;
  await page.evaluate(() => { window.__car = []; window.__said = []; window.apex.onNative({ type: 'carplay', action: 'start' }); });
  await page.waitForFunction(() => window.apexDebug.driveActive);
  // drive it at 31 m/s (70 mph) from 2.5 km, a fix every 20 m; at the diverge GPS runs the car 40 m past the exit, then
  // drops it back over it for two fixes (the turn must stay taken)
  const n = await page.evaluate(() => apexDebug.track.lat.length);
  const idxAt = (m) => page.evaluate((m) => apexDebug.track.dist.findIndex((d) => d >= m), m);
  const send = (i) => page.evaluate((i) => { const t = apexDebug.track, a = Math.max(0, i - 2), b = Math.min(t.lat.length - 1, i + 2);
    const crs = (Math.atan2((t.lon[b] - t.lon[a]) * Math.cos(t.lat[i] * Math.PI / 180), t.lat[b] - t.lat[a]) * 180 / Math.PI + 360) % 360;
    window.apex.live({ lat: t.lat[i], lon: t.lon[i], accuracy_m: 5, speed_mps: 31, course_deg: crs, has_fix: true, lat_g: 0, lon_g: 0, calibration: 'locked', thermal: 0 }); }, i);
  const back = await idxAt(exitM + 15);
  let jittered = false;
  for (let m = 2500; ; m += 20) {
    const i = await idxAt(m);
    if (i < 0 || i >= n - 3) break;
    await send(i); await page.waitForTimeout(110);
    if (!jittered && m >= exitM + 40) { jittered = true; for (let k = 0; k < 2; k++) { await send(back); await page.waitForTimeout(170); } }
  }
  const said = await page.evaluate(() => window.__said.slice());
  const guides = await page.evaluate(() => window.__car.filter((m) => m.kind === 'guide'));
  const lines = said.map((s) => s.text);
  // the voice: the exit's ladder (far, near, at the turn) once each, all of it before anything about Main St, and nothing
  // past the exit (Main St, the ramp's bend) said before the exit's own call at the turn
  const exitLines = lines.filter((t) => /exit 19/.test(t)), mainLines = lines.filter((t) => /Main St/.test(t));
  check(exitLines.length === 3 && /^In .*, take exit 19 toward Downtown$/.test(exitLines[0]) && /^In .*, take exit 19 toward Downtown$/.test(exitLines[1])
    && exitLines[2] === 'Take exit 19 toward Downtown', 'the exit is a ladder said once each: ' + JSON.stringify(lines));
  check(mainLines.length === 3 && mainLines[2] === 'Sharp right onto Main St', 'the sharp right is a ladder said once each: ' + JSON.stringify(lines));
  const lastExit = lines.lastIndexOf('Take exit 19 toward Downtown'), firstMain = lines.findIndex((t) => /Main St/.test(t));
  check(lastExit >= 0 && firstMain > lastExit, 'the exit, all of it, before the sharp right: ' + JSON.stringify(lines));
  check(said.filter((s) => /Main St/.test(s.text)).every((s) => s.at > exitM), 'Main St only once the exit is taken: ' + JSON.stringify(said));
  const firstExit = lines.findIndex((t) => /exit 19/.test(t));
  check(!lines.slice(firstExit, lastExit).some((t) => /^(Right|Left|Tight|Medium|Open|Easy|Very|Hairpin|Sharp)/i.test(t)), 'no corner call among the exit\'s prompts: ' + JSON.stringify(lines));
  check(new Set(lines.filter((t) => /exit 19|Main St|Arriving/.test(t))).size === lines.filter((t) => /exit 19|Main St|Arriving/.test(t)).length, 'no prompt repeated: ' + JSON.stringify(lines));
  // the car: one maneuver at a time in road order, never back to one it has left (the owner's card: exit, sharp right, exit)
  const runs = []; for (const g of guides) if (!runs.length || runs[runs.length - 1].instruction !== g.instruction) runs.push(g);
  const names = runs.map((g) => g.instruction);
  check(new Set(names).size === names.length, 'the card never goes back to a maneuver it left: ' + JSON.stringify(names));
  const ei = names.indexOf('Take exit 19 toward Downtown'), mi = names.indexOf('Sharp right onto Main St');
  check(ei >= 0 && mi > ei, 'the card has the exit, then the sharp right: ' + JSON.stringify(names));
  check(guides.filter((g) => g.instruction === 'Sharp right onto Main St').every((g) => g.at > exitM), 'the sharp right is on the card only past the exit: '
    + JSON.stringify(guides.map((g) => [g.instruction, Math.round(g.at)])));
});

flow('the sight-line speed rides under the position arrow, on the phone and on the car map (the owner, 2026-10-29)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  await page.waitForFunction(() => { const t = document.querySelector('.sight-tag'); return t && !t.hidden; }, null, { timeout: 10000 });
  const tag = await page.textContent('.sight-tag');
  const cell = await page.textContent('#cluster');
  // panel round 2 (TH-2, IN-3): the tag names itself, SIGHT and the number, no unit (never a limit sign); OPEN draws nothing
  check(/^(SIGHT|SLOW)\d+$/.test(tag.trim()), 'the tag reads SIGHT and a speed: ' + tag);
  check(cell.includes(tag.replace(/\D/g, '')), 'the same value as the Sight cell: ' + tag);
  // U-60: it holds still: a new value needs 2 s, so 1.5 s of glances see at most one change, in steps of 5
  const glances = await page.evaluate(async () => { const out = []; for (let i = 0; i < 16; i++) { const t = document.querySelector('.sight-tag'); out.push(t.hidden ? '' : t.textContent); await new Promise(r => setTimeout(r, 100)); } return out; });
  check(glances.filter((g, i) => i && g !== glances[i - 1]).length <= 1, 'the plate holds still: ' + glances.join(' '));
  check(glances.every((g) => !g || /^(SIGHT|SLOW)\d*[05]$/.test(g)), 'in steps of 5: ' + glances.join(' '));
  // the car's map: the same tag under its arrow, hidden when unknown, red when short. A bare style, so the map loads and its
  // camera follows the car (a plate off the screen is hidden, U-77)
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.goto(base + '/carmap.html');
  await page.waitForFunction(() => window.car && document.querySelector('.car-sight') && car.map.loaded());
  const read = () => page.evaluate(() => { const t = document.querySelector('.car-sight'); return { hidden: t.hidden, text: t.textContent, short: t.classList.contains('short') }; });
  await page.evaluate(() => { car.position(35.4, -84.1, 90); car.sight({ text: null }); });
  check((await read()).hidden, 'unknown: no tag');
  await page.evaluate(() => car.sight({ text: '43', unit: 'MPH', short: true }));
  const r = await read();
  check(!r.hidden && r.text === 'SLOW43' && r.short, 'the car tag, over it: ' + JSON.stringify(r));
  await page.evaluate(() => car.sight({ text: '45', unit: 'MPH', short: false }));
  const r2 = await read(), bg = await page.evaluate(() => getComputedStyle(document.querySelector('.car-sight')).backgroundColor);
  check(!r2.hidden && r2.text === 'SIGHT45' && !r2.short && bg === 'rgb(17, 17, 17)', 'the car tag names itself on the dark plate: ' + JSON.stringify(r2) + bg);
  await page.evaluate(() => car.sight({ text: 'OPEN', unit: '', short: false }));
  check((await read()).hidden, 'OPEN: no plate on the car (TH-2)');
  await page.evaluate(() => car.sight({ text: '43', unit: 'MPH', short: true }));
  // plates never pile up: three corners on one spot show one plate, the tight one when there is no car to measure from
  await page.evaluate(() => { car.mode('preview'); car.corners([{ at: [35.41, -84.1], text: 'R4', tight: false }, { at: [35.41, -84.1], text: 'L2', tight: true }, { at: [35.41001, -84.1], text: 'R3', tight: false }]); });
  await page.waitForTimeout(300);
  const vis = await page.evaluate(() => [...document.querySelectorAll('.car-corner')].filter((e) => e.style.visibility !== 'hidden').map((e) => e.textContent));
  check(vis.length === 1, 'one plate where three overlap: ' + vis.join());
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.car-puck')).zIndex === '3'), 'the car above the plates');
  // U-77: as guidance begins no plate sits on the car's arrow or its sight plate; the one further up the road stays
  await page.evaluate(() => { car.corners([{ at: [35.4, -84.1], text: 'R1', tight: true }, { at: [35.39985, -84.1], text: 'R2', tight: true }, { at: [35.4, -84.097], text: 'L3', tight: false }]); car.mode('guide'); });   // L3 up the road (east, the car's heading), on the screen
  await page.waitForTimeout(900);
  const clear = await page.evaluate(() => {
    const boxes = [document.querySelector('.car-puck'), document.querySelector('.car-sight')].map((e) => e.getBoundingClientRect());
    return [...document.querySelectorAll('.car-corner')].filter((e) => e.style.visibility !== 'hidden').map((e) => {
      const b = e.getBoundingClientRect();
      return { text: e.textContent, onCar: boxes.some((c) => b.left < c.right && b.right > c.left && b.top < c.bottom && b.bottom > c.top) };
    });
  });
  check(clear.every((p) => !p.onCar) && !clear.some((p) => p.text === 'R1' || p.text === 'R2') && clear.some((p) => p.text === 'L3'), 'plates clear of the arrow and sight: ' + JSON.stringify(clear));
  // REVIEW4 U-77 / U-74 (check): Apple's card covers the left `inset`: no plate under it, none cut by an edge, and the hazard
  // just reported at the car shows beside the arrow, not hidden by it. On a car's screen (the smallest CarPlay one, 800 × 480)
  await page.setViewportSize({ width: 800, height: 480 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const W = innerWidth; car.inset(Math.round(W * 0.36));
    const m = car.map, ll = (x, y) => { const p = m.unproject([x, y]); return [p.lat, p.lng]; }, H = innerHeight;
    car.corners([{ at: ll(W * 0.3, H * 0.4), text: 'L4', tight: false }, { at: ll(W * 0.36 + 10, H * 0.3), text: 'R3', tight: false }, { at: ll(W - 4, H * 0.3), text: 'L5', tight: false },
      { at: ll(W * 0.75, H * 0.25), text: 'R6', tight: false }]);
    car.hazards([{ at: [car.state.pos.lat, car.state.pos.lon], title: 'Gravel' }]); });
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => { const inset = car.state.inset, W = innerWidth, H = innerHeight, puck = document.querySelector('.car-puck').getBoundingClientRect();
    return [...document.querySelectorAll('.car-plate')].filter((e) => e.style.visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect();
      return { text: e.textContent, underCard: b.left < inset + 16, cut: b.left < 0 || b.top < 0 || b.right > W || b.bottom > H,
        onCar: b.left < puck.right && b.right > puck.left && b.top < puck.bottom && b.bottom > puck.top }; }); });
  check(card.every((p) => !p.underCard && !p.cut && !p.onCar), 'no plate under the card, cut at an edge or on the car: ' + JSON.stringify(card));
  check(card.some((p) => p.text === 'GRAVEL') && card.some((p) => p.text === 'R6'), 'the reported hazard shows beside the car, and a corner in the clear: ' + JSON.stringify(card));
  // U-89: the credit on its own strip of ground, so no map label shows under it
  check(await page.evaluate(() => { const s = getComputedStyle(document.getElementById('credit')); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.opacity === '1'; }), 'the credit sits on a solid strip');
});

// Panel round 2, build A (IN-3, PR-2, GR-1, HE-1, PR-1): one red that means act now. In the demo replay the Sight cell is
// ink, Bank says "--" with no measurement, and a sight line forced short (20 m) makes the cell the alarm on two channels:
// the signal colour plus the hatched edge, the barred eye and SLOW; in greyscale it still differs from the reading. A tap on
// an instrument in a replay opens what it means; Done closes it.
flow('one red that means act now: Sight is ink until you are over it, then colour and shape and a word; Bank -- unmeasured; a tap explains in a replay', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full', nightMode: 'off' })); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge&play=1');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.state.playing, null, { timeout: 15000 });
  await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * 0.45; });
  await page.waitForTimeout(1500);
  const cellOf = () => page.evaluate(() => {
    const c = document.querySelector('.ro-sight'), b = c.querySelector('b'), cs = getComputedStyle(c), bar = c.querySelector('.ro-eye-bar');
    const grey = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return Math.round(0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]); };
    return { short: c.classList.contains('short'), label: c.querySelector('span').textContent, color: getComputedStyle(b).color, image: cs.borderImageSource,
      width: cs.borderTopWidth, bar: !!bar && getComputedStyle(bar).display !== 'none', grey: grey(getComputedStyle(b).color),
      ink: getComputedStyle(document.documentElement).getPropertyValue('--panel-ink').trim(), signal: getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() };
  });
  const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  // the sight line opened right up (nothing ahead limits you) and the speed under the corner's pace: a reading, not an alarm
  await page.evaluate(() => { const t = window.apexDebug.track; t.sightM = t.sightM.map(() => 400); t.envMps = t.envMps.map(() => 60); });
  await page.waitForFunction(() => !document.querySelector('.ro-sight.short'), null, { timeout: 8000 });
  const calm = await cellOf();
  check(!calm.short && calm.label === 'Sight' && hex(calm.color) === calm.ink.toUpperCase() && calm.image === 'none' && !calm.bar, 'Sight is a reading, in ink: ' + JSON.stringify(calm));
  // the g-ball and Bank are readings too; with the drive's camber taken away Bank says --, never +0.0°
  await page.evaluate(() => { window.apexDebug.track.camberDeg = null; });
  await page.waitForFunction(() => (document.querySelector('.dial-digital.small') || {}).textContent === 'BANK --', null, { timeout: 5000 });
  const ball = await page.evaluate(() => [...document.querySelectorAll('.dial-g circle')].pop().getAttribute('fill'));
  check(!/signal|accent/.test(ball), 'the ball is ink: ' + ball);
  // a sight line forced to 20 m: faster than Sight, the alarm
  await page.evaluate(() => { const t = window.apexDebug.track; t.sightM = t.sightM.map(() => 20); });
  await page.waitForFunction(() => document.querySelector('.ro-sight.short'), null, { timeout: 8000 });
  const loud = await cellOf();
  check(loud.label === 'SLOW' && hex(loud.color) === loud.signal.toUpperCase() && loud.image !== 'none' && loud.bar && loud.width === '2px',
    'over Sight: the signal colour, the hatched edge, the barred eye and SLOW: ' + JSON.stringify(loud));
  check(loud.grey !== calm.grey || loud.label !== calm.label, 'in greyscale the alarm still differs from the reading');
  await page.waitForFunction(() => { const t = document.querySelector('.sight-tag'); return t && !t.hidden && t.classList.contains('short'); }, null, { timeout: 8000 });
  check(/^SLOW\d+$/.test((await page.textContent('.sight-tag')).trim()), 'the plate says SLOW: ' + await page.textContent('.sight-tag'));
  // PR-1: in a replay a tap on Sight, then the Score, says what it is; Done closes it
  await page.click('#cluster .ro-sight');
  await page.waitForSelector('#explainCard.show', { timeout: 3000 });
  const sheet = await page.evaluate(() => ({ title: document.getElementById('explainTitle').textContent, what: document.getElementById('explainWhat').textContent,
    how: document.getElementById('explainHow').textContent, now: document.getElementById('explainNow').textContent }));
  check(sheet.title === 'Sight' && /never a target/.test(sheet.what) && /SLOW/.test(sheet.how) && /^Now: \d+ (mph|km\/h)$/.test(sheet.now), 'the Sight sheet: ' + JSON.stringify(sheet));
  await page.click('#explainDone');
  check(!(await page.evaluate(() => document.getElementById('explainCard').classList.contains('show'))), 'Done closes it');
  await page.click('#cluster .g-score');
  await page.waitForSelector('#explainCard.show', { timeout: 3000 });
  check(await page.textContent('#explainTitle') === 'Vetta Score', 'the Score explains itself');
  await page.click('#explainDone');
});

// The owner's first CarPlay drive (2026-10-30): the car map was "incredibly stuttery and unusable". It jumped to each 1 Hz
// fix and sat still in between, and every message (the shell repeats a fix every 0.4 s, and says the mode on every layout
// pass) cost a frame or more: the camera eased again, every plate was torn down and rebuilt and measured. A 30 s drive on
// a car's screen (800 × 480) with the CPU at a quarter speed, fed as the shell feeds it: the map moves every frame at the
// car's speed, and no message or frame of the car map's own code holds a frame.
flow('the car map glides between fixes and no message holds a frame, on a slow CPU (the owner, 2026-10-30)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  // the car map's own scripts in every long frame (Long Animation Frames: each script over 5 ms, with its file)
  await page.addInitScript(() => { window.__loaf = [];
    try { new PerformanceObserver((l) => { for (const f of l.getEntries()) for (const s of f.scripts || []) if (/carmap\.js/.test(s.sourceURL)) window.__loaf.push(Math.round(s.duration)); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (_) {} });
  await page.goto(base + '/carmap.html');
  await page.waitForFunction(() => window.car && car.map && car.map.loaded());
  await page.evaluate(() => {   // a twisty road, a point every 10 m, a corner plate every 60 m, a hazard; guiding with Apple's card on the left
    const route = []; let lat = 35.36, lon = -84.29, h = 30;
    for (let i = 0; i < 1200; i++) { h += 9 * Math.sin(i / 9); const b = h * Math.PI / 180; lat += 10 * Math.cos(b) / 110540; lon += 10 * Math.sin(b) / (111320 * Math.cos(lat * Math.PI / 180)); route.push([lat, lon]); }
    window.__route = route;
    car.look('roadbook', false); car.route(route); car.position(route[0][0], route[0][1], 30);
    car.corners(route.filter((_, i) => i % 6 === 3).map((at, k) => ({ at, text: (k % 2 ? 'L' : 'R') + (1 + k % 6), tight: k % 5 === 0 })));
    car.hazards([{ at: route[120], title: 'Gravel' }]); car.inset(288); car.mode('guide'); car.sight({ text: '45', unit: 'MPH', short: false });
  });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = await page.evaluate(async () => {
    const map = car.map, route = window.__route, t0 = performance.now(), msgMs = [];
    window.__loaf.length = 0;
    const timed = (f) => { const s = performance.now(); f(); msgMs.push(performance.now() - s); };
    const brg = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
    // 20 m/s: a new fix each second, sent every 0.1 s as ApexNavApp's live frame does; the sight on its own clock; the
    // mode and inset again every second, as a layout pass sends them
    const timers = [
      setInterval(() => { const i = Math.min(route.length - 2, 2 * Math.floor((performance.now() - t0) / 1000)); timed(() => car.position(route[i][0], route[i][1], brg(route[i], route[i + 1]))); }, 100),
      setInterval(() => timed(() => car.sight({ text: String(40 + 5 * Math.floor(Math.random() * 3)), unit: 'MPH', short: false })), 2000),
      setInterval(() => timed(() => { car.inset(288); car.mode('guide'); }), 1000),
    ];
    // each frame: how far the ground moved under a point on the screen, and in what time; and (F-01) how far the drawn
    // arrow is from the true car, which drives the route at 20 m/s, read once the frame's own callbacks have run
    const steps = [], lagM = []; let last = null, frames = 0;
    // The ground's shift is read when the camera moves (the car map sets it in its own frame callback, for that frame's
    // time), and timed by the frame it was set in. Read from this flow's own frame callback instead, it is one frame late
    // whenever that callback runs before the car map's: after a long frame, a long frame's travel was divided by the short
    // frame after it, which read as a leap (it failed twice on a busy CI machine).
    const onMove = () => { const ts = document.timeline.currentTime;
      if (last) { const p = map.project(last.ll), px = Math.hypot(p.x - 560, p.y - 300);
        if (ts === last.ts && steps.length) steps[steps.length - 1].px += px; else steps.push({ px, dt: ts - last.ts }); }
      last = { ll: map.unproject([560, 300]), ts }; };
    map.on('move', onMove);
    const truth = (ts) => { const m = (ts - t0) / 1000 * 20, k = Math.min(route.length - 2, Math.floor(m / 10)), f = Math.min(1, m / 10 - k);
      return [route[k][0] + (route[k + 1][0] - route[k][0]) * f, route[k][1] + (route[k + 1][1] - route[k][1]) * f]; };
    await new Promise((done) => {
      const tick = (ts) => {
        frames++;
        if (ts - t0 > 3000) { const want = truth(ts); setTimeout(() => { const s = car.shown; if (s) lagM.push(Math.hypot((s.lon - want[1]) * 111320 * Math.cos(want[0] * Math.PI / 180), (s.lat - want[0]) * 110540)); }, 0); }
        if (ts - t0 < 30000) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    timers.forEach(clearInterval);
    map.off('move', onMove);
    const run = steps.slice(Math.floor(steps.length * 0.1)), rate = run.map((s) => s.px / Math.max(1, s.dt)).sort((a, b) => a - b), ran = frames * 0.9;
    const plates = [...document.querySelectorAll('.car-plate')].map((e) => e.getBoundingClientRect());
    lagM.sort((a, b) => a - b);
    const q = (f) => (lagM.length ? +lagM[Math.floor((lagM.length - 1) * f)].toFixed(1) : null);
    return { lagP50: q(0.5), lagP95: q(0.95), frames: Math.round(ran), moving: run.filter((s) => s.px > 0.05).length / ran, rateMed: rate[rate.length >> 1], rateP95: rate[Math.floor(rate.length * 0.95)], rateMax: rate[rate.length - 1],
      msgP95: +msgMs.sort((a, b) => a - b)[Math.floor(msgMs.length * 0.95)].toFixed(1), msgMax: +msgMs[msgMs.length - 1].toFixed(1), loaf: window.__loaf.slice(), plates: plates.length,
      offScreen: plates.filter((b) => b.right < 0 || b.left > innerWidth || b.bottom < 0 || b.top > innerHeight).length };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const say = JSON.stringify({ ...r, rateMed: +r.rateMed.toFixed(4), rateP95: +r.rateP95.toFixed(4), rateMax: +r.rateMax.toFixed(4) });
  // it glides: the map moves on nearly every frame, never in a lurch (a jump per fix is a long still, then one frame's leap)
  check(r.frames > 60 && r.moving >= 0.85, 'the map moves every frame, not once a fix: ' + say);
  check(r.rateP95 <= 3 * r.rateMed && r.rateMax <= 10 * r.rateMed, 'no frame leaps ahead of the glide: ' + say);
  // a message (a repeated fix, the mode said again) costs next to nothing, and the car map's own frame work stays under half
  // a frame (33 ms at a quarter speed). Wall-clock times on a shared CI machine catch the odd stall, so these hold for 95% of
  // messages and 99% of frames; the old map's every repeated fix eased the camera again (~13 ms each, up to 70)
  check(r.msgP95 < 8, 'messages to the car map under 8 ms at a quarter speed: ' + say);
  check(r.loaf.filter((d) => d >= 33).length <= r.frames / 100, "the car map's own code never holds a frame: " + say);
  check(r.offScreen === 0, 'only the plates on the screen are on the map: ' + say);
  // F-01 (REVIEW_FEEL.md): the arrow is where the car is, not where it was a fix ago (it trailed by 11 m at the median)
  check(r.lagP50 != null && r.lagP50 < 5 && r.lagP95 < 10, 'the arrow is dead reckoned to the car between fixes: ' + say);
}, { viewport: { width: 800, height: 480 }, deviceScaleFactor: 1 });

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
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  await page.waitForFunction(() => !window.apexDebug.driveActive);
  check(await relaunch() === null, 'after the drive ends, a fresh open has no route');
}, { geolocation: { latitude: 35.6, longitude: -84.1 }, permissions: ['geolocation'] });

flow('the car connects: CarPlay offers Start drive, and an apexnav://open?go=drive link starts one', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.onNative === 'function');
  await page.evaluate(() => window.apex.onNative({ type: 'car', via: 'carplay' }));
  await page.waitForFunction(() => /CarPlay connected/.test(document.getElementById('toast').textContent));
  // 2026-11-10: a message with a key is one row, the key whole at the right in ink (it was an inline link in the red pen that
  // dropped under the words), a thumb tall to hit; and a message is as wide as its words, not half the screen
  const tk = await page.evaluate(() => { const t = document.getElementById('toast'), a = t.querySelector('a'), r = t.getBoundingClientRect(), k = a.getBoundingClientRect();
    const words = document.createRange(); words.selectNodeContents(t.firstChild); const w = words.getBoundingClientRect();
    return { row: Math.abs((w.top + w.bottom) / 2 - (k.top + k.bottom) / 2) < 3 && k.left >= w.right, oneLine: w.height < 20, hit: Math.round(k.height), tall: Math.round(r.height),
      ink: getComputedStyle(a).color === getComputedStyle(t).color, under: getComputedStyle(a).textDecorationLine, inside: r.left >= 16 && r.right <= innerWidth - 16 }; });
  check(tk.row && tk.oneLine && tk.ink && tk.under === 'underline' && tk.inside, 'the words, then the key, on one row in ink: ' + JSON.stringify(tk));
  check(tk.hit >= 44 && tk.tall < 44, 'the key is a thumb tall to hit and the message is no taller for it: ' + JSON.stringify(tk));
  await page.setViewportSize({ width: 320, height: 640 });
  const narrow = await page.evaluate(() => { const t = document.getElementById('toast'); t.firstChild.nodeValue = 'No signal on parts of this route. Save the maps there?';
    const r = t.getBoundingClientRect(), k = t.querySelector('a').getBoundingClientRect(); return { inside: r.left >= 15.5 && r.right <= innerWidth - 15.5, keyWhole: k.right <= r.right && k.height >= 44, w: Math.round(r.width) }; });
  check(narrow.inside && narrow.keyWhole && narrow.w > 200, 'on a small phone long words wrap beside the key, inside the screen: ' + JSON.stringify(narrow));
  await page.setViewportSize({ width: 390, height: 844 });
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
  await openSetting(page, 'zones');
  await page.click('#zoneRadius [data-zone-r="200"]');
  await page.click('#zoneMapBtn');
  await page.fill('.confirm-sheet .cs-field', 'Home'); await page.click('.confirm-sheet .cs-ok');
  await page.waitForFunction(() => /Home · 650 ft/.test(document.getElementById('zoneList').textContent));
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
    document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('toast'); if (t) new MutationObserver(() => window.__toasts.push(t.textContent))   // (not in the Log's frame)
      .observe(t, { childList: true, characterData: true, subtree: true }); });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__toasts.some((t) => /@lead invited you to a convoy: Sunday run/.test(t)), null, { timeout: 10000 });
  // P-21: the invite waits on the idle map as one line under the place plate; a tap opens the convoy sheet (P-11: no Convoy section)
  await page.waitForSelector('.convoy-bar.show .cv-line');
  check(/Sunday run/.test(await page.textContent('.convoy-bar .cv-line')) && /@lead invited you/.test(await page.textContent('.convoy-bar .cv-line'))
    && (await page.$$('.convoy-bar.show > *')).length === 1, 'the map says it in one line: ' + await page.textContent('.convoy-bar'));
  await page.click('.convoy-bar .cv-line');
  await page.waitForSelector('.convoy-sheet button:has-text("Join")');
  check(/@lead invited you: Sunday run/.test(await page.textContent('.convoy-sheet')), 'the convoy sheet says who invited you and to what');
  await page.click('.convoy-sheet button:text-is("Join")');
  await page.waitForFunction(() => /you are following/.test(document.querySelector('.convoy-sheet').textContent), null, { timeout: 5000 });
  check(/left/.test(await page.textContent('.convoy-sheet')) && !/ends \d/.test(await page.textContent('.convoy-sheet')), 'how long it has left, not a clock time (P-28): ' + await page.textContent('.convoy-sheet .note'));
  check(accepted, 'joined with consent, without a link');
  await page.click('.convoy-sheet button:has-text("Done")');
  check(/Sunday run/.test(await page.textContent('.convoy-bar .cv-line')), 'in the convoy, the line names it');
  await page.evaluate(() => { document.querySelector('.tab[data-view="people"]').click(); document.querySelector('[data-people="crews"]').click(); });
  check(!(await page.$$eval('#crewsBody h3', (h) => h.filter((x) => /Convoy/.test(x.textContent)).length)), 'no Convoy heading on Crews');
});

flow('crew page: an old ?view=crew link opens People on Crews, at your crew; going, chat and the livery reach the Worker (Worker stubbed, REVIEW.md roadmap 20)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const sent = [], boardAsks = [], soon = new Date(Date.now() + 3 * 86400e3).toISOString();
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
    if (u.pathname === '/api/events') return json([{ ...crewPage.next, crew_id: 'k1', crew_name: 'Ridge Runners' }]);
    // the owner's note 06: the board is each member's face and the total of their drive Scores over the picked period
    if (u.pathname === '/api/crews/k1/board') { boardAsks.push(u.searchParams.get('period')); return json({ period: u.searchParams.get('period'), rows: u.searchParams.get('period') === 'all'
      ? [{ handle: 'sam', photo_id: null, total: 12840, drives: 17, car: 'Mazda MX-5', mine: false }, { handle: 'me', photo_id: null, total: 702, drives: 1, mine: true }]
      : [{ handle: 'sam', photo_id: null, total: 1622, drives: 2, car: 'Mazda MX-5', mine: false }, { handle: 'me', photo_id: null, total: null, drives: 0, mine: true }] }); }
    if (u.pathname === '/api/crews/k1/chat') return json([{ id: 'm1', handle: 'sam', body: '<b>Fog</b> by 7?', created_at: '2026-10-29 10:00:00', mine: false, photo_id: null }]);
    if (u.pathname === '/api/crews/k1/members') return json([{ handle: 'me', role: 'owner', mine: true }, { handle: 'sam', role: 'member', mine: false }, { handle: 'cara', role: 'member', mine: false }]);
    if (u.pathname === '/api/presence') return json([{ handle: 'cara', photo_id: null, delay_s: 0, fuzz: false, road: 'Cherohala Skyway', lat: 35.3, lon: -84.1, at: new Date(Date.now() - 30e3).toISOString() }]);
    return json([]);
  });
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-page .cp-title h2');
  check((await page.textContent('.crew-page h2')) === 'Ridge Runners', 'the Crews side opens the crew');
  check(await page.evaluate(() => document.querySelector('[data-people="crews"]').getAttribute('aria-selected') === 'true' && !document.getElementById('crewsBody').hidden
    && document.getElementById('accountBody').hidden && document.getElementById('sheetTitle').textContent === 'People'), 'on the People tab, its Crews side');
  check(await page.evaluate(() => !!document.querySelector('#crewsBody .crew-head .gear-key') && !document.querySelector('#crewsBody .friend-list')), 'the crew head and its gear are on the Crews side, no friends list there');
  await page.waitForSelector('.cp-board .cp-board-row');
  const boardRows = () => page.$$eval('.cp-board .cp-board-row', (r) => r.map((x) => [x.querySelector('.who b').textContent, x.querySelector('.score').textContent, !!x.querySelector('.avatar')]));
  const rows = await boardRows();
  check(JSON.stringify(rows) === JSON.stringify([['@sam', (1622).toLocaleString(), true], ['@me', '--', true]]) && boardAsks[0] === 'month', 'the board: a face and this month\'s total, then -- for none: ' + JSON.stringify(rows));
  check(JSON.stringify(await page.$$eval('.cp-periods button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-checked')))) === '["Week:false","Month:true","Year:false","All time:false"]', 'Week / Month / Year / All time, Month picked');
  await page.click('.cp-periods button:text-is("All time")');
  await page.waitForFunction(() => /12/.test((document.querySelector('.cp-board .score') || {}).textContent || ''));
  check(JSON.stringify((await boardRows()).map((r) => r[1])) === JSON.stringify([(12840).toLocaleString(), (702).toLocaleString()]) && boardAsks.includes('all'), 'All time asks for all time');
  // the owner's note 05: no Crew drives row; the crew's Upcoming drives has a + in its corner that plans one
  check(!/Crew drives/.test(await page.$$eval('#crewsBody .nav-rows', (n) => n.map((x) => x.textContent).join('|'))), 'no Crew drives row on Crews');
  check(/Upcoming drives/.test(await page.textContent('.cp-week .cp-sec h3')) && await page.isVisible('.cp-week .cp-sec .plan-plus'), 'Upcoming drives with a + in its corner');
  await page.click('.cp-week .plan-plus');
  await page.waitForSelector('.cp-week .plan-drive');
  check(await page.isHidden('.cp-week .plan-plus'), 'the + opens the plan form there, and gives way to it');
  await page.click('.cp-week .plan-drive button:text-is("Cancel")');
  check(await page.$eval('.cp-msg p', (p) => p.textContent === '<b>Fog</b> by 7?' && !p.querySelector('b')), 'chat is set as text');
  // P-03: the run first, then the members, then the chat, the board after; the livery one line at the foot; no Convoy heading
  await page.waitForSelector('.cp-member');
  const order = await page.$$eval('.crew-page .cp-body > *', (n) => n.map((x) => x.classList.contains('cp-title') ? 'title' : x.classList.contains('cp-week') ? 'run'
    : x.classList.contains('cp-livery-foot') ? 'livery' : (x.querySelector(':scope > .cp-sec h3') || {}).textContent || x.className).filter(Boolean));
  check(JSON.stringify(order.slice(0, 5)) === '["title","run","Members","Chat","Vetta Score board"]' && order[order.length - 1] === 'livery', 'the page in order: ' + JSON.stringify(order));
  check(!(await page.$$('.crew-page .cp-livery, .crew-page .cp-meter')).length, 'no livery box or meter on the page (they are in Edit livery)');
  check(!/Convoy/.test(await page.$$eval('#crewsBody h3', (h) => h.map((x) => x.textContent).join('|'))), 'no Convoy heading on Crews');
  // P-06: the members as faces, the owner marked, the one on the road lit
  const mem = await page.$$eval('.cp-member', (b) => b.map((x) => [x.querySelector('small').textContent, !!x.querySelector('em'), x.classList.contains('live')]));
  check(JSON.stringify(mem) === JSON.stringify([['You', true, false], ['@cara', false, true], ['@sam', false, false]]) && /3 members · 1 out now/.test(await page.textContent('.crew-page')), 'members: ' + JSON.stringify(mem));
  await page.click('.cp-member:has-text("@sam")');
  await page.waitForSelector('.cp-member-sheet');
  check(await page.isVisible('.cp-member-sheet button:has-text("Report")') && await page.isVisible('.cp-member-sheet button:has-text("Block")'), 'Report and Block are on the member, one tap in');
  await page.click('.cp-member-sheet button:has-text("Done")');
  // P-17: a message is its handle, time and words; Report is behind one key
  check(!(await page.$$('.cp-msg .linkbtn')).length && await page.isVisible('.cp-msg .cp-dots'), 'no Delete / Report / Pin links on the message');
  await page.click('.cp-msg .cp-dots');
  await page.waitForSelector('.confirm-sheet .cs-choose');
  check(/Report/.test(await page.textContent('.confirm-sheet')) && !/Pin it/.test(await page.textContent('.confirm-sheet')), 'Report on the message\'s own sheet (a Plain crew pins nothing)');
  await page.click('.confirm-sheet .cs-no');
  // P-16: one line of crew names in the text face (a single crew: its name), the gear beside it; P-31: the gear is this crew's settings
  await page.click('#crewsBody .gear-key');
  await page.waitForSelector('.side-pop.open[aria-label="Crew settings"] .crew-settings');
  const gearText = await page.textContent('.side-pop.open[aria-label="Crew settings"]');
  check(/Ridge Runners/.test(gearText) && /What it sees of yours/.test(gearText) && /Leave/.test(gearText) && !(await page.$$('.side-pop.open[aria-label="Crew settings"] .crew-tiles')).length, 'the gear: one crew\'s settings, no tiles: ' + gearText.slice(0, 160));
  await page.click('.side-pop.open[aria-label="Crew settings"] button:has-text("Done")');
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
  // fair meeting points (crew_meet.js): your rough area is off until you switch it on, and nothing was sent about it
  check(await page.getAttribute('.cp-meet [data-crew-home]', 'aria-checked') === 'false' && !find('/api/crews/k1/home'), 'Share my rough area is off by default');
  check((await page.textContent('.cp-livery-line')).trim() === 'Plain livery', 'the livery line says Plain and nothing it lacks (the owner, 2026-11-10: no Pro nudge on the crew page)');
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

flow('first open in the app: the welcome runs, and Start is what asks the shell for location (REVIEW4 U-65, U-68, U-80)', async (page, base) => {
  await page.addInitScript(() => { window.__native = []; window.APEX_EMBED = true; window.APEX_PLATFORM = 'ios';
    window.webkit = { messageHandlers: { apex: { postMessage(m) { window.__native.push(m && m.cmd ? m.cmd : m); } } } }; });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  // the cover is the launch screen's lockup at its size; the map's canvas waits, hidden, for the theme (no stock map frame)
  const first = await page.evaluate(() => { const b = document.getElementById('boot'), svg = b && b.querySelector('svg');
    return { lockup: svg ? [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height] : null, unstyled: document.getElementById('map').classList.contains('unstyled'), asked: window.__native.includes('requestLocation') }; });
  check(!first.lockup || (first.lockup[0] === 184 && first.lockup[1] === 50), 'the cover draws the 184 x 50 lockup: ' + JSON.stringify(first));
  check(first.unstyled, 'the map stays hidden until it is restyled (no tiles here, so it never is)');
  check(!first.asked, 'no location question under the welcome');
  await page.click('#obNext');
  await page.waitForFunction(() => window.__native.includes('requestLocation'), null, { timeout: 3000 });
  check(!(await page.isVisible('#onboard.show')), 'Start closes the welcome');
  // a driver past the welcome: asked at once (the system shows nothing once it was answered), no welcome again
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.__native.includes('requestLocation'), null, { timeout: 10000 });
  check(!(await page.isVisible('#onboard.show')), 'once only');
  // a first drive started from the car while the welcome waits on the phone: the welcome goes, location is asked, the drive runs
  await page.evaluate(() => localStorage.removeItem('apex.onboarded'));
  await page.reload();
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  await page.evaluate(() => { window.__native.length = 0; window.apex.onNative({ type: 'carplay', action: 'start' }); });
  await page.waitForFunction(() => window.apexDebug.driveActive && window.__native.includes('requestLocation'), null, { timeout: 5000 });
  check(!(await page.isVisible('#onboard.show')), "the car's Start answers the welcome");
});

flow('drive ended: Open in the Log is the solid key with no score, Share card with one, fixed from the first frame; a drive on a route keeps its name (REVIEW4 U-75, REVIEW5 U-118)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport && window.apex);
  const pts = Array.from({ length: 300 }, (_, i) => `<trkpt lat="${(35.5 + i * 1e-4).toFixed(6)}" lon="-83.9"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'dragon.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Dragon run</name><trkseg>${pts}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Dragon run', null, { timeout: 10000 });
  const keys = () => page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); return !!(e && e.offsetParent); };
    return { name: document.getElementById('endName').textContent, share: vis('endShare'), logKey: vis('endLogKey') && document.getElementById('endLogKey').classList.contains('solid'),
      logLink: vis('endLog'), shareLink: vis('endShareLink'), href: document.getElementById('endLogKey').getAttribute('href') }; });
  // drive along the route on the app's frames, then End
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  for (let burst = 0; burst < 4; burst++) {
    await page.evaluate((b) => { for (let j = b * 70; j < (b + 1) * 70; j++) window.apex.live({ lat: 35.5 + j * 1e-4, lon: -83.9, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked' }); }, burst);
    await page.waitForTimeout(300);
  }
  // I-3: End can't be a mis-tap. For 5 s the status row says so and End is Undo, the drive still recording; Undo resumes it
  await page.click('#driveEnd');
  const win = await page.evaluate(() => { const b = document.getElementById('driveEnd'), n = document.getElementById('dsNote');
    return { active: window.apexDebug.driveActive, key: b.textContent, label: b.getAttribute('aria-label'), undo: b.classList.contains('undo'), note: n.hidden ? '' : n.getAttribute('aria-label') || n.textContent,
      card: document.getElementById('endCard').classList.contains('show'), bar: !document.getElementById('driveBar').hidden }; });
  check(win.active && win.key === 'Undo' && win.undo && /Undo End/.test(win.label) && /^Drive ended/.test(win.note) && !win.card && win.bar,
    'after End: Undo in the status row, the drive still live, no card yet: ' + JSON.stringify(win));
  await page.click('#driveEnd');
  await page.waitForTimeout(5600);                                     // past the window: Undo held, nothing ended
  const kept = await page.evaluate(() => ({ active: window.apexDebug.driveActive, key: document.getElementById('driveEnd').textContent, card: document.getElementById('endCard').classList.contains('show') }));
  check(kept.active && kept.key === 'End' && !kept.card, 'Undo: the drive goes on as if End was never tapped: ' + JSON.stringify(kept));
  await page.evaluate(() => { for (let j = 280; j < 300; j++) window.apex.live({ lat: 35.5 + j * 1e-4, lon: -83.9, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked' }); });
  // U-118: in the frame after End, while scoring, the scored layout already (read in the same task, before the worker answers)
  const first = await page.evaluate(() => { document.getElementById('driveEnd').click(); window.apexDebug.endNow(); const vis = (id) => { const e = document.getElementById(id); return !!(e && e.offsetParent); };
    return { share: vis('endShare'), logKey: vis('endLogKey'), logLink: vis('endLog'), shareLink: vis('endShareLink') }; });
  await page.waitForSelector('#endCard.show', { timeout: 8000 });
  check(first.share && first.logLink && !first.logKey && !first.shareLink, 'scoring: Share card solid, the Log a link: ' + JSON.stringify(first));
  await scoredCard(page);                                               // F-04: the card first, the score when the worker has it
  const routed = await keys();
  check(routed.name === 'Dragon run', 'named after the route driven: ' + routed.name);
  check(!routed.share && routed.logKey && routed.shareLink && !routed.logLink && /tab=drive&drive=/.test(routed.href), 'no score: Open in the Log is the solid key, Share a link: ' + JSON.stringify(routed));
  // with a score, Share card is the solid key again and the Log a link
  await page.click('#endDone');
  await page.evaluate(() => { ApexCore.driverScore = () => ({ score: 640, components: {} });
    const lat = [], lon = []; for (let i = 0; i < 300; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
    apexDebug.showEndCard({ id: 'x', name: 'Cherohala Skyway', date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15), lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }, Date.now() - 600e3); });
  const pending = await keys();
  await scoredCard(page);
  const scored = await keys();
  check(scored.share && !scored.logKey && scored.logLink && !scored.shareLink, 'a score: Share card is the solid key: ' + JSON.stringify(scored));
  check(JSON.stringify(pending) === JSON.stringify(scored), 'U-118: the keys do not swap when the score lands: ' + JSON.stringify({ pending, scored }));
});

flow('drive ended: the card and the Log give the same score and time for the recorded drive (REVIEW4_CHECK U-91)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording && window.ApexCore);
  // the real drive (web/data/dry_ridge.js) as the CSV the phone writes, parsed and stored as End does it
  const card = await page.evaluate(async () => {
    await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'data/dry_ridge.js'; s.onload = ok; s.onerror = fail; document.head.append(s); });
    const src = window.APEX_DRIVES.find((x) => x.id === 'dry_ridge'), f = src.fields, c = (k) => f.indexOf(k);
    const want = ['distance_m', 'lat', 'lon', 'elevation_m', 'speed_mph', 'lon_g', 'lat_g', 'camber_deg', 'roughness_rms', 'crest_vertical_g', 'vert_peak_g'];
    const csv = [want.join(','), ...src.rows.map((r) => want.map((k) => (r[c(k)] == null ? '' : r[c(k)])).join(','))].join('\n');
    const d = ApexRecording.parse(ApexCore, csv, 'web_20261030_064500.csv', { source: 'web-gps', name: 'Dry Ridge Rd' });
    await ApexRecording.store(d);
    apexDebug.showEndCard(d, Date.now() - 3 * 3600e3);              // three hours of wall clock: the card must not use it
    for (let i = 0; i < 100 && document.getElementById('endScore').hasAttribute('aria-busy'); i++) await new Promise((r) => setTimeout(r, 50));
    return { id: d.id, score: document.getElementById('endScore').textContent, meta: document.getElementById('endMeta').textContent,
      line: document.getElementById('endLine').textContent, share: !!document.getElementById('endShare').offsetParent };
  });
  // design pass 9: with one drive in the Log the number stands alone (a usual is not one drive); the keys are a solid row
  // over Mark a stage and Drive it again, side by side, and nothing left on a row by itself
  const alone = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); const R = (id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return e.offsetParent ? [Math.round(r.left), Math.round(r.top), Math.round(r.width)] : null; };
    return { usual: document.getElementById('endUsual').hidden, share: R('endShare'), stage: R('endStage'), again: R('endAgain'), acts: Math.round(document.querySelector('.end-acts').getBoundingClientRect().width) }; });
  check(alone.usual && alone.share && alone.stage && alone.again && alone.share[2] === alone.acts && alone.stage[1] === alone.again[1] && alone.stage[1] > alone.share[1] && Math.abs(alone.stage[2] - alone.again[2]) <= 1,
    'one drive: no "usual"; Share card is the row, Mark a stage and Drive it again share the next: ' + JSON.stringify(alone));
  // with a few scored drives before it in the Log, the number is set against them (the Log's own summaries, read on the phone)
  const usual = await page.evaluate(async (id) => {
    const real = ApexRecording.summaries;
    ApexRecording.summaries = async (...x) => [640, 655, 612, 649, 630].map((score, i) => ({ id: 'old' + i, name: 'Other Rd', date: '2026-10-0' + (i + 1), ds: { score } })).concat(await real(...x));
    const d = await ApexRecording.get(id); apexDebug.showEndCard(d, Date.now() - 600e3, { quiet: true });
    for (let i = 0; i < 100 && document.getElementById('endUsual').hidden; i++) await new Promise((r) => setTimeout(r, 50));
    ApexRecording.summaries = real;
    const u = document.getElementById('endUsual'), l = document.querySelector('.end-score span'), a = u.getBoundingClientRect(), b = l.getBoundingClientRect(), box = document.querySelector('.end-score').getBoundingClientRect();
    return { text: u.textContent, score: +document.getElementById('endScore').textContent, sameLine: Math.abs(a.bottom - b.bottom) < 6, clear: a.left > b.right + 8, inside: a.right <= box.right + 1 };
  }, card.id);
  check(usual.text === `${usual.score - 640} over your usual` && usual.sameLine && usual.clear && usual.inside, 'the score against your usual, on the label\'s line: ' + JSON.stringify(usual));
  check(/^\d+$/.test(card.score) && card.share && !/Not enough clean corners/.test(card.line), 'the card scores the drive and offers Share: ' + JSON.stringify(card));
  await page.goto(`${base}/analysis.html?tab=drive&drive=${encodeURIComponent(card.id)}`);
  await page.waitForSelector('.dv-score b', { timeout: 15000 });
  const log = await page.evaluate(() => ({ score: document.querySelector('.dv-score b').textContent, meta: document.querySelector('.dv-meta').textContent,
    plain: (document.querySelector('.dv-plain') || {}).textContent || '' }));
  check(log.score === card.score, `the Log's ${log.score} is the card's ${card.score}`);
  // U-111: one coaching sentence, the Log's, on the card; never "Next time, X:" and never two colons
  check(log.plain && card.line.endsWith(log.plain) && !/Next time/.test(card.line) && (card.line.match(/:/g) || []).length <= 1, `the card's sentence is the Log's: ${card.line} against ${log.plain}`);
  // RA-3 (panel round 2): one set of numbers: the card's line and the drive page's are the same words (distance, time,
  // every corner), and the Log's row says the same distance and corners (recording 7: 3 corners on the card, 2 on the row)
  check(/ min/.test(card.meta) && !/ h /.test(card.meta) && /corner/.test(card.meta) && log.meta === card.meta, `the card's line is the drive page's: ${card.meta} against ${log.meta}`);
  await page.goto(`${base}/analysis.html`);
  await page.waitForSelector(`tr[data-drive="${card.id}"] .sub`, { timeout: 15000 });
  const row = await page.evaluate((id) => document.querySelector(`tr[data-drive="${id}"] .sub`).textContent, card.id);
  const [dist, , corners] = card.meta.split(' · ');
  check(row.startsWith(`${dist} · ${corners}`), `the Log row says the card's distance and corners: ${row} against ${card.meta}`);
});

flow('the status line wraps between its parts, never "25 min left…", at every width and theme (REVIEW4_CHECK U-99)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  const pts = Array.from({ length: 600 }, (_, i) => `<trkpt lat="${(35.5 + i * 1e-4).toFixed(6)}" lon="-83.9"/>`).join('');
  const fits = () => page.evaluate(() => {
    const m = document.getElementById('dsMain'), box = m.getBoundingClientRect(), end = document.getElementById('driveEnd').getBoundingClientRect();
    const parts = [...m.children].map((x) => x.getBoundingClientRect());
    return { text: m.textContent, cut: getComputedStyle(m).textOverflow === 'ellipsis' && m.scrollWidth > m.clientWidth,
      inside: parts.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.right <= end.left), lines: new Set(parts.map((r) => Math.round(r.top))).size };
  });
  for (const theme of ['roadbook', 'tapedeck', 'billet']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/index.html?theme=${theme}`);
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexRouteImport && window.apex);
    await page.setInputFiles('#gpxFile', { name: 'long.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Long run</name><trkseg>${pts}</trkseg></trk></gpx>`) });
    await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Long run', null, { timeout: 10000 });
    await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
    await page.waitForFunction(() => window.apexDebug.driveActive);
    for (let burst = 0; burst < 3; burst++) {
      await page.evaluate((b) => { for (let j = b * 70; j < (b + 1) * 70; j++) window.apex.live({ lat: 35.5 + j * 1e-5, lon: -83.9, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked' }); }, burst);
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => /min left/.test(document.getElementById('dsMain').textContent), null, { timeout: 8000 });
    for (const width of [320, 375, 402]) {
      await page.setViewportSize({ width, height: 800 });
      for (const night of [false, true]) {
        await page.evaluate((n) => { document.documentElement.dataset.mode = n ? 'night' : 'day'; }, night);
        await page.waitForTimeout(60);
        const r = await fits();
        check(!r.cut && r.inside && /min left/.test(r.text), `${width} px ${theme}${night ? ' night' : ''}: ${JSON.stringify(r)}`);
      }
    }
    await page.evaluate(() => { for (let i = 0; i < 2; i++) window.apex.onNative({ type: 'carplay', action: 'end' }); });
  }
});

flow('drive ended: the map behind the card is the whole drive, fitted flat above it, every time; a stray fix does not widen it (REVIEW4 U-88)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.loaded() && window.apex, null, { timeout: 20000 });
  // a free drive at road speed (the follow camera sits the arrow low, with the map's padding), with one stray fix 40 km
  // away first (the replay's first fix before its start offset), then End
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  await page.evaluate(() => window.apex.live({ lat: 35.86, lon: -83.9, accuracy_m: 4, speed_mps: 18, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked' }));
  for (let burst = 0; burst < 4; burst++) {
    await page.evaluate((b) => { for (let j = b * 70; j < (b + 1) * 70; j++) window.apex.live({ lat: 35.5 + j * 1e-4, lon: -83.9, accuracy_m: 4, speed_mps: 18, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked' }); }, burst);
    await page.waitForTimeout(300);
  }
  check(await page.evaluate(() => apexDebug.map.getPadding().top > 0), 'the follow camera pads the map in a drive');
  await page.click('#driveEnd');
  check(await page.evaluate(() => window.apexDebug.driveActive), 'I-3: End is not done at once');
  await page.waitForSelector('#endCard.show', { timeout: 8000 });     // not undone: the 5 s window runs out and the drive is saved
  await page.waitForTimeout(1500);
  const fit = () => page.evaluate(() => { const m = apexDebug.map, c = m.getContainer().getBoundingClientRect(), top = document.querySelector('#endCard .card-sheet').getBoundingClientRect().top - c.top;
    const a = m.project([-83.9, 35.5]), b = m.project([-83.9, 35.5 + 279e-4]), p = m.getPadding();
    return { a: a.y, b: b.y, top, pitch: m.getPitch(), bearing: m.getBearing(), pad: p.top, follow: apexDebug.state.follow, shown: m.getLayoutProperty('apex-endtrail', 'visibility'),
      lines: (m.getSource('apex-endtrail-src')._data.features || []).length }; });
  // KE-1 (panel round 2): the road's portrait is up with the card, whatever the map has drawn, where the fit puts the trail
  const portrait = await page.evaluate(() => { const e = document.getElementById('endPortrait'), p = e.querySelector('.rp-road path:last-child'), top = document.querySelector('#endCard .card-sheet').getBoundingClientRect().top;
    const r = p ? p.getBoundingClientRect() : null, m = apexDebug.map, a = m.project([-83.9, 35.5]), c = m.getContainer().getBoundingClientRect();
    return { shown: !e.hidden, paths: e.querySelectorAll('.rp-road path').length, inside: !!r && r.top >= 0 && r.bottom <= top + 1 && r.height > top * 0.4,
      onTrail: !!r && Math.abs(r.bottom - (a.y + c.top)) < 12 }; });
  check(portrait.shown && portrait.paths === 2 && portrait.inside && portrait.onTrail, 'the road\'s portrait is drawn above the card, on the map\'s trail: ' + JSON.stringify(portrait));
  const f1 = await fit();
  check(f1.shown === 'visible' && f1.lines === 1 && !f1.follow && f1.pitch < 1 && Math.abs(f1.bearing) < 1 && f1.pad === 0, 'the trail drawn as one line, the map flat and still: ' + JSON.stringify(f1));
  check([f1.a, f1.b].every((y) => y > 0 && y < f1.top) && Math.abs(f1.a - f1.b) > f1.top * 0.5, 'the whole drive fills the map above the card, not the stray fix\'s 40 km: ' + JSON.stringify(f1));
  // a second fix after the end (the shell keeps sending them) does not take the map back
  await page.evaluate(() => window.apex.live({ lat: 35.53, lon: -83.9, accuracy_m: 4, speed_mps: 0, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true }));
  await page.waitForTimeout(600);
  const f2 = await fit();
  check(Math.abs(f2.a - f1.a) < 2 && Math.abs(f2.b - f1.b) < 2, 'a fix after the end leaves the fit: ' + JSON.stringify(f2));
  // REVIEW5 U-127: the place plate (its text set by hand: it needs a lookup) waits under the end card, and Done brings it back
  const plateShown = () => page.evaluate(() => { const p = document.getElementById('placePlate'); return !p.hidden && p.getClientRects().length > 0; });
  await page.evaluate(() => { const p = document.getElementById('placePlate'), c = document.getElementById('endCard');
    p.textContent = 'Colerain Township · Dry · 63°'; p.hidden = false; c.classList.remove('show'); c.classList.add('show'); });   // as a late lookup would leave it
  await page.waitForTimeout(100);
  check(!(await plateShown()), 'no place plate over the end card');
  await page.click('#endDone');
  await page.waitForTimeout(300);
  check(await plateShown(), 'Done: the idle map has its place plate at once');
  const after = await page.evaluate(() => ({ follow: apexDebug.state.follow, shown: apexDebug.map.getLayoutProperty('apex-endtrail', 'visibility') }));
  check(after.follow && after.shown === 'none', 'Done: the trail goes and the map follows again: ' + JSON.stringify(after));
  check(await page.evaluate(() => document.getElementById('endPortrait').hidden), 'and the portrait with it');
});

// Round 3 (the owner, 2026-10-30: "I drove to work today with the map running started on carplay and the drive isn't in my
// log"): a drive started on the car and never ended with End. The car switching off saves it; a page that was closed in
// the middle of one is rebuilt at the next launch from its checkpoint and the shell's journal (drive_keep.js).
flow('a drive started on the car and never ended is in the Log: the car switching off saves it; a page closed mid-drive is recovered (Round 3)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    // the shell: what the page posts, and the journal it would keep on disk (sessionStorage here, which outlives the reload)
    window.__native = [];
    window.webkit = { messageHandlers: { apex: { postMessage: (m) => { window.__native.push(m);
      if (m && m.cmd === 'journal' && m.op === 'list') setTimeout(() => window.apex.onNative({ type: 'journals', car: false, list: JSON.parse(sessionStorage.getItem('fakeJournal') || '[]') }), 50); } } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apex && window.ApexDriveKeep && window.ApexRecording);
  const T0 = Date.now() - 3600e3;
  // the app's frames as pushLiveFrame sends them: numbered, timed, north at 15 m/s (11 m a frame), or stopped where `from` is
  const feed = (from, to, v, at0) => page.evaluate(([from, to, v, T0, at0]) => { for (let i = from; i < to; i++) window.apex.live({ lat: 35.5 + (v ? i : from) * 1e-4, lon: -83.9,
    accuracy_m: 4, speed_mps: v, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked', seq: i + 1, at: (at0 ?? T0) + i * 1000 }); }, [from, to, v, T0, at0]);
  const until = async (fn, arg, msg, ms = 8000) => { const t = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t > ms) throw new Error(msg); await page.waitForTimeout(100); } };

  // 1. started on the car's screen, driven 3.5 km, the car switched off in the car park: no End
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start', free: true }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  for (let b = 0; b < 4; b++) { await feed(b * 80, (b + 1) * 80, 15); await page.waitForTimeout(150); }
  await until(async () => (await ApexRecording.keepAll()).length === 1, null, 'the drive is checkpointed as it goes');
  const posted = await page.evaluate(() => window.__native.filter((m) => m.cmd === 'journal').map((m) => m.op));
  check(posted.indexOf('start') >= 0 && posted.indexOf('durable') > posted.indexOf('start'), 'the shell is told the drive began and what is kept: ' + posted);
  await page.evaluate((t) => window.apex.onNative({ type: 'carplay', action: 'disconnect', t }), T0 + 320e3);
  await feed(319, 330, 0);                                              // parked: stopped, 10 s after the car went: still on
  check(await page.evaluate(() => window.apexDebug.driveActive), 'not ended while the car might come back');
  await feed(330, 345, 0);
  await until(() => !window.apexDebug.driveActive && document.getElementById('endCard').classList.contains('show'), null, 'ended itself 20 s after the car went');
  const one = await until(async () => { const all = await ApexRecording.all(); return all.length === 1 && !(await ApexRecording.keepAll()).length ? all[0] : null; }, null, 'saved, and nothing left in progress');
  check(one.ended === 'car' && one.dist[one.dist.length - 1] > 3400, 'the whole drive saved, said how it ended: ' + JSON.stringify({ ended: one.ended, m: one.dist[one.dist.length - 1] }));
  check(/Ended when the car disconnected/.test(await page.textContent('#endLine')), 'the card says so');
  check(await page.evaluate(() => window.__native.some((m) => m.cmd === 'journal' && m.op === 'end')), 'the shell drops its journal once saved');

  // 2. another drive from the car; the phone closes the page in the background (it writes nothing more) after the last
  // checkpoint and 10 more fixes, which only the shell's journal has. The next launch puts the whole drive in the Log.
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apex && window.ApexDriveKeep);
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start', free: true }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  for (let b = 0; b < 3; b++) { await feed(1000 + b * 70, 1000 + (b + 1) * 70, 15, T0 + 1e6); await page.waitForTimeout(150); }
  await until(async () => { const k = await ApexRecording.keepAll(); return k.length === 1 && k[0].head && k[0].head.seq === 1210; }, null, 'checkpointed up to the last frame');
  await feed(1210, 1220, 15, T0 + 1e6);
  const id = await page.evaluate(() => { const start = window.__native.find((m) => m.cmd === 'journal' && m.op === 'start'), durable = window.__native.filter((m) => m.cmd === 'journal' && m.op === 'durable').pop();
    // the shell's journal, as an app relaunch reads it back: every fix after the last durable one
    const frames = []; for (let i = 1000; i < 1220; i++) if (i + 1 > durable.seq) frames.push({ lat: 35.5 + i * 1e-4, lon: -83.9, accuracy_m: 4, speed_mps: 15, course_deg: 0, has_fix: true, calibration: 'locked', seq: i + 1, at: 0 });
    sessionStorage.setItem('fakeJournal', JSON.stringify([{ id: start.id, active: false, frames }]));
    ApexRecording.keepPut = async () => {};                               // the page is gone: nothing more is written
    return start.id; });
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording);
  const back = await until(async () => { const all = await ApexRecording.all(); return all.length === 2 && !(await ApexRecording.keepAll()).length ? all.find((d) => d.ended === 'recovered') : null; }, null, 'recovered into the Log at the next launch');
  const m = back.dist[back.dist.length - 1];
  check(m > 219 * 11.05 - 6 && m < 219 * 11.05 + 1, 'every fix, the ones only the journal had too: ' + m);
  check(!(await page.evaluate(() => window.apexDebug.driveActive)), 'a recovered drive is saved, not carried on');
  await saidOn(page, /saved to the Log\. The app closed before it was ended/);
  check(await page.evaluate((id) => window.__native.some((m) => m.cmd === 'journal' && m.op === 'end' && m.id === id), id), 'the shell drops the recovered journal');
  await page.evaluate(() => sessionStorage.removeItem('fakeJournal'));
  // the Log: both drives, each saying how it ended
  for (const [d, note] of [[one, 'Ended when the car disconnected'], [back, 'Recovered: the app closed before the drive was ended']]) {
    await page.goto(`${base}/analysis.html?tab=drive&drive=${encodeURIComponent(d.id)}`);
    await page.waitForFunction((n) => { const e = document.getElementById('dvNote'); return !!e && e.textContent.includes(n); }, note, { timeout: 15000 });
  }
});

flow('surfaces: Home by is the app\'s stepper, the replay has a Done key, the first paint is the launch screen (REVIEW4 U-98, U-104, U-80)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRouteImport);
  // U-80: before any stylesheet or script, the page's first paint is the launch screen's ink and lockup
  const first = await page.evaluate(() => { const st = document.head.querySelector('style'), firstScript = document.head.querySelector('script, link[rel=stylesheet]');
    return { before: !!(st && firstScript && (st.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)), css: st ? st.textContent : '' }; });
  check(first.before && /#151310/.test(first.css) && /svg\+xml/.test(first.css) && /184px 50px/.test(first.css), 'the first paint is the launch screen: ' + JSON.stringify({ before: first.before }));
  // U-98: a loop's Home by is a stepper in the theme, "--:--" until a key sets a time
  const pts = Array.from({ length: 300 }, (_, i) => `<trkpt lat="${(35.5 + i * 1e-4).toFixed(6)}" lon="-83.9"/>`).join('');
  await page.setInputFiles('#gpxFile', { name: 'loop.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<gpx><trk><name>Loop</name><trkseg>${pts}</trkseg></trk></gpx>`) });
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.name === 'Loop', null, { timeout: 10000 });
  await page.evaluate(() => { const t = apexDebug.track; t.id = 'loop_e2e'; t.homeBy = null; return apexDebug.buildRoute(null, 'loop_e2e', 'Loop', t); });
  await page.evaluate(() => document.getElementById('planPanel').classList.add('open'));
  const hb = () => page.evaluate(() => { const r = document.getElementById('homeByRow'), o = document.getElementById('homeByOut');
    return { shown: !r.hidden, input: !!r.querySelector('input'), stepper: !!r.querySelector('.stepper'), out: o.textContent, unk: o.classList.contains('unk'), clear: !document.getElementById('homeByOff').hidden, at: apexDebug.track.homeBy }; });
  const h0 = await hb();
  check(h0.shown && !h0.input && h0.stepper && h0.out === '--:--' && h0.unk && !h0.clear, 'Home by: a stepper saying --:--, no native time field: ' + JSON.stringify(h0));
  await page.click('#homeByMore');
  const h1 = await hb();
  check(/^\d{1,2}:\d{2} (AM|PM)$/.test(h1.out) && !h1.unk && h1.clear && h1.at % (15 * 60000) === 0 && h1.at > Date.now(), 'a tap sets a quarter-hour time ahead: ' + JSON.stringify(h1));
  await page.click('#homeByMore');
  check((await hb()).at === h1.at + 15 * 60000, 'and + steps a quarter hour');
  await page.click('#homeByOff');
  check((await hb()).out === '--:--', 'Clear goes back to --:--');
  // U-104: a replay ends with a Done key the size of End, which closes it
  await page.evaluate(() => document.getElementById('planPanel').classList.remove('open'));
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && document.getElementById('app').classList.contains('replaying'), null, { timeout: 15000 });
  const done = await page.evaluate(() => { const b = document.getElementById('replayDone').getBoundingClientRect(); return { w: b.width, h: b.height, inView: b.bottom <= innerHeight && b.right <= innerWidth && b.left >= 0 }; });
  check(done.h >= 44 && done.w >= 60 && done.inView, 'the Done key: ' + JSON.stringify(done));
  await page.click('#replayDone');
  check(await page.evaluate(() => document.getElementById('app').classList.contains('idle') && !!document.getElementById('tabbar').offsetHeight), 'Done closes the replay and the tabs come back');
  // U-102: the map's attribution never opens on its own over the map (MapLibre reopens it after a restyle); its ⓘ key opens it
  const attrib = await page.evaluate(async () => { const a = document.querySelector('.maplibregl-ctrl-attrib'); if (!a) return null;
    a.classList.remove('maplibregl-attrib-empty'); a.classList.add('maplibregl-compact'); await new Promise((r) => setTimeout(r, 20));   // as on a phone with the map's credits in
    a.classList.add('maplibregl-compact-show'); await new Promise((r) => setTimeout(r, 50)); const self = a.classList.contains('maplibregl-compact-show');
    const btn = a.querySelector('.maplibregl-ctrl-attrib-button'); if (btn) btn.click(); await new Promise((r) => setTimeout(r, 50));
    return { self, asked: a.classList.contains('maplibregl-compact-show') }; });
  check(attrib && !attrib.self && attrib.asked, 'the attribution stays behind its key until tapped: ' + JSON.stringify(attrib));
});

// Panel round 1, rank 5 (D-3, R-5, I-6, D-6): the app comes back whole after a replay or a drive
flow('the app comes back whole: the deck after a car-started drive, the end card closed by a tab or the Log, a no-score card that reads as a drive, Done from any mode (panel round 1 D-3, R-5, I-6, D-6)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apex && window.ApexCore && !document.getElementById('boot'), null, { timeout: 10000 });
  // the deck: Where to? and Start whole above the tab bar (free-drive/phone/021 had it parked 2 px tall behind the tabs)
  const deck = () => page.evaluate(() => { const bar = document.getElementById('planBar').getBoundingClientRect(), tabs = document.getElementById('tabbar').getBoundingClientRect();
    const start = document.getElementById('startDrive'), r = start.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: hit ? (hit.id || hit.className) : null, barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), tabsTop: Math.round(tabs.top), startHit: !!hit && start.contains(hit), plan: getComputedStyle(document.documentElement).getPropertyValue('--plan-bar').trim() }; });
  const idle = await deck();
  check(idle.startHit && idle.barBottom <= idle.tabsTop + 1, 'the idle deck: ' + JSON.stringify(idle));
  // R-5: a free drive started and ended from the car, then the end card's Done
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'start', free: true }));
  await page.waitForFunction(() => window.apexDebug.driveActive && document.getElementById('app').classList.contains('live'));
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.apex.live({ lat: 35.5 + i * 1e-4, lon: -83.9, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked', seq: i + 1, at: Date.now() - 120e3 + i * 1000 }); });
  await page.evaluate(() => window.apex.onNative({ type: 'carplay', action: 'end' }));
  await page.waitForSelector('#endCard.show', { timeout: 8000 });
  await scoredCard(page);
  await page.click('#endDone');
  await page.waitForTimeout(400);                                       // the deck's slide (200 ms)
  const after = await deck();
  check(!(await page.evaluate(() => document.getElementById('app').classList.contains('live'))) && after.startHit && after.barTop === idle.barTop && after.plan !== '2px',
    'after the drive the deck is whole again: ' + JSON.stringify({ idle, after }));
  // D-6 / R-5: a drive with no score says what it was in the score's slot, never "-- /1000" and a failed-exam sentence
  const card = (id, name) => page.evaluate(([id, name]) => { const lat = [], lon = []; for (let i = 0; i < 300; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29); }
    apexDebug.showEndCard({ id, name, date: new Date().toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15), lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }, Date.now() - 600e3); }, [id, name]);
  await page.evaluate(() => { ApexCore.driverScore = () => ({ score: null, components: {} }); });
  await card('nc', 'Circle Freeway');
  await scoredCard(page);
  const none = await page.evaluate(() => { const s = document.getElementById('endScore'), box = s.parentElement;
    return { score: s.textContent, line: document.getElementById('endLine').textContent, of1000: !!box.querySelector('small').offsetParent, label: !!box.querySelector('span').offsetParent, unk: s.classList.contains('unk') }; });
  check(/^[\d.]+ (mi|km) · no corners to score$/.test(none.score) && !none.of1000 && !none.label && !none.unk && !/Not enough clean corners|--/.test(none.line + none.score), 'no score: the drive in words in the score slot: ' + JSON.stringify(none));
  // R-5 / I-6: a tab never opens under the card; the Log takes the screen from it too
  await page.evaluate(() => document.querySelector('.tab[data-view="garage"]').click());
  check(!(await page.isVisible('#endCard.show')) && await page.evaluate(() => document.getElementById('sheet').classList.contains('open')), 'Garage closes the end card (dynamic-type/phone/010)');
  await page.evaluate(() => document.querySelector('.tab[data-view="garage"]').click());
  await page.evaluate(() => { ApexCore.driverScore = () => ({ score: 640, components: {} }); });
  await card('sc', 'Cherohala Skyway');
  await scoredCard(page);
  check(await page.evaluate(() => /^\d+$/.test(document.getElementById('endScore').textContent) && !document.querySelector('.end-score').classList.contains('no-score')), 'a scored card keeps its number');
  await page.click('#endLog');
  await page.waitForFunction(() => { const f = document.getElementById('logFrame'); return f && !f.hidden; });
  check(!(await page.isVisible('#endCard.show')), 'Open in the Log takes the screen from the card');
  await page.evaluate(() => window.ApexLogHost.close('map'));
  check(!(await page.isVisible('#endCard.show')), 'and the card does not come back over the map');
  // D-3: Done gives the app back whatever mode the page was in (a 'live' left behind with no drive)
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && document.getElementById('app').classList.contains('replaying'), null, { timeout: 15000 });
  await page.evaluate(() => { apexDebug.state.mode = 'live'; });
  await page.click('#replayDone');
  const back = await page.evaluate(() => ({ idle: document.getElementById('app').classList.contains('idle'), replaying: document.getElementById('app').classList.contains('replaying'), tabs: !!document.getElementById('tabbar').offsetHeight, mode: apexDebug.state.mode, plate: document.getElementById('modePlate').hidden }));
  check(back.idle && !back.replaying && back.tabs && back.mode !== 'live' && back.plate, 'Done closes the replay from any mode and the tabs come back: ' + JSON.stringify(back));
});

// P-1 (panel round 1): a crew link is a newcomer's way in: the welcome first, saying the link waits, then the crew
flow('a crew link opens the welcome first, then the crew (panel round 1 P-1)', async (page, base) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: new URL(route.request().url()).pathname === '/api/me' ? '{"signed_in":false}' : '[]' }));
  await page.goto(base + '/index.html?crew=CREWTOKEN123');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  check(/A crew link is waiting/.test(await page.textContent('#obLink')) && await page.isVisible('#obLink'), 'the welcome says the link waits');
  await page.click('#obNext');
  check(!(await page.isVisible('#onboard.show')), 'Start closes the welcome');
  await page.waitForSelector('#crewsBody >> text=You have a crew link', { timeout: 10000 });
  check(await page.evaluate(() => document.getElementById('sheet').classList.contains('open') && document.getElementById('sheet').dataset.view === 'people'), 'then the crew: People open on its Crews side');
  check(await page.evaluate(() => localStorage.getItem('apex.onboarded') === '1'), 'and the welcome is seen once');
  // a returning driver's link goes straight to it, as before; a welcome without a link has no link line
  await page.goto(base + '/index.html?crew=CREWTOKEN123');
  await page.waitForSelector('#crewsBody >> text=You have a crew link', { timeout: 10000 });
  check(!(await page.isVisible('#onboard.show')), 'no welcome the second time');
  await page.evaluate(() => localStorage.removeItem('apex.onboarded'));
  await page.goto(base + '/index.html');
  await page.waitForSelector('#onboard.show', { timeout: 10000 });
  check(!(await page.isVisible('#obLink')), 'no link line without a link');
});

flow('the theme cards and the words example say the real words, in the driver\'s mode (panel round 2 HE-3, SO-1)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && document.querySelector('#themeCards .theme-card'));
  const read = () => page.evaluate(() => ({ head: document.querySelector('#themeCards .tp-call b').textContent, tail: document.querySelector('#themeCards .tp-call i').textContent,
    quote: document.querySelector('#themeCards .tc-voice p').textContent, example: document.getElementById('noteWordsNote').textContent,
    call: ApexVocabulary.sampleCall(apexDebug.state.noteWords, { plain: ApexPlainNotes, units: ApexUnits, paceNoteText: ApexCore.paceNoteText }) }));
  const plain = await read();
  check(plain.head === 'MEDIUM RIGHT' && plain.tail === 'CAREFUL · LONG' && plain.quote.includes(`"${plain.call}.`) && plain.example === `For example "${plain.call}".`
    && !/TIGHTENS|Late apex|Slow down/.test(plain.head + plain.quote + plain.example), 'plain words, generated: ' + JSON.stringify(plain));
  await page.evaluate(() => document.querySelector('#noteWordsList [data-words="rally"]').click());
  const rally = await read();
  check(rally.head === 'RIGHT 3' && rally.quote.includes(`"${rally.call}.`) && rally.example.includes(rally.call), 'rally notes, generated: ' + JSON.stringify(rally));
});

flow('small things: Notes is a detent, Layers never cuts the place plate, the Log pager draws its arrows (REVIEW4 U-82, U-81, U-76)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug);
  await page.click('#swTab');
  await page.waitForTimeout(400);
  const notes = await page.evaluate(() => [...document.querySelectorAll('#swPanel [data-notes]')].map((b) => b.textContent + ':' + b.getAttribute('aria-checked')).join());
  check(notes === 'Quiet:false,Auto:true,Full:false', 'three stops, Auto lit: ' + notes);
  await page.click('#swPanel [data-notes="full"]');
  const after = await page.evaluate(() => ({ mode: apexDebug.state.notesMode, switches: document.querySelectorAll('[data-notes="full"]').length,
    garage: document.getElementById('coNotesNow').textContent }));
  // SO-1 (panel round 2): one setting, one home: the Notes switch is in Layers only, and the Garage says what it is set to
  check(after.mode === 'full' && after.switches === 1 && /^Notes: Full/.test(after.garage), 'a stop is chosen, one switch, and the Garage says it: ' + JSON.stringify(after));
  // the place plate (shown here by hand: it needs a place lookup) slides up out of the panel's way, whole or gone
  const plate = await page.evaluate(() => { const p = document.querySelector('.place-plate'); if (!p) return null; p.hidden = false; p.textContent = 'Colerain Township · Dry · 63°';
    return new Promise((r) => setTimeout(() => { const b = p.getBoundingClientRect(), cs = getComputedStyle(p); r({ bottom: b.bottom, opacity: cs.opacity }); }, 400)); });
  check(!plate || (plate.bottom <= 0 || plate.opacity === '0'), 'the plate is out of the open panel\'s way: ' + JSON.stringify(plate));
  await page.evaluate(async () => { const lat = [], lon = []; for (let i = 0; i < 200; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9); }
    await ApexRecording.store({ id: 'pg1', name: 'Pager', date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps' }); });
  await page.goto(base + '/analysis.html?drive=pg1');
  await page.waitForSelector('.dv-z', { timeout: 15000, state: 'attached' });
  const pager = await page.evaluate(() => [...document.querySelectorAll('.dv-z')].filter((b) => /Earlier|Later/.test(b.getAttribute('aria-label') || '')).map((b) => ({ svg: !!b.querySelector('svg'), text: b.textContent })));
  check(pager.length === 2 && pager.every((p) => p.svg && !/[◀▶]/.test(p.text)), 'the pager arrows are drawn, not emoji-prone characters: ' + JSON.stringify(pager));
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
  // P-11: an ad-hoc convoy is the map's Start key: Convoy now, and the sheet opens on the code for the car park
  await page.click('#startMore');
  await page.waitForSelector('.start-sheet .rec-key');
  check(/^Just drive$/.test((await page.textContent('.start-sheet .rec-key')).trim()), 'the key\'s chevron offers Just drive and Convoy now');
  await page.click('.start-sheet button:has-text("Convoy now")');
  await page.waitForSelector('.convoy-sheet canvas.cv-qr');
  check(/you are leading/.test(await page.textContent('.convoy-sheet')) && await page.isVisible('.convoy-sheet button:has-text("Start the drive")'), 'leading, the code up, the drive one key away');
  const dark = await page.evaluate(() => { const c = document.querySelector('canvas.cv-qr'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n / (d.length / 4); });
  check(dark > 0.2 && dark < 0.6, `a QR code is drawn (${(dark * 100).toFixed(0)} % dark)`);
});

// @fish5spd, 2026-11-03 ("Shits in my way when I lead"): leading a convoy on a drive, a card over the road just ahead of the
// arrow held the convoy's line and a row of calls cut off under the Layers key. Now the convoy is one line behind the car,
// clear of the right-hand keys and the safe areas, upright and on its side; the calls come from the Report key or the line.
flow('convoy: ten minutes before it ends the leader is told and can keep it going another hour (Worker stubbed)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  const id = 'KKKKKKKKKKKKKKKKKKKKKK', t0 = Date.now(), keeps = [];
  const ctx = { sessionId: id, name: 'Sunday run', role: 'leader', you: 'k1', leaderKey: 'k1', expiresAtMs: t0 + 9 * 60000 + 30000, maxExpiresAtMs: t0 + 4 * 3600000, keepWindowMs: 30 * 60000, seq: 0, leaderEpoch: 1,
                members: [{ key: 'k1', handle: 'lead', role: 'leader', online: true }, { key: 'k2', handle: 'mate', role: 'member', online: true }] };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'lead' });
    if (u.pathname === '/api/convoy' && m === 'POST') return json({ invite: `${id}.${'s'.repeat(32)}`, context: ctx }, 201);
    if (u.pathname === `/api/convoy/${id}/keep` && m === 'POST') { keeps.push(1); ctx.expiresAtMs += 3600000; return json({ expiresAtMs: ctx.expiresAtMs, maxExpiresAtMs: ctx.maxExpiresAtMs }); }
    if (u.pathname === `/api/convoy/${id}/ticket`) return json({ error: 'unavailable' }, 503);   // no socket here: the card's own words are under test
    if (u.pathname === `/api/convoy/${id}`) return json(ctx);
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => document.getElementById('startMore').click());
  await page.click('.start-sheet button:has-text("Convoy now")');
  await page.waitForSelector('.convoy-sheet button:has-text("Keep going 1 h")');
  check(/\b[89] min left/.test(await page.locator('.convoy-sheet').innerText()), 'the card says how long is left');
  // the heads-up, once, with the key on it
  await page.waitForFunction(() => /Convoy ends in (9|10) min\./.test(document.getElementById('toast').textContent) && /Keep going/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  await page.click('.convoy-sheet button:has-text("Keep going 1 h")');
  await page.waitForFunction(() => /Convoy kept going: 1 h [89] min left\./.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  check(keeps.length === 1, 'asked the server once');
  await page.waitForFunction(() => !/Keep going 1 h/.test(document.querySelector('.convoy-sheet').innerText) && /1 h [89] min left/.test(document.querySelector('.convoy-sheet').innerText), null, { timeout: 5000 });
  check(true, 'with over half an hour left again the key is gone and the card shows the new time');
});

flow('convoy: leading a drive, the convoy is one line behind the car and the calls come when asked (Worker stubbed, @fish5spd 2026-11-03)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  const id = 'CCCCCCCCCCCCCCCCCCCCCC', until = Date.now() + 120 * 60000;
  const ctx = { sessionId: id, name: '@fish5spd and @natesenft', role: 'leader', you: 'k1', leaderKey: 'k1', expiresAtMs: until, seq: 0, leaderEpoch: 1,
                members: [{ key: 'k1', handle: 'fish5spd', role: 'leader', online: true }, { key: 'k2', handle: 'natesenft', role: 'member', online: true }] };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'fish5spd' });
    if (u.pathname === '/api/convoy' && m === 'POST') return json({ invite: `${id}.${'s'.repeat(32)}`, context: ctx }, 201);
    if (u.pathname === `/api/convoy/${id}/ticket`) return json({ ticket: 't'.repeat(32), expiresAtMs: Date.now() + 60000 }, 201);
    if (u.pathname === `/api/convoy/${id}`) return json(ctx);
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.context().grantPermissions(['geolocation']);   // the browser's own GPS, for Start the drive
  await page.context().setGeolocation({ latitude: 35.36, longitude: -84.29 });
  const cdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width: SAFE.portrait.w, height: SAFE.portrait.h });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  // (a script's tap: Playwright's click scrolls the clipped stage to bring the plan bar's key "into view", which a finger can't)
  await page.evaluate(() => document.getElementById('startMore').click());
  await page.click('.start-sheet button:has-text("Convoy now")');
  await page.waitForSelector('.convoy-sheet canvas.cv-qr');
  await page.click('.convoy-sheet button:has-text("Start the drive")');
  check(await page.evaluate(() => { const s = document.querySelector('.stage'); return !s.scrollLeft && !s.scrollTop; }), 'the map stage is where it was');
  await page.evaluate(async () => { for (let i = 0; i < 40; i++) { window.apex.live({ lat: 35.36 + i * 1e-5, lon: -84.29, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 40)); } });
  await page.waitForFunction(() => document.getElementById('app').classList.contains('live') && document.querySelector('.convoy-bar.show'));
  await page.waitForTimeout(1200);   // a tick: the bar redraws for the drive
  const geo = () => page.evaluate(() => {
    const R = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return r.width && r.height ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; };
    const bar = document.querySelector('.convoy-bar.show'), puck = document.querySelector('.puck'), stage = document.querySelector('.stage');
    const keys = ['.edge-tab', '#recenterBtn', '.maplibregl-ctrl-attrib', '#hzPlate', '#toast'].map((q) => [q, R(document.querySelector(q))]).filter(([, r]) => r);
    const inside = (a, b) => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;
    const meet = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;
    const b = R(bar), p = R(puck), s = R(stage);
    // the road ahead: from the top of the map down to the arrow, across the arrow and 120 px either side of it
    const ahead = p && { l: Math.max(s.l, (p.l + p.r) / 2 - 120), r: Math.min(s.r, (p.l + p.r) / 2 + 120), t: s.t, b: p.t };
    return { bar: b, puck: p, stage: s, rows: bar.querySelectorAll('.cv-calls, .cv-call-grid').length, kids: bar.children.length,
      text: bar.innerText, coversAhead: !!(ahead && meet(b, ahead)), behind: !!(p && b.t >= (p.t + p.b) / 2), inStage: inside(b, s),
      keysInBar: [...bar.querySelectorAll('button')].every((k) => inside(R(k), b)),
      hits: keys.filter(([, r]) => meet(b, r)).map(([q]) => q), oneLine: b.b - b.t <= 64 };
  });
  let g = await geo();
  check(g.puck && g.rows === 0 && g.kids === 1 && /@fish5spd and @natesenft/.test(g.text) && /of 2 live|Reconnecting|Connecting/.test(g.text), 'in a drive the convoy is one line, no calls row: ' + JSON.stringify(g));
  check(!g.coversAhead && g.behind && g.inStage && g.keysInBar && !g.hits.length && g.oneLine, 'the line is off the road ahead, behind the car, whole and clear of the keys: ' + JSON.stringify(g));
  let bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'upright, clear of the island, the corners and every key: ' + bad.join(' | '));
  // the leader's calls: the Report key's sheet, on top of the public report; a call closes it and the line holds Undo for 3 s
  const reportSheet = async () => {
    await page.click('#hzReportBtn');
    await page.waitForSelector('#hzOverlay.show .cv-report');
    await page.waitForTimeout(400);   // the sheet's slide up
    return page.evaluate(() => { const card = document.querySelector('#hzOverlay .card-sheet'), c = card.getBoundingClientRect();
      const ks = [...card.querySelectorAll('.cv-report button, #hzKinds button')];
      return { keys: [...card.querySelectorAll('.cv-report button')].map((k) => k.textContent),
        clipped: ks.filter((k) => { const r = k.getBoundingClientRect(); return r.left < c.left - 0.5 || r.right > c.right + 0.5 || k.scrollWidth > k.clientWidth + 1; }).map((k) => k.textContent),
        first: card.firstElementChild.classList.contains('cv-report'), publicKinds: document.querySelectorAll('#hzKinds button').length }; });
  };
  const sheet = await reportSheet();
  check(JSON.stringify(sheet.keys) === '["Bump","Gravel","Debris","Animal","Police","Stopped car","Regroup here"]', 'the convoy calls in the Report sheet: ' + JSON.stringify(sheet));
  check(!sheet.clipped.length && sheet.first && sheet.publicKinds >= 6, 'every call whole, convoy first, the public report still under it: ' + JSON.stringify(sheet));
  bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the Report sheet with the calls is clear: ' + bad.join(' | '));
  await page.click('#hzOverlay .cv-report button:has-text("Bump")');
  check(!(await page.isVisible('#hzOverlay.show')), 'a call closes the sheet');
  await saidOn(page, /Bump (called to|will go out)/, { timeout: 4000 });
  g = await geo();
  check(/Undo Bump/.test(g.text) && g.oneLine && !g.coversAhead && g.keysInBar && !g.hits.length, 'Undo on the line, still one line behind the car: ' + JSON.stringify(g));
  await page.click('.convoy-bar .cv-undo');
  await saidOn(page, /Call cancelled|Cancelling/, { timeout: 4000 });
  // a tap on the line: the convoy sheet, the calls first
  await page.click('.convoy-bar .cv-line');
  await page.waitForSelector('.convoy-sheet .cv-callbox');
  check(await page.evaluate(() => { const k = [...document.querySelectorAll('.convoy-sheet .cv-callbox button')]; return k.length === 7 && document.querySelector('.convoy-sheet .stack-8').firstElementChild.classList.contains('cv-callbox'); }), 'the line opens the convoy with the calls on top');
  await page.click('.convoy-sheet .cv-callbox button:has-text("Gravel")');
  check(!(await page.$('.convoy-sheet')), 'a call from the convoy sheet closes it too');
  await page.waitForTimeout(3300);   // the Undo window passes: the line is the line again
  g = await geo();
  check(g.kids === 1 && !/Undo/.test(g.text), 'after 3 s the Undo goes: ' + g.text);
  // on its side (the landscape mount): behind the car, clear of the notch, the home indicator and the keys
  await page.setViewportSize({ width: SAFE.landscape.w, height: SAFE.landscape.h });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.landscape.i });
  await page.evaluate(async () => { for (let i = 40; i < 60; i++) { window.apex.live({ lat: 35.36 + i * 1e-5, lon: -84.29, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 40)); } });
  await page.waitForTimeout(700);
  g = await geo();
  check(!g.coversAhead && g.behind && g.inStage && g.keysInBar && !g.hits.length && g.oneLine && g.bar.l >= SAFE.landscape.i.left, 'on its side, the same: ' + JSON.stringify(g));
  bad = await unsafe(page, SAFE.landscape);
  check(!bad.length, 'on its side, clear of the notch, the corners and every key: ' + bad.join(' | '));
  const side = await reportSheet();
  check(side.keys.length === 7 && !side.clipped.length && side.publicKinds >= 6, 'on its side, every call whole beside the public report: ' + JSON.stringify(side));
  bad = await unsafe(page, SAFE.landscape);
  check(!bad.length, 'on its side, the Report sheet with the calls is clear: ' + bad.join(' | '));
}, { hasTouch: true });

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
    const host = el('div', { id: 'e2eGarage' }); host.style.cssText = 'position:relative;z-index:50';   // over the map's fixed stage (F-02)
    document.body.prepend(host); host.append(g.section());
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
  const N = (m) => m / 110540, votes = [], reports = [], asked = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/hazards' && m === 'GET') { asked.push(u.search); return json([{ id: 'h1', kind: 'gravel', lat: 35.6 + N(200), lon: -83.9, heading: 0, confirms: 2, clears: 0, m: 5000 }]); }
    if (u.pathname === '/api/hazards' && m === 'POST') { reports.push(JSON.parse(route.request().postData())); return json({ id: 'mine1', confirmed: false }, 201); }
    if (u.pathname === '/api/hazards/h1/vote') { votes.push(JSON.parse(route.request().postData())); return json({ ok: true }); }
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  // VI-1: the drive starts 1.6 km south, past the private edge (1 to 1.5 km), quickly: nothing is asked before it
  const run = (from, to) => page.evaluate(async ([a, b]) => {
    for (let i = a; i < b; i++) { window.apex.live({ lat: 35.6 + (i * 10 - 1600) / 110540, lon: -83.9, accuracy_m: 5, speed_mps: 15, course_deg: 0, has_fix: true, calibration: 'locked' });
      await new Promise(r => setTimeout(r, 5)); }
  }, [from, to]);
  await run(0, 98); await page.waitForTimeout(300);
  check(asked.length === 0, 'nothing asked in the drive\'s first km: ' + JSON.stringify(asked));
  await run(98, 160);
  await page.evaluate(async () => {   // heading north at 15 m/s, 1.5 m per 100 ms, from 0 m to 330 m
    for (let i = 0; i <= 220; i++) { window.apex.live({ lat: 35.6 + (i * 1.5) / 110540, lon: -83.9, accuracy_m: 5, speed_mps: 15, course_deg: 0, has_fix: true, calibration: 'locked' });
      const k = window.apexDebug.state.lastSaid;   // a line the voice pack says (web/voice_lines.js) never reaches speechSynthesis
      if (k && window.__said[window.__said.length - 1] !== k) window.__said.push(k);
      await new Promise(r => setTimeout(r, 20)); }
  });
  await page.waitForFunction(() => !document.getElementById('hzAsk').hidden, null, { timeout: 5000 });
  check(/Gravel still there\?/.test(await page.textContent('#hzAsk')), 'asks after passing it');
  await page.click('#hzGone');
  for (let i = 0; i < 40 && !votes.length; i++) await page.waitForTimeout(50);   // the vote is a request: let it land
  check(votes.length === 1 && votes[0].still === false, 'the vote is sent');
  // VI-1: asked by the 0.1-degree cell, never the position (the phone measures the 200 m itself)
  check(asked.length >= 1 && asked.every((q) => /^\?lat=35\.6&lon=-83\.9&km=20$/.test(q)), 'the hazards are asked for by cell: ' + JSON.stringify(asked));
  check(await page.evaluate(() => window.__said.some((t) => /gravel reported ahead/i.test(t)) || /Gravel reported ahead/.test(document.body.textContent)), 'the hazard was called ahead');
  await page.click('#hzReportBtn');
  await page.click('#hzKinds button:has-text("Pothole")');
  // REVIEW4 U-74 / U-102 (check): in a drive the confirmation is the status line's, never a toast over the map
  await page.waitForFunction(() => /Pothole reported/.test(document.getElementById('dsNote').textContent));
  check(!(await page.evaluate(() => document.getElementById('toast').classList.contains('show') && /Pothole/.test(document.getElementById('toast').textContent))), 'no toast over the map');
  check(await page.evaluate(() => { const n = document.getElementById('dsNote'); return !n.hidden && n.scrollWidth <= n.clientWidth + 1 && /reported/.test(n.getAttribute('aria-label')); }), 'the status line says it whole (or its first sentence)');
  check(reports.length === 1 && reports[0].kind === 'pothole' && Math.abs(reports[0].lat - (35.6 + 330 / 110540)) < 1e-4 && reports[0].heading === 0, 'reported at your position and heading');
});

flow('review mode (U-94): the recording\'s hazard report is the sheet, Undo and a pin, and nothing reaches the server', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} window.APEX_REVIEW = true; });
  const writes = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    if (m !== 'GET' && m !== 'HEAD') writes.push(`${m} ${u.pathname}`);
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'vetta_review' });
    return m === 'GET' ? json([]) : json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(async () => {   // heading north at 15 m/s
    for (let i = 0; i <= 40; i++) { window.apex.live({ lat: 35.6 + (i * 1.5) / 110540, lon: -83.9, accuracy_m: 5, speed_mps: 15, course_deg: 0, has_fix: true, calibration: 'locked' });
      await new Promise(r => setTimeout(r, 20)); }
  });
  await page.click('#hzReportBtn');
  check(await page.evaluate(() => document.getElementById('hzOverlay').classList.contains('show')), 'the sheet opens');
  await page.click('#hzKinds button:has-text("Gravel")');
  check(/Undo Gravel/.test(await page.textContent('#hzReportBtn')), 'the Report key is Undo for 3 s');
  await saidOn(page, /Gravel reported/, { timeout: 6000 });                 // the toast, or the status line in a drive (U-74)
  await page.waitForFunction(() => [...document.querySelectorAll('.hz-pin')].some((p) => p.textContent === 'GRAVEL'), null, { timeout: 4000 });
  await page.evaluate(async () => { await ApexSync.apiFetch('/api/presence', { method: 'POST', body: '{}' }); await ApexSync.apiFetch('/api/feedback', { method: 'POST', body: '{}' }); });
  await page.waitForTimeout(1500);   // loadReported(true) after the report: the server's list again, with the review's own pin kept
  check([...await page.$$eval('.hz-pin', (ps) => ps.map((p) => p.textContent))].includes('GRAVEL'), 'the pin outlives a reload of the server\'s hazards');
  check(writes.length === 0, 'nothing was written to the server: ' + writes.join(', '));
  check(await page.evaluate(() => !localStorage.getItem('apex.outbox')), 'nothing waits in the outbox either');
});

flow('your data: Settings counts what the phone holds and downloads drives as GPX, offline data deleted (IDEAS Z-03/Z-04, F-06)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexRecording && window.ApexMyData);
  await page.evaluate(() => ApexRecording.store({ id: 'e2e_drive', name: 'Test road', date: '2026-10-20T15:00:00Z',
    lat: [35.6, 35.601, 35.602], lon: [-83.9, -83.901, -83.902], elev: null, dist: [0, 150, 300] }));
  await page.click('.tab[data-view="garage"]');
  await openSetting(page, 'data');
  await page.waitForFunction(() => /1 drive \(0.2 mi\)/.test(document.getElementById('myDataNote').textContent));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#myGpxBtn')]);
  const gpx = require('fs').readFileSync(await dl.path(), 'utf8');
  check(/<trk><name>Test road<\/name>/.test(gpx) && (gpx.match(/<trkpt /g) || []).length === 3, 'the GPX holds the drive');
  await page.click('#myDrivesDelBtn');
  await page.click('.confirm-sheet .cs-yes:has-text("Delete drives")');             // the confirm sheet, not a system alert (REVIEW.md 1.2)
  await page.waitForFunction(() => /^Nothing on this phone yet/.test(document.getElementById('myDataNote').textContent));   // U-126: no line of zeros
  // offline data (IDEAS F-06): a saved route counted, then deleted; the drives are not touched by it
  await page.evaluate(() => { localStorage.setItem('apex.savedRoutes', JSON.stringify([{ id: 'r1', coords: [[0, 0], [1, 1]] }])); document.querySelector('.tab[data-view="garage"]').click(); });
  // the Garage tab again closes the Menu; since AM-1 a closed Menu can't be reached, so it is opened once more
  if (!(await page.evaluate(() => document.getElementById('sheet').classList.contains('open')))) await page.click('.tab[data-view="garage"]');
  await openSetting(page, 'data');
  await page.waitForFunction(() => /Offline data: 1 saved route /.test(document.getElementById('myOfflineNote').textContent));
  await page.click('#myOfflineDelBtn');
  await page.click('.confirm-sheet .cs-yes');
  await page.waitForFunction(() => /^Nothing saved for offline/.test(document.getElementById('myOfflineNote').textContent));
  check((await page.evaluate(() => localStorage.getItem('apex.savedRoutes'))) === null, 'saved routes gone');
});

flow('loved roads: in the app a recorded drive\'s road feel says it was recorded, and the saved drive is not offered again by hand (Worker stubbed)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  const posts = [], lat0 = 35.5, lon0 = -83.9, cors = { 'access-control-allow-origin': '*' };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/contribute' && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return json({ accepted: true }, 202); }
    if (m !== 'GET') return route.fulfill({ status: 204 });
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (p === '/api/me/export') return json({ member: { contribute: 1 } });
    return json([]);
  });
  await page.route('**/trace_attributes', (route) => { const sh = JSON.parse(route.request().postData()).shape;
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: sh.map(() => ({ type: 'matched', edge_index: 0 })) }) }); });
  await page.route('**/api/interpreter', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ elements: [{ type: 'way', id: 77, geometry: [{ lat: lat0 - 0.01, lon: lon0 }, { lat: lat0 + 0.09, lon: lon0 }] }] }) }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apex && window.ApexAnalysis && window.ApexContributor && window.ApexRecording);
  const frames = ([a, b, lat0, lon0]) => { for (let j = a; j < b; j++) window.apex.live({ lat: lat0 + j * 1e-4, lon: lon0, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0, lon_g: 0, has_fix: true, calibration: 'locked', roughness_rms: 0.1 }); };
  await page.evaluate(frames, [0, 1, lat0, lon0]);                                        // mounted: the app asks whether sharing is on
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  for (let burst = 0; burst < 7; burst++) { await page.evaluate(frames, [burst * 100 + 1, (burst + 1) * 100 + 1, lat0, lon0]); await page.waitForTimeout(400); }   // 7.7 km due north
  check(posts.length >= 1 && posts.every((c) => c.rec === 1 && c.way_id === 77), 'what went during the recorded drive says it was recorded: ' + JSON.stringify(posts.map((c) => [c.bins.length, c.rec])));
  await page.evaluate(() => { document.getElementById('driveEnd').click(); window.apexDebug.endNow(); });
  const saved = await page.evaluate(async () => { for (let i = 0; i < 150; i++) { const l = (await ApexAnalysis.job('summaries')).list; if (l.length && l[0].contributed) return l[0].contributed; await new Promise((r) => setTimeout(r, 100)); } return (await ApexAnalysis.job('summaries')).list.map((x) => x.contributed); });
  check(saved === true, 'the saved drive is marked shared, so the Log does not offer it by hand: ' + JSON.stringify(saved));
});

flow('road feel that waited for signal: counted in Your data, kept while Road data can\'t be confirmed, sent once when the phone is back online (IDEAS Q-06)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.signedIn', '1'); } catch (_) {} });
  // the Worker: at first it can't be reached for the account (kept, nothing asked of /api/contribute), then a member with Road data on
  const posted = []; let member = false;
  await page.route(base + '/api/me', (route) => (member ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ signed_in: true, member: true, handle: 'e2e' }) }) : route.fulfill({ status: 503, body: '' })));
  await page.route(base + '/api/me/export', (route) => (member ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ member: { contribute: 1 } }) }) : route.fulfill({ status: 503, body: '' })));
  await page.route(base + '/api/contribute', (route) => { posted.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.ApexRoadCarry && ApexRoadCarry.flush && window.ApexMyData && window.apexDebug);
  // a trip that ended with no signal left one built chunk of 2 km (as createLive's leftover() hands it over), in the real store
  await page.evaluate(async () => {
    const day = new Date().toISOString().slice(0, 10), id = 'd_e2e_carry_0001';
    ApexRoadCarry.hold({ driveId: id, drivenOn: day, deliberate: true, hr: null, rows: { lat: [], lon: [], rough: [], camber: [], crest: [], speed: [], lon_g: [] },
      pending: [{ way_id: 4242, dir: 0, driven_on: day, drive_id: id, bins: Array.from({ length: 400 }, (_, i) => ({ i, cam: null, rough: 0.12, crest: null, k: 0.001, fl: null, hb: null })), shape: null, cls: 'secondary', cam_v: 2, rec: 1 }] }, true);
    await ApexRoadCarry.idle();
  });
  check((await page.evaluate(() => ApexRoadCarry.size())) === 1 && (await page.evaluate(() => ApexRoadCarry.itemM({ rows: { lat: [1, 2] }, pending: [{ bins: [1, 2, 3] }] }))) === 25, 'one trip waits in the store');
  await page.click('.tab[data-view="garage"]');
  await openSetting(page, 'data');
  await page.waitForFunction(() => /road data from 1\.2 mi waiting for signal/.test(document.getElementById('myDataNote').textContent));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(700);
  check(posted.length === 0 && (await page.evaluate(() => ApexRoadCarry.size())) === 1, 'the account can\'t be confirmed: nothing sent, nothing lost');
  // back online, a member with Road data on: the chunk goes as built, once, and the phone says so
  member = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => /Sent 1\.2 mi of road feel that waited for signal\./.test(document.getElementById('toast').textContent));
  check(posted.length === 1 && posted[0].way_id === 4242 && posted[0].drive_id === 'd_e2e_carry_0001' && posted[0].bins.length === 400 && posted[0].rec === 1 && posted[0].cls === 'secondary', 'the chunk went as built, marked as a recorded drive');
  await page.evaluate(() => ApexRoadCarry.idle());
  check((await page.evaluate(() => ApexRoadCarry.size())) === 0 && (await page.evaluate(() => localStorage.getItem('apex.roadCarry'))) === null, 'and it is gone from the phone');
  await page.waitForFunction(() => !/waiting for signal/.test(document.getElementById('myDataNote').textContent));   // Your data stops counting it
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(400);
  check(posted.length === 1, 'never twice');
});

flow('shared routes: one a friend shared shows on People, Friends, under From friends, and opens as a planned route with notes (Worker stubbed, IDEAS S-05)', async (page, base) => {
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
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());   // Friends is the side it opens on
  await page.waitForSelector('#accountBody .nav-row:has-text("From friends")');
  await page.waitForFunction(() => [...document.querySelectorAll('#accountBody .nav-row')].some((r) => /From friends/.test(r.textContent) && r.querySelector('small').textContent === '1 route'));   // the row says what it counts (U-125)
  await page.click('#accountBody .nav-row:has-text("From friends")');
  await page.waitForSelector('.side-pop.open >> text=Cherohala loop · from @alice');
  await page.click('.side-pop.open button:has-text("Open")');
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
  await saidOn(page, /Debris saved/);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('apex.outbox')).length) === 1, 'kept on the phone');
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saidOn(page, /Sent what you reported/, { timeout: 5000 });
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
  // REVIEW4 U-102: said in the drive's status line (its whole text in the live region), not as a toast over the map
  await page.waitForFunction(() => /Esses: (level with|\d+ points (up|down) on) your best/.test(document.getElementById('dsNote').getAttribute('aria-label') || ''), null, { timeout: 4000 });
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

flow("what's new: shown once after an update, not on a first install, not over a link that opened the app (IDEAS O-10), and never over something you have started", async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); if (!localStorage.getItem('apex.newsSeen')) localStorage.setItem('apex.newsSeen', 'an-older-release'); } catch (_) {} });
  // straight to Where to? and its Options as the app opens (it came up over Options, 2026-11-10): no news this launch
  await page.goto(base + '/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.apexDebug, null, { timeout: 20000, polling: 20 });
  await page.mouse.click(200, 300);                                      // a thumb on the screen as it opens, splash or not
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('planOptionsChip').click());
  await page.waitForFunction(() => document.getElementById('optSheet').classList.contains('open'), null, { timeout: 5000 });
  await page.waitForTimeout(2500);
  check(!(await page.$('#newsSheet')), 'nothing comes up over what you are doing');
  check(await page.evaluate(() => localStorage.getItem('apex.newsSeen')) === 'an-older-release', 'and it is not marked seen: it waits for a quiet launch');
  // the next launch, hands off: it shows once the splash has lifted, never over it
  await page.goto(base + '/index.html');
  await page.waitForSelector('#newsSheet', { timeout: 20000 });
  check(await page.evaluate(() => !document.getElementById('boot')), 'it waits for the map, not over the splash');
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

flow('a path is a key: no shared spots near here offers "Add one", which opens Settings on Spots (it read "Garage → Settings → Spots")', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(u.pathname === '/api/me' ? { signed_in: true, member: true, handle: 'me' } : []) });
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && !document.getElementById('boot'));
  await page.click('#destInput');
  await page.waitForSelector('#planSpots:not([hidden]) > summary');
  await page.click('#planSpots > summary');
  await page.waitForSelector('#planSpots p.note button.linkbtn');
  const note = await page.textContent('#planSpots p.note');
  check(note === 'No shared spots near here yet. Add one' && !note.includes('→'), 'the note and its key: ' + note);
  await page.click('#planSpots p.note button.linkbtn');
  await page.waitForSelector('.garage-pop.open[data-setting="spots"]');
  check(await page.evaluate(() => document.getElementById('sheet').dataset.view === 'garage' && document.getElementById('sheet').classList.contains('open')), 'the Garage is open on Spots');
});

flow('crew drives: an upcoming drive shows on People, Crews, as the crew page’s card; Going answers it; the planner sets it up under More; Plan a drive is one screen with a Meet at search; spots near you (Worker stubbed, IDEAS S-06, S-12, REVIEW_PEOPLE.md P-10, P-18)', async (page, base) => {
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
      meet_name: 'Kroger lot', meet_lat: 39.3, meet_lon: -84.6, notes: null, going: 7, member: false, km: 12 }]);   // VI-1: near the map's centre, as the phone measures it
    if (u.pathname === '/api/events') return json([{ id: 'EVT1AAAAAAAAAAAA', crew_id: 'CREW1', crew_name: 'Ridge Runners', title: 'Cherohala <i>Saturday</i>', starts_at: starts,
      meet_name: 'Tellico Shell', meet_lat: 35.36, meet_lon: -84.29, route_id: null, notes: null, by_handle: 'bob', mine: false, can_cancel: false, my_rsvp: mine, going: ['bob', 'cara'], maybe: 1,
      lead: 'bob', sweep: null, regroup: [{ name: 'The overlook', lat: 35.33, lon: -84.12 }] },
      { id: 'EVT2AAAAAAAAAAAA', crew_id: 'CREW1', crew_name: 'Ridge Runners', title: 'My run', starts_at: starts, meet_name: 'Kroger lot', meet_lat: 35.76, meet_lon: -83.96, route_id: null,
        notes: null, by_handle: 'me', mine: true, can_cancel: true, my_rsvp: 'going', going: ['me'], maybe: 0, lead: 'me', sweep: null, regroup: [] }]);
    if (u.pathname === '/api/crews/CREW1/page') return json({ id: 'CREW1', name: 'Ridge Runners', visibility: 'private', members: 3, is_owner: false, livery: 'plain', board: [], sharing_scores: false, next: null, last: null });
    if (u.pathname === '/api/crews/CREW1/members') return json([{ handle: 'me', mine: true }, { handle: 'bob', mine: false }]);
    if (u.pathname === '/api/crews/CREW1/meet') return json({ cells: [[35.35, -84.25], [35.55, -83.95]], sharing: 2, mine: false, need: 2 });   // fair meeting points (crew_meet.js)
    if (u.pathname === '/api/highlights' && m === 'GET') return json([{ id: 'HL1', name: 'Look Rock <b>view</b>', lat: 35.64, lon: -83.94, score: 4.5, ratings: 6, mine: false,
      category: 'overlook', note: 'Best at sunset', visits: 9, my_stars: null }, { id: 'HL2', name: 'Bean Stop', lat: 35.75, lon: -83.97, score: 3.9, ratings: 2, mine: true, category: 'cafe' }]);
    if (m === 'POST') { posted.push([u.pathname, JSON.parse(route.request().postData() || 'null')]); return u.pathname.endsWith('/rsvp') ? (mine = 'going', route.fulfill({ status: 204 })) : json({ id: 'NEWEVTAAAAAAAAAA' }, 201); }
    if (m === 'PUT') { posted.push([u.pathname, JSON.parse(route.request().postData() || 'null'), 'PUT']); return route.fulfill({ status: 204 }); }
    if (m === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && typeof window.apex.live === 'function');
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());
  // the owner's note 05 (2026-10-31): no Crew drives row; the crew page's Upcoming drives lists the crew's drives, a + plans one
  const W = '.crew-page .cp-week';
  const openDrives = async () => {
    for (const done of await page.$$('.side-pop.open .side-pop-head button')) await done.click();   // Done on the sheet that's open
    await page.click('[data-people="crews"]');
    await page.waitForSelector(`${W} .drive-card`);
  };
  // the Photon search behind "Meet at…" (P-10)
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-84.2912, 35.3601] }, properties: { name: 'Tellico Plains Shell', city: 'Tellico Plains', state: 'Tennessee' } }] }) }));
  await openDrives();
  const card = await page.textContent(`${W} .drive-card`);
  check(card.includes('Cherohala <i>Saturday</i>') && /Tomorrow|Today/.test(card) && card.includes('2 going · 1 maybe'), 'the drive, as text: ' + card);
  // P-18: the sheet's drive is the crew page's card: the date block once, three lines, faces and one key; the rest under More
  check(await page.evaluate(() => { const c = document.querySelector('.crew-page .cp-week .drive-card:not(.meet-card)');
    return c.classList.contains('cp-drive') && !!c.querySelector('.cp-date b') && !!c.querySelector('details.cp-more:not([open])') && !c.querySelector('.switch'); }), 'the card, its detail folded under More');
  check(!/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/.test(await page.$eval(`${W} .drive-card:not(.meet-card) .cp-drive-body`, (b) => b.textContent)), 'the date said once, in the block (P-27): ' + card);
  await page.click('.drive-card:not(.meet-card) summary:has-text("More")');
  await page.waitForSelector('.drive-card:not(.meet-card) .cp-more-body');
  check((await page.textContent('.drive-card:not(.meet-card)')).includes('Going: @bob, @cara · 1 maybe'), 'More names who is going');
  await page.waitForSelector('.meet-card');
  check(/Sunday coffee/.test(await page.textContent('.meet-card')) && /7 going/.test(await page.textContent('.meet-card')) && /Meets near you/.test(await page.evaluate(() => document.querySelector('.meet-card').closest('.side-pop, #sheet').textContent)), 'a public meet nearby');   // in a crew: under the crew's Upcoming drives
  await page.click('.drive-card:not(.meet-card) .switch button:text-is("Going")');
  await page.waitForFunction(() => document.querySelector('.drive-card:not(.meet-card) .switch button[aria-checked="true"]')?.textContent === 'Going');   // the answer is a slide switch
  check(posted.some(([p, b]) => p === '/api/events/EVT1AAAAAAAAAAAA/rsvp' && b.status === 'going'), 'the answer was sent');
  // roles and regroup points (roadmap 21)
  const roles = await page.textContent('.drive-card:not(.meet-card)');
  check(roles.includes('Lead @bob · Sweep open') && roles.includes('The overlook'), 'roles and the regroup point show: ' + roles);
  await page.click('.drive-card:not(.meet-card) button:has-text("I\'ll sweep")');
  await page.waitForTimeout(300);
  check(posted.some(([p, b]) => p === '/api/events/EVT1AAAAAAAAAAAA/role' && b.role === 'sweep' && b.take === true), 'I\'ll sweep was sent');
  // the planner's own drive: notes and a regroup point set on its card, after planning (P-10); no meet switch on a private crew (P-30)
  const myCard = `${W} .drive-card:not(.meet-card):has-text("My run")`;
  await page.click(`${myCard} summary:has-text("More")`);
  await page.waitForSelector(`${myCard} .cp-set`);
  check(!/List it for everyone/.test(await page.textContent(`${myCard} .cp-set`)), 'a private crew is not offered a public meet');
  await page.fill(`${myCard} input[aria-label="Notes"]`, 'Fuel first.');
  await page.click(`${myCard} .cp-set button:text-is("Save")`);
  await page.waitForFunction(() => /Notes saved/.test(document.getElementById('toast').textContent));
  await page.waitForTimeout(400);                                     // the list redraws, More stays open
  await page.fill(`${myCard} input[aria-label="Regroup point"]`, 'Gas at Robbinsville');
  await page.click(`${myCard} .cp-set button:has-text("Map centre")`);
  await page.waitForTimeout(300);
  check(posted.some(([p, b, m]) => m === 'PUT' && p === '/api/events/EVT2AAAAAAAAAAAA' && b.notes === 'Fuel first.'), 'notes saved on the card');
  const rg = posted.find(([p, b, m]) => m === 'PUT' && p === '/api/events/EVT2AAAAAAAAAAAA' && b.regroup);
  check(rg && rg[1].regroup.length === 1 && rg[1].regroup[0].name === 'Gas at Robbinsville' && Number.isFinite(rg[1].regroup[0].lat), 'a regroup point added on the card: ' + JSON.stringify(rg));
  // spots near you (IDEAS S-12) live in Where to? (REVIEW_PEOPLE P-13), not on Friends: best rated first, as text, in miles
  // (P-12), filterable; five small stars (P-33), and a rating is sent
  for (const done of await page.$$('.side-pop.open .side-pop-head button')) await done.click();
  await page.click('[data-people="friends"]');
  check(!(await page.$('#accountBody .nav-row:has-text("Spots near you")')), 'no Spots row on Friends');
  await page.evaluate(() => document.querySelector('.tab[data-view="map"]').click());
  await page.click('#destInput');
  await page.click('#planSpots > summary');
  await page.waitForSelector('#planSpots .spot-card');
  const spots = await page.$$eval('#planSpots .spot-card', (els) => els.map((e) => e.textContent));
  check(spots.length === 2 && spots[0].includes('Look Rock <b>view</b>') && /4\.5★ \(6\) · Overlook · [\d.]+ mi · 9 visited/.test(spots[0]) && spots[0].includes('Best at sunset'), 'the spots: ' + spots.join(' | '));
  check(!/Report/.test(spots[1]) && !(await page.$$('#planSpots .spot-card:nth-child(2) .spot-star')).length, 'no rating or report on your own spot');
  check((await page.$$('#planSpots .spot-card:first-child .spot-star')).length === 5, 'five stars to rate with');
  await page.click('#planSpots button:has-text("Café")');
  check((await page.$$('#planSpots .spot-card')).length === 1, 'the café filter');
  await page.click('#planSpots button:text-is("All")');
  await page.click('#planSpots button[aria-label="Rate Look Rock <b>view</b> 5 stars"]');
  await page.waitForFunction(() => /Rated/.test(document.getElementById('toast').textContent));
  check(posted.some(([p, b]) => p === '/api/highlights/HL1/rating' && b.stars === 5), 'the rating was sent');
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());
  // plan one, on one screen (P-10): a name, the day, the time, Meet at… by search; no roles, regroup or notes up front
  await openDrives();
  check(!/Crew drives/.test(await page.$$eval('#crewsBody .nav-row', (n) => n.map((x) => x.textContent).join('|'))), 'no Crew drives row');
  await page.click(`${W} .plan-plus`);
  await page.fill(`${W} input[aria-label="Drive name"]`, 'Dragon run');
  check(!(await page.$$(`${W} .plan-drive select[aria-label="Sweep"], ${W} .plan-drive input[aria-label="Regroup point name"], ${W} .plan-drive input[aria-label="Notes"]`)).length,
    'roles, regroup points and notes are not on the form');
  check(!(await page.$$(`${W} .plan-drive .sw[disabled], ${W} .plan-drive button.sw:has-text("Plan a route first")`)).length && await page.isVisible(`${W} .plan-drive button:has-text("Add a route")`),
    'no route planned: an Add a route link, not a switch that can\'t be switched (P-29)');
  check(!(await page.$$(`${W} select:not(.row-pick-native), ${W} input[type=checkbox], ${W} input[type=date], ${W} input[type=time]`)).length, 'the form shows none of the browser\'s own controls');
  check(/Tmrw|Today/.test(await page.textContent(`${W} .detents.scroll [aria-checked="true"]`)), 'tomorrow is the day by default');
  // Fair for the crew (route_ctx/crew_meet.js): the crew's shared squares, no names; the router is unreachable here, so a marked estimate
  await page.click(`${W} button:has-text("Fair for the crew")`);
  await page.waitForFunction((w) => /Fair to everyone sharing: the longest drive there is about \d+ min/.test(document.querySelector(w + ' .plan-drive').textContent), W, { timeout: 8000 });
  check(!posted.some(([p]) => /\/home$/.test(p)), 'nothing about your own home was sent');
  await page.fill(`${W} input[aria-label="Meet at"]`, 'Tellico');
  await page.click(`${W} .meet-hits button:has-text("Tellico Plains Shell")`);
  check(/Meeting point: Tellico Plains Shell/.test(await page.textContent(`${W} .plan-drive`)), 'the meeting point by search');
  const formH = await page.$eval(`${W} .plan-drive`, (f) => f.getBoundingClientRect().height);
  check(formH < 852, `the form fits one phone screen (${Math.round(formH)} px)`);
  await page.click(`${W} button:has-text("Plan it")`);
  await page.waitForFunction(() => /Drive planned/.test(document.getElementById('toast').textContent));
  const plan = posted.find(([p]) => p === '/api/crews/CREW1/events');
  check(plan && plan[1].title === 'Dragon run' && /Z$/.test(plan[1].starts_at) && plan[1].meet.name === 'Tellico Plains Shell' && Math.abs(plan[1].meet.lat - 35.3601) < 1e-6 && plan[1].route_id === null && plan[1].public === false, 'the plan was sent: ' + JSON.stringify(plan));
  check(plan[1].lead === undefined && plan[1].sweep === null && plan[1].regroup.length === 0, 'you lead; the rest is set on the card');
});

flow('the run as one card: the morning of, a crew-mate\'s convoy to join or yours to start; the convoy live on the card; afterwards who came and the best Score (Worker stubbed, REVIEW_PEOPLE.md P-03, P-11, P-18)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const at = new Date(Date.now() + 40 * 60000);   // 40 minutes from now, today (unless that crosses midnight)
  if (at.getDate() !== new Date().getDate() || new Date().getHours() < 4) { check(true, 'skipped: too close to midnight or before 4 AM'); return; }
  const cid = 'CCCCCCCCCCCCCCCCCCCCCC', until = Date.now() + 120 * 60000, sent = [];
  const ctx = { sessionId: cid, name: 'Ridge Runners · Dawn run', role: 'leader', you: 'k1', leaderKey: 'k1', expiresAtMs: until, seq: 0, leaderEpoch: 1,
    members: [{ key: 'k1', handle: 'me', role: 'leader', online: true }] };
  const drive = (over) => ({ id: 'e1AAAAAAAAAAAAAA', crew_id: 'k1', crew_name: 'Ridge Runners', title: 'Dawn run', starts_at: at.toISOString(), meet_name: 'Tellico Shell', meet_lat: 35.36, meet_lon: -84.29,
    route_id: null, notes: null, by_handle: 'sam', mine: false, can_cancel: false, my_rsvp: 'going', going: ['sam', 'me'], maybe: 0, lead: 'sam', sweep: null, regroup: [], ...over });
  let next = drive({}), last = null, invites = [{ id: 'IIIIIIIIIIIIIIIIIIIIII', name: 'Ridge Runners · Dawn run', from: 'sam', expiresAtMs: until }];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') sent.push([m, p]);
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (p === '/api/crews') return json([{ id: 'k1', name: 'Ridge Runners', role: 'member', visibility: 'private', members: 3 }]);
    if (p === '/api/crews/k1/page') return json({ id: 'k1', name: 'Ridge Runners', motto: null, visibility: 'private', area_name: null, members: 3, is_owner: false, crest: null, crest_photo_id: null,
      stripe: null, cover_photo_id: null, livery: { tier: 'plain', decals: 0 }, sharing_scores: true, board: [], next, last });
    if (p === '/api/crews/k1/members') return json([{ handle: 'sam', role: 'owner' }, { handle: 'me', role: 'member', mine: true }]);
    if (p === '/api/events') return json(next ? [next] : []);
    if (p === '/api/convoy/invites') return json(invites);
    if (p === '/api/convoy' && m === 'POST') return json({ invite: `${cid}.${'s'.repeat(32)}`, context: ctx }, 201);
    if (p === `/api/convoy/${cid}/invite-people`) return json({ invited: 1 });
    if (p === `/api/convoy/${cid}/ticket`) return json({ ticket: 't'.repeat(32), expiresAtMs: Date.now() + 60000 }, 201);
    if (p === `/api/convoy/${cid}`) return json(ctx);
    if (p === '/api/events/e0AAAAAAAAAAAAAA/record') return json({ id: 'e0AAAAAAAAAAAAAA', crew_id: 'k1', crew_name: 'Ridge Runners', title: 'Sunday dawn run', starts_at: last.starts_at, meet_name: 'Tellico Shell',
      came: ['sam', 'cara'], going: ['sam', 'cara', 'bob'], i_came: false, best: { handle: 'sam', score: 811, stage: 'Cherohala Skyway' },
      results: { stages: [{ id: 's1', name: 'Cherohala Skyway', rows: [{ handle: 'sam', score: 811, place: 1, time_s: 184, gap_s: 0 }, { handle: 'cara', score: 790, place: 2, time_s: 190, gap_s: 6 }] },
        { id: 's2', name: 'Tellico River Road', rows: [{ handle: 'cara', score: 802, place: 1, time_s: null, gap_s: null }] }],
        overall: [{ handle: 'cara', stages: 2, score: 796, full: true, place: 1 }, { handle: 'sam', stages: 1, score: 811, full: false, place: 2 }] } });
    if (m === 'POST' || m === 'DELETE') return route.fulfill({ status: 204 });
    return json([]);
  });
  const crewSide = async () => { await page.goto(base + '/index.html?view=crew'); await page.waitForSelector('.crew-page .cp-week .drive-card'); };
  // a crew-mate started the drive's convoy: the card says so and joins it; no Convoy section anywhere
  await crewSide();
  await page.waitForSelector('.cp-week .drive-card.is-morning button:has-text("Join the convoy")', { timeout: 8000 });
  const morning = await page.textContent('.cp-week .drive-card');
  check(/TODAY/.test(morning) && /@sam started the convoy/.test(morning) && /Directions to Tellico Shell/.test(morning) && !/Start the convoy/.test(morning), 'the morning of, with the convoy to join: ' + morning);
  // the planner's morning: Start the convoy on the card, and it becomes the convoy live
  next = drive({ mine: true, by_handle: 'me', lead: 'me' }); invites = [];
  await crewSide();
  await page.waitForSelector('.cp-week .drive-card.is-morning button:has-text("Start the convoy")');
  await page.click('.cp-week .drive-card button:has-text("Start the convoy")');
  await page.waitForSelector('.cp-week .drive-card.is-convoy .cv-panel', { timeout: 8000 });
  const live = await page.textContent('.cp-week .drive-card');
  check(/LIVE/.test(live) && /you are leading/.test(live) && /left/.test(live) && /Show QR/.test(live) && /End convoy/.test(live), 'the convoy live on the card: ' + live);
  check(sent.some(([m, p]) => m === 'POST' && p === `/api/convoy/${cid}/invite-people`) && sent.some(([m, p]) => m === 'POST' && p === '/api/events/e1AAAAAAAAAAAAAA/came'), 'everyone going invited; you came: ' + JSON.stringify(sent));
  await page.evaluate(() => document.querySelector('.tab[data-view="map"]').click());
  check(/Ridge Runners · Dawn run/.test(await page.textContent('.convoy-bar.show .cv-line')), 'the map: one line for the convoy');
  // the day after: the drive remembered, who came and the best Score
  await page.evaluate(() => { try { localStorage.removeItem('apex.convoy'); } catch (_) {} });
  next = null; last = { id: 'e0AAAAAAAAAAAAAA', title: 'Sunday dawn run', starts_at: new Date(Date.now() - 26 * 3600e3).toISOString(), meet_name: 'Tellico Shell' };
  await page.route('**/api/convoy/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await crewSide();
  await page.waitForSelector('.cp-week .drive-card.is-remembered .cp-best');
  const rec = await page.textContent('.cp-week');
  check(/Upcoming drives/.test(rec) && /DRIVEN/.test(rec) && /2 came: @sam, @cara/.test(rec) && /811/.test(rec) && /Best Vetta Score · @sam on Cherohala Skyway/.test(rec) && /Nothing planned next/.test(rec) && await page.isVisible('.cp-week .plan-plus'), 'remembered, above the + to plan the next one: ' + rec);
  // the results sheet (IDEAS S-25): folded under the best Score; the overall, then each stage as SS1, SS2; Share
  check(/Results · 2 stages/.test(rec) && !(await page.isVisible('.cp-week .cp-results')), 'the results fold, closed: ' + rec);
  await page.click('.cp-week .cp-results-fold > summary');
  const sheet = await page.$$eval('.cp-week .cp-results > *', (els) => els.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check(sheet[0] === 'OVERALL' && /^1\. @cara 796 all 2 stages 2\. @sam 811 1 of 2 stages$/.test(sheet[1]) && sheet[2] === 'SS1 · CHEROHALA SKYWAY' && /^1\. @sam 811 3:04 · quickest 2\. @cara 790 3:10 · \+6 s$/.test(sheet[3]) && sheet[4] === 'SS2 · TELLICO RIVER ROAD' && /share times/.test(sheet[6]), 'the sheet: ' + JSON.stringify(sheet));
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); });
  await page.click('.cp-week button:has-text("Share the results")');
  await page.waitForFunction(() => window.__copied);
  const copied = await page.evaluate(() => window.__copied);
  check(/^Sunday dawn run · Ridge Runners — results \(Vetta Score\)\n\nOverall\n1\. @cara 796 \(all 2 stages\)\n2\. @sam 811 \(1 of 2 stages\)\n\nSS1 Cherohala Skyway\n1\. @sam 811 · 3:04\n2\. @cara 790 · 3:10 \(\+6 s\)\n\nSS2 Tellico River Road\n1\. @cara 802\n/.test(copied), 'Share copies the sheet as text: ' + JSON.stringify(copied));
  await page.click('.cp-week button:has-text("I was there")');
  await page.waitForTimeout(300);
  check(sent.some(([m, p]) => m === 'POST' && p === '/api/events/e0AAAAAAAAAAAAAA/came'), 'I was there is sent');
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
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());   // signs the page in (renderAccount)
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
    return JSON.stringify([{ id: 'seg_f', origin: 'CANON1', synced: true, name: 'Straight run', lat0: lat[a], lon0: lon[a], lat1: lat[b], lon1: lon[b], length_m: (b - a) * 5,
      geom: JSON.stringify(Array.from({ length: 20 }, (_, k) => { const i = a + Math.round(k * (b - a) / 19); return [lat[i], lon[i]]; })) }]);
  }).then((segs) => page.addInitScript((v) => localStorage.setItem('apex.segments', v), segs));   // before the page loads: the first visit's own write can't undo it
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

// A recorded drive as its CSV, for Your driving: 36 corners, with a fault planted in the right-handers
const PROFILE_CSV = `(fault, seed) => {
  // a road of 36 corners 300 m apart, alternating left and right, radius 35 / 60 / 110 m: brake once, slowest at the middle, drive out.
  // fault 'saw': two steering corrections in every right-hander; 'coast': 50 m of coasting after the slowest point in rights
  const G = 9.80665, rows = [], R = [35, 60, 110], VC = [10.5, 13.5, 17.5];
  let lat = 38.72 + seed * 0.02, lon = -84.6, hd = 0.3, dist = 0;
  const pts = [];
  for (let c = 0; c < 36; c++) {
    const left = c % 2 === 0, r = R[c % 3], vc = VC[c % 3], arc = Math.round((Math.PI / 2) * r / 5);
    for (let i = 0; i < 60; i++) pts.push({ k: 0, c: -1 });
    for (let i = 0; i < arc; i++) pts.push({ k: (left ? 1 : -1) / r, c, i, arc, vc, right: !left });
  }
  for (let i = 0; i < 40; i++) pts.push({ k: 0, c: -1 });
  const n = pts.length, v = new Array(n).fill(21);
  for (let i = 0; i < n; i++) if (pts[i].c >= 0 && pts[i].i === 0) {
    const p = pts[i], mid = i + Math.floor(p.arc / 2), hold = fault === 'coast' && p.right ? 10 : 0;
    for (let q = 0; q <= 12; q++) v[mid - 2 - 12 + q] = 21 + (p.vc - 21) * q / 12;
    for (let q = mid - 2; q <= mid + hold; q++) v[q] = p.vc;
    for (let q = 0; q < 14; q++) v[mid + hold + q] = Math.min(21, p.vc + (21 - p.vc) * q / 13);
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    hd += p.k * 5; dist = i * 5;
    lat += 5 * Math.cos(hd) / 110540; lon += 5 * Math.sin(-hd) / (111320 * Math.cos(lat * Math.PI / 180));
    let latG = v[i] * v[i] * p.k / G;
    if (p.c >= 0) {
      const edge = Math.min(1, (p.i + 1) / 4, (p.arc - p.i) / 4); latG *= edge;
      if (fault === 'saw' && p.right && (p.i === 5 || p.i === 6 || p.i === 9 || p.i === 10)) latG *= 0.5;
    }
    const lonG = i + 1 < n ? (v[i + 1] - v[i]) * v[i] / 5 / G : 0;
    rows.push([i, dist, lat.toFixed(7), lon.toFixed(7), 250, (v[i] * 2.2369362921).toFixed(3), lonG.toFixed(4), latG.toFixed(4)].join(','));
  }
  return 'segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g\\n' + rows.join('\\n') + '\\n';
}`;

flow('Your driving: the profile over every drive opens from the Log, names the weak side, and is kept between visits (driver_profile.js)', async (page, base) => {
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  check(await page.evaluate(() => document.getElementById('drivingCard').hidden), 'no drives: no card');
  await page.evaluate(async (src) => {
    const gen = eval(src); let k = 0;
    for (const [id, name, date, fault] of [['p1', 'Dry Ridge Rd', '2026-08-12T09:00', 'saw'], ['p2', 'Dry Ridge Rd', '2026-09-14T09:00', 'saw'], ['p3', 'Pebble Ridge', '2026-10-03T09:00', 'saw']])
      await ApexRecording.store(ApexRecording.parse(ApexCore, gen(fault, k++), id + '.csv', { id, name, date, source: 'web-gps' }));
  }, PROFILE_CSV);
  await page.goto(base + '/analysis.html');
  await page.waitForSelector('#drivingOpen', { timeout: 20000 });
  const card = await page.textContent('#drivingOpen span');
  check(/Work on: One steering arc \d+/.test(card) && /Strongest: /.test(card), 'the card says the strongest and the one to work on: ' + card);
  await page.click('#drivingOpen');
  await page.waitForSelector('#drivingRoot .dp-st');
  const text = await page.evaluate(() => document.getElementById('drivingRoot').innerText);
  check(/From 108 clean corners on 3 drives/.test(text), 'what it is read from: ' + text.slice(0, 120));
  check(/One steering arc is weaker through rights: \d+ against 100 through lefts, on 3 of 3 drives\./.test(text), 'the weak side is named: ' + text);
  check(/Work on: One steering arc\s+It shows most through rights\./.test(text), 'the focus says where');
  check(await page.evaluate(() => document.querySelector('.dp-st.weak').dataset.skill === 'arc' && document.querySelectorAll('.dp-st').length === 6), 'six stations, the weak one marked');
  check(!/mph|km\/h|\d s\b/.test(text), 'never a speed or a time');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing wider than the phone');
  // each drive's observations were kept: a second visit reads no drive again, and a deleted drive's are dropped
  const again = await page.evaluate(() => ApexAnalysis.job('profile'));
  check(again.read === 0 && again.profile.corners === 108, 'kept between visits: read ' + again.read);
  const after = await page.evaluate(async () => { await ApexRecording.remove('p3'); return ApexAnalysis.job('profile'); });
  check(after.profile.drives === 2 && after.profile.corners === 72, 'a deleted drive is gone from it');
  const kept = await page.evaluate(() => new Promise((ok) => { const q = indexedDB.open('vetta-profile'); q.onsuccess = () => { const g = q.result.transaction('obs').objectStore('obs').getAllKeys(); g.onsuccess = () => ok(g.result); }; }));
  check(kept.join() === 'p1,p2', 'its kept observations too: ' + kept);
  // straight to the page by its address, and back to the Log
  await page.goto(base + '/analysis.html?tab=driving');
  await page.waitForSelector('#drivingRoot .dp-st');
  await page.click('#tab-driving a.back');
  check(await page.evaluate(() => !document.getElementById('tab-history').hidden && document.getElementById('tab-driving').hidden), 'back to the Log');
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
  await openSetting(page, 'feedback');
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
  // U-83: the notes run over the map column only; the instruments' column runs the full height beside them
  check(Math.abs(notes.x - stage.x) < 2 && notes.w <= stage.w + 1 && notes.y < 5 && bin.y < 5, 'the notes over the map column, the instruments full height: ' + JSON.stringify({ notes, bin }));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 844), 'no sideways scroll');
  await page.click('#modePlate');                                   // a replay is full-screen: its plate is the way back to the tabs (U-45)
  await page.click('.tab[data-view="garage"]');
  await page.waitForTimeout(400);
  const rail = await box('#binnacle');
  check(rail.w < 100, 'a sheet leaves a narrow tab rail: ' + JSON.stringify(rail));
  // U-83: in a drive Rec, Report and End sit beside the strip, over the instruments; the map has the rest of its column
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apex && window.apexDebug);
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.apex.live({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 12, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 40)); } });
  await page.waitForTimeout(300);
  const dn = await box('#notes'), db = await box('#driveBar'), ds = await box('.stage');
  check(db.h > 0 && db.x >= ds.x + ds.w - 1 && db.y < dn.y + dn.h && dn.x + dn.w <= ds.x + ds.w + 1 && ds.y + ds.h >= 389, 'driving on its side: ' + JSON.stringify({ dn, db, ds }));
}, { viewport: { width: 844, height: 390 } });

flow('friend profile: a friend on People → Profile shows what the friend shares, as text, what to do with them first and Unfriend at the foot; Back returns (Worker stubbed, IDEAS S-15, REVIEW_PEOPLE P-04, P-24)', async (page, base) => {
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
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());
  await page.click('#accountBody .friend-head:has-text("@bob")');   // the friend's row opens what you can do with them and their profile
  await page.click('#accountBody .friend button:has-text("Profile")');
  await page.waitForSelector('.profile-view');
  const t = await page.textContent('.profile-view');
  check(t.includes('@bob') && /Bob <b>S<\/b> · friends since September( 2026)?/.test(t) && t.includes('Esses · best 812 · 3 days this month') && t.includes('Ridge Runners'), 'the profile, as text: ' + t);
  const pk = await page.evaluate(() => ({ keys: [...document.querySelectorAll('.profile-view .profile-keys button')].map((b) => b.textContent), foot: [...document.querySelectorAll('.profile-view .profile-foot button')].map((b) => b.textContent),
    last: document.querySelector('.profile-view > :last-child').className }));
  check(JSON.stringify(pk.keys) === '["Share a route","Invite to a drive"]' && JSON.stringify(pk.foot) === '["Unfriend","Report","Block"]' && /profile-foot/.test(pk.last), 'things to do first, Unfriend/Report/Block at the foot: ' + JSON.stringify(pk));
  await page.click('.profile-view button:has-text("Friends")');   // one back glyph and where it goes (REVIEW2.md)
  await page.waitForSelector('.side-pop.open .profile-view', { state: 'detached', timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !document.querySelector('.side-pop.open') && !!document.querySelector('#accountBody .friend-head[aria-expanded="true"]')), 'Back returns to the friends list, the row still open');
});

flow('Billet: a primary key is light metal with dark ink, not dark on dark (REVIEW_PEOPLE.md P-01)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route(base + '/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(route.request().url().includes('/api/me') ? { signed_in: false } : []) }));
  await page.goto(base + '/index.html?view=people&theme=billet');
  await page.waitForSelector('#accountBody a.ink-btn.solid');
  const s = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#accountBody a.ink-btn.solid')); return { bg: c.backgroundImage, ink: c.color }; });
  check(/rgb\(242, 242, 244\)/.test(s.bg) && s.ink === 'rgb(13, 13, 14)', 'Sign in with Google under Billet: ' + JSON.stringify(s));
});

flow('People: two tabs; a request is a card on top, then you, then friends with where they are; a friend row is about the friend; one Invite key; links open their side (the owner, 2026-10-30; REVIEW_PEOPLE steps 5, 6)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const posted = [];
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET' && u.pathname !== '/api/crews/invite/preview') { posted.push([m, u.pathname, route.request().postData()]); return route.fulfill({ status: 204 }); }
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me', requests: 1 });
    if (u.pathname === '/api/friends') return json([{ id: 'U1', handle: 'bob', name: 'Bob', status: 'accepted', incoming: 0 }, { id: 'U2', handle: 'cara', name: null, status: 'accepted', incoming: 0 },
      { id: 'U3', handle: 'eve', name: 'Eve K', status: 'accepted', incoming: 0 }, { id: 'U4', handle: 'dan', name: null, status: 'pending', incoming: 1 }]);
    if (u.pathname === '/api/grants') return json([{ audience_type: 'friend', audience_id: 'U2', share_scores: 1, share_times: 0 }]);
    if (u.pathname === '/api/presence') return json([{ handle: 'cara', photo_id: null, delay_s: 0, fuzz: false, road: 'Cherohala Skyway', lat: 35.3, lon: -84.1, at: iso(now - 30e3) },
      { handle: 'bob', photo_id: null, delay_s: 600, fuzz: true, road: null, lat: 35.3, lon: -84.1, at: iso(now - 15 * 60e3) }]);
    if (u.pathname === '/api/presence/settings') return json({ audience: 'friends', delay_s: 600, fuzz: true });
    if (u.pathname === '/api/routes/shared') return json([{ id: 'RRRRRRRRRRRRRRRR', name: 'Cherohala loop', created_at: '2026-10-28 05:00:00', from_handle: 'cara' }]);
    if (u.pathname === '/api/convoy/invites') return json([{ id: 'CV1', name: 'Sunday run', from: 'sam', expiresAtMs: now + 3600e3 }]);
    if (u.pathname === '/api/crews/invite/preview') return json({ name: 'Ridge Runners', visibility: 'private', members: 4, owner: 'sam', member: false });
    if (u.pathname === '/api/points') return json({ total: 0, board: [{ handle: 'sam', total: 310 }], pioneer: { firsts: 3, seconds: 0 } });
    return json([]);
  });
  await page.goto(base + '/index.html?view=people');
  await page.waitForSelector('#accountBody .friend-head:not(.you-row)');
  // the header is two underlined tabs (the pushback, accepted), not the slide switch
  const side = () => page.evaluate(() => ({ friends: document.querySelector('[data-people="friends"]').getAttribute('aria-selected'), crews: document.querySelector('[data-people="crews"]').getAttribute('aria-selected'),
    fb: !document.getElementById('accountBody').hidden, cb: !document.getElementById('crewsBody').hidden }));
  check(JSON.stringify(await side()) === '{"friends":"true","crews":"false","fb":true,"cb":false}', 'People opens on Friends: ' + JSON.stringify(await side()));
  check(await page.evaluate(() => { const t = document.querySelector('.people-tabs'); return t.getAttribute('role') === 'tablist' && t.querySelectorAll('[role="tab"]').length === 2 && !document.querySelector('#sheetHead .switch')
    && getComputedStyle(document.querySelector('[data-people="friends"]'), '::after').transform === 'none'; }), 'Friends | Crews are ARIA tabs, the open one underlined');
  check(await page.evaluate(() => document.querySelector('#crewTab').getAttribute('aria-label') === 'People' && document.querySelector('#crewTab span').textContent === 'People'), 'the tab is People');
  // P-34: the badge counts the friend request and the convoy invite
  check(await page.evaluate(() => { const b = document.querySelector('#crewTab .badge'); return b && b.textContent === '2' && /1 friend request, 1 convoy invite/.test(b.getAttribute('aria-label')); }), 'the badge counts what waits: ' + await page.evaluate(() => document.querySelector('#crewTab .badge')?.getAttribute('aria-label')));
  // P-05: the request is a card on top; P-23: you next; then the friends, live first, a friend who shares nothing under their name (P-15)
  const order = await page.$$eval('#accountBody > *', (k) => k.map((x) => x.className));
  check(/request-card/.test(order[0]) && /you-row/.test(order[1]) && /friend-list/.test(order[2]), 'request card, You, friends: ' + JSON.stringify(order));
  check(/@dan wants to be your friend/.test(await page.textContent('#accountBody .request-card')), 'the request card names who asks');
  await page.waitForFunction(() => /You · @me/.test(document.querySelector('.you-row').textContent) && /Friends see where you are/.test(document.querySelector('.you-row small').textContent));
  const rows = await page.$$eval('#accountBody .friend-list .friend-head', (r) => r.map((x) => [x.querySelector('.friend-who b').textContent, x.querySelector('.friend-who small').textContent, x.querySelector('.friend-who small').classList.contains('live')]));
  check(JSON.stringify(rows) === JSON.stringify([['@cara', 'On the road · Cherohala Skyway', true], ['@bob', 'Seen 15 min ago', false], ['@eve', 'Eve K', false]]), 'friends and where they are: ' + JSON.stringify(rows));
  const body = await page.textContent('#accountBody');
  check(!/Not sharing|Points board|Spots near you|Friends on the map|Requests/.test(body), 'no misfiled rows, no refusal said of a friend: ' + body.slice(0, 300));
  const keys = await page.$$eval('#accountBody > .row button', (b) => b.map((x) => x.textContent));
  check(JSON.stringify(keys) === '["Invite or add a friend"]', 'one Invite key on Friends: ' + JSON.stringify(keys));
  const navs = await page.$$eval('#accountBody > .nav-rows .nav-row > span', (s) => s.map((x) => x.textContent));
  check(JSON.stringify(navs) === '["From friends"]', 'then what friends shared, and nothing else: ' + JSON.stringify(navs));
  // P-04: the friend row is about the friend; the grants are one quiet row
  await page.click('#accountBody .friend-head:has-text("@cara")');
  const acts = await page.$$eval('#accountBody .friend:has-text("@cara") .friend-keys button', (b) => b.map((x) => x.textContent));
  check(JSON.stringify(acts) === '["On the map","Share a route","Invite to a drive","Profile"]', 'the row opens on what you can do with her: ' + JSON.stringify(acts));
  const cara = await page.textContent('#accountBody .friend:has-text("@cara") .crew-detail');
  check(/Shared Cherohala loop · /.test(cara) && /What @cara sees of you/.test(cara) && !/Unfriend|Block/.test(cara) && !(await page.isVisible('#accountBody .friend:has-text("@cara") .friend-grants')), 'her last share, a quiet grants row, no Unfriend: ' + cara);
  check(!!(await page.$('#accountBody .friend:has-text("@bob") .friend-keys button:has-text("On the map")')), 'bob shares a delayed position: On the map too');
  check(!(await page.$('#accountBody .friend:has-text("@eve") .friend-keys button:text-is("On the map")')), 'no On the map for a friend who shares nothing');
  await page.click('#accountBody .friend:has-text("@cara") .nav-row.quiet');
  check(await page.isVisible('#accountBody .friend:has-text("@cara") .friend-grants [role="switch"][aria-checked="true"]'), 'the quiet row opens her Scores and Times');
  // P-09: Who sees what, from her row, her line marked
  await page.click('#accountBody .friend:has-text("@cara") button:has-text("Who sees what")');
  await page.waitForSelector('.overlay[aria-label="Who sees what"] .who-grid');
  const grid = await page.$$eval('.who-grid > .who-n', (n) => n.map((x) => x.textContent + (x.classList.contains('focus') ? '*' : '')));
  check(JSON.stringify(grid) === '["@bob","@cara*","@eve"]', 'one grid, her row marked: ' + JSON.stringify(grid));
  check(await page.evaluate(() => [...document.querySelectorAll('.who-grid .who-c')].slice(4, 8).map((c) => c.textContent).join('|')) === '10 min|✓|–|–', 'her cells: where (10 min), scores on, times off, no car shown');
  await page.click('.who-grid button[aria-label="@cara sees your times"]');
  await page.waitForFunction(() => document.querySelector('.who-grid button[aria-label="@cara sees your times"]').getAttribute('aria-checked') === 'true');
  check(posted.some(([m, p, b]) => m === 'PUT' && p === '/api/grants' && /"audience_id":"U2"/.test(b) && /"share_times":true/.test(b)), 'Times changed in its cell');
  check(await page.isVisible('.overlay[aria-label="Who sees what"] [aria-label="Show me on the map to"] [aria-checked="true"]:text-is("Friends")'), 'where you are, one choice at the top');
  await page.click('.overlay[aria-label="Who sees what"] button:has-text("Done")');
  // Accept on the card
  await page.click('#accountBody .request-card button:has-text("Accept")');
  await page.waitForTimeout(200);
  check(posted.some(([m, p, b]) => p === '/api/friends/accept' && /U4/.test(b)), 'Accept on the card answers the request');
  // the Invite sheet is only for inviting and adding (P-05)
  await page.click('#accountBody button:has-text("Invite or add a friend")');
  await page.waitForSelector('.side-pop.open[aria-label="Invite"]');
  const inv = await page.textContent('.side-pop.open[aria-label="Invite"]');
  check(/invite link/i.test(inv) && /Share a link to me/.test(inv) && !/invite-only/i.test(inv) && !/@dan|Accept/.test(inv) && await page.isVisible('.side-pop.open input[aria-label="Friend handle"]'), 'the Invite sheet: an invite link and add by handle, no requests: ' + inv);
  await page.click('.side-pop.open button:has-text("Done")');
  // On the map: the sheet closes, the Friends layer comes on
  await page.click('#accountBody .friend:has-text("@cara") .friend-keys button:has-text("On the map")');
  await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
  check(await page.evaluate(() => document.querySelector('[data-toggle="friends"]').classList.contains('on')), 'On the map turns the Friends layer on');
  // the Garage: Who sees what under You; the pioneer count with Road feel; no points board anywhere
  await page.evaluate(() => document.querySelector('.tab[data-view="garage"]').click());
  await page.waitForSelector('#garageMeBody .nav-row:has-text("Who sees what")');
  check(/Roads you mapped first: 3/.test(await page.textContent('#garageRoadFeelBody')), 'roads you mapped first, in the Garage (Settings → Road feel)');
  // Crews: the crew things, none of the friend things; with no crew, one row
  await page.evaluate(() => document.querySelector('.tab[data-view="people"]').click());
  await page.click('[data-people="crews"]');
  check(JSON.stringify(await side()) === '{"friends":"false","crews":"true","fb":false,"cb":true}', 'the tabs flip to Crews');
  const crews = await page.textContent('#crewsBody');
  check(/Find or start a crew/.test(crews) && !/Crew drives|Crews this month|Your crews|Convoy/.test(crews) && !/Invite or add a friend|From friends/.test(crews), 'Crews with no crew: one row: ' + crews.slice(0, 200));
  await page.focus('[data-people="crews"]'); await page.keyboard.press('ArrowLeft');
  check((await side()).friends === 'true' && await page.evaluate(() => document.activeElement.dataset.people === 'friends'), 'arrow keys move between the tabs');
  // links open their side: ?add= the Invite sheet on Friends with the handle filled in; ?crew= the invite on Crews
  await page.goto(base + '/index.html?add=Zed');
  await page.waitForSelector('.side-pop.open[aria-label="Invite"]');
  check(await page.inputValue('.side-pop.open input[aria-label="Friend handle"]') === 'zed' && (await side()).friends === 'true', '?add= opens Friends, the Invite sheet, the handle in');
  await page.goto(base + '/index.html?crew=TOKEN123');
  await page.waitForSelector('#crewsBody >> text=Join Ridge Runners?');
  check((await side()).crews === 'true' && /run by @sam/.test(await page.textContent('#crewsBody')), '?crew= opens Crews with the invite named');
  check(await page.evaluate(() => document.querySelector('#crewTab .badge')?.textContent) === '3', 'a crew link waiting is on the badge too');
});

flow('People, a new account: Friends is one sentence and the Invite key; Crews is one "Find or start a crew" row (REVIEW_PEOPLE P-08)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/crews/discover') return json([{ id: 'K9', name: 'Tail of the Dragon Regulars', members: 118, area_name: 'Deals Gap', km: 54 }]);
    if (u.pathname === '/api/points') return json({ total: 0 });
    return json([]);
  });
  await page.goto(base + '/index.html?view=people');
  await page.waitForSelector('#accountBody .people-lead');
  const kids = await page.$$eval('#accountBody > *', (k) => k.map((x) => x.className + ':' + x.textContent.trim()));
  check(kids.length === 3 && /people-lead/.test(kids[0]) && /Invite or add a friend/.test(kids[1]) && /^people-sample:Example: /.test(kids[2]), 'one sentence, the Invite key and an example (U-121): ' + JSON.stringify(kids));
  await page.click('[data-people="crews"]');
  await page.waitForSelector('#crewsBody .nav-row:has-text("Find or start a crew")');
  const rows = await page.$$eval('#crewsBody .nav-row > span', (s) => s.map((x) => x.textContent));
  check(JSON.stringify(rows) === '["Find or start a crew"]' && !/Crew drives|Your crews|Crews this month/.test(await page.textContent('#crewsBody')), 'Crews: one row: ' + JSON.stringify(rows));
  await page.click('#crewsBody .nav-row:has-text("Find or start a crew")');
  await page.waitForSelector('.side-pop.open >> text=Tail of the Dragon Regulars');
  const tile = await page.evaluate(() => { const b = [...document.querySelectorAll('.side-pop.open .crew-tiles.one .crew-tile-head b')].find((x) => /Dragon/.test(x.textContent)); return { whole: b.scrollWidth <= b.clientWidth + 1, line: b.nextElementSibling.textContent }; });
  check(tile.whole && /118 members · Deals Gap · 34 mi/.test(tile.line), 'one crew a row, the name whole, the area and the distance under it (P-26): ' + JSON.stringify(tile));
  check(await page.isVisible('.side-pop.open input[aria-label="Crew name"]'), 'and Start a crew in the same sheet');
});
flow('one link in: no "invite-only" anywhere; a crew link joins a newcomer with a handle in one card; a friend link asks first; any member invites; the owner picks who can (Worker stubbed, REVIEW_PEOPLE.md P-02, P-07, P-20, P-22, P-32)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const sent = [];
  let me = { signed_in: false }, crews = [], crewPage = null;
  await page.route(base + '/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') sent.push({ m, p, b: route.request().postData() });
    if (p === '/api/me') return json(me);
    if (p === '/api/me/handle') { me = { ...me, handle: JSON.parse(route.request().postData()).handle }; return route.fulfill({ status: 204 }); }
    if (p === '/api/crews/invite/preview') return json({ id: 'k9', name: 'Blue Ridge Breakfast Club', visibility: 'private', members: 6, owner: 'sam', from: 'tilly', member: false });
    if (p === '/api/crews/join') return json({ id: 'k9', friend: 'tilly' });
    if (p === '/api/invites/preview') return json({ from: 'sam' });
    if (p === '/api/invites/redeem') return route.fulfill({ status: 204 });
    if (p === '/api/crews') return json(crews);
    if (p === '/api/crews/k1/page') return json(crewPage);
    if (p === '/api/crews/k1/invite') return json({ token: 'CREWLINK1234' }, 201);
    if (p === '/api/crews/k1/invites' && m === 'PUT') return json({ by: JSON.parse(route.request().postData()).by });
    if (p === '/api/points') return json({ total: 0 });
    return json([]);
  });
  const words = async () => page.evaluate(() => document.getElementById('accountBody').textContent + ' ' + document.getElementById('crewsBody').textContent);
  // signed out, with a crew link: both sides say what signing in gets you, and never that the club is closed
  await page.goto(base + '/index.html?crew=CREWTOKEN123');
  await page.waitForSelector('#crewsBody >> text=You have a crew link');
  const out = await words();
  check(!/invite-only|own invite|join vetta|with an invite/i.test(out), 'signed out: no "invite-only" and no "join Vetta first": ' + out.slice(0, 300));
  check(/Who’s out driving/.test(out) && /Crew drives/.test(out) && !/The board/.test(out), 'signed out, Friends promises who is out driving, not the board (P-32)');
  // signed in for the first time, no handle yet: the crew link is a card on Crews with the crew named, a handle field and Join
  me = { signed_in: true, id: 'U9', member: true, handle: null, requests: 0 };
  await page.goto(base + '/index.html?view=people');
  await page.click('[data-people="crews"]');
  await page.waitForSelector('#crewsBody >> text=Join Blue Ridge Breakfast Club?');
  const card = await page.textContent('#crewsBody .card');
  check(/@tilly sent you the link, and you’ll be friends/.test(card) && !/first/i.test(card), 'the newcomer sees the crew and who sent it, nothing to do first: ' + card);
  await page.fill('#crewsBody .card input[aria-label="Handle"]', 'newbie');
  crews = [];
  await page.click('#crewsBody .card button:has-text("Join crew")');
  for (let i = 0; i < 50 && !sent.some((x) => x.p === '/api/crews/join'); i++) await page.waitForTimeout(100);
  const order = sent.map((x) => x.p).filter((x) => x === '/api/me/handle' || x === '/api/crews/join');
  check(JSON.stringify(order) === '["/api/me/handle","/api/crews/join"]', 'the handle is saved, then the crew joined, in one tap: ' + JSON.stringify(order));
  check(JSON.parse(sent.find((x) => x.p === '/api/crews/join').b).token === 'CREWTOKEN123', 'joined with the link\'s token');
  await page.waitForFunction(() => /friends with @tilly/.test(document.getElementById('toast').textContent));
  // a member opening a friend link: a card at the top of Friends naming the sender; Accept redeems it
  me = { signed_in: true, id: 'U9', member: true, handle: 'newbie', requests: 0 };
  await page.goto(base + '/index.html?invite=FRIENDTOKEN12');
  await page.waitForSelector('#accountBody >> text=sent you a link to be friends');
  check(/@sam/.test(await page.textContent('#accountBody .card')), 'the friend link names its sender');
  await page.click('#accountBody .card button:has-text("Accept")');
  for (let i = 0; i < 50 && !sent.some((x) => x.p === '/api/invites/redeem'); i++) await page.waitForTimeout(100);
  check(JSON.parse(sent.find((x) => x.p === '/api/invites/redeem').b).token === 'FRIENDTOKEN12', 'Accept redeems the friend link');
  // a member (not the owner) of a crew: the page has Invite, and it makes a link
  crews = [{ id: 'k1', name: 'Ridge Runners', role: 'member', visibility: 'private', members: 3, invites: 'anyone' }];
  crewPage = { id: 'k1', name: 'Ridge Runners', motto: null, visibility: 'private', area_name: null, members: 3, is_owner: false, invites: 'anyone', can_invite: true,
    crest: null, crest_photo_id: null, stripe: null, cover_photo_id: null, livery: 'plain', sharing_scores: false, board: [], next: null };
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-page .cp-title h2');
  check(await page.isVisible('.cp-title button:has-text("Invite")'), 'a member\'s crew page has Invite (P-07)');
  await page.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); navigator.clipboard.writeText = async () => {}; } catch (_) {} });
  await page.click('.cp-title button:has-text("Invite")');
  for (let i = 0; i < 50 && !sent.some((x) => x.p === '/api/crews/k1/invite'); i++) await page.waitForTimeout(100);
  check(sent.some((x) => x.p === '/api/crews/k1/invite'), 'Invite asks the Worker for a crew link');
  // the owner keeps invites to themselves: the page's Invite goes for a member; the gear has the switch, and it reaches the Worker
  crewPage = { ...crewPage, invites: 'owner', can_invite: false };
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-page .cp-title h2');
  check(!(await page.isVisible('.cp-title button:has-text("Invite")')), 'Who can invite: Owner, and a member has no Invite key');
  crews = [{ ...crews[0], role: 'owner', invites: 'anyone' }];
  crewPage = { ...crewPage, is_owner: true, invites: 'anyone', can_invite: true };
  await page.goto(base + '/index.html?view=crew');
  await page.waitForSelector('.crew-page .cp-title h2');
  await page.click('#crewsBody .gear-key');
  await page.waitForSelector('.side-pop.open [role="radiogroup"][aria-label="Who can invite to Ridge Runners"]');
  check(!(await page.isVisible('.side-pop.open button:has-text("Invite to crew")')), 'the gear has no second Invite key');
  await page.click('.side-pop.open [role="radiogroup"][aria-label="Who can invite to Ridge Runners"] button:has-text("Owner")');
  for (let i = 0; i < 50 && !sent.some((x) => x.p === '/api/crews/k1/invites' && x.m === 'PUT'); i++) await page.waitForTimeout(100);
  const put = sent.find((x) => x.p === '/api/crews/k1/invites' && x.m === 'PUT');
  check(put && JSON.parse(put.b).by === 'owner', 'Who can invite · Owner reaches the Worker: ' + (put && put.b));
  await page.waitForSelector('.side-pop.open [role="radiogroup"] button[aria-checked="true"]:has-text("Owner")', { timeout: 5000 }).catch(() => {});   // the answer lands after the request
  check(await page.getAttribute('.side-pop.open [role="radiogroup"] button:has-text("Owner")', 'aria-checked') === 'true', 'and the switch shows Owner');
  // the one signed-in person who isn't a member (an account the owner removed): one line, no paste field, the account in the Garage
  me = { signed_in: true, id: 'U9', member: false, handle: 'newbie', requests: 0 };
  await page.goto(base + '/index.html?view=people');
  await page.waitForSelector('#accountBody >> text=Friends and crews are closed to this account');
  check(!(await page.$('#accountBody input')) && !/invite/i.test(await words()), 'no paste field, no invite talk (P-22): ' + (await words()).slice(0, 200));
  check(await page.evaluate(() => /Delete account/.test(document.getElementById('garageAccountBody') ? document.getElementById('garageAccountBody').textContent : '')), 'the account keys are in the Garage (Settings → Account)');
});

flow('units: kilometres in Settings redraw the dial, the notes and the replay in metric (IDEAS U-22)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?drive=dry_ridge');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track, null, { timeout: 15000 });
  check(await page.evaluate(() => ApexUnits.system()) === 'imperial', 'miles by default in en-US');
  await page.click('#modePlate');                                   // out of the full-screen replay to the tabs (U-45)
  await page.click('.tab[data-view="garage"]');
  await page.evaluate(() => { window.__samePage = true; });
  await openSetting(page, 'units');
  await page.click('[data-units="metric"]');                       // redrawn in place, no reload (the owner, 2026-10-29)
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__samePage === true), 'the page was not reloaded');
  check(await page.evaluate(() => localStorage.getItem('apex.units')) === 'metric', 'saved');
  check(await page.getAttribute('[data-units="metric"]', 'aria-checked') === 'true', 'the switch shows metric');
  check((await page.$$eval('#loopDetents [data-loop-mi]', (b) => b.map((x) => x.textContent))).join() === '25 km,50 km,75 km,100 km,150 km', 'the loop lengths in km, the whole dial in one unit');
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
  await log.locator('nav.tabbar a:has-text("People")').click();
  await page.waitForFunction(() => document.querySelector('#sheet.open[data-view="people"]'));
  check(await page.evaluate(() => window.__samePage === true), 'People from the Log: still no reload');
  // a switch: off is hollow with a dim border, on is filled with ink (two cues besides the thumb's position)
  const sw = await page.evaluate(() => {
    const b = document.querySelector('.sw[data-toggle]'); if (!b) return null;
    const i = b.querySelector('i'), read = () => { const c = getComputedStyle(i); return { bg: c.backgroundColor, border: c.borderTopColor, mark: getComputedStyle(i, '::before').width }; };
    const was = b.classList.contains('on'); b.classList.remove('on'); const off = read(); b.classList.add('on'); const on = read(); b.classList.toggle('on', was);
    return { off, on };
  });
  check(sw && sw.off.bg !== sw.on.bg && sw.off.border !== sw.on.border && sw.off.mark !== sw.on.mark, 'on and off differ in fill, border and mark: ' + JSON.stringify(sw));
});

// REVIEW_FEEL F-04, F-06, F-08, F-09, F-10, F-15: nothing heavy while the driver looks, and a Log that scales.
// A drive record as the app stores it, n samples north along a gently winding road (corners and g, so it scores).
const FEEL_RECORD = `(id, name, date, n = 1200, lon0 = -84.29) => { const lat = [], lon = []; for (let i = 0; i < n; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(lon0 + Math.sin(i / 20) * 0.0005); }
  return { id, name, date, lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map((_, i) => 14 + 3 * Math.cos(i / 10)), lon_g: lat.map((_, i) => -0.2 * Math.sin(i / 10)),
    lat_g: lat.map((_, i) => 0.3 * Math.sin(i / 20)), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', date_known: true }; }`;

flow('the Log after the update: every drive saved before summaries stays as it was, is listed, and gets its summary from its own rows (REVIEW_FEEL F-06)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/privacy.html');                                // same origin, a page that never opens the drives
  // the database as the build on phones left it: version 2, drives and a drive in progress, no summaries
  const before = await page.evaluate(async (src) => {
    const rec = eval(src);
    const db = await new Promise((ok, fail) => { const r = indexedDB.open('apexnav', 2);
      r.onupgradeneeded = () => { r.result.createObjectStore('drives', { keyPath: 'id' }); r.result.createObjectStore('keep', { keyPath: 'key' }); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    const old = [rec('m1', 'Cherohala Skyway', '2026-09-01T09:00', 900), rec('m2', 'Dry Ridge Rd', '2026-09-08T09:00', 700, -84.6),
      { ...rec('m3', 'imported_ride', '2026-09-10T08:00:00.000Z', 600, -83.1), source: 'imported', date_known: undefined, tags: ['wet'], note: 'kept' }];
    old[1].events = [{ type: 'corner', start_m: 100, end_m: 160, index: 26, apex_mph: NaN, code: 'L3', call: 'left three', dir: 'L', severity: '3', turn_rad: 1 }];   // saved before the NaN repair
    await new Promise((ok, fail) => { const t = db.transaction(['drives', 'keep'], 'readwrite'); for (const d of old) t.objectStore('drives').put(d);
      t.objectStore('keep').put({ key: 'drive_x:h', id: 'drive_x', kind: 'head', chunks: 1, state: { n: 1 } }); t.objectStore('keep').put({ key: 'drive_x:c000000', id: 'drive_x', kind: 'chunk', n: 0, from: 0, rows: [{ lat: 1 }] });
      t.oncomplete = ok; t.onerror = () => fail(t.error); });
    const dump = async (store) => JSON.stringify(await new Promise((ok) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => ok(q.result); }));
    const out = { drives: await dump('drives'), keep: await dump('keep') };
    db.close();
    return out;
  }, FEEL_RECORD);
  await page.goto(base + '/analysis.html?tab=log');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-drive]').length === 3, null, { timeout: 20000 });
  const after = await page.evaluate(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open('apexnav'); r.onsuccess = () => ok(r.result); });
    const dump = async (store) => JSON.stringify(await new Promise((ok) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => ok(q.result); }));
    const sums = JSON.parse(await dump('summaries')), drives = await dump('drives'), keep = await dump('keep');
    const scored = await Promise.all(sums.map(async (s) => ({ id: s.id, sum: s.ds.score, rows: ApexRecording.scoreOf(ApexCore, await ApexRecording.get(s.id)).ds.score, n: s.n, rowsCopied: 'lat' in s || 'speed_mps' in s })));
    const v = db.version; db.close();
    return { v, drives, keep, scored, names: [...document.querySelectorAll('tr[data-drive] .ix-road b')].map((b) => b.textContent), stats: ApexAnalysis.stats };
  });
  check(after.v === 3, 'the database is at version 3: ' + after.v);
  check(after.drives === before.drives, 'every drive is exactly as it was saved (lossless)');
  check(after.keep === before.keep, 'the drive in progress is untouched');
  check(after.scored.length === 3 && after.scored.every((x) => x.sum === x.rows && !x.rowsCopied), 'each summary is its drive\'s own score, no rows copied: ' + JSON.stringify(after.scored));
  check(after.scored.find((x) => x.id === 'm1').n === 900, 'the sample count is the drive\'s');
  check(after.stats.jobs.summaries === 1, 'the missing summaries were built in the worker: ' + JSON.stringify(after.stats));
  check(after.names.length === 3, 'all three listed: ' + after.names);
});

flow('End: the card is up within 150 ms of the tap and the drive is parsed, scored and saved in the worker; the Log is not reloaded for it (REVIEW_FEEL F-04, F-15)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    window.webkit = { messageHandlers: { apex: { postMessage: () => {} } } }; });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apex && window.ApexAnalysis);
  // the Log, opened once and closed: kept from here on
  await page.click('.tab[data-view="log"]');
  await page.waitForFunction(() => { const f = document.getElementById('logFrame'); return f && !f.hidden && f.contentWindow.ApexLogFrame && f.contentWindow.apexLogDebug && f.contentWindow.apexLogDebug.loaded(); }, null, { timeout: 15000 });
  await page.evaluate(() => { document.getElementById('logFrame').contentWindow.__kept = true; window.ApexLogHost.close('map'); });
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForFunction(() => window.apexDebug.driveActive);
  for (let burst = 0; burst < 6; burst++) {
    await page.evaluate((b) => { for (let j = b * 100; j < (b + 1) * 100; j++) window.apex.live({ lat: 35.5 + j * 1e-4, lon: -83.9 + Math.sin(j / 15) * 3e-4, accuracy_m: 4, speed_mps: 15, course_deg: 0, lat_g: 0.3 * Math.sin(j / 15), lon_g: 0, has_fix: true, calibration: 'locked' }); }, burst);
    await page.waitForTimeout(200);
  }
  const t = await page.evaluate(() => new Promise((done) => {
    let parsed = 0; const parse = ApexRecording.parse; ApexRecording.parse = (...a) => { parsed++; return parse(...a); };   // on this page's thread
    const card = document.getElementById('endCard'), t0 = performance.now();
    new MutationObserver((_, o) => { if (card.classList.contains('show')) { o.disconnect(); done({ ms: performance.now() - t0, busy: document.getElementById('endScore').hasAttribute('aria-busy'), name: document.getElementById('endName').textContent, meta: document.getElementById('endMeta').textContent, parsed }); } })
      .observe(card, { attributes: true, attributeFilter: ['class'] });
    document.getElementById('driveEnd').click(); window.apexDebug.endNow();   // I-3: End, and the Undo window run out
  }));
  check(t.ms < 150 && t.busy && !t.parsed, 'the card first, the score still coming, nothing parsed here: ' + JSON.stringify(t));
  check(/mi|km/.test(t.meta) && /min/.test(t.meta), 'the card says the distance and time from the start: ' + JSON.stringify(t));
  await scoredCard(page);
  const done = await page.evaluate(async () => ({ stats: ApexAnalysis.stats, saved: (await ApexRecording.summaries(null)).length, score: document.getElementById('endScore').textContent,
    meta: document.getElementById('endMeta').textContent }));
  check(done.stats.jobs.save === 1 && !done.stats.inlineJobs.save, 'saved in the worker: ' + JSON.stringify(done.stats));
  check(done.saved === 1 && /^(\d+|[\d.]+ (mi|km) · (no|too few clean) corners to score)$/.test(done.score) && /corners/.test(done.meta), 'saved with its summary, the score and corners on the card: ' + JSON.stringify(done));
  // the Log shows the new drive without loading again
  await page.click('#endDone');
  await page.click('.tab[data-view="log"]');
  await page.waitForFunction(() => document.getElementById('logFrame').contentDocument.querySelectorAll('tr[data-drive]').length === 1, null, { timeout: 10000 });
  check(await page.evaluate(() => document.getElementById('logFrame').contentWindow.__kept === true), 'the Log was told about the drive, not reloaded');
});

flow('Where to? opens at once: no drive is read and no road is searched while the sheet opens (REVIEW_FEEL F-08)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording && window.ApexStages);
  await page.evaluate(async (src) => { const rec = eval(src); for (let i = 0; i < 3; i++) await ApexRecording.store(rec('w' + i, 'Road ' + i, '2026-10-0' + (i + 1) + 'T09:00', 3000)); }, FEEL_RECORD);
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording && !document.getElementById('boot'));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => new Promise((done) => {
    const calls = []; for (const k of ['all', 'get']) { const f = ApexRecording[k]; ApexRecording[k] = (...a) => { calls.push(k); return f(...a); }; }
    const disc = ApexStages.discover; ApexStages.discover = (...a) => { calls.push('discover'); return disc(...a); };
    window.__planCalls = calls;
    const t0 = performance.now();
    document.getElementById('destInput').focus();
    requestAnimationFrame(() => setTimeout(() => done({ open: document.getElementById('planPanel').classList.contains('open'), ms: performance.now() - t0 }), 0));
  }));
  check(r.open && r.ms < 200, 'the sheet is open in the next frame: ' + JSON.stringify(r));
  await page.waitForTimeout(1000);
  const calls = await page.evaluate(() => window.__planCalls);
  check(!calls.length, 'nothing read or searched for it: ' + JSON.stringify(calls));
});

flow('themes: trying one is on in the frame, without loading the demo drive; its replay only when asked for (REVIEW_FEEL F-09)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && !document.getElementById('boot'));
  const r = await page.evaluate(async () => { const t0 = performance.now(); window.apexDebug.tryTheme('tapedeck'); const inside = performance.now() - t0;
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    await new Promise((ok) => setTimeout(ok, 1500));
    return { inside, theme: document.documentElement.dataset.theme, demo: [...document.scripts].some((s) => /data\/dry_ridge\.js/.test(s.src)), plate: !document.getElementById('trialPlate').hidden,
      watch: !document.getElementById('trialWatch').hidden, track: !!window.apexDebug.track }; });
  check(r.theme === 'tapedeck' && r.inside < 100, 'the theme in the frame: ' + JSON.stringify(r));
  check(!r.demo && !r.track, 'no demo drive loaded, no replay started: ' + JSON.stringify(r));
  check(r.plate && r.watch, 'the trial plate offers the replay: ' + JSON.stringify(r));
  await page.click('#trialWatch');
  await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.demo, null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('trialWatch').hidden, null, { timeout: 3000 });
});

flow('3D terrain: the switch reads on at once, the relief is raised when the map is idle, with a note while it builds (REVIEW_FEEL F-10)', async (page, base) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => (route.request().url().includes('/styles/')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
    : route.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getSource('apex-dem'), null, { timeout: 15000 });
  const r = await page.evaluate(() => { const m = window.apexDebug.map, sw = document.querySelector('[data-toggle="terrain"]'); sw.click();
    return { on: sw.getAttribute('aria-checked'), terrain: !!m.getTerrain(), note: !document.getElementById('terrainNote').hidden }; });
  check(r.on === 'true' && !r.terrain && r.note, 'on at once, "Building 3D terrain", the mesh not built in the tap: ' + JSON.stringify(r));
  await page.waitForFunction(() => { const m = window.apexDebug.map; return m.getTerrain() && m.getPitch() > 40; }, null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('terrainNote').hidden, null, { timeout: 10000 });
});

flow('the Log with 25 drives: loaded ahead, it opens in under 400 ms and reads no drive\'s rows for the list (REVIEW_FEEL F-06, F-15)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording);
  await page.evaluate(async (src) => { const rec = eval(src);
    for (let i = 0; i < 25; i++) await ApexRecording.store(rec('L' + i, i % 2 ? 'Cherohala Skyway' : 'Dry Ridge Rd', `2026-09-${String(1 + i).padStart(2, '0')}T09:00`, 3000)); }, FEEL_RECORD);
  // the frame's own reads of the drives, counted from its first script
  await page.addInitScript(() => { if (window.top === window) return; window.__rowReads = 0;
    Object.defineProperty(window, 'ApexRecording', { configurable: true, set(v) { for (const k of ['all', 'get']) { const f = v[k]; v[k] = (...a) => { window.__rowReads++; return f(...a); }; }
      Object.defineProperty(window, 'ApexRecording', { value: v, writable: true, configurable: true }); }, get() { return undefined; } }); });
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot'));
  // loaded while the map is idle after launch, hidden
  await page.waitForFunction(() => { const f = document.getElementById('logFrame'); return f && f.hidden && f.contentWindow.apexLogDebug && f.contentWindow.apexLogDebug.loaded() && f.contentDocument.querySelectorAll('tr[data-drive]').length === 25; }, null, { timeout: 20000 });
  const r = await page.evaluate(() => new Promise((done) => { const t0 = performance.now(); document.querySelector('.tab[data-view="log"]').click();
    requestAnimationFrame(() => setTimeout(() => { const f = document.getElementById('logFrame'); done({ ms: performance.now() - t0, shown: !f.hidden && getComputedStyle(f).visibility === 'visible', rows: f.contentDocument.querySelectorAll('tr[data-drive]').length, reads: f.contentWindow.__rowReads }); }, 0)); }));
  check(r.shown && r.rows === 25 && r.ms < 400, 'the Log with 25 drives up at once: ' + JSON.stringify(r));
  check(r.reads === 0, 'the list read no drive\'s rows: ' + JSON.stringify(r));
  // one view at a time: a drive's page reads that drive only, and its coach comes from the worker
  const log = page.frameLocator('#logFrame');
  await log.locator('tr[data-drive="L24"]').click();
  await log.locator('#tab-drive .dv-score').waitFor({ timeout: 15000 });
  const dv = await page.evaluate(() => { const w = document.getElementById('logFrame').contentWindow; return { reads: w.__rowReads, jobs: w.ApexAnalysis.stats.jobs, inline: w.ApexAnalysis.stats.inlineJobs }; });
  check(dv.reads === 1 && dv.jobs.drive >= 1 && !dv.inline.drive && !dv.inline.steadiness, 'the drive\'s own rows, its coach and the month trend in the worker: ' + JSON.stringify(dv));
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

// The owner, 2026-11-04: "dev only satellite map layer access for troubleshooting". /api/me's developer flag (the owner and
// the co-developer, backend/src/developers.ts) shows a Satellite switch in Layers; it draws USGS orthoimagery under our
// road and route lines. Anyone else never sees the switch, and a switch left on in localStorage draws nothing.
const satStyle = (route) => (route.request().url().includes('/styles/')
  ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) })
  : route.abort());
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function satPage(page, base, me, prefs) {
  const tiles = [];
  await page.route('https://tiles.openfreemap.org/**', satStyle);
  await page.route('https://basemap.nationalmap.gov/**', (route) => { tiles.push(route.request().url()); return route.fulfill({ contentType: 'image/png', body: PNG1 }); });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json(me);
    return json({ error: 'not_found' }, 404);
  });
  await page.addInitScript((p) => { try { localStorage.setItem('apex.onboarded', '1'); if (p) localStorage.setItem('apex.prefs', JSON.stringify(p)); } catch (_) {} }, prefs || null);
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.getLayer('apex-twisty'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);                                     // /api/me has answered
  return tiles;
}
flow('satellite: a developer gets a Satellite switch in Layers that lays USGS imagery under our roads and routes (the owner 2026-11-04)', async (page, base) => {
  const tiles = await satPage(page, base, { signed_in: true, member: true, handle: 'me', developer: true });
  check(await page.evaluate(() => !document.getElementById('satSwitch').hidden), 'the developer sees the switch');
  check(!(await page.evaluate(() => !!window.apexDebug.map.getLayer('apex-satellite'))) && !tiles.length, 'off until turned on, and no tile asked for');
  await page.evaluate(() => { if (!document.getElementById('swEdge').classList.contains('open')) document.getElementById('swTab').click(); });
  await page.click('#satSwitch');
  await page.waitForFunction(() => !!window.apexDebug.map.getLayer('apex-satellite'), null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const m = window.apexDebug.map, ids = m.getStyle().layers.map((l) => l.id), at = (id) => ids.indexOf(id);
    return { below: ['apex-twisty', 'apex-coverage', 'apex-alt', 'apex-explore', 'apex-route-casing', 'apex-route'].every((id) => at(id) > at('apex-satellite')),
      // the source as the style holds it (a raster source's own .tiles and .attribution are set only once it has loaded)
      tiles: (m.getStyle().sources['apex-satellite-src'] || {}).tiles || [], attrib: (m.getStyle().sources['apex-satellite-src'] || {}).attribution || '',
      on: document.getElementById('satSwitch').getAttribute('aria-checked') };
  });
  check(r.below && r.on === 'true', 'under our twisty and measured roads and every route line: ' + JSON.stringify(r));
  check(r.tiles.length === 1 && r.tiles[0].startsWith('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/') && /USGS/.test(r.attrib), 'USGS imagery, credited: ' + JSON.stringify(r));
  // its tiles are asked for (stubbed above: the run reaches no real host), and the page policy lets them through
  for (let t = 0; t < 80 && !tiles.length; t++) await page.waitForTimeout(100);
  check(tiles.length > 0 && tiles.every((u) => u.startsWith('https://basemap.nationalmap.gov/')), 'its tiles are asked for: ' + tiles.length);
  await page.click('#satSwitch');
  await page.waitForFunction(() => !window.apexDebug.map.getLayer('apex-satellite') && !window.apexDebug.map.getSource('apex-satellite-src'));
});
flow('satellite: anyone else never sees the switch, and one left on in localStorage draws nothing (the owner 2026-11-04)', async (page, base) => {
  const prefs = { toggles: { satellite: true, twisty: true } };
  for (const me of [{ signed_in: true, member: true, handle: 'me' }, { signed_in: false }, { signed_in: true, member: false, handle: 'me', developer: true }]) {
    const tiles = await satPage(page, base, me, prefs);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('satSwitch').hidden, shown: document.getElementById('satSwitch').offsetParent !== null, layer: !!window.apexDebug.map.getLayer('apex-satellite') }));
    check(r.hidden && !r.layer && !tiles.length, `no switch, no layer, no tile for ${JSON.stringify(me)}: ${JSON.stringify(r)} ${tiles.length}`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// Dev mode (the owner, 2026-11-09: "a dev mode in the app that shows all routing parameters and other debug info for only me
// and my codev to mess with"): the Satellite layer's gate. A developer gets a Developer row in the Garage's settings that
// opens the Dev panel (web/dev_panel.js, lazy); anyone else gets no row, no panel script, and settings left in localStorage
// change nothing.
const DEV_LEFT = { tune: { router: { BUY_MIN: 50 }, levels: { 'fun.slackS': 900 } }, forceValhalla: true, offline: true, lines: true };
async function devMe(page, me, asked) {
  page.on('request', (r) => { if (r.url().includes('dev_panel.js')) asked.push(r.url()); });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    return route.fulfill(u.pathname === '/api/me' ? { contentType: 'application/json', body: JSON.stringify(me) } : { status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
}
async function devRow(page) {
  await page.click('.tab[data-view="garage"]');
  await page.waitForTimeout(1200);                                     // /api/me has answered (renderAccount)
  await page.click('#garageGear');
  await page.waitForSelector('#garageSettings.open');
  return page.evaluate(() => { const r = document.querySelector('#garageSettings .nav-row[data-setting="dev"]'); return { row: !!r, hidden: !r || r.hidden, filled: document.getElementById('garageDevBody').children.length }; });
}
flow('Settings behind the gear: three short lists, each row saying what it is set to; a change made in a sheet shows on the row when you come back (design pass 7)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"signed_in":false}' }));
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot') && document.getElementById('garageGear'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.click('#garageGear');
  await page.waitForSelector('#garageSettings.open');
  await page.waitForTimeout(400);
  const list = () => page.evaluate(() => { const box = document.getElementById('garageSettings');
    return [...box.querySelectorAll('.nav-rows > *')].filter((e) => !e.hidden).map((e) => { const r = e.getBoundingClientRect(), sm = e.querySelector('small');
      return e.classList.contains('nav-group') ? { group: e.textContent } : { row: e.querySelector('span').textContent, says: sm.textContent, label: e.getAttribute('aria-label'), h: Math.round(r.height),
        cut: sm.scrollWidth > sm.clientWidth + 1, wide: r.right > innerWidth + 0.5 }; }); });
  const a = await list();
  const groups = a.filter((x) => x.group).map((x) => x.group), rows = a.filter((x) => x.row), say = Object.fromEntries(rows.map((r) => [r.row, r.says]));
  check(groups.join('|') === 'Sharing and safety|How the app reads|You and Vetta' && a[0].group, 'three lists, each under its name: ' + JSON.stringify(a.map((x) => x.group || x.row)));
  check(say['Units'] === 'Miles and feet' && say['Map motion'] === 'Lean' && say['Privacy zones'] === 'None' && /^(On|Off)$/.test(say['Crash check']) && say['Reminder'] === 'Off', 'each row says what it is set to: ' + JSON.stringify(say));
  check(say['Feedback'] === '' && say['About Vetta'] === '', 'a row with nothing to say says nothing: ' + JSON.stringify(say));
  // the three that said nothing: Spots counts yours, Route tuning says Standard until a slider moves; Road feel has no
  // switch to read while signed out, so it still says nothing
  check(say['Spots'] === 'None' && say['Route tuning'] === 'Standard' && say['Road feel'] === '', 'Spots, Route tuning and Road feel: ' + JSON.stringify(say));
  check(rows.every((r) => r.h >= 44 && !r.cut && !r.wide), 'every row a thumb tall, its value whole: ' + JSON.stringify(rows.filter((r) => r.h < 44 || r.cut || r.wide)));
  check(rows.find((r) => r.row === 'Units').label === 'Units: Miles and feet' && rows.find((r) => r.row === 'Feedback').label === 'Feedback', 'read aloud with its value: ' + JSON.stringify(rows.map((r) => r.label)));
  // change one in its sheet, come back: the row has it
  await page.click('#garageSettings .nav-row[data-setting="units"]');
  await page.waitForSelector('.garage-pop[data-setting="units"].open');
  await page.click('.garage-pop[data-setting="units"] [data-units="metric"]');
  await page.click('.garage-pop[data-setting="units"] .side-pop-head .linkbtn');
  await page.waitForFunction(() => !document.querySelector('.garage-pop[data-setting="units"]').classList.contains('open'));
  const b = Object.fromEntries((await list()).filter((x) => x.row).map((r) => [r.row, r.says]));
  check(b['Units'] === 'Kilometres and metres', 'back on the list, Units says what you just chose: ' + JSON.stringify(b));
  // a slider moved in Route tuning is counted on its row
  await page.click('#garageSettings .nav-row[data-setting="tuning"]');
  await page.waitForSelector('.garage-pop[data-setting="tuning"].open input[type="range"]');
  await page.evaluate(() => { const s = document.querySelector('.garage-pop[data-setting="tuning"] input[type="range"]'); s.value = String(Number(s.value) === Number(s.max) ? s.min : s.max);
    s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('.garage-pop[data-setting="tuning"] .side-pop-head .linkbtn');
  const c0 = Object.fromEntries((await list()).filter((x) => x.row).map((r) => [r.row, r.says]));
  check(c0['Route tuning'] === '1 changed', 'Route tuning counts the slider you moved: ' + JSON.stringify(c0));
  await page.click('#garageSettings .nav-row[data-setting="tuning"]');
  await page.click('#tuneReset');
  await page.click('.garage-pop[data-setting="tuning"] .side-pop-head .linkbtn');
  const c1 = Object.fromEntries((await list()).filter((x) => x.row).map((r) => [r.row, r.says]));
  check(c1['Route tuning'] === 'Standard', 'and says Standard again after Reset: ' + JSON.stringify(c1));
  await page.evaluate(() => document.querySelector('[data-units="imperial"]').click());
}, { viewport: { width: 393, height: 852 }, hasTouch: true });

flow('dev mode: anyone else sees no Dev entry, loads no panel, and settings left on this phone change no plan (the owner 2026-11-09)', async (page, base) => {
  graphDir = graphFixture();
  try {
    const asked = [];
    await devMe(page, { signed_in: true, member: true, handle: 'me' }, asked);
    await page.addInitScript((d) => { try { localStorage.setItem('apex.dev', JSON.stringify(d)); } catch (_) {} }, DEV_LEFT);
    const { r } = await ownTrip(page, base, 'fun');
    // Force Valhalla left on: ignored, our router planned it; the tune and offline switch did nothing
    check(r.own.covered && r.own.used && r.kinds[0] === 'own', 'our router planned it as for anyone: ' + JSON.stringify(r.own));
    const x = await page.evaluate(() => ({ devPlan: window.apexDebug.devPlan === undefined, panel: !window.ApexDevPanel, online: navigator.onLine, fetchOwn: !Object.prototype.hasOwnProperty.call(navigator, 'onLine'),
      lines: !window.apexDebug.map.getSource('apex-dev-cands'), bud: ApexFunRoute.LEVELS.fun.slackS, W: ApexRouteEngine.W.POOR_PER_KM }));
    check(x.devPlan && x.panel && x.online && x.fetchOwn && x.lines && x.bud === 240 && x.W === 10, 'nothing of dev mode ran: ' + JSON.stringify(x));
    const row = await devRow(page);
    check(row.row && row.hidden && row.filled === 0, 'no Developer row: ' + JSON.stringify(row));
    check(!asked.length, 'the panel\'s code is never fetched: ' + asked.join());
  } finally { graphDir = null; }
  // signed out, and a developer flag without membership: no row either
  for (const me of [{ signed_in: false }, { signed_in: true, member: false, handle: 'me', developer: true }]) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const asked = [];
    await devMe(page, me, asked);
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
    const row = await devRow(page);
    check(row.hidden && row.filled === 0 && !asked.length && (await page.evaluate(() => !window.ApexDevPanel)), `no Developer row for ${JSON.stringify(me)}: ${JSON.stringify(row)} ${asked.join()}`);
  }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

flow('dev mode: a developer opens the Dev panel from the Garage, changes a constant, re-plans and sees it, then resets (the owner 2026-11-09)', async (page, base) => {
  graphDir = graphFixture();
  try {
    const asked = [];
    await devMe(page, { signed_in: true, member: true, handle: 'me', developer: true }, asked);
    await ownTrip(page, base, 'fun');
    check(!asked.length, 'the panel loads only when opened: ' + asked.join());
    const row = await devRow(page);
    check(row.row && !row.hidden && row.filled > 0, 'the Developer row: ' + JSON.stringify(row));
    await page.click('#garageSettings .nav-row[data-setting="dev"]');
    await page.waitForSelector('.garage-pop.open[data-setting="dev"]');
    await page.click('#devOpenBtn');
    await page.waitForSelector('#devPanel:not([hidden])', { timeout: 10000 });
    check(asked.length === 1, 'the panel\'s code, once: ' + asked.join());
    // the plan before this opened may have been made before /api/me answered: Re-plan with the defaults first
    const done = (tuned) => page.waitForFunction((t) => { const p = window.apexDebug.devPlan; return p && !!p.tune === t && !document.getElementById('planPanel').classList.contains('busy') && /Re-planned|re-planned/.test(document.getElementById('devStatus').textContent); }, tuned, { timeout: 30000 });
    await page.click('#devReplan');
    await done(false);
    const before = await page.evaluate(() => ({ head: document.getElementById('devPlanHead').textContent, cands: document.querySelectorAll('#devPanel .dv-c').length,
      tune: document.getElementById('devPlanTune').textContent, own: apexDebug.devPlan.own.limitS, limit: apexDebug.devPlan.ranked.limitS, why: [...document.querySelectorAll('#devPanel .dv-why')].map((n) => n.textContent),
      text: document.getElementById('devPanel').textContent }));
    check(before.cands >= 2 && /level fun/.test(before.head) && before.tune === 'planned with the defaults', 'the plan, each candidate: ' + JSON.stringify(before).slice(0, 600));
    check(before.why.filter((w) => /^picked: /.test(w)).length === 1 && /own router/.test(before.text) && /router: /.test(before.text) && / G /.test(before.text) && /hwy /.test(before.text) && /fun /.test(before.text),
      'source, G, highway km, parts and why: ' + JSON.stringify(before.why));
    check(/Timeline \(\d+ steps/.test(before.text) && /BUY_MIN/.test(before.text) && /POOR_PER_KM/.test(before.text) && /fun\.budget/.test(before.text), 'the timeline and the tunables are listed');
    // a constant changed on the phone: Fun's slack 240 -> 900 s, in the router's budget (the worker) and the engine's
    await page.fill('#devPanel input[data-table="levels"][data-path="fun.slackS"]', '900');
    await page.click('#devReplan');
    await done(true);
    const after = await page.evaluate(() => ({ tune: document.getElementById('devPlanTune').textContent, own: apexDebug.devPlan.own.limitS, limit: apexDebug.devPlan.ranked.limitS, slack: ApexFunRoute.LEVELS.fun.slackS,
      kept: JSON.parse(localStorage.getItem('apex.dev')).tune }));
    check(after.tune === 'planned with levels.fun.slackS=900' && after.slack === 900 && after.kept.levels['fun.slackS'] === 900, 'the override is on, kept on this phone: ' + JSON.stringify(after));
    check(Math.abs(after.own - before.own - 660) < 1 && after.limit > before.limit + 600, `the router's and the engine's budgets moved by 660 s: ${before.own} -> ${after.own}, ${before.limit} -> ${after.limit}`);
    // Copy debug JSON: the plan's dump (the clipboard, or the box to copy from)
    await page.click('#devCopy');
    await page.waitForFunction(() => /Copied|Select the text/.test(document.getElementById('devStatus').textContent));
    const dump = await page.evaluate(() => JSON.parse(document.getElementById('devJSON').value));
    check(dump.plan && dump.plan.cands.length >= 2 && dump.plan.cands.every((c) => 'parts' in c && 'router' in c && 'why' in c && 'source' in c) && dump.tune.levels['fun.slackS'] === 900 && dump.versions && dump.versions.graph,
      'the dump: ' + JSON.stringify(dump).slice(0, 400));
    // Reset: the code's values back, re-planned with them
    await page.click('#devReset');
    await done(false);
    const reset = await page.evaluate(() => ({ tune: document.getElementById('devPlanTune').textContent, own: apexDebug.devPlan.own.limitS, slack: ApexFunRoute.LEVELS.fun.slackS,
      input: document.querySelector('#devPanel input[data-table="levels"][data-path="fun.slackS"]').value }));
    check(reset.tune === 'planned with the defaults' && reset.slack === 240 && Math.abs(reset.own - before.own) < 1 && reset.input === '240', 'Reset: the defaults again: ' + JSON.stringify(reset));
    // Force Valhalla: our router off for the next plan
    await page.click('#devPanel input[data-dev="forceValhalla"]');
    await page.click('#devReplan');
    await page.waitForFunction(() => { const p = window.apexDebug.devPlan; return p && p.switches.forceValhalla && !document.getElementById('planPanel').classList.contains('busy') && /Re-planned|failed/.test(document.getElementById('devStatus').textContent); }, null, { timeout: 30000 });
    const fv = await page.evaluate(() => ({ own: apexDebug.devPlan.own, kinds: apexDebug.devPlan.pool.map((c) => c.kind) }));
    check(!fv.own.used && fv.own.reason === 'off' && fv.kinds.every((k) => k !== 'own'), 'Force Valhalla: none of ours: ' + JSON.stringify(fv));
    await page.click('#devPanel input[data-dev="forceValhalla"]');
    // Offline simulation: other hosts fail and the page reads as offline; off again, as it was
    await page.click('#devPanel input[data-dev="offline"]');
    const off = await page.evaluate(async () => ({ online: navigator.onLine, err: await fetch('https://valhalla1.openstreetmap.de/route').then(() => 'answered', (e) => String(e.message)), own: (await fetch('index.html')).ok }));
    check(off.online === false && /Dev offline/.test(off.err) && off.own, 'offline simulation: ' + JSON.stringify(off));
    await page.click('#devPanel input[data-dev="offline"]');
    check(await page.evaluate(() => navigator.onLine && !Object.prototype.hasOwnProperty.call(navigator, 'onLine')), 'back online');
    await page.click('#devClose');
    check(await page.evaluate(() => document.getElementById('devPanel').hidden), 'Close hides it');
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

// Tune your routes (the owner, 2026-11-09; free for everyone since 2026-11-10, Pro is looks only; it was Pro, open to everyone
// until it goes on sale): Garage → Settings → Route tuning, plain sliders over the routing's numbers (web/route_tuning.js).
// Fun's extra time up re-plans the trip on screen to a longer way, the card says "Your tuning", Reset brings the route back.
flow('route tuning: Fun\'s extra time slider re-plans a longer Fun route, the card says so, Reset brings it back (the owner 2026-11-09)', async (page, base) => {
  graphDir = graphFixture();
  try {
    await ownTrip(page, base, 'fun');
    // a plan of ours is ranked again once the fresh context is in (ownRefine) and may swap the route on screen: each route
    // is read after that, so the before and the after are judged alike
    const settled = () => page.waitForFunction(() => !!window.apexDebug.lastRefine, null, { timeout: 8000 }).catch(() => {}).then(() => page.waitForTimeout(300));
    await settled();
    // the plan's Fun pick (its ranking's first: apexDebug.lastFun) and the card's route; the fresh context may swap the card's
    // afterwards on this synthetic grid (real time-of-day context over made-up roads), so the pick is what the levels judge
    const route = () => page.evaluate(() => { const t = window.apexDebug.track, p = window.apexDebug.lastFun[0]; return { pick: Math.round(p.timeS), pickParts: p.parts, timeS: Math.round(t.timeS), n: t.lat.length, end: t.dist[t.dist.length - 1], chip: !document.getElementById('cardTuneChip').hidden, chipLabel: document.getElementById('cardTuneChip').getAttribute('aria-label'),
      level: t.funLevel, tuned: t.tuned || null }; });
    const before = await route();
    check(before.level === 'fun' && !before.chip && !before.tuned, 'Fun, planned with the defaults, no note: ' + JSON.stringify(before));
    // the screen: Garage → the gear → Route tuning
    await page.click('.tab[data-view="garage"]');
    await page.click('#garageGear');
    await page.waitForSelector('#garageSettings.open');
    await page.click('#garageSettings .nav-row[data-setting="tuning"]');
    await page.waitForSelector('.garage-pop.open[data-setting="tuning"] input[data-tune="funTime"]');
    const screen = await page.evaluate(() => ({ sliders: document.querySelectorAll('#garageTuneBody input[type=range]').length, hints: [...document.querySelectorAll('#garageTuneBody .tune-hint')].filter((h) => h.textContent.length > 10).length,
      groups: [...document.querySelectorAll('#garageTuneBody .tune-group h4')].map((h) => h.textContent), affects: document.getElementById('tuneAffects').textContent, status: document.getElementById('tuneStatus').textContent,
      fun: document.querySelector('#garageTuneBody input[data-tune="funTime"]').value, replan: !document.getElementById('tuneReplan').hidden, reset: document.getElementById('tuneReset').disabled, locked: !document.getElementById('tuneLock').hidden }));
    check(screen.sliders >= 12 && screen.hints === screen.sliders && screen.groups.join() === 'Time,Roads,Avoid,Data' && /Best roads nearby/.test(screen.affects) && screen.fun === '35'
      && /^Standard/.test(screen.status) && screen.replan && screen.reset && !screen.locked, 'the screen, open to everyone, at the defaults: ' + JSON.stringify(screen));
    // Fun: extra time for better road, all the way up, and spent readily; then Use on the route on screen
    const slide = (id, v) => page.evaluate(([i, x]) => { const n = document.querySelector(`#garageTuneBody input[data-tune="${i}"]`); n.value = String(x); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
    await slide('funTime', 100);
    await slide('funEager', 4);
    const saved = await page.evaluate(() => ({ kept: JSON.parse(localStorage.getItem('apex.routeTuning')), status: document.getElementById('tuneStatus').textContent, out: document.querySelector('#tune_funTime').closest('.tune-row').querySelector('output').textContent }));
    check(saved.kept.values.funTime === 100 && saved.kept.values.funEager === 4 && /2 settings changed/.test(saved.status) && /100 %/.test(saved.out), 'kept on this phone: ' + JSON.stringify(saved));
    const replanned = () => page.waitForFunction(() => /Planned again|Couldn't/.test(document.getElementById('tuneStatus').textContent) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 30000 });
    await page.evaluate(() => { window.apexDebug.lastRefine = null; });
    await page.click('#tuneReplan');
    await replanned();
    await settled();
    const tuned = await route();
    check(/Planned again/.test(await page.evaluate(() => document.getElementById('tuneStatus').textContent)), 'planned again');
    check(tuned.level === 'fun' && tuned.pick > before.pick, `a longer Fun route: ${JSON.stringify(before)} -> ${JSON.stringify(tuned)}`);
    check(tuned.chip && /Fun: extra time/.test(tuned.chipLabel) && Array.isArray(tuned.tuned), 'the card says the route was planned with your tuning: ' + JSON.stringify(tuned));
    // Reset to defaults: nothing kept, the route as before once planned again, no note
    await page.click('#tuneReset');
    check(await page.evaluate(() => localStorage.getItem('apex.routeTuning') === null && document.querySelector('#garageTuneBody input[data-tune="funTime"]').value === '35'), 'Reset: the defaults, nothing kept');
    await page.evaluate(() => { window.apexDebug.lastRefine = null; });
    await page.click('#tuneReplan');
    await replanned();
    await settled();
    const after = await route();
    check(after.pick === before.pick && !after.chip && !after.tuned, `Reset brings the route back: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    check(await page.evaluate(() => ApexFunRoute.LEVELS.fun.budget === 0.35 && ApexRouteEngine.W.FUN === 1), 'the code\'s numbers back on the page');
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });
flow('route tuning: once Pro is on sale it is still free: no Pro line, the sliders work, the settings on this phone plan the route (the owner 2026-11-10: Pro is looks only)', async (page, base) => {
  graphDir = graphFixture();
  try {
    // the server's flags as the phone keeps them (flags.js): Pro on sale; no entitlement on this phone
    await page.addInitScript(() => { try { localStorage.setItem('apex.flags', JSON.stringify({ at: Date.now(), flags: { pro: true, proOnSale: true } }));
      localStorage.setItem('apex.routeTuning', JSON.stringify({ v: 1, values: { funTime: 100, funEager: 4, corners: 2 } })); } catch (_) {} });
    await ownTrip(page, base, 'fun');
    const x = await page.evaluate(() => ({ onSale: window.ApexFlags ? ApexFlags.on('proOnSale', false) : null, chip: !document.getElementById('cardTuneChip').hidden, budget: ApexFunRoute.LEVELS.fun.budget, fun: ApexRouteEngine.W.FUN,
      locked: !document.getElementById('tuneLock').hidden, lock: document.getElementById('tuneLock').textContent, disabled: document.querySelector('#garageTuneBody input[data-tune="funTime"]').disabled,
      kept: JSON.parse(localStorage.getItem('apex.routeTuning')).values.funTime }));
    check(x.onSale === true, 'Pro on sale: ' + JSON.stringify(x));
    check(x.chip && (x.budget !== 0.35 || x.fun !== 1), 'on sale without Pro: your settings plan it, and the card says so: ' + JSON.stringify(x));
    check(!x.locked && !/Vetta Pro/.test(x.lock) && !x.disabled && x.kept === 100, 'no Pro line, the sliders on, the settings kept: ' + JSON.stringify(x));
  } finally { graphDir = null; }
}, { geolocation: { latitude: 39.155, longitude: -84.615 }, permissions: ['geolocation'] });

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
      return json({ ways: [{ way: 1, line: [[lat, lon], [lat + 0.01, lon]], conf: [2, 3], rough: [0.3, 0.071], banked: [null, 0.3], offCamber: [null, 0] }] });
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
  // IDEAS U-13: the line's colour is the pavement measured there (its surer direction), and a tap says it in words
  const drawn = await page.evaluate(() => { const m = window.apexDebug.map; return { p: m.getSource('apex-coverage-src')._data.features[0].properties, paint: JSON.stringify(m.getPaintProperty('apex-coverage', 'line-color')) }; });
  check(drawn.p.s === 1 && drawn.p.t === 2, 'smooth, from the surer direction: ' + JSON.stringify(drawn.p));
  check(/^\["match",\["get","s"\],1,"#[0-9A-Fa-f]{6}",2,"#[0-9A-Fa-f]{6}",3,"#[0-9A-Fa-f]{6}","#[0-9A-Fa-f]{6}"\]$/.test(drawn.paint) && new Set(drawn.paint.match(/#[0-9A-Fa-f]{6}/g)).size === 4, 'four colours: smooth, fair, rough, unknown: ' + drawn.paint);
  await page.evaluate(() => { const m = window.apexDebug.map, f = m.getSource('apex-coverage-src')._data.features[0], c = f.geometry.coordinates; m.jumpTo({ center: [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], zoom: 14 }); });
  await page.waitForFunction(() => { const m = window.apexDebug.map; return m.loaded() && m.queryRenderedFeatures([m.getCanvas().clientWidth / 2, m.getCanvas().clientHeight / 2], { layers: ['apex-coverage'] }).length > 0; }, null, { timeout: 8000 });
  await page.evaluate(() => { const m = window.apexDebug.map, c = m.getCenter(); m.fire('click', { point: m.project(c), lngLat: c, originalEvent: {} }); });
  await page.waitForFunction(() => /Smooth pavement \(0\.07 g\) · many passes · 30% of it banked/.test(document.getElementById('toast').textContent), null, { timeout: 4000 });
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
  // 2026-11-10: plain names with what they mean, a bar each, and how sure in words (it said TECH, FLOW, SURF, CLEAR and "L0")
  check(/Technical/.test(text) && /Flow/.test(text) && /How sure\s*From the map only/.test(text) && !/TECH|SURF|\bL0\b/.test(text), 'the scores by name, how sure in words: ' + text.slice(0, 300));
  const meters = await page.evaluate(() => [...document.querySelectorAll('aside.side-pop.open .rp-meter')].map((m) => ({ name: m.querySelector('.rp-name').textContent, v: m.querySelector('b').textContent, fill: m.querySelector('.rp-bar i').getBoundingClientRect().width, bar: m.querySelector('.rp-bar').getBoundingClientRect().width, hint: m.querySelector('small').textContent })));
  const surf = meters.find((m) => m.name === 'Surface'), tech = meters.find((m) => m.name === 'Technical');
  check(meters.length === 4 && surf.v === '--' && surf.fill === 0 && /not measured/.test(surf.hint), 'no member data: Surface is --, its bar empty: ' + JSON.stringify(surf));
  check(Math.abs(tech.fill / tech.bar - Number(tech.v) / 100) < 0.02, 'a bar is as long as its score: ' + JSON.stringify(tech));
  // with the terrain known the first line says the climb as a height in the driver's units (it read "climbing [object Object]")
  await page.click('aside.side-pop.open button:has-text("Close")');
  await page.evaluate(() => {
    ApexStages.profile = async (t) => t.lat.map((_, i) => 300 + i * 0.5);
    const lat = [], lon = []; let x = 0, y = 0, h = Math.PI / 2;
    const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / 91190); } };
    step(20, 0); for (let k = 0; k < 8; k++) { step(10, (k % 2 ? 1 : -1) * Math.PI / 10); step(16, 0); } step(20, 0);
    window.apexDebug.openRoadPage({ lat, lon, name: 'Test Pass', km: lat.length * 5 / 1000, junctionsPerKm: 0.2 });
  });
  await page.waitForFunction(() => /climbing/.test(document.querySelector('aside.side-pop.open .rp-head').textContent), null, { timeout: 10000 });
  const head = await page.textContent('aside.side-pop.open .rp-head');
  check(/climbing [\d,]+ ft$/.test(head) && !/object/i.test(head), 'the climb in feet: ' + head);
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
    await page.waitForFunction(() => window.apexDebug.state.playing, null, { timeout: 10000 });   // U-128: once the map is ready
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

flow('theme contract on its side: the strip has words, one height, codes in the next cell; nothing on the binnacle overlaps and the Road line is whole, day and night, every theme (REVIEW5 U-106, U-107, U-124, U-129, U-133)', async (page, base) => {
  // the boxes the binnacle must never print over one another (the Road line ran across the Score, REVIEW5 U-106)
  const BOXES = () => {
    const q = (sel, label) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); return { label, x: r.left, y: r.top, r: r.right, b: r.bottom }; });
    return [...q('#cluster .dial-speed', 'speed'), ...q('#cluster .ro-limit', 'limit'), ...q('#cluster .ro-sight', 'sight'), ...q('#cluster .odo', 'trip'),
      ...q('#cluster .dna-arch', 'road'), ...q('#cluster .dial-g > :not(.g-score):not(.bezel-ring)', 'meter'), ...q('#cluster .g-score', 'score'), ...q('#cluster .kit-row', 'kit'),
      ...q('#driveBar', 'status'), ...q('#cluster .trip-peek', 'trip key')];
  };
  const overlaps = (bs) => { const out = []; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const A = bs[i], B = bs[j];
    const w = Math.min(A.r, B.r) - Math.max(A.x, B.x), h = Math.min(A.b, B.b) - Math.max(A.y, B.y); if (w > 1 && h > 1) out.push(`${A.label} over ${B.label}`); } return out; };
  const LONG = 'Road: Northwest Expressway';
  // the private themes too, on an account granted them (the phone has the grant from an earlier /api/me, and this one says it again)
  await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ signed_in: true, member: true, handle: 'granted', themes: Object.values(PRIVATE) }) }));
  await page.addInitScript((defs) => { try { localStorage.setItem('apex.themeGrants', JSON.stringify(defs)); } catch (_) {} }, Object.values(PRIVATE));
  for (const night of [false, true]) {
    for (const theme of [...['roadbook', 'tapedeck', 'billet'], ...PRIVATE_IDS]) {
      await page.setViewportSize({ width: 852, height: 393 });
      await page.addInitScript((n) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full', nightMode: n ? 'on' : 'off' })); } catch (_) {} }, night);
      const m = `${theme} ${night ? 'night' : 'day'}`;
      // the strip, on its side, on the demo replay: a corner, then the quiet stretch
      await page.goto(base + `/index.html?drive=dry_ridge&play=1&theme=${theme}`);
      await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
      check(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `${m}: the theme is on`);
      const strip = async (frac) => {
        await page.evaluate((f) => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * f; }, frac);
        await page.waitForTimeout(1200);
        return page.evaluate(() => { const el = document.getElementById('notes'), head = el.querySelector('.rb-box.now .rb-call span'), mods = el.querySelector('.rb-box.now .rb-mods');
          const cut = (x) => !!x && (x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth + 1);
          return { h: Math.round(el.getBoundingClientRect().height), head: head && head.textContent, headW: head ? Math.round(head.getBoundingClientRect().width) : 0,
            px: head ? parseFloat(getComputedStyle(head).fontSize) : 0, cut: cut(head) || cut(mods), quiet: !!el.querySelector('.note-quiet'),
            codes: [...el.querySelectorAll('.rb-code')].filter((c) => c.getClientRects().length).map((c) => [c.textContent, cut(c)]), words: el.querySelectorAll('.rb-box:not(.now) .rb-call').length }; });
      };
      const a = await strip(0.45), b = await strip(0.2);
      check(a.head && a.headW >= 80 && a.px >= 21 && !a.cut, `${m}: the head says its call in words at 21 px, whole: ` + JSON.stringify(a));
      check(!a.words && a.codes.length >= 1 && a.codes.every(([t, c]) => /^[A-Z0-9+-]+( [A-Z0-9]+)?$/.test(t) && t.length <= 7 && !c), `${m}: the next cell is a code, whole: ` + JSON.stringify(a.codes));
      check(a.h === b.h, `${m}: the strip keeps one height (U-133): ` + JSON.stringify([a.h, b.h, a.head, b.head]));
      // the binnacle in a drive, on its side, with a long road name: no box over another, the name whole
      await page.goto(base + `/index.html?theme=${theme}`);
      await page.waitForFunction(() => window.apex && window.apexDebug);
      await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.apex.live({ lat: 35.96 + i * 1e-5, lon: -83.92, accuracy_m: 5, speed_mps: 31, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.1, lon_g: 0 }); await new Promise((r) => setTimeout(r, 40)); } });
      for (const [w, h] of [[852, 393], [393, 852]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(300);
        const r = await page.evaluate((LONG) => { const d = document.querySelector('#cluster .dna-arch'); d.hidden = false; d.textContent = LONG;
          return { road: { whole: d.scrollWidth <= d.clientWidth + 1 && getComputedStyle(d).textOverflow !== 'ellipsis', text: d.textContent },
            limits: [...document.querySelectorAll('#cluster *')].filter((e) => e.childNodes.length === 1 && e.firstChild.nodeType === 3 && /^LIMIT \d/i.test(e.textContent)).length }; }, LONG);
        const bs = await page.evaluate(BOXES), o = overlaps(bs);
        check(!o.length, `${m} ${w}x${h}: nothing on the binnacle overprints: ` + o.join(', '));
        const clash = await page.evaluate(GAUGE_CLASH('#cluster'));   // a car's own gauges: none of their print overlaps
        check(!clash.length, `${m} ${w}x${h}: nothing on the car's gauges overlaps: ` + clash.join(' | '));
        check(r.road.whole, `${m} ${w}x${h}: the Road line whole: ` + JSON.stringify(r.road));
        check(r.limits === 0, `${m}: the limit is printed once, on the sign (U-129)`);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${m} ${w}x${h}: no sideways scroll`);
      }
    }
  }
});

flow('private themes: a granted account sees the Tiburon and the FR-S, uses each, and both keep the contract day and night; a grant gone, another account or signed out never sees them (migration 0044)', async (page, base) => {
  let me = { signed_in: true, member: true, handle: 'granted', themes: Object.values(PRIVATE) };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(me) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  const cards = () => page.evaluate(() => [...document.querySelectorAll('#themeCards .theme-card')].map((c) => c.querySelector('.tc-head').textContent));
  // granted: the picker shows both, marked private, and Use puts each on, its own instruments drawn
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => document.querySelectorAll('#themeCards .theme-card').length === 5, null, { timeout: 15000 });
  const c = await cards();
  check(c.some((t) => /^TiburonPRIVATE/.test(t)) && c.some((t) => /^FR-SPRIVATE/.test(t)), 'the granted account sees both, private: ' + JSON.stringify(c));
  // each card is that car's cluster, parked, with the car from above in its paint
  const tp = await page.evaluate(() => [...document.querySelectorAll('#themeCards .theme-preview.tp-car')].map((b) => ({ g: b.querySelectorAll('svg.car-gauge').length, car: !!b.querySelector('.tp-silhouette polygon') })));
  check(tp.length === 2 && tp.every((x) => x.g === 2 && x.car), 'the two cards are the cars\' clusters with their outlines: ' + JSON.stringify(tp));
  // nothing on a card overlaps: the gauges' print, and the car in its own row clear of the dials
  const cardClash = await page.evaluate(GAUGE_CLASH('#themeCards'));
  check(!cardClash.length, 'the cards\' gauges print clear: ' + cardClash.join(' | '));
  const silClear = await page.evaluate(() => [...document.querySelectorAll('#themeCards .tp-car')].map((b) => { const s = b.querySelector('.tp-silhouette svg').getBoundingClientRect();
    return [...b.querySelectorAll('.tp-g svg')].every((g) => { const r = g.getBoundingClientRect(); return s.top >= r.bottom - 0.5 || s.bottom <= r.top + 0.5 || s.left >= r.right - 0.5 || s.right <= r.left + 0.5; }); }));
  check(silClear.length === 2 && silClear.every(Boolean), 'the car has its own room on each card: ' + JSON.stringify(silClear));
  // the card draws the car in the mode the page is in: orange-lit black faces at night for the Tiburon
  const cardFace = () => page.evaluate(() => { const b = document.querySelector('#themeCards .tp-car'); return { mode: b.dataset.mode, face: b.style.getPropertyValue('--face').toUpperCase() }; });
  check(JSON.stringify(await cardFace()) === JSON.stringify({ mode: 'day', face: PRIVATE.tiburon.day.face.toUpperCase() }), 'by day, the day face: ' + JSON.stringify(await cardFace()));
  await page.evaluate(() => document.querySelector('#nightSwitch [data-night="on"]').click());
  check(JSON.stringify(await cardFace()) === JSON.stringify({ mode: 'night', face: PRIVATE.tiburon.night.face.toUpperCase() }), 'at night, the night face: ' + JSON.stringify(await cardFace()));
  const nightClash = await page.evaluate(GAUGE_CLASH('#themeCards'));
  check(!nightClash.length, 'the cards\' gauges print clear at night: ' + nightClash.join(' | '));
  await page.evaluate(() => document.querySelector('#nightSwitch [data-night="auto"]').click());
  for (const [id, label, part] of [['tiburon', 'Tiburon', '#cluster .dial-g svg.car-meter .car-lcd'], ['frs', 'FR-S', '#cluster .dial-speed svg.car-dial .car-red']]) {
    await page.evaluate((l) => document.querySelector(`#themeCards [aria-label="Use ${l}"]`).click(), label);
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, id);
    check(await page.$(part), `${id}: its own instruments (${part})`);
    check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--route').trim().toLowerCase()) === PRIVATE[id].day.route.toLowerCase(), `${id}: its own route colour`);
    // the arrow on the map is the car from above, in its paint, outlined in ink
    const puck = await page.evaluate(() => { const p = document.querySelector('.puck.car-puck polygon'); return p && { fill: p.getAttribute('fill'), stroke: p.getAttribute('stroke') }; });
    check(puck && puck.fill === PRIVATE[id].car.paint.hex && puck.stroke.toLowerCase() === PRIVATE[id].map.day.casing.toLowerCase(), `${id}: the arrow is the car: ` + JSON.stringify(puck));
    check(await page.evaluate(() => document.documentElement.dataset.finish) === PRIVATE[id].car.finish, `${id}: its trim on the binnacle`);
  }
  check(JSON.parse(await page.evaluate(() => localStorage.getItem('apex.prefs'))).theme === 'frs', 'the choice is kept');
  // nothing Vetta can't measure moves: the FR-S's rev counter rests, dimmed, at 0 in a drive; the speed is read in digits
  await page.evaluate(() => window.apex.live({ lat: 35.96, lon: -83.92, accuracy_m: 5, speed_mps: 24, course_deg: 0, has_fix: true, calibration: 'locked', lat_g: 0.3, lon_g: -0.2 }));
  await page.waitForTimeout(300);
  const tach = await page.evaluate(() => { const n = document.querySelector('#cluster .car-dial .car-rpm + .car-needle') || document.querySelectorAll('#cluster .car-dial .car-needle')[0];
    return { op: n.style.opacity, tf: n.getAttribute('transform'), digits: document.querySelector('#cluster .car-dial .dial-digital').textContent }; });
  check(tach.op === '0.25' && /^rotate\(-128\.00 /.test(tach.tf) && /^\d+$/.test(tach.digits), 'the rev counter rests, the speed is in digits: ' + JSON.stringify(tach));
  // any voice pack with a car theme: the pick wins over the theme's suggestion and stays when the theme changes
  const pickPack = (p) => page.evaluate((x) => document.querySelector(`#packSwitch [data-pack="${x}"]`).click(), p);
  await page.waitForFunction(() => window.apexDebug.state.voiceId === 'kit', null, { timeout: 10000 });   // the FR-S suggests Kit
  await pickPack('marguerite');
  check(await page.evaluate(() => window.apexDebug.state.voiceId) === 'marguerite' && await page.evaluate(() => document.querySelector('#packSwitch [data-pack="marguerite"]').getAttribute('aria-checked')) === 'true', 'a car theme with Marguerite');
  await page.evaluate(() => document.querySelector('#themeCards [aria-label="Use Tiburon"]').click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'tiburon');
  check(await page.evaluate(() => window.apexDebug.state.voiceId) === 'marguerite', 'the pick stays across a theme change');
  check(JSON.parse(await page.evaluate(() => localStorage.getItem('apex.prefs'))).voicePick === 'marguerite', 'and is kept');
  await pickPack('look');
  check(await page.evaluate(() => window.apexDebug.state.voiceId) === 'hale' && /Hale, the voice Tiburon suggests/.test(await page.textContent('#packNote')), 'Suggested is the theme\'s again');
  await pickPack('kit');
  check(await page.evaluate(() => window.apexDebug.state.voiceId) === 'kit', 'the Tiburon with Kit');
  await pickPack('look');
  await page.evaluate(() => document.querySelector('#themeCards [aria-label="Use FR-S"]').click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'frs');
  // the contract on the page, day and night, on the replay: the same hazard plate, floors, Limit sign and Score as every theme
  for (const id of PRIVATE_IDS) for (const night of [false, true]) {
    await page.addInitScript((n) => { try { localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full', nightMode: n ? 'on' : 'off' })); } catch (_) {} }, night);
    await page.goto(base + `/index.html?drive=dry_ridge&play=1&theme=${id}`);
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
    await page.waitForFunction(() => window.apexDebug.state.playing, null, { timeout: 10000 });
    const m = `${id} ${night ? 'night' : 'day'}`;
    check(await page.evaluate(() => document.documentElement.dataset.theme + '/' + document.documentElement.dataset.mode) === `${id}/${night ? 'night' : 'day'}`, `${m}: on`);
    await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * 0.45; });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const p = document.getElementById('hzPlate'); p.hidden = false; document.getElementById('hzPlateTitle').textContent = 'Gravel';
      const cs = getComputedStyle(p), call = document.querySelector('.rb-box.now .rb-call span');
      const small = [...document.querySelectorAll('#cluster *')].filter((n) => !(n instanceof SVGElement) && !n.closest('.ro-limit') && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
        .map((n) => [n.className, parseFloat(getComputedStyle(n).fontSize)]).filter(([, px]) => px < 13);
      const bank = document.querySelector('#cluster .dial-g .dial-digital.small'), l = document.querySelector('.ro-limit'), lb = l && l.getBoundingClientRect();
      const g = document.querySelector('#cluster .g-score'), gb = g.getBoundingClientRect(), mb = document.querySelector('#cluster .dial-g').getBoundingClientRect();
      return { bg: cs.backgroundColor, edge: cs.borderTopColor, ink: cs.color, speed: document.querySelector('#cluster .dial-digital').getBoundingClientRect().height,
        call: call ? parseFloat(getComputedStyle(call).fontSize) : 0, small, bankPx: bank ? bank.getBoundingClientRect().height : 0, bank: bank && bank.textContent,
        limit: l && { w: Math.round(lb.width), h: Math.round(lb.height), bg: getComputedStyle(l).backgroundColor, unknown: l.classList.contains('unknown') },
        score: { text: g.textContent, inside: gb.bottom <= mb.bottom + 1 && gb.top >= mb.top - 1 } };
    });
    check(r.bg === 'rgb(17, 17, 17)' && r.edge === 'rgb(255, 122, 26)' && r.ink === 'rgb(255, 255, 255)', `${m}: the same hazard plate ` + JSON.stringify(r));
    check(r.speed >= 40 && r.call >= 21 && !r.small.length && r.bankPx >= 13, `${m}: speed ${r.speed}, call ${r.call}, bank ${r.bankPx}, small ` + JSON.stringify(r.small));
    check(/^BANK /.test(r.bank || ''), `${m}: Bank is read out, -- until measured: ` + r.bank);
    const clash = await page.evaluate(GAUGE_CLASH('#cluster'));
    check(!clash.length, `${m}: nothing on the car's gauges overlaps: ` + clash.join(' | '));
    if (night) {                                                     // U-36: the night numeral, 46 px, in the car's own dial too
      const px = await page.evaluate(() => { const d = document.querySelector('.dial-speed .dial-digital'); return Math.round(parseFloat(getComputedStyle(d).fontSize) * d.getScreenCTM().a); });
      check(px >= 46, `${m}: a 46 px numeral at night: ${px}`);
    }
    check(r.limit && r.limit.w === 44 && r.limit.h === 52 && (r.limit.unknown || r.limit.bg === 'rgb(255, 255, 255)'), `${m}: the same Limit sign: ` + JSON.stringify(r.limit));
    check(/^--SCORE$/.test(r.score.text) && r.score.inside, `${m}: the Score under the meter, -- on a replay: ` + JSON.stringify(r.score));
  }
  // the grant taken away: the next /api/me drops both, and the look in use falls back to the road book
  await page.addInitScript(() => { try { localStorage.setItem('apex.prefs', JSON.stringify({ theme: 'tiburon', themeV: 2 })); } catch (_) {} });
  me = { signed_in: true, member: true, handle: 'granted', themes: [] };
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'roadbook' && document.querySelectorAll('#themeCards .theme-card').length === 3, null, { timeout: 15000 });
  check(await page.evaluate(() => localStorage.getItem('apex.themeGrants')) === null && !/Tiburon|FR-S/.test(JSON.stringify(await cards())), 'a grant gone: the phone forgets both');
  // another account, and signed out: never in the picker, and asking for one by link gets the road book
  for (const who of [{ signed_in: true, member: true, handle: 'other', themes: [] }, { signed_in: false }]) {
    me = who;
    await page.goto(base + '/index.html?view=garage&theme=frs');
    await page.waitForFunction(() => document.querySelectorAll('#themeCards .theme-card').length === 3);
    await page.waitForTimeout(800);                                   // /api/me has answered
    const seen = await cards();
    check(!/Tiburon|FR-S/.test(JSON.stringify(seen)) && await page.evaluate(() => document.documentElement.dataset.theme) === 'roadbook', `${who.signed_in ? 'another account' : 'signed out'}: no private theme ` + JSON.stringify(seen));
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

flow('offline area, as a member: Save the map here keeps the measured roads round it; with no signal a plan still has them, and clearing them (what Sign out calls) leaves nothing (IDEAS F-02)', async (page, base) => {
  let online = true;
  const asks = [], way = { 0: { i: [0, 1, 2], n: [3, 3, 3], cam: [0.02, 0.03, 0.02], cn: [3, 3, 3], rough: [0.1, 0.2, 0.1] } };
  await page.route('https://tiles.openfreemap.org/**', (route) => {
    if (!online) return route.abort();
    const u = route.request().url();
    if (u.includes('/styles/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eee' } }] }) });
    if (u.endsWith('/planet')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  await page.route('https://s3.amazonaws.com/**', (route) => (online ? route.fulfill({ contentType: 'image/png', body: Buffer.alloc(8) }) : route.abort()));
  await page.route('**/api/**', (route) => {
    if (!online) return route.abort();
    const u = new URL(route.request().url()), json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/roads' && u.searchParams.has('cells')) {
      const cells = u.searchParams.get('cells').split(','); asks.push(cells);
      return json(cells.includes('356_-835') ? { ways: { 77: way }, lines: { 77: [[35.61, -83.48], [35.62, -83.47]] } } : { ways: {}, lines: {} });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apexDebug.map.loaded(), null, { timeout: 15000 });
  await page.evaluate(() => { window.apexDebug.map.jumpTo({ center: [-83.47, 35.63], zoom: 11 }); document.getElementById('myAreaBtn').click(); });
  await page.waitForFunction(() => { const a = JSON.parse(localStorage.getItem('apex.offlineAreas') || '[]')[0]; return a && a.roadOf > 0; }, null, { timeout: 60000 });
  const area = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.offlineAreas'))[0]);
  check(area.roadCells === area.roadOf && area.roadWays === 1 && asks.every((c) => c.length <= 2) && asks.flat().includes('356_-835'),
    'the area kept the measured roads of every cell round it, asked two cells at a time: ' + JSON.stringify({ area, asks: asks.length }));
  check(/1 measured road/.test(await page.textContent('#myAreas')), 'the area\'s row says it has measured roads: ' + await page.textContent('#myAreas'));
  // no signal and a restart: the kept cells answer from the phone (IndexedDB), all of them or none
  online = false;
  await page.reload();
  await page.waitForFunction(() => window.ApexOwnRouting && window.ApexOwnRouting.keptFor, null, { timeout: 15000 });
  const off = await page.evaluate(async () => {
    const whole = await ApexOwnRouting.keptFor(['356_-835', '355_-835']), part = await ApexOwnRouting.keptFor(['356_-835', '999_999']);
    return { ways: whole ? Object.keys(whole.ways) : null, part };
  });
  check(off.ways && off.ways.join() === '77' && off.part === null, 'offline, the saved cells answer and a cell never saved is unknown: ' + JSON.stringify(off));
  // what Sign out, Erase everything and Delete offline data call (their wiring: tests/test_offline_road_feel.py)
  online = true;
  await page.evaluate(async () => { await ApexOwnRouting.clearCrowd(); });
  const gone = await page.evaluate(async () => ({ kept: await ApexOwnRouting.keptFor(['356_-835']), held: localStorage.getItem(ApexOwnRouting.HELD_KEY) }));
  check(gone.kept === null && gone.held === null, 'cleared, nothing of it is kept: ' + JSON.stringify(gone));
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

flow('a whole road as a stage: the drive\'s roads are keys, the picked one is circled on its map and saved under its name (the owner\'s note 09)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  let sent = 0;
  // the map match names the samples it is sent: the second half "Bank Road" (the first and last km never sent)
  await page.route('https://valhalla1.openstreetmap.de/**', async (route) => {
    const shape = JSON.parse(route.request().postData()).shape; sent = shape.length;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edges: [{ way_id: 1, names: ['Cheviot Road'] }, { way_id: 2, names: ['Bank Road'] }],
      matched_points: shape.map((_, k) => ({ type: 'matched', edge_index: k < shape.length / 2 ? 0 : 1 })) }) });
  });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await page.evaluate(async () => {
    const lat = [], lon = [];
    for (let i = 0; i < 800; i++) { lat.push(39.1 + i * 5 / 110540); lon.push(-84.6 + Math.sin(i / 60) * 0.001); }
    await ApexRecording.store({ id: 'br1', name: 'Bank Road', date: '2026-10-29T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => 0), lat_g: lat.map(() => 0), g_known: null, elev: lat.map((_, i) => 200 + i * 0.1), hz: 1, source: 'web-gps', events: [] });
  });
  await page.goto(base + '/analysis.html?tab=stages&drive=br1');
  await page.waitForSelector('#segRoads button:has-text("Bank Road uphill")');
  check(sent === 400, 'only the middle of the drive was sent: ' + sent);
  check(!(await page.$('#segMap ellipse')), 'nothing circled before a pick');
  await page.click('#segRoads button:has-text("Bank Road uphill")');
  await page.waitForSelector('#segMap ellipse');
  check(await page.getAttribute('#segRoads button:has-text("Bank Road uphill")', 'aria-pressed') === 'true', 'the picked road is pressed');
  check(/corners · up 20 m/.test(await page.textContent('#segInfo')), 'its length and climb: ' + await page.textContent('#segInfo'));
  await page.click('#segSave');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('apex.segments') || '[]').some((s) => s.name === 'Bank Road uphill'));
  const seg = await page.evaluate(() => JSON.parse(localStorage.getItem('apex.segments')).find((s) => s.name === 'Bank Road uphill'));
  check(seg.length_m === 199 * 5, 'from where it joined Bank Road to where it left: ' + seg.length_m);
});

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
  // TestFlight 13 ("how do i slide to align when video doesn't preview?"): the video is shown with the overlay drawn on it
  const btn = (re) => page.evaluate((s) => [...document.querySelectorAll('#dvDashcam button')].find((x) => new RegExp(s).test(x.textContent)).click(), re);
  const pv = () => page.evaluate(() => {
    const st = document.querySelector('#dvDashcam .dc-stage'), ov = st.querySelector('canvas'), g = ov.getContext('2d'), v = st.querySelector('video');
    const strip = ov.width && ov.height ? g.getImageData(0, Math.round(ov.height * 0.95), ov.width, 1).data : [];
    let ink = 0; for (let k = 3; k < strip.length; k += 4) if (strip[k] > 0) ink++;
    return { shown: !st.hidden && st.getBoundingClientRect().height > 50, ink, vt: v.currentTime, where: document.querySelector('#dvDashcam .dc-where').textContent,
      off: document.querySelector('#dvDashcam input[aria-label^="When the video starts"]').value };
  });
  let p = await pv();
  check(p.shown && p.ink > 0, 'a preview with the overlay strip drawn over the video: ' + JSON.stringify(p));
  // the corner call (500 m at 15 m/s: 33.3 s into the drive) is past this 2 s video: the preview says which way to slide
  await btn('Next call');
  p = await pv();
  check(/Left 4/.test(p.where) && /after the video ends/.test(p.where) && /slide Later/.test(p.where), 'the call outside the video, said: ' + p.where);
  // slide the video's start to 32.5 s into the drive: the call is 0.8 s into the video, and the preview goes there
  await page.evaluate(() => { const r = document.querySelector('#dvDashcam input[aria-label^="When the video starts"]'); r.value = '32.5'; r.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => Math.abs(document.querySelector('#dvDashcam video').currentTime - 0.83) < 0.1, null, { timeout: 5000 });
  await page.waitForFunction(() => /Slide until the car is at this corner/.test(document.querySelector('#dvDashcam .dc-where').textContent));
  p = await pv();
  check(/corner call 1 of 1, Left 4/.test(p.where) && p.ink > 0, 'the call lands on its frame: ' + JSON.stringify(p));
  check(/Video starts 32\.5 s into the drive/.test(await page.textContent('#dvDashcam')), 'the offset in words');
  await btn('\\+ 0\\.5 s');
  check((await pv()).off === '33', 'a half-second nudge');
  await page.evaluate(() => [...document.querySelectorAll('#dvDashcam button')].find((x) => /Make the video/.test(x.textContent)).click());
  await page.waitForFunction(() => window.__saved, null, { timeout: 20000 });
  const saved = await page.evaluate(() => window.__saved);
  check(saved.size > 500 && /^Dashcam_road-dashcam-.*\.(webm|mp4)$/.test(saved.name), 'a new video: ' + JSON.stringify(saved));
  // a file this phone can't open: said plainly, no blank preview, no Make the video
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(4096).fill(7)], 'broken.mp4', { type: 'video/mp4' }));
    const input = document.querySelector('#dvDashcam input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => /couldn’t open that video/.test(document.querySelector('#dvDashcam .dc-status').textContent), null, { timeout: 8000 });
  check(await page.evaluate(() => document.querySelector('#dvDashcam .dc-stage').hidden
    && [...document.querySelectorAll('#dvDashcam button')].find((x) => /Make the video/.test(x.textContent)).disabled), 'nothing to preview or make from it');
});

// A drive for the drive page's own flows: north 1.5 km with a corner call (dashcam) and some g (the grip circle)
async function storeDashDrive(page, id = 'dc1', name = 'Dashcam road') {
  await page.evaluate(async ([id, name]) => {
    const lat = [], lon = [];
    for (let i = 0; i < 300; i++) { lat.push(35.6 + i * 5 / 110540); lon.push(-83.9 + Math.sin(i / 40) * 0.002); }
    await ApexRecording.store({ id, name, date: '2026-10-20T15:00:00Z', lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15),
      lon_g: lat.map(() => -0.1), lat_g: lat.map((_, i) => Math.sin(i / 10) * 0.3), g_known: null, elev: null, hz: 1, source: 'web-gps',
      events: [{ type: 'corner', code: 'L4', call: 'Left 4', index: 100, dist_m: 500, start_m: 480, end_m: 520, radius_m: 80, apex_mph: 30, dir: 'L', severity: 4 }] });
  }, [id, name]);
}

flow('the empty Log is a first page: the book\'s furniture in pencil, one key, and its switch in the page\'s own typeface (design pass 2026-11-10)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded());
  await page.waitForSelector('#historyEmpty:not([hidden])');
  const f = await page.evaluate(() => { const fam = (e) => getComputedStyle(e).fontFamily, go = document.querySelector('#historyEmpty .fp-go').getBoundingClientRect(), alt = document.querySelector('#historyEmpty .fp-alt').getBoundingClientRect();
    return { body: fam(document.body), sw: [...document.querySelectorAll('.log-seg button')].map(fam), go: [Math.round(go.height), Math.round(go.width)], alt: Math.round(alt.height),
      over: document.documentElement.scrollWidth > innerWidth, head: document.querySelector('#historyEmpty .fp-head').textContent, table: document.getElementById('historyPanel').hidden }; });
  check(f.sw.every((x) => x === f.body), 'Drives and Stages are set in the page\'s typeface: ' + JSON.stringify(f));
  check(f.go[0] >= 44 && f.go[1] > 300 && f.alt >= 44 && !f.over && f.head === 'Your first drive goes here.' && f.table, 'one full-width key, a 44 pt link, nothing off the page, no empty table under it: ' + JSON.stringify(f));
  await page.click('[data-seg="segments"]');
  await page.waitForSelector('#segList .first-page');
  const s = await page.evaluate(() => ({ head: document.querySelector('#segList .fp-head').textContent, go: document.querySelector('#segList .fp-go').textContent, mark: !!document.querySelector('#segList .fp-mark') }));
  check(s.head === 'No stages yet.' && s.go === 'Start a drive' && s.mark, 'Stages: what a stage is, drawn, and the way to one: ' + JSON.stringify(s));
});

flow('the drive page\'s map: with no map to be had the picture keeps its blank panel; MapLibre loads only for it (TestFlight 15)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await storeDashDrive(page, 'bm1', 'Map road');
  check(!(await page.evaluate(() => !!window.maplibregl || performance.getEntriesByType('resource').some((e) => /maplibre-gl\.js/.test(e.name)))),
    'the Log list never loads MapLibre');
  await page.goto(base + '/analysis.html?drive=bm1');
  await page.waitForSelector('.dv-plan svg');
  await page.evaluate(() => document.querySelector('.dv-plan').scrollIntoView());
  // tiles are blocked here: MapLibre loads for the picture, its style fails, and the map is taken away again
  await page.waitForFunction(() => !!window.maplibregl, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.dv-basemap'), null, { timeout: 15000 });
  const s = await page.evaluate(() => ({ on: document.querySelector('.dv-plan').classList.contains('on-map'), credit: document.querySelector('.dv-credit').hidden,
    path: document.querySelectorAll('#dvSpeed line').length, casing: !!document.querySelector('#dvCase'),
    note: (document.querySelector('.dv-plan .dv-mapnote') || {}).textContent, key: !!document.querySelector('.dv-recenter') }));
  check(!s.on && s.credit && s.path > 10 && s.casing && !s.key, 'the blank panel, the path drawn, no credit for a map not shown: ' + JSON.stringify(s));
  check(s.note === 'Map couldn’t load', 'never silent: the panel says the map couldn’t load: ' + JSON.stringify(s.note));
});

flow('the drive page\'s map: with no signal and no saved area the panel says the map is unavailable offline, and MapLibre never loads', async (page, base) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true });
  });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await storeDashDrive(page, 'bm0', 'Map road');
  await page.goto(base + '/analysis.html?drive=bm0');
  await page.waitForSelector('.dv-plan svg');
  await page.evaluate(() => document.querySelector('.dv-plan').scrollIntoView());
  await page.waitForSelector('.dv-plan .dv-mapnote', { timeout: 8000 });
  const s = await page.evaluate(() => ({ note: document.querySelector('.dv-mapnote').textContent, gl: !!window.maplibregl, layer: !!document.querySelector('.dv-basemap') }));
  check(s.note === 'Map unavailable offline' && !s.gl && !s.layer, 'offline, said in one line: ' + JSON.stringify(s));
});

flow('the drive page\'s map: when the map can draw it sits under the path, fitted and in the theme; two fingers zoom it, a little out at most, the path follows, Recenter fits it again (stubbed MapLibre)', async (page, base) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {}
    // a stand-in MapLibre: records how it was made and draws one tile
    window.__maps = [];
    window.maplibregl = { Map: class {
      constructor(o) {
        this.o = o; this.h = {}; const c = o.container;
        c.classList.add('maplibregl-map');                               // as MapLibre does: its stylesheet's position: relative must not win
        c.getBoundingClientRect();
        window.__maps.push({ style: o.style, center: o.center, zoom: o.zoom, interactive: o.interactive, coop: o.cooperativeGestures, rotate: o.dragRotate,
          minZoom: o.minZoom, maxBounds: o.maxBounds, w: c.clientWidth, h: c.clientHeight, cls: c.className });
        this.c = { lng: o.center[0], lat: o.center[1] }; this.z = o.zoom; window.__map = this;
        setTimeout(() => { this.fire('styledata'); this.fire('data', { dataType: 'source', tile: {} }); this.fire('idle'); }, 50);
      }
      on(k, f) { (this.h[k] = this.h[k] || []).push(f); } fire(k, e) { (this.h[k] || []).forEach((f) => f(e)); }
      getCenter() { return this.c; } getZoom() { return this.z; } setMinZoom(z) { window.__minZoom = z; } setMaxBounds(b) { if (b) window.__maxBounds = b; }
      moveTo(lng, lat, z) { this.c = { lng, lat }; this.z = z; this.fire('move'); }   // as a pinch or pan would
      isStyleLoaded() { return true; } resize() {} jumpTo(v) { window.__jump = v; this.c = { lng: v.center[0], lat: v.center[1] }; this.z = v.zoom; this.fire('move'); }
      remove() { window.__removed = (window.__removed || 0) + 1; }
    } };
    window.ApexBasemap = { restyle(map, P) { window.__palette = P; } };
  });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording);
  await storeDashDrive(page, 'bm2', 'Map road');
  await page.goto(base + '/analysis.html?drive=bm2');
  await page.waitForSelector('.dv-plan svg');
  await page.evaluate(() => document.querySelector('.dv-plan').scrollIntoView());
  await page.waitForSelector('.dv-basemap.shown', { timeout: 8000 });
  const s = await page.evaluate(() => {
    const plan = document.querySelector('.dv-plan'), svg = plan.querySelector('svg'), layer = plan.querySelector('.dv-basemap');
    const sv = svg.getBoundingClientRect(), lr = layer.getBoundingClientRect();
    return { m: window.__maps, n: window.__maps.length, on: plan.classList.contains('on-map'), credit: !plan.querySelector('.dv-credit').hidden,
      under: getComputedStyle(layer).zIndex < getComputedStyle(svg).zIndex, first: plan.firstElementChild === layer,
      same: Math.abs(sv.width - lr.width) < 1 && Math.abs(sv.height - lr.height) < 1, palette: window.__palette, bg: layer.style.background };
  });
  const m = s.m[0];
  check(s.n === 1 && /tiles\.openfreemap\.org\/styles\//.test(m.style), 'one map of the app\'s own style: ' + JSON.stringify(s.m));
  // the owner, 2026-11-03: "zoom in on it and out but not all the way out just a little extra"
  check(m.interactive === true && m.coop === true && m.rotate === false, 'pinch and pan with two fingers, one finger scrolls the page, no rotating: ' + JSON.stringify(m));
  check(Math.abs(m.minZoom - (m.zoom - 1)) < 1e-9 && m.maxBounds && m.maxBounds[0][0] < m.center[0] && m.maxBounds[1][0] > m.center[0]
    && m.maxBounds[0][1] < m.center[1] && m.maxBounds[1][1] > m.center[1], 'out one level past the fit at most, panning held round the drive: ' + JSON.stringify(m));
  check(Math.abs(m.center[1] - (35.6 + 150 * 5 / 110540)) < 0.002 && Math.abs(m.center[0] + 83.9) < 0.003 && m.zoom > 12 && m.zoom < 17, 'fitted on the drive: ' + JSON.stringify(m));
  check(s.on && s.credit && s.under && s.first && s.same, 'under the path, the picture\'s exact size, credited: ' + JSON.stringify(s));
  check(s.palette && s.palette.bg && s.bg, 'painted in the theme\'s map palette');
  // a pinch in on the first corner: the path, the numbers and the dot follow the map, the numbers keep their size
  const z = await page.evaluate(async () => {
    const svg = document.querySelector('.dv-plan svg'), r = svg.getBoundingClientRect(), u = r.width / svg.viewBox.baseVal.width;
    const mark = () => { const g = document.querySelector('#dvMarks [data-k="0"]'); const b = g.getBoundingClientRect(); return [b.left + b.width / 2 - r.left, b.top + b.height / 2 - r.top, b.width]; };
    const before = mark(), m = window.__map, z0 = m.z;
    // the camera that puts corner 1's apex at the picture's centre, two levels in, through drive_basemap's own maths
    const p = before; const lonlat = (() => {
      const c0 = m.c, ws = 512 * 2 ** z0, merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
      const cx = (c0.lng + 180) / 360 * ws + (p[0] - r.width / 2), cy = (1 - merc(c0.lat) / Math.PI) / 2 * ws + (p[1] - r.height / 2);
      return [cx / ws * 360 - 180, (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * cy / ws))) - Math.PI / 2) * 180 / Math.PI];
    })();
    m.moveTo(lonlat[0], lonlat[1], z0 + 2);
    const after = mark(), geo = document.querySelector('#dvGeo').getAttribute('transform');
    const key = document.querySelector('.dv-plan .dv-recenter');
    const shownKey = key && !key.hidden && getComputedStyle(key).display !== 'none';
    key.click();
    return { before, after, geo, shownKey, w: r.width, h: r.height, u, jump: window.__jump, z0, back: document.querySelector('#dvGeo').getAttribute('transform'),
      again: mark(), minZoom: window.__minZoom };
  });
  check(Math.abs(z.after[0] - z.w / 2) < 2 && Math.abs(z.after[1] - z.h / 2) < 2, 'corner 1 lands where the map put its apex, the centre: ' + JSON.stringify(z));
  check(/^matrix\(4 0 0 4 /.test(z.geo || ''), 'the path scaled with the map, two levels in: ' + z.geo);
  check(Math.abs(z.after[2] - z.before[2]) < 1, 'the corner number keeps its size: ' + JSON.stringify([z.before[2], z.after[2]]));
  check(z.shownKey && z.jump && Math.abs(z.jump.zoom - z.z0) < 1e-9 && Math.abs(z.minZoom - (z.z0 - 1)) < 1e-9, 'Recenter fits the drive again: ' + JSON.stringify(z.jump));
  check(Math.abs(z.again[0] - z.before[0]) < 1 && Math.abs(z.again[1] - z.before[1]) < 1 && /^matrix\(1 0 0 1 /.test(z.back || 'matrix(1 0 0 1 '), 'and the picture is back where it was: ' + JSON.stringify([z.before, z.again, z.back]));
});

flow('leftovers: the check every flow ends with sees "[object Object]", "undefined" and "NaN" in text and in a spoken label, and not in what is hidden', async (page, base) => {
  await page.goto(base + '/analysis.html');
  await page.waitForSelector('[data-seg="segments"]');
  check((await leftovers(page)).length === 0, 'a clean page has none: ' + JSON.stringify(await leftovers(page)));
  await page.evaluate(() => {
    const add = (html) => { const d = document.createElement('div'); d.className = 'lo-test'; d.innerHTML = html; document.body.append(d); };
    add('<p>descending [object Object]</p>'); add('<p>Best undefined mph</p>'); add('<p>NaN mi</p>');
    add('<button aria-label="Remove undefined">×</button>');
    add('<p hidden>undefined</p>'); add('<p style="display:none">NaN</p>'); add('<p>Undefined roads are fine, and so is a Nanny</p>');
  });
  const found = await leftovers(page);
  check(found.length === 4 && found.some((f) => f.includes('[object Object]')) && found.some((f) => f.includes('aria-label="Remove undefined"')), 'four seen, the hidden and the innocent left alone: ' + JSON.stringify(found));
  await page.evaluate(() => document.querySelectorAll('.lo-test').forEach((d) => d.remove()));
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
  check(!/\d{4}-\d{2}-\d{2}/.test(text) && /1 Sept? 2020|Sep 1, 2020/.test(r.rows[0][1]), `a record's day reads as a day ("1 Sep 2020"), never 2020-09-01 (got\n${text})`);
  check(r.overflow <= 1, `the records table fits a 390 px screen (overflows by ${r.overflow} px)`);
});

flow('a stage\'s Board and Runs fit the phone: an empty board is a sentence, a friend with no handle is never "@null", a run is its line and its components under it, nothing sideways (TestFlight 2026-11-05 "bad text spacing")', async (page, base) => {
  await page.setViewportSize({ width: SAFE.portrait.w, height: SAFE.portrait.h });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  await page.route(base + '/api/**', (route) => { const p = new URL(route.request().url()).pathname, m = route.request().method();
    const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') return json({});
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'natesenft', id: 'U1' });
    if (p === '/api/friends') return json([{ id: 'F1', handle: null, status: 'accepted' }]);   // a friend who hasn't picked a handle
    if (p === '/api/crews') return json([{ id: 'k1', name: 'VETTA', role: 'owner', members: 1, visibility: 'public' }]);
    return json([]); });
  await page.goto(base + '/analysis.html');
  await page.waitForFunction(() => window.apexLogDebug && window.apexLogDebug.loaded() && window.ApexRecording && window.ApexCore);
  // the real drive twice (web/data/dry_ridge.js), and a stage over its middle, backed up
  await page.evaluate(async () => {
    await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'data/dry_ridge.js'; s.onload = ok; s.onerror = fail; document.head.append(s); });
    const src = window.APEX_DRIVES.find((x) => x.id === 'dry_ridge'), f = src.fields, c = (k) => f.indexOf(k);
    const want = ['distance_m', 'lat', 'lon', 'elevation_m', 'speed_mph', 'lon_g', 'lat_g', 'camber_deg', 'roughness_rms', 'crest_vertical_g', 'vert_peak_g'];
    const csv = [want.join(','), ...src.rows.map((r) => want.map((k) => (r[c(k)] == null ? '' : r[c(k)])).join(','))].join('\n');
    for (const at of ['20261101_064500', '20261103_071500']) await ApexRecording.store(ApexRecording.parse(ApexCore, csv, `web_${at}.csv`, { source: 'web-gps', name: 'Dry Ridge Rd' }));
    const r = src.rows, a = r[Math.floor(r.length * 0.2)], b = r[Math.floor(r.length * 0.8)];
    localStorage.setItem('apex.segments', JSON.stringify([{ id: 'S1', name: 'Dry Ridge Rd', lat0: a[c('lat')], lon0: a[c('lon')], lat1: b[c('lat')], lon1: b[c('lon')],
      length_m: b[c('distance_m')] - a[c('distance_m')], synced: true }]));
  });
  await page.goto(base + '/analysis.html?tab=stages');
  await page.waitForSelector('#segList button.seg', { timeout: 15000 });
  await page.click('#segList button.seg');
  await page.waitForSelector('#segTable tr.run-parts .bars', { timeout: 15000 });
  await page.waitForFunction(() => /No friends on this stage yet/.test(document.getElementById('segLegend').textContent) && document.querySelector('#segShareRow select'), null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const t = document.getElementById('segTable'), box = t.closest('.scroll'), legend = document.getElementById('segLegend');
    const bars = [...t.querySelectorAll('tr.run-parts .bars')].map((g) => [...g.querySelectorAll('.bar')].map((b) => ({ r: b.getBoundingClientRect(), cut: b.scrollWidth > b.clientWidth + 1, t: b.textContent })));
    const clash = bars.flatMap((row) => row.slice(1).filter((b, i) => b.r.left < row[i].r.right - 0.5).map((b, i) => row[i].t + ' / ' + b.t));
    return { overflow: box.scrollWidth - box.clientWidth, runs: t.querySelectorAll('tr.run').length, heads: [...t.querySelectorAll('th')].map((h) => h.textContent),
      clash, cut: bars.flat().filter((b) => b.cut).map((b) => b.t), comps: bars.flat().map((b) => b.t), legendLines: Math.round(legend.getBoundingClientRect().height / parseFloat(getComputedStyle(legend).lineHeight)),
      legendFont: getComputedStyle(legend).fontFamily, boardRows: document.querySelectorAll('#segBoard tr').length,
      opts: [...document.querySelectorAll('#segShareRow option')].map((o) => o.textContent), shareText: document.getElementById('segShareRow').innerText,
      boardOverflow: (() => { const s = document.getElementById('segBoard').closest('.scroll'); return s.scrollWidth - s.clientWidth; })() };
  });
  check(r.overflow <= 1 && r.boardOverflow <= 1, 'nothing on the stage scrolls sideways: ' + JSON.stringify(r));
  check(r.runs === 2 && JSON.stringify(r.heads) === '["#","Run","Score","Time (private)"]', 'a run a line, four columns: ' + JSON.stringify(r.heads));
  // a run's name is when it was driven; the drive's name is under it only when it isn't the stage's own; lengths to a tenth
  const names = await page.evaluate(() => ({ runs: [...document.querySelectorAll('#segTable tr.run .run-name')].map((c) => [c.querySelector('b').textContent, c.querySelector('.sub').hidden ? null : c.querySelector('.sub').textContent]),
    title: document.getElementById('segTitle').textContent, len: document.querySelector('#segList button.seg span:nth-of-type(2)').textContent }));
  check(names.runs.length === 2 && names.runs.every(([when, name]) => /^Nov [13], \d/.test(when) && name === null) && names.runs[0][0] !== names.runs[1][0] && /Dry Ridge Rd/.test(names.title),
    'each run is named by its date, and the stage\'s name is not repeated on every line: ' + JSON.stringify(names));
  check(/^\d+\.\d (mi|km) · 2 runs$/.test(names.len), 'a stage\'s length to a tenth: ' + names.len);
  check(r.comps.length === 8 && r.comps.every((t) => /^(Pace|Smooth|Brakes|Rhythm) \d+$/.test(t.trim())) && !r.clash.length && !r.cut.length, 'each run\'s four components whole, side by side, none on another: ' + JSON.stringify(r));
  check(r.boardRows === 0 && r.legendLines >= 2, 'an empty board is a sentence that wraps, not a cut table cell: ' + JSON.stringify(r));
  check(!r.opts.some((o) => /null|undefined/.test(o)) && r.opts.includes('A friend with no handle yet') && /Share this stage with a friend/.test(r.shareText), 'a friend with no handle is named, never "@null": ' + JSON.stringify(r.opts));
  const bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the stage page under the island, the home bar or a corner, or keys on keys:\n  ' + bad.join('\n  '));
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
  check(JSON.stringify(idle.tabs) === '["Map","Log","People","Garage"]', 'four tabs: ' + idle.tabs);
  check(/map-key/.test(idle.layers) && /map-key/.test(idle.recenter) && /btn-start/.test(idle.start) && await page.evaluate(() => document.getElementById('startDrive').textContent.trim()) === 'Just drive',
    'Layers and Recenter are keys, Just drive the record key: ' + JSON.stringify(idle));
  check(/^Loop from here · \d+ mi/.test(idle.loop) && /On the twistiest roads nearby\s*Plan$/.test(idle.loop), 'one suggested loop, one clause under it (U-87): ' + idle.loop);
  // U-71: a tap on the map leaves follow as it was (no key); a drag shows the key with its glyph, the countdown a bar on its foot
  const tapKey = await page.evaluate(() => { const c = apexDebug.map.getCanvasContainer();
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 300 })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 300 }));
    return getComputedStyle(document.getElementById('recenterBtn')).display; });
  check(tapKey === 'none', 'a tap on the map shows no recenter key: ' + tapKey);
  await page.evaluate(() => { const c = apexDebug.map.getCanvasContainer();
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 300 })); window.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, clientY: 330 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 240, clientY: 330 })); });
  const rc = await page.evaluate(() => { const b = document.getElementById('recenterBtn'); return { glyph: getComputedStyle(b.querySelector('svg')).display, text: b.innerText.trim(), counting: b.classList.contains('counting'), label: b.getAttribute('aria-label') }; });
  check(rc.glyph !== 'none' && rc.text === '' && rc.counting && /on its own in 6 s/.test(rc.label), 'after a drag the key is the glyph, the seconds only in its label: ' + JSON.stringify(rc));
  const keys = await page.evaluate(() => { const a = document.getElementById('swTab').getBoundingClientRect(), b = document.getElementById('recenterBtn').getBoundingClientRect(); return { a: [a.left, a.right, a.width], b: [b.left, b.right, b.width], gap: b.top - a.bottom }; });
  check(JSON.stringify(keys.a) === JSON.stringify(keys.b) && keys.gap > 0 && keys.gap < 30, 'Recenter is the second key, under Layers: ' + JSON.stringify(keys));
  // Map menu: Layers are map things; the theme, units and the rest of Settings are not there (Notes and Voice stay, CALL_SHEET)
  // (the panel is opened to read it: since AM-1 a closed panel is hidden, and hidden words have no innerText)
  const layers = await page.evaluate(async () => { const tab = document.getElementById('swTab'), was = tab.getAttribute('aria-expanded') === 'true';
    if (!was) tab.click(); await new Promise((r) => setTimeout(r, 50)); const t = document.getElementById('swPanel').innerText; if (!was) tab.click(); return t; });
  check(/Friends/.test(layers) && /Cameras/.test(layers) && /Twisty roads/.test(layers) && /3D terrain/.test(layers) && !/Night|Theme|Units|Look/.test(layers), 'Layers: ' + layers);
  // design pass 8: the panel is the map's legend. Every layer row has its key and a line of what it is, Measured roads names
  // its three colours in words, "Who sees me" sits right under Friends, and the panel is whole on the screen
  const legend = await page.evaluate(async () => { const tab = document.getElementById('swTab'); tab.click(); await new Promise((r) => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('#switchRow .sw')].filter((b) => !b.hidden), box = document.getElementById('swPanel').getBoundingClientRect();
    const out = { bare: rows.filter((b) => !b.querySelector('.ly-key') || !b.querySelector('small') || !b.querySelector('small').textContent.trim()).map((b) => b.dataset.toggle),
      keyOff: rows.filter((b) => { const k = b.querySelector('.ly-key').getBoundingClientRect(), t = b.querySelector('span').getBoundingClientRect(); return !(k.width >= 20 && k.right <= t.left + 1); }).map((b) => b.dataset.toggle),
      words: [...document.querySelectorAll('[data-toggle="coverage"] .ly-legend b')].map((x) => x.textContent).join(),
      last: rows[rows.length - 1].dataset.toggle, who: document.getElementById('switchRow').nextElementSibling.id, box: [Math.round(box.left), Math.round(box.right)], w: innerWidth };
    tab.click(); return out; });
  check(!legend.bare.length && !legend.keyOff.length && legend.words === 'Smooth,Fair,Rough' && legend.last === 'friends' && legend.who === 'friendsSheetBtn' && legend.box[0] >= 48 && legend.box[1] <= legend.w,
    'Layers is a legend: a key and a line for every layer, Who sees me under Friends, whole on screen: ' + JSON.stringify(legend));
  // Plan sheet (the plan flow): the loop dial (five detents in one unit), Best roads nearby and Options as two chips (with
  // what is on beside them), no level switch (its home is the route card) and no More
  await page.click('#destInput');
  const plan = await page.evaluate(() => ({ detents: [...document.querySelectorAll('#loopDetents button')].map((b) => b.textContent), more: !!document.getElementById('planMore'),
    level: [...document.querySelectorAll('#planBody .plan-search-section [data-fun]')].length,
    chips: [...document.querySelectorAll('#planChips > .chip')].filter((c) => c.offsetParent).map((c) => c.textContent), on: [...document.querySelectorAll('#planOptsOn .chip')].map((c) => c.textContent) }));
  check(plan.detents.length === 5 && plan.detents.every((d) => / mi$/.test(d)) && !plan.more && plan.level === 0 && JSON.stringify(plan.chips) === '["Best roads nearby","Options · 1"]'
    && JSON.stringify(plan.on) === '["✕ Unpaved"]', 'Plan sheet: ' + JSON.stringify(plan));
  // Route bar: no toast repeating it; Route card: three numbers, four dials with unknowns as --, Start and Fly-through, the rest text links
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.lat.length > 50; }, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, bar: document.getElementById('routeBarName').textContent,
    stats: [...document.querySelectorAll('#routeCardStats > *')].length, dials: document.getElementById('routeCardBars').innerText.replace(/\s+/g, ' '),
    keys: [...document.querySelectorAll('#planPanel button')].filter((b) => b.offsetParent && /^(Start|Fly-through|Save|Share|GPX|Pin place)$/.test(b.textContent.trim())).map((b) => b.textContent.trim() + ':' + b.className) }));
  check(!card.toast.includes('Maryville'), 'the bar is the toast: ' + card.toast);
  check(card.stats === 3 && /CURVY/.test(card.dials) && /FLOWING/.test(card.dials) && /-- SURFACE/.test(card.dials) && /-- CAMERAS/.test(card.dials), 'Route card: ' + JSON.stringify(card));
  // the card's text links scroll with it; Start and Fly-through are its foot (the plan flow, finding 2): open the card full to see them all
  await page.evaluate(() => { document.getElementById('planPanel').classList.add('full'); document.getElementById('planBody').scrollTop = 1e5; });
  await page.waitForTimeout(300);
  const keysAll = await page.evaluate(() => [...document.querySelectorAll('#planPanel button')].filter((b) => b.offsetParent && /^(Start|Fly-through|Save|Share|GPX|Pin place)$/.test(b.textContent.trim())).map((b) => b.textContent.trim() + ':' + b.className));
  await page.evaluate(() => { document.getElementById('planPanel').classList.remove('full'); document.getElementById('planBody').scrollTop = 0; });
  check(keysAll.indexOf('Start:rec-key') >= 0 && keysAll.indexOf('Fly-through:ink-btn') >= 0 && keysAll.filter((k) => !/^(Start|Fly-through):/.test(k)).length >= 4
    && keysAll.filter((k) => !/^(Start|Fly-through):/.test(k)).every((k) => /:linkbtn$/.test(k)), 'Start and Fly-through, then text links: ' + keysAll);
  // U-70: the resolved route opens its card with Start in view on it; down, the bar shows its chevron (U-101: the chevron
  // alone, so the name has the width) and the name whole
  const up = await page.evaluate(() => { const p = document.getElementById('planPanel'), k = document.getElementById('routeDriveBtn').getBoundingClientRect(), r = p.getBoundingClientRect();
    return { open: p.classList.contains('open'), drive: k.top >= r.top && k.bottom <= Math.min(r.bottom, innerHeight) + 1 && k.height > 0 }; });
  check(up.open && up.drive, 'the route card rises with Start on it: ' + JSON.stringify(up));
  await page.click('#routeBar');
  await page.waitForTimeout(400);
  const down = await page.evaluate(() => { const m = document.querySelector('#routeBar .rb-open'), n = document.getElementById('routeBarName');
    return { open: document.getElementById('planPanel').classList.contains('open'), chevron: !!(m && m.offsetParent && m.querySelector('svg')), word: m ? m.textContent.trim() : '', whole: n.scrollWidth <= n.clientWidth + 1, name: n.textContent }; });
  check(!down.open && down.chevron && down.word === '' && down.whole, 'the collapsed bar: its chevron, and the name whole: ' + JSON.stringify(down));
  // a long name (the recording's "To Winton Woods Middle School") steps down in size rather than being cut
  const long = await page.evaluate(async () => { const n = document.getElementById('routeBarName'); apexDebug.track.name = 'To Winton Woods Middle School'; apexDebug.renderRouteCard(apexDebug.track);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { whole: n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1, size: getComputedStyle(n).fontSize, w: innerWidth, lines: Math.round(n.clientHeight / parseFloat(getComputedStyle(n).lineHeight || '16')) }; });
  check(long.whole && parseFloat(long.size) >= 14, 'a long name is whole, smaller or on two lines, never cut: ' + JSON.stringify(long));
  // U-114: a long name set while the card is up is fitted again when the card goes down; U-122: and the chosen route stays
  // on screen with the car: the camera is fitted to the route (with no tiles here the map never draws, so the fit asked is
  // what is checked), the app's own fit pausing follow with no recenter key
  await page.click('#routeBar'); await page.waitForTimeout(400);
  await page.evaluate(() => { apexDebug.renderRouteCard(apexDebug.track); window.__fits = []; const m = apexDebug.map, f = m.fitBounds.bind(m); m.fitBounds = (b, o) => { window.__fits.push(b); return f(b, o); }; });
  await page.click('#routeBar'); await page.waitForTimeout(600);
  const fitted = await page.evaluate(() => { const n = document.getElementById('routeBarName'), t = apexDebug.track, b = window.__fits[window.__fits.length - 1];
    const inside = (i) => b && t.lon[i] >= b[0][0] - 1e-9 && t.lon[i] <= b[1][0] + 1e-9 && t.lat[i] >= b[0][1] - 1e-9 && t.lat[i] <= b[1][1] + 1e-9;
    return { whole: n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1, follow: apexDebug.state.follow, fits: window.__fits.length,
      inView: [0, Math.floor(t.lat.length / 2), t.lat.length - 1].every(inside) }; });
  check(fitted.whole && fitted.inView && fitted.follow === false, 'collapsed: the name whole and the route fitted on screen: ' + JSON.stringify(fitted));
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

flow('REVIEW.md 1.2 screen by screen: the Log, drive detail, Stages, People signed out and the Garage with its confirm sheet', async (page, base) => {
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
  await page.waitForSelector('#tab-drive .dv-score');                    // F-06: the page is named at once, drawn when its rows are read
  const dv = await page.evaluate(() => { const ids = [...document.querySelectorAll('#tab-drive [id^="dv"]')].filter((e) => e.offsetParent).map((e) => e.id);
    const score = document.querySelector('.dv-score'), tags = document.getElementById('dvTags');
    return { first: score && score.compareDocumentPosition(document.getElementById('dvTagsPanel')) & Node.DOCUMENT_POSITION_FOLLOWING, replay: document.getElementById('dvReplay').className,
      tags: tags && tags.className, wide: [...document.querySelectorAll('#tab-drive *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className).slice(0, 5), ids: ids.length }; });
  check(dv.first && /solid/.test(dv.replay) && /stamps/.test(dv.tags) && !dv.wide.length, 'Drive detail: ' + JSON.stringify(dv));
  // People signed out: the same Friends | Crews switch, each side what it gets you in three glyphs, then sign-in (the owner, 2026-10-30)
  await page.goto(base + '/index.html?view=people');
  await page.waitForSelector('#accountBody .join-gets');
  const gets = (pane) => page.$$eval(`${pane} .join-gets li`, (s) => s.map((x) => x.querySelector('b').textContent + ':' + !!x.querySelector('svg')));
  const fg = await gets('#accountBody');
  check(JSON.stringify(fg) === '["Who’s out driving:true","Crew drives:true","Shared routes:true"]', 'People signed out, Friends: ' + fg);
  check(await page.isVisible('#accountBody >> text=Sign in with Google') && !(await page.isVisible('#crewsBody')), 'Friends first, with sign-in');
  // a page, not a form (the owner, 2026-11-10): a drawing, the name set large, each promise said in a line, the sign-in at the foot
  const jp = await page.evaluate(() => { const b = document.getElementById('accountBody'), r = (q) => b.querySelector(q).getBoundingClientRect(), head = b.querySelector('.join-head');
    const body = document.querySelector('.sheet .body').getBoundingClientRect(), key = r('.join-sign a.ink-btn'), art = r('.join-art');
    return { head: head.textContent, size: parseFloat(getComputedStyle(head).fontSize), face: getComputedStyle(head).fontFamily, pucks: b.querySelectorAll('.join-art .jr-puck').length, lead: b.querySelectorAll('.join-art .jr-puck.lead').length,
      artW: Math.round(art.width), w: innerWidth, said: [...b.querySelectorAll('.join-gets small')].every((x) => x.textContent.length > 12), keyH: Math.round(key.height),
      foot: Math.round(body.bottom - r('.join-sign').bottom), wide: [...b.querySelectorAll('*')].filter((e) => e instanceof HTMLElement && e.getBoundingClientRect().right > body.right + 1).length, logo: !!b.querySelector('img') }; });
  check(jp.head === 'Drive with friends.' && jp.size >= 30 && /Barlow/.test(jp.face) && jp.pucks === 2 && jp.lead === 1 && jp.artW === jp.w && jp.said && jp.keyH >= 52 && jp.foot >= 0 && jp.foot <= 40 && !jp.wide && !jp.logo,
    'People signed out is a page: ' + JSON.stringify(jp));
  await page.click('[data-people="crews"]');
  const cg = await gets('#crewsBody');
  check(JSON.stringify(cg) === '["Your crew’s page:true","Crew drives:true","Convoys:true"]' && await page.isVisible('#crewsBody >> text=Sign in with Google'), 'People signed out, Crews: ' + cg);
  // Settings are the Garage: the theme picker, help folded under "How this works", no Octane, Erase is red text behind a confirm sheet
  await page.goto(base + '/index.html?view=garage');
  await page.waitForSelector('#garageGear', { state: 'visible' });
  // signed out, the Garage is the Garage: People's page stays on People (it showed here, above Your cars)
  const stray = await page.evaluate(() => ({ join: !!document.querySelector('.join-page') && document.querySelector('.join-page').getBoundingClientRect().height, acc: getComputedStyle(document.getElementById('accountSection')).display }));
  check(stray.join === 0 && stray.acc === 'none', 'People\'s signed-out page is not in the Garage: ' + JSON.stringify(stray));
  await openSetting(page, 'data');
  const g = await page.evaluate(() => { const s = document.getElementById('sheet'), e = getComputedStyle(document.getElementById('myEraseBtn'));
    return { title: s.querySelector('h2').textContent, themes: document.querySelectorAll('#themeCards > *').length, how: document.querySelectorAll('[data-panel~="garage"] details.how').length, octane: /Octane/.test(document.body.innerText), erase: e.color + '/' + e.textDecorationLine + '/' + e.borderTopStyle }; });
  check(g.title === 'Garage' && g.themes === 3 && g.how >= 2 && !g.octane && g.erase === 'rgb(200, 16, 46)/none/none', 'Garage: ' + JSON.stringify(g));
  // 2026-11-10: Your data is the Settings list's rows in three groups (it was eight keys of eight widths): one left edge, one width
  const rowsOf = await page.evaluate(() => { const box = document.querySelector('.data-rows'); return { groups: [...box.querySelectorAll('.nav-group')].map((h) => h.textContent),
    rows: [...box.querySelectorAll('.nav-row')].map((r) => { const b = r.getBoundingClientRect(); return [r.id, Math.round(b.left), Math.round(b.width), Math.round(b.height)]; }) }; });
  check(rowsOf.groups.join() === 'Take a copy,Offline,Remove' && rowsOf.rows.length === 7 && new Set(rowsOf.rows.map((r) => r[1] + '/' + r[2])).size === 1 && rowsOf.rows.every((r) => r[3] >= 44),
    'Your data: seven rows in three groups, one edge and width, 44 pt or more: ' + JSON.stringify(rowsOf));
  let alerted = false; page.on('dialog', (d) => { alerted = true; d.dismiss(); });
  await page.evaluate(() => document.getElementById('myEraseBtn').click());
  await page.waitForSelector('.confirm-sheet [role="alertdialog"], .confirm-sheet .cs-box[role="alertdialog"]');
  const cs = await page.evaluate(() => ({ yes: document.querySelector('.confirm-sheet .cs-yes').textContent, color: getComputedStyle(document.querySelector('.confirm-sheet .cs-yes')).color, focus: document.activeElement.className }));
  check(!alerted && cs.yes === 'Erase everything' && cs.color === 'rgb(200, 16, 46)' && cs.focus === 'cs-no', 'the confirm sheet: ' + JSON.stringify(cs));
  await page.keyboard.press('Escape');
  check(!(await page.$('.confirm-sheet')) && (await page.evaluate(() => ApexRecording.all())).length === 1, 'Cancel (Escape) keeps everything');
  await page.mouse.click(200, 30); await page.waitForTimeout(300);   // a tap outside slides the settings sheets away
  // that tap closes the Menu too; since AM-1 a closed Menu can't be reached (the test used to click into it off screen)
  if (!(await page.evaluate(() => document.getElementById('sheet').classList.contains('open')))) { await page.click('.tab[data-view="garage"]'); await page.waitForTimeout(300); }
  // REVIEW4 U-69: touching a theme card's preview switches the theme, as its Use key does; each Use key names its card
  const uses = await page.$$eval('#themeCards button.ink-btn:not(.tc-hear)', (b) => b.map((x) => x.textContent + '/' + x.getAttribute('aria-label')));
  check(JSON.stringify(uses) === '["Use/Use Tapedeck","Use/Use Billet"]', 'theme cards: one word, named keys: ' + JSON.stringify(uses));
  await page.evaluate(() => document.querySelectorAll('#themeCards .theme-card')[1].querySelector('.theme-preview').scrollIntoView());
  await page.click('#themeCards .theme-card:nth-child(2) .theme-preview');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'tapedeck');
  const used = await page.evaluate(() => ({ inUse: document.querySelector('#themeCards .theme-card.in-use .tc-head b').textContent, back: !!document.querySelector('#themeCards [aria-label="Use Roadbook"]') }));
  check(used.inUse === 'Tapedeck' && used.back, 'the Tapedeck preview, touched, is in use: ' + JSON.stringify(used));
  await page.click('#themeCards [aria-label="Use Roadbook"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'roadbook');
});

flow('REVIEW5 §2: the Garage leads with you, your cars, Look and voice and the co-driver; every setting is a row behind one gear; People shows what arrives (U-116, U-117, U-121, U-132, U-135)', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'me' });
    if (u.pathname === '/api/me/export') return json({ member: { contribute: 0 } });
    if (u.pathname === '/api/points') return json({ pioneer: { firsts: 0, seconds: 0 } });
    if (route.request().method() === 'GET') return json([]);
    return json({}, 404);
  });
  await page.goto(base + '/index.html?view=garage');
  await page.waitForSelector('#garageGear', { state: 'visible' });
  await page.waitForSelector('#garageRoadFeelBody .sw', { state: 'attached' });   // drawn into its (shut) sheet
  const pg = await page.evaluate(() => ({ me: !!document.getElementById('garageMeBody').offsetParent, look: !!document.getElementById('lookSection').offsetParent,
    erase: getComputedStyle(document.getElementById('myEraseBtn').closest('.garage-pop')).visibility, inSheet: !!document.querySelector('#sheet #zoneRadius'),
    bar: getComputedStyle(document.querySelector('#sheet .body')).scrollbarWidth, gearLabel: document.getElementById('garageGear').getAttribute('aria-label') }));
  check(pg.me && pg.look && pg.erase === 'hidden' && !pg.inSheet && pg.bar === 'none' && pg.gearLabel === 'Settings', 'the Garage page: ' + JSON.stringify(pg));
  await page.click('#garageGear');
  await page.waitForSelector('#garageSettings.open');
  const rows = await page.$$eval('#garageSettings .nav-row', (r) => r.filter((x) => !x.hidden).map((x) => x.querySelector('span').textContent));
  check(JSON.stringify(rows) === '["Road feel","Privacy zones","Crash check","Reminder","Units","Map motion","Route tuning","Spots","Your data","Account","Feedback","About Vetta"]', 'the rows behind the gear: ' + rows);
  // U-116: a member with the switch off is told to turn it on above, never to sign in
  await page.click('#garageSettings .nav-row[data-setting="roadfeel"]');
  await page.waitForSelector('.garage-pop.open[data-setting="roadfeel"]');
  const rf = await page.evaluate(() => { const p = document.querySelector('.garage-pop.open[data-setting="roadfeel"]'); return { note: document.getElementById('ambientNote').textContent, sw: !!p.querySelector('.sw'), heads: p.querySelectorAll('h3').length }; });
  check(rf.note === 'Off. Turn on Share road feel above.' && rf.sw && rf.heads === 1, 'Road feel: ' + JSON.stringify(rf));
  await page.click('.garage-pop.open[data-setting="roadfeel"] .side-pop-head button');
  // U-117: Crash check says what it does with no contact, and with one
  // a sheet opened over the Settings list is reachable at once, not a frame later: clicked and read in one task, before any
  // frame (doors.js; on a slow runner its first keystrokes went nowhere)
  check(await page.evaluate(async () => {
    document.querySelector('#garageSettings .nav-row[data-setting="crash"]').click();
    await Promise.resolve();
    const p = document.querySelector('.garage-pop.open[data-setting="crash"]');
    return !!p && ['crashName', 'crashPhone'].every((id) => p.contains(document.getElementById(id)) && !document.getElementById(id).closest('[inert]'));
  }), 'the crash sheet\'s fields are reachable as it opens');
  await page.waitForSelector('.garage-pop.open[data-setting="crash"]');
  check(/^On, with no contact: .* offers to call (911|112)\. Add a contact/.test(await page.textContent('#crashState')), 'crash, no contact: ' + await page.textContent('#crashState'));
  await page.fill('#crashName', 'Sam'); await page.fill('#crashPhone', '+1 555 010 2030');
  check(/text Sam where you are\.$/.test(await page.textContent('#crashState')), 'crash, with Sam: ' + await page.textContent('#crashState'));
  await page.click('.garage-pop.open[data-setting="crash"] .side-pop-head button');
  // The owner (2026-11-03): "i should be able to swipe this submenu out of the way". A short drag springs back; a long one
  // closes the sheet under the finger and leaves the Settings list under it open.
  const swipe = (dy) => page.evaluate(async (dy) => {
    const p = document.querySelector('.garage-pop.open[data-setting="crash"]'), r = p.getBoundingClientRect();
    const at = (y) => { const t = new Touch({ identifier: 7, target: p, clientX: r.left + r.width / 2, clientY: y }); return { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }; };
    const y0 = r.top + 40;
    p.dispatchEvent(new TouchEvent('touchstart', at(y0)));
    for (let i = 1; i <= 6; i++) { p.dispatchEvent(new TouchEvent('touchmove', at(y0 + dy * i / 6))); await new Promise((f) => setTimeout(f, 40)); }
    p.dispatchEvent(new TouchEvent('touchend', { ...at(y0 + dy), touches: [], targetTouches: [] }));
    await new Promise((f) => setTimeout(f, 300));
    return { crash: !!document.querySelector('.garage-pop.open[data-setting="crash"]'), list: document.getElementById('garageSettings').classList.contains('open'), t: p.style.transform };
  }, dy);
  await page.click('#garageSettings .nav-row[data-setting="crash"]');
  await page.waitForSelector('.garage-pop.open[data-setting="crash"]');
  const short = await swipe(30);
  check(short.crash && short.list && !short.t, 'a short drag springs back: ' + JSON.stringify(short));
  const long = await swipe(220);
  check(!long.crash && long.list, 'a long swipe closes the sheet back to the Settings list: ' + JSON.stringify(long));
  // U-135: the default-on switch says anonymous on the row
  await page.click('#garageSettings .nav-row[data-setting="data"]');
  check(await page.isVisible('.garage-pop.open [data-toggle="health"] >> text=Share app health (anonymous counts)'), 'Share app health says anonymous on the row');
  // a tap outside closes every sheet
  await page.mouse.click(200, 30); await page.waitForTimeout(300);
  check(!(await page.$('.side-pop.open')), 'the scrim closes the sheets');
  // U-121: People's empty sides show what arrives there, captioned as an example, under the key
  await page.click('.tab[data-view="people"]');
  await page.waitForSelector('#accountBody .people-sample');
  const fs = await page.evaluate(() => { const f = document.querySelector('#accountBody .people-sample'); return { cap: f.querySelector('figcaption').textContent, label: f.getAttribute('aria-label'), afterKey: !!f.previousElementSibling.querySelector('button'), taps: f.querySelectorAll('button, a').length }; });
  check(fs.cap === 'Example: what a friend looks like here' && /Not a real person/.test(fs.label) && fs.afterKey && fs.taps === 0, 'Friends sample: ' + JSON.stringify(fs));
  await page.click('[data-people="crews"]');
  await page.waitForSelector('#crewsBody .people-sample');
  check((await page.textContent('#crewsBody .people-sample figcaption')) === 'Example: what a crew looks like here', 'Crews sample');
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
// ---- the plan flow (CALL_SHEET 2026-11-04; the planux audit): seven journeys at iPhone 15 geometry ------------------------
// Each counts its taps, and the route card's Start is measured over time (it never moves); the card says what the ranking
// did; what is on in Options is shown; the safe-area and overlap scanner passes on every screen of the journey.
const IPHONE = { viewport: { width: 393, height: 852 }, hasTouch: true, geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] };
// a line through the locations asked, a wiggle on it (amp in degrees, waves along the whole line), the time the router gives
function stubLine(locs, { amp = 0, waves = 0, time = 600, name = 'Test Ridge Road' } = {}) {
  const pts = [], per = 200;
  for (let k = 0; k < locs.length - 1; k++) {
    const a = locs[k], b = locs[k + 1];
    for (let i = k ? 1 : 0; i <= per; i++) {
      const t = (k + i / per) / (locs.length - 1), w = amp * Math.sin(t * Math.PI * waves) * Math.min(1, 6 * Math.min(t, 1 - t));
      pts.push([a.lat + (b.lat - a.lat) * i / per + w, a.lon + (b.lon - a.lon) * i / per - w]);
    }
  }
  const n = pts.length - 1;
  return { trip: { legs: [{ shape: polyline6(pts), maneuvers: [
    { type: 1, begin_shape_index: 0, length: 6, street_names: [name] }, { type: 10, begin_shape_index: n >> 1, length: 6, street_names: ['Hollow Creek Road'] },
    { type: 4, begin_shape_index: n, length: 0 }] }], summary: { length: 12, time, has_highway: false, has_toll: false, has_ferry: false } } };
}
// The destination's router: the quickest is a straight road (up first); the alternate winds (more corners, +2:40), so the
// ranking at Fun swaps to it and at Quick (its 10 % budget) keeps the straight one. Counts what the router is asked.
async function planRouter(page, asked = []) {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.80, 36.06] }, properties: { name: 'Maryville', state: 'Tennessee' } }] }) }));
  await page.route('https://valhalla1.openstreetmap.de/route', (route) => {
    const req = JSON.parse(route.request().postData() || '{}'), locs = req.locations;
    asked.push(req);
    const loop = locs.length > 2 && Math.abs(locs[0].lat - locs[locs.length - 1].lat) < 1e-4;
    if (loop) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(stubLine(locs, { amp: 0.0012, waves: 120, time: 5000, name: 'Loop Road' })) });
    const body = stubLine(locs, { time: 600 });
    if (locs.length === 2) body.alternates = [stubLine(locs, { amp: 0.0016, waves: 90, time: 760, name: 'Wiggle Road' })];
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://valhalla1.openstreetmap.de/sources_to_targets', (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sources_to_targets: req.sources.map(() => req.targets.map((_, j) => ({ time: 240 + 60 * j, distance: 3 + j }))) }) });
  });
}
async function planPage(page, base, store = {}) {
  await page.addInitScript((store) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1');
    for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v); } catch (_) {} }, store);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apex && !document.getElementById('boot'), null, { timeout: 20000 });
  await page.waitForFunction(() => !!apexDebug.state.lastPosition, null, { timeout: 10000 }).catch(() => {});
  const taps = { n: 0, log: [] };
  const tap = async (sel, what) => { taps.n++; taps.log.push(what || sel); await page.click(sel); };
  return { cdp, taps, tap };
}
// Start's place on the screen, every 100 ms for `ms` (null while it isn't shown)
async function startTrack(page, ms) {
  const ys = [];
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    ys.push(await page.evaluate(() => { const b = document.getElementById('routeDriveBtn').getBoundingClientRect(); return b.height ? Math.round(b.top * 10) / 10 : null; }));
    await page.waitForTimeout(100);
  }
  return ys;
}
const cardUp = (page, timeout = 20000) => page.waitForFunction(() => { const p = document.getElementById('planPanel'), b = document.getElementById('routeDriveBtn').getBoundingClientRect();
  return p.classList.contains('open') && p.classList.contains('routed') && b.height > 0 && b.bottom <= innerHeight; }, null, { timeout });
// the level cards (the owner, 2026-11-04): each card's words as read, and whether it is on (its pick is the route on screen)
const levelCards = (page) => page.evaluate(() => [...document.querySelectorAll('#routeCardFun [data-fun]')].map((b) => ({ level: b.dataset.fun,
  text: b.innerText.replace(/\s+/g, ' ').trim(), on: b.classList.contains('on'), checked: b.getAttribute('aria-checked') === 'true', further: b.classList.contains('further') })));
const planDone = (page, timeout = 25000) => page.waitForFunction(() => !document.getElementById('planPanel').classList.contains('busy') && /\S/.test(document.getElementById('routeProgress').textContent), null, { timeout });
const scan = async (page, where) => {
  await page.evaluate(() => { const st = document.querySelector('.stage'); if (st) st.scrollLeft = 0; });   // headless Chromium scrolls the stage sideways on a click into a field (TYPE_AT)
  const bad = await unsafe(page, SAFE.portrait); check(!bad.length, `${where}: under the island, the home bar or a corner, or keys on keys:\n  ${bad.join('\n  ')}`); };
async function swipe(cdp, x0, y0, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 10, y: y0 + dy * i / 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

flow('plan flow (a) a destination in 3 taps: Where to?, the place, Start; Start never moves, the card says the ranked swap (finding 1, 2, 3)', async (page, base) => {
  const asked = [];
  await planRouter(page, asked);
  const { taps, tap } = await planPage(page, base);
  // the main key follows the task (finding 3): Find a loop with nothing typed, the place once you type
  await tap('#destInput', 'Where to?');
  check(await page.isVisible('#findLoopBtn') && !(await page.isVisible('#findGoBtn')), 'nothing typed: Find a loop is the main key');
  await page.fill('#destInput', 'Maryville');                         // typing is not a tap
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.waitForFunction(() => /^Go to Maryville$/.test(document.getElementById('findGoBtn').textContent));
  check(!(await page.isVisible('#findLoopBtn')) && !(await page.isVisible('.plan-loop')), 'typing: the loop gives way, the main key goes to the place');
  await scan(page, 'Where to?, typed');
  await tap('#placeList .place', 'the place');
  await cardUp(page);
  await page.waitForTimeout(300);                                     // the sheet's slide
  const ys = await startTrack(page, 600);
  await planDone(page);
  ys.push(...await startTrack(page, 1500));                          // the profile, the facts and the ranking land meanwhile
  const shown = ys.filter((y) => y != null);
  check(shown.length === ys.length && Math.max(...shown) - Math.min(...shown) <= 1, 'Start stays put while the card fills in and the ranking lands: ' + JSON.stringify([...new Set(ys)]));
  const card = await page.evaluate(() => ({ note: document.getElementById('routeProgress').textContent, found: document.getElementById('routeProgress').classList.contains('found'),
    note2: document.getElementById('routeCardPager').textContent.replace(/\s/g, ' '), name: apexDebug.track.name, h: document.getElementById('planPanel').getBoundingClientRect().height,
    stage: document.querySelector('.stage').getBoundingClientRect().height, dials: document.getElementById('routeCardBars').innerText.replace(/\s+/g, ' ') }));
  check(card.found && /^Better route found: \+\d+ min, \d+ more corners$/.test(card.note), 'the card says the ranked route replaced the first one, and why: ' + JSON.stringify(card));
  // one control: the level cards are the choices, each its pick's time and corners, counted as the card counts them
  const cards = await levelCards(page);
  check(cards.length === 3 && cards.filter((c) => !c.further).every((c) => /^(Quick|Fun|Long way) (\d+:\d\d|\d+ min) \d+ corners?$/i.test(c.text)) && !cards.some((c) => /good corners/i.test(c.text))
    && cards.find((c) => c.level === 'fun').on && cards.find((c) => c.level === 'fun').checked, 'the level cards: each its pick, Fun on: ' + JSON.stringify(cards));
  check(cards.find((c) => c.level === 'max').further && /^Long way Look further$/i.test(cards.find((c) => c.level === 'max').text), 'a plan at Fun didn\'t look as far as Long way, and its card says so, no numbers: ' + JSON.stringify(cards));
  check(/^2 \/ 2Swipe the card for the next route$/.test(card.note2), 'the marks under the cards say which route and what a swipe does: ' + card.note2);
  check(await page.evaluate(() => !document.getElementById('routeCardOptions') && !document.querySelector('#routeCard .switch')), 'no separate tile row or switch');
  check(card.h <= 0.52 * card.stage, `the card opens at half height, the map above it (finding 10): ${Math.round(card.h)} of ${Math.round(card.stage)} px`);
  check(/CURVY/.test(card.dials) && /FLOWING/.test(card.dials) && !/TWIST|FLOW\b/.test(card.dials), 'plain words on the dials: ' + card.dials);
  await scan(page, 'the route card');
  await tap('#routeDriveBtn', 'Start');
  await page.waitForFunction(() => window.apexDebug.driveActive && apexDebug.track && apexDebug.track.kind === 'route', null, { timeout: 10000 });
  check(taps.n === 3, `a destination in 3 taps: ${taps.log.join(' → ')}`);
}, IPHONE);

flow('taste from picks: Start on another level\'s route than Vetta\'s pick teaches the taste, once, at half an answer, and says so', async (page, base) => {
  const asked = [];
  await planRouter(page, asked);
  const { tap } = await planPage(page, base);
  await tap('#destInput', 'Where to?');
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await tap('#placeList .place', 'the place');
  await cardUp(page);
  await planDone(page);
  const before = await page.evaluate(() => ({ store: localStorage.getItem('apex.taste') }));
  check(!before.store || !JSON.parse(before.store).picks, 'no picks yet: ' + before.store);
  await tap('#routeCardFun [data-fun="quick"]', 'Quick');
  await page.waitForFunction(() => /^Quick: /.test(document.getElementById('routeProgress').textContent) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 15000 });
  await tap('#routeDriveBtn', 'Start');
  await page.waitForFunction(() => window.apexDebug.driveActive, null, { timeout: 10000 });
  const got = await page.evaluate(() => ({ pick: apexDebug.lastPick || null, store: JSON.parse(localStorage.getItem('apex.taste') || '{}') }));
  check(got.pick && got.store.picks === 1 && Array.isArray(got.store.pairs) && got.store.pairs.length === 1 && got.store.pairs[0][3] === 0.5,
    'the route chosen over Vetta\'s pick is one half-weight pair: ' + JSON.stringify(got));
  if (got.pick.lean) {
    await page.waitForFunction(() => /Noted: you picked the more (technical|flowing|smooth) road/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  }
}, IPHONE);

flow('there and back: a trip to a place comes home another way in one tap, the destination a stop, the way out kept off the way home (graph_router.js roundTrip; Valhalla where our tiles don\'t reach)', async (page, base) => {
  const asked = [];
  await planRouter(page, asked);
  const { tap } = await planPage(page, base);
  await tap('#destInput', 'Where to?');
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await tap('#placeList .place', 'the place');
  await cardUp(page);
  await planDone(page);
  await page.waitForFunction(() => !document.getElementById('routeRoundBtn').hidden, null, { timeout: 10000 });
  const before = asked.length;
  await page.evaluate(() => document.getElementById('routeRoundBtn').scrollIntoView({ block: 'center' }));
  await tap('#routeRoundBtn', 'There and back');
  await page.waitForFunction(() => window.apexDebug.lastRound && /and back$/.test(document.getElementById('routeCardName').textContent), null, { timeout: 25000 });
  await planDone(page);
  const r = await page.evaluate(() => ({ name: document.getElementById('routeCardName').textContent, round: apexDebug.lastRound, note: document.getElementById('routeProgress').textContent,
    stops: document.getElementById('routeStops').innerText.replace(/\s+/g, ' '), key: document.getElementById('routeRoundBtn').hidden, kind: apexDebug.track && apexDebug.track.kind }));
  check(r.name === 'To Maryville and back' && r.round.how === 'valhalla' && r.round.via >= 1, 'the trip home is planned, named for it: ' + JSON.stringify(r));
  check(/^There and back/.test(r.note), 'the card says how much of the way home is new road: ' + JSON.stringify(r));
  check(/Maryville/.test(r.stops), 'the destination is a stop on the trip, as one you added: ' + JSON.stringify(r));
  check(r.key === true, 'a round trip offers no second round trip: ' + JSON.stringify(r));
  const back = asked.slice(before).find((q) => q.locations.length === 2 && Math.abs(q.locations[0].lat - 36.06) < 0.01);
  check(back && Array.isArray(back.exclude_locations) && back.exclude_locations.length >= 3, 'the way back was asked around the way out: ' + JSON.stringify(back && { n: (back.exclude_locations || []).length }));
  const whole = asked.slice(before).find((q) => q.locations.length > 2);
  check(whole && Math.abs(whole.locations[0].lat - whole.locations[whole.locations.length - 1].lat) < 1e-4, 'the whole trip starts and ends at home: ' + JSON.stringify(whole && whole.locations.length));
  await scan(page, 'there and back');
}, IPHONE);

flow('no connection: People is a page that says which it is (offline, or Vetta not answering) and what still works, Try again under the thumb; the Garage says so in its own corner (design pass 5)', async (page, base) => {
  let down = true;
  await page.route(/\/api\//, (route) => (down ? route.abort() : route.fulfill({ status: 200, contentType: 'application/json', body: '{"signed_in":false}' })));
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {}
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__onLine !== false }); });
  const read = () => page.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0, pg = [...document.querySelectorAll('.lost-page')].find(vis);
    if (!pg) return null;
    const key = pg.querySelector('.join-sign button'), kr = key.getBoundingClientRect();
    return { head: pg.querySelector('.join-head').textContent, line: pg.querySelector('.join-line').textContent, rows: [...pg.querySelectorAll('.join-gets li b')].map((b) => b.textContent),
      art: !!pg.querySelector('.join-art .jr-ghost') && pg.querySelectorAll('.join-art .jr-puck.lead').length === 1, key: key.textContent, keyH: Math.round(kr.height),
      keyOnScreen: kr.top >= 0 && kr.bottom <= innerHeight && document.elementFromPoint(kr.left + kr.width / 2, kr.top + kr.height / 2) === key,
      wide: [...pg.querySelectorAll('*')].filter((e) => e instanceof HTMLElement && e.getBoundingClientRect().right > innerWidth + 0.5).length };
  });
  for (const [name, w, h] of [['an iPhone 15', 393, 852], ['an SE', 375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base + '/index.html?view=people');
    await page.waitForSelector('.lost-page', { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 });   // the splash is over the key until it lifts
    await page.waitForTimeout(900);
    const p = await read();
    check(p && p.head === 'Can’t reach Vetta.' && /^Friends .* will be back when it answers\. These don’t need it:$/.test(p.line), `${name}: it says Vetta isn't answering, not that you are offline: ` + JSON.stringify(p));
    check(p.rows.join('|') === 'Driving and notes|Your Log|Saved routes' && p.art, `${name}: what works without it, as rows, under the road that stops: ` + JSON.stringify(p));
    check(p.key === 'Try again' && p.keyH >= 44 && p.keyOnScreen && !p.wide, `${name}: Try again is on the first screen, whole and a thumb tall: ` + JSON.stringify(p));
  }
  await page.click('[data-people="crews"]');
  await page.waitForTimeout(400);
  const crews = await read();
  check(crews && /^Crews, their drives and boards /.test(crews.line), 'the Crews side has its own page: ' + JSON.stringify(crews));
  // the Garage: no People page in it (the #332 mistake), its own corner says what is missing
  await page.click('#tabbar .tab[data-view="garage"]');
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0, b = document.getElementById('garageMeBody');
    return { page: [...document.querySelectorAll('.join-page')].filter(vis).length, text: b.innerText.replace(/\s+/g, ' ').trim() }; });
  check(g.page === 0 && /^Your cars Your cars and profile will be back when Vetta answers\. Looks, voices and settings work without it\. Try again$/i.test(g.text), 'the Garage says what is missing in its own corner: ' + JSON.stringify(g));
  // the phone itself offline: the page says that instead
  await page.click('#tabbar .tab[data-view="people"]');
  await page.click('[data-people="friends"]');
  await page.evaluate(() => { window.__onLine = false; window.dispatchEvent(new Event('offline')); });
  await page.waitForFunction(() => [...document.querySelectorAll('.lost-page .join-head')].some((e) => e.getClientRects().length && e.textContent === 'You’re offline.'), null, { timeout: 10000 });
  const off = await read();
  check(/ need a connection\. These don’t:$/.test(off.line), 'offline: the line says a connection is what is missing: ' + JSON.stringify(off));
  // Try again with nothing changed: the page stands, its key a key again
  await page.evaluate(() => [...document.querySelectorAll('.lost-page .join-sign button')].find((e) => e.getClientRects().length).click());
  await page.waitForFunction(() => { const k = [...document.querySelectorAll('.lost-page .join-sign button')].find((e) => e.getClientRects().length); return k && !k.disabled && k.textContent === 'Try again'; }, null, { timeout: 10000 });
  // the connection back: People draws itself as it is (signed out here), nobody presses anything
  down = false;
  await page.evaluate(() => { window.__onLine = true; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => !document.querySelector('.lost-page') && [...document.querySelectorAll('.join-page .join-head')].some((e) => e.getClientRects().length && /Drive with friends|Drive as a crew/.test(e.textContent)), null, { timeout: 10000 });
}, IPHONE);

flow('plan flow (e, f) a level change and an alternative are one tap or swipe each: the level cards are the routes found, nothing planned again (finding 4, 11)', async (page, base) => {
  const asked = [];
  await planRouter(page, asked);
  const { cdp, taps, tap } = await planPage(page, base);
  await tap('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await tap('#placeList .place');
  await cardUp(page); await planDone(page);
  check(await page.evaluate(() => document.querySelectorAll('[data-fun]').length === 3 && !!document.querySelector('#routeCard [data-fun]')), 'the level has one home, the route card');
  const level = () => page.evaluate(() => [...document.querySelectorAll('[data-fun]')].find((b) => b.getAttribute('aria-checked') === 'true').querySelector('b').textContent);
  check(await level() === 'Fun', 'planned at Fun');
  // (the browser's own scroll anchoring off, as CI's Chromium in effect had it: only the app keeps the switch in place)
  await page.addStyleTag({ content: '#planBody { overflow-anchor: none !important; }' });
  // a level change keeps the card's scroll and Start's place, and asks the router nothing
  await page.evaluate(() => { const b = document.getElementById('planBody'); b.scrollTop = Math.min(80, b.scrollHeight - b.clientHeight); });
  // (diagnostics for CI: where the scroller and the sheet are, and how tall the card is)
  const geo = () => page.evaluate(() => { const b = document.getElementById('planBody'), p = document.getElementById('planPanel'), c = document.getElementById('routeCard'), r = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { bodyTop: Math.round(r.top), bodyH: Math.round(r.height), panelTop: Math.round(pr.top), panelH: Math.round(pr.height), panelCls: p.className, cardH: c ? c.scrollHeight : null, bodySH: b.scrollHeight }; });
  const before = await page.evaluate(() => ({ sc: document.getElementById('planBody').scrollTop, y: document.getElementById('routeDriveBtn').getBoundingClientRect().top, n: apexDebug.track.lat.length }));
  const geo0 = await geo();
  const routed = asked.length, t0 = taps.n;
  await page.evaluate(() => document.querySelector('#routeCardFun [data-fun="quick"]').scrollIntoView({ block: 'nearest' }));
  const sc0 = await page.evaluate(() => document.getElementById('planBody').scrollTop);
  const card = (k) => `#routeCardFun [data-fun="${k}"]`;
  const sw0 = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, card('quick'));
  // the Quick card before the tap: the route it says it is, is the route you get
  const quickSays = (await levelCards(page)).find((c) => c.level === 'quick');
  // where the card you tap is the moment the finger lands (CI's sheet can still be settling between the line above and
  // the tap, and the tap itself may scroll it into view): that, not sw0, is where it must stay
  await page.evaluate((sel) => { window.__swTap = null; window.addEventListener('pointerdown', () => { window.__swTap = document.querySelector(sel).getBoundingClientRect().top; }, { capture: true, once: true }); }, card('quick'));
  await tap(card('quick'), 'Quick');
  await page.waitForFunction(() => /^Quick: /.test(document.getElementById('routeProgress').textContent), null, { timeout: 5000 });
  const after = await page.evaluate((sel) => ({ sc: document.getElementById('planBody').scrollTop, y: document.getElementById('routeDriveBtn').getBoundingClientRect().top, n: apexDebug.track.lat.length,
    note: document.getElementById('routeProgress').textContent, busy: document.getElementById('planPanel').classList.contains('busy'),
    max: document.getElementById('planBody').scrollHeight - document.getElementById('planBody').clientHeight, sw: document.querySelector(sel).getBoundingClientRect().top,
    time: document.querySelectorAll('#routeCardStats > div b')[1].textContent, corners: document.querySelectorAll('#routeCardStats > div b')[2].textContent }), card('quick'));
  const quickNow = (await levelCards(page)).find((c) => c.level === 'quick');
  check(quickNow.on && quickNow.checked && quickNow.text === quickSays.text && after.time.replace(/\D/g, '') === quickSays.text.split(' ')[1].replace(/\D/g, '')
    && quickSays.text.toLowerCase().includes(` ${after.corners} corner`), 'the Quick card is on, and the route on the card is the one it said: ' + JSON.stringify({ quickSays, quickNow, after }));
  check(asked.length === routed, `Quick re-ranked the routes already found: the router was asked nothing (${asked.length - routed} requests)`);
  check(/of the \d+ routes found\)$/.test(after.note) && after.n !== before.n, 'the straight road is Quick\'s pick, and the card says why: ' + JSON.stringify(after));
  // the scroll is kept, never back to the top: the switch you tapped stays under your finger (the card above it may be
  // shorter for the new route, and the scroll follows it), and Start doesn't move
  const geo1 = await geo();
  const swTap = await page.evaluate(() => window.__swTap);
  check(Math.abs(after.y - before.y) <= 1 && after.sc > 0 && swTap != null && Math.abs(after.sw - swTap) <= 2, `a level change keeps Start and the scroll where they were, the card you tapped under your finger: ${JSON.stringify({ before, sc0, sw0, swTap, after, geo0, geo1 })}`);
  check(taps.n - t0 === 1, 'a level change is one tap');
  // the same with the card shrinking late: 90 px above the cards go away 400 ms after the level change (as the card's
  // slower parts settle on a slow machine); the card you tapped must still stay under the finger
  await page.evaluate(() => { const f = document.getElementById('routeCardFun'), sp = document.createElement('div'); sp.id = 'lateSpacer'; sp.style.height = '90px'; f.parentNode.insertBefore(sp, f); });
  // (you scroll: the wheel, then the scroll; that ends the last change's hold)
  await page.evaluate(() => { const b = document.getElementById('planBody'); b.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); b.scrollTop = Math.min(160, b.scrollHeight - b.clientHeight); });
  // and the page scrolls the card on its own meanwhile, as CI's did: the hold puts it back
  await page.evaluate(() => setTimeout(() => { document.getElementById('planBody').scrollTop += 40; }, 250));
  const swL0 = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, card('fun'));
  await page.evaluate(() => setTimeout(() => { const sp = document.getElementById('lateSpacer'); if (sp) sp.remove(); }, 400));
  await tap(card('fun'), 'Fun');
  await page.waitForFunction(() => /^Fun: /.test(document.getElementById('routeProgress').textContent) && !document.getElementById('lateSpacer'), null, { timeout: 5000 });
  await page.waitForTimeout(150);
  const swL1 = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, card('fun'));
  check(Math.abs(swL1 - swL0) <= 2, `the card you tapped stays put when the card shrinks late: ${swL0} -> ${swL1}`);
  await tap(card('quick'), 'Quick');
  await page.waitForFunction(() => /^Quick: /.test(document.getElementById('routeProgress').textContent), null, { timeout: 5000 });
  await tap(card('fun'), 'Fun');
  await page.waitForFunction(() => /^Fun: /.test(document.getElementById('routeProgress').textContent), null, { timeout: 5000 });
  check(asked.length === routed, 'and back to Fun, again from what was found');
  // you scroll down to the options (the wheel first, as a hand would): that ends the level change's hold on the scroll
  await page.evaluate(() => document.getElementById('planBody').dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
  // an alternative: one swipe sideways on the card (finding 11) steps through the routes found, the cards' picks in
  // their order; the line under the cards says so. Fun is the last of the two found (Long way wasn't looked at): a swipe
  // to the right goes back to the one before it, Quick's
  const ons = () => page.evaluate(() => [...document.querySelectorAll('#routeCardFun [data-fun]')].map((b) => b.classList.contains('on')).join());
  check(await ons() === 'false,true,false', 'two routes found, Fun\'s on: ' + await ons());
  // page marks under the cards (design pass, 2026-11-10): one per route found, the one on screen inked, the count, and
  // the words for what a swipe does until the first swipe
  const marks = () => page.evaluate(() => { const p = document.getElementById('routeCardPager'), n = document.getElementById('routeCardLevelsNote');
    return { shown: !p.hidden, on: [...p.querySelectorAll('i')].map((i) => +i.classList.contains('on')).join(''), count: p.querySelector('span').textContent.replace(/\s/g, ''),
      words: (p.querySelector('small') || {}).textContent || '', label: p.getAttribute('aria-label'), note: n.hidden ? '' : n.textContent, h: Math.round(p.getBoundingClientRect().height) }; });
  const hint = await marks();
  check(hint.shown && hint.on === '01' && hint.count === '2/2' && hint.words === 'Swipe the card for the next route' && /^Route 2 of 2\. Swipe/.test(hint.label) && !hint.note && hint.h <= 24,
    'the marks under the cards say which route and what a swipe does, on one row: ' + JSON.stringify(hint));
  const box = await page.evaluate(() => { const o = document.getElementById('routeCardStats'); o.scrollIntoView({ block: 'nearest' }); const r = o.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const startY = await page.evaluate(() => document.getElementById('routeDriveBtn').getBoundingClientRect().top);
  await page.evaluate(() => { window.__touches = []; for (const k of ['touchstart', 'touchend']) document.getElementById('routeCard').addEventListener(k, (e) => window.__touches.push(k + ':' + Math.round((e.touches[0] || e.changedTouches[0]).clientX)), { passive: true }); });
  await swipe(cdp, box.x - 100, box.y, 200, 6);
  await page.waitForFunction(() => /^Quick: /.test(document.getElementById('routeProgress').textContent) && document.querySelector('#routeCardFun [data-fun="quick"]').classList.contains('on'), null, { timeout: 8000 })
    .catch(() => page.evaluate(() => ({ t: window.__touches, on: [...document.querySelectorAll('#routeCardFun [data-fun]')].map((x) => x.className), box: document.getElementById('routeCardStats').getBoundingClientRect().toJSON(), busy: document.getElementById('planPanel').className }))
      .then((d) => { throw new Error('a swipe sideways picks the next route: ' + JSON.stringify(d)); }));
  check(asked.length === routed && await level() === 'Quick', 'a swipe picks the other route already found, and its level with it');
  check(Math.abs(await page.evaluate(() => document.getElementById('routeDriveBtn').getBoundingClientRect().top) - startY) <= 1, 'Start doesn\'t move on a swipe');
  const swiped = await marks();
  check(swiped.on === '10' && swiped.count === '1/2' && /^Route 1 of 2\./.test(swiped.label), 'the marks count along: ' + JSON.stringify(swiped));
  check(!swiped.words && !swiped.note, 'once you have swiped, the words go and the marks stay: ' + JSON.stringify(swiped));
  await scan(page, 'the card after a swipe');
}, IPHONE);

// Design pass 4 (2026-11-10): on a phone the looks stand on a shelf you turn sideways, so the Garage is a third shorter and
// the voice picker is on the first screen; signed out, Your cars is an empty bay with the key that gets you signed in.
flow('the Garage on a phone: the looks are a shelf turned sideways (one in view, the next one\'s edge showing), a turn doesn\'t close the sheet; Your cars signed out is an empty bay', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"signed_in":false}' }));
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => window.apexDebug && document.querySelectorAll('#themeCards .theme-card').length === 3 && document.querySelector('.empty-bay')
    && Math.abs(document.getElementById('sheet').getBoundingClientRect().left) < 0.5);   // the sheet has slid in
  const shelf = () => page.evaluate(() => { const c = document.getElementById('themeCards'), b = c.getBoundingClientRect(), body = document.querySelector('.sheet .body');
    const cards = [...c.children].map((k) => { const r = k.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height), name: k.querySelector('.tc-head b').textContent, use: !!k.classList.contains('in-use') }; });
    const call = [...c.querySelectorAll('.tp-call b')].map((x) => Math.round(x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)));
    return { coarse: matchMedia('(hover: none) and (pointer: coarse)').matches, w: innerWidth, box: [Math.round(b.left), Math.round(b.right)], scroll: c.scrollWidth > c.clientWidth, left: Math.round(c.scrollLeft), cards, call,
      wide: body.scrollWidth > body.clientWidth + 1, voiceTop: Math.round(document.getElementById('packSwitch').getBoundingClientRect().top), open: document.getElementById('sheet').classList.contains('open') }; });
  const s0 = await shelf();
  check(s0.coarse && s0.scroll && s0.box[0] === 0 && s0.box[1] === s0.w && !s0.wide, 'the shelf runs edge to edge and the page itself never scrolls sideways: ' + JSON.stringify(s0));
  check(s0.cards[0].use && s0.cards[0].l === 16 && s0.cards[0].r < s0.w && s0.cards[1].l < s0.w - 20 && s0.cards[1].r > s0.w, 'the look in use is in view, the next one\'s edge shows: ' + JSON.stringify(s0.cards));
  check(new Set(s0.cards.map((k) => k.h)).size === 1 && s0.call.every((n) => n === 1), 'the cards are one height and each call is on one line: ' + JSON.stringify([s0.cards, s0.call]));
  check(s0.voiceTop < 852 - 80, 'the voice picker is on the first screen: ' + s0.voiceTop);
  // a turn of the thumb brings the next look, and the sheet stays (a sideways drag elsewhere closes it)
  const cdp = await page.context().newCDPSession(page);
  const y = await page.evaluate(() => { const r = document.querySelector('#themeCards .tc-head').getBoundingClientRect(); return r.top + r.height / 2; });
  await page.waitForFunction((y) => { const e = document.elementFromPoint(300, y); return !!(e && e.closest('#themeCards')); }, y, { timeout: 8000 });   // the splash has lifted
  await swipe(cdp, 300, y, -260, 4);
  await page.waitForFunction(() => { const c = document.getElementById('themeCards'); return c.scrollLeft > 100 && Math.abs(c.children[1].getBoundingClientRect().left - 16) <= 2; }, null, { timeout: 5000 })
    .catch(async () => { throw new Error('a turn of the thumb brings the next look: ' + JSON.stringify(await shelf())); });
  await swipe(cdp, 80, y, 260, 4);
  await page.waitForFunction(() => document.getElementById('themeCards').scrollLeft < 4, null, { timeout: 5000 });
  check((await shelf()).open, 'turning the shelf back to the right does not close the Garage');
  // Use on the second look: it is in use, and the shelf stays where the thumb left it
  await page.evaluate(() => { const c = document.getElementById('themeCards'); c.scrollLeft = c.children[1].offsetLeft - c.children[0].offsetLeft; });
  await page.click('#themeCards .theme-card:nth-child(2) .tc-head .ink-btn');
  await page.waitForFunction(() => /tapedeck/.test(document.documentElement.dataset.theme || ''));
  const s1 = await shelf();
  check(s1.cards[1].l === 16 && s1.left > 100, 'the look you chose stays in view: ' + JSON.stringify(s1.cards));
  // large text keeps the stack: every word of a card whole
  await page.evaluate(() => { document.documentElement.dataset.typeSize = 'large'; });
  const s2 = await shelf();
  check(!s2.scroll && s2.cards.every((k) => k.l >= 0 && k.r <= s2.w), 'large text keeps the stack: ' + JSON.stringify(s2.cards));
  await page.evaluate(() => { delete document.documentElement.dataset.typeSize; });
  // Your cars, signed out: the empty bay and its key, which opens People's sign-in
  const bay = await page.evaluate(() => { const b = document.querySelector('.empty-bay'); b.scrollIntoView(); return { text: b.innerText.replace(/\s+/g, ' '), dashed: getComputedStyle(b.querySelector('.eb-slot')).borderTopStyle, key: Math.round(b.querySelector('.ink-btn').getBoundingClientRect().height) }; });
  check(/^No car parked here yet Sign in to keep your cars/.test(bay.text) && bay.dashed === 'dashed' && bay.key >= 44, 'Your cars signed out is an empty bay: ' + JSON.stringify(bay));
  await page.click('.empty-bay .ink-btn');
  await page.waitForSelector('#accountBody >> text=Sign in with Google', { state: 'visible', timeout: 5000 });
}, { ...IPHONE, isMobile: true });

flow('plan flow (b) a loop in 2 taps: Plan on the map, then Start; its progress in view, its card has a length in your units and no Quick / Fun / Long way (the owner, 2026-11-10)', async (page, base) => {
  await planRouter(page);
  const { taps, tap } = await planPage(page, base);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loopSuggest')).display !== 'none');
  // the suggestion is the dial's loop: pick another length on the dial and it says that one (it kept the length from launch)
  const said = await page.evaluate(() => { const t = () => document.getElementById('loopSuggestTitle').textContent, was = t();
    document.querySelector('#loopDetents button:nth-child(1)').click(); const short = t();
    document.querySelector('#loopDetents button:nth-child(3)').click(); return { was, short, back: t() }; });
  check(said.was === 'Loop from here · 45 mi' && said.short === 'Loop from here · 15 mi' && said.back === said.was, 'the suggestion follows the dial: ' + JSON.stringify(said));
  await tap('#loopSuggestGo', 'Plan (the loop on the map)');
  // never a lone toast: the plan sheet is up with the loop's progress on its key and its status line
  await page.waitForFunction(() => document.getElementById('planPanel').classList.contains('open') && /\S/.test(document.getElementById('planStatus').textContent), null, { timeout: 5000 });
  const progress = await page.evaluate(() => ({ status: document.getElementById('planStatus').textContent, key: document.getElementById('findLoopBtn').textContent, toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '' }));
  check(!/Finding roads ·/.test(progress.toast), 'the loop\'s progress is inline, not a toast: ' + JSON.stringify(progress));
  await cardUp(page, 30000); await planDone(page, 30000);
  const card = await page.evaluate(() => ({ name: apexDebug.track.name, lengths: [...document.querySelectorAll('#cardLoopDetents button')].map((b) => b.textContent), lengthShown: !document.getElementById('routeCardLoop').hidden,
    level: !document.getElementById('routeCardFun').hidden, dial: [...document.querySelectorAll('#loopDetents button')].map((b) => b.textContent), note: document.getElementById('routeProgress').textContent }));
  // a loop is aimless driving: its card has its length, and no route style (the owner, 2026-11-10)
  check(/loop$/.test(card.name) && card.lengthShown && !card.level, 'the loop\'s card: its length, no Quick / Fun / Long way: ' + JSON.stringify(card));
  const seen = await page.evaluate(() => [...document.querySelectorAll('#routeCard *')].filter((e) => e.getClientRects().length && !e.children.length && /^(Quick|Fun|Long way)$/.test(e.textContent.trim())).map((e) => e.textContent));
  check(!seen.length, 'no level is shown anywhere on a loop\'s card: ' + JSON.stringify(seen));
  // one loop found here (the circle): nothing to choose between, so no "which way" cards
  const ways = await page.evaluate(() => ({ hidden: document.getElementById('routeCardWays').hidden, n: document.querySelectorAll('#routeCardWays [data-way]').length }));
  check(ways.hidden && ways.n === 0, 'one loop found: no cards to choose from: ' + JSON.stringify(ways));
  check(JSON.stringify(card.lengths) === '["15 mi","30 mi","45 mi","60 mi","90 mi"]' && JSON.stringify(card.dial) === JSON.stringify(card.lengths), 'one unit, yours, on the dial and the card: ' + JSON.stringify(card));
  check(/loop/.test(card.note), 'the card says what the loop search found: ' + card.note);
  await scan(page, 'the loop card');
  await tap('#routeDriveBtn', 'Start');
  await page.waitForFunction(() => window.apexDebug.driveActive && apexDebug.track && /loop$/.test(apexDebug.track.name), null, { timeout: 10000 });
  check(taps.n === 2, `a loop in 2 taps: ${taps.log.join(' → ')}`);
}, IPHONE);

flow('a loop by time: the dial turns to Time (half an hour to three hours), Find a loop builds a loop of that time, and its card changes it by time (2026-11-10)', async (page, base) => {
  await planRouter(page);
  await planPage(page, base);
  await page.click('#destInput');
  await page.waitForFunction(() => document.getElementById('planPanel').classList.contains('open') && document.getElementById('loopBy').getClientRects().length > 0);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); const st = document.querySelector('.stage'); if (st) st.scrollLeft = 0; });
  const dial = () => page.evaluate(() => ({ by: [...document.querySelectorAll('#loopBy [aria-checked="true"]')].map((b) => b.textContent), keys: [...document.querySelectorAll('#loopDetents button')].map((b) => b.textContent),
    on: (document.querySelector('#loopDetents [aria-pressed="true"]') || {}).textContent, face: document.getElementById('loopDialVal').textContent + ' ' + document.getElementById('loopDialUnit').textContent,
    tall: [...document.querySelectorAll('#loopBy button')].map((b) => Math.round(b.getBoundingClientRect().height)), saved: localStorage.getItem('apex.loopBy') }));
  const d0 = await dial();
  check(d0.by.join() === 'Distance' && d0.on === '45 mi' && d0.face === '45 mi' && d0.tall.every((h) => h >= 44), 'the dial starts on distance, its two words a thumb tall: ' + JSON.stringify(d0));
  await page.click('#loopBy [data-loop-by="time"]');
  const d1 = await dial();
  check(d1.by.join() === 'Time' && d1.keys.join('|') === '30 min|1 h|1½ h|2 h|3 h' && d1.on === '1½ h' && d1.face === '1½ h' && d1.saved === 'time', 'turned to time: its five times, the detent kept its place, the face says it: ' + JSON.stringify(d1));
  const fits = await page.evaluate(() => { const st = document.querySelector('.stage'); if (st) st.scrollLeft = 0;   // (headless Chromium scrolls the stage sideways on a click into Where to?)
    return [...document.querySelectorAll('#loopDetents button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 1; }).map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.left), Math.round(r.right), b.scrollHeight, b.clientHeight, b.scrollWidth, b.clientWidth]; }); });
  check(!fits.length, 'every time on the dial is whole: ' + JSON.stringify(fits));
  await page.click('#loopDetents button:nth-child(2)');                 // 1 h
  await page.click('#findLoopBtn');
  await cardUp(page, 30000); await planDone(page, 30000);
  const card = await page.evaluate(() => ({ name: apexDebug.track.name, label: document.querySelector('#routeCardLoop .rc-loop-label').textContent, aria: document.getElementById('routeCardLoop').getAttribute('aria-label'),
    keys: [...document.querySelectorAll('#cardLoopDetents button')].map((b) => b.textContent), on: [...document.querySelectorAll('#cardLoopDetents [aria-pressed="true"]')].map((b) => b.textContent),
    note: document.getElementById('routeProgress').textContent, levels: !document.getElementById('routeCardFun').hidden }));
  check(/^\d+ min loop$/.test(card.name) && !card.levels, 'a loop named by its own time, no level: ' + JSON.stringify(card));
  check(card.label === 'Time' && card.aria === 'Loop time' && card.keys.join('|') === '30 min|1 h|1½ h|2 h|3 h' && card.on.join() === '1 h', 'its card changes it by time, the hour you asked for on: ' + JSON.stringify(card));
  check(!/\d\.\d h|0\.5 h/.test(card.note), 'the note never says "1.5 h": ' + card.note);
  await scan(page, 'the time loop\'s card');
  // back to distance on the card's own row is one tap on the dial's word next time: the choice is kept across a reload
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot'), null, { timeout: 20000 });
  const d2 = await dial();
  check(d2.by.join() === 'Time' && d2.on === '1 h', 'the dial opens as you left it: ' + JSON.stringify(d2));
  await page.evaluate(() => document.querySelector('#loopBy [data-loop-by="distance"]').click());
  const d3 = await dial();
  check(d3.by.join() === 'Distance' && d3.keys.join('|') === '15 mi|30 mi|45 mi|60 mi|90 mi' && d3.face === '30 mi', 'and turns back to distance: ' + JSON.stringify(d3));
}, IPHONE);

flow('level cards: one control on the four phone shapes, a destination: each card its level, time and corners, a line each, nothing cut or under the island (the owner, 2026-11-04); a loop has none', async (page, base) => {
  await planRouter(page);
  const { cdp } = await planPage(page, base);
  // every card inside the screen and its row, its name, time and corners each on one line (no "11 min / quicker ·")
  const fit = () => page.evaluate(() => {
    const out = [], row = document.getElementById('routeCardFun').getBoundingClientRect();
    for (const b of document.querySelectorAll('#routeCardFun [data-fun]')) {
      const r = b.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.right > row.right + 0.5) out.push(`${b.dataset.fun} off its row: ${Math.round(r.left)}-${Math.round(r.right)}`);
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.dataset.fun} cut: ${b.scrollWidth}/${b.clientWidth}`);
      for (const e of b.querySelectorAll(b.classList.contains('further') ? 'b' : 'b, .rc-lv > i')) {
        const er = e.getBoundingClientRect(), fs = parseFloat(getComputedStyle(e).fontSize);
        if (er.height > fs * 1.6) out.push(`${b.dataset.fun} wraps: "${e.textContent}" ${Math.round(er.height)} px at ${fs} px`);
        if (er.right > r.right + 0.5) out.push(`${b.dataset.fun} spills: "${e.textContent}"`);
      }
    }
    return out; });
  const shapes = async (kind) => {
    for (const [orient, d] of Object.entries(SAFE)) {
      await page.setViewportSize({ width: d.w, height: d.h });
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.i });
      await page.waitForTimeout(500);
      await page.evaluate(() => { document.querySelector('.stage') && (document.querySelector('.stage').scrollLeft = 0); document.getElementById('routeCardFun').scrollIntoView({ block: 'nearest' }); });
      await page.waitForTimeout(200);
      const bad = await fit();
      check(!bad.length, `${kind}, ${orient}: the level cards read at a glance: ${JSON.stringify(bad)}`);
      const under = (await unsafe(page, d)).filter((b) => /Quick|Fun|Long way|corners|Swipe/i.test(b));
      check(!under.length, `${kind}, ${orient}: the level cards clear the island, the home bar and the corners:\n  ${under.join('\n  ')}`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/level-cards-${kind}-${orient.replace(/\W+/g, '-')}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
    await page.waitForTimeout(400);
  };
  // a destination: Quick and Fun found, Long way not looked at
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await page.setViewportSize({ width: 390, height: 844 });
  await cardUp(page); await planDone(page); await page.waitForTimeout(600);
  if (process.env.SHOTS) { require('fs').mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.SHOTS}/destination-card.png` }); }
  await shapes('destination');
  // a loop: every level looked at
  await page.evaluate(() => sessionStorage.clear());                    // (the planned route would come back on the reload)
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.apex && !document.getElementById('boot'), null, { timeout: 20000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loopSuggest')).display !== 'none', null, { timeout: 10000 });
  await page.click('#loopSuggestGo');
  await cardUp(page, 30000); await planDone(page, 30000); await page.waitForTimeout(600);
  check(await page.evaluate(() => document.getElementById('routeCardFun').hidden && !document.getElementById('routeCardLoop').hidden), 'a loop\'s card has its length and no level cards');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/loop-card.png` });
  for (const [orient, d] of Object.entries(SAFE)) {
    await page.setViewportSize({ width: d.w, height: d.h });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.i });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.querySelector('.stage') && (document.querySelector('.stage').scrollLeft = 0); document.getElementById('routeCardLoop').scrollIntoView({ block: 'nearest' }); });
    await page.waitForTimeout(200);
    const under = (await unsafe(page, d)).filter((b) => /\d+ mi\b|Length/i.test(b));
    check(!under.length, `loop, ${orient}: the loop's length clears the island, the home bar and the corners:\n  ${under.join('\n  ')}`);
  }
}, IPHONE);

flow('a loop\'s choices are which way to head, not Quick / Fun / Long way: the loops found as cards, each its outline, way, time and corners; a tap puts that loop up (the owner, 2026-11-10)', async (page, base) => {
  graphDir = graphFixture(true);
  try {
    await page.route('https://valhalla1.openstreetmap.de/**', (route) => route.abort());   // our tiles alone
    // a destination's level left on Quick: a loop takes no notice of it
    await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); localStorage.setItem('apex.funLevel', 'quick'); } catch (_) {} });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.apexDebug && window.apexDebug.map && window.ApexStages && !document.getElementById('boot'), null, { timeout: 20000 });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#loopDetents [data-loop-mi]')][0]; b.click(); document.getElementById('findLoopBtn').click(); });
    await page.waitForFunction(() => Array.isArray(window.apexDebug.lastLoop) && !document.getElementById('planPanel').classList.contains('busy'), null, { timeout: 60000 });
    await cardUp(page, 30000); await page.waitForTimeout(600);
    const read = () => page.evaluate(() => {
      const box = document.getElementById('routeCardWays'), row = box.getBoundingClientRect(), t = apexDebug.track;
      return { hidden: box.hidden, levels: !document.getElementById('routeCardFun').hidden, pager: !document.getElementById('routeCardPager').hidden, name: t && t.name, km: t && t.dist ? Math.round(t.dist[t.dist.length - 1]) : null,
        won: (apexDebug.lastLoop.find((d) => d.picked) || {}).hwyShare,
        cards: [...box.querySelectorAll('[data-way]')].map((b) => { const r = b.getBoundingClientRect(), p = b.querySelector('svg path'), a = b.querySelector('svg');
          return { text: b.innerText.replace(/\s+/g, ' ').trim(), on: b.classList.contains('on'), checked: b.getAttribute('aria-checked') === 'true', label: b.getAttribute('aria-label'),
            line: p ? p.getAttribute('d').split('L').length : 0, art: a ? Math.round(a.getBoundingClientRect().width) : 0,
            fits: r.left >= row.left - 0.5 && r.right <= row.right + 0.5 && r.right <= innerWidth && b.scrollWidth <= b.clientWidth + 1, h: Math.round(r.height) }; }) }; });
    const a = await read();
    check(!a.levels, 'no Quick / Fun / Long way on a loop: ' + JSON.stringify(a));
    check(a.won === 0, 'with the level left on Quick, the loop still keeps off the motorway: a loop has one style: ' + a.won);
    check(!a.hidden && a.cards.length >= 2 && a.cards.length <= 3, 'the loops found are the choices, two or three of them: ' + JSON.stringify(a.cards));
    const WAY = /^(North|Northeast|East|Southeast|South|Southwest|West|Northwest|Around here) (\d+:\d\d|\d+ min) \d+ corners?$/i;
    check(a.cards.every((c) => WAY.test(c.text)), 'each card: the way it heads, its time and its corners: ' + JSON.stringify(a.cards.map((c) => c.text)));
    // two cards that head the same way are a choice only when they are a different drive (a fifth longer or shorter)
    const mins = (c) => { const m = /(\d+):(\d\d)|(\d+) min/.exec(c.text); return m[3] ? +m[3] : 60 * +m[1] + +m[2]; }, way = (c) => c.text.replace(/ (\d+:\d\d|\d+ min) .*$/, '');
    const twins = a.cards.flatMap((c, i) => a.cards.slice(i + 1).filter((d) => way(d) === way(c) && Math.abs(mins(c) - mins(d)) / Math.max(mins(c), mins(d)) < 0.15).map((d) => [c.text, d.text]));
    check(!twins.length, 'no two cards are the same way and near the same time: ' + JSON.stringify(twins));
    check(a.cards.every((c) => c.line >= 8 && c.art >= 30), 'each card draws its own loop: ' + JSON.stringify(a.cards.map((c) => [c.line, c.art])));
    check(a.cards.every((c) => /^Loop (to the \w+|around here): /.test(c.label)), 'each card says what it is aloud: ' + JSON.stringify(a.cards.map((c) => c.label)));
    check(a.cards[0].on && a.cards[0].checked && a.cards.filter((c) => c.on).length === 1, 'the loop on the map is the card that is on, the best first: ' + JSON.stringify(a.cards.map((c) => c.on)));
    check(a.cards.every((c) => c.fits), 'every card inside its row, nothing cut: ' + JSON.stringify(a.cards));
    check(!a.pager, 'the cards are the choices: no page marks beside them');
    const bad = await unsafe(page, SAFE.portrait);
    check(!bad.length, `the loop's card: under the island, the home bar or a corner, or keys on keys:\n  ${bad.join('\n  ')}`);
    if (process.env.SHOTS) { require('fs').mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.SHOTS}/loop-ways.png` }); }
    // a tap on another way: that loop goes up, its card on; nothing is planned again (the network is off)
    const wasShape = await page.evaluate(() => apexDebug.track.lat.length + ':' + apexDebug.track.lat[Math.floor(apexDebug.track.lat.length / 2)]);
    await page.click('#routeCardWays [data-way="1"]');
    await page.waitForFunction((was) => apexDebug.track && apexDebug.track.lat.length + ':' + apexDebug.track.lat[Math.floor(apexDebug.track.lat.length / 2)] !== was
      && document.querySelector('#routeCardWays [data-way="1"]') && document.querySelector('#routeCardWays [data-way="1"]').classList.contains('on'), wasShape, { timeout: 10000 });
    const b = await read();
    check(/loop$/.test(b.name) && b.cards[1].on && !b.cards[0].on && b.cards.length === a.cards.length, 'the other loop is up and its card is on: ' + JSON.stringify(b.cards.map((c) => c.on)));
    check(JSON.stringify(b.cards.map((c) => c.text)) === JSON.stringify(a.cards.map((c) => c.text)), 'the cards keep their places and their numbers: ' + JSON.stringify([a.cards.map((c) => c.text), b.cards.map((c) => c.text)]));
    if (process.env.SHOTS) { await page.evaluate(() => document.getElementById('routeCardWays').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); await page.screenshot({ path: `${process.env.SHOTS}/loop-ways-2.png` }); }
    // at the largest text the cards stack, each still whole
    await page.evaluate(TYPE_AT(2));
    await page.waitForTimeout(300);
    const big = await read();
    check(big.cards.every((c) => c.fits), 'at the largest text every card is still whole: ' + JSON.stringify(big.cards));
  } finally { graphDir = null; }
}, { ...IPHONE, geolocation: { latitude: 39.205, longitude: -84.55 }, permissions: ['geolocation'] });

flow('the map\'s viewpoint, café and fuel stamps along a route never pile up: overlapping ones hide, the most useful few kept (the owner, 2026-11-04)', async (page, base) => {
  await planRouter(page);
  await planPage(page, base);
  // a fuel station at every km of the route (a pile at the whole route's zoom), a café and a named viewpoint mid-way
  await page.evaluate(() => { ApexStages.pois = async (pts) => { const mid = pts[Math.floor(pts.length / 2)];
    return [...pts.map((p) => ({ kind: 'fuel', name: null, lat: p.lat, lon: p.lon })), { kind: 'cafe', name: 'Bean', lat: mid.lat, lon: mid.lon }, { kind: 'view', name: 'Big Overlook', lat: mid.lat, lon: mid.lon }]; }; });
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await cardUp(page); await planDone(page);
  await page.waitForFunction(() => document.querySelectorAll('.poi-pin.poi-fuel').length >= 10, null, { timeout: 10000 });
  await page.evaluate(() => apexDebug.map.fitBounds([[Math.min(...apexDebug.track.lon), Math.min(...apexDebug.track.lat)], [Math.max(...apexDebug.track.lon), Math.max(...apexDebug.track.lat)]], { padding: 20, duration: 0 }));
  const shown = () => page.evaluate(() => { const W = innerWidth, H = innerHeight;
    return [...document.querySelectorAll('.poi-pin')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none')
      .map((e) => ({ kind: ['fuel', 'cafe', 'view'].find((k) => e.classList.contains('poi-' + k)), text: e.textContent, r: e.getBoundingClientRect().toJSON() })).filter((p) => p.r.right > 0 && p.r.left < W && p.r.bottom > 0 && p.r.top < H); });
  await page.waitForTimeout(300);
  const far = await shown();
  const overlap = (a, b) => a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom;
  const pairs = far.flatMap((a, i) => far.slice(i + 1).filter((b) => overlap(a, b)).map((b) => `${a.text} / ${b.text}`));
  const total = await page.evaluate(() => document.querySelectorAll('.poi-pin.poi-fuel').length);
  check(!pairs.length, 'no two stamps overlap: ' + JSON.stringify(pairs));
  check(far.filter((p) => p.kind === 'fuel').length <= 4 && far.filter((p) => p.kind === 'fuel').length >= 1 && far.some((p) => p.text === 'Big Overlook'),
    `the most useful few: the viewpoint, at most four of the ${total} fuel stamps: ` + JSON.stringify(far.map((p) => p.text)));
  // closer in, the stamps that were hidden come back where there is room
  await page.evaluate(() => apexDebug.map.jumpTo({ center: [apexDebug.track.lon[0], apexDebug.track.lat[0]], zoom: 15 }));
  await page.waitForTimeout(300);
  const near = await shown();
  check(near.some((p) => p.kind === 'fuel'), 'zoomed in, a fuel stamp hidden at the whole route\'s zoom is shown: ' + JSON.stringify(near.map((p) => p.text)));
}, IPHONE);

flow('plan flow (c) best roads nearby in 3 taps: the chip under Where to?, a road in a list with named columns, Start (finding 7)', async (page, base) => {
  await planRouter(page);
  const { taps, tap } = await planPage(page, base);
  // the tiles are blocked here: the roads come from a stand-in for the map's stage finder, near the phone
  await page.evaluate(() => {
    const road = (name, lat, lon, n, good) => { const la = [], lo = []; for (let i = 0; i < n; i++) { la.push(lat + i * 0.0004); lo.push(lon + Math.sin(i / 6) * 0.0006); } return { name, lat: la, lon: lo, km: n * 0.045, good, tight: 2, score: good }; };
    ApexStages.discover = async (c, km, progress) => { if (progress) progress('tiles', 1);
      window.__keyBusy = [...document.querySelectorAll('#nearbySheet [data-explore-min]')].map((b) => b.textContent.trim());   // the keys' words while the search runs
      return [road('Test Ridge Road', c.lat + 0.02, c.lon + 0.01, 80, 14), road('Hollow Creek Road', c.lat - 0.03, c.lon + 0.02, 60, 9)]; };
  });
  check(await page.isVisible('#deckNearby'), 'Best roads nearby is a chip under Where to?');
  await tap('#deckNearby', 'Best roads nearby');
  await page.waitForSelector('#nearbySheet.open #exploreList .nb-go', { timeout: 15000 });
  await page.waitForTimeout(300);
  const list = await page.evaluate(() => ({ head: [...document.querySelectorAll('#exploreList .nb-head .nb-cells > span')].map((s) => s.textContent),
    row: [...document.querySelectorAll('#exploreList .nb-row')[0].querySelectorAll('.nb-cells > *')].map((s) => s.textContent), label: document.querySelector('#exploreList .nb-go').getAttribute('aria-label'),
    status: document.getElementById('nearbyStatus').textContent, sheetBottom: document.getElementById('nearbySheet').getBoundingClientRect().bottom }));
  check(JSON.stringify(list.head) === '["Road","Good corners","Length","Drive there"]', 'the columns are named: ' + JSON.stringify(list));
  check(list.row[0] === 'Test Ridge Road' && /^\d+$/.test(list.row[1]) && /^\d+(\.\d)?mi$/.test(list.row[2]) && /^\d+min$/.test(list.row[3]) && /good corners/.test(list.label), 'each number under its name, with its unit: ' + JSON.stringify(list));
  check(Math.abs(list.sheetBottom - 852) <= 1, 'the list slides up from the bottom: ' + list.sheetBottom);
  await scan(page, 'Best roads nearby');
  await tap('#exploreList .nb-go', 'the road');
  await cardUp(page);
  check(await page.waitForFunction(() => { const n = document.getElementById('nearbySheet'); return !n.classList.contains('open') && getComputedStyle(n).visibility === 'hidden'; }, null, { timeout: 2000 }).then(() => true, () => false),
    'the list goes when its road is planned (its slide down done)');
  // the key you chose keeps its word while it works, and a count of one is "1 corner" (it read "1 corners", three times over)
  const words = await page.evaluate(() => ({ keys: window.__keyBusy, n: apexDebug.track.events.filter((e) => e.type === 'corner').length, card: (document.getElementById('routeCard').innerText + ' ' + document.getElementById('routeBarMeta').textContent).replace(/\s+/g, ' '),
    stat: [...document.querySelectorAll('#routeCardStats > div')].map((d) => d.innerText.replace(/\s+/g, ' ').trim().toLowerCase()).pop() }));
  check(JSON.stringify(words.keys) === '["Within 15 min","Within 30 min"]', 'the search keeps the keys\' words: ' + JSON.stringify(words.keys));
  check(!/\b1 corners\b/i.test(words.card) && (words.n !== 1 || (/\b1 corner\b/i.test(words.card) && words.stat === '1 corner')), 'one corner is "1 corner": ' + JSON.stringify({ n: words.n, stat: words.stat }));
  await tap('#routeDriveBtn', 'Start');
  await page.waitForFunction(() => window.apexDebug.driveActive && apexDebug.track && apexDebug.track.id === 'explore', null, { timeout: 10000 });
  check(taps.n === 3, `best roads nearby in 3 taps: ${taps.log.join(' → ')}`);
}, IPHONE);

flow('plan flow (d) one Options sheet: Avoid ✕ and Prefer ✓ in it, what is on stays in view as chips on the sheet and the card, it swipes down to close (finding 4, 5)', async (page, base) => {
  const asked = [];
  await planRouter(page, asked);
  const { cdp } = await planPage(page, base, { 'apex.avoid': JSON.stringify({ unpaved: false }) });
  await page.click('#destInput');
  check(await page.evaluate(() => document.getElementById('planOptsOn').children.length === 0 && document.getElementById('planOptionsChip').textContent === 'Options'), 'nothing on: just Options');
  await page.click('#planOptionsChip');
  await page.waitForFunction(() => { const s = document.getElementById('optSheet'); return s.classList.contains('open') && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 2; });
  await page.waitForTimeout(300);
  const groups = await page.evaluate(() => [...document.querySelectorAll('#optSheet .ctl-label')].filter((l) => l.offsetParent).map((l) => l.firstChild.textContent.trim()));
  // (Loop to fit is the app's: My free time and This album. An hour or two is the dial's own, so a browser has no such group)
  check(JSON.stringify(groups) === '["Avoid","Prefer","Kinds of corners","Start from","Presets"]' && !(await page.$('#optSheet [data-loop-min]')), 'one sheet, in that order, with no second home for a loop by time: ' + JSON.stringify(groups));
  await scan(page, 'Options');
  await page.click('[data-avoid="highways"]');
  await page.click('[data-driver="passenger"]');
  await page.click('[data-pref-tight="1"]');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('[data-avoid="highways"]'), '::before').content.includes('✕') && getComputedStyle(document.querySelector('[data-driver="passenger"]'), '::before').content.includes('✓')), 'avoided reads ✕, preferred ✓');
  // a swipe down from the sheet's top closes it (the owner's rule: sheets swipe down to close)
  const top = await page.evaluate(() => document.getElementById('optSheet').getBoundingClientRect().top + 20);
  await swipe(cdp, 196, top, 0, 220);
  await page.waitForFunction(() => !document.getElementById('optSheet').classList.contains('open'), null, { timeout: 3000 });
  const chips = await page.evaluate(() => ({ sheet: [...document.querySelectorAll('#planOptsOn .chip')].map((c) => c.textContent), key: document.getElementById('planOptionsChip').textContent }));
  check(JSON.stringify(chips.sheet) === '["✕ Highways","✓ Passenger aboard","More hairpins"]' && chips.key === 'Options · 3', 'what is on shows on the plan sheet once Options closes: ' + JSON.stringify(chips));
  // the route planned with them shows them on its card; a chip opens the sheet again; closing with nothing changed plans nothing
  await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await cardUp(page); await planDone(page);
  const card = await page.evaluate(() => [...document.querySelectorAll('#cardOptsOn .chip')].map((c) => c.textContent));
  check(JSON.stringify(card) === JSON.stringify(chips.sheet), 'and on the route card: ' + JSON.stringify(card));
  check(asked.some((r) => r.costing_options && JSON.stringify(r.costing_options).includes('"use_highways":0')), 'the plan avoided highways');
  const n = asked.length;
  await page.click('#cardOptsOn .chip');
  await page.waitForFunction(() => document.getElementById('optSheet').classList.contains('open'));
  await page.click('#optDone');
  await page.waitForTimeout(500);
  check(asked.length === n && !(await page.evaluate(() => document.getElementById('planPanel').classList.contains('busy'))), 'nothing changed: nothing planned again');
  // one change, then Done: the route on the card is planned again once, with it
  await page.click('#cardOptionsChip');
  await page.waitForFunction(() => document.getElementById('optSheet').classList.contains('open'));
  await page.click('[data-avoid="highways"]');
  await page.click('#optDone');
  await page.waitForFunction(() => /^With your options/.test(document.getElementById('routeProgress').textContent) || /Checked/.test(document.getElementById('routeProgress').textContent), null, { timeout: 20000 });
  check(asked.length > n && await page.evaluate(() => [...document.querySelectorAll('#cardOptsOn .chip')].map((c) => c.textContent).join()) === '✓ Passenger aboard,More hairpins', 'planned again with the change, the chips with it');
  await scan(page, 'the card with its options');
}, IPHONE);

flow('plan flow (g) one name for go: Start on the card and the bar, Just drive with no route (a smaller key), Fly-through for the preview (finding 8, 9)', async (page, base) => {
  await planRouter(page);
  const { taps, tap } = await planPage(page, base);
  const idle = await page.evaluate(() => { const k = document.getElementById('startDrive'), r = k.getBoundingClientRect(), cs = getComputedStyle(k);
    return { text: k.textContent.trim(), w: r.width, bg: cs.backgroundColor, label: k.getAttribute('aria-label') }; });
  // Vetta Line (signature.css): with no route, Just drive is the screen's one red key (the app's first verb is to drive);
  // it stays the shorter word and the narrower key than the card's Start, and says it records with no route
  const red = await page.evaluate(() => { const c = document.createElement('i'); c.style.color = 'var(--accent)'; document.body.append(c); const v = getComputedStyle(c).color; c.remove(); return v; });
  check(idle.text === 'Just drive' && idle.bg === red && idle.w < 150 && /no route/.test(idle.label), 'with no route the bar\'s key is Just drive, in red, narrower than Start: ' + JSON.stringify({ idle, red }));
  await page.click('#startMore');
  const sheet = await page.evaluate(() => [...document.querySelectorAll('.start-sheet button')].map((b) => b.textContent.trim()));
  check(sheet[0] === 'Just drive' && !sheet.includes('Drive'), 'the start sheet says Just drive too: ' + JSON.stringify(sheet));
  await page.click('.start-sheet .linkbtn');
  await page.click('#destInput'); await page.fill('#destInput', 'Maryville');
  await page.waitForSelector('#placeList .place', { timeout: 10000 });
  await page.click('#placeList .place');
  await cardUp(page); await planDone(page);
  const keys = await page.evaluate(() => [...document.querySelectorAll('#planPanel button')].filter((b) => b.offsetParent && /^(Start|Fly-through|Drive it|Preview|Drive)$/.test(b.textContent.trim())).map((b) => b.textContent.trim()));
  check(JSON.stringify(keys) === '["Start","Fly-through"]', 'the card: Start and Fly-through: ' + JSON.stringify(keys));
  await page.click('#routeBar');                                      // down to the bar: its key is the route's Start
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.getElementById('startDrive').textContent.trim()) === 'Start', 'the bar\'s key with a route reads Start');
  await page.click('#routeBar'); await cardUp(page);
  await page.click('#routePreviewBtn');
  await page.waitForFunction(() => /^Fly-through/.test(document.getElementById('modePlate').textContent), null, { timeout: 5000 })
    .catch(() => page.evaluate(() => document.getElementById('modePlate').textContent).then((t) => { throw new Error('the preview is called Fly-through: ' + t); }));
  await page.click('#replayDone');
  // a free drive: one tap
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('replaying') && getComputedStyle(document.getElementById('planPanel')).display !== 'none', null, { timeout: 5000 });
  if (await page.evaluate(() => document.getElementById('planPanel').classList.contains('open'))) await page.click('#planCancel');   // the card down to its bar
  await page.waitForFunction(() => getComputedStyle(document.getElementById('planClear')).display !== 'none', null, { timeout: 5000 })
    .catch(() => page.evaluate(() => [document.getElementById('planPanel').className, document.getElementById('app').className]).then((t) => { throw new Error('the bar\'s ✕: ' + JSON.stringify(t)); }));
  await page.click('#planClear');
  await page.waitForFunction(() => document.getElementById('startDrive').textContent.trim() === 'Just drive' && getComputedStyle(document.getElementById('startDrive')).display !== 'none', null, { timeout: 5000 })
    .catch(() => page.evaluate(() => [document.getElementById('startDrive').textContent, getComputedStyle(document.getElementById('startDrive')).display, document.getElementById('planPanel').className]).then((t) => { throw new Error('Just drive again once the route is cleared: ' + JSON.stringify(t)); }));
  await tap('#startDrive', 'Just drive');
  await page.waitForFunction(() => window.apexDebug.driveActive, null, { timeout: 10000 });
  check(taps.n === 1, 'a free drive is one tap');
}, IPHONE);

// Vetta Line (web/signature.css): the idle map's home. The place is a masthead set in type (no box), the deck's invitations
// stand side by side on one shelf of cards with Best roads nearby last, Just drive is the one red key, and nothing on the
// shelf is cut or under the tab bar. Under reduced motion nothing is left mid-arrival.
flow('Vetta Line home: a masthead, one shelf of road cards, Just drive the one red key, still under reduced motion', async (page, base) => {
  await page.route(base + '/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ address: { town: 'Tellico Plains' } }) }));
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 16, weather_code: 1, precipitation: 0 }, hourly: { time: [new Date(Date.now() - 3600e3).toISOString().slice(0, 13) + ':00'], precipitation: [0] } }) }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await planPage(page, base);
  await page.evaluate(() => { apexDebug.state.lastPosition = apexDebug.state.lastPosition || { lat: 35.36, lon: -84.29 }; return apexDebug.placePlate(); });
  await page.waitForFunction(() => { const p = document.getElementById('placePlate'); return p && !p.hidden && p.querySelector('b'); }, null, { timeout: 15000 })
    .catch(() => page.evaluate(() => [document.getElementById('placePlate').outerHTML, JSON.stringify(apexDebug.state.lastPosition), document.getElementById('app').className]).then((t) => { throw new Error('no masthead: ' + JSON.stringify(t)); }));
  const d = await page.evaluate(() => {
    const pp = document.getElementById('placePlate'), cs = getComputedStyle(pp), b = pp.querySelector('b'), sp = pp.querySelector('span');
    const shelf = document.getElementById('deckShelf'), tabs = document.getElementById('tabbar').getBoundingClientRect();
    const cards = [...shelf.querySelectorAll('.loop-suggest, #deckChips .chip')].filter((e) => e.getBoundingClientRect().width > 0).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
    const reds = [...document.querySelectorAll('#planBar button')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace(/^#(..)(..)(..)$/, (_, r, g, b2) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b2, 16)})`));
    const anim = [...document.querySelectorAll('#planBar, #deckShelf > *, #placePlate *')].map((e) => getComputedStyle(e)).filter((c) => c.animationName !== 'none' || +c.opacity < 1).length;
    return { text: pp.textContent, head: b && b.textContent, rest: sp && sp.textContent, border: cs.borderTopStyle, bg: cs.backgroundColor, headPx: parseFloat(getComputedStyle(b).fontSize),
      flex: getComputedStyle(shelf).display, ys: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))], last: cards.length && cards[cards.length - 1].id, n: cards.length,
      clear: cards.every((c) => c.getBoundingClientRect().bottom <= tabs.top), reds: reds.map((e) => e.id), anim };
  });
  check(d.text === 'Tellico Plains · Dry · 61°' && d.head === 'Tellico Plains' && d.rest === 'Dry · 61°', 'the masthead reads as the plate did: ' + JSON.stringify(d));
  check(d.border === 'none' && d.bg === 'rgba(0, 0, 0, 0)' && d.headPx >= 28, 'the place is type on the map, not a box: ' + JSON.stringify(d));
  check(d.flex === 'flex' && d.n >= 2 && d.ys.length === 1 && d.last === 'deckNearby' && d.clear, 'one shelf of cards, Best roads nearby last, above the tabs: ' + JSON.stringify(d));
  check(d.reds.length === 2 && d.reds.includes('startDrive'), 'Just drive (and its chevron) is the one red key: ' + JSON.stringify(d));
  check(d.anim === 0, 'reduced motion: nothing is left arriving: ' + JSON.stringify(d));
  const bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the home:\n  ' + bad.join('\n  '));
}, IPHONE);

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
    ['plan sheet', '/index.html', 'document.getElementById("destInput").focus();'],
    ['Options sheet', '/index.html', 'document.getElementById("destInput").focus(); document.getElementById("planOptionsChip").click();'],
    ['Best roads nearby', '/index.html', 'document.getElementById("deckNearby").click();'],
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

// ---- the owner's TestFlight notes of 2026-11-05 (build 592.1): each at iPhone geometry and the four safe-area shapes ----
const T1105 = { at: (min) => new Date(Date.now() - min * 60e3).toISOString().replace('T', ' ').slice(0, 19), soon: new Date(Date.now() + 3 * 86400e3).toISOString() };
// the owner's crews (VETTA and test, both his), and two he's in; `n` more to fill up to the 10 a person can be in
function crewsStub(page, { n = 0, sent = [], feed = true } = {}) {
  const crews = [{ id: 'k1', name: 'VETTA', role: 'owner', visibility: 'public', area_name: 'Cincinnati, OH', members: 1 },
    { id: 'k2', name: 'test', role: 'owner', visibility: 'private', members: 1 },
    { id: 'k3', name: 'Ridge Runners', role: 'member', visibility: 'private', members: 7 },
    { id: 'k4', name: 'Blue Ridge Breakfast Club', role: 'member', visibility: 'public', area_name: 'Asheville', members: 23 },
    ...Array.from({ length: n }, (_, i) => ({ id: 'x' + i, name: `Sunday Crew ${i + 1}`, role: 'member', visibility: 'private', members: 3 + i }))];
  const page0 = (c) => ({ id: c.id, name: c.name, motto: null, visibility: c.visibility, area_name: c.area_name || null, members: c.members, is_owner: c.role === 'owner',
    crest: null, crest_photo_id: null, stripe: null, cover_photo_id: null, livery: 'plain', sharing_scores: false, board: [], next: null });
  return page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') { sent.push({ m, p, b: route.request().postData() }); return m === 'POST' ? json({ id: 'x' }, 201) : route.fulfill({ status: 204 }); }
    if (p === '/api/me') return json({ signed_in: true, member: true, handle: 'natesenft', id: 'U1' });
    if (p === '/api/crews') return json(crews);
    if (p === '/api/crews/feed') return feed ? json({ crews: crews.map((c) => ({ id: c.id, crest: c.id === 'k3' ? 'peak' : null, stripe: c.id === 'k3' ? '#1f5fa8' : null,
      last: c.id === 'k3' ? { handle: 'sam', body: 'Fog by 7? Meet at the Hardee\'s.', at: T1105.at(20), mine: false } : c.id === 'k4' ? { handle: 'tilly', body: '<b>Pancakes</b> after the run', at: T1105.at(300), mine: false } : null,
      next: c.id === 'k3' ? { id: 'e1', title: 'Dawn run', starts_at: T1105.soon } : null })),
    items: [{ kind: 'chat', id: 'm1', crew_id: 'k3', handle: 'sam', photo_id: null, body: 'Fog by 7? Meet at the Hardee\'s.', at: T1105.at(20), mine: false },
      { kind: 'drive', id: 'e1', crew_id: 'k3', handle: 'sam', title: 'Dawn run', starts_at: T1105.soon, at: T1105.at(90), mine: false },
      { kind: 'chat', id: 'm2', crew_id: 'k4', handle: 'tilly', photo_id: null, body: '<b>Pancakes</b> after the run', at: T1105.at(300), mine: false },
      { kind: 'chat', id: 'm3', crew_id: 'k1', handle: 'natesenft', photo_id: null, body: 'Welcome to the crew', at: T1105.at(2000), mine: true }] }) : json({ error: 'x' }, 500);
    const cm = /^\/api\/crews\/([\w]+)\/page$/.exec(p); if (cm) return json(page0(crews.find((c) => c.id === cm[1]) || crews[0]));
    if (/\/board$/.test(p)) return json({ period: 'month', rows: [] });
    if (p === '/api/crews/discover') return json([]);
    if (p === '/api/points') return json({ total: 0 });
    return json([]);
  });
}
async function peopleCrews(page, base) {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?view=people');
  await page.click('[data-people="crews"]');
}
async function eachShape(page, cdp, fn) {
  const bad = [];
  for (const [orient, d] of Object.entries(SAFE)) {
    await page.setViewportSize({ width: d.w, height: d.h });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.i });
    await page.waitForTimeout(250);
    for (const b of await fn(orient, d)) bad.push(`${orient}: ${b}`);
  }
  return bad;
}

flow('TestFlight 2026-11-05 note 1: in several crews the Crews side is a dashboard: a row a crew with its next drive or last message, pins first, the latest from all of them; a crew opens and comes back; ten crews stay one list', async (page, base) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  await crewsStub(page);
  await peopleCrews(page, base);
  await page.waitForSelector('.crew-dash .cd-row');
  await page.waitForFunction(() => document.querySelectorAll('.crew-dash .cd-item').length === 4);
  const dash = () => page.evaluate(() => ({ rows: [...document.querySelectorAll('.cd-row')].map((r) => [r.querySelector('.cd-text b').textContent, r.querySelector('.cd-text small').textContent, r.querySelector('.cd-pin').getAttribute('aria-pressed')]),
    feed: [...document.querySelectorAll('.cd-item')].map((b) => b.querySelector('small').textContent + ' | ' + b.querySelector('.cd-what').textContent),
    head: !document.querySelector('#crewsBody .crew-head') || document.querySelector('#crewsBody .crew-head').hidden, switcher: !!document.querySelector('.cp-switch'),
    page: !!document.querySelector('#crewsBody .crew-page'), count: document.querySelector('.cd-head .note').textContent }));
  let d = await dash();
  check(!d.page && !d.switcher && d.head, 'several crews: a dashboard, no crew page and no row of name chips: ' + JSON.stringify(d));
  check(JSON.stringify(d.rows.map((r) => r[0])) === '["Ridge Runners","Blue Ridge Breakfast Club","test","VETTA"]', 'the latest active first, the quiet ones by name: ' + JSON.stringify(d.rows));
  check(/^Next drive: Dawn run · /.test(d.rows[0][1]) && d.rows[1][1] === '@tilly: <b>Pancakes</b> after the run' && d.rows[3][1] === '1 member · Public · Cincinnati, OH',
    'each row says its next drive, else its last message (as text), else what it is: ' + JSON.stringify(d.rows));
  check(d.count === '4 crews' && d.feed.length === 4 && /^Ridge Runners · 20 min \| @sam: Fog by 7\?/.test(d.feed[0]) && /^Ridge Runners · 1 h \| @sam planned Dawn run · /.test(d.feed[1]) && /\| You: Welcome to the crew$/.test(d.feed[3]),
    'the feed: the latest from every crew, newest first, each with its crew and when: ' + JSON.stringify(d.feed));
  // pin VETTA: it goes to the top, filled, and stays there on this phone
  await page.click('.cd-row[data-crew="k1"] .cd-pin');
  d = await dash();
  check(d.rows[0][0] === 'VETTA' && d.rows[0][2] === 'true' && d.count === '4 crews · 1 pinned' && await page.evaluate(() => localStorage.getItem('apex.crewPins')) === '["k1"]', 'a pin puts the crew first: ' + JSON.stringify(d));
  check(await page.evaluate(() => document.activeElement && document.activeElement.matches('.cd-row[data-crew="k1"] .cd-pin')), 'the pin keeps the focus');
  await page.reload(); await page.click('[data-people="crews"]');
  await page.waitForSelector('.crew-dash .cd-row');
  check((await dash()).rows[0][0] === 'VETTA', 'pins are kept');
  // the feed's message opens its crew; the key back is the dashboard again
  await page.click('.cd-item:has-text("Pancakes")');
  await page.waitForSelector('#crewsBody .crew-page .cp-title h2');
  check(await page.textContent('.crew-page .cp-title h2') === 'Blue Ridge Breakfast Club' && await page.isVisible('#crewsBody .crew-head .cd-back') && await page.isVisible('#crewsBody .crew-head .gear-key'),
    'a crew opens with the key back and its gear');
  check(!(await page.$('.crew-dash')), 'and the dashboard gives way to it');
  await page.click('#crewsBody .cd-back');
  await page.waitForSelector('.crew-dash .cd-row');
  check(await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('cd-open'), null, { timeout: 3000 }).then(() => true, () => false), 'back on the dashboard, the focus on its first crew');
  // nothing under the island, the home bar or a corner, no key on a key, in the four phone shapes
  const bad = await eachShape(page, cdp, (orient, d) => unsafe(page, d));
  check(!bad.length, 'the dashboard:\n  ' + bad.join('\n  '));
  // ten crews (the most a person can be in): one list, every name whole, nothing sideways; the feed still under it
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await crewsStub(page, { n: 6 });
  await page.reload(); await page.click('[data-people="crews"]');
  await page.waitForFunction(() => document.querySelectorAll('.cd-row').length === 10 && document.querySelectorAll('.cd-item').length === 4);
  const ten = await page.evaluate(() => ({ cut: [...document.querySelectorAll('.cd-text b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
    side: document.documentElement.scrollWidth - innerWidth, rowH: Math.max(...[...document.querySelectorAll('.cd-row')].map((r) => r.getBoundingClientRect().height)), feedAfter: !!document.querySelector('.cd-list ~ .cd-head') }));
  check(!ten.cut.length && ten.side <= 0 && ten.rowH <= 90 && ten.feedAfter, 'ten crews are ten short rows, names whole, the feed after: ' + JSON.stringify(ten));
  // the feed can't be had: it says so, and the crews are still there to open
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await crewsStub(page, { feed: false });
  await page.reload(); await page.click('[data-people="crews"]');
  await page.waitForSelector('.cd-feed .note:has-text("Couldn’t load the latest")');
  check((await page.$$('.cd-row')).length === 4, 'no feed: the crews still listed');
}, { hasTouch: true, viewport: { width: 393, height: 852 } });

flow('TestFlight 2026-11-05 note 2: typing a new crew\'s name, the sheet stands on the keyboard and the field is in view; a name asked on the confirm sheet too, in the four phone shapes', async (page, base) => {
  const cdp = await page.context().newCDPSession(page);
  await crewsStub(page);
  await peopleCrews(page, base);
  await page.waitForSelector('#crewsBody .nav-row:has-text("Find or start a crew")');
  // the keyboard's height on each phone shape (iOS 27, English), as the shell reports it (ApexNavApp.swift keyboardMoved)
  const KB = { portrait: 336, landscape: 209, 'mini on its side': 209, SE: 260 };
  const bad = await eachShape(page, cdp, async (orient, d) => {
    const out = [];
    await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); ApexKeyboard.native(0); document.querySelectorAll('.side-pop.open').forEach((p) => p.classList.remove('open')); });
    await page.waitForTimeout(250);
    await page.click('#crewsBody .nav-row:has-text("Find or start a crew")');
    await page.waitForTimeout(300);
    await page.evaluate((kb) => ApexKeyboard.native(kb), KB[orient]);
    await page.focus('input[aria-label="Crew name"]');
    await page.keyboard.type('Ridge');
    await page.waitForTimeout(400);
    const r = await page.evaluate((kb) => { const f = document.querySelector('input[aria-label="Crew name"]').getBoundingClientRect(), s = document.querySelector('.side-pop.open').getBoundingClientRect();
      return { open: document.documentElement.classList.contains('kb-open'), top: f.top, bottom: f.bottom, sheetBottom: s.bottom, sheetTop: s.top, above: innerHeight - kb }; }, KB[orient]);
    if (!r.open) out.push('the page never knew the keyboard was up');
    if (r.bottom > r.above + 0.5) out.push(`the field is under the keyboard (${Math.round(r.bottom)} > ${r.above})`);
    if (r.sheetBottom > r.above + 1) out.push(`the sheet runs on under the keyboard (${Math.round(r.sheetBottom)})`);
    if (r.top < d.i.top) out.push(`the field is under the island (${Math.round(r.top)})`);
    if (r.sheetTop < d.i.top - 0.5) out.push(`the sheet's top is under the island (${Math.round(r.sheetTop)})`);
    if (orient === 'portrait') {
      // the form in the order it is filled in: the name, who can join with its words on their own line, then Create crew
      const order = await page.evaluate(() => { const sec = document.querySelector('input[aria-label="Crew name"]').parentElement;
        return [...sec.children].filter((n) => !n.hidden).map((n) => n.matches('input') ? 'name' : n.classList.contains('new-crew-who') ? 'who' : n.classList.contains('switch') ? 'switch' : n.matches('button') ? n.textContent : n.tagName); });
      if (JSON.stringify(order) !== '["H3","name","who","switch","Create crew"]') out.push('the form\'s order: ' + JSON.stringify(order));
    }
    // a name asked for on the app's own sheet (pin a place, name a setup): its field above the keyboard too
    await page.evaluate(() => { document.activeElement.blur(); document.querySelectorAll('.side-pop.open').forEach((p) => p.classList.remove('open')); window.__asked = ApexConfirm.prompt('Pin this place as', { action: 'Pin', value: 'Home' }); });
    await page.waitForSelector('.confirm-sheet .cs-field');
    await page.focus('.confirm-sheet .cs-field');
    await page.waitForTimeout(400);
    const c = await page.evaluate((kb) => { const f = document.querySelector('.confirm-sheet .cs-field').getBoundingClientRect(), k = document.querySelector('.confirm-sheet .cs-ok').getBoundingClientRect(); return { f: f.bottom, k: k.bottom, above: innerHeight - kb }; }, KB[orient]);
    if (c.f > c.above + 0.5 || c.k > c.above + 0.5) out.push(`the confirm sheet's field or key is under the keyboard (${Math.round(c.f)}, ${Math.round(c.k)} > ${c.above})`);
    await page.click('.confirm-sheet .cs-no');
    return out;
  });
  check(!bad.length, 'typing in a sheet:\n  ' + bad.join('\n  '));
}, { hasTouch: true, viewport: { width: 393, height: 852 } });

flow('TestFlight 2026-11-05 note 3: your own photo is the key: no photo, a tap picks one; with one, a tap offers Choose a new photo, Remove photo, Cancel; no note and no separate keys', async (page, base) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  let me = { signed_in: true, member: true, handle: 'natesenft', id: 'U1', photo_id: null };
  const sent = [];
  await page.route(base + '/api/**', (route) => { const p = new URL(route.request().url()).pathname, m = route.request().method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m !== 'GET') { sent.push({ m, p }); if (m === 'DELETE') me = { ...me, photo_id: null }; if (m === 'POST' && p === '/api/photos') me = { ...me, photo_id: 'P2' }; return m === 'POST' ? json({ id: 'P2' }, 201) : route.fulfill({ status: 204 }); }
    if (p === '/api/me') return json(me);
    if (p.startsWith('/api/photos/')) return route.fulfill({ status: 404 });
    if (p === '/api/me/export') return json({ member: { contribute: false } });
    return json([]); });
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); } catch (_) {} });
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => !document.getElementById('boot') && document.querySelector('.my-photo'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const you = () => page.evaluate(() => { const sec = document.querySelector('.my-photo').closest('.stack-8');
    return { text: sec.innerText, keys: [...sec.querySelectorAll('button, label')].filter((b) => b.offsetParent).map((b) => b.getAttribute('aria-label') || b.textContent.trim()) }; });
  let y = await you();
  check(!/Change photo|Remove photo|Add a photo|location data/.test(y.text) && y.keys[0] === 'Add your profile photo', 'no photo: the face is the key, no other key, no note: ' + JSON.stringify(y));
  // a tap with no photo goes straight to the picker
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click('.my-photo')]);
  check(!!chooser && !(await page.$('.my-photo-sheet')), 'no photo: a tap opens the photo picker');
  // with a photo: a tap is a small sheet of three
  me = { ...me, photo_id: 'P1' };
  await page.goto(base + '/index.html?view=garage');
  await page.waitForFunction(() => !document.getElementById('boot') && document.querySelector('.my-photo[aria-label="Change or remove your profile photo"]'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  y = await you();
  check(!/Change photo|Remove photo|location data/.test(y.text), 'with a photo, still no keys or note under it: ' + y.text);
  await page.click('.my-photo');
  await page.waitForSelector('.my-photo-sheet .cs-list');
  const opts = await page.$$eval('.my-photo-sheet .cs-list > *', (n) => n.map((x) => x.textContent.trim()));
  check(JSON.stringify(opts) === '["Choose a new photo","Remove photo","Cancel"]', 'Choose a new photo, Remove photo, Cancel: ' + JSON.stringify(opts));
  check(await page.evaluate(() => document.activeElement && document.activeElement.textContent === 'Cancel'), 'the focus on Cancel, never on Remove');
  const bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the photo sheet:\n  ' + bad.join('\n  '));
  const [pick2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click('.my-photo-sheet label.cs-opt')]);
  check(!!pick2, 'Choose a new photo opens the picker from the tap itself');
  await page.click('.my-photo-sheet .cs-no');
  check(!(await page.$('.my-photo-sheet')), 'Cancel closes it');
  await page.click('.my-photo');
  await page.click('.my-photo-sheet .cs-yes');
  await page.waitForFunction(() => !document.querySelector('.my-photo-sheet'));
  for (let i = 0; i < 30 && !sent.some((x) => x.m === 'DELETE'); i++) await page.waitForTimeout(100);
  check(sent.some((x) => x.m === 'DELETE' && x.p === '/api/photos/P1'), 'Remove photo deletes it: ' + JSON.stringify(sent));
  await page.waitForSelector('.my-photo[aria-label="Add your profile photo"]');
}, { hasTouch: true, viewport: { width: 393, height: 852 } });

flow('TestFlight 2026-11-05 note 5: Ways to go slides up to its place and stays: the sheet never scrolls up past it for its focused key, in WebKit\'s order too; any sliding sheet the same', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot'));
  // each frame of the slide: the overlay's scroll, the sheet's top and its resting place
  const slide = (open) => page.evaluate(async (open) => {
    document.querySelectorAll('.overlay.show:not(#onboard)').forEach((o) => o.classList.remove('show'));
    const ov = new Function(open)(), frames = [];
    for (let i = 0; i < 18; i++) { await new Promise((r) => requestAnimationFrame(r)); const s = ov.firstElementChild.getBoundingClientRect(); frames.push({ scroll: ov.scrollTop, top: Math.round(s.top), bottom: Math.round(s.bottom) }); }
    const rest = frames[frames.length - 1]; ov.remove();
    return { frames, rest, H: innerHeight };
  }, open);
  const start = await slide('document.getElementById("startMore").click(); return document.querySelector(".start-sheet");');
  check(start.frames.every((f) => f.scroll === 0) && start.frames.every((f) => f.top >= start.rest.top - 1) && start.rest.bottom === start.H,
    'Ways to go comes up from the bottom to its place, never above it, never scrolled: ' + JSON.stringify(start));
  // any sheet that slides up and focuses a key in it (not only this one), and WebKit's order: the scroll lands after the focus
  const any = await slide('const ov = document.createElement("div"); ov.className = "overlay dim show"; const c = document.createElement("div"); c.className = "card-sheet"; c.style.height = "360px"; const k = document.createElement("button"); k.textContent = "Go"; c.append(k); ov.append(c); document.body.append(ov); k.focus(); Promise.resolve().then(() => { ov.scrollTop = 300; }); return ov;');
  check(any.frames.every((f) => f.scroll === 0) && any.frames.every((f) => f.top >= any.rest.top - 1), 'a sliding sheet is never scrolled past its place: ' + JSON.stringify(any.frames.slice(0, 6)));
  // after the slide a tall sheet scrolls as before (a landscape phone)
  const after = await page.evaluate(async () => { const ov = document.createElement('div'); ov.className = 'overlay dim show'; const c = document.createElement('div'); c.className = 'card-sheet'; c.style.cssText = 'height:1600px;flex:none'; ov.append(c); document.body.append(ov);
    await new Promise((r) => setTimeout(r, 400)); ov.scrollTop = 200; await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); const s = ov.scrollTop; ov.remove(); return s; });
  check(after === 200, 'once up, a tall sheet still scrolls: ' + after);
}, { hasTouch: true, viewport: { width: 393, height: 852 } });

flow('TestFlight 2026-11-05 note 6: the idle map\'s deck is the suggestion and one road; a swipe down on the bar folds it to the bar alone (kept), a swipe up brings it back, the next opens Where to?', async (page, base) => {
  await page.addInitScript(() => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.permsExplained', '1'); } catch (_) {} });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE.portrait.i });
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.apexDebug && window.ApexRecording && !document.getElementById('boot'));
  await page.evaluate(async () => { for (const [id, name] of [['yr1', 'Cheviot Road'], ['yr2', 'Colerain Avenue'], ['yr3', 'Bank Road']]) { const lat = [], lon = []; for (let i = 0; i < 400; i++) { lat.push(35.96 + i * 5 / 110540); lon.push(-83.92 + Math.sin(i / 20) * 0.0005); }
    await ApexRecording.store({ id, name, date: new Date(Date.now() - 86400e3).toISOString(), lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: lat.map(() => 15), lon_g: lat.map(() => 0), lat_g: lat.map((_, i) => Math.sin(i / 20) * 3), g_known: null, events: [], elev: null, hz: 1, source: 'web-gps', corners: [] }); } });
  await page.reload();
  await page.waitForSelector('#yourRoads .your-road', { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 });
  const deck = () => page.evaluate(() => { const vis = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none';
    return { rows: [...document.querySelectorAll('#loopSuggest, #yourRoads .your-road')].filter(vis).length, chips: vis(document.getElementById('deckChips')),
      top: Math.round(document.getElementById('planBar').getBoundingClientRect().top), min: document.getElementById('app').classList.contains('deck-min'), open: document.getElementById('planPanel').classList.contains('open'),
      kept: localStorage.getItem('apex.deckMin'), H: innerHeight }; });
  let d = await deck();
  check(d.rows === 2 && d.chips && !d.min, 'the deck: Best roads nearby, the suggestion and one road (it was three rows): ' + JSON.stringify(d));
  const unfolded = d.top;   // Vetta Line: the deck is the bar and one shelf of cards, so it folds by the shelf's height (~95 px; it was two rows, 150+), and the bar is 12 px taller (52 px keys)
  let bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the deck:\n  ' + bad.join('\n  '));
  // a point on the bar itself (its edge beside Where to?), as a thumb drags it
  const onBar = () => page.evaluate(() => { const bar = document.getElementById('planBar'), r = bar.getBoundingClientRect();
    for (const [x, y] of [[r.left + 5, r.top + r.height / 2], [r.left + r.width / 2, r.top + 4], [r.left + 20, r.top + 6]]) { const t = document.elementFromPoint(x, y); if (t && bar.contains(t)) return { x, y, hit: t.id || t.className }; }
    const t = document.elementFromPoint(r.left + 5, r.top + r.height / 2); return { x: r.left + 5, y: r.top + r.height / 2, hit: 'none: ' + (t ? t.id || t.className : '') }; });
  const bar = await onBar();
  check(!/^none/.test(bar.hit), 'nothing over the bar: ' + JSON.stringify(bar));
  await swipe(cdp, bar.x, bar.y, 0, 120);
  await page.waitForTimeout(300);
  d = await deck();
  check(d.min && d.rows === 0 && !d.chips && !d.open && d.kept === '1' && d.top - unfolded > 80 && d.H - d.top < 182, 'a swipe down folds the deck to the bar alone: ' + JSON.stringify(d) + ' unfolded at ' + unfolded);
  bad = await unsafe(page, SAFE.portrait);
  check(!bad.length, 'the folded deck:\n  ' + bad.join('\n  '));
  await page.reload();
  await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot'));
  check((await deck()).min, 'folded is kept on this phone');
  const bar2 = await onBar();
  await swipe(cdp, bar2.x, bar2.y, 0, -120);
  await page.waitForTimeout(300);
  d = await deck();
  check(!d.min && !d.open && d.rows === 2 && d.kept === null, 'a swipe up brings the deck back first: ' + JSON.stringify(d));
  const bar3 = await onBar();
  await swipe(cdp, bar3.x, bar3.y, 0, -160);
  await page.waitForTimeout(400);
  check((await deck()).open, 'the next swipe up opens Where to?');
  // the four phone shapes, folded and not
  for (const fold of [false, true]) {
    await page.evaluate((f) => { if (f) localStorage.setItem('apex.deckMin', '1'); else localStorage.removeItem('apex.deckMin'); }, fold);
    const all = await eachShape(page, cdp, async (orient, s) => { await page.reload(); await page.waitForFunction(() => window.apexDebug && !document.getElementById('boot')); await page.waitForTimeout(500); return unsafe(page, s); });
    check(!all.length, `the deck${fold ? ', folded' : ''}, in the four shapes:\n  ` + all.join('\n  '));
  }
}, { hasTouch: true, viewport: { width: 393, height: 852 }, geolocation: { latitude: 35.9606, longitude: -83.9207 }, permissions: ['geolocation'] });


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
    if (process.env.THROTTLE) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) }); }
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
      // 2026-11-10: nothing a driver can read is the code's leftovers. Whatever screen a flow ends on, no text in view (or
      // spoken label) says "[object Object]", "undefined" or "NaN" (About a road read "descending [object Object]").
      const raw = await leftovers(page);
      check(!raw.length, `the code's own leftovers on screen:\n  ${raw.join('\n  ')}`);
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
