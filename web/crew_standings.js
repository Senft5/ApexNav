// Crews this month (IDEAS S-11 crew-vs-crew, S-08 smoothest crew), in the Crew sheet: road data km summed over each crew's
// members and the mean Smooth of the runs published to it, never speed. Private crews show only to their members and are
// never ranked; public crews rank once they have 3 members (smoothness once 3 runs). lines() is pure
// (tests/test_crew_standings.py); mount() draws the section from GET /api/crews/standings.
(function (root) {
  'use strict';
  const TOP_SHOWN = 5;

  /** Text for the section: { mine: [string], km: [string], smooth: [string] }; every line from crew totals only. */
  function lines(st, fmtKm = (km) => `${km} km`) {
    if (!st) return { mine: [], km: [], smooth: [] };
    const mine = (st.mine || []).map((c) => {
      const bits = [c.name, `${fmtKm(c.km)} of road data`];
      if (c.smoothness != null) bits.push(`Smooth ${c.smoothness}`);
      if (c.visibility !== 'public') bits.push('private, not ranked');
      else if (c.km_rank == null) bits.push('ranked from 3 members');
      else bits.push(`#${c.km_rank} of ${c.of} for road data${c.smooth_rank ? `, #${c.smooth_rank} for smoothness` : ''}`);
      return bits.join(' · ');
    });
    const km = (st.top_km || []).slice(0, TOP_SHOWN).map((c, i) => `${i + 1}. ${c.name} · ${fmtKm(c.km)}`);
    const smooth = (st.top_smooth || []).slice(0, TOP_SHOWN).map((c, i) => `${i + 1}. ${c.name} · Smooth ${c.smoothness}`);
    return { mine, km, smooth };
  }

  /** page: el, sync (ApexSync), fmtKm. */
  function mount(page) {
    const { el, sync } = page;
    function section() {
      const sec = el('div', { className: 'stack-8' });
      sec.hidden = true;
      if (sync && sync.standings) sync.standings().then((st) => {
        const L = lines(st, page.fmtKm);
        if (!L.mine.length && !L.km.length) return;
        const p = (t) => el('p', { className: 'note', textContent: t });
        sec.append(el('h3', { textContent: 'Crews this month' }), ...L.mine.map(p));
        if (L.km.length) sec.append(el('b', { textContent: 'Most road data' }), ...L.km.map(p));
        if (L.smooth.length) sec.append(el('b', { textContent: 'Smoothest' }), ...L.smooth.map(p));
        sec.append(p('Public crews of 3 or more. Never speed: road data shared and how smoothly members drive.'));
        sec.hidden = false;
      }).catch(() => {});
      return sec;
    }
    return { section };
  }

  const api = { lines, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewStandings = api;
})(typeof window !== 'undefined' ? window : globalThis);
