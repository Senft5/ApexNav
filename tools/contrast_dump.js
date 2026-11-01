// The review pack's contrast notes (REVIEW5 §7.6): the drive screen's text colours per theme, day and night, read from the
// page itself (getComputedStyle), not from the recording's PNGs (composited at 3x, so a measured pixel is a blend). For each
// visible piece of text on the replay's drive screen: its colour, the surface under it (the first ancestor with a ground,
// opacity and alpha composed) and the WCAG contrast ratio, the quiet line and the binnacle's captions ("SCORE", "Sight",
// "MPH") named. The theme contract's floor is 4.5:1 for text (7:1 for the call and the hazard, checked in e2e/smoke.js).
//   node tools/contrast_dump.js <out.md>      (needs the `playwright` package and its Chromium, as e2e/smoke.js does)
// Run by app-review.yml's pack job; with INDEX.md beside <out.md>, a short section with the worst ratios is added to it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WEB = path.resolve(__dirname, '..', 'web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const FLOOR = 4.5;

function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; } catch (_) { res.writeHead(400); res.end(); return; }
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// In the page: every visible element with its own text, its colour over its surface, and the ratio.
function measure() {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  // the surface under an element: its ancestors' grounds composed from the page's own ground up
  const surface = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    let bg = parse(getComputedStyle(document.body).backgroundColor) || [0, 0, 0, 1];
    if (bg[3] < 1) bg = over(bg, [255, 255, 255, 1]);
    for (const n of chain.reverse()) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) bg = over(c, bg); }
    return bg;
  };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity) || 0; return o; };
  const out = [], seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const svgText = el instanceof SVGTextElement;                       // the dials' MPH and numerals are SVG text
    if ((el instanceof SVGElement && !svgText) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const text = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    // on top where it is drawn: a closed sheet's text under the map or the drive screen is not on the screen
    const hx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), hy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(hx, hy);
    const host = svgText ? el.ownerSVGElement : el;                      // SVG text is hit as its drawing, a numeral may lie over it
    if (!hit || !(hit === host || host.contains(hit) || hit.contains(host))) continue;
    const o = opacity(el);
    if (o < 0.05) continue;
    const fg = parse(svgText ? cs.fill : cs.color); if (!fg) continue;
    const bg = surface(el), ink = over([fg[0], fg[1], fg[2], fg[3] * o], bg);
    const key = `${text}|${hex(ink)}|${hex(bg)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    const where = (el.id ? '#' + el.id : '') + (cls.trim() ? '.' + cls.trim().split(/\s+/).join('.') : '') || el.tagName.toLowerCase();
    out.push({ text: text.slice(0, 60), where, px: parseFloat(cs.fontSize), ink: hex(ink), bg: hex(bg), ratio: Math.round(ratio(ink, bg) * 100) / 100 });
  }
  return out;
}

const NAMED = [['the quiet line', (r) => /^Quiet\s*·/.test(r.text)], ['SCORE', (r) => /^SCORE$/i.test(r.text)], ['Sight', (r) => /^Sight$/i.test(r.text)],
  ['MPH', (r) => /^(MPH|KM\/H)$/i.test(r.text)]];

(async () => {
  const outFile = process.argv[2] || 'contrast.md';
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const themes = (() => { global.window = { localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; require(path.join(WEB, 'themes.js')); return Object.keys(global.window.ApexThemes.THEMES); })();
  const lines = ['# Contrast on the drive screen (from the page)', '',
    `Read with getComputedStyle from \`web/index.html\` on the demo replay in Chromium at 390 × 844, per theme, day and night, with a note up and then with the notes on Quiet (the quiet line on screen). Ink is the text colour composed with its opacity over its surface (the first grounds under it, composed). Floor ${FLOOR}:1; rows under it are marked.`, ''];
  const worst = [];
  for (const id of themes) {
    for (const night of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
      await ctx.addInitScript((n) => { try { localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.newsSeen', 'all'); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full', nightMode: n ? 'on' : 'off' })); } catch (_) {} }, night);
      const page = await ctx.newPage();
      const mode = night ? 'night' : 'day';
      let rows = [], at = null, quietAt = null;
      try {
        await page.goto(base + '/index.html?drive=dry_ridge&play=1');
        await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length, null, { timeout: 30000 });
        if (id !== 'roadbook') {
          await page.evaluate((t) => window.apexDebug.tryTheme(t), id);
          await page.waitForFunction((t) => document.documentElement.dataset.theme === t, id, { timeout: 15000 });
          await page.waitForFunction(() => window.apexDebug.track && window.apexDebug.track.events.length, null, { timeout: 30000 });
        }
        // a note up (the middle of the demo road, Full notes), then the same stretch with the notes on Quiet, which puts
        // the quiet line in the strip ("Quiet · <road> · next corner …"); one table of both
        const add = (more) => { const k = new Set(rows.map((r) => `${r.text}|${r.ink}|${r.bg}`)); rows = rows.concat(more.filter((r) => !k.has(`${r.text}|${r.ink}|${r.bg}`))); };
        at = 0.45;
        await page.evaluate((x) => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * x; }, at);
        await page.waitForTimeout(1500);
        add(await page.evaluate(measure));
        // Quiet still shows bumps and crests: the first stretch of the road with none ahead has the quiet line
        await page.evaluate(() => { window.apexDebug.state.notesMode = 'quiet'; });
        for (const f of [0.45, 0.02, 0.98, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
          await page.evaluate((x) => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * x; }, f);
          await page.waitForTimeout(1200);
          const more = await page.evaluate(measure);
          if (more.some((r) => /^Quiet\s*·/.test(r.text)) || f === 0.95) { add(more); quietAt = f; break; }
        }
      } catch (e) {
        lines.push(`## ${id}, ${mode}`, '', `Not measured: ${String(e.message || e).split('\n')[0]}`, '');
        await ctx.close();
        continue;
      }
      await ctx.close();
      rows.sort((a, b) => a.ratio - b.ratio);
      lines.push(`## ${id}, ${mode}`, '', `Full notes at ${Math.round(at * 100)} % of the demo drive; Quiet at ${Math.round(quietAt * 100)} %.`, '');
      for (const [name, test] of NAMED) {
        const r = rows.find(test);
        lines.push(`- ${name}: ${r ? `${r.ink} on ${r.bg}, ${r.ratio}:1${r.ratio < FLOOR ? ' **under the floor**' : ''}` : 'not on screen'}`);
      }
      lines.push('', '| ratio | text | where | px | ink | surface |', '|---|---|---|---|---|---|');
      for (const r of rows) {
        lines.push(`| ${r.ratio}${r.ratio < FLOOR ? ' ⚠' : ''} | ${r.text.replace(/\|/g, '/')} | \`${r.where.slice(0, 50)}\` | ${r.px} | ${r.ink} | ${r.bg} |`);
        if (r.ratio < FLOOR) worst.push({ id, mode, ...r });
      }
      lines.push('');
    }
  }
  await browser.close(); server.close();
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  const index = path.join(path.dirname(path.resolve(outFile)), 'INDEX.md');
  if (fs.existsSync(index)) {
    worst.sort((a, b) => a.ratio - b.ratio);
    const add = ['', '## Contrast (from the page)', '', `\`${path.basename(outFile)}\`: every text colour on the drive screen per theme, day and night, with its ratio. ${worst.length} under ${FLOOR}:1${worst.length ? ', the lowest:' : '.'}`, '',
      ...worst.slice(0, 12).map((w) => `- ${w.id} ${w.mode}: "${w.text}" (\`${w.where.slice(0, 40)}\`) ${w.ink} on ${w.bg}, ${w.ratio}:1`)];
    fs.appendFileSync(index, add.join('\n') + '\n');
  }
  console.log(`${outFile}: ${themes.length} themes, ${worst.length} under ${FLOOR}:1`);
})().catch((e) => { console.error(e); process.exit(1); });
