// Flyby (IDEAS S-20): on a drive's page, the friends who drove the same stages that day. Built from friends' activity
// (GET /api/board/activity, the last 14 days of scores they chose to show you), so it is opt-in on their side and covers
// marked stages only, never where anyone drove between them. Unknown date: nothing. Pure (tests/test_flyby.py).
(function (root) {
  'use strict';
  /**
   * activity: rows { handle, canon_id, stage, driver_score, driven_on }; day: 'YYYY-MM-DD' (the drive's, as its scores are
   * posted) or null; canons: the stage ids this drive passed. → [{ stage, canon, people: [{ handle, score }] }], best first.
   */
  function flyby(activity, day, canons) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const want = new Set(canons || []), by = new Map();
    for (const r of activity || []) {
      if (!r || r.driven_on !== day || !want.has(r.canon_id) || !r.handle) continue;
      const g = by.get(r.canon_id) || { stage: r.stage || 'A stage', canon: r.canon_id, people: [] };
      const had = g.people.find((p) => p.handle === r.handle);
      if (had) had.score = Math.max(had.score ?? -Infinity, r.driver_score ?? -Infinity);
      else g.people.push({ handle: r.handle, score: Number.isFinite(r.driver_score) ? r.driver_score : null });
      by.set(r.canon_id, g);
    }
    return [...by.values()].map((g) => ({ ...g, people: g.people.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.handle.localeCompare(b.handle)) }))
      .sort((a, b) => b.people.length - a.people.length || a.stage.localeCompare(b.stage));
  }

  /** One line per stage: "Esses: @bob 812, @cara". */
  const lines = (groups) => groups.map((g) => `${g.stage}: ${g.people.map((p) => `@${p.handle}${p.score != null ? ` ${p.score}` : ''}`).join(', ')}`);

  const api = { flyby, lines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFlyby = api;
})(typeof window !== 'undefined' ? window : globalThis);
