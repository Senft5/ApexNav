// The crew page (docs/design/REVIEW.md roadmap 20, mockup docs/design/09-crew-page.html): the Crew tab opens your crew.
// Its face (a cover photo or the drawn hills, a stock crest, the motto, one stripe colour: the Plain livery), the next
// drive with who's going, the Vetta Score board this month and the crew's chat. The owner edits the livery. Everything
// people typed is set as text. backend/src/crew_page.ts. The pure helpers (dateBlock, ago, goingFaces, stripeOk) are
// tested in tests/test_crew_page.py.
(function (root) {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  // The stock crests: drawn in a shield, one stroke colour (backend CRESTS lists the same ids).
  const CRESTS = {
    apex: ['M14 30 C20 30 22 18 34 16', 'circle:27,21,2.6'],
    peak: ['M10 32 L20 18 L25 24 L29 19 L38 32', 'M17 22 L20 18 L23 22'],
    tulip: ['circle:24,33,2.6', 'M24 31 V20', 'M24 20 L32 14', 'M28 13 L32 14 L31 18'],
    wheel: ['circle:24,23,9', 'circle:24,23,2', 'M24 14 V21', 'M16.5 27.5 L22.3 24', 'M31.5 27.5 L25.7 24'],
    wing: ['M12 20 C20 20 26 22 36 30', 'M14 25 C20 25 25 26 32 31', 'M16 30 C21 30 24 30 28 32'],
    crown: ['M13 30 L15 17 L20 24 L24 15 L28 24 L33 17 L35 30 Z', 'M13 33 H35'],
  };
  const CREST_NAMES = { apex: 'Apex', peak: 'Peak', tulip: 'Tulip', wheel: 'Wheel', wing: 'Wing', crown: 'Crown' };
  // Plain livery: one stripe colour from a short list that reads on paper and on ink.
  const STRIPES = ['#c8102e', '#d9661f', '#c9a227', '#2e7d4f', '#1f5fa8', '#6b3fa0', '#5a5a5a', '#111111'];
  const STRIPE_NAMES = ['Red', 'Orange', 'Gold', 'Green', 'Blue', 'Purple', 'Grey', 'Black'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** The black date block of a drive: { day: '2', mon: 'NOV' } in the phone's time zone; '--' when the time is unknown. */
  function dateBlock(iso) {
    const t = new Date(iso);
    if (!Number.isFinite(t.getTime())) return { day: '--', mon: '' };
    return { day: String(t.getDate()), mon: MONTHS[t.getMonth()] };
  }
  /** A chat time: "now", "12 min", "3 h", then "Oct 12". `at` is D1's UTC 'YYYY-MM-DD HH:MM:SS'. */
  function ago(at, now = Date.now()) {
    const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    const d = new Date(t);
    return `${MONTHS[d.getMonth()].charAt(0)}${MONTHS[d.getMonth()].slice(1).toLowerCase()} ${d.getDate()}`;
  }
  /** Who's going, as at most three initials and a "+n". */
  function goingFaces(handles, max = 3) {
    const list = (handles || []).filter(Boolean);
    const faces = list.slice(0, max).map((h) => String(h).replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
    return { faces, more: Math.max(0, list.length - max), n: list.length };
  }
  const stripeOk = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

  function crestSvg(id, px = 64) {
    const d = root.document, svg = d.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('width', px); svg.setAttribute('height', px);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'cp-crest-svg');
    const add = (tag, attrs) => { const n = d.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    add('path', { d: 'M24 5 L40 11 V24 C40 33 33 40 24 44 C15 40 8 33 8 24 V11 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linejoin': 'round' });
    for (const p of CRESTS[id] || CRESTS.apex) {
      if (p.startsWith('circle:')) {
        const [cx, cy, r] = p.slice(7).split(',');
        add('circle', { cx, cy, r, fill: r < 3 ? 'var(--cp-stripe, var(--accent))' : 'none', stroke: r < 3 ? 'none' : 'currentColor', 'stroke-width': 2.2 });
      } else add('path', { d: p, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
    return svg;
  }
  // The cover when there is no photo: hills and a road, drawn (never a stock photograph).
  function hills() {
    const d = root.document, svg = d.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 390 140'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'cp-hills');
    const add = (tag, attrs) => { const n = d.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    add('rect', { width: 390, height: 140, fill: 'var(--cp-sky)' });
    add('path', { d: 'M0 70 C60 40 120 60 180 45 S300 20 390 50 V140 H0 Z', fill: 'var(--cp-far)' });
    add('path', { d: 'M0 100 C80 70 150 95 230 80 S340 60 390 75 V140 H0 Z', fill: 'var(--cp-near)' });
    add('path', { d: 'M100 140 C160 120 200 115 250 104 S350 96 390 98', fill: 'none', stroke: 'var(--cp-road)', 'stroke-width': 9, 'stroke-linecap': 'round' });
    add('path', { d: 'M100 140 C160 120 200 115 250 104 S350 96 390 98', fill: 'none', stroke: 'var(--cp-far)', 'stroke-width': 1.2, 'stroke-dasharray': '6 6' });
    return svg;
  }

  const STYLE = `
    .crew-page { --cp-stripe: var(--accent); --cp-sky: #b9ad94; --cp-far: #8c826f; --cp-near: #6c6455; --cp-road: #efe6d4; margin: 0 -16px; }
    .cp-head { position: relative; height: 150px; overflow: hidden; background: var(--cp-near); }
    .cp-head > img, .cp-head > .cp-hills { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .cp-head .cp-edit { position: absolute; top: 10px; right: 12px; background: var(--panel); }
    .cp-stripe { height: 12px; background: repeating-linear-gradient(90deg, var(--panel-ink) 0 92px, var(--cp-stripe) 92px 124px, var(--panel-ink) 124px 136px, transparent 136px 148px); }
    .cp-crest { position: relative; width: 76px; height: 76px; margin: -58px 0 0 16px; background: var(--panel); color: var(--panel-ink);
      border: 2px solid var(--panel-ink); box-shadow: 0 3px 0 var(--panel-dim); display: grid; place-items: center; overflow: hidden; }
    .cp-crest img { width: 100%; height: 100%; object-fit: cover; }
    .cp-body { padding: 8px 16px 0; display: grid; gap: 14px; }
    .cp-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .cp-title h2 { margin: 0; font-size: 30px; line-height: 1.05; overflow-wrap: anywhere; }
    .cp-motto { font-style: italic; color: var(--panel-dim); margin: 2px 0 0; }
    .cp-meta { font-weight: 600; margin: 4px 0 0; }
    .cp-sec { display: flex; justify-content: space-between; align-items: baseline; }
    .crew-page .cp-sec h3 { margin: 0; font-size: 22px; border: 0; padding: 0; }
    .cp-sec { margin-top: 10px; }
    .cp-drive { display: grid; grid-template-columns: 76px 1fr; border: 1.5px solid var(--panel-ink); }
    .cp-date { background: var(--panel-ink); color: var(--panel); display: grid; place-content: center; text-align: center; font-family: var(--font-num); }
    .cp-date b { font-size: 34px; line-height: 1; } .cp-date span { font-size: 13px; letter-spacing: 0.08em; }
    .cp-drive-body { padding: 10px 12px; display: grid; gap: 6px; min-width: 0; }
    .cp-drive-body b { font-size: 18px; overflow-wrap: anywhere; }
    .cp-going { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cp-faces { display: flex; } .cp-faces .avatar { margin-left: -6px; } .cp-faces .avatar:first-child { margin-left: 0; }
    .cp-board-row { display: grid; grid-template-columns: 28px 1fr auto; align-items: baseline; gap: 8px; padding: 8px 0; border-top: 1px solid var(--rule); }
    .cp-board-row .rank { font-family: var(--font-num); color: var(--panel-dim); font-size: 18px; }
    .cp-board-row .who { min-width: 0; overflow-wrap: anywhere; } .cp-board-row .who small { color: var(--panel-dim); margin-left: 6px; }
    .cp-board-row .score { font-family: var(--font-num); font-size: 26px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
    .cp-board-row.mine .who b { text-decoration: underline; text-decoration-thickness: 2px; }
    .cp-msg { display: grid; grid-template-columns: 40px 1fr; gap: 10px; padding: 8px 0; border-top: 1px solid var(--rule); }
    .cp-msg p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .cp-msg .row { gap: 10px; align-items: baseline; }
    .cp-say { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .cp-say textarea { min-height: 44px; resize: vertical; }
    .cp-crests { display: flex; flex-wrap: wrap; gap: 8px; }
    .cp-crests button { width: 64px; height: 64px; display: grid; place-items: center; background: var(--panel); color: var(--panel-ink); border: 1.5px solid var(--rule); }
    .cp-crests button[aria-pressed="true"] { border: 2.5px solid var(--panel-ink); box-shadow: 0 2px 0 var(--panel-dim); }
    .cp-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .cp-swatches button { width: 40px; height: 40px; border: 2px solid var(--panel); outline: 1.5px solid var(--rule); }
    .cp-swatches button[aria-pressed="true"] { outline: 3px solid var(--panel-ink); }
    .cp-switch { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  `;

  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const P = () => root.ApexPhotos;
    if (!root.document.getElementById('crewPageStyle')) root.document.head.append(el('style', { id: 'crewPageStyle', textContent: STYLE }));

    async function load(id) {
      let r; try { r = await apiCall('GET', `/api/crews/${encodeURIComponent(id)}/page`); } catch (_) { return null; }
      return r && r.ok ? r.json() : null;
    }

    /** The page for one crew: an element that fills itself in. */
    function view(id) {
      const box = el('div', { className: 'crew-page' });
      const draw = async () => {
        const c = await load(id);
        if (!c || !c.id || !Array.isArray(c.board)) { box.replaceChildren(el('p', { className: 'note', style: 'padding:0 16px', textContent: 'Couldn’t load the crew. Check signal.' }), btn('Try again', draw, 'ink-btn')); return; }
        if (stripeOk(c.stripe)) box.style.setProperty('--cp-stripe', c.stripe);
        // Going and Share redraw only their own part, so a half-typed chat message stays put
        let driveSec = null, boardSec = null;
        const part = (make, get, set) => async () => { const c2 = await load(id); if (c2 && Array.isArray(c2.board)) { const n = make(c2); get().replaceWith(n); set(n); } };
        const redoDrive = part((c2) => nextDrive(c2, redoDrive), () => driveSec, (n) => { driveSec = n; });
        const redoBoard = part((c2) => board(c2, redoBoard), () => boardSec, (n) => { boardSec = n; });
        driveSec = nextDrive(c, redoDrive); boardSec = board(c, redoBoard);
        box.replaceChildren(header(c, draw), el('div', { className: 'cp-body' }, titleBlock(c), driveSec, boardSec, chat(c)));
      };
      draw();
      return box;
    }

    function header(c, redo) {
      const head = el('div', { className: 'cp-head' });
      if (c.cover_photo_id && P()) { const i = P().img(c.cover_photo_id, '', `${c.name}'s cover`); head.append(hills(), i); } else head.append(hills());
      if (c.is_owner) head.append(btn('Edit livery', () => editLivery(c, redo), 'ink-btn cp-edit'));
      const crest = el('div', { className: 'cp-crest' });
      crest.append(c.crest_photo_id && P() ? P().img(c.crest_photo_id, '', `${c.name}'s crest`) : crestSvg(c.crest || 'apex'));
      return el('div', {}, head, el('div', { className: 'cp-stripe' }), crest);
    }

    function titleBlock(c) {
      const meta = [`${c.members} ${c.members === 1 ? 'member' : 'members'}`, c.visibility === 'public' ? 'Public' : 'Private', c.area_name].filter(Boolean).join(' · ');
      const left = el('div', { style: 'min-width:0' }, el('h2', { textContent: c.name }));
      if (c.motto) left.append(el('p', { className: 'cp-motto', textContent: c.motto }));
      left.append(el('p', { className: 'cp-meta', textContent: meta }));
      const right = c.is_owner && page.invite ? btn('Invite', () => page.invite(c), 'ink-btn') : '';
      return el('div', { className: 'cp-title' }, left, right);
    }

    function nextDrive(c, redo) {
      const all = page.onAllDrives ? btn('All drives', page.onAllDrives, 'linkbtn') : '';
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Next drive' }), all));
      const e = c.next;
      if (!e) {
        sec.append(el('div', { className: 'row', style: 'align-items:center;justify-content:space-between' },
          el('p', { className: 'note', textContent: 'No drive planned.' }), page.onPlan ? btn('Plan a drive', () => page.onPlan(c), 'ink-btn') : ''));
        return sec;
      }
      const d = dateBlock(e.starts_at), when = root.ApexCrewEvents ? root.ApexCrewEvents.whenText(e.starts_at) : '';
      const time = when.includes('·') ? when.split('·').pop().trim() : when.replace(/^(Today|Tomorrow) /, '');
      const g = goingFaces(e.going), going = e.my_rsvp === 'going';
      const faces = el('span', { className: 'cp-faces' }, ...g.faces.map((f, i) => (P() ? P().avatar(null, e.going[i], 30) : el('b', { textContent: f }))));
      if (g.more) faces.append(el('span', { className: 'avatar', style: '--av:30px' }, el('b', { textContent: `+${g.more}` })));
      const rsvp = btn(going ? 'Going' : 'I’m going', async () => {
        const r = await apiCall('POST', `/api/events/${encodeURIComponent(e.id)}/rsvp`, { status: going ? 'no' : 'going' }).catch(() => null);
        if (!r || !r.ok) { toast('Couldn’t save that. Check signal.'); return; }
        redo();
      }, going ? 'ink-btn solid' : 'ink-btn');
      rsvp.setAttribute('aria-pressed', String(going));
      sec.append(el('div', { className: 'cp-drive' },
        el('div', { className: 'cp-date' }, el('b', { textContent: d.day }), el('span', { textContent: d.mon })),
        el('div', { className: 'cp-drive-body' }, el('b', { textContent: e.title }),
          el('span', { className: 'note', textContent: [time, e.meet_name ? `Meet at ${e.meet_name}` : 'Meet at the pin'].filter(Boolean).join(' · ') }),
          el('span', { className: 'note', textContent: root.ApexCrewEvents ? root.ApexCrewEvents.rolesLine(e) : '' }),
          el('div', { className: 'cp-going' }, g.n ? faces : '', el('span', { className: 'note', textContent: g.n ? `${g.n} going` : 'Nobody going yet' }), el('span', { style: 'flex:1' }), rsvp))));
      return sec;
    }

    function board(c, redo) {
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Vetta Score board' }), el('span', { className: 'note', textContent: 'This month' })));
      const list = el('div');
      c.board.forEach((r, i) => {
        const who = el('span', { className: 'who' }, el('b', { textContent: `@${r.handle || '?'}` }));
        if (r.car) who.append(el('small', { textContent: r.car }));
        list.append(el('div', { className: 'cp-board-row' + (r.mine ? ' mine' : '') },
          el('span', { className: 'rank', textContent: r.score == null ? '' : String(i + 1) }), who,
          el('span', { className: 'score', textContent: r.score == null ? '--' : String(r.score) })));
      });
      sec.append(list, el('p', { className: 'note', textContent: 'Best Score this month, only from people who share Scores with the crew.' }));
      if (!c.sharing_scores) {
        sec.append(btn('Share my Scores with the crew', async () => {
          const r = await apiCall('PUT', '/api/grants', { audience_type: 'crew', audience_id: c.id, share_scores: true, share_times: false }).catch(() => null);
          if (r && r.ok) { toast(`${c.name} sees your Scores from your next drive on.`); redo(); } else toast('Couldn’t change that. Try again.');
        }, 'ink-btn'));
      }
      return sec;
    }

    function chat(c) {
      const list = el('div'); list.setAttribute('aria-live', 'polite');
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Chat' }), el('span', { className: 'note', textContent: 'Kept 30 days' })), list);
      const fill = async () => {
        const r = await apiCall('GET', `/api/crews/${encodeURIComponent(c.id)}/chat`).catch(() => null);
        const msgs = r && r.ok ? await r.json() : null;
        if (!msgs) { list.replaceChildren(el('p', { className: 'note', textContent: 'Couldn’t load the chat. Check signal.' })); return; }
        if (!msgs.length) { list.replaceChildren(el('p', { className: 'note', textContent: 'Nothing said yet.' })); return; }
        list.replaceChildren(...msgs.map((m) => {
          const acts = [];
          if (m.mine || c.is_owner) acts.push(btn('Delete', async () => {
            if (!confirm('Delete this message?')) return;
            const d = await apiCall('DELETE', `/api/crews/${encodeURIComponent(c.id)}/chat/${encodeURIComponent(m.id)}`).catch(() => null);
            if (d && d.ok) fill(); else toast('Couldn’t delete it. Try again.');
          }, 'linkbtn'));
          if (!m.mine && page.report) acts.push(btn('Report', () => page.report({ kind: 'chat', target: m.id, label: `a message from @${m.handle} in ${c.name}`, who: m.handle, done: fill }), 'linkbtn'));
          return el('div', { className: 'cp-msg' }, P() ? P().avatar(m.photo_id, m.handle, 40) : el('span'),
            el('div', { style: 'min-width:0' }, el('div', { className: 'row' }, el('b', { textContent: `@${m.handle || '?'}` }), el('span', { className: 'note', textContent: ago(m.created_at) }), ...acts),
              el('p', { textContent: m.body })));
        }));
      };
      const input = el('textarea', { className: 'field', maxLength: 500, rows: 2, placeholder: `Say something to ${c.name}` });
      input.setAttribute('aria-label', `Message to ${c.name}`);
      const send = btn('Send', async () => {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        const r = await apiCall('POST', `/api/crews/${encodeURIComponent(c.id)}/chat`, { body: text }).catch(() => null);
        send.disabled = false;
        if (r && r.ok) { input.value = ''; fill(); }
        else toast(r && r.status === 429 ? 'That’s a lot of messages. Wait a while.' : 'Couldn’t send. Check signal.');
      }, 'ink-btn solid');
      sec.append(el('div', { className: 'cp-say' }, input, send));
      fill();
      return sec;
    }

    // The owner's livery editor, Plain tier: motto, crest, stripe colour, cover photo.
    function editLivery(c, redo) {
      const d = root.document, ov = el('div', { className: 'overlay show cp-livery' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Edit livery');
      let crest = c.crest || 'apex', stripe = stripeOk(c.stripe) ? c.stripe.toLowerCase() : STRIPES[0];
      const motto = el('input', { className: 'field', maxLength: 80, value: c.motto || '', placeholder: 'A line under the name' });
      const crests = el('div', { className: 'cp-crests', role: 'group' }), swatches = el('div', { className: 'cp-swatches', role: 'group' });
      crests.setAttribute('aria-label', 'Crest'); swatches.setAttribute('aria-label', 'Stripe colour');
      const paint = () => {
        crests.replaceChildren(...Object.keys(CRESTS).map((id) => {
          const b = el('button', { type: 'button', onclick: () => { crest = id; paint(); } }, crestSvg(id, 44));
          b.setAttribute('aria-pressed', String(crest === id)); b.setAttribute('aria-label', CREST_NAMES[id]); return b;
        }));
        swatches.replaceChildren(...STRIPES.map((s) => {
          const b = el('button', { type: 'button', style: `background:${s}`, onclick: () => { stripe = s; paint(); } });
          b.setAttribute('aria-pressed', String(stripe === s)); b.setAttribute('aria-label', STRIPE_NAMES[STRIPES.indexOf(s)]); return b;
        }));
      };
      paint();
      const close = () => ov.remove();
      const save = btn('Save', async () => {
        const r = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/page`, { motto: motto.value.trim() || null, crest, stripe }).catch(() => null);
        if (r && r.ok) { close(); redo(); } else toast('Couldn’t save the livery. Try again.');
      }, 'ink-btn solid');
      const cover = P() ? P().picker(c.cover_photo_id ? 'Change cover photo' : 'Add a cover photo', 'crew', c.id, () => { close(); redo(); }, { toast }) : '';
      ov.append(el('div', { className: 'stack-8', style: 'max-width:520px' },
        el('h2', { textContent: 'Plain livery' }),
        el('label', { className: 'stack-8' }, el('b', { textContent: 'Motto' }), motto),
        el('b', { textContent: 'Crest' }), crests,
        el('b', { textContent: 'Stripe' }), swatches,
        el('b', { textContent: 'Cover' }), el('div', { className: 'row' }, cover),
        el('p', { className: 'note', textContent: 'Photos lose their location data before they leave your phone.' }),
        el('div', { className: 'row' }, save, btn('Cancel', close, 'linkbtn'))));
      d.body.append(ov);
      motto.focus();
    }

    /** Several crews: a row of their names to switch between; `pick(id)` opens one. */
    function switcher(crews, current, pick) {
      const row = el('div', { className: 'cp-switch stamps', role: 'group' });
      row.setAttribute('aria-label', 'Your crews');
      for (const c of crews) {
        const b = btn(c.name, () => pick(c.id), 'chip');
        b.setAttribute('aria-pressed', String(c.id === current));
        if (c.id === current) b.classList.add('on');
        row.append(b);
      }
      return row;
    }

    return { view, switcher };
  }

  const api = { mount, dateBlock, ago, goingFaces, stripeOk, crestSvg, CRESTS: Object.keys(CRESTS), STRIPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewPage = api;
})(typeof window !== 'undefined' ? window : globalThis);
