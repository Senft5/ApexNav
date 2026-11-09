// Tune your routes (the owner, 2026-11-09: "every parameter with a slider for premium users"; "remember everyone has pro if
// they are an early user. Once we launch app store we will restrict to paid users and anyone who had the beta").
// Plain-language sliders over the routing's own numbers: each maps onto the knobs the Dev panel overrides (graph_router.js
// K, route_engine.js W, fun_route.js LEVELS and HWY) and builds the same tune object ({ router, engine, levels, hwy } of
// dotted paths), so it rides the same plumbing: req.tune to the router (plan, quickest, loop), ApexRouteEngine.setTune on
// the page. A slider at its default adds nothing to the tune, so untouched settings are no tune at all and every plan is
// the code's. Pro (pro.js kind 'tuning'): open to everyone until Pro goes on sale. Kept on this phone (apex.routeTuning).
// The pure half (sliders, tune, storage) runs in node (tests/test_route_tuning.py); mountScreen draws the Garage sheet.
(function (root) {
  'use strict';
  const KEY = 'apex.routeTuning', VERSION = 1;
  // The code's values the sliders scale (tests/test_route_tuning.py holds them to graph_router.js K, route_engine.js W and
  // fun_route.js LEVELS / HWY, so a retune of the code can't leave a slider's default behind).
  const BASE = {
    router: { 'A_MAX.fun': 40, 'A_MAX.max': 80, 'SPREAD.fun.0': 0.6, 'SPREAD.max.0': 1.5, 'W_FUN': 0.45, 'W_QUALITY': 0.15, 'W_SCENERY': 0.2, 'W_NOTPOOR': 0.2, 'ROAD.good': 1.5, 'ROAD.poor': 10, 'BUY.fun': 0.12, 'BUY.max': 0.03,
      'HWY_ABSURD': 2, 'STOP_AVOID_X': 1, 'CROWD_W.rough': 1, 'CROWD_W.flow': 1, 'CROWD_W.loved': 1.5, 'CROWD_W.bank': 0.5 },
    engine: { FUN: 1, GAIN: 0.5, QUALITY: 0.3, GOOD_PER_KM: 1.5, SCENERY: 20, BUSINESS_PER_KM: 4, BUSINESS_CAP: 40, POOR_PER_KM: 10, POOR_CAP: 120, DRIVER: 6 },
    levels: { 'quick.slackS': 60, 'fun.budget': 0.35, 'fun.slackS': 240, 'fun.perMin': 1, 'max.budget': 0.9, 'max.slackS': 600, 'max.perMin': 0.35 },
    hwy: { ABSURD: 2 },
  };
  const scale = (table, keys, x) => Object.fromEntries(keys.map((k) => [k, BASE[table][k] * x]));
  // a level's search reaches as far as its budget: the spread's detour weight with it, the goodness weight's ceiling never
  // under the code's (graph_router.js plan: a longer budget is filled only by a search that looks that far)
  const reach = (lv, x) => ({ [`SPREAD.${lv}.0`]: +(BASE.router[`SPREAD.${lv}.0`] * x).toFixed(3), [`A_MAX.${lv}`]: Math.round(BASE.router[`A_MAX.${lv}`] * Math.max(1, x)) });
  // and what a minute of it costs: more time to spend makes each minute cheaper (time / default), and how readily it
  // spends it (eager) on top: the engine's points per minute and the router's price of goodness per 100 % more time, alike
  const price = (lv, n) => {
    const x = (lv === 'fun' ? n.funTime / 35 * n.funEager : n.maxTime / 90 * n.maxEager);
    return x === 1 ? {} : { levels: { [`${lv}.perMin`]: +(BASE.levels[`${lv}.perMin`] / x).toFixed(4) }, router: { [`BUY.${lv}`]: +(BASE.router[`BUY.${lv}`] / x).toFixed(5) } };
  };
  const pct = (v) => `${Math.round(v)} %`;
  const times = (v, def) => (v === def ? 'Standard' : v === 0 ? 'Not at all' : `${(+v.toFixed(2))}×`);
  const GROUPS = [['time', 'Time'], ['roads', 'Roads'], ['avoid', 'Avoid'], ['data', 'Data']];
  // Each slider: id, group, label, hint (one line), min, max, step, def (today's value), show(v), and set(v, all values):
  // the tune it makes ({ router?, engine?, levels?, hwy? }). Multipliers (×) scale the code's numbers; the time ones are the numbers.
  const SLIDERS = [
    { id: 'funTime', group: 'time', label: 'Fun: extra time for better road', hint: 'How much longer than the quickest way Fun may take for better road (plus a few minutes on short trips).',
      min: 10, max: 100, step: 5, def: 35, show: (v) => `up to ${pct(v)}`,
      set: (v, n) => ({ levels: { 'fun.budget': v / 100, 'fun.slackS': Math.round(BASE.levels['fun.slackS'] * v / 35), ...price('fun', n).levels }, router: { ...reach('fun', v / 35), ...price('fun', n).router } }) },
    { id: 'funEager', group: 'time', label: 'Fun: how readily it spends it', hint: 'Higher takes the extra time for a smaller gain in road; lower stays nearer the quickest.',
      min: 0.25, max: 4, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v, n) => price('fun', n) },
    { id: 'maxTime', group: 'time', label: 'Long way: extra time for better road', hint: 'How much longer than the quickest way Long way may take for better road (plus ten minutes on short trips).',
      min: 30, max: 200, step: 10, def: 90, show: (v) => `up to ${pct(v)}`,
      set: (v, n) => ({ levels: { 'max.budget': v / 100, 'max.slackS': Math.round(BASE.levels['max.slackS'] * v / 90), ...price('max', n).levels }, router: { ...reach('max', v / 90), ...price('max', n).router } }) },
    { id: 'maxEager', group: 'time', label: 'Long way: how readily it spends it', hint: 'Higher takes the extra time for a smaller gain in road; lower stays nearer the quickest.',
      min: 0.25, max: 4, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v, n) => price('max', n) },
    { id: 'quickStray', group: 'time', label: 'Quick: time it may give for a nicer road', hint: 'Quick is the quickest way; it takes a nicer road only when that costs no more than this.',
      min: 0, max: 300, step: 15, def: 60, show: (v) => (v === 0 ? 'never' : v < 60 ? `${v} s` : `${+(v / 60).toFixed(2)} min`),
      set: (v) => ({ levels: { 'quick.slackS': v } }) },
    { id: 'hwyLimit', group: 'time', label: 'Fun and Long way: when to say take the highway', hint: 'They never drive highways. When the way without them takes more than this, the card says Quick is the way.',
      min: 1.25, max: 4, step: 0.25, def: 2, show: (v) => `${+v.toFixed(2)}× the quickest`,
      set: (v) => ({ hwy: { ABSURD: v }, router: { HWY_ABSURD: v } }) },
    { id: 'corners', group: 'roads', label: 'Corners', hint: 'How much bends and twisty roads count.',
      min: 0, max: 2, step: 0.1, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: scale('router', ['W_FUN'], v), engine: scale('engine', ['FUN', 'GAIN'], v) }) },
    { id: 'quality', group: 'roads', label: 'Road quality and smoothness', hint: 'How much a well-kept, smooth, open road counts, and every mile more of one.',
      min: 0, max: 2, step: 0.1, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: scale('router', ['W_QUALITY', 'ROAD.good'], v), engine: scale('engine', ['QUALITY', 'GOOD_PER_KM'], v) }) },
    { id: 'scenery', group: 'roads', label: 'Scenery', hint: 'How much forest, water, ridges and views count.',
      min: 0, max: 2, step: 0.1, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: scale('router', ['W_SCENERY'], v), engine: scale('engine', ['SCENERY'], v) }) },
    { id: 'towns', group: 'avoid', label: 'Towns and businesses', hint: 'How hard routes keep out of strip malls and busy business streets.',
      min: 0, max: 3, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ engine: scale('engine', ['BUSINESS_PER_KM', 'BUSINESS_CAP'], v) }) },
    { id: 'lights', group: 'avoid', label: 'Traffic lights and stops', hint: 'Higher routes round lights and stop signs; your arrival time still counts only their real wait.',
      min: 0.5, max: 4, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: { STOP_AVOID_X: v } }) },
    { id: 'streets', group: 'avoid', label: 'Side streets and subdivisions', hint: 'How hard routes keep off narrow residential streets and housing estates.',
      min: 0, max: 3, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: scale('router', ['ROAD.poor', 'W_NOTPOOR'], v), engine: scale('engine', ['POOR_PER_KM', 'POOR_CAP'], v) }) },
    { id: 'crowd', group: 'data', label: 'Members\' road data', hint: 'How much what members measured and loved on a road counts against the map\'s own guess.',
      min: 0, max: 3, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ router: scale('router', ['CROWD_W.rough', 'CROWD_W.flow', 'CROWD_W.loved', 'CROWD_W.bank'], v) }) },
    { id: 'driver', group: 'data', label: 'Fits how you drive', hint: 'How much a route that suits your driving (from your drives) counts.',
      min: 0, max: 3, step: 0.25, def: 1, show: (v) => times(v, 1),
      set: (v) => ({ engine: scale('engine', ['DRIVER'], v) }) },
  ];
  const BY_ID = Object.fromEntries(SLIDERS.map((s) => [s.id, s]));
  const DEFAULTS = Object.fromEntries(SLIDERS.map((s) => [s.id, s.def]));
  // What the screen says the sliders reach (the plumbing: destination plans in full; loops through our router's search)
  const AFFECTS = 'Applies to routes to a place, and to the roads a loop is built from (a loop\'s length is yours, so the time sliders don\'t apply to it). Best roads nearby are not changed.';

  /** A slider's value, clamped to its bounds and on its steps; anything not a number is its default. */
  function clampOne(s, v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n)) return s.def;
    const c = Math.min(s.max, Math.max(s.min, n));
    return +(s.min + Math.round((c - s.min) / s.step) * s.step).toFixed(4);
  }
  /** Every slider's value ({ id: number }), unknown ids dropped, the rest at their defaults. */
  function normalize(values) {
    const v = values && typeof values === 'object' ? values : {};
    return Object.fromEntries(SLIDERS.map((s) => [s.id, clampOne(s, v[s.id])]));
  }
  /** The sliders moved off their defaults. */
  const changed = (values) => { const n = normalize(values); return SLIDERS.filter((s) => n[s.id] !== s.def); };
  /** The tune these values make, or null when every slider is at its default (no tune: the code's numbers). */
  function tune(values) {
    const out = {};
    const n = normalize(values);
    for (const s of changed(n)) {
      const t = s.set(n[s.id], n);
      for (const [table, m] of Object.entries(t)) out[table] = { ...(out[table] || {}), ...m };
    }
    return Object.keys(out).length ? out : null;
  }
  /** a's tune with b's laid on top, path by path (the Dev panel's numbers over the driver's sliders); null when both are none. */
  function merge(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const out = {};
    for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) out[t] = { ...(a[t] || {}), ...(b[t] || {}) };
    return out;
  }
  /** The labels of the sliders moved, for the route card's note ("Your tuning: Corners, Scenery"). */
  const labels = (values) => changed(values).map((s) => s.label);

  function load(store) {
    try { const j = JSON.parse(store.getItem(KEY) || 'null'); return normalize(j && j.v === VERSION ? j.values : null); } catch (_) { return { ...DEFAULTS }; }
  }
  function save(store, values) {
    const n = normalize(values);
    try { if (changed(n).length) store.setItem(KEY, JSON.stringify({ v: VERSION, values: n })); else store.removeItem(KEY); } catch (_) { /* this session only */ }
    return n;
  }
  /** May this phone use it: Pro's word (pro.js 'route_tuning': open to everyone until Pro goes on sale, then Pro). */
  const allowed = (store, flags, Pro = root.ApexPro) => !!(Pro && Pro.allowed('route_tuning', store, flags));
  /** The tune a plan on this phone uses: the stored sliders while allowed, else none (settings are kept, unused). */
  const active = (store, flags, Pro) => (allowed(store, flags, Pro) ? tune(load(store)) : null);

  // ---- the screen (Garage → Settings → Route tuning) ----------------------------------------------------------------
  // host: { store, flags(), changed(), planned(), replan(), proLine() }. Saved as each slider moves; Use on this route
  // re-plans the trip on screen; Reset to defaults puts every slider back.
  function mountScreen(body, host) {
    const doc = body.ownerDocument;
    const make = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };
    let values = load(host.store);
    const status = make('p', { className: 'note', id: 'tuneStatus', role: 'status' });
    status.setAttribute('aria-live', 'polite');
    const lock = make('p', { className: 'note', id: 'tuneLock', hidden: true });
    const inputs = new Map();
    const paintStatus = (t) => { status.textContent = t; };
    const replanBtn = make('button', { type: 'button', className: 'ink-btn', id: 'tuneReplan', textContent: 'Use on the route on screen' });
    const resetBtn = make('button', { type: 'button', className: 'linkbtn', id: 'tuneReset', textContent: 'Reset to defaults' });
    function paint() {
      const ok = allowed(host.store, host.flags());
      lock.hidden = ok;
      lock.textContent = ok ? '' : (host.proLine() || 'Route tuning comes with Vetta Pro.') + ' Your settings are kept; routes use the defaults.';
      for (const [id, { input, out, row }] of inputs) {
        const s = BY_ID[id], v = values[id];
        input.value = String(v); input.disabled = !ok;
        out.textContent = s.show(v);
        row.classList.toggle('tuned', v !== s.def);
      }
      const n = changed(values).length;
      resetBtn.disabled = !n;
      replanBtn.hidden = !ok || !host.planned();
      if (!status.textContent || /^(Standard|\d+ setting)/.test(status.textContent)) paintStatus(n ? `${n} setting${n === 1 ? '' : 's'} changed` : 'Standard: the routes everyone gets');
    }
    function changedNow() { values = save(host.store, values); host.changed(); paint(); }
    body.append(make('p', { className: 'note', id: 'tuneAffects', textContent: AFFECTS }), lock);
    for (const [g, title] of GROUPS) {
      const sec = make('div', { className: 'tune-group stack-8' });
      sec.dataset.group = g;
      sec.append(make('h4', { className: 'ctl-label', textContent: title }));
      for (const s of SLIDERS.filter((x) => x.group === g)) {
        const input = make('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), id: `tune_${s.id}` });
        input.dataset.tune = s.id;
        const out = make('output', { className: 'tune-val' });
        out.htmlFor = input.id;
        const lab = make('label', { htmlFor: input.id, textContent: s.label });
        const hint = make('p', { className: 'note tune-hint', textContent: s.hint });
        hint.id = `tune_${s.id}_hint`;
        input.setAttribute('aria-describedby', hint.id);
        const row = make('div', { className: 'tune-row' }, make('div', { className: 'tune-head' }, lab, out), input, hint);
        input.addEventListener('input', () => { values[s.id] = clampOne(s, input.value); out.textContent = s.show(values[s.id]); });
        input.addEventListener('change', () => { values[s.id] = clampOne(s, input.value); status.textContent = ''; changedNow(); });
        inputs.set(s.id, { input, out, row });
        sec.append(row);
      }
      body.append(sec);
    }
    resetBtn.addEventListener('click', () => { values = { ...DEFAULTS }; paintStatus(host.planned() ? 'Back to the defaults. Use them on the route on screen?' : 'Back to the defaults'); changedNow(); });
    replanBtn.addEventListener('click', () => {
      paintStatus('Planning again…');
      Promise.resolve(host.replan()).then(() => paintStatus('Planned again with these settings')).catch(() => paintStatus('Couldn\'t plan it again'));
    });
    body.append(make('div', { className: 'row mt-8', style: 'flex-wrap:wrap' }, replanBtn, resetBtn), status);
    paint();
    return { paint, values: () => ({ ...values }) };
  }

  const api = { KEY, VERSION, BASE, SLIDERS, GROUPS, DEFAULTS, AFFECTS, clampOne, normalize, changed, tune, merge, labels, load, save, allowed, active, mountScreen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteTuning = api;
})(typeof window !== 'undefined' ? window : globalThis);
