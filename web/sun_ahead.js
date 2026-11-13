// Low sun ahead, live (IDEAS R-13 on the road, not only on the plan): a low sun straight ahead blinds you, and on a
// winding road it swings into view after a bend, where you can't squint at it in advance. On the road you are following
// (a planned route or the road ahead), when a stretch of 150 m or more beyond the call distance points into a sun 0-15°
// up (within 20° of your way, the plan's glare rule, fun_route.js glare), and the road under you doesn't already, the
// co-driver says it once: "Sun in your eyes ahead." At most one call every 5 minutes, since a winding road at sunset
// swings in and out of the sun all the time. A known overcast or wet sky (the place plate's weather) hides the sun, so
// no call; unknown weather still calls (a needless "sun ahead" costs less than a blind corner). Trees and hills that
// shade the road are not known, so this is a warning of where the sun could be, never a claim it is there.
// Pure (tests/test_sun_ahead.py); trigonometry in radians.
(function (root) {
  'use strict';
  const MAX_ALT = 15 * Math.PI / 180, HALF_ANGLE = 20 * Math.PI / 180, NOW_ANGLE = 30 * Math.PI / 180;
  const STEP_M = 25, MIN_RUN_M = 150, FROM_M = 120, REACH_M = 900, GAP_S = 300;
  const TEXT = 'Sun in your eyes ahead.';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Index of the first sample at or past metre m on a track's cumulative distance (binary search), or -1. */
  function at(dist, m) {
    let lo = 0, hi = dist.length - 1;
    if (!(m <= dist[hi])) return -1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dist[mid] < m) lo = mid + 1; else hi = mid; }
    return lo;
  }
  /** Heading (radians clockwise from north) of the track between metres a and b, or null. */
  function headingBetween(t, a, b) {
    const i = at(t.dist, a), j = at(t.dist, b);
    if (i < 0 || j < 0 || j <= i) return null;
    const kx = Math.cos(t.lat[i] * Math.PI / 180);
    return Math.atan2((t.lon[j] - t.lon[i]) * kx, t.lat[j] - t.lat[i]);
  }
  const off = (h, az) => Math.abs(Math.atan2(Math.sin(h - az), Math.cos(h - az)));

  /** Whether the sky hides the sun, from the place plate's data: an overcast code or falling or wet weather. */
  function hidden(word, code) {
    if (code === 3) return true;                                     // WMO 3: overcast
    return !!word && word !== 'Dry';
  }

  /**
   * The next stretch into a low sun on track t ({lat, lon, dist}) from the car at cursorM, at `date`, or null:
   * { start_m, end_m } of the first 150 m+ run between cursorM + FROM_M and cursorM + REACH_M whose heading is within
   * 20° of a sun 0-15° up. Null too when the road under the car already points within 30° of the sun (the driver sees
   * it) or the sun is not low.
   */
  function ahead(t, cursorM, date, sun = root.ApexSun) {
    if (!t || !Array.isArray(t.dist) || t.dist.length < 2 || !finite(cursorM) || !sun || !(date instanceof Date)) return null;
    const i = at(t.dist, cursorM);
    if (i < 0) return null;
    const p = sun.sunPosition(date, t.lat[i], t.lon[i]);
    if (!(p.altitude > 0 && p.altitude <= MAX_ALT)) return null;
    const now = headingBetween(t, cursorM, cursorM + 60);
    if (now === null || off(now, p.azimuth) < NOW_ANGLE) return null;
    let runStart = null;
    for (let m = cursorM + FROM_M; m + STEP_M <= cursorM + REACH_M; m += STEP_M) {
      const h = headingBetween(t, m, m + STEP_M);
      if (h === null) break;
      if (off(h, p.azimuth) < HALF_ANGLE) {
        if (runStart === null) runStart = m;
        if (m + STEP_M - runStart >= MIN_RUN_M) return { start_m: runStart, end_m: m + STEP_M };
      } else runStart = null;
    }
    return null;
  }

  /** Whether to say it now: not said in the last GAP_S seconds (lastS: seconds of the last call, or null). */
  const due = (nowS, lastS) => lastS === null || !finite(lastS) || nowS - lastS >= GAP_S;

  const api = { ahead, hidden, due, TEXT, GAP_S, MIN_RUN_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSunAhead = api;
})(typeof window !== 'undefined' ? window : globalThis);
