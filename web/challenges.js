// This month's challenges (IDEAS S-11, personal part): goals that reward exploring and technique, never speed or time.
// From the drives on this phone with a known date, plus the km you were first to map this month (the server's count, when
// signed in with Road data on). Crew-vs-crew standings are in Crew (crew_standings.js).
// Pure (tests/test_challenges.py); the Log draws the bars.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const named = (d) => typeof d.name === 'string' && d.name && !/^Drive \d/.test(d.name);
  const GOALS = { roads: 5, smooth: 3, corners: 200, pioneer: 10 };   // pioneer: km
  const SMOOTH = 0.8;

  /**
   * drives: Log drives ({ name, date, dateKnown, ds: { corners, components: { smoothness } } }); month: 'YYYY-MM';
   * server: /api/points `month` ({ pioneer_km }) or null when unknown (signed out, offline: the row is left out, not zero).
   * → [{ id, title, done, goal, complete }]. A road is new when no earlier drive carried its name.
   */
  function progress(drives, month, server = null, fmtKm = (km) => `${km} km`) {
    const dated = (drives || []).filter((d) => d && d.dateKnown !== false && typeof d.date === 'string');
    const mine = dated.filter((d) => d.date.startsWith(`${month}-`));
    const before = new Set(dated.filter((d) => d.date.slice(0, 7) < month && named(d)).map((d) => d.name.toLowerCase()));
    const roads = new Set(mine.filter(named).map((d) => d.name.toLowerCase()).filter((n) => !before.has(n))).size;
    const smooth = mine.filter((d) => d.ds && d.ds.components && finite(d.ds.components.smoothness) && d.ds.components.smoothness >= SMOOTH).length;
    const corners = mine.reduce((s, d) => s + (d.ds && finite(d.ds.corners) ? d.ds.corners : 0), 0);
    const row = (id, title, done) => ({ id, title, done: Math.min(done, GOALS[id]), goal: GOALS[id], complete: done >= GOALS[id] });
    const out = [
      row('roads', `Drive ${GOALS.roads} roads you haven't driven before`, roads),
      row('smooth', `${GOALS.smooth} drives with Smooth at ${Math.round(SMOOTH * 100)}% or more`, smooth),
      row('corners', `${GOALS.corners} scored corners`, corners),
    ];
    if (server && finite(server.pioneer_km)) {
      const r = row('pioneer', `Be first to map ${fmtKm(GOALS.pioneer)} of road`, Math.round(server.pioneer_km * 10) / 10);
      out.push({ ...r, unit: 'km' });
    }
    return out;
  }

  const api = { progress, GOALS, SMOOTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexChallenges = api;
})(typeof window !== 'undefined' ? window : globalThis);
