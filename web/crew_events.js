// Crew drives (IDEAS S-06) in the Crew tab: what's coming up across your crews (when, where you meet, who's going), your
// answer (going / maybe / can't), directions to the meeting point, the route, a calendar file, and on the day the
// planner's "Start the convoy" that invites everyone going. "Plan a drive" makes one for a crew. Everything people typed is
// set as text. whenText, icsFor and convoyOpen are pure (tests/test_crew_events.py); mount() draws the section.
(function (root) {
  'use strict';
  const CONVOY_BEFORE_MS = 2 * 3600_000, CONVOY_AFTER_MS = 4 * 3600_000;

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

  /** The planner may start the drive's convoy from 2 h before it starts until 4 h after. */
  function convoyOpen(e, now = Date.now()) {
    const t = Date.parse(e.starts_at);
    return !!e.mine && Number.isFinite(t) && now >= t - CONVOY_BEFORE_MS && now <= t + CONVOY_AFTER_MS;
  }

  const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /** An .ics calendar event (2 h long, at the meeting point), for "Add to calendar". */
  function icsFor(e, now = Date.now()) {
    const start = Date.parse(e.starts_at);
    const where = e.meet_name ? `${e.meet_name} (${e.meet_lat}, ${e.meet_lon})` : `${e.meet_lat}, ${e.meet_lon}`;
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApexNav//Crew drive//EN', 'BEGIN:VEVENT',
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

  /**
   * page: el, btn, toast, apiCall, jsonOf, report (safety), crews() → [{id, name}], here() → {lat, lon}|null,
   * mapCentre() → {lat, lon}, plannedRoute() → {name, geom}|null, goTo({label, lat, lon}), openRoute(id), startConvoy(name, handles).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const RSVP = [['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can\'t']];

    function card(e, redo) {
      const box = el('div', { className: 'stack-8 drive-card', style: 'border:1px solid var(--rule);padding:10px' });
      box.append(el('b', { textContent: e.title }),
        el('p', { className: 'note', textContent: `${whenText(e.starts_at)} · ${e.crew_name} · by @${e.by_handle || '?'}` }),
        el('p', { className: 'note', textContent: `Meet: ${e.meet_name || 'the pin'}${e.notes ? ` · ${e.notes}` : ''}` }),
        el('p', { className: 'note', textContent: e.going.length ? `Going: ${e.going.map((h) => '@' + h).join(', ')}${e.maybe ? ` · ${e.maybe} maybe` : ''}` : 'Nobody going yet.' }));
      const answers = el('div', { className: 'row', role: 'group' });
      answers.setAttribute('aria-label', 'Your answer');
      for (const [k, label] of RSVP) {
        const b = btn(label, async () => {
          const r = await apiCall('POST', `/api/events/${encodeURIComponent(e.id)}/rsvp`, { status: k });
          if (!r.ok) { toast('Couldn\'t save that. Check signal.'); return; }
          redo();
        }, 'ink-btn' + (e.my_rsvp === k ? ' on' : ''));
        b.setAttribute('aria-pressed', String(e.my_rsvp === k));
        answers.append(b);
      }
      const acts = el('div', { className: 'row', style: 'flex-wrap:wrap' },
        btn('Directions to meet', () => page.goTo({ label: e.meet_name || e.title, lat: e.meet_lat, lon: e.meet_lon }), 'linkbtn'));
      if (e.route_id) acts.append(btn('Open the route', () => page.openRoute(e.route_id), 'linkbtn'));
      acts.append(btn('Add to calendar', () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([icsFor(e)], { type: 'text/calendar' })), download: 'crew-drive.ics' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }, 'linkbtn'));
      if (convoyOpen(e)) acts.append(btn('Start the convoy', async () => {
        const r = await page.startConvoy(e.title, e.going);
        if (!r.ok) toast(r.status === 'busy' ? 'You\'re already in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start the convoy. Try again.');
        else toast(r.invited ? `Convoy started. Invited ${r.invited} going.` : 'Convoy started.');
      }, 'ink-btn solid'));
      if (e.can_cancel) acts.append(btn('Cancel the drive', async () => {
        if (!confirm(`Cancel ${e.title}? Everyone in the crew stops seeing it.`)) return;
        const r = await apiCall('DELETE', `/api/events/${encodeURIComponent(e.id)}`);
        if (r.ok) { toast('Drive cancelled.'); redo(); } else toast('Couldn\'t cancel it. Try again.');
      }, 'linkbtn'));
      if (!e.mine && page.report) acts.append(btn('Report', () => page.report({ kind: 'event', target: e.id, label: e.title, who: e.by_handle, done: redo }), 'linkbtn'));
      box.append(answers, acts);
      return box;
    }

    function planForm(crews, done) {
      const form = el('div', { className: 'stack-8' });
      const crew = el('select', { className: 'field' });
      crew.setAttribute('aria-label', 'Crew');
      for (const c of crews) crew.append(el('option', { value: c.id, textContent: c.name }));
      const title = el('input', { className: 'field', maxLength: 60, placeholder: 'What (e.g. Cherohala Saturday)', autocomplete: 'off' });
      title.setAttribute('aria-label', 'Drive name');
      const tomorrow = new Date(Date.now() + 86400000);
      const date = el('input', { className: 'field', type: 'date', value: `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}` });
      const time = el('input', { className: 'field', type: 'time', value: '09:00' });
      date.setAttribute('aria-label', 'Date'); time.setAttribute('aria-label', 'Time');
      const meetName = el('input', { className: 'field', maxLength: 60, placeholder: 'Meeting point name', autocomplete: 'off' });
      meetName.setAttribute('aria-label', 'Meeting point name');
      let meet = null;
      const meetNote = el('p', { className: 'note', textContent: 'Set the meeting point: where you are, or the centre of the map.' });
      const setMeet = (p, how) => { if (!p) { toast('No GPS fix yet.'); return; } meet = p; meetNote.textContent = `Meeting point: ${how} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}).`; };
      const route = page.plannedRoute();
      const withRoute = el('input', { type: 'checkbox', checked: !!route, disabled: !route });
      const notes = el('input', { className: 'field', maxLength: 280, placeholder: 'Notes (optional)', autocomplete: 'off' });
      notes.setAttribute('aria-label', 'Notes');
      // a public crew can list it for everyone nearby (car meets, S-13)
      const listed = el('input', { type: 'checkbox' });
      const listedLabel = el('span');
      const paintListed = () => {
        const pub = (crews.find((c) => c.id === crew.value) || {}).visibility === 'public';
        listed.disabled = !pub; if (!pub) listed.checked = false;
        listedLabel.textContent = pub ? 'List it for everyone nearby (a meet)' : 'Only public crews can list a meet for everyone';
      };
      crew.addEventListener('change', paintListed); paintListed();
      form.append(crew, title, el('div', { className: 'row' }, date, time),
        el('div', { className: 'row', style: 'flex-wrap:wrap' }, btn('Where I am', () => setMeet(page.here(), 'where you are'), 'ink-btn'), btn('Map centre', () => setMeet(page.mapCentre(), 'map centre'), 'ink-btn')),
        meetNote, meetName,
        el('label', { className: 'row', style: 'align-items:center;gap:8px' }, withRoute, el('span', { textContent: route ? `Add the planned route (${route.name})` : 'Plan a route first to add it' })),
        notes,
        el('label', { className: 'row', style: 'align-items:center;gap:8px' }, listed, listedLabel),
        el('div', { className: 'row' }, btn('Plan it', async () => {
          const when = isoFromInputs(date.value, time.value);
          if (!title.value.trim()) { toast('Give the drive a name.'); return; }
          if (!when) { toast('Pick a date and time.'); return; }
          if (!meet) { toast('Set the meeting point.'); return; }
          let routeId = null;
          if (withRoute.checked && route) {   // shared with the crew first (S-05), so every member can open it
            const r = await apiCall('POST', '/api/routes', { name: route.name, geom: route.geom, crews: [crew.value] });
            const j = r.ok ? await jsonOf(r) : null;
            if (!j || !j.id) { toast('Couldn\'t share the route with the crew. Try again, or plan it without.'); return; }
            routeId = j.id;
          }
          const r = await apiCall('POST', `/api/crews/${encodeURIComponent(crew.value)}/events`, {
            title: title.value.trim(), starts_at: when, meet: { name: meetName.value.trim() || null, lat: meet.lat, lon: meet.lon }, route_id: routeId, notes: notes.value.trim() || null, public: listed.checked });
          if (!r.ok) { toast(r.status === 429 ? 'That crew has 10 drives coming up already.' : r.status === 400 ? 'Pick a time in the next 30 days.' : 'Couldn\'t plan it. Check signal.'); return; }
          toast('Drive planned. The crew sees it in Crew.');
          done();
        }, 'ink-btn solid'), btn('Cancel', done, 'linkbtn')));
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
          if (r.ok) { toast(`You're in ${e.crew_name}. Answer in Crew drives.`); redo(); }
          else toast(r.status === 429 ? 'You\'re in 10 crews already. Leave one first.' : 'Couldn\'t join. Try again.');
        }, 'ink-btn solid'),
        btn('Directions to meet', () => page.goTo({ label: e.meet_name || e.title, lat: e.meet_lat, lon: e.meet_lon }), 'linkbtn'),
        btn('Add to calendar', () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([icsFor(e)], { type: 'text/calendar' })), download: 'car-meet.ics' });
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }, 'linkbtn'));
      if (page.report) acts.append(btn('Report', () => page.report({ kind: 'event', target: e.id, label: e.title, done: redo }), 'linkbtn'));
      box.append(acts);
      return box;
    }

    /** The "Crew drives" section; `crews` are the ones you're in ({id, name, visibility}). */
    function section(crews) {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Crew drives' }));
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
        apiCall('GET', '/api/events').then(jsonOf).then((rows) => {
          if (!Array.isArray(rows)) throw new Error('offline');
          list.replaceChildren(...(rows.length ? rows.map((e) => card(e, redo)) : [el('p', { className: 'note', textContent: crews.length ? 'No drives planned. Plan one for your crew.' : 'Join or start a crew to plan drives together.' })]));
        }).catch(() => list.replaceChildren(el('p', { className: 'note', textContent: 'Couldn\'t load crew drives. Check signal.' })));
      };
      if (crews.length) sec.append(btn('Plan a drive', () => formHost.replaceChildren(planForm(crews, () => { formHost.replaceChildren(); redo(); })), 'ink-btn'));
      sec.append(formHost, list, meets);
      redo();
      return sec;
    }
    return { section };
  }

  const api = { whenText, convoyOpen, icsFor, isoFromInputs, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
