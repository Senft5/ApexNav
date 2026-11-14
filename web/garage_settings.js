// The Garage as a garage (REVIEW5 §2 and Roadmap 5 item 7; REVIEW3 Roadmap 3 item 1, U-49): the page leads with what it is,
// you and your cars, Look and voice, and the co-driver; every setting sits behind one gear in the Garage's header, as a
// list of rows, each opening its own sheet (a bottom sheet on the phone, a side panel on a desk), the crew page's pattern.
//
// The settings stay where index.html writes them, as <section data-setting="key" data-title="…">, so every id the rest of
// the app uses (#zoneRadius, #myGpxBtn, #crashName, #feedbackBox…) is the same element, still reachable. At launch this
// moves each section into its sheet on <body> (over the pop scrim, like People's sheets) and puts the gear in the header.
// Nothing here knows what a setting does. Pure DOM, no state of its own; tests/test_garage_settings.py and e2e/smoke.js.
(function (root) {
  'use strict';
  // The rows, in the order a driver looks for them: what you share and keep, how the app reads, then the account and help.
  const ORDER = ['roadfeel', 'zones', 'crash', 'drivecam', 'nudge', 'push', 'units', 'motion', 'tuning', 'spots', 'data', 'account', 'feedback', 'about', 'dev'];
  // The list reads as three short lists, not one of twelve (design pass 7, 2026-11-10): each starts at its first key here.
  const GROUPS = { roadfeel: 'Sharing and safety', units: 'How the app reads', data: 'You and Vetta' };
  /**
   * What a setting is set to, for its row (design pass 7: the list said nothing until each sheet was opened). A section
   * names the control that says it, `data-summary="#unitsRow"`: a switch key reads On / Off, a group of keys reads the
   * key that is on, and a list (`data-summary-count="place,places"`) its count, "None" when empty; a node that carries
   * `data-summary-text` has said it itself (Route tuning: "Standard", "2 changed"). '' when it can't tell:
   * a row never guesses.
   */
  function summaryOf(node, count) {
    if (!node) return '';
    if (node.dataset && typeof node.dataset.summaryText === 'string') return node.dataset.summaryText;   // the sheet's own words (Route tuning)
    const on = (b) => b.classList.contains('on') || b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true';
    if (count) { const n = [...node.children].filter((c) => !c.classList.contains('note')).length,   // (a list's own "none yet" line is not an entry)
       [one, many] = String(count).split(','); return n === 0 ? 'None' : `${n} ${n === 1 ? one : many || one}`; }
    if (node.matches('button')) return on(node) ? 'On' : 'Off';
    const b = [...node.querySelectorAll('button')].find(on);
    return b ? b.textContent.trim() : '';
  }
  const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3"/><circle cx="12" cy="12" r="6.6"/></svg>';

  function mount(opts = {}) {
    const doc = opts.document || root.document;
    const sheet = opts.sheet || doc.getElementById('sheet');
    if (!sheet) return null;
    const make = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };
    const sections = [...sheet.querySelectorAll('section[data-setting]')];
    const byKey = new Map();
    for (const s of sections) { const k = s.dataset.setting; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(s); }
    const keys = [...ORDER.filter((k) => byKey.has(k)), ...[...byKey.keys()].filter((k) => !ORDER.includes(k))];
    const title = (k) => (byKey.get(k).find((s) => s.dataset.title) || {}).dataset?.title || k;

    const popOf = (label, back) => {
      const p = make('aside', { className: 'side-pop garage-pop', tabIndex: -1 });
      p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', label);
      const close = make('button', { type: 'button', className: 'linkbtn', textContent: back ? '‹ Settings' : 'Done' });
      close.addEventListener('click', () => { p.classList.remove('open'); if (back && list.classList.contains('open')) { refresh(); list.focus({ preventScroll: true }); } });   // back on the list, its rows say what you just set
      p.append(make('div', { className: 'side-pop-head' }, make('h3', { textContent: label }), close));
      return p;
    };

    // the list behind the gear
    const list = popOf('Settings', false);
    list.id = 'garageSettings';
    const rows = make('div', { className: 'nav-rows' });
    list.append(rows);
    const pops = new Map(), rowFor = new Map();
    for (const k of keys) {
      const label = title(k), pop = popOf(label, true);
      pop.dataset.setting = k;
      for (const s of byKey.get(k)) {
        const h = s.querySelector(':scope > h3');
        if (h && h.textContent.trim() === label) h.remove();       // the sheet's head names it once
        pop.append(s);
      }
      pops.set(k, pop);
      const r = make('button', { type: 'button', className: 'nav-row' }, make('span', { textContent: label }), make('small'), make('i'));
      r.querySelector('i').setAttribute('aria-hidden', 'true');
      r.dataset.setting = k;
      r.addEventListener('click', () => open(k));
      rowFor.set(k, r);
      if (GROUPS[k]) rows.append(make('h4', { className: 'nav-group', textContent: GROUPS[k] }));
      rows.append(r);
    }
    doc.body.append(list, ...pops.values());

    // A row whose sheet has nothing in it right now (Account while signed out) is not offered.
    const isEmpty = (k) => byKey.get(k).every((s) => s.hasAttribute('data-empty-hides') && ![...s.querySelectorAll('[data-fill]')].some((f) => f.children.length));
    function refresh() {
      for (const [k, r] of rowFor) {
        r.hidden = isEmpty(k);
        const s = byKey.get(k).find((x) => x.dataset.summary);
        let text = '';
        try { text = s ? summaryOf(pops.get(k).querySelector(s.dataset.summary), s.dataset.summaryCount) : ''; } catch (_) { text = ''; }
        r.querySelector('small').textContent = text;
        r.setAttribute('aria-label', text ? `${r.querySelector('span').textContent}: ${text}` : r.querySelector('span').textContent);
      }
      // a group's name shows while any of its rows does
      for (const h of rows.querySelectorAll('.nav-group')) { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('nav-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; }
    }

    function openList() { refresh(); list.classList.add('open'); list.focus({ preventScroll: true }); }
    /** Opens the list and one setting's sheet over it. */
    function open(k) {
      const p = pops.get(k); if (!p) return false;
      refresh(); list.classList.add('open'); p.scrollTop = 0; p.classList.add('open'); p.focus({ preventScroll: true });
      return true;
    }
    /** Shows a node that lives in a setting's sheet (who_sees's "privacy zones", a toast's link); false when it is on the page. */
    function reveal(node) {
      const p = node && node.closest && node.closest('.garage-pop');
      if (!p || !p.dataset.setting) return false;
      open(p.dataset.setting);
      setTimeout(() => { try { node.scrollIntoView({ block: 'nearest' }); } catch (_) {} }, 220);
      return true;
    }
    function close() { list.classList.remove('open'); for (const p of pops.values()) p.classList.remove('open'); }

    // the one gear, in the Garage's header (shown only on the Garage)
    const gear = make('button', { type: 'button', className: 'gear-key garage-gear', id: 'garageGear' });
    gear.innerHTML = GEAR;
    gear.setAttribute('aria-label', 'Settings');
    gear.setAttribute('aria-haspopup', 'dialog');
    gear.addEventListener('click', openList);
    const head = sheet.querySelector('header');
    if (head) head.append(gear);

    return { open, openList, reveal, close, refresh, keys: () => keys.slice(), pop: (k) => pops.get(k) || null };
  }

  const api = { mount, ORDER, GROUPS, summaryOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.ApexGarageSettings = api;
    const go = () => { try { api.ui = mount(); } catch (e) { console.error('garage settings', e); } };
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
