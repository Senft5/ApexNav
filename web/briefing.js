// The stage briefing: as a drive on a planned route starts, the co-driver says what the road holds, once, the way a
// rally co-driver reads the stage before the start: "12 miles, 48 corners, 3 hairpins. Stop sign in 4.2 miles, unpaved
// road in 9 miles." The corners are the route's pace notes; the marks are the ones the map gave (road_marks.js), the
// two first that change how you drive (a stop, a rail crossing, a one-lane bridge, a ford, gravel, rough road). Nothing for a
// short or straight route: a briefing for three corners is chatter. Pure (tests/test_briefing.py).
(function (root) {
  'use strict';
  const MIN_M = 3000, MIN_CORNERS = 5, MARKS = 2;
  const WORTH = new Set(['stop', 'level_crossing', 'one_lane_bridge', 'ford', 'unpaved', 'rough']);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  /**
   * The briefing for track t ({ dist, events, marks }) from the car at cursorM, or null. spoken(m) says a distance in
   * the driver's units (units.js spokenShort).
   */
  function line(t, cursorM, spoken) {
    const d = t && t.dist;
    if (!Array.isArray(d) || d.length < 2 || typeof spoken !== 'function') return null;
    const say = (m) => String(spoken(m)).replace(/(\d)\.0\b/, '$1');   // "9 miles", not "9.0 miles"
    const from = finite(cursorM) ? Math.max(0, cursorM) : 0, left = d[d.length - 1] - from;
    if (!(left >= MIN_M)) return null;
    const ahead = (e) => e && finite(e.dist_m) && e.dist_m > from;
    const corners = (Array.isArray(t.events) ? t.events : []).filter((e) => e.type === 'corner' && ahead(e));
    if (corners.length < MIN_CORNERS) return null;
    const hp = corners.filter((c) => c.severity === 'HP' || c.shape === 'hairpin').length;
    const head = [say(left), `${corners.length} corners`];
    if (hp) head.push(hp === 1 ? '1 hairpin' : `${hp} hairpins`);
    const marks = (Array.isArray(t.marks) ? t.marks : []).filter((m) => ahead(m) && WORTH.has(m.kind) && typeof m.call === 'string')
      .sort((a, b) => a.dist_m - b.dist_m).slice(0, MARKS);
    const tail = marks.map((m, i) => `${i ? lower(m.call) : m.call} in ${say(m.dist_m - from)}`);
    return `${head.join(', ')}.${tail.length ? ` ${tail.join(', ')}.` : ''}`;
  }

  const api = { line, MIN_M, MIN_CORNERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBriefing = api;
})(typeof window !== 'undefined' ? window : globalThis);
