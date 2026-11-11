// Live time left and arrival (WORKER_QUEUE eta-1). Pure: the page feeds one update() per GPS fix on the route.
// - The router's own time for the part ahead (`routerLeft`): from its maneuver times placed along the track when the
//   router gave them (`marks`, cumulative seconds at track metres), else its total time spread evenly over the distance.
// - Scaled by your pace so far on this route, learned per section class (U-108): "corner" sections (runs of called
//   corners, `cornerSections`) and the open road between them, so a fast interstate join does not reprice the twisties.
//   A class's pace counts only once there is enough of it (2 min and 1 router-minute), is bounded to 0.85-1.25 and
//   follows its evidence slowly (TAU_S). A new route (reroute) starts the pace over.
// - The arrival moves at most one minute per minute driven (RATE), so it never walks back eight minutes in three miles;
//   and while under five miles of evidence the time left is said roughly ("about 30 min left", `leftText`).
// No traffic data goes into this: never call it "with traffic". Unknown stays unknown (null).
(function (root) {
  'use strict';
  const MIN_ELAPSED_MS = 120000, MIN_ROUTER_S = 60, PACE_MIN = 0.85, PACE_MAX = 1.25, TAU_S = 180, RATE = 1,
    ROUGH_EVIDENCE_M = 8046.72, ROUGH_MIN_LEFT_S = 600, ROUND_S = 300, SECTION_GAP_M = 500, SECTION_PAD_M = 100;
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

  /**
   * Corner sections of a route, [[startM, endM], ...] in order: runs of two or more called corners (events with
   * type 'corner' and start_m/end_m) no more than SECTION_GAP_M apart, padded by SECTION_PAD_M. A lone corner on an open
   * road (a ramp) stays open road.
   */
  function cornerSections(events) {
    const cs = (Array.isArray(events) ? events : []).filter(e => e && e.type === 'corner' && finite(e.start_m) && finite(e.end_m))
      .map(e => [Math.min(e.start_m, e.end_m), Math.max(e.start_m, e.end_m)]).sort((x, y) => x[0] - y[0]);
    const out = [];
    let run = null;
    for (const [a, b] of cs) {
      if (run && a - run.b <= SECTION_GAP_M) { run.b = Math.max(run.b, b); run.n++; continue; }
      if (run && run.n >= 2) out.push([run.a - SECTION_PAD_M, run.b + SECTION_PAD_M]);
      run = { a, b, n: 1 };
    }
    if (run && run.n >= 2) out.push([run.a - SECTION_PAD_M, run.b + SECTION_PAD_M]);
    return out;
  }
  const inSection = (m, sections) => (sections || []).some(([a, b]) => m >= a && m <= b);

  /**
   * The live forecast on the current route (U-108). update({ t, atM, totalM, timeS, marks, sections }) once per fix on
   * the route: t in ms, atM metres along it. Returns { leftS, arriveAt, rough } or null when the router's time is unknown.
   */
  function createEta() {
    let last = null, startM = null, shown = null;
    const cls = () => ({ realS: 0, routerS: 0, factor: 1 });
    let pace = { open: cls(), corner: cls() };
    return {
      reset() { last = null; startM = null; shown = null; pace = { open: cls(), corner: cls() }; },
      update(o) {
        const { t, atM, totalM, timeS, marks } = o || {}, sections = (o && o.sections) || [];
        const left = routerLeft(atM, totalM, timeS, marks);
        if (left == null || !finite(t)) return null;
        const at = Math.max(0, Math.min(totalM, atM)), secAt = (m) => timeS - routerLeft(m, totalM, timeS, marks);
        if (startM == null) startM = at;
        // learn: the real and router seconds since the last fix go to the class of the road the car was on
        if (last && t > last.t && at >= last.at) {
          const realS = (t - last.t) / 1000, routerS = secAt(at) - secAt(last.at);
          const c = pace[inSection((at + last.at) / 2, sections) ? 'corner' : 'open'];
          c.realS += realS; c.routerS += routerS;
          if (c.realS * 1000 >= MIN_ELAPSED_MS && c.routerS >= MIN_ROUTER_S) {
            const raw = Math.max(PACE_MIN, Math.min(PACE_MAX, c.realS / c.routerS));
            c.factor += (raw - c.factor) * Math.min(1, realS / TAU_S);
          }
        }
        if (!last || t > last.t) last = { t, at };
        // the router's time ahead, split by class, each at its own pace
        let cornerLeft = 0;
        for (const [a, b] of sections) {
          const lo = Math.max(a, at), hi = Math.min(b, totalM);
          if (hi > lo) cornerLeft += secAt(hi) - secAt(lo);
        }
        cornerLeft = Math.max(0, Math.min(left, cornerLeft));
        const raw = t + ((left - cornerLeft) * pace.open.factor + cornerLeft * pace.corner.factor) * 1000;
        if (shown == null || left <= 0) shown = { arriveAt: raw, t };
        else if (t > shown.t) {
          const step = (t - shown.t) * RATE;   // at most a minute per minute driven, either way
          shown = { arriveAt: shown.arriveAt + Math.max(-step, Math.min(step, raw - shown.arriveAt)), t };
        }
        if (shown.arriveAt < t) shown.arriveAt = t;
        const leftS = (shown.arriveAt - t) / 1000;
        return { leftS, arriveAt: shown.arriveAt, rough: at - startM < ROUGH_EVIDENCE_M && leftS > ROUGH_MIN_LEFT_S };
      },
      get factors() { return { open: pace.open.factor, corner: pace.corner.factor }; },
    };
  }

  /** The status line's time left: "12 min left", "<1 min left", or to 5 min while rough ("about 30 min left"). */
  function leftText(leftS, rough) {
    if (!finite(leftS)) return '';
    if (leftS < 60) return '<1 min left';
    if (rough && leftS > ROUGH_MIN_LEFT_S) return `about ${Math.max(1, Math.round(leftS / ROUND_S)) * ROUND_S / 60} min left`;
    return `${Math.round(leftS / 60)} min left`;
  }

  // "Home by" on a loop (IDEAS R-37): offer the way home when the live arrival is more than LATE_GRACE_MS past the time the
  // driver set, once, and again only after REOFFER_MS if still late. `offeredAt` is when it was last offered (or null).
  const LATE_GRACE_MS = 5 * 60000, REOFFER_MS = 10 * 60000;
  function homeByOffer(arriveAt, homeBy, offeredAt, now) {
    if (!Number.isFinite(arriveAt) || !Number.isFinite(homeBy) || arriveAt - homeBy <= LATE_GRACE_MS) return null;
    if (Number.isFinite(offeredAt) && now - offeredAt < REOFFER_MS) return null;
    return { lateMin: Math.round((arriveAt - homeBy) / 60000) };
  }
  /**
   * What a late loop offers (IDEAS R-37): skip the next stage not yet begun (at least 300 m on: there's time to take the
   * other way), else head home. spans: the route's stages along it ({ name, startM, endM }), atM: where you are on it.
   * { kind: 'skip', span, label } or { kind: 'home', label }.
   */
  function homeByAction(spans, atM) {
    const at = Number.isFinite(atM) ? atM : 0;
    const span = (spans || []).find((s) => s && Number.isFinite(s.startM) && s.startM >= at + 300);
    return span ? { kind: 'skip', span, label: span.name ? `Skip ${span.name}` : 'Skip the next stage' } : { kind: 'home', label: 'Head home' };
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
  // router's, never road data and never "with traffic". The live pace then scales it like any router time. `marks` every
  // MARK_M metres place the slow miles where they are (routerLeft). Returns { timeS, marks } or null when the track can't
  // be timed.
  // U-97: the first version (0.92 of the envelope, capped at the limit or 60 mph) said 25 min for 23 miles of Dry Ridge Rd
  // and was about 20% short on the recorded drive (web/data/dry_ridge.js: 36.8 min forecast against the 46.0 min it took). The
  // envelope is a limit, not a pace: the recording's bins sit at 0.6 to 0.8 of it through the bends, and on roads with no
  // posted limit the speed levels off near 38 mph whatever the envelope says, with junctions and stops on top. Fitted to
  // that drive (45.5 min; tests/test_envelope_time.py pins it within 3%): ENVELOPE_SHARE of the envelope, capped by
  // - a posted limit of OPEN_LIMIT_MPS or more (a highway): the limit;
  // - a lower posted limit (town): TOWN_SHARE of it at 35 mph rising to all of it at OPEN_LIMIT_MPS (lights, turns);
  // - no posted limit on a route whose limits were looked up (limitMps an array, the entry null): UNPOSTED_MPS, a minor road;
  // - limits never looked up (limitMps not an array: offline, or not yet back): UNKNOWN_MPS, between the two.
  // Never under FLOOR_MPS.
  const ENVELOPE_SHARE = 0.8, OPEN_LIMIT_MPS = 24, TOWN_LIMIT_MPS = 15.65, TOWN_SHARE = 0.65, UNPOSTED_MPS = 14, UNKNOWN_MPS = 22,
    FLOOR_MPS = 4, MARK_M = 250;
  function limitCap(limit) {
    if (limit >= OPEN_LIMIT_MPS) return limit;
    const k = Math.max(0, Math.min(1, (limit - TOWN_LIMIT_MPS) / (OPEN_LIMIT_MPS - TOWN_LIMIT_MPS)));
    return limit * (TOWN_SHARE + (1 - TOWN_SHARE) * k);
  }
  function envelopeTime(dist, envMps, limitMps) {
    if (!Array.isArray(dist) || dist.length < 2 || !Array.isArray(envMps) || envMps.length !== dist.length) return null;
    const total = dist[dist.length - 1];
    if (!finite(total) || !(total > 0)) return null;
    const looked = Array.isArray(limitMps) && limitMps.length === dist.length;
    const vAt = (i) => {
      const cap = looked && finite(limitMps[i]) && limitMps[i] > 0 ? limitCap(limitMps[i]) : looked ? UNPOSTED_MPS : UNKNOWN_MPS;
      const env = finite(envMps[i]) && envMps[i] >= 0 ? envMps[i] * ENVELOPE_SHARE : cap;
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

  const api = { routerLeft, cornerSections, createEta, leftText, homeByOffer, homeByAction, homeByAt, envelopeTime, PACE_MIN, PACE_MAX, LATE_GRACE_MS };
  api.ENVELOPE = { ENVELOPE_SHARE, OPEN_LIMIT_MPS, TOWN_SHARE, UNPOSTED_MPS, UNKNOWN_MPS, FLOOR_MPS };   // U-97 (tests)
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEta = api;
})(typeof window !== 'undefined' ? window : globalThis);
