// Roadbooks (docs/SOCIAL.md 2.6; backend/src/roadbooks.ts): a collection of great roads you keep, show to friends, or
// publish for drivers near you to find, follow and drive. A road is a planned shape with a name and a note, never a
// recorded drive. A stamp can't be tapped: the phone looks in your own Log, and a road is stamped when one of your drives
// covers it (coverage, below). Only "this member drove it" leaves the phone, never the drive, its day or its speed.
// fromTrack, coverage, overlaps, boxOf, progress, bookLine, overview and link are pure (tests/test_roadbooks.py);
// mount() draws the pages for cockpit.js.
(function (root) {
  'use strict';
  const fin = Number.isFinite;
  const TRIM_M = 400, MAX_POINTS = 600, MIN_ROAD_M = 300, LOOP_M = 600;
  const COVER_TOL_M = 45, COVER_GAP_M = 250, STAMP_AT = 0.85, SCAN_DRIVES = 12;
  const CACHE_KEY = 'apex.roadbooks', DATES_KEY = 'apex.roadbookStamps';
  const VIS = { private: 'Only you', friends: 'Friends', public: 'Public' };
  const metres = (aLat, aLon, bLat, bLon) => Math.hypot((bLat - aLat) * 110540, (bLon - aLon) * 111320 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180));

  /** A [[lon, lat], …] line's length in metres. */
  function lengthM(geom) {
    let m = 0;
    for (let i = 1; i < (geom ? geom.length : 0); i++) m += metres(geom[i - 1][1], geom[i - 1][0], geom[i][1], geom[i][0]);
    return m;
  }

  /**
   * The road a planned route leaves in a roadbook: its shape without the first TRIM_M (where you were when you planned it is
   * often home), without the last TRIM_M too when it comes back to where it began, and without anything inside a privacy
   * zone (the longest stretch outside them is kept). Thinned to MAX_POINTS. null when under MIN_ROAD_M is left.
   * t: { lat, lon, dist } arrays. zones: [{ lat, lon, r }] (privacy_zones.js).
   */
  function fromTrack(t, zones = []) {
    const n = t && Array.isArray(t.lat) ? Math.min(t.lat.length, t.lon.length, t.dist.length) : 0;
    if (n < 2) return null;
    const total = t.dist[n - 1], loop = metres(t.lat[0], t.lon[0], t.lat[n - 1], t.lon[n - 1]) <= LOOP_M;
    const inZone = (i) => zones.some((z) => metres(z.lat, z.lon, t.lat[i], t.lon[i]) <= z.r);
    let best = null, run = null;
    const close = () => { if (run && (!best || t.dist[run[1]] - t.dist[run[0]] > t.dist[best[1]] - t.dist[best[0]])) best = run; run = null; };
    for (let i = 0; i < n; i++) {
      const ok = fin(t.lat[i]) && fin(t.lon[i]) && t.dist[i] >= TRIM_M && (!loop || t.dist[i] <= total - TRIM_M) && !inZone(i);
      if (ok) { if (run) run[1] = i; else run = [i, i]; } else close();
    }
    close();
    if (!best || t.dist[best[1]] - t.dist[best[0]] < MIN_ROAD_M) return null;
    const [a, b] = best, step = Math.max(1, Math.ceil((b - a + 1) / (MAX_POINTS - 1))), out = [];
    const pt = (i) => [+t.lon[i].toFixed(5), +t.lat[i].toFixed(5)];
    for (let i = a; i < b; i += step) out.push(pt(i));
    out.push(pt(b));
    return out;
  }

  /** [south, north, west, east] of lat/lon arrays, or null. */
  function boxOf(lat, lon) {
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (let i = 0; i < Math.min(lat ? lat.length : 0, lon ? lon.length : 0); i++) {
      if (!fin(lat[i]) || !fin(lon[i])) continue;
      if (lat[i] < s) s = lat[i]; if (lat[i] > n) n = lat[i]; if (lon[i] < w) w = lon[i]; if (lon[i] > e) e = lon[i];
    }
    return s <= n ? [s, n, w, e] : null;
  }
  /** Do two [s, n, w, e] boxes touch? `pad` degrees of slack (GPS wander at a road's end). */
  function overlaps(a, b, pad = 0.0006) {
    return !!a && !!b && a[0] - pad <= b[1] && b[0] - pad <= a[1] && a[2] - pad <= b[3] && b[2] - pad <= a[3];
  }

  /**
   * How much of a road a drive covers, 0..1 by length: the share of the road's own points that lie within tolM of the
   * drive's path (its points joined where they are under COVER_GAP_M apart, so a pause or a tunnel joins nothing).
   * Either direction counts. geom: [[lon, lat], …]; lat, lon: the drive's arrays.
   */
  function coverage(geom, lat, lon, tolM = COVER_TOL_M) {
    const n = Math.min(lat ? lat.length : 0, lon ? lon.length : 0);
    if (!Array.isArray(geom) || geom.length < 2 || n < 2) return 0;
    const ky = 110540, kx = 111320 * Math.cos(geom[0][1] * Math.PI / 180), cell = Math.max(tolM, 60);
    const grid = new Map(), key = (cx, cy) => cx * 2097152 + cy;
    const put = (x, y, i) => { const k = key(Math.floor(x / cell), Math.floor(y / cell)); const l = grid.get(k); if (!l) grid.set(k, [i]); else if (l[l.length - 1] !== i) l.push(i); };
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = lon[i] * kx; Y[i] = lat[i] * ky; }
    for (let i = 0; i + 1 < n; i++) {
      if (!fin(X[i]) || !fin(Y[i]) || !fin(X[i + 1]) || !fin(Y[i + 1])) continue;
      const d = Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]);
      if (d > COVER_GAP_M) continue;
      const steps = Math.max(1, Math.ceil(d / (cell / 2)));
      for (let s = 0; s <= steps; s++) put(X[i] + (X[i + 1] - X[i]) * s / steps, Y[i] + (Y[i + 1] - Y[i]) * s / steps, i);
    }
    const near = (px, py) => {
      const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const l = grid.get(key(cx + dx, cy + dy));
        if (!l) continue;
        for (const i of l) {
          const ax = X[i], ay = Y[i], bx = X[i + 1] - ax, by = Y[i + 1] - ay, len2 = bx * bx + by * by;
          const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2)) : 0;
          if (Math.hypot(px - ax - bx * u, py - ay - by * u) <= tolM) return true;
        }
      }
      return false;
    };
    let got = 0, all = 0;
    for (let j = 0; j < geom.length; j++) {
      const before = j ? metres(geom[j - 1][1], geom[j - 1][0], geom[j][1], geom[j][0]) : 0;
      const after = j + 1 < geom.length ? metres(geom[j][1], geom[j][0], geom[j + 1][1], geom[j + 1][0]) : 0;
      const w = (before + after) / 2;
      all += w;
      if (near(geom[j][0] * kx, geom[j][1] * ky)) got += w;
    }
    return all > 0 ? got / all : 0;
  }

  /** { done, of, all, text } for a book's roads ([{ stamped }]): "3 of 7 driven", "All 7 driven", '' for an empty book. */
  function progress(roads) {
    const of = (roads || []).length, done = (roads || []).filter((r) => r && r.stamped).length;
    return { done, of, all: of > 0 && done === of, text: !of ? '' : done === of ? (of === 1 ? 'Driven' : `All ${of} driven`) : `${done} of ${of} driven` };
  }
  /** "7 roads · 212 mi · 41 following" (the last only when anyone is). */
  function bookLine(b, fmtLen = (m) => `${Math.round(m / 1000)} km`) {
    const n = b.roads | 0, bits = [`${n} ${n === 1 ? 'road' : 'roads'}`];
    if (n && fin(b.length_m)) bits.push(fmtLen(b.length_m));
    if (b.followers > 0) bits.push(`${b.followers} following`);
    return bits.join(' · ');
  }
  const link = (origin, id) => `${String(origin || '').replace(/\/+$/, '')}/?roadbook=${encodeURIComponent(id)}`;

  /**
   * A book's roads on one small map (an SVG string, north up): each road a line, the ones you have driven in `o.hi`.
   * roads: [{ geom, stamped }]. null with nothing to draw.
   */
  function overview(roads, o = {}) {
    const w = o.w || 320, h = o.h || 150, pad = o.pad != null ? o.pad : 12;
    const lines = (roads || []).filter((r) => r && Array.isArray(r.geom) && r.geom.length > 1);
    if (!lines.length) return null;
    let s = Infinity, n = -Infinity, we = Infinity, e = -Infinity;
    for (const r of lines) for (const [lo, la] of r.geom) { if (la < s) s = la; if (la > n) n = la; if (lo < we) we = lo; if (lo > e) e = lo; }
    const kx = Math.cos(((s + n) / 2) * Math.PI / 180), spanX = Math.max((e - we) * kx, 1e-5), spanY = Math.max(n - s, 1e-5);
    const k = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY), ox = (w - spanX * k) / 2, oy = (h - spanY * k) / 2;
    const path = (g) => { const step = Math.max(1, Math.floor(g.length / 160)); return g.filter((_, i) => i % step === 0 || i === g.length - 1)
      .map(([lo, la], i) => `${i ? 'L' : 'M'}${(ox + (lo - we) * kx * k).toFixed(1)} ${(h - oy - (la - s) * k).toFixed(1)}`).join(''); };
    const line = o.line || '#888', hi = o.hi || '#f60', sw = o.width || 2.5;
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));   // the label is a member's words
    // the driven ones last, so they sit on top where two roads share a stretch
    const body = [...lines.filter((r) => !r.stamped), ...lines.filter((r) => r.stamped)]
      .map((r) => `<path d="${path(r.geom)}" fill="none" stroke="${r.stamped ? hi : line}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(o.label || 'The roads on a map')}">${body}</svg>`;
  }

  // ---- the pages ---------------------------------------------------------------------------------------------------
  const STYLE = `
    .rb-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 12px; width: 100%; min-height: 56px; padding: 8px 2px; border: 0; border-bottom: 1px solid var(--hair, var(--panel-dim)); background: none; color: var(--panel-ink); text-align: left; font: inherit; }
    .rb-row b { font-size: 16px; font-weight: 700; } .rb-row span { grid-column: 1; font-size: 13px; color: var(--panel-dim); }
    .rb-row i { grid-row: 1 / span 2; grid-column: 2; width: 9px; height: 9px; margin-right: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); }
    .rb-map { border: 1px solid var(--rule); line-height: 0; } .rb-map svg { width: 100%; height: auto; display: block; }
    .rb-meter { height: 6px; background: color-mix(in srgb, var(--panel-ink) 14%, transparent); } .rb-meter > i { display: block; height: 100%; background: var(--accent); }
    .rb-road { display: grid; grid-template-columns: 88px 1fr; gap: 4px 12px; padding: 12px 0; border-top: 1px solid var(--hair, var(--panel-dim)); align-items: start; }
    .rb-road .rb-thumb { grid-row: 1 / span 3; border: 1px solid var(--rule); line-height: 0; } .rb-road .rb-thumb svg { width: 100%; height: auto; display: block; }
    .rb-road b { font-size: 16px; } .rb-road .note { margin: 0; }
    .rb-road .rb-acts { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
    .rb-stamp { display: inline-block; padding: 1px 6px; border: 1.5px solid var(--accent); color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; transform: rotate(-3deg); }
    .rb-by { font-size: 13px; color: var(--panel-dim); margin: 0; }
    .rb-pop h4 { margin: 8px 0 0; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--panel-dim); }
  `;

  /**
   * page: el, btn, toast, apiCall, jsonOf, copyText, me() → /api/me or null, here() → {lat, lon}|null, mayLookUp(p),
   * fmtLen(m), origin(), zones() → privacy zones, planned() → the planned route's track or null,
   * driveRoad(road, book), report({kind, target, label, done}), recordings (ApexRecording), cellQuery(lat, lon),
   * thumb (ApexRouteThumb), colours() → { line, hi }, changed() → the lists were changed (People redraws its count).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const doc = root.document;
    if (doc && !doc.getElementById('roadbooksStyle')) doc.head.append(el('style', { id: 'roadbooksStyle', textContent: STYLE }));
    const fmtLen = (m) => (page.fmtLen ? page.fmtLen(m) : `${(m / 1000).toFixed(1)} km`);
    const member = () => { const me = page.me && page.me(); return !!(me && me.member); };
    const colours = () => (page.colours ? page.colours() : { line: 'var(--panel-dim)', hi: 'var(--accent)' });
    const store = (() => { try { return root.localStorage; } catch (_) { return null; } })();
    const readJson = (k, d) => { try { return JSON.parse(store.getItem(k)) || d; } catch (_) { return d; } };
    const writeJson = (k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch (_) {} };
    const today = () => new Date().toISOString().slice(0, 10);
    const call = async (method, path, body) => { try { const r = await apiCall(method, path, body); return { ok: r.ok, status: r.status, data: r.status === 204 ? null : await jsonOf(r) }; } catch (_) { return { ok: false, status: 0, data: null }; } };
    const WHY = { 429: 'That’s the limit for now.', 409: 'Pick a handle first in People: a shared roadbook carries it.', 403: 'This roadbook was taken down and can’t be public again.', 0: 'No connection. Try again.' };
    const why = (r, otherwise) => WHY[r.status] || otherwise;

    // what the phone remembers between visits: your books' roads by box (to match a drive without asking), and stamp days
    let lists = null, liveFill = null;                                 // liveFill: People's open Roadbooks sheet, redrawn whenever the lists are read
    const remember = (data) => { lists = data; if (liveFill) try { liveFill(data); } catch (_) {} writeJson(CACHE_KEY, { at: Date.now(), books: [...data.mine, ...data.following].map((b) => ({ id: b.id, name: b.name, road_list: b.road_list })) }); };
    async function loadLists() {
      const r = await call('GET', '/api/roadbooks');
      if (r.ok && r.data && Array.isArray(r.data.mine)) { remember(r.data); return r.data; }
      return null;
    }
    const stampDay = (rid, day) => { const d = readJson(DATES_KEY, {}); if (day === null) delete d[rid]; else if (day) d[rid] = day; else return d[rid] || null; writeJson(DATES_KEY, d); return day; };

    // ---- stamps: found in your own Log, never tapped ----
    const rec = () => page.recordings || root.ApexRecording;
    async function stamp(road, day) {
      const r = await call('PUT', `/api/roadbooks/roads/${encodeURIComponent(road.id)}/stamp`);
      if (!r.ok) return false;
      road.stamped = true; if (r.data && fin(r.data.stamps)) road.stamps = r.data.stamps;
      stampDay(road.id, day || today());
      return true;
    }
    /** Looks through your Log for a book's unstamped roads (newest drives first, at most SCAN_DRIVES read). → roads newly stamped. */
    async function scanLog(book) {
      const R = rec(), todo = (book.road_list || []).filter((r) => !r.stamped && Array.isArray(r.geom));
      if (!member() || !R || !R.summaries || !todo.length) return [];
      let sums = [];
      try { sums = (await R.summaries(null)) || []; } catch (_) { return []; }
      const boxes = new Map(todo.map((r) => [r.id, boxOf(r.geom.map((p) => p[1]), r.geom.map((p) => p[0]))]));
      const drives = sums.filter((s) => s && s.bbox && todo.some((r) => overlaps(boxes.get(r.id), s.bbox)))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, SCAN_DRIVES);
      const won = [];
      for (const s of drives) {
        const left = todo.filter((r) => !r.stamped && overlaps(boxes.get(r.id), s.bbox));
        if (!left.length) continue;
        const d = await R.get(s.id);
        if (!d || !Array.isArray(d.lat)) continue;
        for (const r of left) if (coverage(r.geom, d.lat, d.lon) >= STAMP_AT && await stamp(r, String(d.date || '').slice(0, 10) || today())) won.push(r);
      }
      return won;
    }
    /** A drive just went into the Log: stamp the roads of your books it covers. Asks the server only for those books. */
    const checked = new Set();
    async function afterDrive(driveId) {
      if (!driveId || checked.has(driveId) || !member()) return [];
      checked.add(driveId);
      const R = rec(), d = R && R.get ? await R.get(driveId) : null, box = d && Array.isArray(d.lat) ? boxOf(d.lat, d.lon) : null;
      if (!box) return [];
      const cache = readJson(CACHE_KEY, null), books = cache && Array.isArray(cache.books) ? cache.books : ((await loadLists()) ? readJson(CACHE_KEY, { books: [] }).books : []);
      const won = [];
      for (const b of books) {
        if (!(b.road_list || []).some((r) => !r.stamped && overlaps(r.box, box))) continue;
        const full = await call('GET', `/api/roadbooks/${encodeURIComponent(b.id)}`);
        if (!full.ok || !full.data) continue;
        for (const r of full.data.road_list || []) {
          if (r.stamped || coverage(r.geom, d.lat, d.lon) < STAMP_AT) continue;
          if (await stamp(r, String(d.date || '').slice(0, 10) || today())) won.push({ road: r, book: full.data });
        }
      }
      if (won.length) {
        loadLists().catch(() => {});
        const first = won[0], p = progress(first.book.road_list);
        toast(won.length === 1 ? `Stamped: ${first.road.name}. ${first.book.name}, ${p.text.toLowerCase()}.` : `${won.length} roads stamped in your roadbooks.`, { label: 'Open', onClick: () => open(first.book.id) });
      }
      return won;
    }

    // ---- sheets ----
    function sheet(title) {
      const p = el('aside', { className: 'side-pop rb-pop' }); p.setAttribute('aria-label', title);
      const h = el('h3', { textContent: title });
      p.append(el('div', { className: 'side-pop-head' }, h, btn('Done', () => { p.classList.remove('open'); setTimeout(() => p.remove(), 300); }, 'linkbtn')));
      doc.body.append(p);
      requestAnimationFrame(() => p.classList.add('open'));
      return { pop: p, head: h, close: () => { p.classList.remove('open'); setTimeout(() => p.remove(), 300); } };
    }
    const row = (b, sub, onOpen) => { const r = el('button', { className: 'rb-row', type: 'button' }, el('b', { textContent: b.name }), el('i', { 'aria-hidden': 'true' }), el('span', { textContent: sub })); r.addEventListener('click', onOpen); return r; };
    const svgBox = (cls, svg) => { const d = el('div', { className: cls }); if (svg) d.innerHTML = svg; return d; };   // our own SVG string (overview / ApexRouteThumb): numbers, and a label both escape

    /** A roadbook's page: its roads on one map, your progress, each road with Drive it; its owner's keys or Follow, Share, Report. */
    async function open(id) {
      const s = sheet('Roadbook'), body = el('div', { className: 'stack-12' }, el('p', { className: 'note', textContent: 'Opening the roadbook…' }));
      s.pop.append(body);
      const r = await call('GET', `/api/roadbooks/${encodeURIComponent(id)}`);
      if (!r.ok || !r.data) { body.replaceChildren(el('p', { className: 'note', textContent: r.status === 404 ? 'This roadbook is private now, or gone.' : 'Couldn’t open the roadbook. Check signal.' })); return null; }
      const book = r.data;
      const redraw = () => paint(book, s, body);
      redraw();
      scanLog(book).then((won) => { if (won.length) { toast(won.length === 1 ? `Stamped: ${won[0].name}. Your Log has you on it.` : `${won.length} roads stamped from your Log.`); redraw(); loadLists().catch(() => {}); } }).catch(() => {});
      return book;
    }

    function paint(book, s, body) {
      s.head.textContent = book.name;
      const kids = [], c = colours(), p = progress(book.road_list);
      kids.push(el('p', { className: 'rb-by', textContent: [book.mine ? `Yours · ${VIS[book.visibility]}` : `By @${book.by || '?'}`, bookLine(book, fmtLen)].join(' · ') }));
      if (book.about) kids.push(el('p', { className: 'people-lead', textContent: book.about }));
      const map = overview(book.road_list, { line: c.line, hi: c.hi, label: `${book.name}: its roads on a map` });
      if (map) kids.push(svgBox('rb-map', map));
      if (p.of && member()) {
        const meter = el('div', { className: 'rb-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.of), 'aria-valuenow': String(p.done), 'aria-label': p.text }, el('i', { style: `width:${(100 * p.done / p.of).toFixed(0)}%` }));
        kids.push(el('div', { className: 'stack-8' }, el('b', { textContent: p.text }), meter,
          ...(p.all ? [] : [el('p', { className: 'note', textContent: 'A road is stamped when a drive in your Log covers it. Nothing to tap.' })])));
      }
      // keys: yours to run, or someone's to follow
      const keys = el('div', { className: 'row', style: 'flex-wrap:wrap' });
      if (book.mine) {
        keys.append(btn('Edit', () => edit(book, () => paint(book, s, body)), 'ink-btn'));
        if (book.visibility !== 'private') keys.append(btn('Share', () => page.copyText(link(page.origin(), book.id), 'Link copied. Anyone it is shown to can open it.', book.name), 'ink-btn'));
      } else {
        const f = btn(book.following ? 'Following' : 'Follow', async () => {
          if (!member()) { toast('Sign in to follow a roadbook and collect its stamps.'); return; }
          const want = !book.following, r = await call(want ? 'PUT' : 'DELETE', `/api/roadbooks/${encodeURIComponent(book.id)}/follow`);
          if (!r.ok) { toast(why(r, 'Couldn’t change that. Try again.')); return; }
          book.following = want; book.followers = Math.max(0, (book.followers || 0) + (want ? 1 : -1));
          toast(want ? `Following ${book.name}. Its roads are stamped as you drive them.` : `No longer following ${book.name}.`);
          paint(book, s, body); loadLists().then(() => page.changed && page.changed()).catch(() => {});
        }, 'ink-btn' + (book.following ? ' on' : ' solid'));
        f.setAttribute('aria-pressed', String(!!book.following));
        keys.append(f);
        if (book.visibility === 'public') keys.append(btn('Share', () => page.copyText(link(page.origin(), book.id), 'Link copied.', book.name), 'ink-btn'));
        if (page.report && member()) keys.append(btn('Report', () => page.report({ kind: 'roadbook', target: book.id, label: book.name, done: () => s.close() }), 'linkbtn'));
      }
      kids.push(keys);
      // the roads
      const list = el('div', {});
      const roads = book.road_list || [];
      if (!roads.length) list.append(el('p', { className: 'note', textContent: book.mine ? 'No roads yet. Plan a route, press Share on its card, and add it to this roadbook.' : 'No roads in it yet.' }));
      roads.forEach((road, i) => {
        const T = page.thumb || root.ApexRouteThumb;
        const thumb = T ? T.svg(road.geom.map((q) => q[1]), road.geom.map((q) => q[0]), { w: 176, h: 120, pad: 12, line: road.stamped ? c.hi : c.line, hi: road.stamped ? c.hi : c.line, width: 4, label: `${road.name} on a map` }) : null;
        const box = el('div', { className: 'rb-road' }, svgBox('rb-thumb', thumb));
        const title = el('div', { className: 'row', style: 'align-items:center;gap:8px;flex-wrap:wrap' }, el('b', { textContent: road.name }));
        if (road.stamped) title.append(el('span', { className: 'rb-stamp', textContent: 'Driven' }));
        const day = road.stamped ? stampDay(road.id) : null;
        const facts = [fmtLen(road.length_m), road.stamps > 0 ? `${road.stamps} ${road.stamps === 1 ? 'member has' : 'members have'} driven it` : null,
          day && root.ApexFormat && root.ApexFormat.dayShort ? `you on ${root.ApexFormat.dayShort(day)}` : null].filter(Boolean).join(' · ');
        box.append(title, el('p', { className: 'note', textContent: facts }));
        if (road.note) box.append(el('p', { className: 'note', style: 'grid-column:2;color:var(--panel-ink)', textContent: road.note }));
        const acts = el('div', { className: 'rb-acts' }, btn('Drive it', () => { s.close(); page.driveRoad(road, book); }, 'ink-btn solid'));
        if (book.mine) {
          const move = async (to) => {
            const order = roads.map((x) => x.id); order.splice(to, 0, order.splice(i, 1)[0]);
            const r = await call('PUT', `/api/roadbooks/${encodeURIComponent(book.id)}`, { order });
            if (!r.ok) { toast(why(r, 'Couldn’t move it. Try again.')); return; }
            roads.splice(to, 0, roads.splice(i, 1)[0]); paint(book, s, body);
          };
          if (i > 0) { const up = btn('Up', () => move(i - 1), 'linkbtn'); up.setAttribute('aria-label', `Move ${road.name} up`); acts.append(up); }
          if (i < roads.length - 1) { const dn = btn('Down', () => move(i + 1), 'linkbtn'); dn.setAttribute('aria-label', `Move ${road.name} down`); acts.append(dn); }
          const rm = btn('Remove', async () => {
            const r = await call('DELETE', `/api/roadbooks/${encodeURIComponent(book.id)}/roads/${encodeURIComponent(road.id)}`);
            if (!r.ok) { toast(why(r, 'Couldn’t remove it. Try again.')); return; }
            roads.splice(i, 1); book.roads = roads.length; book.length_m = roads.reduce((a, x) => a + x.length_m, 0);
            paint(book, s, body); loadLists().then(() => page.changed && page.changed()).catch(() => {});
            toast(`${road.name} is out of ${book.name}.`);
          }, 'linkbtn');
          rm.setAttribute('aria-label', `Remove ${road.name}`);
          acts.append(rm);
        }
        box.append(acts);
        list.append(box);
      });
      kids.push(list);
      body.replaceChildren(...kids);
    }

    /** The owner's sheet: name, a line about it, who sees it, delete. */
    function edit(book, done) {
      const s = sheet('Edit roadbook');
      const name = el('input', { className: 'field', value: book.name, maxLength: 60, autocomplete: 'off', 'aria-label': 'Roadbook name' });
      const about = el('textarea', { className: 'field', value: book.about || '', maxLength: 280, rows: 3, placeholder: 'What ties these roads together', 'aria-label': 'About this roadbook' });
      let vis = book.visibility;
      const sw = el('div', { className: 'switch', role: 'radiogroup', 'aria-label': 'Who sees it' }), says = el('p', { className: 'note' });
      const SAYS = { private: 'Only you see it.', friends: 'Your friends can open it, with your handle on it.', public: 'Anyone can open it by its link, and drivers near its roads can find it. Your handle is on it.' };
      const mark = () => { sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.vis === vis))); says.textContent = SAYS[vis]; };
      for (const v of Object.keys(VIS)) { const b = el('button', { type: 'button', role: 'radio', textContent: VIS[v] }); b.dataset.vis = v; b.addEventListener('click', () => { vis = v; mark(); }); sw.append(b); }
      mark();
      const save = btn('Save', async () => {
        const change = {};
        if (name.value.trim() && name.value.trim() !== book.name) change.name = name.value.trim();
        if ((about.value.trim() || null) !== (book.about || null)) change.about = about.value.trim();
        if (vis !== book.visibility) change.visibility = vis;
        if (!Object.keys(change).length) { s.close(); return; }
        const r = await call('PUT', `/api/roadbooks/${encodeURIComponent(book.id)}`, change);
        if (!r.ok) { toast(why(r, 'Couldn’t save it. Try again.')); return; }
        Object.assign(book, change, { about: about.value.trim() || null });
        if (change.visibility === 'private') book.followers = 0;
        s.close(); done(); loadLists().then(() => page.changed && page.changed()).catch(() => {});
        toast(change.visibility === 'public' ? `${book.name} is public. Share its link, or let drivers nearby find it.` : 'Saved.');
      }, 'ink-btn solid');
      let sure = false;
      const del = btn('Delete roadbook', async () => {
        if (!sure) { sure = true; del.textContent = `Delete ${book.name} for good`; return; }
        const r = await call('DELETE', `/api/roadbooks/${encodeURIComponent(book.id)}`);
        if (!r.ok) { toast(why(r, 'Couldn’t delete it. Try again.')); return; }
        s.close(); doc.querySelectorAll('.rb-pop.open').forEach((p) => { p.classList.remove('open'); setTimeout(() => p.remove(), 300); });
        loadLists().then(() => page.changed && page.changed()).catch(() => {});
        toast(`${book.name} is deleted.`);
      }, 'danger-btn');
      s.pop.append(el('div', { className: 'stack-12' }, name, about, el('h4', { textContent: 'Who sees it' }), sw, says,
        el('p', { className: 'note', textContent: 'Roads only: no times, dates or speeds.' }), el('div', { className: 'row' }, save), del));
    }

    /** Makes a book. → its id, or null (the reason is toasted). */
    async function create(name, visibility = 'private') {
      const n = String(name || '').trim();
      if (!n) { toast('Give the roadbook a name.'); return null; }
      const r = await call('POST', '/api/roadbooks', { name: n, visibility });
      if (!r.ok || !r.data) { toast(why(r, r.status === 401 || r.status === 403 ? 'Sign in to keep a roadbook.' : 'Couldn’t make the roadbook. Try again.')); return null; }
      return r.data.id;
    }
    const newForm = (label, then) => {
      const name = el('input', { className: 'field', placeholder: 'Name, like Smokies classics', maxLength: 60, autocomplete: 'off', 'aria-label': 'New roadbook name' });
      const go = btn(label, async () => { go.disabled = true; const id = await create(name.value); go.disabled = false; if (id) { name.value = ''; then(id, name); } }, 'ink-btn solid');
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      return el('div', { className: 'row' }, name, go);
    };

    /** People's Roadbooks sheet: yours, the ones you follow, public ones near you. count(text) gets the row's small line. */
    function section(count) {
      const sec = el('div', { className: 'stack-12' }, el('h3', { textContent: 'Roadbooks' }));
      const mineBox = el('div', {}), followBox = el('div', {}), nearBox = el('div', { className: 'stack-8' });
      const fill = (data) => {
        const mine = data ? data.mine : [], fol = data ? data.following : [];
        if (count) count([mine.length ? `${mine.length} yours` : '', fol.length ? `${fol.length} followed` : ''].filter(Boolean).join(' · '));
        const sub = (b) => [b.mine ? VIS[b.visibility] : `@${b.by || '?'}`, bookLine(b, fmtLen), progress(b.road_list).done ? progress(b.road_list).text : ''].filter(Boolean).join(' · ');
        mineBox.replaceChildren(...(mine.length ? mine.map((b) => row(b, sub(b), () => open(b.id))) : []));
        followBox.replaceChildren(...(fol.length ? [el('h4', { className: 'rb-h', textContent: 'Following', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), ...fol.map((b) => row(b, sub(b), () => open(b.id)))] : []));
      };
      liveFill = fill;
      const reload = () => loadLists().then((d) => { if (!d) fill(null); return d; });
      sec.append(el('p', { className: 'people-lead', textContent: 'Your lists of great roads, for you, friends or everyone.' }),
        newForm('New roadbook', (id) => { reload().then(() => page.changed && page.changed()); open(id); }), mineBox, followBox,
        el('h4', { textContent: 'Near you', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), nearBox);
      if (lists) fill(lists);
      reload().catch((e) => console.error('roadbooks', e));
      near(nearBox);
      sec._reload = reload;
      return sec;
    }

    /** Public roadbooks near you (by the coarse cell; never from inside a privacy zone), into `box`. */
    function near(box) {
      const at = page.here && page.here();
      const say = (t) => box.replaceChildren(el('p', { className: 'note', textContent: t }));
      if (!at) { say('Waiting for your position.'); return; }
      if (page.mayLookUp && !page.mayLookUp(at)) { say('Nothing is looked up from inside a privacy zone, or in a drive’s first stretch.'); return; }
      say('Looking for roadbooks near you…');
      call('GET', `/api/roadbooks/near?${page.cellQuery(at.lat, at.lon)}`).then((r) => {
        if (!r.ok || !Array.isArray(r.data)) { say('Couldn’t look for roadbooks. Check signal.'); return; }
        if (!r.data.length) { say('No public roadbooks near here yet. Publish yours and it is the first.'); return; }
        box.replaceChildren(...r.data.map((b) => row(b, [`@${b.by || '?'}`, bookLine(b, fmtLen), fin(b.km) ? `${fmtLen(Math.max(1000, b.km * 1000))} away` : ''].filter(Boolean).join(' · '), () => open(b.id))));
      });
    }
    function nearSection() { const box = el('div', { className: 'stack-8' }); near(box); return box; }

    /** On the route card's Share: keep the planned road in one of your books (or a new one). → an element, or null signed out. */
    function addPart(done) {
      if (!member()) return null;
      const part = el('div', { className: 'stack-8 rb-add' }, el('p', { className: 'note', textContent: 'Or keep it in a roadbook. Its first 400 m and your privacy zones are left out.' }));
      const chips = el('div', { className: 'row', style: 'flex-wrap:wrap' });
      const addTo = async (id, bookName) => {
        const t = page.planned && page.planned(), geom = t ? fromTrack(t, page.zones ? page.zones() : []) : null;
        if (!geom) { toast('This route is too short to keep once its private ends are left out.'); return; }
        const r = await call('POST', `/api/roadbooks/${encodeURIComponent(id)}/roads`, { name: String(t.name || 'Road').slice(0, 60), geom });
        if (!r.ok) { toast(r.status === 429 ? 'That roadbook is full (40 roads), or that’s enough for today.' : why(r, 'Couldn’t add it. Try again.')); return; }
        loadLists().then(() => page.changed && page.changed()).catch(() => {});
        toast(`Added to ${bookName}.`, { label: 'Open', onClick: () => open(id) });
        if (done) done();
      };
      const fillChips = (data) => chips.replaceChildren(...((data ? data.mine : []).map((b) => btn(b.name, () => addTo(b.id, b.name), 'ink-btn'))));
      if (lists) fillChips(lists);
      loadLists().then(fillChips).catch(() => {});
      part.append(chips, newForm('New roadbook', (id, input) => addTo(id, (input && input.value) || 'your new roadbook')));
      // the new book's name for the toast: read before the form clears it
      const form = part.lastChild, nameIn = form.querySelector('input'), goBtn = form.querySelector('button');
      goBtn.onclick = async () => { const n = nameIn.value.trim(); goBtn.disabled = true; const id = await create(n); goBtn.disabled = false; if (id) { nameIn.value = ''; addTo(id, n); } };
      return part;
    }

    /** Has this member any book of their own or followed (as last read, or as this phone kept it)? People shows the row then. */
    const hasAny = () => { const l = lists || readJson(CACHE_KEY, null); return !!l && ((l.books && l.books.length > 0) || (l.mine && (l.mine.length + l.following.length) > 0)); };
    return { section, nearSection, open, addPart, afterDrive, scanLog, hasAny, lists: () => lists, reload: loadLists };
  }

  const api = { fromTrack, coverage, overlaps, boxOf, lengthM, progress, bookLine, overview, link, mount, STAMP_AT, TRIM_M, MAX_POINTS, MIN_ROAD_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadbooks = api;
})(typeof window !== 'undefined' ? window : globalThis);
