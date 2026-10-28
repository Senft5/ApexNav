// Garage in the Crew sheet: your cars as cards, and the cars your friends and crew-mates chose to show.
// Weight is kept in kg on the server (SI) and shown in lb, like the rest of the app. Everything is set as text.
(function (root) {
  const LB = 2.20462;
  const DRIVE = { fwd: 'FWD', rwd: 'RWD', awd: 'AWD' }, TRANS = { manual: 'Manual', auto: 'Automatic', dct: 'DCT' };
  const CSS = `
    .garage-cards { display: grid; gap: 8px; }
    .car-card { border: 1px solid var(--rule); padding: 10px 12px; display: grid; gap: 4px; overflow: hidden; overflow-wrap: anywhere; }
    .car-card .car-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .car-card .car-title b { font-size: 17px; }
    .car-card .car-nick { font-family: var(--font-num); font-size: 12px; color: var(--panel-dim); text-transform: uppercase; letter-spacing: 0.06em; }
    .car-card .car-spec { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
    .car-card .car-spec span b { font-family: var(--font-num); }
    .car-card .car-mods { font-size: 13px; color: var(--panel-dim); white-space: pre-wrap; }
    .car-form { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .car-form .wide { grid-column: 1 / -1; }
  `;

  const FIELD_HINT = {
    bad_year: 'Year should be between 1886 and 2035.', bad_make: 'Check the make.', bad_model: 'Check the model.', bad_trim: 'Check the trim.',
    bad_nickname: 'Check the nickname.', bad_color: 'Check the colour.', bad_power_hp: 'Power should be 1 to 3,000 hp.',
    bad_weight_kg: 'Weight should be 441 to 13,228 lb.', bad_tyres: 'Check the tyres.', bad_mods: 'Check the mods (500 characters at most).',
  };

  /** One line of who-has-what, e.g. "2003 BMW M3 E46 CSL". */
  const title = (c) => [c.year, c.make, c.model, c.trim].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
  /** Power-to-weight, the number car people actually compare: lb per hp. */
  const lbPerHp = (c) => (c.power_hp && c.weight_kg ? (c.weight_kg * LB) / c.power_hp : null);

  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf, report } = page;
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
      const f = (name, ph, v, extra = {}) => { const i = el('input', { className: 'field', name, placeholder: ph, value: v ?? '', autocomplete: 'off', ...extra }); i.setAttribute('aria-label', ph); return i; };
      const sel = (name, label, opts, v) => {
        const s = el('select', { className: 'field', name }); s.setAttribute('aria-label', label);
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
        mods: el('textarea', { className: 'field', name: 'mods', placeholder: 'Mods', maxLength: 500, rows: 3, value: c.mods ?? '' }),
      };
      inputs.mods.setAttribute('aria-label', 'Mods');
      // Look the car up (car_lookup.js, IDEAS S-21): a VIN, or year + make + model; the specs fill in and you change what differs.
      const L = root.ApexCarLookup;
      const lookupNote = el('p', { className: 'note', role: 'status' });
      const fill = (found, typical) => {
        const cur = { year: inputs.year.value, make: inputs.make.value, model: inputs.model.value, trim: inputs.trim.value, power_hp: inputs.power_hp.value,
                      weight_kg: inputs.weight_lb.value ? Math.round(Number(inputs.weight_lb.value) / LB) : null,
                      drivetrain: inputs.drivetrain.value, transmission: inputs.transmission.value };
        const m = L.merge(cur, found);
        for (const k of ['year', 'make', 'model', 'trim', 'power_hp', 'drivetrain', 'transmission']) inputs[k].value = m[k] ?? '';
        inputs.weight_lb.value = m.weight_kg ? Math.round(m.weight_kg * LB) : '';
        const missing = [!m.power_hp && 'power', !m.weight_kg && 'weight', !m.drivetrain && 'drive', !m.transmission && 'gearbox'].filter(Boolean);
        lookupNote.textContent = (typical ? 'Filled with typical factory specs. ' : 'Filled in. ') +
          (missing.length ? `Add ${missing.join(', ')} yourself. ` : '') + 'Change anything that differs on yours.';
      };
      const vin = f('vin', 'VIN (optional)', '', { maxLength: 17, autocapitalize: 'characters' });
      const lookups = L ? el('div', { className: 'stack-8' },
        el('div', { className: 'row' }, vin, btn('Look up VIN', async () => {
          lookupNote.textContent = 'Looking up…';
          const r = await L.decodeVin(vin.value, root.fetch.bind(root));
          if (r.error) { lookupNote.textContent = r.error === 'bad_vin' ? 'A VIN is 17 letters and numbers (no I, O or Q).' : r.error === 'offline' ? 'No signal. Try again, or type the car in.' : 'That VIN wasn\'t found. Type the car in instead.'; return; }
          fill(r.car, r.typical);
        })),
        el('div', { className: 'row' }, btn('Fill specs from year, make and model', () => {
          const spec = L.specFor({ year: inputs.year.value, make: inputs.make.value, model: inputs.model.value, trim: inputs.trim.value });
          if (!spec) { lookupNote.textContent = 'No typical specs for that car yet. Type them in.'; return; }
          fill(spec, true);
        }, 'linkbtn')),
        lookupNote) : '';
      if (L) {   // suggestions while typing: makes from the spec table, models for the year from vPIC
        const makes = el('datalist', { id: 'carMakes' }); for (const m of L.MAKES) makes.append(el('option', { value: m }));
        const models = el('datalist', { id: 'carModels' });
        inputs.make.setAttribute('list', 'carMakes'); inputs.model.setAttribute('list', 'carModels');
        let asked = '';
        const loadModels = async () => {
          const key = `${inputs.year.value}|${inputs.make.value}`; if (key === asked) return; asked = key;
          const list = await L.models(inputs.make.value, inputs.year.value, root.fetch.bind(root));
          if (asked !== key) return;
          models.replaceChildren(...list.map((m) => el('option', { value: m })));
        };
        inputs.make.addEventListener('change', loadModels); inputs.year.addEventListener('change', loadModels);
        lookups.append(makes, models);
      }
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
        let r;
        try { r = await apiCall(c.id ? 'PUT' : 'POST', c.id ? `/api/garage/${encodeURIComponent(c.id)}` : '/api/garage', body); }
        catch (_) { toast('No signal. Your car wasn\'t saved.'); return; }
        if (r.ok) { toast(c.id ? 'Car saved.' : 'Car added to your garage.'); onDone(); }
        else { const j = await jsonOf(r); toast(r.status === 429 ? 'Your garage is full (10 cars).' : (FIELD_HINT[j && j.error] || 'Check the details and try again.')); }
      };
      return el('div', { className: 'stack-8' },
        lookups,
        el('div', { className: 'car-form' }, inputs.year, inputs.make, inputs.model, inputs.trim, inputs.nickname, inputs.color, inputs.power_hp, inputs.weight_lb,
          inputs.drivetrain, inputs.transmission, el('div', { className: 'wide' }, inputs.tyres), el('div', { className: 'wide' }, inputs.mods)),
        el('label', { className: 'row', style: 'gap:8px;align-items:center' }, share, document.createTextNode('Show to my friends and private crews')),
        el('div', { className: 'row' }, btn(c.id ? 'Save' : 'Add car', save, 'ink-btn solid'), btn('Cancel', onDone, 'linkbtn')));
    }

    /** The Garage section: mine, then theirs. */
    function section() {
      const host = el('div', { className: 'stack-8' });
      let editing = null;   // a car id, 'new', or null
      // A change, then a fresh look; a failed call (or no signal) says so instead of failing quietly.
      const act = (call, failed) => async () => {
        let r = null;
        try { r = await call(); } catch (_) {}
        if (r && !r.ok) toast(failed); else if (!r) toast('No signal. Try again.');
        render();
      };
      async function render() {
        let mineR, theirsR;
        try { [mineR, theirsR] = await Promise.all([apiCall('GET', '/api/garage'), apiCall('GET', '/api/garage/people')]); }
        catch (_) { mineR = { ok: false }; theirsR = { ok: false }; }
        const mine = mineR.ok ? (await jsonOf(mineR)) || [] : null, theirs = theirsR.ok ? (await jsonOf(theirsR)) || [] : [];
        const kids = [el('h3', { textContent: 'Garage' })];
        if (mine === null) { kids.push(el('p', { className: 'note', textContent: 'Couldn\'t load your garage. Check signal.' })); host.replaceChildren(...kids); return; }
        if (!mine.length && editing !== 'new') kids.push(el('p', { className: 'note', textContent: 'Add your car: friends and private crews see it next to your name when you show it. No location or drives are on a car card.' }));
        const cards = el('div', { className: 'garage-cards' });
        for (const c of mine) {
          if (editing === c.id) { cards.append(form(c, () => { editing = null; render(); })); continue; }
          const acts = el('div', { className: 'row' },
            btn('Edit', () => { editing = c.id; render(); }, 'linkbtn'),
            btn(c.shared ? 'Shown to friends' : 'Show to friends', act(() => apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !c.shared, is_primary: !!c.is_primary }), 'Couldn\'t change that. Try again.'), 'ink-btn' + (c.shared ? ' on' : '')),
            ...(c.is_primary ? [] : [btn('Make daily', act(() => apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !!c.shared, is_primary: true }), 'Couldn\'t change that. Try again.'), 'linkbtn')]),
            btn('Remove', () => { if (confirm(`Remove ${title(c)} from your garage?`)) act(() => apiCall('DELETE', `/api/garage/${encodeURIComponent(c.id)}`), 'Couldn\'t remove it. Try again.')(); }, 'linkbtn'));
          cards.append(card(c, acts));
        }
        if (editing === 'new') cards.append(form({}, () => { editing = null; render(); }));
        if (cards.childNodes.length) kids.push(cards);
        if (editing !== 'new' && mine.length < 10) kids.push(el('div', { className: 'row' }, btn('Add a car', () => { editing = 'new'; render(); })));
        if (theirs.length) {
          kids.push(el('h3', { textContent: 'Friends\' and crew cars' }));
          const list = el('div', { className: 'garage-cards' });
          for (const p of theirs) for (const c of p.cars) {
            list.append(card({ ...c, is_primary: 0 }, el('div', { className: 'row', style: 'justify-content:space-between;align-items:center' },
              el('span', { className: 'note', textContent: '@' + p.handle }),
              ...(report ? [btn('Report', () => report({ kind: 'car', target: c.id, label: `${title(c)} · @${p.handle}`, who: p.handle, done: render }), 'linkbtn')] : []))));
          }
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
