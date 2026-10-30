// When to read a pace note (IDEAS V-01): far enough ahead of the corner's entry to say the note, react, and brake from
// your speed to the corner's speed, instead of a fixed ~5 s. The reaction time is learned per driver from how long after
// a call they start braking for corners that need it, and kept on the phone. Pure (tests/test_note_timing_v01.py).
// Also when Auto wakes (REVIEW4 U-58): on the road ahead, a corner that is tight or needs braking, not on the driver's g
// (tests/test_note_wake.py).
(function (root) {
  'use strict';
  const DECEL_MPS2 = 3.4;                // a firm but unhurried stop: 0.35 g
  const MIN_M = 60, MAX_M = 600;
  const REACT_DEFAULT_S = 1.2, REACT_MIN_S = 0.6, REACT_MAX_S = 2.5, REACT_ALPHA = 0.2;
  const BRAKE_G = -0.15, NEEDS_BRAKE_MPS = 2;   // braking starts below -0.15 g; a corner "needs" braking when 2+ m/s slower
  // REVIEW4 §4 Timing: a co-driver reads a corner before the driver needs to think about it, not just in time to brake.
  // At road speed this is about one corner's warning earlier; a hazard (no braking) keeps the plain lead.
  const THINK_S = 1.5;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Seconds the voice takes for a line: the app's estimate elsewhere (600 ms + 70 ms a character). */
  const speakS = (text) => 0.6 + 0.07 * String(text || '').length;

  /**
   * Metres before a note's entry to start reading it. `apexMps` is the corner's speed (null for hazards: no braking or
   * thinking term).
   */
  function leadM({ vMps, apexMps = null, text = '', reactionS = REACT_DEFAULT_S }) {
    const v = finite(vMps) ? Math.max(0, vMps) : 0;
    const brake = finite(apexMps) && apexMps < v ? (v * v - apexMps * apexMps) / (2 * DECEL_MPS2) : 0;
    const think = finite(apexMps) ? THINK_S : 0;
    return Math.round(Math.max(MIN_M, Math.min(MAX_M, v * (speakS(text) + think + reactionS) + brake)));
  }

  /**
   * Learns the driver's reaction: after a call for a corner that needs braking, the time from the end of the line to the
   * first frame under BRAKE_G, less the THINK_S the lead gives a corner before the driver is expected to act (else the
   * margin would be learned as a slower reaction and added twice). Samples outside 0.3–4 s (already braking, or never
   * braked) are ignored; the estimate moves by REACT_ALPHA per sample and stays within REACT_MIN_S..REACT_MAX_S.
   */
  function createReactionLearner(initial = REACT_DEFAULT_S) {
    let reaction = finite(initial) ? Math.min(REACT_MAX_S, Math.max(REACT_MIN_S, initial)) : REACT_DEFAULT_S, pending = null, samples = 0;
    return {
      get reactionS() { return reaction; },
      get samples() { return samples; },
      /** A call was read at `tMs`, ending `speakS(text)` later, for a corner `needsBrake`. */
      called(tMs, text, needsBrake) { pending = needsBrake ? { endMs: tMs + (speakS(text) + THINK_S) * 1000, braking: null } : null; },
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

  // ---------------------------------------------------------------------------------------------------------------------
  // U-58: Auto reads the road. Interesting is a property of the road ahead (the route's corners, each with its severity
  // and apex speed), not of what the driver just did: the notes wake when a corner within two leads at this speed (never
  // under WAKE_MIN_M) is severity 3 or tighter, a hairpin, or needs braking from this speed. Straight road stays quiet.
  const WAKE_MIN_M = 800, WAKE_SEVERITY = 3, TRANSITION_GAP_MS = 120000;
  const tight = (sev) => sev === 'HP' || (finite(sev) && sev <= WAKE_SEVERITY);
  /** Whether a corner { severity, apexMps } is one the co-driver reads in Auto at this speed. */
  const wakes = (c, vMps) => !!c && (tight(c.severity) || needsBrake(vMps, c.apexMps));
  /** Metres ahead a corner wakes the notes from: two of its leads at this speed, at least WAKE_MIN_M. */
  const wakeWindowM = ({ vMps, apexMps = null, text = '', reactionS = REACT_DEFAULT_S }) =>
    Math.max(WAKE_MIN_M, 2 * leadM({ vMps, apexMps, text, reactionS }));
  /**
   * The first corner that wakes the notes now, or null. `corners` are { m (the entry, route metres), severity, apexMps,
   * text } in road order; one already behind the car (entry over 5 m back) no longer wakes them.
   */
  function wakeCorner(corners, { cursorM, vMps, reactionS = REACT_DEFAULT_S }) {
    for (const c of corners || []) {
      const d = c.m - cursorM;
      if (d < -5) continue;
      if (d > Math.max(WAKE_MIN_M, 2 * MAX_M)) break;                 // past any corner's window
      if (wakes(c, vMps) && d <= wakeWindowM({ vMps, apexMps: c.apexMps, text: c.text, reactionS })) return c;
    }
    return null;
  }
  /** The next corner ahead that will wake the notes at this speed, however far, or null: where the quiet ends. */
  function nextWake(corners, { cursorM, vMps }) {
    for (const c of corners || []) if (c.m - cursorM >= -5 && wakes(c, vMps)) return c;
    return null;
  }
  /**
   * The spoken transitions: update(awake, tMs) returns 'on' when Auto wakes, 'off' when it goes quiet, else null. The first
   * reading after a reset is silent (a drive's first line is its first note, not a mode), and no transition is said
   * within gapMs of the last one said, so a road that comes and goes never chatters.
   */
  function createWakeVoice(gapMs = TRANSITION_GAP_MS) {
    let awake = null, saidAt = -Infinity;
    return {
      reset() { awake = null; saidAt = -Infinity; },
      update(now, tMs) {
        const was = awake;
        awake = !!now;
        if (was === null || was === awake || tMs - saidAt < gapMs) return null;
        saidAt = tMs;
        return awake ? 'on' : 'off';
      },
    };
  }

  // U-96: a call is worth starting only while the line can end with a beat to act before the corner's entry. Inside that
  // the corner is already the driver's (the review drive: "Open left" with the strip at 0 ft, the first call after a wake
  // and an off-route spell); it is skipped, never read in the corner.
  const LATE_S = REACT_DEFAULT_S;   // the beat: a default reaction
  /** Metres before a note's entry under which its call is too late to start at this speed. */
  const lastCallM = ({ vMps, text = '' }) => (finite(vMps) ? Math.max(0, vMps) : 0) * (speakS(text) + LATE_S);

  const api = { leadM, speakS, lastCallM, LATE_S, createReactionLearner, needsBrake, wakes, wakeWindowM, wakeCorner, nextWake, createWakeVoice,
    DECEL_MPS2, MIN_M, MAX_M, REACT_DEFAULT_S, THINK_S, WAKE_MIN_M, TRANSITION_GAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexNoteTiming = api;
})(typeof window !== 'undefined' ? window : globalThis);
