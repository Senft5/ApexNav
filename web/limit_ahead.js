// Speed limit drops ahead, live: on the road you are following (a planned route or the road ahead, its posted limits per
// sample, cockpit.js track.limitMps from the tiles or the router), where the limit falls by 15 km/h (about 10 mph) or more
// and you are going faster than the new one, the co-driver says it before the sign, early enough to slow at an easy
// 1.5 m/s² plus 3 s: "Limit 35 ahead." Once per drop. A back road that runs into a town at 55 is where tickets are
// written, and the sign is easy to miss on the way out of a good corner. Unknown limits (null) are never a drop: a gap
// in the data says nothing. Pure (tests/test_limit_ahead.py).
(function (root) {
  'use strict';
  const DROP_MPS = 15 / 3.6, REACH_M = 900, EASY_MPS2 = 1.5, REACT_S = 3, OVER_MPS = 1.5, MIN_M = 40;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Index of the first sample at or past metre m on a track's cumulative distance, or -1. */
  function at(dist, m) {
    let lo = 0, hi = dist.length - 1;
    if (!(m <= dist[hi])) return -1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dist[mid] < m) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /**
   * The next drop on track t ({ dist, limitMps }) from the car at cursorM, or null: { atM, limitMps, fromMps } where the
   * known limit first falls 15 km/h or more below the one at the car, within 900 m. Null when the limit here is unknown.
   */
  function next(t, cursorM) {
    const L = t && t.limitMps, d = t && t.dist;
    if (!Array.isArray(d) || !L || L.length !== d.length || !finite(cursorM)) return null;
    const i = at(d, cursorM);
    if (i < 0 || !finite(L[i]) || L[i] <= 0) return null;
    const from = L[i];
    for (let j = i + 1; j < d.length && d[j] - cursorM <= REACH_M; j++) {
      const v = L[j];
      if (!finite(v) || v <= 0) continue;
      if (v <= from - DROP_MPS) return { atM: d[j], limitMps: v, fromMps: from };
    }
    return null;
  }

  /** Metres before the sign to say it at speed vMps: an easy slowing to the new limit, plus 3 s to hear and lift. */
  const callM = (vMps, limitMps) => vMps * REACT_S + Math.max(0, (vMps * vMps - limitMps * limitMps) / (2 * EASY_MPS2));

  /** Whether to say drop now: faster than the new limit, the sign 40 m or more ahead and within the call distance. */
  function due(drop, cursorM, vMps) {
    if (!drop || !finite(vMps) || !finite(cursorM) || vMps <= drop.limitMps + OVER_MPS) return false;
    const left = drop.atM - cursorM;
    return left >= MIN_M && left <= callM(vMps, drop.limitMps);
  }

  /** The line, in the driver's units (toUnits: m/s to mph or km/h), the limit to the nearest 5. */
  function text(limitMps, toUnits) {
    const n = Math.round(toUnits(limitMps) / 5) * 5;
    return n > 0 ? `Limit ${n} ahead.` : null;
  }

  const api = { next, due, callM, text, DROP_MPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexLimitAhead = api;
})(typeof window !== 'undefined' ? window : globalThis);
