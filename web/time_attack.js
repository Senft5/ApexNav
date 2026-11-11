// Weekly time attack (docs/SOCIAL.md 2.9, IDEAS S-26; the owner, 2026-11-11: "a weekly time attack circuit per area").
// Each area (a 1-degree square) gets one member's stage for the week, Monday to Sunday (UTC). Enter puts it in your Stages;
// the Log sends your quickest timed run on it this week, and the board shows every entrant by handle, quickest first, with
// the gap and that run's Vetta Score. The pure parts (clock, gap, runsToSend, localCopy, canPutUp, areaPoint) are tested in
// tests/test_time_attack.py; mount() draws the section, which lives in Where to? beside Spots near you.
(function (root) {
  'use strict';
  const MIN_M = 1000, MAX_M = 25000;

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
   * The middle of the area a point is in: the server needs only the area, so the phone never sends where it is.
   * (The area is the 1-degree square, south-west corner floor(lat), floor(lon).)
   */
  const areaPoint = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    ? { lat: Math.floor(p.lat) + 0.5, lon: Math.floor(p.lon) + 0.5 } : null);

  /**
   * The runs to send: for each synced stage that is (a copy of) a circuit this week, its quickest timed pass driven between
   * `week` and `endsOn`. passesOf(seg) → [{p: {score, time_s}, d: {date}}] as the Log has them. At most 20 (one request).
   */
  function runsToSend(circuits, segs, passesOf, week, endsOn) {
    const ids = new Set((circuits || []).map((c) => c.segment_id));
    const out = [];
    for (const s of segs || []) {
      if (!s || !s.synced || !ids.has(s.origin || s.id)) continue;
      const best = (passesOf(s) || []).filter((x) => x && x.p && Number.isFinite(x.p.time_s) && x.p.time_s >= 10 && x.d && /^\d{4}-\d{2}-\d{2}/.test(x.d.date || ''))
        .map((x) => ({ x, day: x.d.date.slice(0, 10) })).filter(({ day }) => day >= week && day <= endsOn)
        .sort((a, b) => a.x.p.time_s - b.x.p.time_s)[0];
      if (best) out.push({ segment_id: s.id, time_s: Math.round(best.x.p.time_s), driver_score: Number.isFinite(best.x.p.score) ? Math.round(best.x.p.score) : null, driven_on: best.day });
    }
    return out.slice(0, 20);
  }
  /** The stage as the Log keeps it, from the circuit and the id of your copy (geom is [[lat, lon], ...]). */
  function localCopy(c, id) {
    let g = [];
    try { g = JSON.parse(c.geom) || []; } catch (_) {}
    if (!g.length) return null;
    const [a, b] = [g[0], g[g.length - 1]];
    return { id, name: c.name, length_m: c.length_m, geom: c.geom, lat0: a[0], lon0: a[1], lat1: b[0], lon1: b[1], origin: c.segment_id, synced: true };
  }
  /** Your own stages (not copies) that can be put up: backed up, 1 to 25 km, not put up already. */
  const canPutUp = (segs, pool) => {
    const up = new Set((pool || []).map((p) => p.segment_id));
    return (segs || []).filter((s) => s && s.synced && !s.origin && s.length_m >= MIN_M && s.length_m <= MAX_M && !up.has(s.id));
  };

  const STYLE = `
    .ta-board { display: grid; grid-template-columns: auto 1fr auto auto; gap: 4px 10px; align-items: baseline; font-variant-numeric: tabular-nums; }
    .ta-board .me { font-weight: 700; }
    .ta-board .gap, .ta-board .sc { color: var(--panel-dim); font-size: 13px; }
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
      : code === 'too_many' ? 'You have three stages up already. Take one down first.'
      : code === 'bad_length' ? 'A time attack stage is 1 to 25 km.' : code === 'removed_by_moderator' ? 'A moderator took that stage down.'
      : 'Couldn’t do that. Try again.');
    async function call(method, path, body) {
      let r = null;
      try { r = await page.apiCall(method, path, body); } catch (_) {}
      const j = r ? await page.jsonOf(r) : null;
      return { ok: !!(r && r.ok), status: r ? r.status : 0, j, code: j && j.error };
    }
    function section() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Time attack this week' }));
      const body = el('div', { className: 'stack-8' });
      sec.append(body);
      const load = async () => {
        const at = areaPoint(page.here());
        if (!at) { body.replaceChildren(el('p', { className: 'note', textContent: 'Waiting for your position.' })); return; }
        const r = await call('GET', `/api/timeattack?lat=${at.lat}&lon=${at.lon}`);
        if (!r.ok || !r.j) { body.replaceChildren(el('p', { className: 'note', textContent: r.status === 401 || r.status === 403 ? 'Sign in to see this week’s time attack.' : 'Couldn’t load the time attack. Try again later.' })); return; }
        const pool = await call('GET', '/api/timeattack/pool');
        draw(r.j, at, Array.isArray(pool.j) ? pool.j : []);
      };
      function draw(t, at, mine) {
        const kids = [];
        const c = t.circuit, left = daysLeft(t.today, t.ends_on);
        if (!c) {
          kids.push(el('p', { className: 'note', textContent: t.pool ? 'No stage this week yet. Try again in a moment.' : 'No time attack in this area yet. Put one of your stages up and the area gets one.' }));
        } else {
          kids.push(el('b', { textContent: c.name }),
            el('p', { className: 'note', textContent: `${dist(c.length_m)}${c.by ? ` · put up by @${c.by}` : ''} · ${left == null ? '' : left === 1 ? 'last day' : `${left} days left`} · ${t.entrants} ${t.entrants === 1 ? 'time' : 'times'}` }));
          const acts = el('div', { className: 'row', style: 'flex-wrap:wrap' });
          let g = [];
          try { g = JSON.parse(c.geom) || []; } catch (_) {}
          if (t.entered) {
            if (g.length && page.goTo) acts.append(btn('Drive it', () => page.goTo({ label: c.name, lat: g[0][0], lon: g[0][1] }), 'ink-btn'));
          } else {
            acts.append(btn('Enter', async () => {
              const r = await call('POST', '/api/timeattack/enter', { cell: t.cell });
              if (!r.ok) { say(r.code); return; }
              if (r.j && r.j.added && page.segs && page.saveSegs) {
                const list = page.segs(), copy = localCopy(c, r.j.segment_id);
                if (copy && !list.some((s) => s.id === copy.id)) { list.push(copy); page.saveSegs(list); }
              }
              toast('In your Stages. Log a run on it this week and your quickest time goes on the board.');
              load();
            }, 'ink-btn'));
          }
          if (page.report) acts.append(btn('Report', () => page.report({ kind: 'circuit', target: c.segment_id, label: c.name, done: load }), 'linkbtn'));
          kids.push(acts);
          if (t.board.length) {
            const grid = el('div', { className: 'ta-board', role: 'table', 'aria-label': `Times on ${c.name}` });
            const row = (x) => [el('span', { textContent: String(x.place), className: x.mine ? 'me' : '' }), el('span', { textContent: '@' + x.handle, className: x.mine ? 'me' : '' }),
              el('span', { textContent: clock(x.time_s) + (x.gap_s ? ' ' : ''), className: x.mine ? 'me' : '' }, el('span', { className: 'gap', textContent: gap(x.gap_s) })),
              el('span', { className: 'sc', textContent: x.score == null ? '' : `Score ${x.score}` })];
            for (const x of t.board) grid.append(...row(x));
            if (t.you && !t.board.some((x) => x.mine)) grid.append(...row(t.you));
            kids.push(grid);
          } else if (t.entered) {
            kids.push(el('p', { className: 'note', textContent: 'No times yet. Yours could be the first.' }));
          }
          if (t.you) kids.push(btn('Take my time off', async () => {
            if (page.ask && !(await page.ask('Take your time off this week’s board?', 'Take it off'))) return;
            const r = await call('DELETE', `/api/timeattack/entry?lat=${at.lat}&lon=${at.lon}`);
            toast(r.ok ? 'Your time is off the board.' : 'Couldn’t take it off. Try again.');
            load();
          }, 'linkbtn'));
        }
        if (t.last && t.last.podium.length) kids.push(el('p', { className: 'note', textContent: `Last week, ${t.last.name}: ${t.last.podium.map((p, i) => `${i + 1}. @${p.handle} ${clock(p.time_s)}`).join(' · ')}` }));
        // putting a stage up: your own, backed-up stages; a stage up can be picked any week for the area it starts in
        const up = el('details', { className: 'plan-more' }, el('summary', { textContent: mine.length ? `Your stages up for time attack (${mine.length})` : 'Put one of your stages up' }));
        for (const p of mine) up.append(el('div', { className: 'row' }, el('span', { textContent: p.name }),
          btn('Take down', async () => { const r = await call('DELETE', `/api/timeattack/pool/${encodeURIComponent(p.segment_id)}`); toast(r.ok ? 'Taken down.' : 'Couldn’t take it down.'); load(); }, 'linkbtn')));
        const options = canPutUp(page.segs ? page.segs() : [], mine);
        if (options.length) for (const s of options) up.append(el('div', { className: 'row' }, el('span', { textContent: `${s.name} · ${dist(s.length_m)}` }),
          btn('Put up', async () => { const r = await call('POST', '/api/timeattack/pool', { segment_id: s.id }); if (!r.ok) { say(r.code); return; } toast('Up. It can be picked for its area from next week, or this week if the area has none.'); load(); }, 'linkbtn')));
        else if (!mine.length) up.append(el('p', { className: 'note', textContent: 'Mark a stage of 1 to 25 km in the Log first. Copies of other people’s stages can’t be put up.' }));
        kids.push(up, el('p', { className: 'note', textContent: 'Public roads: drive within the law and the conditions. Only runs the phone timed count, and a time no road car could set is refused.' }));
        body.replaceChildren(...kids);
      }
      load();
      return sec;
    }
    return { section };
  }

  /**
   * From the Log after stages sync (analysis.html): sends your quickest run this week on each circuit you entered. Quiet:
   * nothing is said, and a failure waits for the next sync. sync: ApexSync; segs; passesOf(seg) as for runsToSend.
   */
  async function sendRuns(sync, segs, passesOf) {
    if (!sync || !sync.apiFetch) return 0;
    try {
      const r = await sync.apiFetch('/api/timeattack/circuits');
      if (!r || !r.ok) return 0;
      const now = await r.json();
      const runs = runsToSend(now.circuits, segs, passesOf, now.week, now.ends_on);
      if (!runs.length) return 0;
      const p = await sync.apiFetch('/api/timeattack/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runs }) });
      return p && p.ok ? ((await p.json()).accepted || 0) : 0;
    } catch (_) { return 0; }
  }

  const api = { clock, gap, daysLeft, areaPoint, runsToSend, localCopy, canPutUp, mount, sendRuns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTimeAttack = api;
})(typeof window !== 'undefined' ? window : globalThis);
