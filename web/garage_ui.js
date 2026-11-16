// Garage in the Crew sheet: your cars as cards, and the cars your friends and crew-mates chose to show.
// Weight is kept in kg on the server (SI) and shown in lb, like the rest of the app. Everything is set as text.
(function (root) {
  const LB = 2.20462;
  const DRIVE = { fwd: 'FWD', rwd: 'RWD', awd: 'AWD' }, TRANS = { manual: 'Manual', auto: 'Automatic', dct: 'DCT' };
  const HEIGHT = { low: 'Lowered', stock: 'Stock height', high: 'Lifted' }, IN = 2.54;
  // fuel and range (route_ctx/car.js): fuel-stop spacing on long back-road stretches; never shown to friends
  const FUEL = { petrol: 'Petrol', diesel: 'Diesel', electric: 'Electric', hybrid: 'Hybrid' }, MI = 1.609344;
  const metric = () => !!(root.ApexUnits && root.ApexUnits.metric());
  const CSS = `
    .garage-cards { display: grid; gap: 8px; }
    .car-card { border: 1px solid var(--rule); padding: 10px 12px; display: grid; gap: 4px; overflow: hidden; overflow-wrap: anywhere; }
    .car-card .car-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .car-card .car-title b { font-size: 17px; }
    .car-card .car-nick { font-size: 14px; font-style: italic; color: var(--panel-dim); }
    .car-form .car-field { display: grid; gap: 2px; min-width: 0; }
    .car-form .car-field small { font-size: 12px; font-weight: 600; color: var(--panel-dim); }
    .car-form .car-field .field { width: 100%; }
    .car-card .car-spec { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
    .car-card .car-spec span b { font-family: var(--font-num); }
    .car-card .car-mods { font-size: 13px; color: var(--panel-dim); white-space: pre-wrap; }
    .car-form { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .car-form .wide { grid-column: 1 / -1; }
    .car-card .car-cover { width: calc(100% + 24px); margin: -10px -12px 6px; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
    .car-gallery { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0; }
    .car-strip { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; padding: 2px 0 4px; scrollbar-width: none; }
    .car-strip[hidden] { display: none; }
    .car-strip::-webkit-scrollbar { display: none; }
    .car-chip { flex: none; width: 116px; display: grid; gap: 4px; justify-items: start; text-align: left; border: 0; background: none; padding: 0; color: var(--panel-ink); font: inherit; cursor: pointer; scroll-snap-align: start; }
    .car-chip .cc-pic { width: 116px; height: 76px; border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: var(--panel-2, transparent); }
    .car-chip .cc-pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .car-chip .cc-pic svg { width: 40px; height: 40px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; color: var(--panel-dim); }
    .car-chip b { font-size: 14px; max-width: 116px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .car-chip small { font-size: 12px; color: var(--panel-dim); min-height: 15px; }
    .car-chip.add .cc-pic { border-style: dashed; }
    .car-card.lit { outline: 2px solid var(--panel-ink); outline-offset: 2px; }
    .car-gallery img { width: 64px; height: 64px; object-fit: cover; flex: none; border: 1px solid var(--rule); }
  `;

  const FIELD_HINT = {
    bad_year: 'Year should be between 1886 and 2035.', bad_make: 'Check the make.', bad_model: 'Check the model.', bad_trim: 'Check the trim.',
    bad_nickname: 'Check the nickname.', bad_color: 'Check the colour.', bad_power_hp: 'Power should be 1 to 3,000 hp.',
    bad_weight_kg: 'Weight should be 441 to 13,228 lb.', bad_width_cm: 'Width should be 47 to 118 in (120 to 300 cm).', bad_range_km: 'Range should be 20 to 1,240 mi (30 to 2,000 km).', bad_fuel: 'Pick the fuel from the list.', bad_tyres: 'Check the tyres.', bad_mods: 'Check the mods (500 characters at most).',
  };

  /** One line of who-has-what, e.g. "2003 BMW M3 E46 CSL". */
  const title = (c) => [c.year, c.make, c.model, c.trim].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
  /** Power-to-weight, the number car people actually compare: lb per hp. */
  const lbPerHp = (c) => (c.power_hp && c.weight_kg ? (c.weight_kg * LB) / c.power_hp : null);

  const CSS_ESC = (v) => (root.CSS && root.CSS.escape ? root.CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));

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
      add('', c.clearance === 'low' ? 'Lowered' : c.clearance === 'high' ? 'Lifted' : '');
      const P = root.ApexPhotos;
      const kids = [];
      if (c.cover_photo_id && P) kids.push(P.img(c.cover_photo_id, 'car-cover', title(c)));   // the car's cover (REVIEW.md 5.2)
      kids.push(el('div', { className: 'car-title' }, el('b', { textContent: title(c) }), c.is_primary ? el('span', { className: 'note', textContent: 'Daily' }) : ''));
      if (c.nickname) kids.push(el('div', { className: 'car-nick', textContent: c.nickname }));
      if (spec.childNodes.length) kids.push(spec);
      if (c.color) kids.push(el('div', { className: 'note', textContent: c.color }));
      if (c.mods) kids.push(el('div', { className: 'car-mods', textContent: c.mods }));
      if (P && c.id) kids.push(gallery(c, !!actions && !c.handle));
      if (actions) kids.push(actions);
      return el('div', { className: 'car-card' }, ...kids);
    }

    // A car's photos (REVIEW.md 5.2): the gallery as thumbnails; yours with Add photo, Make cover and Remove; theirs with Report.
    function gallery(c, mine) {
      const P = root.ApexPhotos, strip = el('div', { className: 'car-gallery' }), box = el('div', { className: 'stack-8' }, strip);
      const fill = async () => {
        const list = await P.list('car', c.id).catch(() => []);
        strip.replaceChildren(...list.map((p) => {
          const t = P.img(p.id, '', 'Photo of ' + title(c));
          t.tabIndex = 0; t.setAttribute('role', 'button');
          t.addEventListener('click', () => P.view(p.id, mine
            ? [['Make cover', async () => { await apiCall('PUT', `/api/photos/${encodeURIComponent(p.id)}/use`); page.onPhotos && page.onPhotos(); }],
               ['Remove', async () => { if (await ApexConfirm.ask('Remove this photo?', 'Remove')) { await P.remove(p.id); fill(); } }]]
            : (report ? [['Report', () => report({ kind: 'photo', target: p.id, label: 'a photo of ' + title(c), done: fill })]] : [])));
          return t;
        }));
      };
      fill();
      if (mine) {
        box.append(el('div', { className: 'row' }, P.picker(c.cover_photo_id ? 'Add photo' : 'Add a cover photo', 'car', c.id, () => { fill(); if (!c.cover_photo_id && page.onPhotos) page.onPhotos(); }, { cover: !c.cover_photo_id, toast })));
      }
      return box;
    }

    function form(c, onDone, more = null) {
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
        clearance: sel('clearance', 'Ride height', HEIGHT, c.clearance),
        width: f('width', metric() ? 'Width with mirrors (cm)' : 'Width with mirrors (in)', c.width_cm ? (metric() ? c.width_cm : Math.round(c.width_cm / IN)) : '', { inputMode: 'numeric' }),
        fuel: sel('fuel', 'Fuel', FUEL, c.fuel),
        range: f('range', metric() ? 'Range on a full tank (km)' : 'Range on a full tank (mi)', c.range_km ? (metric() ? c.range_km : Math.round(c.range_km / MI)) : '', { inputMode: 'numeric' }),
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
      const vin = f('vin', 'VIN, if you have it', '', { maxLength: 17, autocapitalize: 'characters' });
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
      // shown to friends and private crews: the slide switch, read through .checked like the box it replaces
      const share = el('button', { type: 'button', className: 'sw' + (c.shared ? ' on' : '') }, el('i'), el('span', { textContent: 'Show to my friends and private crews' }));
      share.setAttribute('role', 'switch'); share.setAttribute('aria-checked', String(!!c.shared));
      Object.defineProperty(share, 'checked', { get: () => share.classList.contains('on'), set: (v) => { share.classList.toggle('on', !!v); share.setAttribute('aria-checked', String(!!v)); } });
      share.addEventListener('click', () => { share.checked = !share.checked; });
      // every field keeps its name over it once filled (a filled "Red" next to "Classic Red" said nothing)
      const named = (k, text) => el('label', { className: 'car-field' }, el('small', { textContent: text }), inputs[k]);
      const int = (v) => (v.trim() === '' ? null : Number(v.trim().replace(/,/g, '')));
      const save = async () => {
        const v = (k) => inputs[k].value;
        const lb = int(v('weight_lb'));
        const body = { year: int(v('year')), make: v('make'), model: v('model'), trim: v('trim'), nickname: v('nickname'), color: v('color'),
                       power_hp: int(v('power_hp')), weight_kg: lb == null ? null : Math.round(lb / LB), drivetrain: v('drivetrain') || null,
                       transmission: v('transmission') || null, tyres: v('tyres'), mods: v('mods'), shared: share.checked, is_primary: !!c.is_primary,
                       clearance: v('clearance') || null, width_cm: int(v('width')) == null ? null : Math.round(metric() ? int(v('width')) : int(v('width')) * IN),
                       fuel: v('fuel') || null, range_km: int(v('range')) == null ? null : Math.round(metric() ? int(v('range')) : int(v('range')) * MI) };
        if (!body.make.trim() || !body.model.trim()) { toast('A car needs a make and a model.'); return; }
        for (const k of ['year', 'power_hp', 'weight_kg', 'width_cm', 'range_km']) if (body[k] !== null && !Number.isInteger(body[k])) { toast('Year, power, weight, width and range are whole numbers.'); return; }
        let r;
        try { r = await apiCall(c.id ? 'PUT' : 'POST', c.id ? `/api/garage/${encodeURIComponent(c.id)}` : '/api/garage', body); }
        catch (_) { toast('No signal. Your car wasn\'t saved.'); return; }
        if (r.ok) { toast(c.id ? 'Car saved.' : 'Car added to your garage.'); onDone(); }
        else { const j = await jsonOf(r); toast(r.status === 429 ? 'Your garage is full (10 cars).' : (FIELD_HINT[j && j.error] || 'Check the details and try again.')); }
      };
      const built = el('div', { className: 'stack-8' },
        lookups,
        el('div', { className: 'car-form' }, named('year', 'Year'), named('make', 'Make'), named('model', 'Model'), named('trim', 'Trim'), named('nickname', 'Nickname'), named('color', 'Colour'),
          named('power_hp', 'Power (hp)'), named('weight_lb', 'Weight (lb)'), named('drivetrain', 'Drive'), named('transmission', 'Gearbox'),
          el('div', { className: 'wide' }, named('tyres', 'Tyres')), named('clearance', 'Ride height'), named('width', metric() ? 'Width with mirrors (cm)' : 'Width with mirrors (in)'),
          named('fuel', 'Fuel'), named('range', metric() ? 'Range on a full tank (km)' : 'Range on a full tank (mi)'), el('div', { className: 'wide' }, named('mods', 'Mods'))),
        el('p', { className: 'note', textContent: 'Ride height, width, fuel and range plan your daily car\'s routes: a lowered car stays off unpaved roads, and a long stretch without fuel gets a stop. Fuel and range are never shown to friends.' }),
        share,
        el('div', { className: 'row' }, btn(c.id ? 'Save' : 'Add car', save, 'ink-btn solid'), btn('Cancel', onDone, 'linkbtn')),
        ...(more ? [more] : []));
      if (root.ApexRowSelect) for (const k of ['drivetrain', 'transmission', 'clearance', 'fuel']) root.ApexRowSelect.enhance(inputs[k]);   // the app's row lists (row_select.js)
      return built;
    }

    // Shown to friends and private crews, or not: a slide switch on the card (it is a state, not a key)
    const shownSwitch = (c, flip) => { const b = el('button', { type: 'button', className: 'sw' + (c.shared ? ' on' : ''), onclick: flip }, el('i'), el('span', { textContent: 'Show to friends' }));
      b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!c.shared)); return b; };
    /** The Garage section: mine, then theirs. */
    function section() {
      const host = el('div', { className: 'stack-8' });
      // Your cars as a strip under the profile's head (screen inventory 2026-11-16): one tap opens the car's build thread, or
      // shows its card below; the last one adds a car. The caller puts host.strip under the head; no cars, no strip.
      const strip = el('div', { className: 'car-strip' }); strip.hidden = true; strip.setAttribute('aria-label', 'Your cars');
      host.strip = strip;
      let editing = null;   // a car id, 'new', or null
      const toCard = (sel) => { const n = host.querySelector(sel); if (!n) return; try { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        n.classList.add('lit'); setTimeout(() => n.classList.remove('lit'), 1600); };
      const chip = (pic, name, small, run, add) => { const b = el('button', { type: 'button', className: 'car-chip' + (add ? ' add' : '') },
        pic, el('b', { textContent: name }), el('small', { textContent: small })); b.addEventListener('click', run); return b; };
      const glyph = (d) => { const p = el('span', { className: 'cc-pic' }); p.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`; return p; };
      const CAR_D = '<path d="M3 16v-3l2.2-5h13.6L21 13v3M3 16h18M3 16v2M21 16v2"/><circle cx="7.5" cy="13" r="1"/><circle cx="16.5" cy="13" r="1"/>';
      function fillStrip(mine) {
        const P = root.ApexPhotos;
        strip.hidden = !(mine && mine.length);
        if (strip.hidden) { strip.replaceChildren(); return; }
        strip.replaceChildren(...mine.map((c) => {
          const pic = c.cover_photo_id && P ? (() => { const w = el('span', { className: 'cc-pic' }); w.append(P.img(c.cover_photo_id, '', title(c))); return w; })() : glyph(CAR_D);
          const name = c.nickname || [c.make, c.model].filter(Boolean).join(' ') || title(c) || 'Your car';
          return chip(pic, name, c.is_primary ? 'Daily' : (c.build_id ? 'Build thread' : ''), () => {
            if (c.build_id && page.builds) page.builds.open(c.build_id, { onClose: render });
            else toCard(`.car-card[data-car="${CSS_ESC(c.id)}"]`);
          });
        }), ...(mine.length < 10 ? [chip(glyph('<path d="M12 6v12M6 12h12"/>'), 'Add a car', '', () => { editing = 'new'; render().then(() => toCard('.car-form')); }, true)] : []));
      }
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
        if (mine && page.onCars) page.onCars(mine);
        fillStrip(mine);
        const kids = [el('h3', { textContent: 'Your cars' })];
        if (mine === null) { kids.push(el('p', { className: 'note', textContent: 'Couldn\'t load your garage. Check signal.' })); host.replaceChildren(...kids); return; }
        // An empty garage is a bay waiting for a car (the People pages' drawing): a road pulls in to a dashed bay, the red puck on it
        const first = !mine.length && editing !== 'new';
        if (first) kids.push(el('div', { className: 'people-first garage-first' },
          el('div', { className: 'join-art', innerHTML: '<svg viewBox="0 0 360 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
            + '<rect class="jr-bay" x="226" y="30" width="96" height="68" rx="6"/>'
            + '<path class="jr-case" d="M-12 104 C 80 104 120 64 214 64"/><path class="jr-fill" d="M-12 104 C 80 104 120 64 214 64"/>'
            + '<circle class="jr-puck lead" cx="200" cy="64" r="7"/></svg>' }),
          el('h3', { className: 'join-head', textContent: 'Park your first car.' }),
          el('p', { className: 'people-lead', textContent: 'Friends and private crews see it next to your name.' })));
        const cards = el('div', { className: 'garage-cards' });
        for (const c of mine) {
          // the rare keys, Make daily and Remove, live in Edit (walkthrough 2026-11-12: a card with six keys read as clutter)
          const rare = el('div', { className: 'row car-rare' },
            ...(c.is_primary ? [] : [btn('Make daily', () => { editing = null; act(() => apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !!c.shared, is_primary: true }), 'Couldn\'t change that. Try again.')(); }, 'linkbtn')]),
            btn('Remove from garage', async () => { if (await ApexConfirm.ask(`Remove ${title(c)} from your garage?`, 'Remove')) { editing = null; act(() => apiCall('DELETE', `/api/garage/${encodeURIComponent(c.id)}`), 'Couldn\'t remove it. Try again.')(); } }, 'danger-btn'));
          if (editing === c.id) { cards.append(form(c, () => { editing = null; render(); }, rare)); continue; }
          const acts = el('div', { className: 'row' },
            ...(page.builds ? [btn(c.build_id ? 'Build thread' : 'Start a build thread', () => (c.build_id ? page.builds.open(c.build_id, { onClose: render }) : page.builds.start(c, render)), 'ink-btn')] : []),
            btn('Edit', () => { editing = c.id; render(); }, 'linkbtn'),
            shownSwitch(c, act(() => apiCall('PUT', `/api/garage/${encodeURIComponent(c.id)}`, { ...c, shared: !c.shared, is_primary: !!c.is_primary }), 'Couldn\'t change that. Try again.')));
          const cc = card(c, acts); if (c.id) cc.dataset.car = String(c.id); cards.append(cc);
        }
        if (editing === 'new') cards.append(form({}, () => { editing = null; render(); }));
        if (cards.childNodes.length) kids.push(cards);
        if (editing !== 'new' && mine.length < 10 && !(strip.isConnected && mine.length)) kids.push(el('div', { className: 'row' }, btn('Add a car', () => { editing = 'new'; render(); }, first ? 'ink-btn solid' : undefined)));
        if (theirs.length) {
          kids.push(el('h3', { textContent: 'Friends\' and crew cars' }));
          const list = el('div', { className: 'garage-cards' });
          for (const p of theirs) for (const c of p.cars) {
            list.append(card({ ...c, is_primary: 0 }, el('div', { className: 'row', style: 'justify-content:space-between;align-items:center' },
              el('span', { className: 'note', textContent: '@' + p.handle }),
              ...(c.build_id && page.builds ? [btn('Build thread', () => page.builds.open(c.build_id), 'ink-btn')] : []),
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
