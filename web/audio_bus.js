// ApexAudioBus: the audio bus (docs/ARCHITECTURE.md section 5), the port of core/audio_bus.py (read that file for the
// laws; tests/test_audio_bus.py holds the two to one sequence). What the road asks of the driver, as numbers a sound
// engine can follow: no audio here. Speed is never excitement (it only turns a distance into a time), and unknown stays
// unknown (no calibrated g: no intensity; no look-ahead: no anticipation; the music rests on its pad).
(function (root) {
  'use strict';
  const G_STD = 9.80665, HORIZON_M = 400.0, BUILD_S = 8.0, MIN_V = 3.0;
  const ATTACK_S = 1.2, RELEASE_S = 6.0, ANTIC_S = 0.35, CALM_S = 0.6, CALM_CAP = 0.12;
  const DUCK = 0.35, DUCK_DOWN_S = 0.12, DUCK_UP_S = 0.7, CUT_LO = 380.0, CUT_HI = 11000.0, PAD_FLOOR = 0.55;
  const LAYERS = [['pad', null, null], ['pulse', 0.12, 0.38], ['bass', 0.28, 0.52], ['lead', 0.52, 0.82]];

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const clip = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const smoothstep = (a, b, x) => { const t = clip((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const toward = (now, target, dt, tau) => (tau <= 0 ? target : now + (target - now) * (1 - Math.exp(-dt / tau)));

  /** A pace-note number (1 the tightest, 6 the most open) as 0..1; null when it has none. */
  const severity = (call) => (finite(call) && call >= 1 && call <= 6 ? clip((7 - call) / 6) : null);

  function create() {
    let intensity = null, anticipation = null, cap = 1, master = 1, lastYaw = null;
    function reset() { intensity = null; anticipation = null; cap = 1; master = 1; lastYaw = null; }
    /** One frame. dt in s; corners: null when the road ahead is not known, else [[ahead_m, severity 0..1 or null]]. */
    function step(dt, { lat_g = null, lon_g = null, speed_mps = null, corners = null, over_sight = false, speaking = false } = {}) {
      dt = clip(finite(dt) ? dt : 0, 0, 1);
      const v = finite(speed_mps) && speed_mps >= 0 ? speed_mps : null;

      let engagement = null;
      if (finite(lat_g) && finite(lon_g)) {
        let jerk = 0;
        const yaw = v !== null && v >= MIN_V ? lat_g * G_STD / v : null;
        if (yaw !== null && lastYaw !== null && dt > 0) jerk = Math.abs(yaw - lastYaw) / dt;
        lastYaw = yaw;
        engagement = clip(0.7 * (Math.hypot(lat_g, lon_g) / 0.8) + 0.3 * (jerk / 1.5));
      } else lastYaw = null;

      if (engagement === null) intensity = null;
      else if (intensity === null) intensity = engagement;
      else intensity = toward(intensity, engagement, dt, engagement > intensity ? ATTACK_S : RELEASE_S);

      let target = null;
      if (corners !== null && corners !== undefined && v !== null) {
        target = 0;
        if (v >= MIN_V) for (const [ahead, sev] of corners) {
          if (!finite(ahead) || ahead < 0 || ahead > HORIZON_M) continue;
          const weight = 0.4 + 0.6 * (finite(sev) ? sev : 0.5);
          target = Math.max(target, weight * clip(1 - (ahead / v) / BUILD_S));
        }
      }
      if (target === null) anticipation = null;
      else if (anticipation === null) anticipation = target;
      else anticipation = toward(anticipation, target, dt, target >= anticipation ? ANTIC_S : ANTIC_S / 3);

      cap = toward(cap, over_sight ? CALM_CAP : 1, dt, CALM_S);
      master = toward(master, speaking ? DUCK : 1, dt, speaking ? DUCK_DOWN_S : DUCK_UP_S);

      const i = intensity !== null ? intensity : 0, a = anticipation !== null ? anticipation : 0;
      const energy = Math.min(clip(i + 0.5 * a * (1 - i)), cap);
      const layers = {};
      for (const [name, lo, hi] of LAYERS) layers[name] = lo === null ? PAD_FLOOR + (1 - PAD_FLOOR) * (1 - energy) : smoothstep(lo, hi, energy);
      return { engagement, intensity, anticipation, energy, cutoff_hz: CUT_LO * Math.pow(CUT_HI / CUT_LO, energy), layers,
        swell: Math.min(a, cap), master, calm: !!over_sight };
    }
    return { step, reset };
  }

  const api = { create, severity, HORIZON_M, BUILD_S, CALM_CAP, DUCK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAudioBus = api;
})(typeof window !== 'undefined' ? window : globalThis);
