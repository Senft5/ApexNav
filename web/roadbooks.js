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
  const COVER_TOL_M = 45, COVER_GAP_M = 250, STAMP_AT = 0.85, SCAN_DRIVES = 12, ALONG_OPEN = 6;
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
  function fromTrack(t, zones = [], trim = TRIM_M) {
    const n = t && Array.isArray(t.lat) ? Math.min(t.lat.length, t.lon.length, t.dist.length) : 0;
    if (n < 2) return null;
    const total = t.dist[n - 1], loop = metres(t.lat[0], t.lon[0], t.lat[n - 1], t.lon[n - 1]) <= LOOP_M;
    const inZone = (i) => zones.some((z) => metres(z.lat, z.lon, t.lat[i], t.lon[i]) <= z.r);
    let best = null, run = null;
    const close = () => { if (run && (!best || t.dist[run[1]] - t.dist[run[0]] > t.dist[best[1]] - t.dist[best[0]])) best = run; run = null; };
    for (let i = 0; i < n; i++) {
      const ok = fin(t.lat[i]) && fin(t.lon[i]) && t.dist[i] >= trim && (!loop || t.dist[i] <= total - trim) && !inZone(i);
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

  /**
   * The road one of your saved stages (the Log's apex.segments: geom a JSON string of [lat, lon]) leaves in a roadbook: its
   * line as marked, nothing trimmed from its ends (a stage is a road, not where a drive began), but without anything inside a
   * privacy zone. null with no line, or under MIN_ROAD_M once the zones are left out.
   */
  function fromStage(seg, zones = []) {
    let g = null;
    try { g = typeof (seg && seg.geom) === 'string' ? JSON.parse(seg.geom) : seg && seg.geom; } catch (_) { g = null; }
    if (!Array.isArray(g)) return null;
    g = g.filter((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]));
    if (g.length < 2) return null;
    const dist = [0];
    for (let i = 1; i < g.length; i++) dist.push(dist[i - 1] + metres(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
    return fromTrack({ lat: g.map((p) => p[0]), lon: g.map((p) => p[1]), dist }, zones, 0);
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
  /**
   * Drive them all: a book's roads as one drive from `here` ({lat, lon}), nearest first, each from its nearer end, the next
   * road from where the last one ends. At most `max` roads (the route's stops run out), a first road within FIRST_KM of
   * here and each next within NEXT_KM of the last exit; [{ road, fwd }] in driving order ([] when none is in reach).
   * Without `here` it starts at the book's first road, as drawn.
   */
  const TOUR_MAX = 4, FIRST_KM = 150, NEXT_KM = 80;
  function tour(here, roads, max = TOUR_MAX) {
    const km = (a, b) => Math.hypot((a.lat - b.lat) * 110.54, (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));
    const left = (roads || []).filter((r) => r && Array.isArray(r.geom) && r.geom.length > 1), out = [];
    const ends = (r) => ({ a: { lat: r.geom[0][1], lon: r.geom[0][0] }, b: { lat: r.geom[r.geom.length - 1][1], lon: r.geom[r.geom.length - 1][0] } });
    let at = here && fin(here.lat) && fin(here.lon) ? here : null;
    if (!at && left.length) { const r = left.shift(), e = ends(r); out.push({ road: r, fwd: true }); at = e.b; }
    while (left.length && out.length < max) {
      let best = null;
      left.forEach((r, i) => { const e = ends(r), da = km(at, e.a), db = km(at, e.b), d = Math.min(da, db); if (!best || d < best.d) best = { i, d, fwd: da <= db, e }; });
      if (best.d > (out.length ? NEXT_KM : FIRST_KM)) break;
      out.push({ road: left.splice(best.i, 1)[0], fwd: best.fwd });
      at = best.fwd ? best.e.b : best.e.a;
    }
    return out;
  }
  /**
   * The roads of these books (opened: [{ id, name, road_list: [{ id, name, geom, stamped }] }]) that a planned route
   * (lat, lon) drives, by the same measure as a stamp (STAMP_AT of the road within reach of the route), each road once,
   * in the books' order: [{ book, bookName, road, name, stamped }].
   */
  function onRoute(books, lat, lon) {
    const box = boxOf(lat, lon), out = [], seen = new Set();
    if (!box) return out;
    for (const b of Array.isArray(books) ? books : []) {
      for (const r of (b && b.road_list) || []) {
        if (!r || seen.has(r.id) || !Array.isArray(r.geom) || r.geom.length < 2) continue;
        const g = r.geom.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]));
        if (!overlaps(boxOf(g.map((q) => q[1]), g.map((q) => q[0])), box) || coverage(g, lat, lon) < STAMP_AT) continue;
        seen.add(r.id);
        out.push({ book: b.id, bookName: String(b.name || ''), road: r.id, name: String(r.name || 'A road'), stamped: !!r.stamped });
      }
    }
    return out;
  }
  /** The route card's words for them: one road by name and its book, more by count; '' for none. */
  function routeLine(found) {
    const f = Array.isArray(found) ? found : [];
    if (!f.length) return '';
    if (f.length === 1) return `Drives ${f[0].name} from ${f[0].bookName}${f[0].stamped ? '' : ', new to you'}`;
    const fresh = f.filter((x) => !x.stamped).length;
    return `Drives ${f.length} roads from your roadbooks${fresh ? `, ${fresh} new to you` : ''}`;
  }

  const link = (origin, id) => `${String(origin || '').replace(/\/+$/, '')}/?roadbook=${encodeURIComponent(id)}`;

  /**
   * A book's roads on one small map (an SVG string, north up): each road a line, the ones you have driven in `o.hi`.
   * roads: [{ geom, stamped }]. null with nothing to draw.
   */
  const drawn = (roads) => (roads || []).filter((r) => r && Array.isArray(r.geom) && r.geom.length > 1);
  function bounds(lines) {
    let s = Infinity, n = -Infinity, we = Infinity, e = -Infinity;
    for (const r of lines) for (const [lo, la] of r.geom) { if (la < s) s = la; if (la > n) n = la; if (lo < we) we = lo; if (lo > e) e = lo; }
    return [s, n, we, e];
  }
  /**
   * The two corners ([[lat, lon], [lat, lon]], south-west and north-east) whose fit is overview's: handed to post_map.js
   * viewFor (with the same w, h and pad), the real map lies exactly under the book's lines. null with nothing to draw.
   */
  function overviewFrame(roads) {
    const lines = drawn(roads);
    if (!lines.length) return null;
    const [s, n, we, e] = bounds(lines);
    return [[s, we], [n, e]];
  }
  function overview(roads, o = {}) {
    const w = o.w || 320, h = o.h || 150, pad = o.pad != null ? o.pad : 12;
    const lines = drawn(roads);
    if (!lines.length) return null;
    const [s, n, we, e] = bounds(lines);
    const kx = Math.cos(((s + n) / 2) * Math.PI / 180), spanX = Math.max((e - we) * kx, 1e-5), spanY = Math.max(n - s, 1e-5);
    const k = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY), ox = (w - spanX * k) / 2, oy = (h - spanY * k) / 2;
    const path = (g) => { const step = Math.max(1, Math.floor(g.length / 160)); return g.filter((_, i) => i % step === 0 || i === g.length - 1)
      .map(([lo, la], i) => `${i ? 'L' : 'M'}${(ox + (lo - we) * kx * k).toFixed(1)} ${(h - oy - (la - s) * k).toFixed(1)}`).join(''); };
    const line = o.line || '#888', hi = o.hi || '#f60', sw = o.width || 2.5;
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));   // the label is a member's words
    // the driven ones last, so they sit on top where two roads share a stretch
    // each line on a casing, shown only once the real map is under it (.on-map), so a road reads over the streets
    const body = [...lines.filter((r) => !r.stamped), ...lines.filter((r) => r.stamped)]
      .map((r) => { const d = path(r.geom); return `<path class="rb-casing" d="${d}" fill="none" stroke-width="${sw + 3}" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<path d="${d}" fill="none" stroke="${r.stamped ? hi : line}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`; }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(o.label || 'The roads on a map')}">${body}</svg>`;
  }

  /**
   * Where a link card's text goes (1200 x 630, the size chat apps show large): the map fills the top MAP_H, the band under
   * it carries the book's name and its facts; a name too long for the band is cut with an ellipsis by the caller's measure.
   */
  const CARD = { w: 1200, h: 630, mapH: 470, pad: 48 };
  function cardLines(book, fmtLenFn) {
    const p = progress(book.road_list);
    return { name: String(book.name || 'Roadbook'), facts: [bookLine(book, fmtLenFn), book.by ? `kept by @${book.by}` : null].filter(Boolean).join(' · '), driven: p.of ? p.done : 0 };
  }

  // ---- the pages ---------------------------------------------------------------------------------------------------
  const STYLE = `
    .rb-skel { display: grid; gap: 12px; } .rb-skel i { display: block; height: 18px; border-radius: 8px; background: var(--rule); opacity: .55; }
    .rb-skel i:first-child { height: 180px; } .rb-skel i:nth-child(3) { width: 60%; }
    .rb-lost { display: grid; gap: 10px; justify-items: start; } .rb-lost p { margin: 0; }
    .rb-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 12px; width: 100%; min-height: 56px; padding: 8px 2px; border: 0; border-bottom: 1px solid var(--hair, var(--panel-dim)); background: none; color: var(--panel-ink); text-align: left; font: inherit; }
    .rb-row b { font-size: 16px; font-weight: 700; } .rb-row span { grid-column: 1; font-size: 13px; color: var(--panel-dim); }
    .rb-row i { grid-row: 1 / span 2; grid-column: 2; width: 9px; height: 9px; margin-right: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); }
    .rb-map { border: 1px solid var(--rule); line-height: 0; } .rb-map svg { width: 100%; height: auto; display: block; }
    .rb-map .rb-casing { display: none; } .rb-map.on-map svg { background-size: 100% 100%; background-position: center; } .rb-map.on-map .rb-casing { display: inline; stroke: var(--panel, #fff); }
    .rb-meter { height: 6px; background: color-mix(in srgb, var(--panel-ink) 14%, transparent); } .rb-meter > i { display: block; height: 100%; background: var(--accent); }
    .rb-road { display: grid; grid-template-columns: 88px 1fr; gap: 4px 12px; padding: 12px 0; border-top: 1px solid var(--hair, var(--panel-dim)); align-items: start; }
    .rb-road .rb-thumb { grid-row: 1 / span 3; border: 1px solid var(--rule); line-height: 0; } .rb-road .rb-thumb svg { width: 100%; height: auto; display: block; } .rb-road .rb-thumb.on-map svg { background-size: 100% 100%; background-position: center; }
    .rb-road b { font-size: 16px; } .rb-road .note { margin: 0; }
    .rb-road .rb-acts { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
    .rb-stamp { display: inline-block; padding: 1px 6px; border: 1.5px solid var(--accent); color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; transform: rotate(-3deg); }
    .rb-by { font-size: 13px; color: var(--panel-dim); margin: 0; }
    .rb-pop h4 { margin: 8px 0 0; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--panel-dim); }
  `;

  /**
   * page: el, btn, toast, apiCall, jsonOf, copyText, me() → /api/me or null, here() → {lat, lon}|null, mayLookUp(p),
   * fmtLen(m), origin(), zones() → privacy zones, planned() → the planned route's track or null,
   * driveRoad(road, book), driveBook(book) (Drive them all), report({kind, target, label, done}), recordings (ApexRecording), cellQuery(lat, lon),
   * thumb (ApexRouteThumb), colours() → { line, hi }, changed() → the lists were changed (People redraws its count), edited() → a write went through,
   * mapUnder(key, pts, w, h, pad) → a picture of the real map under pts' fit, or null (post_map.js, cockpit.js),
   * stages() → your saved stages (the Log's apex.segments).
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
    // edited() → a book's roads may have changed (a road added or removed, a stamp, a follow): the map's Roadbooks layer reads them again
    const call = async (method, path, body) => { try { const r = await apiCall(method, path, body); if (r.ok && method !== 'GET' && page.edited) try { page.edited(); } catch (_) {} return { ok: r.ok, status: r.status, data: r.status === 204 ? null : await jsonOf(r) }; } catch (_) { return { ok: false, status: 0, data: null }; } };
    const WHY = { 429: 'That’s the limit for now.', 409: 'Pick a handle first in People: a shared roadbook carries it.', 403: 'This roadbook was taken down and can’t be public again.', 0: 'No connection. Try again.' };
    const why = (r, otherwise) => WHY[r.status] || otherwise;

    // what the phone remembers between visits: your books' roads by box (to match a drive without asking), and stamp days
    let lists = null, liveFill = null;                                 // liveFill: People's open Roadbooks sheet, redrawn whenever the lists are read
    const remember = (data) => { lists = data; if (liveFill) try { liveFill(data); } catch (_) {} writeJson(CACHE_KEY, { at: Date.now(), books: [...data.mine, ...data.following, ...(data.crews || [])].map((b) => ({ id: b.id, name: b.name, road_list: b.road_list })) }); };
    async function loadLists() {
      const r = await call('GET', '/api/roadbooks');
      if (r.ok && r.data && Array.isArray(r.data.mine)) { remember(r.data); return r.data; }
      return null;
    }
    const stampDay = (rid, day) => { const d = readJson(DATES_KEY, {}); if (day === null) delete d[rid]; else if (day) d[rid] = day; else return d[rid] || null; writeJson(DATES_KEY, d); return day; };

    // ---- a public book's link card (backend link_preview.ts): its roads on the real map, made here, sent once a change ----
    const cardSent = new Map();                                        // book id → what the last card showed
    const cssColour = (c, d) => { const m = /^var\((--[\w-]+)\)$/.exec(String(c || '')); if (!m) return c || d;
      try { return root.getComputedStyle(doc.documentElement).getPropertyValue(m[1]).trim() || d; } catch (_) { return d; } };
    async function sendCard(book) {
      if (!book || !book.mine || book.visibility !== 'public' || !page.mapUnder || !doc || !root.ApexSync) return false;
      const roads = drawn(book.road_list), frame = overviewFrame(roads);
      if (!frame) return false;
      const t = cardLines(book, fmtLen), sig = `${t.name}|${t.facts}|${roads.map((r) => r.id).join('.')}`;
      if (cardSent.get(book.id) === sig) return true;
      const { w, h, mapH, pad } = CARD;
      const under = await Promise.resolve(page.mapUnder(`rbc_${book.id}_${roads.map((r) => r.id).join('.')}`, frame, w, mapH, pad)).catch(() => null);
      if (!under) return false;
      const img = (src) => new Promise((ok) => { const i = new root.Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
      const hi = cssColour(colours().hi, '#e8562a');
      // every road in the accent (your own stamps are yours, not the card's), on a white casing so it reads over the streets
      const svg = (overview(roads.map((r) => ({ geom: r.geom })), { w, h: mapH, pad, line: hi, hi, width: 8, label: t.name }) || '').replace(/class="rb-casing"/g, 'stroke="#ffffff" stroke-opacity="0.9"');
      const [map, lines] = await Promise.all([img(under), img(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)]);
      if (!map || !lines) return false;
      const cv = doc.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      if (!g) return false;
      g.drawImage(map, 0, 0, w, mapH); g.drawImage(lines, 0, 0, w, mapH);
      g.fillStyle = '#1b1914'; g.fillRect(0, mapH, w, h - mapH);
      const font = (px, wt) => `${wt} ${px}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
      g.font = font(28, 800); g.fillStyle = hi; g.textBaseline = 'alphabetic';
      const mark = 'VETTA', mw = g.measureText(mark).width;
      g.fillText(mark, w - pad - mw, mapH + 64);
      g.font = font(52, 800); g.fillStyle = '#f4efe4';
      let name = t.name; while (name.length > 1 && g.measureText(name).width > w - 3 * pad - mw) name = `${name.slice(0, -2).trimEnd()}…`;
      g.fillText(name, pad, mapH + 70);
      g.font = font(30, 500); g.fillStyle = '#b9b1a3'; g.fillText(t.facts, pad, mapH + 122);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.82));
      if (!blob) return false;
      const r = await root.ApexSync.apiFetch(`/api/roadbooks/${encodeURIComponent(book.id)}/card`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob }).catch(() => null);
      if (r && r.ok) { cardSent.set(book.id, sig); return true; }
      return false;
    }
    const card = (book) => { sendCard(book).catch(() => {}); };

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
    // run go() once el comes within a screen of view (at once where there's no IntersectionObserver)
    const nearby = (node, go) => {
      if (!root.IntersectionObserver) { go(); return; }
      const io = new root.IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px 0px' });
      io.observe(node);
    };
    const svgBox = (cls, svg) => { const d = el('div', { className: cls }); if (svg) d.innerHTML = svg; return d; };   // our own SVG string (overview / ApexRouteThumb): numbers, and a label both escape

    /** A roadbook's page: its roads on one map, your progress, each road with Drive it; its owner's keys or Follow, Share, Report. */
    async function open(id) {
      // loading is the page's shape; no answer is one line and Try again; private or gone says so (the shared states)
      const skel = () => el('div', { className: 'rb-skel', 'aria-busy': 'true', 'aria-label': 'Opening the roadbook' }, el('i'), el('i'), el('i'));
      const s = sheet('Roadbook'), body = el('div', { className: 'stack-12' }, skel());
      s.pop.append(body);
      let r = await call('GET', `/api/roadbooks/${encodeURIComponent(id)}`);
      while (!r.ok || !r.data) {
        if (r.status === 404) { body.replaceChildren(el('p', { className: 'note', textContent: 'This roadbook is private now, or gone.' })); return null; }
        const again = await new Promise((res) => body.replaceChildren(el('div', { className: 'rb-lost' }, el('p', { textContent: 'Couldn’t open the roadbook. Check signal.' }), btn('Try again', () => res(true), 'ink-btn solid'))));
        if (!again || !s.pop.isConnected) return null;
        body.replaceChildren(skel());
        r = await call('GET', `/api/roadbooks/${encodeURIComponent(id)}`);
      }
      const book = r.data;
      const redraw = () => paint(book, s, body);
      redraw();
      scanLog(book).then((won) => { if (won.length) { toast(won.length === 1 ? `Stamped: ${won[0].name}. Your Log has you on it.` : `${won.length} roads stamped from your Log.`); redraw(); loadLists().catch(() => {}); } }).catch(() => {});
      return book;
    }

    function paint(book, s, body) {
      s.head.textContent = book.name;
      const kids = [], c = colours(), p = progress(book.road_list);
      // kept with a crew (migration 0063): its members add roads too, so it says whose crew it is
      const owner = book.mine ? (book.crew ? `Yours · with ${book.crew.name}` : `Yours · ${VIS[book.visibility]}`) : book.crew ? `${book.crew.name} · kept by @${book.by || '?'}` : `By @${book.by || '?'}`;
      kids.push(el('p', { className: 'rb-by', textContent: [owner, bookLine(book, fmtLen)].join(' · ') }));
      if (book.about) kids.push(el('p', { className: 'people-lead', textContent: book.about }));
      const map = overview(book.road_list, { line: c.line, hi: c.hi, width: 3.5, label: `${book.name}: its roads on a map` });
      if (map) {
        const box = svgBox('rb-map', map), frame = overviewFrame(book.road_list), svg = box.firstElementChild;
        kids.push(box);
        // the streets round the roads (post_map.js, as a Feed post's line): one still picture laid exactly under the lines
        if (page.mapUnder && frame && svg) Promise.resolve(page.mapUnder(`rb_${book.id}_${book.road_list.map((x) => x.id).join('.')}`, frame, 320, 150, 12)).then((url) => {
          if (!url || !box.isConnected) return;
          svg.style.backgroundImage = `url("${url}")`; box.classList.add('on-map');
        }).catch(() => {});
      }
      if (p.of && member()) {
        const meter = el('div', { className: 'rb-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.of), 'aria-valuenow': String(p.done), 'aria-label': p.text }, el('i', { style: `width:${(100 * p.done / p.of).toFixed(0)}%` }));
        kids.push(el('div', { className: 'stack-8' }, el('b', { textContent: p.text }), meter));   // the meter says it; the how-to line under it ("Nothing to tap") is gone
      }
      // keys: yours to run, or someone's to follow
      const keys = el('div', { className: 'row', style: 'flex-wrap:wrap' });
      // a book of roads is a day out: one drive through them, nearest first (tour), from where you are
      // with some driven already, the day out is the ones still to stamp ("Drive the 3 new"), and All stays a small key
      if (page.driveBook && (book.road_list || []).length > 1) {
        const fresh = book.road_list.filter((r) => r && !r.stamped), lead = book.mine || book.following || book.can_add ? 'ink-btn solid' : 'ink-btn';
        if (fresh.length > 1 && fresh.length < book.road_list.length) {
          keys.append(btn(`Drive the ${fresh.length} new`, () => { s.close(); page.driveBook({ ...book, road_list: fresh, onlyNew: true }); }, lead));
          const all = btn('All', () => { s.close(); page.driveBook(book); }, 'linkbtn'); all.setAttribute('aria-label', `Drive all ${book.road_list.length} roads`); keys.append(all);
        } else keys.append(btn('Drive them all', () => { s.close(); page.driveBook(book); }, lead));
      }
      if (book.mine) {
        keys.append(btn('Edit', () => edit(book, () => paint(book, s, body)), 'ink-btn'));
        // a public one's link shows its roads on the map in a chat (the card goes up as the link is copied)
        if (book.visibility !== 'private') keys.append(btn('Share', () => { card(book); page.copyText(link(page.origin(), book.id), 'Link copied. Anyone it is shown to can open it.', book.name); }, 'ink-btn'));
      } else if (!book.can_add) {
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
      } else if (page.report && member()) keys.append(btn('Report', () => page.report({ kind: 'roadbook', target: book.id, label: book.name, done: () => s.close() }), 'linkbtn'));
      kids.push(keys);
      // the roads
      const list = el('div', {});
      const roads = book.road_list || [];
      if (!roads.length) list.append(el('p', { className: 'note', textContent: book.can_add || book.mine ? 'No roads yet. Plan a route, press Share on its card, and add it to this roadbook.' : 'No roads in it yet.' }));
      roads.forEach((road, i) => {
        const T = page.thumb || root.ApexRouteThumb;
        const thumb = T ? T.svg(road.geom.map((q) => q[1]), road.geom.map((q) => q[0]), { w: 176, h: 120, pad: 12, line: road.stamped ? c.hi : c.line, hi: road.stamped ? c.hi : c.line, width: 4, label: `${road.name} on a map` }) : null;
        const tb = svgBox('rb-thumb', thumb), box = el('div', { className: 'rb-road' }, tb);
        // its own streets under it too, drawn once the row comes near the screen (a book holds up to 40)
        if (thumb && page.mapUnder) nearby(tb, () => Promise.resolve(page.mapUnder(`rbt_${road.id}`, overviewFrame([road]), 176, 120, 12)).then((url) => {
          const svg = tb.firstElementChild;
          if (!url || !svg || !tb.isConnected) return;
          svg.style.backgroundImage = `url("${url}")`; tb.classList.add('on-map');
        }).catch(() => {}));
        const title = el('div', { className: 'row', style: 'align-items:center;gap:8px;flex-wrap:wrap' }, el('b', { textContent: road.name }));
        if (road.stamped) title.append(el('span', { className: 'rb-stamp', textContent: 'Driven' }));
        const day = road.stamped ? stampDay(road.id) : null;
        const facts = [fmtLen(road.length_m), road.yours ? 'added by you' : road.added_by ? `added by @${road.added_by}` : null, road.stamps > 0 ? `${road.stamps} ${road.stamps === 1 ? 'member has' : 'members have'} driven it` : null,
          day && root.ApexFormat && root.ApexFormat.dayShort ? `you on ${root.ApexFormat.dayShort(day)}` : null].filter(Boolean).join(' · ');
        box.append(title, el('p', { className: 'note', textContent: facts }));
        if (road.note) box.append(el('p', { className: 'note', style: 'grid-column:2;color:var(--panel-ink)', textContent: road.note }));
        const acts = el('div', { className: 'rb-acts' }, btn('Drive it', () => { s.close(); page.driveRoad(road, book); }, 'ink-btn solid'));
        // a crew's book: drive the road together, a crew drive with it as the route
        if (book.crew && book.can_add && page.planCrewDrive) { const pc = btn('Crew drive', () => { s.close(); page.planCrewDrive(road, book.crew); }, 'linkbtn'); pc.setAttribute('aria-label', `Plan a crew drive on ${road.name}`); acts.append(pc); }
        const removeKey = () => {
          const rm = btn('Remove', async () => {
            const r = await call('DELETE', `/api/roadbooks/${encodeURIComponent(book.id)}/roads/${encodeURIComponent(road.id)}`);
            if (!r.ok) { toast(why(r, 'Couldn’t remove it. Try again.')); return; }
            roads.splice(i, 1); book.roads = roads.length; book.length_m = roads.reduce((a, x) => a + x.length_m, 0);
            paint(book, s, body); loadLists().then(() => page.changed && page.changed()).catch(() => {});
            toast(`${road.name} is out of ${book.name}.`);
          }, 'linkbtn');
          rm.setAttribute('aria-label', `Remove ${road.name}`);
          return rm;
        };
        if (book.mine) {
          const move = async (to) => {
            const order = roads.map((x) => x.id); order.splice(to, 0, order.splice(i, 1)[0]);
            const r = await call('PUT', `/api/roadbooks/${encodeURIComponent(book.id)}`, { order });
            if (!r.ok) { toast(why(r, 'Couldn’t move it. Try again.')); return; }
            roads.splice(to, 0, roads.splice(i, 1)[0]); paint(book, s, body);
          };
          if (i > 0) { const up = btn('Up', () => move(i - 1), 'linkbtn'); up.setAttribute('aria-label', `Move ${road.name} up`); acts.append(up); }
          if (i < roads.length - 1) { const dn = btn('Down', () => move(i + 1), 'linkbtn'); dn.setAttribute('aria-label', `Move ${road.name} down`); acts.append(dn); }
          acts.append(removeKey());
        } else if (road.yours) acts.append(removeKey());   // a crew-mate takes out the road they added
        box.append(acts);
        list.append(box);
      });
      kids.push(list);
      // your own stages (the Log's) go in with a tap: the road as you marked it, privacy zones left out
      if ((book.mine || book.can_add) && page.stages) {
        const have = new Set(roads.map((x) => x.name)), left = (page.stages() || []).filter((st) => st && st.name && st.geom && !have.has(String(st.name).slice(0, 60)));
        if (left.length) {
          const chips = el('div', { className: 'row rb-stages', style: 'flex-wrap:wrap' }), pick = el('div', { className: 'stack-8' }, el('h4', { textContent: 'Your stages' }), chips);
          pick.hidden = true;
          const more = btn('Add one of your stages', () => { more.hidden = true; pick.hidden = false; }, 'linkbtn');
          left.slice(0, 12).forEach((st) => {
            const b = btn(String(st.name).slice(0, 60), async () => {
              const geom = fromStage(st, page.zones ? page.zones() : []);
              if (!geom) { toast('That stage is too short to keep once your privacy zones are left out.'); return; }
              b.disabled = true;
              const r = await call('POST', `/api/roadbooks/${encodeURIComponent(book.id)}/roads`, { name: String(st.name).slice(0, 60), geom });
              if (!r.ok) { b.disabled = false; toast(r.status === 429 ? 'That roadbook is full (40 roads), or that’s enough for today.' : why(r, 'Couldn’t add it. Try again.')); return; }
              const f = await call('GET', `/api/roadbooks/${encodeURIComponent(book.id)}`);
              if (f.ok && f.data) Object.assign(book, f.data);
              paint(book, s, body); loadLists().then(() => page.changed && page.changed()).catch(() => {});
              toast(`${st.name} is in ${book.name}.`);
            }, 'ink-btn');
            chips.append(b);
          });
          kids.push(el('div', { className: 'stack-8' }, more, pick));
        }
      }
      body.replaceChildren(...kids);
    }

    /** The owner's sheet: name, a line about it, who sees it, delete. */
    function edit(book, done) {
      const s = sheet('Edit roadbook');
      const name = el('input', { className: 'field', value: book.name, maxLength: 60, autocomplete: 'off', 'aria-label': 'Roadbook name' });
      const about = el('textarea', { className: 'field', value: book.about || '', maxLength: 280, rows: 3, placeholder: 'What ties these roads together', 'aria-label': 'About this roadbook' });
      let vis = book.visibility, crew = book.crew ? book.crew.id : null;
      const sw = el('div', { className: 'switch', role: 'radiogroup', 'aria-label': 'Who sees it' }), says = el('p', { className: 'note' });
      const SAYS = { private: 'Only you see it.', friends: 'Your friends can open it, with your handle on it.', public: 'Anyone can open it by its link, and drivers near its roads can find it. Your handle is on it.' };
      const mark = () => { sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.vis === vis))); says.textContent = vis === 'private' && crew ? 'Only you and the crew see it.' : SAYS[vis]; };
      for (const v of Object.keys(VIS)) { const b = el('button', { type: 'button', role: 'radio', textContent: VIS[v] }); b.dataset.vis = v; b.addEventListener('click', () => { vis = v; mark(); }); sw.append(b); }
      mark();
      // kept with a crew you are in: its members open it and add roads (migration 0063); None takes it off again
      const crewSw = el('div', { className: 'switch', role: 'radiogroup', 'aria-label': 'Kept with a crew' }), crewSays = el('p', { className: 'note' });
      const crewPart = el('div', { className: 'stack-8' }, el('h4', { textContent: 'Crew' }), crewSw, crewSays);
      crewPart.hidden = true;
      let crewNames = {};
      const markCrew = () => { crewSw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.crew || null) === crew)));
        crewSays.textContent = crew ? `Everyone in ${crewNames[crew] || 'the crew'} can open it and add roads.` : 'Only you add roads.'; mark(); };
      call('GET', '/api/crews').then((r) => {
        const mine = r.ok && Array.isArray(r.data) ? r.data.filter((c) => c && c.id && c.name) : [];
        if (!mine.length && !crew) return;
        crewNames = Object.fromEntries(mine.map((c) => [c.id, c.name]));
        if (crew && !crewNames[crew]) crewNames[crew] = book.crew.name;
        for (const [id, label] of [[null, 'None'], ...Object.entries(crewNames)]) {
          const b = el('button', { type: 'button', role: 'radio', textContent: label });
          if (id) b.dataset.crew = id;
          b.addEventListener('click', () => { crew = id; markCrew(); }); crewSw.append(b);
        }
        markCrew(); crewPart.hidden = false;
      }).catch(() => {});
      const save = btn('Save', async () => {
        const change = {};
        if (crew !== (book.crew ? book.crew.id : null)) change.crew = crew;
        if (name.value.trim() && name.value.trim() !== book.name) change.name = name.value.trim();
        if ((about.value.trim() || null) !== (book.about || null)) change.about = about.value.trim();
        if (vis !== book.visibility) change.visibility = vis;
        if (!Object.keys(change).length) { s.close(); return; }
        const r = await call('PUT', `/api/roadbooks/${encodeURIComponent(book.id)}`, change);
        if (!r.ok) { toast(why(r, 'Couldn’t save it. Try again.')); return; }
        const { crew: _c, ...rest } = change;
        Object.assign(book, rest, { about: about.value.trim() || null });
        if ('crew' in change) { book.crew = crew ? { id: crew, name: crewNames[crew] } : null; book.can_add = true; }
        if (change.visibility === 'private') book.followers = 0;
        s.close(); done(); loadLists().then(() => page.changed && page.changed()).catch(() => {});
        if (book.visibility === 'public') card(book);
        toast(change.visibility === 'public' ? `${book.name} is public. Share its link, or let drivers nearby find it.` : change.crew ? `${crewNames[crew]} can add roads to ${book.name} now.` : 'Saved.');
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
      s.pop.append(el('div', { className: 'stack-12' }, name, about, el('h4', { textContent: 'Who sees it' }), sw, says, crewPart,
        el('p', { className: 'note', textContent: 'Roads only: no times, dates or speeds.' }), el('div', { className: 'row' }, save), del));
    }

    /** Makes a book. → its id, or null (the reason is toasted). */
    async function create(name, visibility = 'private', crew = null) {
      const n = String(name || '').trim();
      if (!n) { toast('Give the roadbook a name.'); return null; }
      const r = await call('POST', '/api/roadbooks', crew ? { name: n, visibility, crew } : { name: n, visibility });
      if (!r.ok || !r.data) { toast(why(r, r.status === 401 || r.status === 403 ? 'Sign in to keep a roadbook.' : 'Couldn’t make the roadbook. Try again.')); return null; }
      return r.data.id;
    }
    const newForm = (label, then, crew = null) => {
      const name = el('input', { className: 'field', placeholder: 'Name, like Smokies classics', maxLength: 60, autocomplete: 'off', 'aria-label': 'New roadbook name' });
      const go = btn(label, async () => { go.disabled = true; const id = await create(name.value, 'private', crew); go.disabled = false; if (id) { name.value = ''; then(id, name); } }, 'ink-btn solid');
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      return el('div', { className: 'row' }, name, go);
    };

    /** People's Roadbooks sheet: yours, the ones you follow, public ones near you. count(text) gets the row's small line. */
    function section(count) {
      const sec = el('div', { className: 'stack-12' }, el('h3', { textContent: 'Roadbooks' }));
      const mineBox = el('div', {}), crewBox = el('div', {}), followBox = el('div', {}), friendsBox = el('div', {}), nearBox = el('div', { className: 'stack-8' });
      let friendBooks = [];
      const lead = el('p', { className: 'people-lead', textContent: 'Your lists of great roads, for you, friends or everyone.' });
      const fill = (data) => {
        const mine = data ? data.mine : [], fol = data ? data.following : [], crews = (data && data.crews) || [];
        lead.hidden = !!(mine.length || fol.length || crews.length);   // what a roadbook is, said until you have one
        if (count) count(countLine(data));
        const sub = (b) => [b.mine ? (b.crew ? b.crew.name : VIS[b.visibility]) : b.crew ? b.crew.name : `@${b.by || '?'}`, bookLine(b, fmtLen), progress(b.road_list).done ? progress(b.road_list).text : ''].filter(Boolean).join(' · ');
        mineBox.replaceChildren(...(mine.length ? mine.map((b) => row(b, sub(b), () => open(b.id))) : []));
        // your friends' books you don't follow yet (GET /api/roadbooks/friends): without it a friends book opened only by its link
        const fresh = friendBooks.filter((b) => !fol.some((x) => x.id === b.id));
        friendsBox.replaceChildren(...(fresh.length ? [el('h4', { className: 'rb-h', textContent: 'From friends', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), ...fresh.map((b) => row(b, sub(b), () => open(b.id)))] : []));
        crewBox.replaceChildren(...(crews.length ? [el('h4', { className: 'rb-h', textContent: 'Your crews’', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), ...crews.map((b) => row(b, sub(b), () => open(b.id)))] : []));
        followBox.replaceChildren(...(fol.length ? [el('h4', { className: 'rb-h', textContent: 'Following', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), ...fol.map((b) => row(b, sub(b), () => open(b.id)))] : []));
      };
      liveFill = fill;
      const reload = () => loadLists().then((d) => { if (!d) fill(null); return d; });
      sec.append(lead,
        newForm('New roadbook', (id) => { reload().then(() => page.changed && page.changed()); open(id); }), mineBox, crewBox, followBox, friendsBox,
        el('h4', { textContent: 'Near you', style: 'margin:12px 0 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--panel-dim)' }), nearBox);
      if (lists) fill(lists);
      reload().catch((e) => console.error('roadbooks', e));
      call('GET', '/api/roadbooks/friends').then((r) => { if (r.ok && Array.isArray(r.data)) { friendBooks = r.data; fill(lists); } }).catch(() => {});
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
    // what goes in: the planned route (its first 400 m and your privacy zones left out), or src() → { name, geom } | null
    const plannedRoad = () => { const t = page.planned && page.planned(), geom = t ? fromTrack(t, page.zones ? page.zones() : []) : null; return geom ? { name: t.name, geom } : null; };
    function addPart(done, src = plannedRoad, say = 'Or keep it in a roadbook. Its first 400 m and your privacy zones are left out.') {
      if (!member()) return null;
      const part = el('div', { className: 'stack-8 rb-add' }, el('p', { className: 'note', textContent: say }));
      const chips = el('div', { className: 'row', style: 'flex-wrap:wrap' });
      const addTo = async (id, bookName) => {
        const t = src();
        if (!t) { toast('This road is too short to keep once its private ends are left out.'); return; }
        const r = await call('POST', `/api/roadbooks/${encodeURIComponent(id)}/roads`, { name: String(t.name || 'Road').slice(0, 60), geom: t.geom });
        if (!r.ok) { toast(r.status === 429 ? 'That roadbook is full (40 roads), or that’s enough for today.' : why(r, 'Couldn’t add it. Try again.')); return; }
        loadLists().then(() => page.changed && page.changed()).catch(() => {});
        toast(`Added to ${bookName}.`, { label: 'Open', onClick: () => open(id) });
        if (done) done();
      };
      const fillChips = (data) => chips.replaceChildren(...((data ? [...data.mine, ...(data.crews || [])] : []).map((b) => btn(b.name, () => addTo(b.id, b.name), 'ink-btn'))));
      if (lists) fillChips(lists);
      loadLists().then(fillChips).catch(() => {});
      part.append(chips, newForm('New roadbook', (id, input) => addTo(id, (input && input.value) || 'your new roadbook')));
      // the new book's name for the toast: read before the form clears it
      const form = part.lastChild, nameIn = form.querySelector('input'), goBtn = form.querySelector('button');
      goBtn.onclick = async () => { const n = nameIn.value.trim(); goBtn.disabled = true; const id = await create(n); goBtn.disabled = false; if (id) { nameIn.value = ''; addTo(id, n); } };
      return part;
    }

    /**
     * Keep in a roadbook, from a Feed post's ···: the line as it was posted (pts [[lat, lon]], its owner's private ends
     * already cut), without anything inside your own privacy zones; nothing else of the drive goes in. → false signed out.
     */
    function keep(name, pts) {
      if (!member()) { toast('Sign in to keep roads in a roadbook.'); return false; }
      const geom = fromStage({ geom: pts }, page.zones ? page.zones() : []);
      if (!geom) { toast('This road is too short to keep once your privacy zones are left out.'); return false; }
      const s = sheet('Keep in a roadbook');
      const part = addPart(s.close, () => ({ name, geom }), `${String(name || 'This road').slice(0, 60)}: its line goes in, nothing else of the drive.`);
      s.pop.append(part);
      return true;
    }

    /** A friend's profile: their books you may open (GET /api/roadbooks/friends, by their handle), each a row that opens it.
     *  An element that stays empty (and hidden) when they have none. */
    function ofFriend(handle) {
      const box = el('div', { className: 'stack-8 rb-of-friend' });
      box.hidden = true;
      const h = String(handle || '').toLowerCase();
      call('GET', '/api/roadbooks/friends').then((r) => {
        const theirs = r.ok && Array.isArray(r.data) ? r.data.filter((b) => String(b.by || '').toLowerCase() === h) : [];
        if (!theirs.length || !h) return;
        box.replaceChildren(el('b', { textContent: 'Roadbooks' }), ...theirs.map((b) => row(b, bookLine(b, fmtLen), () => open(b.id))));
        box.hidden = false;
      }).catch(() => {});
      return box;
    }

    /**
     * A crew page's Roadbooks (GET /api/crews/:id/roadbooks): the books members keep with the crew, each open to every member
     * to add roads to, and a form to start one. c: { id, name }. Signed out → null.
     */
    function ofCrew(c) {
      if (!member() || !c || !c.id) return null;
      const box = el('div', { className: 'stack-8 rb-of-crew' }), rows = el('div', {});
      const lead = el('p', { className: 'note', textContent: 'Great roads the crew keeps together. Tap + to start one; everyone adds roads.' });
      const load = () => call('GET', `/api/crews/${encodeURIComponent(c.id)}/roadbooks`).then((r) => {
        const l = r.ok && Array.isArray(r.data) ? r.data : [];
        lead.hidden = l.length > 0;
        rows.replaceChildren(...l.map((b) => row(b, [`@${b.by || '?'}`, bookLine(b, fmtLen)].join(' · '), () => open(b.id))));
      }).catch(() => {});
      // headed like the page's other sections, with a + in its corner (as Upcoming drives) that opens the name field
      const form = newForm('Start one', (id) => { form.hidden = true; plus.hidden = false; load(); loadLists().then(() => page.changed && page.changed()).catch(() => {}); open(id); }, c.id);
      form.hidden = true;
      const plus = el('button', { type: 'button', className: 'icon-btn plan-plus', 'aria-label': `Start a roadbook for ${c.name || 'the crew'}`, innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' });
      plus.addEventListener('click', () => { plus.hidden = true; form.hidden = false; const i = form.querySelector('input'); if (i) i.focus(); });
      box.append(el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Roadbooks' }), plus), lead, rows, form);
      load();
      return box;
    }
    const countLine = (l) => !l ? '' : [l.mine.length ? `${l.mine.length} yours` : '', (l.crews || []).length ? `${l.crews.length} crew` : '', l.following.length ? `${l.following.length} followed` : ''].filter(Boolean).join(' · ');

    /** Has this member any book of their own or followed (as last read, or as this phone kept it)? People shows the row then. */
    const hasAny = () => { const l = lists || readJson(CACHE_KEY, null); return !!l && ((l.books && l.books.length > 0) || (l.mine && (l.mine.length + l.following.length + (l.crews || []).length) > 0)); };
    /** A planned route: the roads of your books (yours, followed, your crews') it drives. Opens only the books with a road
     *  whose box meets the route's, at most ALONG_OPEN, each once a page. → onRoute's list. */
    const opened = new Map();
    async function alongRoute(lat, lon) {
      if (!member()) return [];
      const l = lists || await loadLists().catch(() => null);
      if (!l) return [];
      const box = boxOf(lat, lon);
      const books = [...l.mine, ...(l.crews || []), ...l.following].filter((b) => b && (b.road_list || []).some((r) => overlaps(r.box, box))).slice(0, ALONG_OPEN);
      await Promise.all(books.filter((b) => !opened.has(b.id)).map(async (b) => {
        const r = await call('GET', `/api/roadbooks/${encodeURIComponent(b.id)}`);
        if (r.ok && r.data && Array.isArray(r.data.road_list)) opened.set(b.id, r.data);
      }));
      return onRoute(books.map((b) => opened.get(b.id)).filter(Boolean), lat, lon);
    }

    return { section, nearSection, open, addPart, keep, ofFriend, ofCrew, countLine, afterDrive, scanLog, hasAny, alongRoute, forgetOpened: () => opened.clear(), lists: () => lists, reload: loadLists };
  }

  const api = { onRoute, routeLine, fromTrack, fromStage, coverage, overlaps, boxOf, lengthM, progress, bookLine, cardLines, CARD, overview, overviewFrame, tour, link, mount, TOUR_MAX, STAMP_AT, TRIM_M, MAX_POINTS, MIN_ROAD_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadbooks = api;
})(typeof window !== 'undefined' ? window : globalThis);
