// Corners ahead: on a planned route, after a long stretch with no corners (a transit, a town), the co-driver says when
// the good part starts again, about 30 s out: "Twisty section in half a mile. 3.2 miles, 18 corners." A rally co-driver
// does the same at the end of a road section. The section is the route's own pace notes: corners no more than 500 m
// apart, 6 or more of them over 1 km or more, after 2 km or more without a corner. Never at the start of the route (the
// stage briefing has it). On a free drive too, from the road ahead and how far the car has driven since its last corner
// (ahead, tracker). Pure (tests/test_corners_ahead.py).
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

  /**
   * On a free drive (no route) the road ahead is the horizon (horizon.js, ~2.5 km from the car), so what lies behind is
   * not on it: quietM is how far the car has driven since its last corner (tracker below). The first twisty section ahead
   * of cursorM on events that comes after 2 km or more without a corner, counting quietM, or null: { startM, endM,
   * corners, open }. open: the section runs on past the end of the road ahead (endM), so its corners are not all known.
   */
  function ahead(events, cursorM, quietM, endM) {
    if (!finite(cursorM) || !finite(quietM) || !finite(endM)) return null;
    const cs = (Array.isArray(events) ? events : []).filter((e) => e && e.type === 'corner' && finite(e.dist_m) && e.dist_m > cursorM)
      .sort((a, b) => a.dist_m - b.dist_m);
    let run = [], before = cursorM - quietM;
    const check = () => {
      if (!run.length) return null;
      const s = startOf(run[0]), e = run[run.length - 1].dist_m;
      if (run.length >= MIN_CORNERS && e - s >= MIN_LEN_M && s - before >= QUIET_M) return { startM: s, endM: e, corners: run.length, open: endM - e < GAP_M };
      before = e; run = [];
      return null;
    };
    for (const c of cs) {
      if (run.length && c.dist_m - run[run.length - 1].dist_m > GAP_M) { const got = check(); if (got) return got; }
      run.push(c);
    }
    return check();
  }

  /** How far the car has driven since it passed a corner, across the road ahead's rebuilds: update(t, cursorM) -> metres. */
  function tracker() {
    let odo = 0, ref = null, last = 0;
    return {
      update(t, cursorM) {
        if (!t || !finite(cursorM)) return null;
        if (ref && ref.t === t && cursorM > ref.m) odo += cursorM - ref.m;   // a new road ahead starts at the car: nothing to add
        ref = { t, m: cursorM };
        for (const e of Array.isArray(t.events) ? t.events : []) {
          if (e && e.type === 'corner' && finite(e.dist_m) && e.dist_m <= cursorM) last = Math.max(last, odo - (cursorM - e.dist_m));
        }
        return odo - last;
      },
    };
  }

  /** The line: short, and in the pack's own clips (voice_lines.js compose); the section's start is about 30 s out. */
  function text(s) {
    return s.open ? 'Twisty section ahead.' : `Twisty section ahead. ${s.corners} corners.`;   // open: the count is not known
  }

  const api = { sections, next, due, text, ahead, tracker, QUIET_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCornersAhead = api;
})(typeof window !== 'undefined' ? window : globalThis);
