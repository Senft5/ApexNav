// This month's challenges (IDEAS S-11, personal part): goals that reward exploring and technique, never speed or time.
// From the drives on this phone with a known date. Crew-vs-crew needs the server and is not here yet.
// Pure (tests/test_challenges.py); the Log draws the bars.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const named = (d) => typeof d.name === 'string' && d.name && !/^Drive \d/.test(d.name);
  const GOALS = { roads: 5, smooth: 3, corners: 200 };
  const SMOOTH = 0.8;

  /**
   * drives: Log drives ({ name, date, dateKnown, ds: { corners, components: { smoothness } } }); month: 'YYYY-MM'.
   * → [{ id, title, done, goal, complete }]. A road is new when no earlier drive carried its name.
   */
  function progress(drives, month) {
    const dated = (drives || []).filter((d) => d && d.dateKnown !== false && typeof d.date === 'string');
    const mine = dated.filter((d) => d.date.startsWith(`${month}-`));
    const before = new Set(dated.filter((d) => d.date.slice(0, 7) < month && named(d)).map((d) => d.name.toLowerCase()));
    const roads = new Set(mine.filter(named).map((d) => d.name.toLowerCase()).filter((n) => !before.has(n))).size;
    const smooth = mine.filter((d) => d.ds && d.ds.components && finite(d.ds.components.smoothness) && d.ds.components.smoothness >= SMOOTH).length;
    const corners = mine.reduce((s, d) => s + (d.ds && finite(d.ds.corners) ? d.ds.corners : 0), 0);
    const row = (id, title, done) => ({ id, title, done: Math.min(done, GOALS[id]), goal: GOALS[id], complete: done >= GOALS[id] });
    return [
      row('roads', `Drive ${GOALS.roads} roads you haven't driven before`, roads),
      row('smooth', `${GOALS.smooth} drives with Smooth at ${Math.round(SMOOTH * 100)}% or more`, smooth),
      row('corners', `${GOALS.corners} scored corners`, corners),
    ];
  }

  const api = { progress, GOALS, SMOOTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexChallenges = api;
})(typeof window !== 'undefined' ? window : globalThis);
