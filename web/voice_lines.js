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

  const api = { TEXT, maneuver, distToken, laneToken, forText, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexVoiceLines = api;
})(typeof window !== 'undefined' ? window : globalThis);
