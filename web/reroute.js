// Off-route detection for live mode. Pure: one update() per GPS fix, no timers, no I/O; the page
// does the routing and reports back with routeChanged() / requestFailed(). Rules:
//   - off route when farther than max(40 m, 2 x GPS accuracy) for 5 s in a row while moving > 2 m/s
//     (GPS jitter at a corner and a parked car's drift never count);
//   - also off route when progress along the route stays 100 m below its best for 5 s (driving it backwards);
//   - back on route under 25 m (and, for wrong way, once progress is back within 100 m of its best on 3 fixes in a row);
//   - one reroute request per off-route episode, at least 20 s after the previous request; a failed
//     request is retried after 20 / 40 / 80 s, capped at 2 min, until a new route arrives.
// A missing fix (no GPS) breaks the 5 s run: losing signal in a tunnel is not a turn-off.
(function (root) {
  const OFF_MIN_M = 40, OFF_ACCURACY_X = 2, OFF_HOLD_MS = 5000, MOVING_MPS = 2;
  const BACK_ON_M = 25, WRONG_WAY_M = 100, BACK_ON_FIXES = 3;
  const COOLDOWN_MS = 20000, BACKOFF_MS = [20000, 40000, 80000], BACKOFF_CAP_MS = 120000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  class RerouteMonitor {
    constructor() {
      this.lastRequestT = null;   // survives new routes: the cooldown is between requests
      this.failures = 0;          // survives episodes until a reroute succeeds, so offline stays backed off
      this.retryAt = null;
      this.routeChanged();
    }

    /** A new route is on screen (a reroute arrived, or the driver planned one): start fresh. */
    routeChanged() {
      this.off = false; this.reason = null; this.farSince = null; this.best = null; this.pending = false;
      this.failures = 0; this.retryAt = null; this.backSince = 0; this.wrongSince = null;
    }

    /** The reroute request made after update() said `request` failed at time t (ms). */
    requestFailed(t) {
      this.pending = false;
      this.failures += 1;
      this.retryAt = t + Math.min(BACKOFF_CAP_MS, BACKOFF_MS[this.failures - 1] || BACKOFF_CAP_MS);
    }

    /**
     * One fix: { t (ms), distToRouteM, accuracyM, speedMps, progressM }.
     * Returns { off, reason ('distance' | 'wrong_way' | null), request, backOn }.
     */
    update(f) {
      const res = (request = false, backOn = false) => ({ off: this.off, reason: this.reason, request, backOn });
      if (!f || !finite(f.t) || !finite(f.distToRouteM)) { this.farSince = null; this.wrongSince = null; return res(); }
      const moving = finite(f.speedMps) && f.speedMps > MOVING_MPS;
      const progress = finite(f.progressM) ? f.progressM : null;

      if (this.off) {
        const back = f.distToRouteM < BACK_ON_M &&
          (this.reason !== 'wrong_way' || (progress != null && progress >= this.best - WRONG_WAY_M));
        // U-90: a wrong-way episode ends on three good fixes in a row, not one, so a single fix matched to the right pass
        // of a road the route uses twice can never flip it (the review drive: "Back on route" 140 times in 36 s).
        this.backSince = back ? this.backSince + 1 : 0;
        if (back && (this.reason !== 'wrong_way' || this.backSince >= BACK_ON_FIXES)) {
          this.off = false; this.reason = null; this.farSince = null; this.pending = false; this.backSince = 0; this.wrongSince = null;
          this.best = progress;       // a rejoin further back is not driving backwards
          return res(false, true);
        }
        return res(this.wantRequest(f.t));
      }

      const far = moving && f.distToRouteM > Math.max(OFF_MIN_M, OFF_ACCURACY_X * (finite(f.accuracyM) ? f.accuracyM : 0));
      if (!far) this.farSince = null;
      else if (this.farSince == null) this.farSince = f.t;

      // U-90: driving backwards must hold for OFF_HOLD_MS like a turn-off does; one fix matched to an earlier pass is not it.
      // A fix that is not behind (or not on the route, or not moving) breaks the run, as a missing fix breaks the far run.
      const behind = moving && progress != null && this.best != null && progress <= this.best - WRONG_WAY_M;
      if (!behind) this.wrongSince = null;
      else if (this.wrongSince == null) this.wrongSince = f.t;
      let reason = null;
      if (this.farSince != null && f.t - this.farSince >= OFF_HOLD_MS) reason = 'distance';
      else if (this.wrongSince != null && f.t - this.wrongSince >= OFF_HOLD_MS) reason = 'wrong_way';
      if (!reason) {
        if (progress != null && f.distToRouteM < BACK_ON_M && (this.best == null || progress > this.best)) this.best = progress;
        return res();
      }
      this.off = true; this.reason = reason; this.backSince = 0;
      return res(this.wantRequest(f.t));
    }

    wantRequest(t) {
      if (this.pending) return false;
      if (this.lastRequestT != null && t < this.lastRequestT + COOLDOWN_MS) return false;
      if (this.retryAt != null && t < this.retryAt) return false;
      this.pending = true; this.lastRequestT = t; this.retryAt = null;
      return true;
    }
  }

  // Where on the route the car is (U-90). A route can use the same road twice: an out-and-back, a loop that crosses itself,
  // a GPX of a drive that doubled back, a lap driven twice. The nearest point alone then picks either pass by GPS noise,
  // progress jumps by the length of the doubled stretch, and the co-driver reads the wrong pass ("Wrong way" for seven
  // minutes on the review drive, the arrow on the route). So, of the route's points within MATCH_M of the fix:
  //   1. moving with a heading, only the points whose direction agrees with it (within 90 deg), when any does;
  //   2. then the nearest, with each metre of progress away from the progress so far (anchorM) counting MATCH_PROGRESS_W
  //      of a metre: the pass consistent with where the car was wins, and the cursor still sits on the nearest point of it.
  // With no point within MATCH_M it is the plain nearest point (the distance is what off-route detection needs).
  // route: { lat, lon, dist } arrays; opts: { anchorM, headingDeg, speedMps }. Returns { index, distM }.
  const MATCH_M = 40, MATCH_PROGRESS_W = 0.05, HEADING_MPS = 3, HEADING_AGREE_DEG = 90;
  function routeBearing(route, i) {
    const n = route.lat.length, a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    if (a === b) return null;
    const c = Math.cos(route.lat[i] * Math.PI / 180);
    const dx = (route.lon[b] - route.lon[a]) * 111320 * c, dy = (route.lat[b] - route.lat[a]) * 110540;
    return dx === 0 && dy === 0 ? null : (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  function matchRoute(route, lat, lon, opts = {}) {
    const n = route.lat.length, c = Math.cos(lat * Math.PI / 180), r2 = MATCH_M * MATCH_M;
    let near = -1, nearD = Infinity;
    const cand = [];
    for (let i = 0; i < n; i++) {
      const dx = (route.lon[i] - lon) * 111320 * c, dy = (route.lat[i] - lat) * 110540, d = dx * dx + dy * dy;
      if (d < nearD) { nearD = d; near = i; }
      if (d < r2) cand.push([i, Math.sqrt(d)]);
    }
    if (!cand.length) return { index: near, distM: Math.sqrt(nearD) };
    let pool = cand;
    const h = opts.headingDeg;
    if (finite(h) && finite(opts.speedMps) && opts.speedMps > HEADING_MPS) {
      const agree = cand.filter(([i]) => {
        const b = routeBearing(route, i);
        return b != null && Math.abs(((h - b) % 360 + 540) % 360 - 180) < HEADING_AGREE_DEG;
      });
      if (agree.length) pool = agree;
    }
    const anchor = finite(opts.anchorM) ? opts.anchorM : null;
    let best = pool[0], bestCost = Infinity;
    for (const p of pool) {
      const cost = p[1] + (anchor != null ? MATCH_PROGRESS_W * Math.abs(route.dist[p[0]] - anchor) : 0);
      if (cost < bestCost) { bestCost = cost; best = p; }
    }
    return { index: best[0], distM: best[1] };
  }

  const api = { RerouteMonitor, matchRoute, MATCH_M, BACK_ON_FIXES, OFF_MIN_M, OFF_HOLD_MS, BACK_ON_M, WRONG_WAY_M, COOLDOWN_MS, BACKOFF_MS, BACKOFF_CAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexReroute = api;
})(typeof window !== 'undefined' ? window : globalThis);
