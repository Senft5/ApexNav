// Live time left and arrival (WORKER_QUEUE eta-1). Pure: the page feeds one update() per GPS fix on the route.
// - The router's own time for the part ahead (`routerLeft`): from its maneuver times placed along the track when the
//   router gave them (`marks`, cumulative seconds at track metres), else its total time spread evenly over the distance.
// - Scaled by your pace so far on this route: real seconds over router seconds for the part already driven, only once
//   there is enough of it (2 min and 1 router-minute), bounded to 0.6–1.8 and smoothed, so a red light or one fast
//   straight doesn't swing it. A new route (reroute) starts the pace over.
// No traffic data goes into this: never call it "with traffic". Unknown stays unknown (null).
(function (root) {
  'use strict';
  const MIN_ELAPSED_MS = 120000, MIN_ROUTER_S = 60, PACE_MIN = 0.6, PACE_MAX = 1.8, SMOOTH = 0.1;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Router seconds left from `m` metres along a route of `totalM` that the router timed at `timeS`; null when unknown. */
  function routerLeft(m, totalM, timeS, marks) {
    if (!finite(m) || !finite(totalM) || !(totalM > 0) || !finite(timeS) || !(timeS >= 0)) return null;
    const d = Math.max(0, Math.min(totalM, m));
    // [metres, cumulative seconds], from the start (0, 0) to the end (totalM, timeS), kept increasing in both.
    const pts = [[0, 0]];
    for (const [pm, ps] of Array.isArray(marks) ? marks : []) {
      const [lm, ls] = pts[pts.length - 1];
      if (finite(pm) && finite(ps) && pm > lm && pm < totalM && ps >= ls && ps <= timeS) pts.push([pm, ps]);
    }
    pts.push([totalM, timeS]);
    for (let i = 1; i < pts.length; i++) {
      const [m0, s0] = pts[i - 1], [m1, s1] = pts[i];
      if (d <= m1) return timeS - (s0 + (s1 - s0) * (d - m0) / (m1 - m0));
    }
    return 0;
  }

  /** Pace on the current route: real time over router time since the first fix on it. */
  function createPace() {
    let start = null, factor = 1;
    return {
      reset() { start = null; factor = 1; },
      /** One fix on the route: t in ms, leftS = router seconds left from here. Returns the pace factor (1 until known). */
      update(t, leftS) {
        if (!finite(t) || !finite(leftS)) return factor;
        if (!start) { start = { t, leftS }; return factor; }
        const elapsedMs = t - start.t, routerS = start.leftS - leftS;
        if (elapsedMs >= MIN_ELAPSED_MS && routerS >= MIN_ROUTER_S) {
          const raw = Math.max(PACE_MIN, Math.min(PACE_MAX, elapsedMs / 1000 / routerS));
          factor += (raw - factor) * SMOOTH;
        }
        return factor;
      },
      get factor() { return factor; },
    };
  }

  /** Seconds left at this pace, and the arrival time (ms) from `now`; null when the router's time is unknown. */
  function estimate(leftS, pace, now) {
    if (!finite(leftS) || !finite(pace) || !finite(now)) return null;
    const s = Math.max(0, leftS * pace);
    return { leftS: s, arriveAt: now + s * 1000 };
  }

  // "Home by" on a loop (IDEAS R-37): offer the way home when the live arrival is more than LATE_GRACE_MS past the time the
  // driver set, once, and again only after REOFFER_MS if still late. `offeredAt` is when it was last offered (or null).
  const LATE_GRACE_MS = 5 * 60000, REOFFER_MS = 10 * 60000;
  function homeByOffer(arriveAt, homeBy, offeredAt, now) {
    if (!Number.isFinite(arriveAt) || !Number.isFinite(homeBy) || arriveAt - homeBy <= LATE_GRACE_MS) return null;
    if (Number.isFinite(offeredAt) && now - offeredAt < REOFFER_MS) return null;
    return { lateMin: Math.round((arriveAt - homeBy) / 60000) };
  }
  /** The next time `hh:mm` happens after `now` (a "home by 6:00" set at 7 PM means tomorrow's 6 AM is not meant: today). */
  function homeByAt(hhmm, now = Date.now()) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() < now - 3600_000) d.setDate(d.getDate() + 1);   // an hour or more ago: the driver means tomorrow
    return d.getTime();
  }

  // U-64: a route the router never timed (a GPX track, a loop or restore without one) gets a time from its own speed
  // envelope, so the route bar, the card, the car's trip strip and the live ETA all have one. It is a forecast like the
  // router's, never road data and never "with traffic": each 5 m sample at the envelope's speed (the same 0.92 of it the
  // replay drives at), capped by the posted limit where known and NO_LIMIT_MPS where not (the replay's 27 m/s, about
  // 60 mph), never under FLOOR_MPS. The live pace then scales it like any router time. `marks` every MARK_M metres place
  // the slow miles where they are (routerLeft). Returns { timeS, marks } or null when the track can't be timed.
  const ENVELOPE_SHARE = 0.92, NO_LIMIT_MPS = 27, FLOOR_MPS = 4, MARK_M = 250;
  function envelopeTime(dist, envMps, limitMps) {
    if (!Array.isArray(dist) || dist.length < 2 || !Array.isArray(envMps) || envMps.length !== dist.length) return null;
    const total = dist[dist.length - 1];
    if (!finite(total) || !(total > 0)) return null;
    const vAt = (i) => {
      const env = finite(envMps[i]) && envMps[i] >= 0 ? envMps[i] * ENVELOPE_SHARE : NO_LIMIT_MPS;
      const cap = Array.isArray(limitMps) && finite(limitMps[i]) && limitMps[i] > 0 ? limitMps[i] : NO_LIMIT_MPS;
      return Math.max(FLOOR_MPS, Math.min(env, cap));
    };
    const marks = [];
    let s = 0, next = MARK_M;
    for (let i = 1; i < dist.length; i++) {
      const ds = dist[i] - dist[i - 1];
      if (!finite(ds) || ds < 0) return null;
      s += ds * 2 / (vAt(i - 1) + vAt(i));
      if (dist[i] >= next && dist[i] < total) { marks.push([dist[i], s]); next = dist[i] + MARK_M; }
    }
    return { timeS: s, marks };
  }

  const api = { routerLeft, createPace, estimate, homeByOffer, homeByAt, envelopeTime, PACE_MIN, PACE_MAX, LATE_GRACE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEta = api;
})(typeof window !== 'undefined' ? window : globalThis);
