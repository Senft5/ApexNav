// The stage briefing: as a drive on a planned route starts, the co-driver says what the road holds, once, the way a
// rally co-driver reads the stage before the start: "12 miles, 48 corners, 3 hairpins." The corners are the route's pace
// notes. Short, and in whole miles or kilometres, so the pack says it from its own clips (voice_lines.js compose): the
// marks on the way (a stop, a rail crossing, gravel) are called when you reach them, not read out here. Nothing for a
// short or straight route: a briefing for three corners is chatter. Pure (tests/test_briefing.py).
(function (root) {
  'use strict';
  const MIN_M = 3000, MIN_CORNERS = 5;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * The briefing for track t ({ dist, events }) from the car at cursorM, or null. units: ApexUnits (its metric()), for
   * whole miles or kilometres.
   */
  function line(t, cursorM, units) {
    const d = t && t.dist;
    if (!Array.isArray(d) || d.length < 2) return null;
    const from = finite(cursorM) ? Math.max(0, cursorM) : 0, left = d[d.length - 1] - from;
    if (!(left >= MIN_M)) return null;
    const ahead = (e) => e && finite(e.dist_m) && e.dist_m > from;
    const corners = (Array.isArray(t.events) ? t.events : []).filter((e) => e.type === 'corner' && ahead(e));
    if (corners.length < MIN_CORNERS) return null;
    const hp = corners.filter((c) => c.severity === 'HP' || c.shape === 'hairpin').length;
    const metric = !!(units && typeof units.metric === 'function' && units.metric());
    const n = Math.round(left / (metric ? 1000 : 1609.344));
    const head = [`${n} ${metric ? 'kilometres' : 'miles'}`, `${corners.length} corners`];
    if (hp) head.push(hp === 1 ? '1 hairpin' : `${hp} hairpins`);
    return `${head.join(', ')}.`;
  }

  const api = { line, MIN_M, MIN_CORNERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBriefing = api;
})(typeof window !== 'undefined' ? window : globalThis);
