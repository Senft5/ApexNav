// Events on the map (Nate, 2026-11-15: "time attacks and stuff to pop up basically like [open-world racing] missions, same
// with meets"). The area's time attacks stand on the map as a start gate at their start line, facing the way the loop
// goes, and the meets of the next day stand at their meeting points. Drive up to one and a card rises from the bottom:
// what it is, its name in big type, three facts (a loop's length, your best, the leader; a meet's start, crew and who's
// going) and one key, Start or Join. One card at a time, only for what is ahead of you while you move, gone once you pass
// or say Not now. Members only, from what the app already reads: the area's loops (GET /api/ta, the area's middle, never
// where you are), your crews' drives (GET /api/events) and public meets round the map (GET /api/events/near, by cell, never
// from inside a privacy zone). Nothing new is stored. Pure parts (gateOf, eventsOf, pick, cardOf, metres, bearing) are
// tested in tests/test_event_markers.py; mount() draws the gates and the card.
(function (root) {
  'use strict';
  const TA_M = 450, MEET_M = 800;                 // how near a gate or a meeting point is before its card rises
  const LEAVE_K = 1.6;                            // the card goes once you are this many times farther than it rose
  const AHEAD_DEG = 75, CLOSE_M = 150;            // while moving, only what is ahead of you (or right beside you)
  const MOVING_MPS = 4;
  const MEET_BEFORE_MS = 3 * 3600e3, MEET_AFTER_MS = 3600e3, MEET_SHOWN_MS = 24 * 3600e3;
  const NOT_NOW_MS = 30 * 60e3;                   // Not now keeps that card down this long
  const REFRESH_MS = 5 * 60e3, TICK_MS = 2000;

  const rad = (d) => d * Math.PI / 180;
  /** Metres between two {lat, lon}. */
  function metres(a, b) {
    const k = Math.cos(rad((a.lat + b.lat) / 2));
    return Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * k);
  }
  /** Degrees from a to b, 0 north, clockwise. */
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const turn = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
  const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

  /** A loop's start gate from its shape ([[lat, lon], ...], or that as JSON): where it starts and which way it leaves. */
  function gateOf(geom) {
    let g = geom;
    if (typeof g === 'string') { try { g = JSON.parse(g); } catch (_) { g = null; } }
    if (!Array.isArray(g) || g.length < 2) return null;
    const a = { lat: +g[0][0], lon: +g[0][1] };
    if (!ok(a)) return null;
    // the way it leaves: the first point at least 30 m on (a loop's first two points can sit on top of each other)
    let b = null;
    for (let i = 1; i < g.length && !b; i++) { const p = { lat: +g[i][0], lon: +g[i][1] }; if (ok(p) && metres(a, p) >= 30) b = p; }
    return { lat: a.lat, lon: a.lon, bearing: b ? Math.round(bearing(a, b)) : 0 };
  }

  /**
   * What stands on the map: { ta: GET /api/ta's answer, mine: GET /api/events rows, near: GET /api/events/near rows } →
   * [{ id, kind: 'ta'|'meet', lat, lon, bearing?, name, ... }]. Loops with a shape; meets of the next 24 h (and the hour after
   * one starts) with a meeting point, your crews' first (a meet both lists hold is yours).
   */
  function eventsOf(src, now = Date.now()) {
    const out = [], seen = new Set();
    const circuits = src && src.ta && Array.isArray(src.ta.circuits) ? src.ta.circuits : [];
    for (const c of circuits) {
      const gate = c && gateOf(c.geom);
      if (!gate) continue;
      out.push({ id: `ta:${c.id}`, kind: 'ta', ...gate, name: c.name || 'Time attack', length_m: c.length_m, featured: !!c.featured, entered: !!c.entered, c });
    }
    for (const [list, own] of [[src && src.mine, true], [src && src.near, false]]) {
      for (const e of Array.isArray(list) ? list : []) {
        const t = Date.parse(e && e.starts_at);
        if (!e || seen.has(e.id) || !Number.isFinite(t) || !Number.isFinite(e.meet_lat) || !Number.isFinite(e.meet_lon)) continue;
        if (t < now - MEET_AFTER_MS || t > now + MEET_SHOWN_MS) continue;
        seen.add(e.id);
        const going = Array.isArray(e.going) ? e.going.length : Number.isFinite(e.going) ? e.going : null;
        out.push({ id: `meet:${e.id}`, kind: 'meet', lat: e.meet_lat, lon: e.meet_lon, name: e.title || 'Meet', crew: e.crew_name || null,
          starts_at: e.starts_at, going, own, e });
      }
    }
    return out;
  }

  /**
   * The one card to show now, or null: the nearest event within reach (TA_M of a gate, MEET_M of a meeting point, a meet
   * only from 3 h before it starts to an hour after), not put down with Not now, and while moving only one ahead of you
   * (within AHEAD_DEG of your heading) or right beside you. pos {lat, lon}; motion {heading, speedMps}; down: Map id → until.
   */
  function pick(events, pos, motion, down, now = Date.now()) {
    if (!ok(pos)) return null;
    const moving = motion && Number.isFinite(motion.speedMps) && motion.speedMps >= MOVING_MPS && Number.isFinite(motion.heading);
    let best = null;
    for (const ev of Array.isArray(events) ? events : []) {
      if (!ev || !ok(ev)) continue;
      if (down && down.get && down.get(ev.id) > now) continue;
      const reach = ev.kind === 'meet' ? MEET_M : TA_M, m = metres(pos, ev);
      if (m > reach) continue;
      if (ev.kind === 'meet') { const t = Date.parse(ev.starts_at); if (!(t - MEET_BEFORE_MS <= now && now <= t + MEET_AFTER_MS)) continue; }
      if (moving && m > CLOSE_M && turn(motion.heading, bearing(pos, ev)) > AHEAD_DEG) continue;
      if (!best || m < best.m) best = { ev, m: Math.round(m) };
    }
    return best;
  }
  /** Whether a card that rose for ev still stands at pos (it goes once you're well past its reach). */
  const stands = (ev, pos) => !!(ev && ok(pos) && metres(pos, ev) <= (ev.kind === 'meet' ? MEET_M : TA_M) * LEAVE_K);

  /** Seconds as a stage clock: 75 → "1:15"; unknown stays "--". */
  function clock(s) {
    if (!Number.isFinite(s) || s < 0) return '--';
    const t = Math.round(s), h = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), x = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(mm).padStart(2, '0')}:${x}` : `${mm}:${x}`;
  }
  /** "in 25 min", "now", "started 10 min ago", else the clock time ("7:00 PM"). */
  function startsText(iso, now = Date.now(), locale) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '--';
    const min = Math.round((t - now) / 60000);
    if (Math.abs(min) <= 2) return 'now';
    if (min > 0 && min < 60) return `in ${min} min`;
    if (min < 0 && min > -60) return `${-min} min ago`;
    return new Date(t).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * What the card says: { kicker, title, facts: [[label, value] x3], key }. board: GET /api/ta?id=…&period=all's board for
   * a loop (null while it loads, or offline: unknown stays --). fmtLen(m) → "4.2 mi".
   */
  function cardOf(ev, board, fmtLen = (m) => `${(m / 1000).toFixed(1)} km`, now = Date.now()) {
    if (!ev) return null;
    if (ev.kind === 'ta') {
      const lead = board && Array.isArray(board.rows) && board.rows[0] ? board.rows[0] : null, you = board && board.you;
      return { kicker: ev.featured ? 'Featured time attack' : 'Time attack', title: ev.name,
        facts: [['Length', Number.isFinite(ev.length_m) ? fmtLen(ev.length_m) : '--'],
          ['Your best', you ? clock(you.time_s) : '--'],
          ['Leader', lead ? (lead.mine ? `You ${clock(lead.time_s)}` : `@${lead.handle} ${clock(lead.time_s)}`) : board ? 'Open' : '--']],
        key: 'Start' };
    }
    return { kicker: ev.own ? 'Crew drive' : 'Meet', title: ev.name,
      facts: [['Starts', startsText(ev.starts_at, now)], ['Crew', ev.crew || '--'], ['Going', Number.isFinite(ev.going) ? String(ev.going) : '--']],
      key: 'Join' };
  }

  const STYLE = `
    .ev-gate { display: grid; place-items: center; width: 48px; height: 48px; padding: 0; border: 0; background: none; cursor: pointer; }
    .ev-gate svg { width: 40px; height: 40px; overflow: visible; filter: drop-shadow(0 0 5px var(--ev-glow)); animation: ev-glow 2.4s ease-in-out infinite; }
    .ev-gate .post { fill: var(--panel-ink, #111); }
    .ev-gate .band { fill: var(--ev-glow); }
    .ev-gate .chev { fill: none; stroke: var(--panel, #fff); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .ev-gate.meet .band { fill: var(--ev-meet); }
    .ev-gate.meet svg { filter: drop-shadow(0 0 5px var(--ev-meet)); }
    :root { --ev-glow: #ff7a1a; --ev-meet: #2aa8ff; }
    @keyframes ev-glow { 0%, 100% { filter: drop-shadow(0 0 3px var(--ev-glow)); } 50% { filter: drop-shadow(0 0 9px var(--ev-glow)); } }
    @media (prefers-reduced-motion: reduce) { .ev-gate svg { animation: none; } }
    .ev-card { position: fixed; left: 12px; right: 12px; bottom: calc(var(--ev-bottom, 70px) + env(safe-area-inset-bottom, 0px)); z-index: 40;
      max-width: 520px; margin: 0 auto; background: var(--panel, #fff); color: var(--panel-ink, #111); border-radius: 18px;
      box-shadow: 0 10px 34px rgba(0,0,0,.32); padding: 14px 16px 14px; transform: translateY(16px); opacity: 0;
      transition: transform .22s ease-out, opacity .22s ease-out; border-left: 6px solid var(--ev-glow); }
    .ev-card.meet { border-left-color: var(--ev-meet); }
    .ev-card.up { transform: none; opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .ev-card { transition: none; } }
    .ev-card .ev-kick { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--panel-dim, #555); }
    .ev-card h2 { margin: 2px 0 10px; font-size: 26px; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ev-card .ev-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
    .ev-card .ev-facts small { display: block; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--panel-dim, #555); }
    .ev-card .ev-facts b { display: block; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev-card .ev-keys { display: flex; gap: 12px; align-items: center; }
    .ev-card .ev-keys .ink-btn { flex: 1; min-height: 52px; font-size: 18px; }
  `;
  const NS = 'http://www.w3.org/2000/svg';
  /** The gate: two posts and a lit band over the road, a chevron on it the way the loop goes; a meet's has a flag. */
  function gateSvg(d, kind) {
    const svg = d.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => { const n = d.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    add('rect', { class: 'post', x: 5, y: 8, width: 5, height: 30, rx: 1.5 });
    add('rect', { class: 'post', x: 30, y: 8, width: 5, height: 30, rx: 1.5 });
    add('rect', { class: 'band', x: 3, y: 4, width: 34, height: 12, rx: 3 });
    add('path', kind === 'meet' ? { class: 'chev', d: 'M15 13 V7 L25 9 L15 11' } : { class: 'chev', d: 'M16 13 L20 7 L24 13' });
    return svg;
  }

  /**
   * page: { el, btn, map, apiCall, jsonOf, member() → bool, here() → {lat, lon} | null, motion() → {heading, speedMps},
   *   mapCentre() → {lat, lon}, mayLookUp(p) → bool, areaPoint(p), fmtLen(m), startAttack(c) → Promise<bool>,
   *   openMeet(ev) }. → { setLayer(on), refresh(force), tick(), shown() }.
   */
  function mount(page) {
    const { el, btn, map } = page, d = root.document, Z = root.ApexPrivacyZones;
    if (d && !d.getElementById('eventMarkersStyle')) d.head.append(el('style', { id: 'eventMarkersStyle', textContent: STYLE }));
    let on = false, events = [], markers = new Map(), timer = null, lastLoad = 0, lastArea = '', gen = 0, card = null, cardEv = null;
    const down = new Map(), boards = new Map();
    const call = async (path) => { try { const r = await page.apiCall('GET', path); return r && r.ok ? await page.jsonOf(r) : null; } catch (_) { return null; } };

    function draw() {
      const want = new Set(events.map((e) => e.id));
      for (const [id, m] of markers) if (!want.has(id)) { m.remove(); markers.delete(id); }
      if (!map || !root.maplibregl) return;
      for (const ev of events) {
        if (markers.has(ev.id)) continue;
        const b = el('button', { type: 'button', className: `ev-gate ${ev.kind}` });
        b.append(gateSvg(d, ev.kind));
        b.setAttribute('aria-label', `${ev.kind === 'ta' ? 'Time attack' : 'Meet'}: ${ev.name}. Open it.`);
        b.addEventListener('click', (e) => { e.stopPropagation(); show(ev, true); });
        const m = new root.maplibregl.Marker({ element: b, anchor: 'bottom', rotationAlignment: 'viewport' }).setLngLat([ev.lon, ev.lat]).addTo(map);
        b.setAttribute('aria-label', `${ev.kind === 'ta' ? 'Time attack' : 'Meet'}: ${ev.name}. Open it.`);   // the marker set its own
        markers.set(ev.id, m);
      }
    }
    async function load(force) {
      if (!on || !page.member()) return;
      const here = page.here() || (page.mapCentre && page.mapCentre());
      if (!ok(here)) return;
      const area = page.areaPoint ? page.areaPoint(here) : null, key = area ? `${area.lat},${area.lon}` : '';
      if (!force && key === lastArea && Date.now() - lastLoad < REFRESH_MS) return;
      lastArea = key; lastLoad = Date.now();
      const mine = ++gen;
      const cell = Z && (!page.mayLookUp || page.mayLookUp(here)) ? Z.cellQuery(here.lat, here.lon) : null;
      const [ta, list, near] = await Promise.all([area ? call(`/api/ta?lat=${area.lat}&lon=${area.lon}`) : null, call('/api/events'), cell ? call(`/api/events/near?${cell}`) : null]);
      if (mine !== gen || !on) return;
      if (!ta && !list && !near) { lastArea = ''; return; }        // no signal: ask again on the next tick
      events = eventsOf({ ta, mine: list, near });
      draw();
      tick();
    }
    async function boardFor(ev) {
      const hit = boards.get(ev.id);
      if (hit && Date.now() - hit.at < REFRESH_MS) return hit.b;
      const area = page.areaPoint ? page.areaPoint(ev) : ev;
      const j = await call(`/api/ta?lat=${area.lat}&lon=${area.lon}&id=${encodeURIComponent(ev.c.id)}&period=all`);
      const b = j && j.board ? j.board : null;
      if (b) boards.set(ev.id, { at: Date.now(), b });
      return b;
    }
    function hide() {
      if (!card) return;
      const c = card; card = null; cardEv = null;
      c.classList.remove('up');
      setTimeout(() => c.remove(), 240);
    }
    function paint(box, ev, board) {
      const m = cardOf(ev, board, page.fmtLen);
      const go = btn(m.key, async () => {
        go.disabled = true;
        const done = ev.kind === 'ta' ? await page.startAttack(ev.c) : (page.openMeet(ev), true);
        if (done) { down.set(ev.id, Date.now() + NOT_NOW_MS); hide(); } else go.disabled = false;
      }, 'ink-btn solid');
      const not = btn('Not now', () => { down.set(ev.id, Date.now() + NOT_NOW_MS); hide(); }, 'linkbtn');
      box.replaceChildren(el('p', { className: 'ev-kick', textContent: m.kicker }), el('h2', { textContent: m.title }),
        el('div', { className: 'ev-facts' }, ...m.facts.map(([k, v]) => el('div', {}, el('small', { textContent: k }), el('b', { textContent: v })))),
        el('div', { className: 'ev-keys' }, go, not));
    }
    /** Raise ev's card (tapped: even when far, and it stays until you close it or move well away from where you tapped). */
    function show(ev, tapped) {
      if (cardEv && cardEv.id === ev.id) return;
      hide();
      const box = el('section', { className: `ev-card ${ev.kind}` });
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', ev.name);
      box.dataset.id = ev.id; box.dataset.tapped = tapped ? '1' : '';
      paint(box, ev, null);
      d.body.append(box);
      card = box; cardEv = ev;
      requestAnimationFrame(() => box.classList.add('up'));
      if (ev.kind === 'ta') boardFor(ev).then((b) => { if (card === box && b) paint(box, ev, b); });
    }
    function tick() {
      if (!on) return;
      const pos = page.here();
      if (card && cardEv && !card.dataset.tapped && !stands(cardEv, pos)) hide();
      if (card) return;                                          // one card at a time
      const got = pick(events, pos, page.motion ? page.motion() : null, down);
      if (got) show(got.ev, false);
    }
    function setLayer(next) {
      on = !!next && !!page.member();
      gen++;
      if (timer) { clearInterval(timer); timer = null; }
      if (on) { timer = setInterval(() => { tick(); load(false); }, TICK_MS); load(true); }
      else { hide(); for (const m of markers.values()) m.remove(); markers.clear(); events = []; lastArea = ''; }
    }
    return { setLayer, refresh: load, tick, shown: () => (cardEv ? cardEv.id : null), events: () => events.slice() };
  }

  const api = { TA_M, MEET_M, AHEAD_DEG, NOT_NOW_MS, metres, bearing, gateOf, eventsOf, pick, stands, cardOf, clock, startsText, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEventMarkers = api;
})(typeof window !== 'undefined' ? window : globalThis);
