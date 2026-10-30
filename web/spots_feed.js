// Spots near you (IDEAS S-12): the overlooks, cafés, bridges and waterfalls members shared, near where you are, best first
// and then nearest, with a category filter; Go there plans a route, members rate them, anyone can report one. Text only
// for what people typed. feed() is pure (tests/test_spots_feed.py); mount() draws the section, which lives in Where to?
// (REVIEW_PEOPLE P-13: members' spots are a planning input, not a friend thing).
(function (root) {
  'use strict';
  const LABEL = { overlook: 'Overlook', cafe: 'Café', photo: 'Photo spot', bridge: 'Bridge', water: 'Water', trailhead: 'Trailhead', landmark: 'Landmark', other: 'Spot' };
  const MAX = 20;
  const km = (a, b) => Math.hypot((b.lat - a.lat) * 110.54, (b.lon - a.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));

  /** Spots (from ApexSync.highlightsNear) near `here`, in `category` ('all' for every one): rated best first, then nearest. */
  function feed(spots, here, category = 'all') {
    if (!here) return [];
    return (spots || []).filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lon) && (category === 'all' || s.category === category))
      .map((s) => ({ ...s, km: Math.round(km(here, s) * 10) / 10, label: LABEL[s.category] || LABEL.other }))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.km - b.km).slice(0, MAX);
  }

  /** page: el, btn, toast, sync (ApexSync), here() → {lat, lon}|null, goTo({label, lat, lon}), report, fmtKm(km) → "250.6 mi". */
  const STYLE = `
    .spot-stars { display: inline-flex; align-items: center; }
    .spot-star { width: 36px; height: 44px; padding: 0; border: 0; background: none; font-size: 22px; line-height: 1; color: var(--panel-dim); opacity: 0.45; }
    .spot-star.on { color: var(--panel-ink); opacity: 1; }
  `;
  function mount(page) {
    const { el, btn, toast, sync } = page;
    if (root.document && !root.document.getElementById('spotsFeedStyle')) root.document.head.append(el('style', { id: 'spotsFeedStyle', textContent: STYLE }));
    const dist = (k) => (page.fmtKm ? page.fmtKm(k) : `${k} km`);   // P-12: in the units the phone is set to
    function section() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Spots near you' }));
      const chips = el('div', { className: 'row', style: 'flex-wrap:wrap' }), list = el('div', { className: 'stack-8' });
      let cat = 'all', spots = [];
      const paint = () => {
        chips.replaceChildren(...[['all', 'All'], ...Object.entries(LABEL).filter(([k]) => spots.some((s) => s.category === k))].map(([k, label]) => {
          const b = btn(label, () => { cat = k; paint(); }, 'chip' + (cat === k ? ' on' : ''));
          b.setAttribute('aria-pressed', String(cat === k));
          return b;
        }));
        chips.hidden = !spots.length;   // nothing to filter yet
        const rows = feed(spots, page.here(), cat);
        list.replaceChildren(...(rows.length ? rows.map((s) => {
          const box = el('div', { className: 'stack-8 spot-card', style: 'border:1px solid var(--rule);padding:10px' });
          box.append(el('b', { textContent: s.name }),
            el('p', { className: 'note', textContent: `${s.ratings ? `${s.rating.toFixed(1)}★ (${s.ratings})` : 'Not rated yet'} · ${s.label} · ${dist(s.km)}${s.visits ? ` · ${s.visits} visited` : ''}` }));
          if (s.note) box.append(el('p', { className: 'note', textContent: s.note }));
          const acts = el('div', { className: 'row', style: 'flex-wrap:wrap' }, btn('Go there', () => page.goTo({ label: s.name, lat: s.lat, lon: s.lon }), 'ink-btn'));
          // P-33: five small stars, yours filled; three fixed keys read as a quiz
          if (!s.mine) {
            const stars = el('span', { className: 'spot-stars', 'aria-label': `Your rating of ${s.name}` }); stars.setAttribute('role', 'group');
            for (let n = 1; n <= 5; n++) {
              const r = btn('★', async () => { toast((await sync.rateHighlight(s.id, n)) ? 'Rated.' : 'Couldn’t rate it. Try again.'); load(); }, 'spot-star' + (s.myStars >= n ? ' on' : ''));
              r.setAttribute('aria-label', `Rate ${s.name} ${n} star${n === 1 ? '' : 's'}`);
              r.setAttribute('aria-pressed', String(s.myStars === n));
              stars.append(r);
            }
            acts.append(stars);
          }
          if (!s.mine && page.report) acts.append(btn('Report', () => page.report({ kind: 'highlight', target: s.id.replace(/^srv_/, ''), label: s.name, done: load }), 'linkbtn'));
          box.append(acts);
          return box;
        }) : [el('p', { className: 'note', textContent: page.here() ? 'No shared spots near here yet. Add one in Garage → Spots.' : 'Waiting for your position.' })]));
      };
      const load = () => {
        const at = page.here();
        if (!at || !sync || !sync.highlightsNear) { paint(); return; }
        sync.highlightsNear(at).then((r) => { spots = Array.isArray(r) ? r : []; paint(); }).catch(() => { spots = []; paint(); });
      };
      sec.append(chips, list);
      load();
      return sec;
    }
    return { section };
  }

  const api = { feed, mount, LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSpotsFeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
