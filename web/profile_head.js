/* Vetta: a profile's head (Garage as a profile, Nate 2026-11-16: "garage stealing their profile page", "still vetta").
 * One shape for you (the Garage) and for a friend (their profile): the face, ringed when they're driving now; beside it
 * the numbers that say who they are as a driver; under it the handle, a line, the car they drive; then the keys.
 * Unknown numbers stay --. count() is pure (tests/test_profile_head.py). */
(function (root) {
  'use strict';
  /** A count as shown: --, 7, 999, 1.2k, 12k. */
  function count(n) {
    if (n === null || n === undefined || !Number.isFinite(+n) || +n < 0) return '--';
    n = Math.round(+n);
    if (n < 1000) return String(n);
    if (n < 10000) return `${(Math.floor(n / 100) / 10).toString().replace(/\.0$/, '')}k`;
    return `${Math.floor(n / 1000)}k`;
  }
  const CSS = `
    .ph { display: grid; gap: 12px; }
    .ph-top { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; }
    .ph-face { display: grid; place-items: center; }
    .ph-counts { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; }
    .ph-count { display: grid; justify-items: center; gap: 0; min-height: 52px; align-content: center; border: 0; background: none; padding: 0; color: var(--panel-ink); font: inherit; }
    button.ph-count { cursor: pointer; }
    .ph-count b { font: 800 26px/1.05 var(--font-num); font-variant-numeric: tabular-nums; }
    .ph-count small { font-size: 13px; color: var(--panel-dim); }
    .ph-name { display: grid; gap: 2px; }
    .ph-name h3 { margin: 0; padding: 0; border: 0; font: 700 24px/1.1 var(--font-num); overflow-wrap: anywhere; }
    .ph-name p { margin: 0; font-size: 14px; color: var(--panel-dim); }
    .ph-name p.live { color: var(--panel-ink); font-weight: 600; }
    .ph-car { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
    .ph-car[hidden] { display: none; }
    .ph-car svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
    .ph-keys { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; }
    .edit-face { display: grid; justify-items: center; gap: 8px; padding: 8px 0 4px; }
    .edit-face small { color: var(--panel-dim); font-size: 13px; }
    .ph-keys .ink-btn { height: 40px; min-height: 40px; padding: 0 10px; font-size: 15px; }
    /* the largest text sizes (Dynamic Type): the face over the numbers, so three counts never run off the screen */
    html[data-type-size] .ph-top { grid-template-columns: minmax(0, 1fr); justify-items: start; }
    html[data-type-size] .ph-counts { width: 100%; display: flex; flex-wrap: wrap; gap: 4px 20px; }
    html[data-type-size] .ph-count { flex: 0 1 auto; justify-items: start; }
    .ph-count small { max-width: 100%; overflow-wrap: anywhere; }
  `;
  const CAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16v-3l2.2-5h13.6L21 13v3M3 16h18M3 16v2M21 16v2"/><circle cx="7.5" cy="13" r="1"/><circle cx="16.5" cy="13" r="1"/></svg>';

  /**
   * o: el, btn, face (a node), title (@handle), sub (a line, or ''), live (sub says they're driving now), car (a car's name,
   * or null; setCar() fills it later), counts ([{ n, label, run? }]), keys ([[label, run], ...], the first solid).
   * Returns the node; node.setCount(i, n) and node.setCar(text) change it once more is known.
   */
  function draw(o) {
    const { el, btn } = o, d = root.document;
    if (d && d.head && !d.getElementById('profile-head-css')) { const s = d.createElement('style'); s.id = 'profile-head-css'; s.textContent = CSS; d.head.append(s); }
    const counts = (o.counts || []).map((c) => {
      const b = el('b', { textContent: count(c.n) }), lab = el('small', { textContent: c.label });
      const node = c.run ? el('button', { type: 'button', className: 'ph-count' }, b, lab) : el('div', { className: 'ph-count' }, b, lab);
      const say = () => { if (c.run) node.setAttribute('aria-label', `${b.textContent} ${c.label}`); };
      if (c.run) node.addEventListener('click', c.run);
      say();
      node._set = (n) => { b.textContent = count(n); say(); };
      return node;
    });
    const car = el('p', { className: 'ph-car' }); car.innerHTML = CAR; const carName = el('span'); car.append(carName);
    const setCar = (t) => { carName.textContent = t || ''; car.hidden = !t; };
    setCar(o.car);
    const box = el('div', { className: 'ph' },
      el('div', { className: 'ph-top' }, el('div', { className: 'ph-face' }, o.face), el('div', { className: 'ph-counts' }, ...counts)),
      el('div', { className: 'ph-name' }, el('h3', { textContent: o.title }), ...(o.sub ? [el('p', { className: o.live ? 'live' : '', textContent: o.sub })] : [])),
      car,
      ...((o.keys || []).length ? [el('div', { className: 'ph-keys' }, ...o.keys.map(([label, run], i) => btn(label, run, i ? 'ink-btn' : 'ink-btn solid')))] : []));
    box.setCount = (i, n) => { if (counts[i]) counts[i]._set(n); };
    box.setCar = setCar;
    return box;
  }
  /** The car a profile names: the daily one, else the first; "2019 Mazda MX-5" or its nickname. */
  function carName(list) {
    const cars = Array.isArray(list) ? list.filter(Boolean) : [];
    const c = cars.find((x) => x.is_primary) || cars[0];
    if (!c) return null;
    const what = [c.year, c.make, c.model].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
    return what || (c.nickname ? `"${c.nickname}"` : null);
  }
  const api = { count, draw, carName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexProfileHead = api;
})(typeof window !== 'undefined' ? window : globalThis);
