// Corners ahead: on a planned route, after a long stretch with no corners (a transit, a town), the co-driver says when
// the good part starts again, about 30 s out: "Twisty section in half a mile. 3.2 miles, 18 corners." A rally co-driver
// does the same at the end of a road section. The section is the route's own pace notes: corners no more than 500 m
// apart, 6 or more of them over 1 km or more, after 2 km or more without a corner. Never at the start of the route (the
// stage briefing has it). Pure (tests/test_corners_ahead.py).
(function (root) {
  'use strict';
  const GAP_M = 500, MIN_CORNERS = 6, MIN_LEN_M = 1000, QUIET_M = 2000, LEAD_S = 30, MIN_LEAD_M = 400, LATE_M = 200;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const startOf = (c) => (finite(c.start_m) ? c.start_m : c.dist_m);

  /** The route's twisty sections after a quiet stretch: [{ startM, endM, corners }], in order. */
  function sections(events) {
    const cs = (Array.isArray(events) ? events : []).filter((e) => e && e.type === 'corner' && finite(e.dist_m))
      .sort((a, b) => a.dist_m - b.dist_m);
    const runs = [];
    for (const c of cs) {
      const last = runs.length && runs[runs.length - 1];
      if (last && c.dist_m - last[last.length - 1].dist_m <= GAP_M) last.push(c); else runs.push([c]);
    }
    const out = [];
    runs.forEach((run, k) => {
      const before = k ? runs[k - 1][runs[k - 1].length - 1].dist_m : 0, s = startOf(run[0]), e = run[run.length - 1].dist_m;
      if (run.length >= MIN_CORNERS && e - s >= MIN_LEN_M && s - before >= QUIET_M) out.push({ startM: s, endM: e, corners: run.length });
    });
    return out;
  }

  /** The next section not yet said, at the car or ahead of it, or null. */
  function next(list, cursorM, said) {
    if (!Array.isArray(list) || !finite(cursorM)) return null;
    return list.find((s) => s.startM > cursorM && !(said && said.has(s.startM))) || null;
  }

  /** Whether to say it now at vMps: 30 s out (400 m at least), and not once it is closer than 200 m. */
  function due(s, cursorM, vMps) {
    if (!s || !finite(cursorM) || !finite(vMps) || vMps < 5) return false;
    const left = s.startM - cursorM;
    return left >= LATE_M && left <= Math.max(MIN_LEAD_M, vMps * LEAD_S);
  }

  /** The line; spoken(m) says a distance in the driver's units (units.js spokenShort). */
  function text(s, cursorM, spoken) {
    const say = (m) => String(spoken(m)).replace(/(\d)\.0\b/, '$1');
    return `Twisty section in ${say(s.startM - cursorM)}. ${say(s.endM - s.startM)}, ${s.corners} corners.`;
  }

  const api = { sections, next, due, text, QUIET_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCornersAhead = api;
})(typeof window !== 'undefined' ? window : globalThis);
