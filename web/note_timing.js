// When to read a pace note (IDEAS V-01): far enough ahead of the corner's entry to say the note, react, and brake from
// your speed to the corner's speed, instead of a fixed ~5 s. The reaction time is learned per driver from how long after
// a call they start braking for corners that need it, and kept on the phone. Pure (tests/test_note_timing_v01.py).
(function (root) {
  'use strict';
  const DECEL_MPS2 = 3.4;                // a firm but unhurried stop: 0.35 g
  const MIN_M = 60, MAX_M = 600;
  const REACT_DEFAULT_S = 1.2, REACT_MIN_S = 0.6, REACT_MAX_S = 2.5, REACT_ALPHA = 0.2;
  const BRAKE_G = -0.15, NEEDS_BRAKE_MPS = 2;   // braking starts below -0.15 g; a corner "needs" braking when 2+ m/s slower
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Seconds the voice takes for a line: the app's estimate elsewhere (600 ms + 70 ms a character). */
  const speakS = (text) => 0.6 + 0.07 * String(text || '').length;

  /**
   * Metres before a note's entry to start reading it. `apexMps` is the corner's speed (null for hazards: no braking term).
   */
  function leadM({ vMps, apexMps = null, text = '', reactionS = REACT_DEFAULT_S }) {
    const v = finite(vMps) ? Math.max(0, vMps) : 0;
    const brake = finite(apexMps) && apexMps < v ? (v * v - apexMps * apexMps) / (2 * DECEL_MPS2) : 0;
    return Math.round(Math.max(MIN_M, Math.min(MAX_M, v * (speakS(text) + reactionS) + brake)));
  }

  /**
   * Learns the driver's reaction: after a call for a corner that needs braking, the time from the end of the line to the
   * first frame under BRAKE_G. Samples outside 0.3–4 s (already braking, or never braked) are ignored; the estimate moves
   * by REACT_ALPHA per sample and stays within REACT_MIN_S..REACT_MAX_S.
   */
  function createReactionLearner(initial = REACT_DEFAULT_S) {
    let reaction = finite(initial) ? Math.min(REACT_MAX_S, Math.max(REACT_MIN_S, initial)) : REACT_DEFAULT_S, pending = null, samples = 0;
    return {
      get reactionS() { return reaction; },
      get samples() { return samples; },
      /** A call was read at `tMs`, ending `speakS(text)` later, for a corner `needsBrake`. */
      called(tMs, text, needsBrake) { pending = needsBrake ? { endMs: tMs + speakS(text) * 1000, braking: null } : null; },
      /** Each frame: its time and longitudinal g (G units, braking negative). Returns the new estimate when it learned. */
      frame(tMs, lonG) {
        if (!pending || !finite(lonG)) return null;
        const dt = (tMs - pending.endMs) / 1000;
        if (dt > 4) { pending = null; return null; }                   // never braked: nothing to learn
        if (lonG > BRAKE_G) return null;
        const p = pending; pending = null;
        if (dt < 0.3) return null;                                      // already braking when the call ended
        reaction = Math.min(REACT_MAX_S, Math.max(REACT_MIN_S, reaction + REACT_ALPHA * (dt - reaction)));
        samples++;
        return reaction;
      },
    };
  }

  const needsBrake = (vMps, apexMps) => finite(vMps) && finite(apexMps) && vMps - apexMps >= NEEDS_BRAKE_MPS;

  const api = { leadM, speakS, createReactionLearner, needsBrake, DECEL_MPS2, MIN_M, MAX_M, REACT_DEFAULT_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexNoteTiming = api;
})(typeof window !== 'undefined' ? window : globalThis);
