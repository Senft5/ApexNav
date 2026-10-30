// The Log in a frame over the map (the owner, 2026-10-29: "the crew page still does a full reload every time"). The Log
// and Stages are their own page (analysis.html), but the map page never leaves: it opens them in a full-screen frame
// (index.html openLog), so the map, a drive in progress and the car's screen keep running behind. Inside that frame,
// a link to the map page (the Map, Crew and Garage tabs) asks the map page to close the frame and show that tab, and
// a replay link asks it to load that drive. Opened on its own (a shared link, the website), the page's links work
// as plain links.
(function (root) {
  'use strict';
  const doc = root.document;
  // the map page, when this page is its Log frame (same origin, so its window can be reached)
  const host = (() => {
    try { return root.parent && root.parent !== root && root.parent.ApexLogHost ? root.parent : null; } catch (_) { return null; }
  })();

  /** 'index.html?view=garage' -> { view: 'garage' }; a map-page URL with anything else in it -> { url }; else null. */
  function mapTarget(href) {
    let u;
    try { u = new URL(href, root.location.href); } catch (_) { return null; }
    if (u.origin !== root.location.origin || !/\/(index\.html)?$/.test(u.pathname)) return null;
    const keys = [...u.searchParams.keys()];
    if (keys.every((k) => k === 'view')) return { view: u.searchParams.get('view') || 'map' };
    return { url: u.pathname.replace(/^.*\//, '') + u.search };
  }

  /** Goes to a map-page URL: through the map page when this is its Log frame, else a plain navigation. */
  function open(href) {
    const t = host && mapTarget(href);
    if (!t) { root.location.href = href; return; }
    if (t.view) host.ApexLogHost.close(t.view); else host.ApexLogHost.load(t.url);
  }

  if (host && doc) {
    doc.documentElement.classList.add('in-log-frame');
    // the notch and home bar from the map page before anything draws (env() is zero inside a frame); it sets them again on load
    try { const ins = host.ApexLogHost.insets(); for (const k of Object.keys(ins)) doc.documentElement.style.setProperty(`--sa-${k}`, ins[k]); } catch (_) {}
    doc.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || e.defaultPrevented) return;
      if (!mapTarget(a.getAttribute('href'))) return;
      e.preventDefault();
      open(a.getAttribute('href'));
    });
  }

  root.ApexReturn = { open, mapTarget, embedded: !!host };
})(typeof window !== 'undefined' ? window : globalThis);
