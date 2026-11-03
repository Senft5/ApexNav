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

  // Panel round 2 MA-1: quiet means quiet. Waking and sleeping use different numbers, so the mode can't flap at its own
  // edge (the guided drive: "Quiet from here" with OPEN LEFT at 600 ft on the strip, and "Open left" six seconds later).
  // The notes stay awake while a waking corner lies within twice its wake window (never under SLEEP_MIN_M) or within a
  // minute's driving beyond its wake point, or while any corner is within its own call lead. Wake stays at wakeWindowM.
  const SLEEP_MIN_M = 1600, QUIET_MIN_S = 60, QUIET_SAID_M = 800;
  /** The corner that keeps Auto awake now, or null when it may go quiet. */
  function keepsAwake(corners, { cursorM, vMps, reactionS = REACT_DEFAULT_S }) {
    const v = finite(vMps) ? Math.max(0, vMps) : 0;
    for (const c of corners || []) {
      const d = c.m - cursorM;
      if (d < -5) continue;
      if (d > Math.max(SLEEP_MIN_M, 4 * MAX_M, 2 * MAX_M + v * QUIET_MIN_S)) break;   // past any corner's sleep window
      const w = wakeWindowM({ vMps: v, apexMps: c.apexMps, text: c.text, reactionS });
      if (wakes(c, v) && d <= Math.max(SLEEP_MIN_M, 2 * w, w + v * QUIET_MIN_S)) return c;
      if (d <= leadM({ vMps: v, apexMps: c.apexMps, text: c.text, reactionS })) return c;
    }
    return null;
  }
  /** Metres the quiet lasts: to where the next waking corner wakes the notes. null when no corner ahead wakes them. */
  function quietM(corners, { cursorM, vMps, reactionS = REACT_DEFAULT_S }) {
    const c = nextWake(corners, { cursorM, vMps });
    return c ? Math.max(0, c.m - cursorM - wakeWindowM({ vMps, apexMps: c.apexMps, text: c.text, reactionS })) : null;
  }
  /**
   * How long the quiet lasts, as the voice says it ("two miles", "half a mile", "three kilometres"), rounded down so it
   * never promises more quiet than there is; null under QUIET_SAID_M (too short to announce) or when unknown. `units`:
   * ApexUnits (miles unless it says metric).
   */
  const NUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
  const count = (h, unit) => { const n = Math.floor(h), half = h - n >= 0.5;
    return n === 1 && !half ? `a ${unit}` : `${NUM[n] || n}${half ? ' and a half' : ''} ${unit}s`; };
  function quietSpan(m, units) {
    if (!finite(m) || m < QUIET_SAID_M) return null;
    if (units && typeof units.metric === 'function' && units.metric()) {
      const km = Math.floor(m / 500) / 2;
      return km < 1 ? 'eight hundred metres' : count(km, 'kilometre');
    }
    const mi = m / 1609.344;
    return mi < 0.75 ? 'half a mile' : mi < 1 ? 'three quarters of a mile' : count(Math.floor(mi * 2) / 2, 'mile');
  }

  // U-96: a call is worth starting only while the line can end with a beat to act before the corner's entry. Inside that
  // the corner is already the driver's (the review drive: "Open left" with the strip at 0 ft, the first call after a wake
  // and an off-route spell); it is skipped, never read in the corner.
  const LATE_S = REACT_DEFAULT_S;   // the beat: a default reaction
  /** Metres before a note's entry under which its call is too late to start at this speed. */
  const lastCallM = ({ vMps, text = '' }) => (finite(vMps) ? Math.max(0, vMps) : 0) * (speakS(text) + LATE_S);

  // Panel round 1 M-2 (docs/design/panel/round-1/margo.md): an aside never lands inside the braking zone. "Brake well
  // before this one." came 100 ft from a hairpin at 22 mph, when the driver was already braking.
  // Panel round 2 MA-3 (docs/design/panel/round-2/ma.md): round 1's gate asked a line chosen after the call to end before
  // the call began, so no aside ever played. Now the aside is planned with the call, and the call starts early enough to
  // carry it: advice rides INSIDE the call ("Careful, hairpin left, long. Brake before it, not in it.", one utterance);
  // colour is its own clip straight after the call. Either way the whole line ends at least asideMarginM before the
  // corner's entry: before the braking point with a thinking beat and a reaction to spare, and never under ASIDE_MIN_S out.
  // An aside that can't end by then is dropped, never deferred, and the call is said on its own lead as always.
  const ASIDE_MIN_S = 4;
  const CUE_S = 0.3;          // the pre-call sound and the gap before a following clip
  const ASIDE_SLACK_S = 1;    // the call may start up to a second's driving after the planned point (frames, a busy queue)
  /** The advice said as the call's last clause: "Careful, hairpin left, long. Brake before it, not in it." */
  const withAdvice = (callText, advice) => `${String(callText || '').replace(/[.\s]+$/, '')}. ${String(advice || '').trim()}`;
  const brakeM = (v, apexMps) => (finite(apexMps) && apexMps < v ? (v * v - apexMps * apexMps) / (2 * DECEL_MPS2) : 0);
  /** Metres before the entry that a call with an aside must be done by: max(ASIDE_MIN_S, think + react + braking). */
  function asideMarginM({ vMps, apexMps = null, reactionS = REACT_DEFAULT_S }) {
    const v = finite(vMps) ? Math.max(0, vMps) : 0;
    return Math.max(v * ASIDE_MIN_S, v * (THINK_S + reactionS) + brakeM(v, apexMps));
  }
  /** Seconds the call and its aside take: one line for advice, call + cue + clip for colour. */
  const asideSpeechS = ({ callText = '', text = '', kind = 'colour' }) =>
    (kind === 'advice' ? speakS(withAdvice(callText, text)) : speakS(callText) + CUE_S + speakS(text));
  /**
   * A call with its aside, `dM` metres before the corner's entry (route metre `atM`): { leadM, fits, dueByM }. leadM: where
   * to start the call so call and aside end asideMarginM before the entry (a second of slack in it); fits: said from here,
   * it still ends by then; dueByM: the last route metre the aside's line may start at (advice: the whole call; colour:
   * the clip after it), for the speech queue to drop it once late.
   */
  function asideWindow({ dM, atM = null, vMps, apexMps = null, callText = '', text = '', kind = 'colour', reactionS = REACT_DEFAULT_S }) {
    const v = finite(vMps) ? Math.max(0, vMps) : 0;
    const margin = asideMarginM({ vMps: v, apexMps, reactionS }), speech = asideSpeechS({ callText, text, kind });
    const leadM = v * (speech + ASIDE_SLACK_S) + margin;
    const fits = v > 0 && finite(dM) && dM - v * speech >= margin;
    const own = kind === 'advice' ? speakS(withAdvice(callText, text)) : speakS(text);
    return { leadM, fits, dueByM: finite(atM) ? atM - margin - v * own : null };
  }

  // MA-2: a chain names the next corner only while the link is short enough to carry: 150 m, or 6 s at this speed. Past
  // that the next corner gets its own call at its own lead ("then ... in a quarter mile" at 28 mph was 32 s ahead).
  const NAME_NEXT_M = 150, NAME_NEXT_S = 6;
  const chainReachM = (vMps) => Math.max(NAME_NEXT_M, (finite(vMps) ? Math.max(0, vMps) : 0) * NAME_NEXT_S);

  // REVIEW4 §4: "careful" after every tight corner stops meaning anything by the third; a rally co-driver says it once a
  // stage. A run of corners is corners called each within CARE_RUN_M of the one before on one route (the notes going quiet
  // ends it, reset()); the lightest caution is said once in it. at(m, routeId) for each corner call about to be said, then
  // take() for each "care" in it: true the first time in the run.
  const CARE_RUN_M = 1000;
  function createCareRun(gapM = CARE_RUN_M) {
    let lastM = null, id = null, cared = false;
    const run = {
      at(m, routeId) {
        if (routeId !== id || lastM == null || !(m - lastM <= gapM) || m < lastM - 50) { cared = false; id = routeId; }
        lastM = m;
        return run;
      },
      take() { if (cared) return false; cared = true; return true; },
      // A note as the run says it: its "care" (caution 1) spent the first time in the run, left off after. Panel round 2
      // MA-2: a chain that names the next corner with its "careful" spends it for that corner too, so the corner's own
      // call comes without it ("Square left"): one word, one corner.
      spend(n) {
        if (!n || n.type !== 'corner' || n.recce || n.caution !== 1 || run.take()) return n;
        return { ...n, caution: 0, call: String(n.call).replace(/, care$/i, '') };
      },
      reset() { lastM = null; id = null; cared = false; },
    };
    return run;
  }

  const api = { leadM, speakS, lastCallM, LATE_S, asideWindow, asideMarginM, withAdvice, ASIDE_MIN_S, chainReachM, NAME_NEXT_M, NAME_NEXT_S,
    keepsAwake, quietM, quietSpan, SLEEP_MIN_M, QUIET_MIN_S, QUIET_SAID_M, createCareRun, CARE_RUN_M, createReactionLearner, needsBrake, wakes, wakeWindowM, wakeCorner, nextWake, createWakeVoice,
    DECEL_MPS2, MIN_M, MAX_M, REACT_DEFAULT_S, THINK_S, WAKE_MIN_M, TRANSITION_GAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexNoteTiming = api;
})(typeof window !== 'undefined' ? window : globalThis);
