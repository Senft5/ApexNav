// Crew drives (IDEAS S-06) and the run as one card (docs/design/REVIEW_PEOPLE.md P-03, P-11, P-18, roadmap 2): a drive is
// one card in four states, planned (who's going), the morning of (directions to the meet, the planner's or the leader's
// "Start the convoy", a crew-mate's convoy to join), the convoy live (who's in, the leader's keys) and remembered (who
// came, the best Score that day). The crew page's This week and the Crew drives sheet draw the same card; its detail
// (your answer, roles, regroup points, the calendar, and what the planner sets after planning) opens under More. "Plan a
// drive" is one screen: a name, the day, the time, where to meet (a place search) and the planned route. Everything
// people typed is set as text. whenText, timeText, icsFor, convoyOpen, convoyName and driveState are pure
// (tests/test_crew_events.py); mount() draws.
(function (root) {
  'use strict';
  const CONVOY_BEFORE_MS = 2 * 3600_000, CONVOY_AFTER_MS = 4 * 3600_000, MORNING_H = 4;

  /** "Today 9:00 AM", "Tomorrow 9:00 AM", "Sat, Nov 1 · 9:00 AM" in the phone's time zone. */
  function whenText(iso, now = new Date(), locale) {
    const t = new Date(iso);
    if (!Number.isFinite(t.getTime())) return '--';
    const time = t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(t) - day(now)) / 86400000);
    if (diff === 0) return `Today ${time}`;
    if (diff === 1) return `Tomorrow ${time}`;
    return `${t.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
  }
  /** P-27: the card's date block carries the date, so its line says the time once: "Today 9:00 AM", "Tomorrow 9:00 AM",
   *  "Sun 9:00 AM" (the weekday the block doesn't show). */
  function timeText(iso, now = new Date(), locale) {
    const w = whenText(iso, now, locale);
    if (w === '--' || /^(Today|Tomorrow) /.test(w)) return w;
    const t = new Date(iso);
    return `${t.toLocaleDateString(locale, { weekday: 'short' })} ${t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  }

  /** Who leads and who sweeps (roadmap 21): "Lead @bob · Sweep open". */
  function rolesLine(e) {
    const who = (h) => (h ? '@' + h : 'open');
    return `Lead ${who(e && e.lead)} \u00b7 Sweep ${who(e && e.sweep)}`;
  }
  /** The drive you're going to today, for the cockpit's morning reminder (roadmap 21): from 4 AM on its day until an hour
   *  after it starts, the earliest; null otherwise. Local time. */
  function todayDrive(events, now = new Date()) {
    const n = now.getTime(), morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), MORNING_H).getTime();
    const ok = (Array.isArray(events) ? events : []).filter((e) => {
      const t = Date.parse(e && e.starts_at);
      if (!Number.isFinite(t) || e.my_rsvp !== 'going') return false;
      const d = new Date(t), sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      return sameDay && n >= morning && n <= t + 3600_000;
    });
    ok.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    return ok[0] || null;
  }

  /** The drive's day (P-11: "the day of"): from 4 AM on the day it starts (or 2 h before, for a drive before 6 AM) until
   *  4 h after it starts. Local time. */
  function onTheDay(e, now = Date.now()) {
    const t = Date.parse(e && e.starts_at);
    if (!Number.isFinite(t)) return false;
    const d = new Date(t), morning = new Date(d.getFullYear(), d.getMonth(), d.getDate(), MORNING_H).getTime();
    return now >= Math.min(morning, t - CONVOY_BEFORE_MS) && now <= t + CONVOY_AFTER_MS;
  }
  /** The planner, or whoever leads it, may start the drive's convoy on its day (P-11). */
  function convoyOpen(e, now = Date.now(), me = null) {
    return !!e && (!!e.mine || (!!me && e.lead === me)) && onTheDay(e, now);
  }
  /** The convoy a drive starts is named for the crew (its call sign at Works: crew_voice.js finds it) and the drive; the card
   *  knows its convoy, and a crew-mate's invite to it, by that name. The Worker keeps 40 characters. */
  function convoyName(e) {
    return `${(e && (e.call_sign || e.crew_name)) || 'Crew'} \u00b7 ${(e && e.title) || 'Drive'}`.slice(0, 40);
  }
  /** Which of its four states a drive's card is in: 'convoy' while you're in its convoy (`liveName`), 'remembered' once
   *  the drive is over, 'morning' on its day, else 'planned'. */
  function driveState(e, now = Date.now(), liveName = null) {
    const t = Date.parse(e && e.starts_at);
    if (liveName && liveName === convoyName(e)) return 'convoy';
    if (!Number.isFinite(t)) return 'planned';
    if (now > t + CONVOY_AFTER_MS) return 'remembered';
    return onTheDay(e, now) ? 'morning' : 'planned';
  }

  const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /** An .ics calendar event (2 h long, at the meeting point), for "Add to calendar". */
  function icsFor(e, now = Date.now()) {
    const start = Date.parse(e.starts_at);
    const where = e.meet_name ? `${e.meet_name} (${e.meet_lat}, ${e.meet_lon})` : `${e.meet_lat}, ${e.meet_lon}`;
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vetta//Crew drive//EN', 'BEGIN:VEVENT',
      `UID:${e.id}@apexnav`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(start + 2 * 3600_000)}`,
      `SUMMARY:${icsEscape(e.title)}`, `LOCATION:${icsEscape(where)}`, `GEO:${e.meet_lat};${e.meet_lon}`,
      `DESCRIPTION:${icsEscape([e.crew_name && `Crew drive with ${e.crew_name}`, e.notes].filter(Boolean).join('. '))}`,
      'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  }

  /** Local date + time inputs → an ISO time with the phone's offset, or null. */
  function isoFromInputs(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
    const t = new Date(`${date}T${time}:00`);
    return Number.isFinite(t.getTime()) ? t.toISOString() : null;
  }

  // The card is the crew page's drive card (mockup 09: the black date block, three lines, faces, one key), now everywhere.
  const STYLE = `
    .plan-plus { align-self: center; margin: -10px -10px -10px 0; color: var(--panel-ink); }
    .plan-plus svg { width: 26px; height: 26px; stroke-width: 2.2; }
    .cp-drive { display: grid; grid-template-columns: 76px minmax(0, 1fr); border: 1.5px solid var(--panel-ink); background: var(--panel); color: var(--panel-ink); }
    .cp-date { background: var(--panel-ink); color: var(--panel); display: grid; place-content: center; text-align: center; font-family: var(--font-num); align-self: stretch; }
    .cp-date b { font-size: 34px; line-height: 1; } .cp-date span { font-size: 13px; letter-spacing: 0.08em; }
    .cp-date small { font: 700 11px var(--font-ui); letter-spacing: 0.1em; margin-top: 6px; }
    .cp-drive.is-convoy .cp-date small::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--gain, #2a6); margin-right: 5px; vertical-align: 1px; }
    .cp-drive.is-remembered .cp-date { background: transparent; color: var(--panel-ink); border-right: 1.5px solid var(--panel-ink); }
    .cp-drive-body { padding: 10px 12px; display: grid; gap: 6px; min-width: 0; }
    .cp-drive-body > b { font-size: 18px; overflow-wrap: anywhere; }
    .cp-going { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cp-faces { display: flex; } .cp-faces .avatar { margin-left: -6px; } .cp-faces .avatar:first-child { margin-left: 0; }
    .cp-now { display: grid; gap: 8px; border-top: 1px solid var(--rule); padding-top: 8px; }
    .cp-now .row { flex-wrap: wrap; gap: 8px; align-items: center; }
    .cp-now p { margin: 0; }
    .cp-best { font-family: var(--font-num); font-size: 26px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; margin-right: 6px; }
    .cp-more > summary { cursor: pointer; color: var(--panel-dim); font-size: 14px; font-weight: 600; min-height: 32px; display: flex; align-items: center; list-style: none; }
    .cp-more > summary::-webkit-details-marker { display: none; }
    .cp-more > summary::after { content: ''; width: 7px; height: 7px; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(45deg); margin: -3px 0 0 8px; }
    .cp-more[open] > summary::after { transform: rotate(-135deg); margin-top: 3px; }
    .cp-more-body { display: grid; gap: 10px; padding-top: 4px; }
    .cp-more-body .row { flex-wrap: wrap; gap: 8px; align-items: baseline; }
    .cp-set { display: grid; gap: 8px; border-top: 1px solid var(--rule); padding-top: 10px; }
    .meet-search { display: grid; gap: 6px; }
    .meet-search .meet-hits { display: grid; }
    .meet-search .meet-hits button { text-align: left; padding: 8px 0; border: 0; border-top: 1px solid var(--rule); background: none; color: var(--panel-ink); font: inherit; min-height: 44px; }
    .meet-search .meet-hits button small { display: block; color: var(--panel-dim); font-size: 13px; }
    .meet-search .meet-chips { display: flex; gap: 8px; flex-wrap: wrap; }
  `;

  /**
   * page: el, btn, toast, apiCall, jsonOf, report (safety), here() → {lat, lon}|null,
   * mapCentre() → {lat, lon}, plannedRoute() → {name, geom}|null, goTo({label, lat, lon}), openRoute(id), myHandle(),
   * searchPlaces(q) → [{label, sub, lat?, lon?}], resolvePlace(row) → {lat, lon}|null, openWhereTo(), convoy() → the
   * convoy (convoy_ui.js: state, invites, accept, dismiss, startFor, panel, watch) or null, avatar(photoId, handle, px).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const RSVP = [['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can\'t']];
    let known = [];                                             // your crews ({id, name, visibility, role}), from section()
    const doc = root.document;
    if (doc && !doc.getElementById('crewEventsStyle')) doc.head.append(el('style', { id: 'crewEventsStyle', textContent: STYLE }));
    const me = () => (page.myHandle ? page.myHandle() : null);
    const cv = () => (page.convoy ? page.convoy() : null);
    const id = (e) => encodeURIComponent(e.id);
    const CP = () => root.ApexCrewPage;
    const face = (h) => (page.avatar && page.avatar(null, h, 30)) || (el('span', { className: 'avatar', style: '--av:30px' }, el('b', { textContent: String(h || '?').charAt(0).toUpperCase() })));
    function faces(handles, label) {
      const g = CP() ? CP().goingFaces(handles) : { faces: [], more: 0, n: (handles || []).length };
      const row = el('span', { className: 'cp-faces' }, ...(handles || []).slice(0, 3).map(face));
      if (g.more) row.append(el('span', { className: 'avatar', style: '--av:30px' }, el('b', { textContent: `+${g.more}` })));
      row.setAttribute('aria-label', `${label}: ${(handles || []).map((h) => '@' + h).join(', ')}`);
      return row;
    }
    const calendar = (e, file = 'crew-drive.ics') => {
      const a = el('a', { href: URL.createObjectURL(new Blob([icsFor(e)], { type: 'text/calendar' })), download: file });
      doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    const directions = (e) => page.goTo({ label: e.meet_name || e.title, lat: e.meet_lat, lon: e.meet_lon });
    const came = (e) => apiCall('POST', `/api/events/${id(e)}/came`).catch(() => null);   // the drive's record: you came

    /**
     * "Meet at…" (P-10): a place search (Where to?'s own, place_search.js) with Where I am and the map's centre as chips.
     * `onPick({ name, lat, lon })`; `named` asks the chips for a name from the field (a regroup point has to have one).
     */
    function placeField(label, onPick, { named = false, placeholder = 'Meet at\u2026' } = {}) {
      const box = el('div', { className: 'meet-search' });
      const q = el('input', { className: 'field', type: 'search', maxLength: 60, placeholder, autocomplete: 'off', enterKeyHint: 'search' });
      q.setAttribute('aria-label', label);
      const hits = el('div', { className: 'meet-hits', role: 'listbox' });
      hits.setAttribute('aria-label', `${label}: places`);
      let timer = null, seq = 0;
      const pick = (p) => { hits.replaceChildren(); onPick(p); };
      const chipName = (fallback) => { const n = q.value.trim(); if (named && !n) { toast('Name it first.'); return null; } return n || fallback; };
      const chips = el('div', { className: 'meet-chips' },
        btn('Where I am', () => { const p = page.here && page.here(), n = p && chipName('Where I am'); if (!p) toast('No GPS fix yet.'); else if (n) pick({ name: n, lat: p.lat, lon: p.lon }); }, 'chip'),
        btn('Map centre', () => { const p = page.mapCentre(), n = chipName(null); if (n !== null || !named) pick({ name: n, lat: p.lat, lon: p.lon }); }, 'chip'));
      q.addEventListener('input', () => {
        clearTimeout(timer);
        const text = q.value.trim(), mine = ++seq;
        if (text.length < 3 || !page.searchPlaces) { hits.replaceChildren(); return; }
        timer = setTimeout(async () => {
          let rows = [];
          try { rows = await page.searchPlaces(text); } catch (_) { rows = null; }
          if (mine !== seq) return;                                       // a newer keystroke won
          if (!rows) { hits.replaceChildren(el('p', { className: 'note', textContent: 'No suggestions offline. Use Where I am or the map centre.' })); return; }
          hits.replaceChildren(...rows.slice(0, 5).map((r) => {
            const b = el('button', { type: 'button', role: 'option' }, el('span', { textContent: r.label }), ...(r.sub ? [el('small', { textContent: r.sub })] : []));
            b.addEventListener('click', async () => {
              const at = Number.isFinite(r.lat) && Number.isFinite(r.lon) ? r : page.resolvePlace ? await page.resolvePlace(r).catch(() => null) : null;
              if (!at) { toast('Couldn\u2019t find that place. Try another.'); return; }
              q.value = r.label; pick({ name: r.label, lat: at.lat, lon: at.lon });
            });
            return b;
          }), ...(rows.length ? [] : [el('p', { className: 'note', textContent: 'No matches nearby.' })]));
        }, 300);
      });
      box.append(q, hits, chips);
      box.field = q;
      return box;
    }

    // ---- the card ---------------------------------------------------------------------------------------------------
    /**
     * One drive as a card (P-18). `o`: redo() after a change, crew (name the crew: the Crew drives sheet spans crews),
     * open (More starts open), state (force one; else driveState). Re-draws itself when the convoy changes.
     */
    function card(e, o = {}) {
      const redo = o.redo || (() => {});
      const C = cv(), live = C && C.state ? C.state() : null;
      const st = o.state || driveState(e, Date.now(), live && live.name);
      const box = el('div', { className: `cp-drive drive-card is-${st}` });
      box.dataset.state = st;
      const d = CP() ? CP().dateBlock(e.starts_at) : { day: '', mon: '' };
      const stamp = { morning: 'TODAY', convoy: 'LIVE', remembered: 'DRIVEN' }[st];
      box.append(el('div', { className: 'cp-date' }, el('b', { textContent: d.day }), el('span', { textContent: d.mon }), ...(stamp ? [el('small', { textContent: stamp })] : [])));
      const body = el('div', { className: 'cp-drive-body' }, el('b', { textContent: e.title }));
      box.append(body);
      const where = e.meet_name ? `Meet at ${e.meet_name}` : 'Meet at the pin';
      body.append(el('span', { className: 'note', textContent: st === 'remembered' ? [e.crew_name && o.crew ? e.crew_name : '', where.replace('Meet at', 'Met at')].filter(Boolean).join(' \u00b7 ')
        : [timeText(e.starts_at), where].join(' \u00b7 ') }));
      if (o.crew && st !== 'remembered') body.append(el('span', { className: 'note', textContent: `${e.crew_name}${e.by_handle ? ` \u00b7 by @${e.by_handle}` : ''}` }));
      if (st === 'remembered') { body.append(remembered(e, redo)); return box; }
      body.append(el('span', { className: 'note', textContent: rolesLine(e) }));
      // who's going, and your one key for it
      const going = Array.isArray(e.going) ? e.going : [], mineGoing = e.my_rsvp === 'going';
      const rsvp = btn(mineGoing ? 'Going' : 'I\u2019m going', async () => {
        const r = await apiCall('POST', `/api/events/${id(e)}/rsvp`, { status: mineGoing ? 'no' : 'going' }).catch(() => null);
        if (!r || !r.ok) { toast('Couldn\u2019t save that. Check signal.'); return; }
        redo();
      }, mineGoing ? 'ink-btn solid' : 'ink-btn');
      rsvp.setAttribute('aria-pressed', String(mineGoing));
      body.append(el('div', { className: 'cp-going' }, going.length ? faces(going, 'Going') : '',
        el('span', { className: 'note', textContent: going.length ? `${going.length} going${e.maybe ? ` \u00b7 ${e.maybe} maybe` : ''}` : 'Nobody going yet' }),
        el('span', { style: 'flex:1' }), rsvp));
      box._invited = !!(C && C.invites && C.invites().some((i) => i.name === convoyName(e)));
      if (st === 'morning') body.append(morning(e, redo));
      if (st === 'convoy') body.append(convoyNow(e));
      body.append(more(e, redo, !!o.open));
      // the convoy starting, ending or inviting changes the state: draw again (while on the screen)
      if (C && C.watch) C.watch(() => {
        if (!box.isConnected) return false;
        const s2 = C.state(), next = driveState(e, Date.now(), s2 && s2.name);
        const inv = (C.invites ? C.invites() : []).some((i) => i.name === convoyName(e));
        if (next !== st || inv !== box._invited) { const det = box.querySelector('.cp-more'); box.replaceWith(card(e, { ...o, state: undefined, open: !!(det && det.open) })); return false; }
        return true;
      });
      return box;
    }

    // The morning of (P-11): directions to the meet, and the convoy: a crew-mate's to join, or yours to start.
    function morning(e, redo) {
      const now = el('div', { className: 'cp-now' }), C = cv();
      const inv = C && C.invites ? C.invites().find((i) => i.name === convoyName(e)) : null;
      const keys = el('div', { className: 'row' });
      let startNote = null;
      if (inv) {
        now.append(el('p', { textContent: `${inv.from ? '@' + inv.from : 'A crew-mate'} started the convoy.` }),
          el('p', { className: 'note', textContent: 'Joining shares your position with the convoy until you leave, and marks you as came on the drive.' }));
        keys.append(btn('Join the convoy', async (ev) => {
          const b = ev && ev.currentTarget; if (b) b.disabled = true;
          const r = await C.accept(inv);
          if (b) b.disabled = false;
          if (!r.ok) { toast(r.status === 409 ? 'That convoy is full.' : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That invite has run out. Ask for a new one.'); return; }
          toast('You\u2019re in the convoy. Your position is shared with it until you leave.');
          came(e);
        }, 'ink-btn solid'), btn('Not now', () => { C.dismiss(inv); }, 'linkbtn'));
      } else if (C && C.startFor && convoyOpen(e, Date.now(), me()) && !(C.state && C.state())) {
        keys.append(btn('Start the convoy', async (ev) => {
          const b = ev && ev.currentTarget; if (b) b.disabled = true;
          const r = await C.startFor(convoyName(e), (e.going || []).filter((h) => h !== me()));   // in the app, everyone going, no link
          if (b) b.disabled = false;
          if (!r.ok) { toast(r.status === 'busy' ? 'You\u2019re already in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\u2019t start the convoy. Try again.'); return; }
          toast(r.invited ? `Convoy started. Invited ${r.invited} going.` : 'Convoy started.');
          came(e);
        }, 'ink-btn solid'));
        startNote = el('p', { className: 'note', textContent: 'Everyone going is invited in the app. It shares your position with them until it ends, and marks you as came on the drive.' });
      }
      keys.append(btn(`Directions to ${e.meet_name || 'the meet'}`, () => directions(e), keys.childElementCount ? 'ink-btn' : 'ink-btn solid'));
      now.append(keys, ...(startNote ? [startNote] : []));
      return now;
    }
    // The convoy live (P-11, P-28): who's in, the leader's keys and the time left, the convoy's own panel (convoy_ui.js).
    function convoyNow(e) {
      const now = el('div', { className: 'cp-now' }), C = cv();
      if (C && C.panel) now.append(C.panel());
      now.append(el('div', { className: 'row' }, btn(`Directions to ${e.meet_name || 'the meet'}`, () => directions(e), 'linkbtn')));
      return now;
    }
    // Remembered (P-03): who came, the best Score that day, and "I was there" for a crew-mate the convoy didn't count.
    function remembered(e, redo) {
      const now = el('div', { className: 'cp-now' }, el('p', { className: 'note', textContent: 'Loading the drive\u2026' }));
      apiCall('GET', `/api/events/${id(e)}/record`).then(jsonOf).catch(() => null).then((r) => {
        if (!r || !Array.isArray(r.came)) { now.replaceChildren(el('p', { className: 'note', textContent: 'Couldn\u2019t load who came. Check signal.' })); return; }
        const kids = [];
        if (r.came.length) kids.push(el('div', { className: 'cp-going' }, faces(r.came, 'Came'), el('span', { className: 'note', textContent: `${r.came.length} came: ${r.came.map((h) => '@' + h).join(', ')}` })));
        else kids.push(el('p', { className: 'note', textContent: r.going.length ? `Nobody marked that they came. ${r.going.length} said going.` : 'Nobody marked that they came.' }));
        // the best Vetta Score crew-mates published to the crew that day; none shared, none said
        if (r.best) kids.push(el('p', {}, el('span', { className: 'cp-best', textContent: String(r.best.score) }),
          el('span', { className: 'note', textContent: `Best Vetta Score \u00b7 @${r.best.handle}${r.best.stage ? ` on ${r.best.stage}` : ''}` })));
        kids.push(el('div', { className: 'row' }, btn(r.i_came ? 'I wasn\u2019t there' : 'I was there', async () => {
          const x = await apiCall(r.i_came ? 'DELETE' : 'POST', `/api/events/${id(e)}/came`).catch(() => null);
          if (x && x.ok) redo(); else toast('Couldn\u2019t change that. Check signal.');
        }, 'linkbtn')));
        now.replaceChildren(...kids);
      });
      return now;
    }

    // ---- More: the detail, and what the planner sets after planning (P-10) --------------------------------------------
    function more(e, redo, open) {
      const det = el('details', { className: 'cp-more' }, el('summary', { textContent: 'More' }));
      det.open = open;
      const fill = () => { if (!det._filled) { det._filled = true; det.append(detail(e, redo)); } };
      det.addEventListener('toggle', () => { if (det.open) fill(); });
      if (open) fill();
      return det;
    }
    function detail(e, redo) {
      const box = el('div', { className: 'cp-more-body' });
      // your answer is one of three: a slide switch, not three keys (REVIEW.md principle 1)
      const answers = el('div', { className: 'switch', role: 'radiogroup' });
      answers.setAttribute('aria-label', 'Your answer');
      for (const [k, label] of RSVP) {
        const b = btn(label, async () => {
          const r = await apiCall('POST', `/api/events/${id(e)}/rsvp`, { status: k }).catch(() => null);
          if (!r || !r.ok) { toast('Couldn\'t save that. Check signal.'); return; }
          redo();
        }, '');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(e.my_rsvp === k));
        answers.append(b);
      }
      box.append(answers);
      const going = Array.isArray(e.going) ? e.going : [];
      if (going.length) box.append(el('p', { className: 'note', textContent: `Going: ${going.map((h) => '@' + h).join(', ')}${e.maybe ? ` \u00b7 ${e.maybe} maybe` : ''}` }));
      // roles (roadmap 21): an open one can be taken by anyone in the crew, which means going
      const roles = el('div', { className: 'row' }, el('b', { textContent: rolesLine(e) }));
      const role = (k, take) => async () => {
        const r = await apiCall('POST', `/api/events/${id(e)}/role`, { role: k, take }).catch(() => null);
        if (r && r.ok) redo(); else toast(r && r.status === 409 ? 'Someone took it first.' : 'Couldn\'t change that. Check signal.');
      };
      const held = me() && (e.lead === me() ? 'lead' : e.sweep === me() ? 'sweep' : null);
      if (held) roles.append(btn(`Stop being ${held}`, role(held, false), 'linkbtn'));
      else for (const k of ['lead', 'sweep']) if (!e[k]) roles.append(btn(k === 'lead' ? 'I\'ll lead' : 'I\'ll sweep', role(k, true), 'linkbtn'));
      box.append(roles);
      if (Array.isArray(e.regroup) && e.regroup.length) {
        box.append(el('div', { className: 'row' }, el('span', { className: 'note', textContent: 'Regroup:' }),
          ...e.regroup.map((p) => btn(p.name, () => page.goTo({ label: p.name, lat: p.lat, lon: p.lon }), 'linkbtn'))));
      }
      if (e.notes) box.append(el('p', { className: 'note', textContent: e.notes }));
      const acts = el('div', { className: 'row' }, btn('Directions to meet', () => directions(e), 'linkbtn'));
      if (e.route_id) acts.append(btn('Open the route', () => page.openRoute(e.route_id), 'linkbtn'));
      acts.append(btn('Add to calendar', () => calendar(e), 'linkbtn'));
      box.append(acts);
      if (e.can_cancel) box.append(setUp(e, redo));
      const foot = el('div', { className: 'row' });
      if (e.can_cancel) foot.append(btn('Cancel the drive', async () => {
        if (!(await ApexConfirm.ask(`Cancel ${e.title}? Everyone in the crew stops seeing it.`, 'Cancel the drive'))) return;
        const r = await apiCall('DELETE', `/api/events/${id(e)}`).catch(() => null);
        if (r && r.ok) { toast('Drive cancelled.'); redo(); } else toast('Couldn\'t cancel it. Try again.');
      }, 'linkbtn'));
      if (!e.mine && page.report) foot.append(btn('Report', () => page.report({ kind: 'event', target: e.id, label: e.title, who: e.by_handle, done: redo }), 'linkbtn'));
      if (foot.childElementCount) box.append(foot);
      return box;
    }
    /** The planner's (or the crew owner's) set-up, after planning (P-10): who sweeps or leads, regroup points, notes, the
     *  meet listing (public crews only, P-30) and keeping it as a template (the crew's owner). Each saves on its own. */
    function setUp(e, redo) {
      const put = async (b, done) => {
        const r = await apiCall('PUT', `/api/events/${id(e)}`, b).catch(() => null);
        if (r && r.ok) { if (done) toast(done); redo(); return true; }
        const j = r ? await jsonOf(r).catch(() => null) : null;
        toast(j && j.error === 'bad_role' ? 'One person can\'t both lead and sweep.' : 'Couldn\u2019t save that. Check signal.');
        return false;
      };
      const crew = known.find((c) => c.id === e.crew_id) || {};
      const box = el('div', { className: 'cp-set' }, el('p', { className: 'ctl-label', textContent: 'Set it up' }));
      // roles from the crew's members (the app's row list)
      const lead = el('select', { className: 'field' }), sweep = el('select', { className: 'field' });
      lead.setAttribute('aria-label', 'Lead'); sweep.setAttribute('aria-label', 'Sweep');
      const rolesRow = el('div', { className: 'stack-8' }, lead, sweep);
      apiCall('GET', `/api/crews/${encodeURIComponent(e.crew_id)}/members`).then(jsonOf).catch(() => null).then((list) => {
        const hs = (Array.isArray(list) ? list : []).filter((m) => m && m.handle);
        if (!hs.length) { rolesRow.remove(); return; }
        lead.replaceChildren(el('option', { value: '', textContent: 'Lead: open', selected: !e.lead }), ...hs.map((m) => el('option', { value: m.handle, textContent: m.mine ? 'You lead' : `@${m.handle} leads`, selected: e.lead === m.handle })));
        sweep.replaceChildren(el('option', { value: '', textContent: 'Sweep: someone going takes it', selected: !e.sweep }), ...hs.map((m) => el('option', { value: m.handle, textContent: m.mine ? 'You sweep' : `@${m.handle} sweeps`, selected: e.sweep === m.handle })));
        lead.addEventListener('change', () => put({ lead: lead.value || null }, 'Lead set.'));
        sweep.addEventListener('change', () => put({ sweep: sweep.value || null }, 'Sweep set.'));
        if (root.ApexRowSelect) for (const s of [lead, sweep]) root.ApexRowSelect.enhance(s);
      });
      box.append(rolesRow);
      // regroup points: up to five, each named, by search or at the map's centre
      const pts = (Array.isArray(e.regroup) ? e.regroup : []).slice();
      const list = el('div', { className: 'stack-8' }, ...pts.map((p, i) => el('div', { className: 'row', style: 'align-items:baseline' },
        el('span', { textContent: `${i + 1}. ${p.name}` }), btn('Remove', () => put({ regroup: pts.filter((_, j) => j !== i) }), 'linkbtn'))));
      box.append(el('b', { textContent: 'Regroup points' }), list);
      if (pts.length < 5) box.append(placeField('Regroup point', (p) => put({ regroup: [...pts, { name: (p.name || '').slice(0, 40), lat: p.lat, lon: p.lon }] }, 'Regroup point added.'),
        { named: true, placeholder: 'Add a regroup point, like the overlook' }));
      const notes = el('input', { className: 'field', maxLength: 280, placeholder: 'Notes, like Fuel first', autocomplete: 'off', value: e.notes || '' });
      notes.setAttribute('aria-label', 'Notes');
      box.append(el('div', { className: 'row' }, notes, btn('Save', () => put({ notes: notes.value.trim() || null }, 'Notes saved.'), 'ink-btn')));
      // a public crew can list it for everyone nearby (car meets, S-13); a private one isn't offered it (P-30)
      if (crew.visibility === 'public') {
        const listed = el('button', { type: 'button', className: 'sw' + (e.public ? ' on' : '') }, el('i'), el('span', { textContent: 'List it for everyone nearby (a meet)' }));
        listed.setAttribute('role', 'switch'); listed.setAttribute('aria-checked', String(!!e.public));
        listed.addEventListener('click', () => put({ public: !e.public }, e.public ? 'Not listed any more.' : 'Listed for everyone nearby.'));
        box.append(listed);
      }
      if (crew.role === 'owner') box.append(el('div', { className: 'row' }, btn('Keep it as a template', async () => {
        const k = await apiCall('POST', `/api/crews/${encodeURIComponent(e.crew_id)}/templates`, { name: String(e.title).slice(0, 24), title: e.title,
          meet: { name: e.meet_name || null, lat: e.meet_lat, lon: e.meet_lon }, notes: e.notes || null }).catch(() => null);
        toast(k && k.ok ? 'Kept as a template for the crew.' : k && k.status === 403 ? 'Templates come with the Club livery.' : k && k.status === 429 ? 'The crew keeps as many templates as its livery allows.' : 'Couldn\u2019t keep it. Try again.');
      }, 'linkbtn')));
      return box;
    }

    // ---- Plan a drive, on one screen (P-10, P-29) ---------------------------------------------------------------------
    // The form's own controls (REVIEW2.md U-18, REVIEW3.md): a select stays underneath as the page's value, drawn as the
    // app's row list; a yes/no is the slide switch, read through `.checked` like the checkbox it replaces.
    const rowSel = (label) => { const s = el('select', { className: 'field' }); s.setAttribute('aria-label', label); return s; };   // enhanced once it is in the form
    const sw = (label, on) => {
      const b = el('button', { type: 'button', className: 'sw' + (on ? ' on' : '') }, el('i'), el('span', { textContent: label }));
      b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!on));
      Object.defineProperty(b, 'checked', { get: () => b.classList.contains('on'), set: (v) => { b.classList.toggle('on', !!v); b.setAttribute('aria-checked', String(!!v)); } });
      b.addEventListener('click', () => { b.checked = !b.checked; b.dispatchEvent(new Event('change')); });
      return b;
    };
    const pad2 = (n) => String(n).padStart(2, '0');
    const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    /** The day as a row of stops, the next 30 days (the Worker takes a drive up to 30 days out); reads like the date tile. */
    function dayStrip(initial, now = new Date()) {
      const strip = el('div', { className: 'detents scroll', role: 'radiogroup' });
      strip.setAttribute('aria-label', 'Day');
      strip.value = initial;
      const paint = () => strip.querySelectorAll('button').forEach((b) => { const on = b.dataset.day === strip.value; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
      for (let i = 0; i < 30; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), key = dayKey(d);
        const b = el('button', { type: 'button', role: 'radio' }, el('b', { textContent: String(d.getDate()) }),
          el('small', { textContent: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString(undefined, { weekday: 'short' }) }));
        b.dataset.day = key;
        b.setAttribute('aria-label', d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
        b.addEventListener('click', () => { strip.value = key; paint(); });
        strip.append(b);
      }
      paint();
      return strip;
    }
    /** The time as a stepper, quarter hours; `.value` is "HH:MM" as the time input gave. */
    function timeStepper(initial) {
      const box = el('div', { className: 'stepper', role: 'group' }), out = el('output');
      box.setAttribute('aria-label', 'Time');
      box.value = initial;
      const paint = () => { const [h, m] = box.value.split(':').map(Number); const d = new Date(2000, 0, 1, h, m); out.textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
      const step = (dir) => () => { const [h, m] = box.value.split(':').map(Number); const t = ((h * 60 + m + dir * 15) % 1440 + 1440) % 1440; box.value = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`; paint(); };
      const minus = el('button', { type: 'button', textContent: '−' }), plus = el('button', { type: 'button', textContent: '+' });
      minus.setAttribute('aria-label', 'A quarter hour earlier'); plus.setAttribute('aria-label', 'A quarter hour later');
      minus.addEventListener('click', step(-1)); plus.addEventListener('click', step(1));
      box.append(minus, out, plus);
      paint();
      return box;
    }

    /** A Sunday run is a name, a day, a time, where to meet and which road; roles, regroup points, notes, the meet listing
     *  and the template are set on the planned drive's card under More (P-10). */
    function planForm(crews, done, pick) {
      const form = el('div', { className: 'stack-8 plan-drive' });
      const crew = rowSel('Crew');
      for (const c of crews) crew.append(el('option', { value: c.id, textContent: c.name, selected: c.id === pick }));
      // a crew's template fills the form (Club livery); shown only when the crew has one
      const tplSel = rowSel('From a template');
      tplSel.hidden = true;
      let templates = [];
      const fillTemplates = async () => {
        const list = await apiCall('GET', `/api/crews/${encodeURIComponent(crew.value)}/templates`).then(jsonOf).catch(() => null);
        templates = Array.isArray(list) ? list : [];
        tplSel.replaceChildren(el('option', { value: '', textContent: 'From a template' }), ...templates.map((t) => el('option', { value: t.id, textContent: t.name })));
        tplSel.hidden = !templates.length;
        if (tplSel._row) tplSel._row.hidden = !templates.length;
      };
      tplSel.addEventListener('change', () => {
        const t = templates.find((x) => x.id === tplSel.value); if (!t) return;
        title.value = t.title; notes = t.notes || null;
        setMeet({ name: t.meet_name || null, lat: t.meet_lat, lon: t.meet_lon });
      });
      crew.addEventListener('change', fillTemplates); fillTemplates();
      const title = el('input', { className: 'field', maxLength: 60, placeholder: 'Name it, like Cherohala Saturday', autocomplete: 'off' });
      title.setAttribute('aria-label', 'Drive name');
      // when: the day as a row of stops, the time as a stepper (never the browser's pickers)
      const date = dayStrip(dayKey(new Date(Date.now() + 86400000))), time = timeStepper('09:00');
      // where: a place search, Where I am and the map's centre as chips (P-10: never "go and move the map first")
      let meet = null, notes = null;
      const meetNote = el('p', { className: 'note', textContent: 'Search for the meeting point, or use where you are.' });
      const setMeet = (p) => {
        meet = { name: p.name ? String(p.name).slice(0, 60) : null, lat: p.lat, lon: p.lon };
        meetNote.textContent = `Meeting point: ${meet.name || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}.`;
        if (meet.name && search.field) search.field.value = meet.name;
      };
      const search = placeField('Meet at', setMeet);
      // the planned route, only when there is one (P-29: no switch that cannot be switched)
      const route = page.plannedRoute();
      const withRoute = route ? sw(`Add the planned route (${route.name})`, true) : null;
      const routeRow = withRoute || el('div', { className: 'row' }, el('span', { className: 'note', textContent: 'No route yet.' }),
        ...(page.openWhereTo ? [btn('Add a route', () => page.openWhereTo(), 'linkbtn')] : []));
      const label = (text) => el('p', { className: 'ctl-label', textContent: text });
      const head = crews.length > 1 ? [crew] : [];
      form.append(...head, tplSel, title, label('When'), date, time, label('Meet'), search, meetNote, routeRow,
        el('p', { className: 'note', textContent: 'Roles, regroup points and notes go on the drive\u2019s card, under More.' }),
        el('div', { className: 'row' }, btn('Plan it', async (ev) => {
          const b = ev && ev.currentTarget;
          const when = isoFromInputs(date.value, time.value);
          if (!title.value.trim()) { toast('Give the drive a name.'); return; }
          if (!when) { toast('Pick a date and time.'); return; }
          if (!meet) { toast('Set the meeting point.'); search.field.focus(); return; }
          if (b) { if (b.disabled) return; b.disabled = true; }
          try {
            let routeId = null;
            if (withRoute && withRoute.checked && route) {   // shared with the crew first (S-05), so every member can open it
              const r = await apiCall('POST', '/api/routes', { name: route.name, geom: route.geom, crews: [crew.value] });
              const j = r.ok ? await jsonOf(r) : null;
              if (!j || !j.id) { toast('Couldn\'t share the route with the crew. Try again, or plan it without.'); return; }
              routeId = j.id;
            }
            const r = await apiCall('POST', `/api/crews/${encodeURIComponent(crew.value)}/events`, {
              title: title.value.trim(), starts_at: when, meet, route_id: routeId, notes, public: false, sweep: null, regroup: [] });
            if (!r.ok) { toast(r.status === 429 ? 'That crew has 10 drives coming up already.' : r.status === 400 ? 'Pick a time in the next 30 days.' : 'Couldn\'t plan it. Check signal.'); return; }
            toast('Drive planned. Set roles and regroup points on its card, under More.');
            done();
          } finally { if (b) b.disabled = false; }
        }, 'ink-btn solid'), btn('Cancel', done, 'linkbtn')));
      if (root.ApexRowSelect) for (const s of crews.length > 1 ? [crew, tplSel] : [tplSel]) root.ApexRowSelect.enhance(s);   // in the form now: the rows go beside them
      tplSel._row = tplSel.nextElementSibling && tplSel.nextElementSibling.classList.contains('row-pick') ? tplSel.nextElementSibling : null;
      if (tplSel._row) tplSel._row.hidden = !templates.length;
      return form;
    }

    // Public meets from crews you're not in (S-13): no handles, how many are going, join the crew to answer.
    function meetCard(e, redo) {
      const box = el('div', { className: 'stack-8 drive-card meet-card', style: 'border:1px solid var(--rule);padding:10px' });
      box.append(el('b', { textContent: e.title }),
        el('p', { className: 'note', textContent: `${whenText(e.starts_at)} · ${e.crew_name} · ${e.km} km away` }),
        el('p', { className: 'note', textContent: `Meet: ${e.meet_name || 'the pin'}${e.notes ? ` · ${e.notes}` : ''} · ${e.going} going` }));
      const acts = el('div', { className: 'row', style: 'flex-wrap:wrap' },
        btn('Join the crew', async () => {
          const r = await apiCall('POST', `/api/crews/${encodeURIComponent(e.crew_id)}/join`);
          if (r.ok) { toast(`You're in ${e.crew_name}. Answer on its card on the crew page.`); redo(); }
          else toast(r.status === 429 ? 'You\'re in 10 crews already. Leave one first.' : 'Couldn\'t join. Try again.');
        }, 'ink-btn solid'),
        btn('Directions to meet', () => page.goTo({ label: e.meet_name || e.title, lat: e.meet_lat, lon: e.meet_lon }), 'linkbtn'),
        btn('Add to calendar', () => calendar(e, 'car-meet.ics'), 'linkbtn'));
      if (page.report) acts.append(btn('Report', () => page.report({ kind: 'event', target: e.id, label: e.title, done: redo }), 'linkbtn'));
      box.append(acts);
      return box;
    }

    /** The "Crew drives" section: the same cards as the crew page (P-18), the plan form, meets nearby. `crews` are the ones
     *  you're in ({id, name, visibility, role}). `o.crewId` (the crew page's Upcoming drives, the owner's TestFlight note
     *  05, 2026-10-31: no Crew drives row any more): only that crew's drives, a + in the head's corner plans one for it,
     *  and `o.before` (the last drive remembered) sits above the list. */
    function section(crews, o = {}) {
      known = crews;
      const one = o.crewId ? crews.filter((c) => c.id === o.crewId) : crews;
      const list = el('div', { className: 'stack-8' }), formHost = el('div'), meets = el('div', { className: 'stack-8' });
      const loadMeets = () => {
        const at = (page.here && page.here()) || (page.mapCentre && page.mapCentre());
        if (!at) return;
        apiCall('GET', `/api/events/near?lat=${at.lat.toFixed(3)}&lon=${at.lon.toFixed(3)}`).then(jsonOf).then((rows) => {
          const others = Array.isArray(rows) ? rows.filter((e) => !e.member) : [];
          meets.replaceChildren(...(others.length ? [el('h3', { textContent: 'Meets near you' }), ...others.map((e) => meetCard(e, redo))] : []));
        }).catch(() => meets.replaceChildren());
      };
      const redo = () => {
        loadMeets();
        apiCall('GET', '/api/events').then(jsonOf).then((all) => {
          if (!Array.isArray(all)) throw new Error('offline');
          const rows = o.crewId ? all.filter((e) => e.crew_id === o.crewId) : all;
          const open = new Set([...list.querySelectorAll('.drive-card')].filter((c) => c.querySelector('.cp-more[open]')).map((c) => c.dataset.id));
          const empty = o.crewId ? `${o.before ? 'Nothing planned next' : 'No drives planned'}. Tap + to plan one.`
            : crews.length ? 'No drives planned. Plan one for your crew.' : 'Join or start a crew to plan drives together.';
          list.replaceChildren(...(rows.length ? rows.map((e) => { const c = card(e, { redo, crew: one.length > 1, open: open.has(e.id) }); c.dataset.id = e.id; return c; })
            : [el('p', { className: 'note', textContent: empty })]));
        }).catch(() => list.replaceChildren(el('p', { className: 'note', textContent: 'Couldn\'t load crew drives. Check signal.' })));
      };
      // the key gives way to the form while it is open: one way to plan a drive on the screen at a time
      let planKey = null;
      if (one.length && o.crewId) {
        planKey = el('button', { type: 'button', className: 'icon-btn plan-plus', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' });
        planKey.setAttribute('aria-label', 'Plan a drive');
        planKey.addEventListener('click', () => openPlan(o.crewId));
      } else if (one.length) planKey = btn('Plan a drive', () => openPlan(), 'ink-btn');
      const openPlan = (pick) => { formHost.replaceChildren(planForm(one, () => { formHost.replaceChildren(); if (planKey) planKey.hidden = false; redo(); }, pick)); if (planKey) planKey.hidden = true; };
      const sec = o.crewId
        ? el('div', { className: 'stack-8 cp-week' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Upcoming drives' }), planKey || ''), formHost, ...(o.before ? [o.before] : []), list, meets)
        : el('div', { className: 'stack-8' }, el('h3', { textContent: 'Crew drives' }), ...(planKey ? [planKey] : []), formHost, list, meets);
      lastPlan = openPlan; lastRedo = redo;
      redo();
      return sec;
    }
    let lastPlan = null, lastRedo = null;
    /** Opens the plan form for one crew in the section last drawn (the crew page's "Plan one"). */
    function plan(crewId) { if (lastPlan) lastPlan(crewId); }
    /** Draws the Crew drives sheet again (a card on the crew page changed a drive). */
    function refresh() { if (lastRedo) lastRedo(); }
    return { section, plan, card, refresh };
  }

  const api = { whenText, timeText, convoyOpen, convoyName, driveState, onTheDay, icsFor, isoFromInputs, rolesLine, todayDrive, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
