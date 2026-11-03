// Shut doors for VoiceOver (panel round 2 AM-1). What is shut can't be reached; what is open is the only thing that can.
//  - A dialog that shows (any `.overlay.show`, a `.side-pop.open`): everything else on the page is `inert`, focus moves to
//    its heading (or its first key) and goes back to whatever opened it when it closes.
//  - The Menu (`#sheet.open`): the map, the road book, the plan and the map keys behind it are `inert`; the tab bar stays.
//  - The tab bar says which tab is current with `aria-current="page"`.
// Closed sheets and panels are `visibility: hidden` in the page's CSS (index.html), so they leave the swipe order too.
// The live regions (#announcer, #toast) are never made inert: a dialog must not silence them. `plan(root, keeps)` is pure
// over any DOM-like tree (tests/test_doors.py); mount() watches the page and applies it.
(function (root) {
  'use strict';
  // live regions stay reachable (a dialog must not silence them); so do the scrims, which close a sheet with a tap outside it
  const LIVE = '#announcer, #toast, [aria-live]:not([aria-live="off"]), .pop-scrim, #scrim';
  const MARK = 'data-door-shut';
  const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), summary';

  /** The elements to make inert so only `keeps` (and live regions) stay reachable under `top`: every child of `top` that
   *  holds neither a keep nor a live region, and, inside a child that does hold one, the same again one level down. */
  function plan(top, keeps) {
    const out = [];
    const holds = (el, sel) => keeps.some((k) => k === el || el.contains(k)) || (sel && (el.matches(sel) || !!el.querySelector(sel)));
    (function walk(node) {
      for (const c of Array.from(node.children)) {
        if (/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(c.tagName)) continue;
        if (keeps.includes(c) || c.matches(LIVE)) continue;
        if (holds(c, LIVE)) walk(c); else out.push(c);
      }
    })(top);
    return out;
  }

  /** What is open now: the topmost dialog, else the Menu, else nothing. */
  function openDoor(doc) {
    const dialogs = Array.from(doc.querySelectorAll('.overlay.show, .side-pop.open')).filter((d) => d.getClientRects().length || d.classList.contains('side-pop'));
    if (dialogs.length) return { kind: 'dialog', el: dialogs[dialogs.length - 1] };
    const sheet = doc.getElementById('sheet');
    if (sheet && sheet.classList.contains('open')) return { kind: 'sheet', el: sheet };
    return null;
  }

  function firstStop(el) {
    const h = el.querySelector('h1, h2, [role="heading"]');
    if (h && h.getClientRects().length) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); return h; }
    return Array.from(el.querySelectorAll(FOCUSABLE)).find((n) => n.getClientRects().length) || null;
  }

  function mount(doc) {
    let last = null;
    const shut = (list) => { for (const n of list) { n.inert = true; n.setAttribute(MARK, ''); } };
    const open = () => { for (const n of doc.querySelectorAll(`[${MARK}]`)) { n.inert = false; n.removeAttribute(MARK); } };
    function tabs() {
      for (const t of doc.querySelectorAll('#tabbar .tab')) {
        if (t.classList.contains('on')) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      }
    }
    // AM-3: while driving the map is a picture VoiceOver can't read; the road book is its stand-in
    function mapHidden() {
      const app = doc.getElementById('app'), map = doc.getElementById('map');
      if (!app || !map) return;
      const hide = app.classList.contains('live');
      if (hide !== (map.getAttribute('aria-hidden') === 'true')) { if (hide) map.setAttribute('aria-hidden', 'true'); else map.removeAttribute('aria-hidden'); }
    }
    const openers = [];   // [{ door, from }]: who opened each door still open, to give focus back when it shuts
    const focus = (n) => { try { n.focus({ preventScroll: true }); } catch (_) {} };
    function refresh() {
      tabs(); mapHidden();
      const now = openDoor(doc);
      if ((now && now.el) === (last && last.el)) return;
      open();
      // doors that shut since: their openers get focus back, the newest first, if they can still take it
      let back = null;
      while (openers.length) {
        const top = openers[openers.length - 1].door;
        if ((now && top === now.el) || (top.isConnected && top.matches('.open, .show'))) break;
        back = openers.pop().from || back;
      }
      if (now) {
        const app = doc.getElementById('app');
        if (now.kind === 'sheet') shut(plan(app || doc.body, [now.el, doc.getElementById('tabbar')].filter(Boolean)));
        else shut(plan(doc.body, [now.el]));
        if (!openers.some((o) => o.door === now.el)) {
          const a = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
          openers.push({ door: now.el, from: a && !now.el.contains(a) ? a : outside });   // the page may have moved focus in already
        }
        if (!now.el.contains(doc.activeElement)) {
          const f = back && now.el.contains(back) && back.isConnected ? back : firstStop(now.el);
          if (f) focus(f);
        }
      } else if (back && back.isConnected && !back.closest('[inert]')) focus(back);
      last = now;
    }
    // only what can open or close a door: the strip rebuilds itself every frame, and that must cost nothing here.
    // The observer's callback is a microtask, so a door that opens is reachable before the next tap or keystroke; waiting
    // for a frame left a sheet opened over another one inert for that frame (its first keystrokes went nowhere).
    const door = (n) => n.nodeType === 1 && n.matches('.overlay, .side-pop');
    const watch = new MutationObserver((ms) => {
      for (const m of ms) {
        const t = m.target;
        if (m.type === 'childList' ? [...m.addedNodes].some(door) || [...m.removedNodes].some(door) : t.matches && t.matches('.overlay, .sheet, .side-pop, .tab, #app')) { refresh(); return; }
      }
    });
    watch.observe(doc.body, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
    // the last thing focused outside every open door: what a door opened by the page itself gives focus back to
    let outside = null;
    doc.addEventListener('focusin', (e) => { if (!openDoor(doc) || !openDoor(doc).el.contains(e.target)) outside = e.target; }, true);
    refresh();
    return { refresh, stop: () => watch.disconnect() };
  }

  const api = { plan, openDoor, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.ApexDoors = api;
    const go = () => { try { root.apexDoors = mount(root.document); } catch (_) { /* an old engine: the doors stay as they were */ } };
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else if (root.document) go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
