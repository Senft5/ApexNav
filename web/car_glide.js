// Where the car's arrow is drawn between GPS fixes (REVIEW_FEEL.md F-01): dead reckoning. The shell sends a 1 Hz fix; the
// arrow used to ease to the newest one, "never ahead of real data", which drew the car where it was a second ago (11 m
// behind at the median, 25 m at the 95th percentile, at 20 to 25 m/s): it entered corners after the real car did. Now the
// arrow is predicted from the last fix, the way every navigation app does it: last fix + speed x elapsed, along the route
// line when the car is on it (so a corner is followed, not cut), else along its course; never more than CAP_S or CAP_M past
// the fix, and eased into each new fix instead of jumping to it. Position only: no road value (camber, roughness, crests,
// corners) is ever predicted. The position is not road data, and the driver can see the road.
//
// Pure (tests/test_car_glide.py); web/carmap.js draws with it, and ApexKit's CarGlide.swift is the same algorithm for the
// native car map (CarPlay/ApexCarMap.swift), held to this file by ApexKit/Tests/Fixtures/car_glide.json
// (tools/make_glide_fixture.js). Times are seconds on one monotonic clock; angles are degrees clockwise from north.
(function (root) {
  'use strict';
  const K_LAT = 110540, K_LON = 111320;           // metres per degree (web/carmap.js distM)
  const CAP_S = 1.5;                               // never predict more than this long past a fix
  const CAP_M = 50;                                // ...or this far (33 m/s for 1.5 s)
  const EASE_S = 0.8;                              // how long the drawn car takes to ease into a new fix (a smoothstep: the
                                                   // correction starts and ends at no speed, so the road scrolls on evenly)
  const EASE_MAX_S = 2;                            // the slowest ease (a car that stopped short of its prediction)
  const JUMP_M = 400;                              // a fix this far from the drawn car is drawn at once (first fix, seek, tunnel)
  const SNAP_M = 25;                               // a fix this near the route line is on it
  const AGREE_DEG = 75;                            // ...if it is heading the line's way (a road that doubles back, U-90)
  const CHORD_M = 12;                              // the arrow's heading on the route: the chord across this much road
  const MIN_MPS = 0.5;                             // slower than this the car is standing: no prediction, GPS course is noise
  const WINDOW_BACK = 5, WINDOW_AHEAD = 80;        // segments searched round the last snap before the whole line

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const RAD = Math.PI / 180;
  const norm = (d) => ((d % 360) + 360) % 360;
  const turn = (a, b) => ((b - a + 540) % 360) - 180;   // degrees from a to b, the short way round
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const metres = (a, b) => Math.hypot((b.lon - a.lon) * K_LON * Math.cos(a.lat * RAD), (b.lat - a.lat) * K_LAT);
  const bearing = (a, b) => norm(Math.atan2((b.lon - a.lon) * K_LON * Math.cos(a.lat * RAD), (b.lat - a.lat) * K_LAT) / RAD);

  function create() {
    let R = null;            // the route: lat, lon, x, y (metres from its first point), s (metres along it), n, total
    let fix = null;          // the last fix: { lat, lon, course, mps, t }
    let base = null;         // the fix on the route: { s, i }, or null off it
    let off = null;          // the ease into the last fix: { t, dur, ds } along the route, or { t, dur, dx, dy, dc }
    let lastI = -1;          // the segment of the last snap

    function setRoute(coords, now) {
      const pts = (Array.isArray(coords) ? coords : []).filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]));
      const drawn = fix && finite(now) ? pose(now) : null;
      R = null; lastI = -1;
      if (pts.length >= 2) {
        const lat0 = pts[0][0], lon0 = pts[0][1], c = Math.cos(lat0 * RAD), n = pts.length;
        R = { lat: new Float64Array(n), lon: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), s: new Float64Array(n), n, total: 0 };
        for (let i = 0; i < n; i++) {
          R.lat[i] = pts[i][0]; R.lon[i] = pts[i][1];
          R.x[i] = (pts[i][1] - lon0) * K_LON * c; R.y[i] = (pts[i][0] - lat0) * K_LAT;
          if (i) R.s[i] = R.s[i - 1] + Math.hypot(R.x[i] - R.x[i - 1], R.y[i] - R.y[i - 1]);
        }
        R.total = R.s[n - 1]; R.lat0 = lat0; R.lon0 = lon0; R.c = c;
      }
      if (fix) { base = snap(fix); if (drawn) { drawn.s = null; ease(drawn, now); } }   // the car stays where it is drawn, then eases onto the new line
    }

    /** The fix on the route line: the nearest point within SNAP_M on a segment heading the car's way, or null. */
    function snap(f) {
      if (!R) return null;
      const px = (f.lon - R.lon0) * K_LON * R.c, py = (f.lat - R.lat0) * K_LAT;
      const heading = f.course != null && f.mps >= 2;
      const best = (lo, hi) => {
        let b = null;
        for (let i = lo; i < hi; i++) {
          const ax = R.x[i], ay = R.y[i], vx = R.x[i + 1] - ax, vy = R.y[i + 1] - ay, L2 = vx * vx + vy * vy;
          const u = L2 > 0 ? clamp(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1) : 0;
          const d = Math.hypot(ax + u * vx - px, ay + u * vy - py);
          if (d > SNAP_M || (b && d >= b.d)) continue;
          if (heading && L2 > 0.01 && Math.abs(turn(norm(Math.atan2(vx, vy) / RAD), f.course)) > AGREE_DEG) continue;
          b = { i, s: R.s[i] + u * Math.sqrt(L2), d };
        }
        return b;
      };
      let hit = lastI >= 0 ? best(Math.max(0, lastI - WINDOW_BACK), Math.min(R.n - 1, lastI + WINDOW_AHEAD)) : null;
      if (!hit) hit = best(0, R.n - 1);
      lastI = hit ? hit.i : -1;
      return hit ? { s: hit.s, i: hit.i } : null;
    }

    /** The point s metres along the route, and the route's heading there (a chord across CHORD_M of road). */
    function along(s) {
      s = clamp(s, 0, R.total);
      let lo = 0, hi = R.n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.s[mid] <= s) lo = mid; else hi = mid; }
      const L = R.s[hi] - R.s[lo], u = L > 0 ? (s - R.s[lo]) / L : 0;
      return { lat: R.lat[lo] + (R.lat[hi] - R.lat[lo]) * u, lon: R.lon[lo] + (R.lon[hi] - R.lon[lo]) * u, s, i: lo };
    }
    function headingAt(s) {
      const a = along(s - CHORD_M), b = along(s + CHORD_M);
      return a.lat === b.lat && a.lon === b.lon ? null : bearing(a, b);
    }

    /** How far past the fix the car has gone by time t: speed x elapsed, capped. */
    const ahead = (t) => (fix.mps >= MIN_MPS ? Math.min(fix.mps * clamp(t - fix.t, 0, CAP_S), CAP_M) : 0);

    /** The predicted car at time t, before the ease: along the route from the snapped fix, else along its course. */
    function predicted(t) {
      const a = ahead(t);
      if (base) { const p = along(base.s + a); return { lat: p.lat, lon: p.lon, course: headingAt(p.s), s: p.s }; }
      if (!a || fix.course == null) return { lat: fix.lat, lon: fix.lon, course: fix.course, s: null };
      return { lat: fix.lat + a * Math.cos(fix.course * RAD) / K_LAT, lon: fix.lon + a * Math.sin(fix.course * RAD) / (K_LON * Math.cos(fix.lat * RAD)), course: fix.course, s: null };
    }

    /** Where to draw the car at time t: { lat, lon, course (null when unknown), s (metres along the route, or null) }. */
    function pose(t) {
      if (!fix) return null;
      const p = predicted(t);
      if (!off) return p;
      const k = clamp((t - off.t) / off.dur, 0, 1), e = 1 - k * k * (3 - 2 * k);   // what is left of the correction
      if (off.ds != null) { const q = along(p.s + off.ds * e); return { lat: q.lat, lon: q.lon, course: headingAt(q.s), s: q.s }; }
      const course = p.course == null ? null : norm(p.course + off.dc * e);
      // s stays the prediction's: by the next fix the ease is all but spent, and that one eases along the road again
      return { lat: p.lat + off.dy * e / K_LAT, lon: p.lon + off.dx * e / (K_LON * Math.cos(p.lat * RAD)), course, s: p.s };
    }

    /** From the car as drawn at `now` to the new prediction, so the arrow never jumps; along the road when both are on it. */
    function ease(drawn, now) {
      const p = predicted(now);
      off = null;
      if (metres(drawn, p) > JUMP_M) return;
      if (base && drawn.s != null) {
        const ds = drawn.s - p.s;
        // drawn ahead of the new prediction (the car slowed): ease back no faster than the car moves (a smoothstep's
        // steepest is 1.5 times its average), so the arrow never runs backwards along the road; within EASE_MAX_S even if
        // the car stopped
        const dur = ds > 0 ? clamp(1.5 * ds / Math.max(fix.mps, 0.1), EASE_S, EASE_MAX_S) : EASE_S;
        off = { t: now, dur, ds };
      } else {
        const dx = (drawn.lon - p.lon) * K_LON * Math.cos(p.lat * RAD), dy = (drawn.lat - p.lat) * K_LAT;
        const dc = drawn.course != null && p.course != null ? turn(p.course, drawn.course) : 0;
        off = { t: now, dur: EASE_S, dx, dy, dc };
      }
    }

    /**
     * A new fix, taken at time `t` (the shell says how old it is), arriving at `now`. Speed in m/s, course in degrees; either
     * may be null (unknown): then the speed is the distance from the last fix over the time between them, the course the
     * bearing from it.
     */
    function push(lat, lon, course, mps, t, now) {
      if (!finite(lat) || !finite(lon)) return;
      if (!finite(now)) now = t;
      if (!finite(t) || t > now) t = now;
      const drawn = fix ? pose(now) : null, prev = fix, here = { lat, lon };
      if (!(finite(mps) && mps >= 0)) {
        const dt = prev ? t - prev.t : 0;
        // measured between two fixes whose times are only their arrival: half of it, half the last speed
        mps = prev && dt >= 0.2 && dt <= 3 ? (prev.mps > 0 ? 0.5 * prev.mps : 0) + (prev.mps > 0 ? 0.5 : 1) * metres(prev, here) / dt : (prev ? prev.mps : 0);
      }
      if (!(finite(course) && course >= 0)) {
        course = prev && mps >= MIN_MPS && metres(prev, here) > 2 ? bearing(prev, here) : (drawn ? drawn.course : null);
      } else course = norm(course);
      fix = { lat, lon, course, mps, t };
      base = snap(fix);
      if (drawn) ease(drawn, now); else off = null;
    }

    /** Whether the drawn car is still moving at time t (the caller's frame loop can stop when it is not). */
    function moving(t) {
      if (!fix) return false;
      if (fix.mps >= MIN_MPS && t - fix.t < CAP_S) return true;
      return !!off && t - off.t < off.dur;
    }

    function reset() { fix = null; base = null; off = null; lastI = -1; }

    return { setRoute, push, pose, moving, reset, get fix() { return fix; }, get onRoute() { return !!base; } };
  }

  const api = { create, CAP_S, CAP_M, EASE_S, EASE_MAX_S, JUMP_M, SNAP_M, MIN_MPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarGlide = api;
})(typeof window !== 'undefined' ? window : globalThis);
