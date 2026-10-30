// Who sees what (REVIEW_PEOPLE P-09): every "what people see of me" control on one page. Before it they were six controls in
// five places (where you are on the friends sheet, Scores and Times per friend and per crew, cars on each car card, Share
// road feel in the Garage, home zones in Privacy), and nobody could answer "what does Bob see of me?" without four
// screens. Here the audiences run down (each friend, each crew, everyone) and the things across (Where, Scores, Times,
// Car), each cell saying what that audience gets now. Scores and Times change in their cells; where you are has its one
// choice at the top (the same settings the Friends on the map sheet keeps, which stays for the delay and exactness); cars
// are changed on the car. It lives in the Garage under You; People's You row and a friend's "What @x sees of you" open it.
// Nothing here is guessed: a cell that couldn't be read says "--". rows() is pure (tests/test_who_sees.py).
(function (root) {
  'use strict';
  const DELAY = { 0: 'Live', 600: '10 min', 3600: '1 h' };

  /** Where an audience sees you, from the presence settings ({ audience, delay_s, fuzz } or null when unread). */
  function whereCell(presence, kind) {
    if (!presence) return { on: false, text: '--', say: 'not known' };
    const on = presence.audience === (kind === 'crew' ? 'crew' : 'friends');
    if (!on) return { on: false, text: '–', say: 'does not see where you are' };
    const delay = DELAY[presence.delay_s] || '--';
    return { on: true, text: delay, say: `sees where you are, ${presence.delay_s === 0 ? 'live' : `${delay} late`}, ${presence.fuzz ? 'within a mile' : 'exactly'}` };
  }

  /** The grid: [{ kind: 'friend'|'crew', id, label, where, scores, times, car }]. `cars` is your garage (null when unread);
   *  a car shown is seen by friends and private crews, never a public crew's strangers (garage_ui.js). */
  function rows({ friends = [], crews = [], grants = [], presence = null, cars = null } = {}) {
    const g = new Map((grants || []).map((x) => [`${x.audience_type}:${x.audience_id}`, x]));
    const shown = Array.isArray(cars) ? cars.some((c) => c && c.shared) : null;
    const out = [];
    for (const f of friends || []) {
      if (!f || f.status !== 'accepted') continue;
      const x = g.get(`friend:${f.id}`) || {};
      out.push({ kind: 'friend', id: f.id, label: `@${f.handle || '?'}`, handle: f.handle || null, where: whereCell(presence, 'friend'),
        scores: !!x.share_scores, times: !!x.share_times, car: shown });
    }
    for (const c of crews || []) {
      if (!c) continue;
      const x = g.get(`crew:${c.id}`) || {};
      out.push({ kind: 'crew', id: c.id, label: c.name || 'Crew', where: whereCell(presence, 'crew'),
        scores: !!x.share_scores, times: !!x.share_times, car: shown === null ? null : shown && c.visibility !== 'public' });
    }
    return out;
  }

  /** One line for a row ("@cara sees your scores and where you are, 10 min late"), for the friend row and screen readers. */
  function sentence(r) {
    const things = [r.scores ? (r.times ? 'your scores and times' : 'your scores') : null, r.where.on ? `where you are, ${r.where.text === 'Live' ? 'live' : `${r.where.text} late`}` : null,
      r.car ? 'your car' : null].filter(Boolean);
    if (!things.length) return `${r.label} sees nothing of yours.`;
    return `${r.label} sees ${things.length > 1 ? `${things.slice(0, -1).join(', ')} and ${things[things.length - 1]}` : things[0]}.`;
  }

  const STYLE = `
    .who-sees { max-width: 560px; width: 100%; margin: 0 auto; display: grid; gap: 14px; align-content: start; }
    .who-grid { display: grid; grid-template-columns: minmax(0, 1fr) repeat(4, 56px); align-items: center; }
    .who-grid > .who-h { font-size: 12px; font-weight: 600; color: var(--panel-dim); text-align: center; padding: 6px 0; letter-spacing: 0.04em; text-transform: uppercase; }
    .who-grid > .who-g { grid-column: 1 / -1; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--panel-dim); padding: 14px 0 4px; border-bottom: 1px solid var(--rule); }
    .who-grid > .who-n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 4px 0 0; min-height: 48px; line-height: 48px; border-bottom: 1px solid var(--hair, var(--rule)); }
    .who-grid > .who-c { min-height: 48px; display: grid; place-items: center; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--hair, var(--rule)); color: var(--panel-dim); }
    .who-grid > .who-c.on { color: var(--panel-ink); }
    .who-grid > .who-n.focus, .who-grid > .who-c.focus { background: color-mix(in srgb, var(--panel-ink) 8%, transparent); }
    .who-cell { width: 40px; height: 32px; border: 1.5px solid var(--panel-dim); background: transparent; color: var(--panel-dim); font: inherit; font-size: 15px; font-weight: 700; }
    .who-cell[aria-checked="true"] { background: var(--panel-ink); border-color: var(--panel-ink); color: var(--panel); }
    .who-sees .fm-row { border-top: 1px solid var(--rule); }
  `;

  /** page: el, btn, toast, apiCall, jsonOf, friendsMap, crews() → Promise<[crew]>, zones() → [zone], openGarage(),
   *  roadFeel: { get() → bool|null, set(on) → Promise<bool> }, onChange() (People redraws its lines after a change). */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page, d = root.document;
    if (!d.getElementById('whoSeesStyle')) d.head.append(el('style', { id: 'whoSeesStyle', textContent: STYLE }));
    let ov = null;

    async function load() {
      const get = (p) => apiCall('GET', p).then((r) => (r && r.ok ? jsonOf(r) : null)).catch(() => null);
      const fm = page.friendsMap;
      const [friends, grants, crews, cars] = await Promise.all([get('/api/friends'), get('/api/grants'),
        (page.crews ? page.crews() : get('/api/crews')).catch(() => null), get('/api/garage'), fm && !fm.loaded ? fm.loadSettings().catch(() => false) : null]);
      return { friends: Array.isArray(friends) ? friends : [], grants: Array.isArray(grants) ? grants : [], crews: Array.isArray(crews) ? crews : [],
        cars: Array.isArray(cars) ? cars : null, presence: fm && fm.loaded ? fm.settings : null, read: Array.isArray(friends) };
    }

    function close() { if (ov) { ov.remove(); ov = null; } if (page.onChange) page.onChange(); }

    /** Opens the page; `focus` ({ friend: id } or { crew: id }) marks that row and brings it into view. */
    async function open(focus = null) {
      if (ov) ov.remove();
      ov = el('div', { className: 'overlay show' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Who sees what');
      const box = el('div', { className: 'who-sees' });
      const head = el('div', { className: 'row', style: 'justify-content:space-between;align-items:baseline' }, el('h2', { textContent: 'Who sees what' }), btn('Done', close, 'linkbtn'));
      box.append(head, el('p', { className: 'note', textContent: 'Loading…' }));
      ov.append(box); d.body.append(ov);
      const me = ov;
      let data = await load();
      if (ov !== me) return;   // closed, or opened again, while it loaded

      const paint = () => {
        const fm = page.friendsMap, presence = data.presence, list = rows(data);
        const kids = [head, el('p', { className: 'note', textContent: 'What each friend and crew gets of yours, now. Tap Scores or Times to change them.' })];
        if (!data.read) { kids.push(el('p', { className: 'note', textContent: 'Couldn’t load who sees what. Check signal.' }), btn('Try again', async () => { data = await load(); paint(); }, 'ink-btn')); box.replaceChildren(...kids); return; }
        // where you are: one choice for everyone, the delay and exactness on the Friends on the map sheet
        if (fm && presence) {
          const g = el('div', { className: 'switch', role: 'radiogroup' }); g.setAttribute('aria-label', 'Show me on the map to');
          for (const [v, t] of root.ApexFriendsMap.AUDIENCES) {
            const b = el('button', { type: 'button', textContent: t, className: v === presence.audience ? 'on' : '' });
            b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(v === presence.audience));
            b.addEventListener('click', async () => { if (v !== presence.audience && await fm.save({ ...presence, audience: v })) { data.presence = fm.settings; paint(); } });
            g.append(b);
          }
          kids.push(el('div', { className: 'fm-row' }, el('span', { textContent: 'Where you are' }), g),
            el('p', { className: 'note' }, root.ApexFriendsMap.explainer({ ...presence, onlyDriving: fm.onlyDriving }), ' ',
              btn('Delay and exactness', () => fm.sheet(() => { data.presence = fm.settings; paint(); }), 'linkbtn')));
        } else kids.push(el('div', { className: 'fm-row' }, el('span', { textContent: 'Where you are' }), el('span', { className: 'note', textContent: '--' })));

        const grid = el('div', { className: 'who-grid' });
        grid.append(el('span'), ...['Where', 'Scores', 'Times', 'Car'].map((t) => el('span', { className: 'who-h', textContent: t })));
        let focusEl = null;
        const group = (title, items) => {
          if (!items.length) return;
          grid.append(el('span', { className: 'who-g', textContent: title }));
          for (const r of items) {
            const focused = !!focus && ((focus.friend && r.kind === 'friend' && r.id === focus.friend) || (focus.crew && r.kind === 'crew' && r.id === focus.crew));
            const name = el('span', { className: 'who-n' + (focused ? ' focus' : ''), textContent: r.label, title: sentence(r) });
            const put = async (scores, times) => {
              const res = await apiCall('PUT', '/api/grants', { audience_type: r.kind, audience_id: r.id, share_scores: scores, share_times: times }).catch(() => null);
              if (!res || !res.ok) { toast('Couldn’t change that. Check signal.'); return; }
              data.grants = data.grants.filter((x) => !(x.audience_type === r.kind && x.audience_id === r.id)).concat([{ audience_type: r.kind, audience_id: r.id, share_scores: scores ? 1 : 0, share_times: times ? 1 : 0 }]);
              paint();
            };
            // the rule the friend row always had: Times needs Scores; Scores off takes Times with it
            const cell = (on, label, flip) => { const b = el('button', { type: 'button', className: 'who-cell', textContent: on ? '✓' : '–', onclick: flip });
              b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-label', `${r.label} sees your ${label}`); return b; };
            const c = (child, on) => el('span', { className: 'who-c' + (on ? ' on' : '') + (focused ? ' focus' : '') }, child);
            const where = el('span', { textContent: r.where.text }); where.setAttribute('aria-label', `${r.label} ${r.where.say}`);
            const car = el('span', { textContent: r.car === null ? '--' : r.car ? '✓' : '–' }); car.setAttribute('aria-label', r.car === null ? 'Cars: not known' : `${r.label} ${r.car ? 'sees' : 'does not see'} your car`);
            grid.append(name, c(where, r.where.on),
              c(cell(r.scores, 'scores', () => put(!r.scores, r.scores ? false : r.times)), r.scores),
              c(cell(r.times, 'times', () => put(true, !r.times)), r.times), c(car, !!r.car));
            if (focused) focusEl = name;
          }
        };
        group('Friends', list.filter((r) => r.kind === 'friend'));
        group('Crews', list.filter((r) => r.kind === 'crew'));
        if (list.length) kids.push(grid);
        else kids.push(el('p', { className: 'note', textContent: 'No friends or crews yet, so nobody sees anything of yours.' }));
        kids.push(el('p', { className: 'note', textContent: 'Scores are your best Vetta Score on a stage; Times, your time on it. A car is seen by friends and private crews, never a public crew.' }));

        // everyone: road feel without your name, and the places where nobody sees you
        const rf = page.roadFeel ? page.roadFeel.get() : null;
        if (rf !== null) {
          const sw = el('button', { type: 'button', className: 'sw' + (rf ? ' on' : '') }, el('i'), el('span', { textContent: 'Share road feel' }));
          sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(!!rf));
          sw.addEventListener('click', async () => { if (await page.roadFeel.set(!rf)) paint(); else toast('Couldn’t change that. Check signal.'); });
          kids.push(el('h3', { textContent: 'Everyone' }), sw, el('p', { className: 'note', textContent: 'Banking, bumps and surface, without your name. Never where you went or how fast.' }));
        }
        const z = page.zones ? page.zones().length : 0;
        kids.push(el('div', { className: 'fm-row' }, el('span', { textContent: 'Home zones' }),
          el('span', { className: 'note' }, z ? `${z} zone${z === 1 ? '' : 's'} · nobody sees you there · ` : 'None yet · ', btn(z ? 'Change' : 'Add one', () => { close(); if (page.openGarage) page.openGarage('privacy'); }, 'linkbtn'))),
          el('div', { className: 'row' }, btn('Cars, on each car', () => { close(); if (page.openGarage) page.openGarage('cars'); }, 'linkbtn')));
        box.replaceChildren(...kids);
        if (focusEl) { focusEl.scrollIntoView({ block: 'center' }); focus = null; }
      };
      paint();
    }

    /** The Garage's row under You: "Who sees what · Friends see you". */
    function row() {
      const count = el('small'), b = el('button', { className: 'nav-row', type: 'button' }, el('span', { textContent: 'Who sees what' }), count, el('i', { 'aria-hidden': 'true' }));
      b.addEventListener('click', () => open());
      const fm = page.friendsMap, WHO = { nobody: 'Nobody sees where you are', crew: 'Crews see where you are', friends: 'Friends see where you are' };
      const paint = () => { count.textContent = fm && fm.loaded ? WHO[fm.settings.audience] || '' : ''; };
      if (fm && !fm.loaded) fm.loadSettings().then(paint).catch(() => {}); else paint();
      return b;
    }

    return { open, close, row, get isOpen() { return !!ov; } };
  }

  const api = { mount, rows, sentence, whereCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexWhoSees = api;
})(typeof window !== 'undefined' ? window : globalThis);
