// ApexFlow: the longest run of corners in a row driven smooth and settled on one drive. The port of core/flow.py (read
// that file for the rule; tests/test_flow.py holds the two to one sequence). It uses the Driver Score's own judgement of
// each corner (apex_core.js cornerTechnique), so it never disagrees with the Score. How the corners felt, never speed.
(function (root) {
  'use strict';
  const SMOOTH_MIN = 0.60, BRAKE_MIN = 0.90, USE_MAX = 1.0, GAP_M = 2000.0, MIN_RUN = 5, SEG_M = 5.0;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Is this cornerTechnique result smooth, settled and inside the limit? */
  const inFlow = (t) => !!t && t.smooth >= SMOOTH_MIN && t.brake >= BRAKE_MIN && t.use <= USE_MAX;

  /** The longest run: { corners, start_m, end_m }, or null when no run reaches MIN_RUN. Core = ApexCore. */
  function longest(Core, v, lonG, latG, corners, dist = null) {
    const n = v ? v.length : 0;
    const at = dist ? (i) => dist[i] : (i) => i * SEG_M;
    const num = (a) => Array.from(a, (x) => (finite(x) ? x : NaN));
    const V = num(v || []), LO = num(lonG || []), LA = num(latG || []);
    const order = (corners || []).filter((c) => c && 0 <= c.start && c.start <= c.apex && c.apex <= c.end && c.end < n).slice().sort((a, b) => a.apex - b.apex);
    let best = null, run = [], last = null;
    for (const c of order) {
      const ok = inFlow(Core.cornerTechnique(V, LO, LA, c));
      if (!ok || (last && at(c.apex) - at(last.apex) > GAP_M)) run = [];
      if (ok) {
        run.push(c);
        if (run.length >= MIN_RUN && (!best || run.length > best.corners)) best = { corners: run.length, start_m: at(run[0].start), end_m: at(run[run.length - 1].end) };
      }
      last = c;
    }
    return best && finite(best.start_m) && finite(best.end_m) ? best : null;
  }

  /** The drive page's line, or null. fmtDist(m) gives a distance in the driver's units. */
  function text(r, fmtDist) {
    if (!r || !(r.corners >= MIN_RUN)) return null;
    const over = typeof fmtDist === 'function' && r.end_m > r.start_m ? ` over ${fmtDist(r.end_m - r.start_m)}` : '';
    return `Your best run: ${r.corners} corners in a row, smooth and settled${over}.`;
  }

  const api = { longest, text, inFlow, MIN_RUN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
