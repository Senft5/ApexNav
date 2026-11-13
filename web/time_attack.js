// Time attack (docs/SOCIAL.md 2.9, IDEAS S-26; backend/src/ta_fixed.ts). The owner, 2026-11-12: "time attacks should just be
// static best roads maybe changing every few months or something or rotating highlighted time attacks, with a leaderboard
// that you can view by week; month; year; all time". Each area (a quarter-degree square, the router's road tile, near you)
// has up to three loops a season (a calendar quarter), one featured each week in turn. No one picks them: the first phone
// in the area is handed a slot's seed and builds it with Vetta's own router (makeLoop: a start drawn from the seed among the
// area's road tiles, away from the area's other loops, the router's best loop from there), and the server keeps the first
// that checks out. Enter puts one in your Stages; the Log sends your quickest timed run on it each day, and its board shows
// every entrant by handle, quickest first, with the gap and that run's Vetta Score, for the week, month, year or all time.
// The pure parts (clock, gap, runsToSend, localCopy, areaPoint, rng, hubs, choose, geomOf, loopName, featuredWeek,
// seasonFoot) are tested in tests/test_time_attack.py; mount() draws the section, in Where to? beside Spots near you.
(function (root) {
  'use strict';

  /** Seconds as a stage clock: 75 → "1:15", 3725 → "1:02:05"; unknown stays "--". */
  function clock(s) {
    if (!Number.isFinite(s) || s < 0) return '--';
    const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
  }
  /** The gap to the quickest: 0 → "" (you are the time), 3 → "+0:03". */
  const gap = (s) => (Number.isFinite(s) && s > 0 ? '+' + clock(s) : '');
  /** Days left in the week, today included: "2026-11-13" to "2026-11-15" → 3. */
  function daysLeft(today, endsOn) {
    const a = Date.parse(today + 'T00:00:00Z'), b = Date.parse(endsOn + 'T00:00:00Z');
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86400000) + 1) : null;
  }
  /**
   * The middle of the area a point is in: the server needs only the area, so the phone never sends where it is. The area
   * is a quarter-degree square (AREA_DEG, about 28 by 22 km; time_attack.ts cellOf), the router's own road tile, so the
   * week's loop is near you (the owner, TestFlight 2026-11-12: a loop in a 1-degree square was "an hour away").
   */
  const AREA_DEG = 0.25;
  const areaPoint = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    ? { lat: Math.floor(p.lat / AREA_DEG) * AREA_DEG + AREA_DEG / 2, lon: Math.floor(p.lon / AREA_DEG) * AREA_DEG + AREA_DEG / 2 } : null);

  /**
   * The runs to send: for each synced stage that is (a copy of) a circuit you entered ({id, since}: the day you entered),
   * its quickest timed pass on each day from `from` (and the day before you entered, at the earliest) to `until`, newest
   * days first (the server keeps your quickest each day, so a board reads for any week, month or year). passesOf(seg) →
   * [{p: {score, time_s}, d: {date}}] as the Log has them. At most 20 (one request).
   */
  function runsToSend(circuits, segs, passesOf, from, until) {
    const since = new Map((circuits || []).map((c) => [c.id || c.segment_id, c.since || null]));
    const out = [];
    for (const s of segs || []) {
      const key = s && (s.origin || s.id);
      if (!s || !s.synced || !since.has(key)) continue;
      const entered = since.get(key), first = entered && /^\d{4}-\d{2}-\d{2}$/.test(entered) ? new Date(Date.parse(entered + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) : '';
      const lo = first > from ? first : from, best = new Map();
      for (const x of passesOf(s) || []) {
        if (!x || !x.p || !Number.isFinite(x.p.time_s) || x.p.time_s < 10 || !x.d || !/^\d{4}-\d{2}-\d{2}/.test(x.d.date || '')) continue;
        const day = x.d.date.slice(0, 10);
        if (day < lo || day > until) continue;
        if (!best.has(day) || x.p.time_s < best.get(day).p.time_s) best.set(day, x);
      }
      for (const [day, x] of best) out.push({ segment_id: s.id, time_s: Math.round(x.p.time_s), driver_score: Number.isFinite(x.p.score) ? Math.round(x.p.score) : null, driven_on: day });
    }
    return out.sort((a, b) => (a.driven_on < b.driven_on ? 1 : a.driven_on > b.driven_on ? -1 : 0)).slice(0, 20);
  }
  /** The board's periods, as the switch says them, and in a sentence ("No times this week yet."). */
  const PERIOD_KEYS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']];
  const PERIOD_NAME = { week: 'this week', month: 'this month', year: 'this year', all: 'on it' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** The section's foot: when the loops change ("New loops in January"), from the season's last day; the law, always. */
  function seasonFoot(endsOn) {
    const t = Date.parse(String(endsOn || '') + 'T00:00:00Z');
    const next = Number.isFinite(t) ? MONTHS[new Date(t + 86400000).getUTCMonth()] : null;
    return `Featured changes Mondays.${next ? ` New loops in ${next}.` : ''} Drive within the law.`;
  }
  /**
   * The featured loop as one week's time attack, from GET /api/ta: { week, ends_on (its Sunday), today, cell, circuit
   * {segment_id, name, length_m, geom}, entered, entrants, you } (this week's board, read only when it is the featured
   * one's), for the Where to? line and the deck. circuit null when the area has none.
   */
  function featuredWeek(t) {
    if (!t || !Array.isArray(t.circuits)) return null;
    const f = t.circuits.find((c) => c.featured) || null, b = t.board && f && t.board.id === f.id && t.board.period === 'week' ? t.board : null;
    const w = Date.parse(String(t.week || '') + 'T00:00:00Z');
    return { week: t.week, ends_on: Number.isFinite(w) ? new Date(w + 6 * 86400000).toISOString().slice(0, 10) : null, today: t.today, cell: t.cell,
      circuit: f ? { segment_id: f.id, name: f.name, length_m: f.length_m, geom: f.geom } : null, entered: !!(f && f.entered),
      entrants: b ? b.entrants : 0, you: b ? b.you : null };
  }
  /** The stage as the Log keeps it, from the circuit and the id of your copy (geom is [[lat, lon], ...]). */
  function localCopy(c, id) {
    let g = [];
    try { g = JSON.parse(c.geom) || []; } catch (_) {}
    if (!g.length) return null;
    const [a, b] = [g[0], g[g.length - 1]];
    return { id, name: c.name, length_m: c.length_m, geom: c.geom, lat0: a[0], lon0: a[1], lat1: b[0], lon1: b[1], origin: c.segment_id, synced: true };
  }
  /** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
  const nth = (n) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; };
  /**
   * Your place after a drive, from POST /api/timeattack/runs places [{name, place, of, time_s, gap_s}]: one sentence per
   * loop ("East Greenwood Church Road loop: you're 3rd of 12 this week, 1:02 off the lead (12:41)."). '' when unknown.
   */
  function placeLine(p) {
    if (!p || !Number.isFinite(p.place) || !Number.isFinite(p.of) || p.place < 1 || p.of < 1) return '';
    const name = typeof p.name === 'string' && p.name ? p.name : 'The loop', t = clock(p.time_s);
    if (p.of === 1) return `${name}: the first time on the board this week (${t}).`;
    if (p.place === 1) return `${name}: you're quickest of ${p.of} this week (${t}).`;
    return `${name}: you're ${nth(p.place)} of ${p.of} this week, ${clock(p.gap_s)} off the lead (${t}).`;
  }
  /**
   * The Where to? row's line for this week, from GET /api/timeattack: the loop's name and your place, or what to do next.
   * null while there is nothing to say yet (no answer, no loop): the row keeps its plain line.
   */
  function summaryLine(t, dist) {
    const c = t && t.circuit;
    if (!c) return null;
    const left = daysLeft(t.today, t.ends_on), when = left == null ? '' : left === 1 ? ' · last day' : ` · ${left} days left`;
    const len = dist && Number.isFinite(c.length_m) ? ` (${dist(c.length_m)})` : '';
    if (t.you && Number.isFinite(t.you.place)) return `Time attack: ${c.name} · you're ${nth(t.you.place)} of ${t.entrants}${when}`;
    if (t.entered) return `Time attack: ${c.name}${len} · log a run on it${when}`;
    return `Time attack: ${c.name}${len}${t.entrants ? ` · ${t.entrants} ${t.entrants === 1 ? 'time' : 'times'}` : ''}${when}`;
  }
  // ---- building the week's loop ----------------------------------------------------------------------------------------
  /** A random number stream from a seed string (FNV-1a, then mulberry32): every phone draws the same from the same seed. */
  function rng(seed) {
    let h = 0x811c9dc5;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    let a = h || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const TILE_DEG = 0.25;
  /**
   * Where a loop may start: `n` points in the area `cell` ('lat,lon', its south-west corner), drawn from the seed, away from
   * its edges (the middle half), so it is near everyone in the area; the router starts each on the nearest through road (graph_router.js req.through). [] where the router has
   * no tiles for the area (keys: "i_j", i from longitude, j from latitude, graph_tiles.js).
   */
  function hubs(keys, cell, seed, n = 6) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(cell || ''));
    if (!m) return [];
    const [la, lo] = [+m[1], +m[2]];
    const key = `${Math.floor((lo + 180) / TILE_DEG + 1e-9)}_${Math.floor((la + 90) / TILE_DEG + 1e-9)}`;
    if (!(keys || []).includes(key)) return [];
    const r = rng(seed + '|hub'), out = [];
    for (let k = 0; k < n; k++) out.push({ key: `${key}#${k}`, lat: la + AREA_DEG * (0.25 + 0.5 * r()), lon: lo + AREA_DEG * (0.25 + 0.5 * r()) });
    return out;
  }
  /**
   * Too much neighbourhood street for a time attack (the owner, TestFlight 2026-11-12: "goes only through a neighborhood"):
   * more than STREET_MAX_M or STREET_MAX_SHARE of it (graph_router.js loopRoute streetM, streetShare). A loop the router
   * didn't measure is refused too: unknown isn't clean.
   */
  const STREET_MAX_M = 500, STREET_MAX_SHARE = 0.05;
  const streety = (r) => !Number.isFinite(r.streetM) || !Number.isFinite(r.streetShare) || r.streetM > STREET_MAX_M || r.streetShare > STREET_MAX_SHARE;
  /** The length to ask the router for at a hub: drawn from the seed in km {min, max}. */
  const kmFor = (km, seed, hub) => { const r = rng(`${seed}|km|${hub.key}`)(); return Math.round(km.min + r * (km.max - km.min)); };
  /**
   * One of the router's loops (best first, as graph_router.js loop ranks them): among the best `top` that are 5 to 25 km,
   * one drawn from the seed. Its route.coords are [[lon, lat]]; null when none fits.
   */
  function choose(routes, seed, top = 3) {
    const fit = (routes || []).filter((r) => r && r.route && Array.isArray(r.route.coords) && r.route.coords.length > 9
      && Number.isFinite(r.distM) && r.distM >= 5000 && r.distM <= 25000 && !streety(r)).slice(0, top);
    return fit.length ? fit[Math.floor(rng(seed + '|pick')() * fit.length)] : null;
  }
  /** A fixed loop starts this far from the area's others (the server asks 3 km: a margin for the start moving onto a road). */
  const AVOID_M = 3200;
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * 111195, (b[1] - a[1]) * 111195 * Math.cos(a[0] * Math.PI / 180));
  /** The loop's line for the server: [[lat, lon], ...] at 5 decimals, a point every 20 m or more, 5000 at most, closed on its start. */
  function geomOf(coords) {
    const pts = (coords || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [Math.round(p[1] * 1e5) / 1e5, Math.round(p[0] * 1e5) / 1e5]);
    if (pts.length < 2) return [];
    const out = [pts[0]];
    for (const p of pts.slice(1, -1)) if (metres(out[out.length - 1], p) >= 20) out.push(p);
    out.push(pts[pts.length - 1]);
    const step = Math.ceil(out.length / 5000);
    const thin = step > 1 ? out.filter((_, i) => i % step === 0 || i === out.length - 1) : out;
    if (metres(thin[0], thin[thin.length - 1]) > 1) thin.push(thin[0]);   // back on the start: the stage's start and end gate are one
    return thin;
  }
  /**
   * The loop's name, from its roads ("Dry Ridge Road loop"): the first good road it was built through, else the road it
   * drives longest (r.names [{name, fromM, toM}], graph_router.js); "Local loop" when its roads have no names.
   */
  function loopName(r) {
    let n = ((r && r.stages) || []).find((x) => typeof x === 'string' && x.trim());
    if (!n && r && Array.isArray(r.names)) {
      const km = new Map();
      for (const x of r.names) if (x && typeof x.name === 'string' && x.name.trim()) km.set(x.name.trim(), (km.get(x.name.trim()) || 0) + ((x.toM - x.fromM) || 0));
      const top = [...km].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      n = top ? top[0] : null;
    }
    return n ? `${n.trim().slice(0, 54)} loop` : 'Local loop';
  }
  /**
   * Builds this week's loop for the area and offers it: t is GET /api/timeattack's answer (with `make`), o.keys() → the road
   * tiles the router has (a Set of "i_j"), o.loops(start, km) → the router's loops, o.post(body) → the server's answer.
   * Tries up to six starts in the area; → the server's { circuit, kept } or null where no loop could be made here.
   */
  async function makeLoop(t, o) {
    if (!t || !t.make || !o) return null;
    const { seed, km, slot, best, avoid } = t.make;
    let keys = null;
    try { keys = await o.keys(); } catch (_) { keys = null; }
    // a fixed loop (ta_fixed.ts): the router's best from each start, never from within AVOID_M of the area's other loops
    const others = Array.isArray(avoid) ? avoid.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
    const away = (g) => others.every((p) => metres(p, g) >= AVOID_M);
    for (const hub of hubs(keys ? Array.from(keys) : [], t.cell, seed, others.length ? 10 : 6)) {
      if (!away([hub.lat, hub.lon])) continue;
      let routes = [];
      try { routes = await o.loops({ lat: hub.lat, lon: hub.lon }, kmFor(km, seed, hub)); } catch (_) { routes = []; }
      const r = choose(routes, `${seed}|${hub.key}`, best ? 1 : 3);
      if (!r) continue;
      const geom = geomOf(r.route.coords);
      if (geom.length < 10 || !away(geom[0])) continue;
      if (o.note) try { o.note({ distM: r.distM, streetM: r.streetM, streetShare: r.streetShare, start: hub.key }); } catch (_) {}
      return o.post({ cell: t.cell, seed, name: loopName(r), geom, ...(Number.isInteger(slot) ? { slot } : {}) });
    }
    return null;
  }

  const STYLE = `
    .ta-board { display: grid; grid-template-columns: auto 1fr auto auto; gap: 4px 10px; align-items: baseline; font-variant-numeric: tabular-nums; }
    .ta-board .me { font-weight: 700; }
    .ta-board .gap, .ta-board .sc { color: var(--panel-dim); font-size: 13px; }
    .ta-loops { display: grid; gap: 6px; }
    .ta-loop { display: grid; gap: 2px; text-align: left; padding: 8px 10px; min-height: 44px; border: 1.5px solid var(--panel-dim); border-radius: 8px; background: none; color: inherit; font: inherit; }
    .ta-loop.on { border-color: var(--panel-ink); box-shadow: inset 0 0 0 1px var(--panel-ink); }
    .ta-loop small { color: var(--panel-dim); font-size: 13px; }
  `;
  /**
   * page: el, btn, toast, apiCall(method, path, body) → Response, jsonOf, here() → {lat, lon}|null, goTo({label, lat, lon}),
   * report, ask(text, action) → Promise<boolean> (ApexConfirm.ask), segs() → the Log's stages, saveSegs(list), fmtKm(km) → "4.2 mi".
   */
  function mount(page) {
    const { el, btn, toast } = page;
    if (root.document && !root.document.getElementById('timeAttackStyle')) root.document.head.append(el('style', { id: 'timeAttackStyle', textContent: STYLE }));
    const dist = (m) => (page.fmtKm ? page.fmtKm(m / 1000) : `${(m / 1000).toFixed(1)} km`);
    const say = (code) => toast(code === 'handle_required' ? 'Pick a handle in People first: the board names people by handle.'
      : 'Couldn’t do that. Try again.');
    const tried = new Set();                                       // seeds this phone already tried to build a loop from
    async function call(method, path, body) {
      let r = null;
      try { r = await page.apiCall(method, path, body); } catch (_) {}
      const j = r ? await page.jsonOf(r) : null;
      return { ok: !!(r && r.ok), status: r ? r.status : 0, j, code: j && j.error };
    }
    // Fixed time attacks (backend/src/ta_fixed.ts; the owner, 2026-11-12: "static best roads ... rotating highlighted time
    // attacks, with a leaderboard that you can view by week; month; year; all time"): the area's loops this season, the
    // featured one first picked, one board with a Week / Month / Year / All time switch. What you picked stays while the app runs.
    let pickedId = null, period = 'week';
    function section() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Time attack' }));
      const body = el('div', { className: 'stack-8' });
      sec.append(body);
      const load = async () => {
        const at = areaPoint(page.here());
        if (!at) { body.replaceChildren(el('p', { className: 'note', textContent: 'Waiting for your position.' })); return; }
        const q = `/api/ta?lat=${at.lat}&lon=${at.lon}&period=${period}${pickedId ? `&id=${encodeURIComponent(pickedId)}` : ''}`;
        let r = await call('GET', q);
        if (r.status === 404 && pickedId) { pickedId = null; r = await call('GET', `/api/ta?lat=${at.lat}&lon=${at.lon}&period=${period}`); }   // taken down since
        if (!r.ok || !r.j) { body.replaceChildren(el('p', { className: 'note', textContent: r.status === 401 || r.status === 403 ? 'Sign in to see the time attacks here.' : 'Couldn’t load the time attacks. Try again later.' })); return; }
        if (r.j.make && page.loops && !tried.has(r.j.make.seed)) {
          // a loop missing in the area this season: this phone builds it from the slot's seed, then looks again (the next slot)
          tried.add(r.j.make.seed);
          if (!r.j.circuits.length) body.replaceChildren(el('p', { className: 'note', textContent: 'Picking the best loops in the area…' }));
          const made = await makeLoop(r.j, { keys: page.graphKeys || (() => null), loops: page.loops, note: page.noteLoop,
            post: async (b) => { const p = await call('POST', '/api/ta/circuit', b); return p.ok ? p.j : null; } });
          if (made && made.circuit) { load(); return; }
        }
        draw(r.j);
      };
      function draw(t) {
        // the Where to? row's line is the featured loop this week: said again only from its own week's board
        const feat = (t.circuits || []).find((x) => x.featured);
        if (page.line && (!t.board || !feat || (t.board.id === feat.id && t.board.period === 'week'))) page.line(summaryLine(featuredWeek(t), dist));
        const kids = [], list = t.circuits || [], b = t.board;
        if (!list.length) {
          kids.push(el('p', { className: 'note', textContent: t.make ? 'Vetta’s road map doesn’t reach this area yet.' : 'This area’s loops are being looked at after reports.' }));
          body.replaceChildren(...kids);
          return;
        }
        const c = list.find((x) => b && x.id === b.id) || list.find((x) => x.featured) || list[0];
        // the loops: one row each, the one shown pressed; Featured on this week's
        const loops = el('div', { className: 'ta-loops', role: 'group', 'aria-label': 'Loops in this area' });
        for (const x of list) {
          const k = el('button', { type: 'button', className: 'ta-loop' + (x === c ? ' on' : '') },
            el('b', { textContent: x.name }), el('small', { textContent: [dist(x.length_m), x.featured ? 'Featured this week' : null, x.entered ? 'Entered' : null].filter(Boolean).join(' · ') }));
          k.setAttribute('aria-pressed', String(x === c));
          k.addEventListener('click', () => { if (x === c) return; pickedId = x.id; load(); });
          loops.append(k);
        }
        kids.push(loops);
        // the board's period: a switch, as the meet card's answer is
        const sw = el('div', { className: 'switch ta-period', role: 'radiogroup', 'aria-label': 'Times from' });
        for (const [k, label] of PERIOD_KEYS) {
          const key = btn(label, () => { if (period === k) return; period = k; pickedId = c.id; load(); }, '');
          key.setAttribute('role', 'radio'); key.setAttribute('aria-checked', String(period === k));
          sw.append(key);
        }
        let g = [];
        try { g = JSON.parse(c.geom) || []; } catch (_) {}
        const acts = el('div', { className: 'row', style: 'flex-wrap:wrap' });
        if (c.entered) {
          // the loop itself as the route when the page can plan it (cockpit driveLoop), else the way to its start
          if (g.length && page.driveLoop) acts.append(btn('Drive it', () => page.driveLoop({ segment_id: c.id, name: c.name }, g), 'ink-btn'));
          else if (g.length && page.goTo) acts.append(btn('Drive it', () => page.goTo({ label: c.name, lat: g[0][0], lon: g[0][1] }), 'ink-btn'));
          // a duel on the loop with a friend (duels.js challengeOn): your copy's stage id, which entering again hands back
          if (page.challenge) acts.append(btn('Challenge a friend', async () => {
            const r = await call('POST', '/api/ta/enter', { id: c.id });
            if (!r.ok || !r.j || !r.j.segment_id) { say(r.code); return; }
            page.challenge({ id: r.j.segment_id, name: c.name });
          }, 'linkbtn'));
        } else {
          acts.append(btn('Enter', async () => {
            const r = await call('POST', '/api/ta/enter', { id: c.id });
            if (!r.ok) { say(r.code); return; }
            if (r.j && r.j.added && page.segs && page.saveSegs) {
              const segs = page.segs(), copy = localCopy({ ...c, segment_id: c.id }, r.j.segment_id);
              if (copy && !segs.some((s) => s.id === copy.id)) { segs.push(copy); page.saveSegs(segs); }
            }
            toast('Entered. Your timed runs on it count from now.');
            pickedId = c.id; load();
          }, 'ink-btn'));
        }
        if (page.report) acts.append(btn('Report', () => page.report({ kind: 'circuit', target: c.id, label: c.name, done: load }), 'linkbtn'));
        kids.push(acts, sw);   // what you do with the loop under it, then the board with its period right above it
        const rows = b ? b.rows : [];
        if (rows.length) {
          const grid = el('div', { className: 'ta-board', role: 'table', 'aria-label': `Times on ${c.name}, ${PERIOD_NAME[period]}` });
          const row = (x) => [el('span', { textContent: String(x.place), className: x.mine ? 'me' : '' }), el('span', { textContent: '@' + x.handle, className: x.mine ? 'me' : '' }),
            el('span', { textContent: clock(x.time_s) + (x.gap_s ? ' ' : ''), className: x.mine ? 'me' : '' }, el('span', { className: 'gap', textContent: gap(x.gap_s) })),
            el('span', { className: 'sc', textContent: x.score == null ? '' : `Score ${x.score}` })];
          for (const x of rows) grid.append(...row(x));
          if (b.you && !rows.some((x) => x.mine)) grid.append(...row(b.you));
          kids.push(grid);
        } else {
          kids.push(el('p', { className: 'note', textContent: `No times ${PERIOD_NAME[period]} yet.` }));
        }
        if (b && b.you) kids.push(btn('Take my times off', async () => {
          if (page.ask && !(await page.ask(`Take all your times on ${c.name} off its boards?`, 'Take them off'))) return;
          const r = await call('DELETE', `/api/ta/entry?id=${encodeURIComponent(c.id)}`);
          toast(r.ok ? 'Your times are off the board.' : 'Couldn’t take them off. Try again.');
          load();
        }, 'linkbtn'));
        kids.push(el('p', { className: 'note', textContent: seasonFoot(t.ends_on) }));
        body.replaceChildren(...kids);
      }
      load();
      return sec;
    }
    /**
     * The Where to? row's line without opening it (summaryLine), at most once in PEEK_MS: only the area goes, as for the
     * section. Never builds a loop (opening the row does).
     */
    let peeked = 0;
    async function peek() {
      if (Date.now() - peeked < PEEK_MS) return;
      const at = areaPoint(page.here());
      if (!at) return;
      peeked = Date.now();
      const r = await call('GET', `/api/ta?lat=${at.lat}&lon=${at.lon}`);
      if (!r.ok || !r.j) return;
      const week = featuredWeek(r.j);
      if (page.line) page.line(summaryLine(week, dist));
      if (page.week) page.week(week);                                    // the car's Places has it too (cockpit carPlaces)
    }
    return { section, peek };
  }
  const PEEK_MS = 5 * 60 * 1000;

  /**
   * From the Log after stages sync (analysis.html): sends your quickest run each day this season on each circuit you entered.
   * A failure waits for the next sync. sync: ApexSync; segs; passesOf(seg) as for runsToSend. → { accepted, places }: how
   * many runs went up, and your place on each loop's board after them, for the Log to say (placeLine).
   */
  async function sendRuns(sync, segs, passesOf) {
    const none = { accepted: 0, places: [] };
    if (!sync || !sync.apiFetch) return none;
    try {
      const r = await sync.apiFetch('/api/ta/entered');
      if (!r || !r.ok) return none;
      const now = await r.json();
      const runs = runsToSend(now.circuits, segs, passesOf, now.season, now.ends_on);
      if (!runs.length) return none;
      const p = await sync.apiFetch('/api/ta/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runs }) });
      if (!p || !p.ok) return none;
      const j = await p.json();
      return { accepted: j.accepted || 0, places: Array.isArray(j.places) ? j.places : [] };
    } catch (_) { return none; }
  }

  const api = { AREA_DEG, AVOID_M, PERIOD_KEYS, featuredWeek, seasonFoot, STREET_MAX_M, STREET_MAX_SHARE, streety, clock, gap, nth, placeLine, summaryLine, daysLeft, areaPoint, runsToSend, localCopy, rng, hubs, kmFor, choose, geomOf, loopName, makeLoop, mount, sendRuns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTimeAttack = api;
})(typeof window !== 'undefined' ? window : globalThis);
