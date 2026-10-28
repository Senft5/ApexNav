// Garage in the Crew sheet: your cars as cards, and the cars your friends and crew-mates chose to show.
// Weight is kept in kg on the server (SI) and shown in lb, like the rest of the app. Everything is set as text.
(function (root) {
  const LB = 2.20462;
  const DRIVE = { fwd: 'FWD', rwd: 'RWD', awd: 'AWD' }, TRANS = { manual: 'Manual', auto: 'Automatic', dct: 'DCT' };
  const CSS = `
    .garage-cards { display: grid; gap: 8px; }
    .car-card { border: 1px solid var(--rule); padding: 10px 12px; display: grid; gap: 4px; }
    .car-card .car-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .car-card .car-title b { font-size: 17px; }
    .car-card .car-nick { font-family: var(--font-num); font-size: 12px; color: var(--panel-dim); text-transform: uppercase; letter-spacing: 0.06em; }
    .car-card .car-spec { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
    .car-card .car-spec span b { font-family: var(--font-num); }
    .car-card .car-mods { font-size: 13px; color: var(--panel-dim); white-space: pre-wrap; }
    .car-form { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .car-form .wide { grid-column: 1 / -1; }
  `;

  /** One line of who-has-what, e.g. "2003 BMW M3 E46 CSL". */
  const title = (c) => [c.year, c.make, c.model, c.trim].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
  /** Power-to-weight, the number car people actually compare: lb per hp. */
  const lbPerHp = (c) => (c.power_hp && c.weight_kg ? (c.weight_kg * LB) / c.power_hp : null);

  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);

    function card(c, actions) {
      const spec = el('div', { className: 'car-spec' });
      const add = (label, value) => { if (value) spec.append(el('span', {}, document.createTextNode(label + ' '), el('b', { textContent: value }))); };
      add('', c.power_hp ? `${c.power_hp} hp` : '');
      add('', c.weight_kg ? `${Math.round(c.weight_kg * LB).toLocaleString()} lb` : '');
      const pw = lbPerHp(c); add('', pw ? `${pw.toFixed(1)} lb/hp` : '');
      add('', [DRIVE[c.drivetrain], TRANS[c.transmission]].filter(Boolean).join(' · '));
      add('', c.tyres || '');
      const kids = [el('div', { className: 'car-title' }, el('b', { textContent: title(c) }), c.is_primary ? el('span', { className: 'note', textContent: 'Daily' }) : '')];
      if (c.nickname) kids.push(el('div', { className: 'car-nick', textContent: `“${c.nickname}”` }));
      if (spec.childNodes.length) kids.push(spec);
      if (c.color) kids.push(el('div', { className: 'note', textContent: c.color }));
      if (c.mods) kids.push(el('div', { className: 'car-mods', textContent: c.mods }));
      if (actions) kids.push(actions);
      return el('div', { className: 'car-card' }, ...kids);
    }

    function form(c, onDone) {
      const f = (name, ph, v, extra = {}) => el('input', { className: 'field', name, placeholder: ph, value: v ?? '', autocomplete: 'off', 'aria-label': ph, ...extra });
      const sel = (name, label, opts, v) => {
        const s = el('select', { className: 'field', name, 'aria-label': label });
        s.append(el('option', { value: '', textContent: label }));
        for (const [k, t] of Object.entries(opts)) s.append(el('option', { value: k, textContent: t, selected: v === k }));
        return s;
      };
      const inputs = {
        year: f('year', 'Year', c.year, { inputMode: 'numeric', maxLength: 4 }), make: f('make', 'Make', c.make, { maxLength: 30 }),
        model: f('model', 'Model', c.model, { maxLength: 40 }), trim: f('trim', 'Trim', c.trim, { maxLength: 40 }),
        nickname: f('nickname', 'Nickname', c.nickname, { maxLength: 40 }), color: f('color', 'Colour', c.color, { maxLength: 30 }),
        power_hp: f('power_hp', 'Power (hp)', c.power_hp, { inputMode: 'numeric' }),
        weight_lb: f('weight_lb', 'Weight (lb)', c.weight_kg ? Math.round(c.weight_kg * LB) : '', { inputMode: 'numeric' }),
        drivetrain: sel('drivetrain', 'Drive', DRIVE, c.drivetrain), transmission: sel('transmission', 'Gearbox', TRANS, c.transmission),
        tyres: f('tyres', 'Tyres', c.tyres, { maxLength: 80 }),
        mods: el('textarea', { className: 'field', name: 'mods', placeholder: 'Mods', maxLength: 500, rows: 3, value: c.mods ?? '', 'aria-label': 'Mods' }),
      };
      const share = el('input', { type: 'checkbox', checked: !!c.shared });
      const int = (v) => (v.trim() === '' ? null : Number(v.trim().replace(/,/g, '')));
      const save = async () => {
        const v = (k) => inputs[k].value;
        const lb = int(v('weight_lb'));
        const body = { year: int(v('year')), make: v('make'), model: v('model'), trim: v('trim'), nickname: v('nickname'), color: v('color'),
                       power_hp: int(v('power_hp')), weight_kg: lb == null ? null : Math.round(lb / LB), drivetrain: v('drivetrain') || null,
                       transmission: v('transmission') || null, tyres: v('tyres'), mods: v('mods'), shared: share.checked, is_primary: !!c.is_primary };
        if (!body.make.trim() || !body.model.trim()) { toast('A car needs a make and a model.'); return; }
        for (const k of ['year', 'power_hp', 'weight_kg']) if (body[k] !== null && !Number.isInteger(body[k])) { toast('Year, power and weight are whole numbers.'); return; }
        const r = await apiCall(c.id ? 'PUT' : 'POST', c.id ? `/api/garage/${encodeURIComponent(c.id)}` : '/api/garage', body);
        if (r.ok) { toast(c.id ? 'Car saved.' : 'Car added to your garage.'); onDone(); }
        else { const j = await jsonOf(r); toast(r.status === 429 ? 'Your garage is full (10 cars).' : `Check the ${(j && j.error ? j.error.replace(/^bad_/, '') : 'fields').replace('_', ' ')}.`); }
      };
      return el('div', { className: 'stack-8' },
        el('div', { className: 'car-form' }, inputs.year, inputs.make, inputs.model, inputs.trim, inputs.nickname, inputs.color, inputs.power_hp, inputs.weight_lb,
          inputs.drivetrain, inputs.transmission, el('div', { className: 'wide' }, inputs.tyres), el('div', { className: 'wide' }, inputs.mods)),
        el('label', { className: 'row', style: 'gap:8px;align-items:center' }, share, document.createTextNode('Show to my friends and crews')),
        el('div', { className: 'row' }, btn(c.id ? 'Save' : 'Add car', save, 'ink-btn solid'), btn('Cancel', onDone, 'linkbtn')));
    }

    /** The Garage section: mine, then theirs. */
    function section() {
      const host = el('div', { className: 'stack-8' });
      let editing = null;   // a car id, 'new', or null
      async function render() {
        const [mineR, theirsR] = await Promise.all([apiCall('GET', '/api/garage'), apiCall('GET', '/api/garage/people')]);
        const mine = mineR.ok ? (await jsonOf(mineR)) || [] : null, theirs = theirsR.ok ? (await jsonOf(theirsR)) || [] : [];
        const kids = [el('h3', { textContent: 'Garage' })];
        if (mine === null) { kids.push(el('p', { className: 'note', textContent: 'Couldn\'t load your garage. Check signal.' })); host.replaceChildren(...kids); return; }
        if (!mine.length && editing !== 'new') kids.push(el('p', { className: 'note', textContent: 'Add your car: friends and crews see it next to your name when you show it. No location or drives are on a car card.' }));
        const cards = el('div', { className: 'garage-cards' });
        for (const c of mine) {
          if (editing === c.id) { cards.append(form(c, () => { editing = null; render(); })); continue; }
          const acts = el('div', { className: 'row' },
            btn('Edit', () => { editing = c.id; render(); }, 'linkbtn'),
            btn(c.shared ? 'Shown to friends' : 'Show to friends', async () => { const r = await apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !c.shared, is_primary: !!c.is_primary }); if (!r.ok) toast('Couldn\'t change that. Try again.'); render(); }, 'ink-btn' + (c.shared ? ' on' : '')),
            ...(c.is_primary ? [] : [btn('Make daily', async () => { await apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !!c.shared, is_primary: true }); render(); }, 'linkbtn')]),
            btn('Remove', async () => { if (confirm(`Remove ${title(c)} from your garage?`)) { await apiCall('DELETE', `/api/garage/${encodeURIComponent(c.id)}`); render(); } }, 'linkbtn'));
          cards.append(card(c, acts));
        }
        if (editing === 'new') cards.append(form({}, () => { editing = null; render(); }));
        if (cards.childNodes.length) kids.push(cards);
        if (editing !== 'new' && mine.length < 10) kids.push(el('div', { className: 'row' }, btn('Add a car', () => { editing = 'new'; render(); })));
        if (theirs.length) {
          kids.push(el('h3', { textContent: 'Friends\' cars' }));
          const list = el('div', { className: 'garage-cards' });
          for (const p of theirs) for (const c of p.cars) list.append(card({ ...c, is_primary: 0 }, el('div', { className: 'note', textContent: p.handle ? '@' + p.handle : '' })));
          kids.push(list);
        }
        host.replaceChildren(...kids);
      }
      render();
      return host;
    }
    return { section };
  }

  root.ApexGarageUI = { mount, title, lbPerHp };
})(window);
