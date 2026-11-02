// The lines every voice pack says besides the pace notes (tools/voicebank.py renders them; web/voice.js plays them): the
// directions without the street name, the route and traffic lines, reported hazards, coaching and break lines, track mode.
// Before these were in the packs the phone's own voice said them, so a drive kept switching voices. A line with a name in
// it (a street, a regroup point) plays its fixed part in the pack's voice and the name stays on the screen; on the website
// with the live voice ready the whole sentence is rendered in the pack's voice instead.
// The block between the markers is JSON: tools/voicebank.py reads it.
(function (root) {
  'use strict';
  const TEXT = /* VOICE_LINES_JSON */ {
    "nav:bear_right": "Bear right.", "nav:turn_right": "Turn right.", "nav:sharp_right": "Sharp right.", "nav:u_turn": "Make a U-turn.",
    "nav:sharp_left": "Sharp left.", "nav:turn_left": "Turn left.", "nav:bear_left": "Bear left.",
    "nav:ramp": "Take the ramp.", "nav:ramp_right": "Take the ramp on the right.", "nav:ramp_left": "Take the ramp on the left.",
    "nav:exit_right": "Take the exit on the right.", "nav:exit_left": "Take the exit on the left.",
    "nav:keep_right": "Keep right.", "nav:keep_left": "Keep left.", "nav:merge": "Merge.", "nav:merge_right": "Merge right.", "nav:merge_left": "Merge left.",
    "nav:arrive": "Arriving at your destination.",
    "nav:rb1": "At the roundabout, take the first exit.", "nav:rb2": "At the roundabout, take the second exit.",
    "nav:rb3": "At the roundabout, take the third exit.", "nav:rb4": "At the roundabout, take the fourth exit.",
    "nav:rb5": "At the roundabout, take the fifth exit.", "nav:rb6": "At the roundabout, take the sixth exit.",
    "nav:rbnext": "At the roundabout, take the next exit.",
    "nav:then": "then",
    "lane:left1": "use the left lane.", "lane:left2": "use the left two lanes.", "lane:left3": "use the left three lanes.",
    "lane:right1": "use the right lane.", "lane:right2": "use the right two lanes.", "lane:right3": "use the right three lanes.",
    "lane:middle1": "use a middle lane.", "lane:middle2": "use the middle two lanes.",
    "navd:100ft": "In one hundred feet,", "navd:200ft": "In two hundred feet,", "navd:300ft": "In three hundred feet,", "navd:400ft": "In four hundred feet,",
    "navd:500ft": "In five hundred feet,", "navd:600ft": "In six hundred feet,", "navd:700ft": "In seven hundred feet,", "navd:800ft": "In eight hundred feet,",
    "navd:0.2mi": "In point two miles,", "navd:0.3mi": "In point three miles,", "navd:0.4mi": "In point four miles,", "navd:0.5mi": "In half a mile,",
    "navd:0.6mi": "In point six miles,", "navd:0.7mi": "In point seven miles,", "navd:0.8mi": "In point eight miles,", "navd:0.9mi": "In point nine miles,",
    "navd:1mi": "In one mile,", "navd:1.1mi": "In one point one miles,", "navd:1.2mi": "In one point two miles,", "navd:1.3mi": "In one point three miles,",
    "navd:100m": "In one hundred metres,", "navd:200m": "In two hundred metres,", "navd:300m": "In three hundred metres,", "navd:400m": "In four hundred metres,",
    "navd:500m": "In five hundred metres,", "navd:600m": "In six hundred metres,", "navd:700m": "In seven hundred metres,", "navd:800m": "In eight hundred metres,",
    "navd:900m": "In nine hundred metres,", "navd:1km": "In one kilometre,", "navd:1.1km": "In one point one kilometres,", "navd:1.2km": "In one point two kilometres,",
    "navd:1.3km": "In one point three kilometres,", "navd:1.4km": "In one point four kilometres,", "navd:1.5km": "In one point five kilometres,",
    "line:rerouting": "Rerouting.", "line:back_on_route": "Back on route.", "line:staying": "Staying on this route.",
    "line:traffic_ahead": "Traffic ahead.", "line:minute_slower": "minute slower.", "line:minutes_slower": "minutes slower.",
    "line:switching": "Switching to a faster road.",
    "line:bump_ahead": "Bump ahead.",
    "line:rep_pothole": "Pothole reported ahead.", "line:rep_gravel": "Gravel reported ahead.", "line:rep_debris": "Debris reported ahead.",
    "line:rep_animal": "Animal reported ahead.", "line:rep_police": "Police reported ahead.", "line:rep_closure": "Road closed reported ahead.",
    "line:rep_hazard": "Hazard reported ahead.",
    "line:memo_brake_after_apex": "Last time, braking past the apex. Brake earlier.",
    "line:memo_coast": "Last time, coasting here. Brake, then throttle.",
    "line:memo_early_apex": "Last time, an early apex. Turn in later.",
    "line:break_steering": "Steering is getting busier. Time for a break?",
    "line:break_braking": "Braking is getting later. Time for a break?",
    "line:break_time": "Two hours on the road. Time for a break?",
    "line:regroup": "Regroup.", "line:regroup_set": "Regroup point set.",
    "line:track_mode": "Track mode. Tap start finish when you cross the line.",
    "line:lap": "Lap", "line:best": "Best."
  } /* END_VOICE_LINES_JSON */;

  // Valhalla maneuver type -> verb token (web/directions.js VERB says the same words with the street name).
  const VERB = { 9: 'nav:bear_right', 10: 'nav:turn_right', 11: 'nav:sharp_right', 12: 'nav:u_turn', 13: 'nav:u_turn', 14: 'nav:sharp_left',
    15: 'nav:turn_left', 16: 'nav:bear_left', 17: 'nav:ramp', 18: 'nav:ramp_right', 19: 'nav:ramp_left', 20: 'nav:exit_right', 21: 'nav:exit_left',
    23: 'nav:keep_right', 24: 'nav:keep_left', 25: 'nav:merge', 37: 'nav:merge_right', 38: 'nav:merge_left', 4: 'nav:arrive', 5: 'nav:arrive', 6: 'nav:arrive' };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

  /** A maneuver { type, exits } -> its verb tokens, or null when the pack can't say it. */
  function maneuver(s) {
    if (!s) return null;
    if (s.type === 26) return [Number.isInteger(s.exits) && s.exits >= 1 && s.exits <= 6 ? `nav:rb${s.exits}` : 'nav:rbnext'];
    return VERB[s.type] ? [VERB[s.type]] : null;
  }
  /** distWords() text -> its lead-in token ("half a mile" -> navd:0.5mi), or null. */
  function distToken(words) {
    const m = /^(\d+(?:\.\d+)?|half a) (feet|miles?|metres|kilometres?|mile)$/.exec(String(words || ''));
    if (!m) return null;
    if (m[1] === 'half a') return 'navd:0.5mi';
    const n = m[1], u = m[2].startsWith('f') ? 'ft' : m[2].startsWith('mi') ? 'mi' : m[2].startsWith('me') ? 'm' : 'km';
    const key = `navd:${n}${u}`;
    return TEXT[key] ? key : null;
  }
  /** A lane hint ("the left 2 lanes") -> its token, or null. */
  function laneToken(hint) {
    const m = /^(?:the |a )(left|right|middle) (?:(\d) )?lanes?$/.exec(String(hint || ''));
    if (!m) return null;
    const key = `lane:${m[1]}${m[2] || 1}`;
    return TEXT[key] ? key : null;
  }
  /** The fixed lines said by their exact text (a line with numbers or names is built where it is said). */
  const BY_TEXT = {};
  for (const [k, v] of Object.entries(TEXT)) if (k.startsWith('line:')) BY_TEXT[v.replace(/\.$/, '')] = [k];
  BY_TEXT['Quiet. Hazards only'] = ['sys:cruise'];
  BY_TEXT['Full notes'] = ['sys:stage'];
  function forText(text) { return BY_TEXT[String(text || '').trim().replace(/\.$/, '')] || null; }
  /** A number 0-99 as the score clips say it (n:0..n:99), or null. */
  const num = (n) => (Number.isInteger(n) && n >= 0 && n < 100 ? `n:${n}` : null);

  // ---- the three co-drivers (REVIEW.md 4.4, REVIEW5 U-113) ---------------------------------------------------------------
  // The call is the same in every pack: direction, severity, "careful", the distances, word for word. The character is in
  // the words around it: the pack's own system lines, an aside after some calls (said from its own clip, after the call and
  // only when nothing else is waiting), its sign-offs, and Hale's delivery (card: each part its own sentence). Every line
  // here is rendered into that pack's bank by tools/voicebank.py, which reads the JSON between the markers. Rules for
  // every pack: no speed numbers, no praise for pace, nothing that tells a driver to go faster.
  const PACKS = /* VOICE_PACKS_JSON */ {
    "marguerite": {
      "card": false,
      "lines": {
        "sys:test": "Notes ready. Have a good one.", "sys:stage": "Full notes.", "sys:cruise": "Quiet from here. Bumps and cameras only.",
        "sys:end": "That's the drive.", "sys:end2": "And that's the stage.", "sys:end3": "Notes closed. Have a good one.", "sys:end4": "That's the last corner. Lovely road.",
        "end:score": "Score", "end:best": "your best on this road.",
        "sys:sample": "Left four, tightens. Watch the exit, it closes.", "sys:sample_plain": "Open left, tightens. Watch the exit, it closes.",
        "aside:hairpin": "Brake before it, not in it.", "aside:acute": "Brake well before this one.", "aside:square": "Brake in a straight line.",
        "aside:tightens": "Watch the exit, it closes.", "aside:off-camber": "The road falls away. Gently.", "aside:over crest": "Over the top, keep it straight.",
        "aside:opens": "It opens on the exit.", "aside:long": "It goes on a while.", "aside:crest": "Keep it straight over the top."
      }
    },
    "kit": {
      "card": false,
      "lines": {
        "sys:test": "Tape's in. Let's keep it tidy.", "sys:stage": "Full notes. Here we go.", "sys:cruise": "Quiet now. Hazards only.",
        "sys:end": "That's a wrap.", "sys:end2": "Tape's out.", "sys:end3": "That's the B-side done.", "sys:end4": "Rewind it some other day.",
        "end:best": "Best yet on this road.",
        "sys:sample": "Left four, tightens. Easy in, late out.", "sys:sample_plain": "Open left, tightens. Easy in, late out.",
        "aside:hairpin": "All the way round. Patience.", "aside:acute": "Proper tight one. Wait for it.", "aside:square": "Square one. Tidy does it.",
        "aside:tightens": "Easy in, late out.", "aside:off-camber": "Leans the wrong way. Smooth.", "aside:over crest": "Light hands over the top.",
        "aside:opens": "Lets you out gently.", "aside:long": "Long one. Settle in.", "aside:crest": "Crest. Light hands."
      }
    },
    "hale": {
      "card": true,
      "lines": {
        "sys:test": "Route loaded.", "sys:stage": "Full notes.", "sys:cruise": "Hazards only.",
        "sys:end": "Complete.", "sys:end2": "Run complete.", "sys:end3": "End of card.", "sys:end4": "Logged. Stand down.",
        "end:score": "Score,", "end:best": "Best on this road.",
        "sys:sample": "Left four. Tightens. Late apex.", "sys:sample_plain": "Open left. Tightens. Late apex.",
        "aside:hairpin": "Brake straight. Then turn.", "aside:acute": "Brake straight.", "aside:square": "Square. Late apex.",
        "aside:tightens": "Late apex.", "aside:off-camber": "Negative camber.", "aside:over crest": "Car goes light.",
        "aside:opens": "Exit opens.", "aside:long": "Hold the line.", "aside:crest": "Car goes light."
      }
    }
  } /* END_VOICE_PACKS_JSON */;
  const packOf = (id) => (Object.prototype.hasOwnProperty.call(PACKS, id) ? PACKS[id] : null);
  /** A pack's line by token ("sys:cruise"), or null: the words the transcript and the phone's own voice say for that clip. */
  function packLine(id, token) { const p = packOf(id); return (p && p.lines[token]) || null; }

  // Panel round 2 MA-1 / LA-4: going quiet is a falling chime and how far the quiet lasts, in the pack's own words (the
  // chime says "quiet"; only the distance needs words). `span` is note_timing.js quietSpan ("two miles"); null says nothing.
  const QUIET = { marguerite: (d) => `Quiet for ${d}.`, kit: (d) => `Nothing for ${d}.`, hale: (d) => `Clear, ${d}.` };
  function quietLine(id, span) { return span ? (Object.prototype.hasOwnProperty.call(QUIET, id) ? QUIET[id] : QUIET.marguerite)(span) : null; }
  /**
   * DA-3: the drive's first words name the road, then the notes' state in the pack's words: "Dry Ridge Road. Full notes.",
   * "Dry Ridge Road. Quiet for two miles.". null when the road is unknown (unknown stays unknown: the chime and the strip
   * carry the mode, and the first call is the first line).
   */
  function openerLine(id, { road, awake, span = null }) {
    const name = String(road || '').trim();
    if (!name) return null;
    const mode = awake ? packLine(id, 'sys:stage') || 'Full notes.' : quietLine(id, span) || packLine(id, 'sys:cruise') || 'Quiet from here. Bumps and cameras only.';
    return `${name.replace(/[.\s]+$/, '')}. ${mode}`;
  }

  // Which aside a call earns, most telling first. A call with a real warning in it ("slow down" and up) gets none: the
  // warning is the last thing heard. A run of chained corners gets none: the next call is coming.
  const ASIDE_SHAPES = { hairpin: 'aside:hairpin', acute: 'aside:acute', square: 'aside:square' };
  const ASIDE_MODS = ['tightens', 'off-camber', 'over crest', 'opens', 'long'];
  // Panel round 1 M-2: a call that names a next corner, or says the distance to one, is the last word: no aside after it
  // ("It goes on a while." landed after "…then square left in a quarter mile", about the wrong corner).
  function asideToken(chain) {
    if (!Array.isArray(chain) || chain.length !== 1) return null;
    const e = chain[0];
    if (!e) return null;
    if (e.link && e.link !== 'into' && e.link !== 'and') return null;
    if (e.type === 'crest') return 'aside:crest';
    if (e.type !== 'corner' || e.recce || (e.caution || 0) >= 2) return null;
    if (e.severity === 'HP') return 'aside:hairpin';
    if (ASIDE_SHAPES[e.shape]) return ASIDE_SHAPES[e.shape];
    const m = ASIDE_MODS.find((k) => (e.mods || []).includes(k));
    return m ? `aside:${m}` : null;
  }
  /**
   * Asides are rare, or they stop being character and become noise: at most one every GAP_MS, and the same one not again
   * within SAME_MS. pick(pack, chain, now) -> { token, text } or null; `has(token)` (the loaded bank) leaves out a clip
   * the bank doesn't have yet, so a bank rendered before the asides says none rather than the phone's voice saying them.
   */
  const ASIDE_GAP_MS = 45000, ASIDE_SAME_MS = 180000;
  // Panel round 1 M-2: two kinds of aside. Advice tells the driver what to do with the corner ("Brake before it, not in it",
  // "Late apex"); round 2 MA-3: it rides INSIDE the call, as its last sentence, or is not said. Colour is character ("Long
  // one. Settle in."), its own clip straight after the call. The call starts early enough that both end before the braking
  // starts and never under 4 s out (note_timing.js asideWindow). Which lines are advice is decided per pack, by what the
  // line asks of the driver.
  const ADVICE = {
    marguerite: ['aside:hairpin', 'aside:acute', 'aside:square', 'aside:tightens', 'aside:off-camber', 'aside:over crest', 'aside:crest'],
    kit: ['aside:tightens', 'aside:over crest', 'aside:crest'],
    hale: ['aside:hairpin', 'aside:acute', 'aside:square', 'aside:tightens', 'aside:long'],
  };
  /** 'advice' or 'colour' for a pack's aside token. */
  const asideKind = (pack, token) => ((ADVICE[pack] || []).includes(token) ? 'advice' : 'colour');
  function createAsides({ gapMs = ASIDE_GAP_MS, sameMs = ASIDE_SAME_MS } = {}) {
    let lastAt = -Infinity;
    const said = new Map();
    return {
      // fits({ token, text, kind }): whether it can still be said in time (M-2); one that can't is dropped and not counted
      pick(pack, chain, now, has = () => true, fits = () => true) {
        const token = asideToken(chain), text = token && packLine(pack, token);
        if (!text || !has(token) || now - lastAt < gapMs || now - (said.get(token) ?? -Infinity) < sameMs) return null;
        const kind = asideKind(pack, token);
        if (!fits({ token, text, kind })) return null;
        lastAt = now; said.set(token, now);
        return { token, text, kind };
      },
      reset() { lastAt = -Infinity; said.clear(); },
    };
  }
  /** The theme card's quote and the clip its Hear key plays: a line the pack really says in the driver's words mode. */
  function sample(id, words) {
    const token = words === 'plain' ? 'sys:sample_plain' : 'sys:sample';
    const text = packLine(id, token);
    return text ? { token, text } : null;
  }
  /** The pack's sign-offs, in order: sys:end, sys:end2... (web/end_line.js picks one per drive). */
  function signOffs(id) { const p = packOf(id); return p ? Object.keys(p.lines).filter((k) => /^sys:end\d*$/.test(k)) : []; }

  const api = { TEXT, PACKS, ADVICE, maneuver, distToken, laneToken, forText, num, packLine, quietLine, openerLine, asideToken, asideKind, createAsides, sample, signOffs, ASIDE_GAP_MS, ASIDE_SAME_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexVoiceLines = api;
})(typeof window !== 'undefined' ? window : globalThis);
