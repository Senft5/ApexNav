// Back to the map without reloading it (the owner, 2026-10-29: "why do pages fully reload"). The Log and Stages are their own
// page (analysis.html). When you came there from the map, its Map, Crew and Garage tabs go back in history instead of loading
// index.html afresh, so WebKit's back-forward cache returns the map as you left it (route, camera, open sheet), and the tab
// you picked is passed along to open on arrival. Without a map page to go back to it stays a plain link.
(function (root) {
  'use strict';
  const KEY = 'apex.returnView';
  const fromMap = () => {
    try { const u = new URL(root.document.referrer); return u.protocol === root.location.protocol && u.host === root.location.host && /\/(index\.html)?$/.test(u.pathname); }
    catch (_) { return false; }
  };

  /** analysis.html: tabs that point at the map go back to it when it is the page behind this one. */
  function wireTabs(nav) {
    if (!nav) return;
    nav.querySelectorAll('a[href^="index.html"]').forEach((a) => a.addEventListener('click', (e) => {
      if (!fromMap() || root.history.length < 2) return;
      const view = new URL(a.getAttribute('href'), root.location.href).searchParams.get('view') || '';
      try { root.sessionStorage.setItem(KEY, view || 'map'); } catch (_) { return; }
      e.preventDefault();
      root.history.back();
    }));
  }

  /** index.html: the view a tab on the analysis page asked for ('crew', 'garage', 'map'), once; null when none. */
  function take() {
    try { const v = root.sessionStorage.getItem(KEY); root.sessionStorage.removeItem(KEY); return v || null; } catch (_) { return null; }
  }

  root.ApexReturn = { wireTabs, take, KEY };
  // the analysis page's tab bar wires itself (index.html has no links to itself there)
  if (root.document) {
    const go = () => wireTabs(root.document.querySelector('nav.tabbar'));
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
