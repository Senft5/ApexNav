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

  /** Who leads and who sweeps (roadmap 21): "Lead @bob · Sweep open". */
  function rolesLine(e) {
    const who = (h) => (h ? '@' + h : 'open');
    return `Lead ${who(e && e.lead)} \u00b7 Sweep ${who(e && e.sweep)}`;
  }
  /** The drive you're going to today, for the cockpit's morning reminder (roadmap 21): from 4 AM on its day until an hour
   *  after it starts, the earliest; null otherwise. Local time. */
  function todayDrive(events, now = new Date()) {
    const n = now.getTime(), morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4).getTime();
    const ok = (Array.isArray(events) ? events : []).filter((e) => {
      const t = Date.parse(e && e.starts_at);
      if (!Number.isFinite(t) || e.my_rsvp !== 'going') return false;
      const d = new Date(t), sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      return sameDay && n >= morning && n <= t + 3600_000;
    });
    ok.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    return ok[0] || null;
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
      // roles (roadmap 21): an open one can be taken by anyone in the crew, which means going
      const roles = el('div', { className: 'row', style: 'flex-wrap:wrap;align-items:baseline' }, el('b', { textContent: rolesLine(e) }));
      const role = (k, take) => async () => {
        const r = await apiCall('POST', `/api/events/${encodeURIComponent(e.id)}/role`, { role: k, take }).catch(() => null);
        if (r && r.ok) redo(); else toast(r && r.status === 409 ? 'Someone took it first.' : 'Couldn\'t change that. Check signal.');
      };
      const me = page.myHandle ? page.myHandle() : null, held = me && (e.lead === me ? 'lead' : e.sweep === me ? 'sweep' : null);
      if (held) roles.append(btn(`Stop being ${held}`, role(held, false), 'linkbtn'));
      else for (const k of ['lead', 'sweep']) if (!e[k]) roles.append(btn(k === 'lead' ? 'I\'ll lead' : 'I\'ll sweep', role(k, true), 'linkbtn'));
      box.append(roles);
      if (Array.isArray(e.regroup) && e.regroup.length) {
        box.append(el('div', { className: 'row', style: 'flex-wrap:wrap;align-items:baseline' }, el('span', { className: 'note', textContent: 'Regroup:' }),
          ...e.regroup.map((p) => btn(p.name, () => page.goTo({ label: p.name, lat: p.lat, lon: p.lon }), 'linkbtn'))));
      }
      // your answer is one of three: a slide switch, not three keys (REVIEW.md principle 1)
      const answers = el('div', { className: 'switch', role: 'radiogroup' });
      answers.setAttribute('aria-label', 'Your answer');
      for (const [k, label] of RSVP) {
        const b = btn(label, async () => {
          const r = await apiCall('POST', `/api/events/${encodeURIComponent(e.id)}/rsvp`, { status: k });
          if (!r.ok) { toast('Couldn\'t save that. Check signal.'); return; }
          redo();
        }, '');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(e.my_rsvp === k));
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
        const r = await page.startConvoy(`${e.call_sign || e.crew_name} \u00b7 ${e.title}`, e.going);   // named after the crew (its call sign at Works): crew_voice.js finds it
        if (!r.ok) toast(r.status === 'busy' ? 'You\'re already in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start the convoy. Try again.');
        else toast(r.invited ? `Convoy started. Invited ${r.invited} going.` : 'Convoy started.');
      }, 'ink-btn solid'));
      if (e.can_cancel) acts.append(btn('Cancel the drive', async () => {
        if (!(await ApexConfirm.ask(`Cancel ${e.title}? Everyone in the crew stops seeing it.`, 'Cancel the drive'))) return;
        const r = await apiCall('DELETE', `/api/events/${encodeURIComponent(e.id)}`);
        if (r.ok) { toast('Drive cancelled.'); redo(); } else toast('Couldn\'t cancel it. Try again.');
      }, 'linkbtn'));
      if (!e.mine && page.report) acts.append(btn('Report', () => page.report({ kind: 'event', target: e.id, label: e.title, who: e.by_handle, done: redo }), 'linkbtn'));
      box.append(answers, acts);
      return box;
    }

    // The form's own controls (REVIEW2.md U-18, REVIEW3.md): a select stays underneath as the page's value, drawn as the
    // app's row list; a yes/no is the slide switch, read through `.checked` like the checkbox it replaces.
    const rowSel = (label) => { const s = el('select', { className: 'field' }); s.setAttribute('aria-label', label); return s; };   // enhanced once it is in the form
    const sw = (label, on, disabled) => {
      const b = el('button', { type: 'button', className: 'sw' + (on ? ' on' : ''), disabled: !!disabled }, el('i'), el('span', { textContent: label }));
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

    function planForm(crews, done, pick) {
      const form = el('div', { className: 'stack-8 plan-drive' });
      const crew = rowSel('Crew');
      for (const c of crews) crew.append(el('option', { value: c.id, textContent: c.name, selected: c.id === pick }));
      // roles (roadmap 21): you lead unless you name someone; a sweep can be named now or volunteer later
      const lead = rowSel('Lead'), sweep = rowSel('Sweep');
      const fillRoles = async () => {
        const list = await apiCall('GET', `/api/crews/${encodeURIComponent(crew.value)}/members`).then(jsonOf).catch(() => null);
        const handles = (Array.isArray(list) ? list : []).filter((m) => m && m.handle);
        lead.replaceChildren(...handles.map((m) => el('option', { value: m.mine ? '' : m.handle, textContent: m.mine ? 'You lead' : `@${m.handle} leads`, selected: !!m.mine })));
        sweep.replaceChildren(el('option', { value: '', textContent: 'Sweep: someone going takes it' }),
          ...handles.map((m) => el('option', { value: m.handle, textContent: m.mine ? 'You sweep' : `@${m.handle} sweeps` })));
      };
      crew.addEventListener('change', fillRoles); fillRoles();
      // event templates (Club and Works livery): one fills the form; the crew's owner can keep this one as a template
      const tplSel = rowSel('From a template'), keep = sw('Keep it as a template for the crew', false), keepLabel = el('div', { hidden: true }, keep);
      tplSel.hidden = true;
      let templates = [];
      const fillTemplates = async () => {
        const list = await apiCall('GET', `/api/crews/${encodeURIComponent(crew.value)}/templates`).then(jsonOf).catch(() => null);
        templates = Array.isArray(list) ? list : [];
        tplSel.replaceChildren(el('option', { value: '', textContent: 'From a template' }), ...templates.map((t) => el('option', { value: t.id, textContent: t.name })));
        tplSel.hidden = !templates.length;
        keepLabel.hidden = (crews.find((c) => c.id === crew.value) || {}).role !== 'owner';
      };
      tplSel.addEventListener('change', () => {
        const t = templates.find((x) => x.id === tplSel.value); if (!t) return;
        title.value = t.title; meetName.value = t.meet_name || ''; notes.value = t.notes || '';
        setMeet({ lat: t.meet_lat, lon: t.meet_lon }, t.meet_name || 'the template\u2019s pin');
      });
      crew.addEventListener('change', fillTemplates); fillTemplates();
      // regroup points: up to five, each named, set at the map's centre
      const regroup = [], regroupList = el('div', { className: 'stack-8' });
      const regroupName = el('input', { className: 'field', maxLength: 40, placeholder: 'Regroup point name, e.g. the overlook', autocomplete: 'off' });
      regroupName.setAttribute('aria-label', 'Regroup point name');
      const paintRegroup = () => regroupList.replaceChildren(...regroup.map((p, i) => el('div', { className: 'row', style: 'align-items:baseline' },
        el('span', { textContent: `${i + 1}. ${p.name}` }), btn('Remove', () => { regroup.splice(i, 1); paintRegroup(); }, 'linkbtn'))));
      const addRegroup = btn('Add at the map centre', () => {
        const name = regroupName.value.trim(), c = page.mapCentre();
        if (!name) { toast('Name the regroup point first.'); return; }
        if (regroup.length >= 5) { toast('Five regroup points at most.'); return; }
        regroup.push({ name, lat: c.lat, lon: c.lon }); regroupName.value = ''; paintRegroup();
      }, 'ink-btn');
      const title = el('input', { className: 'field', maxLength: 60, placeholder: 'Name it, like Cherohala Saturday', autocomplete: 'off' });
      title.setAttribute('aria-label', 'Drive name');
      // when: the day as a row of stops, the time as a stepper (never the browser's pickers)
      const date = dayStrip(dayKey(new Date(Date.now() + 86400000))), time = timeStepper('09:00');
      const meetName = el('input', { className: 'field', maxLength: 60, placeholder: 'Meeting point name', autocomplete: 'off' });
      meetName.setAttribute('aria-label', 'Meeting point name');
      let meet = null;
      const meetNote = el('p', { className: 'note', textContent: 'Set the meeting point: where you are, or the centre of the map.' });
      const setMeet = (p, how) => { if (!p) { toast('No GPS fix yet.'); return; } meet = p; meetNote.textContent = `Meeting point: ${how} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}).`; };
      const route = page.plannedRoute();
      const withRoute = sw(route ? `Add the planned route (${route.name})` : 'Plan a route first to add it', !!route, !route);
      const notes = el('input', { className: 'field', maxLength: 280, placeholder: 'Notes', autocomplete: 'off' });
      notes.setAttribute('aria-label', 'Notes');
      // a public crew can list it for everyone nearby (car meets, S-13)
      const listed = sw('List it for everyone nearby (a meet)', false);
      const listedLabel = listed.querySelector('span');
      const paintListed = () => {
        const pub = (crews.find((c) => c.id === crew.value) || {}).visibility === 'public';
        listed.disabled = !pub; if (!pub) listed.checked = false;
        listedLabel.textContent = pub ? 'List it for everyone nearby (a meet)' : 'Only public crews can list a meet for everyone';
      };
      crew.addEventListener('change', paintListed); paintListed();
      const label = (text) => el('p', { className: 'ctl-label', textContent: text });
      form.append(crew, tplSel, title, label('When'), date, time,
        label('Meet'), el('div', { className: 'row', style: 'flex-wrap:wrap' }, btn('Where I am', () => setMeet(page.here(), 'where you are'), 'ink-btn'), btn('Map centre', () => setMeet(page.mapCentre(), 'map centre'), 'ink-btn')),
        meetNote, meetName,
        withRoute,
        label('Roles'), lead, sweep,
        label('Regroup points'), regroupList, el('div', { className: 'row' }, regroupName, addRegroup),
        notes,
        listed, keepLabel,
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
            title: title.value.trim(), starts_at: when, meet: { name: meetName.value.trim() || null, lat: meet.lat, lon: meet.lon }, route_id: routeId, notes: notes.value.trim() || null, public: listed.checked,
            lead: lead.value || undefined, sweep: sweep.value || null, regroup });
          if (!r.ok) { const j = await jsonOf(r).catch(() => null); if (j && j.error === 'bad_role') { toast('One person can\'t both lead and sweep.'); return; }
            toast(r.status === 429 ? 'That crew has 10 drives coming up already.' : r.status === 400 ? 'Pick a time in the next 30 days.' : 'Couldn\'t plan it. Check signal.'); return; }
          if (keep.checked) {
            const k = await apiCall('POST', `/api/crews/${encodeURIComponent(crew.value)}/templates`, { name: title.value.trim().slice(0, 24), title: title.value.trim(),
              meet: { name: meetName.value.trim() || null, lat: meet.lat, lon: meet.lon }, notes: notes.value.trim() || null }).catch(() => null);
            if (!k || !k.ok) toast(k && k.status === 403 ? 'Templates come with the Club livery.' : k && k.status === 429 ? 'The crew keeps as many templates as its livery allows.' : 'The drive is planned; the template wasn\u2019t kept.');
          }
          toast('Drive planned. The crew sees it in Crew.');
          done();
        }, 'ink-btn solid'), btn('Cancel', done, 'linkbtn')));
      if (root.ApexRowSelect) for (const s of [crew, tplSel, lead, sweep]) root.ApexRowSelect.enhance(s);   // in the form now: the rows go beside them
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
      // the key gives way to the form while it is open: one way to plan a drive on the screen at a time
      const planKey = crews.length ? btn('Plan a drive', () => openPlan(), 'ink-btn') : null;
      const openPlan = (pick) => { formHost.replaceChildren(planForm(crews, () => { formHost.replaceChildren(); if (planKey) planKey.hidden = false; redo(); }, pick)); if (planKey) planKey.hidden = true; };
      if (planKey) sec.append(planKey);
      sec.append(formHost, list, meets);
      lastPlan = openPlan;
      redo();
      return sec;
    }
    let lastPlan = null;
    /** Opens the plan form for one crew in the section last drawn (the crew page's "Plan a drive"). */
    function plan(crewId) { if (lastPlan) lastPlan(crewId); }
    return { section, plan };
  }

  const api = { whenText, convoyOpen, icsFor, isoFromInputs, rolesLine, todayDrive, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
