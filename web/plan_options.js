// The plan flow (CALL_SHEET 2026-11-04): one Options sheet holds what a route avoids (✕) and prefers (✓), the kinds of
// corners, the start point, presets, GPX and loops to fit. What is on is never hidden once the sheet closes: it shows as
// small chips on the plan sheet and on the route card (finding 5). Pure: the chips, their words and whether a sheet's
// visit changed anything; cockpit.js draws them and opens the sheet from any of them. tests/test_plan_options.py.
(function (root) {
  'use strict';

  // the switch labels, as index.html's Options sheet writes them (vocabulary.js avoid, prefer, passenger…tunnels)
  const AVOID = { highways: 'Highways', tolls: 'Tolls', ferries: 'Ferries', unpaved: 'Unpaved', towns: 'Towns', cameras: 'Cameras' };
  const PREFER = { measured: 'Measured roads', novel: 'New to me', crew: 'Crew favourites' };
  const DRIVER = { passenger: 'Passenger aboard', lit: 'Lit roads at night', cyclists: 'Cyclist courtesy', tunnels: 'Tunnels' };
  const MIX = { tight: 'hairpins', fast: 'fast bends' };

  /**
   * The options that are on, in the sheet's order: [{ key, kind: 'avoid' | 'prefer' | 'mix', text, aria }]. `text` is the
   * chip ("✕ Highways", "✓ Passenger aboard", "More hairpins"); `aria` says it in words ("Avoiding highways").
   * state: { avoid: { highways: true… }, prefs: { measured, novel, crew, tight: -1|0|1, fast }, driver: { passenger… } }.
   */
  function active(state = {}) {
    const avoid = state.avoid || {}, prefs = state.prefs || {}, driver = state.driver || {}, out = [];
    for (const [k, label] of Object.entries(AVOID)) if (avoid[k]) out.push({ key: `avoid:${k}`, kind: 'avoid', text: `✕ ${label}`, aria: `Avoiding ${label.toLowerCase()}` });
    for (const [k, label] of Object.entries(PREFER)) if (prefs[k]) out.push({ key: `prefer:${k}`, kind: 'prefer', text: `✓ ${label}`, aria: `Preferring ${label.toLowerCase()}` });
    for (const [k, label] of Object.entries(DRIVER)) if (driver[k]) out.push({ key: `driver:${k}`, kind: 'prefer', text: `✓ ${label}`, aria: `${label}: on` });
    for (const [k, label] of Object.entries(MIX)) {
      const v = Number(prefs[k]);
      if (v === 1 || v === -1) out.push({ key: `mix:${k}`, kind: 'mix', text: `${v > 0 ? 'More' : 'Fewer'} ${label}`, aria: `${v > 0 ? 'More' : 'Fewer'} ${label}` });
    }
    return out;
  }

  /** The Options chip's own words: "Options" alone, or "Options · 3" with three on. */
  function chipLabel(list) {
    const n = (list || []).length;
    return n ? `Options · ${n}` : 'Options';
  }

  /** A snapshot of what the sheet sets, to tell on closing whether the route on the card needs planning again. */
  function snapshot(state = {}) {
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o && o[k] ? (typeof o[k] === 'number' ? o[k] : true) : false]));
    return JSON.stringify({ avoid: pick(state.avoid, Object.keys(AVOID)), prefs: pick(state.prefs, [...Object.keys(PREFER), ...Object.keys(MIX)]),
      driver: pick(state.driver, Object.keys(DRIVER)), from: String(state.from || '').trim() });
  }
  const changed = (a, b) => a !== b;

  const api = { AVOID, PREFER, DRIVER, MIX, active, chipLabel, snapshot, changed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlanOptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
