// ApexBrakeHeat: how hard the brakes have been working, from speed and height alone. The port of core/brake_heat.py
// (read that file for the model and its limits; tests/test_brake_heat.py holds the two to one sequence). Energy that goes
// faster than rolling and air drag take it went into the discs (or the engine in a low gear, so this is an upper bound);
// the discs are one thermal mass cooled by the air. The driver only hears a level in words, never a temperature, and
// unknown stays unknown: no speed or no height only cools, and before the first known step the rise is null.
(function (root) {
  'use strict';
  const G_STD = 9.80665, DISC_C = 0.017 * 460.0, C_RR = 0.012, K_AERO = 2.6e-4;
  const TAU_STILL_S = 600.0, TAU_MOVING_S = 150.0, V_REF = 22.0, H_TAU_S = 4.0, GAP_S = 5.0;
  const WARM_K = 150.0, HOT_K = 250.0, REARM_K = 150.0, CALL_GAP_S = 180.0, MAX_P = 400.0, WINDOW_S = 2.0, MAX_DT_S = 3600.0;

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Cooling time constant at speed v (m/s). */
  function tauS(v) {
    v = finite(v) ? Math.max(0, v) : 0;
    return 1 / (1 / TAU_STILL_S + Math.pow(v / V_REF, 0.8) / TAU_MOVING_S);
  }
  /** 'cool' / 'warm' / 'hot', or null when unknown. */
  const level = (rise) => (!finite(rise) ? null : rise >= HOT_K ? 'hot' : rise >= WARM_K ? 'warm' : 'cool');

  function create() {
    let rise, h, e0, win, loss, vLast, pend, pLast, armed, sinceCall, peak;
    function reset() { rise = null; h = null; e0 = null; win = 0; loss = 0; vLast = null; pend = null; pLast = null; armed = true; sinceCall = null; peak = null; }
    reset();
    /** One step of dt seconds. Returns { rise_k, power_wkg, level, call }; call is true once when the brakes get hot.
     *  Energy is differenced over windows of at least WINDOW_S (the app holds speed between 1 Hz fixes at 10 Hz frames). */
    function step(dt, speedMps = null, elevationM = null) {
      dt = finite(dt) ? Math.max(0, Math.min(MAX_DT_S, dt)) : 0;
      const v = finite(speedMps) && speedMps >= 0 ? speedMps : null;
      const hz = finite(elevationM) ? elevationM : null;
      if (sinceCall !== null) sinceCall += dt;
      let power = null;
      if (rise !== null) {
        const vc = v !== null ? v : (vLast !== null ? vLast : 0);
        rise *= Math.exp(-dt / tauS(vc));
      }
      if (v !== null && hz !== null) {
        const span = (pend || 0) + dt;
        const fresh = e0 === null || pend === null || span > GAP_S;
        if (fresh) h = hz; else h += (hz - h) * (1 - Math.exp(-span / H_TAU_S));
        const en = 0.5 * v * v + G_STD * h;
        if (fresh) { e0 = en; win = 0; loss = 0; pLast = null; }
        else {
          const vm = 0.5 * (v + vLast);
          win += span;
          loss += (C_RR * G_STD * vm + K_AERO * Math.pow(vm, 3)) * span;
          if (win >= WINDOW_S) {
            const absorbed = Math.min(MAX_P * win, Math.max(0, (e0 - en) - loss));
            pLast = absorbed / win;
            rise = (rise || 0) + absorbed / DISC_C;
            e0 = en; win = 0; loss = 0;
          }
          power = pLast;
        }
        vLast = v; pend = 0;
        if (rise === null) rise = 0;
      } else if (pend !== null) pend += dt;
      if (rise !== null) peak = peak === null ? rise : Math.max(peak, rise);
      let call = false;
      if (rise !== null) {
        if (rise < REARM_K) armed = true;
        else if (rise >= HOT_K && armed && (sinceCall === null || sinceCall >= CALL_GAP_S)) { call = true; armed = false; sinceCall = 0; }
      }
      return { rise_k: rise, power_wkg: power, level: level(rise), call };
    }
    return { step, reset, peak: () => peak };
  }

  /** A recorded drive (5 m rows: distance, speed, height) through the model. { peak_k, level, hot_m } or null. */
  function overTrack(dist, speed, elev) {
    const bh = create();
    let hotM = 0;
    for (let i = 0; i < dist.length; i++) {
      let dt = 0;
      const stepOk = i > 0 && finite(dist[i]) && finite(dist[i - 1]);
      if (stepOk) {
        const v0 = speed[i - 1], v1 = speed[i];
        const vm = finite(v0) && finite(v1) ? 0.5 * (v0 + v1) : null, dd = dist[i] - dist[i - 1];
        dt = vm !== null && vm > 0.5 && dd >= 0 ? dd / vm : GAP_S + 1;
      } else if (i > 0) dt = 0;
      const out = bh.step(dt, speed[i], elev ? elev[i] : null);
      if (out.level === 'hot' && stepOk) hotM += Math.max(0, dist[i] - dist[i - 1]);
    }
    const peak = bh.peak();
    return peak === null ? null : { peak_k: peak, level: level(peak), hot_m: hotM };
  }

  /** What the co-driver says when the brakes get hot. */
  const CALL_TEXT = 'Brakes are getting hot. Use a lower gear and ease off.';

  /** The drive page's line for overTrack's answer, or null when there is nothing worth saying (cool, or unknown).
   *  fmtDist(m) gives a distance in the driver's units. Words only; it says it is an estimate. */
  function driveText(r, fmtDist) {
    if (!r || (r.level !== 'hot' && r.level !== 'warm')) return null;
    if (r.level === 'warm') return 'Your brakes worked hard at times on this drive, by Vetta\u2019s estimate from your speed and the hills.';
    const far = r.hot_m >= 100 && typeof fmtDist === 'function' ? ` for about ${fmtDist(r.hot_m)}` : '';
    return `Your brakes got hot${far} on this drive, by Vetta\u2019s estimate from your speed and the hills. On a long descent, a lower gear lets the engine take some of the work.`;
  }

  const api = { create, overTrack, driveText, tauS, level, CALL_TEXT, WARM_K, HOT_K };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBrakeHeat = api;
})(typeof window !== 'undefined' ? window : globalThis);
