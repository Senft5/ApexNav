// Off-route detection for live mode. Pure: one update() per GPS fix, no timers, no I/O; the page
// does the routing and reports back with routeChanged() / requestFailed(). Rules:
//   - off route when farther than max(40 m, 2 x GPS accuracy) for 5 s in a row while moving > 2 m/s
//     (GPS jitter at a corner and a parked car's drift never count);
//   - also off route when progress along the route falls 100 m below its best (driving it backwards);
//   - back on route under 25 m (and, for wrong way, once progress is back within 100 m of its best);
//   - one reroute request per off-route episode, at least 20 s after the previous request; a failed
//     request is retried after 20 / 40 / 80 s, capped at 2 min, until a new route arrives.
// A missing fix (no GPS) breaks the 5 s run: losing signal in a tunnel is not a turn-off.
(function (root) {
  const OFF_MIN_M = 40, OFF_ACCURACY_X = 2, OFF_HOLD_MS = 5000, MOVING_MPS = 2;
  const BACK_ON_M = 25, WRONG_WAY_M = 100;
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
      this.failures = 0; this.retryAt = null;
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
      if (!f || !finite(f.t) || !finite(f.distToRouteM)) { this.farSince = null; return res(); }
      const moving = finite(f.speedMps) && f.speedMps > MOVING_MPS;
      const progress = finite(f.progressM) ? f.progressM : null;

      if (this.off) {
        const backOn = f.distToRouteM < BACK_ON_M &&
          (this.reason !== 'wrong_way' || (progress != null && progress >= this.best - WRONG_WAY_M));
        if (backOn) {
          this.off = false; this.reason = null; this.farSince = null; this.pending = false;
          this.best = progress;       // a rejoin further back is not driving backwards
          return res(false, true);
        }
        return res(this.wantRequest(f.t));
      }

      const far = moving && f.distToRouteM > Math.max(OFF_MIN_M, OFF_ACCURACY_X * (finite(f.accuracyM) ? f.accuracyM : 0));
      if (!far) this.farSince = null;
      else if (this.farSince == null) this.farSince = f.t;

      let reason = null;
      if (this.farSince != null && f.t - this.farSince >= OFF_HOLD_MS) reason = 'distance';
      else if (moving && progress != null && this.best != null && progress <= this.best - WRONG_WAY_M) reason = 'wrong_way';
      if (!reason) {
        if (progress != null && f.distToRouteM < BACK_ON_M && (this.best == null || progress > this.best)) this.best = progress;
        return res();
      }
      this.off = true; this.reason = reason;
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

  const api = { RerouteMonitor, OFF_MIN_M, OFF_HOLD_MS, BACK_ON_M, WRONG_WAY_M, COOLDOWN_MS, BACKOFF_MS, BACKOFF_CAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexReroute = api;
})(typeof window !== 'undefined' ? window : globalThis);
