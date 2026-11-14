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
    "line:pass_best": "Best yet through there.", "line:pass_smooth": "Smoother on your best.",
    "line:pass_brake": "Brakes were cleaner on your best.", "line:pass_stretch_best": "Best stretch yet.",
    "line:pass_level": "Level with your best.",
    "line:break_steering": "Steering is getting busier. Time for a break?",
    "line:break_braking": "Braking is getting later. Time for a break?",
    "line:break_time": "Two hours on the road. Time for a break?",
    "line:regroup": "Regroup.", "line:regroup_set": "Regroup point set.",
    "line:track_mode": "Track mode. Tap start finish when you cross the line.",
    "line:lap": "Lap", "line:best": "Best.",
    "mark:stop": "Stop sign", "mark:level_crossing": "Railway crossing", "mark:one_lane_bridge": "One-lane bridge", "mark:calming": "Speed bump",
    "mark:calming_many": "Speed bumps", "mark:deer": "Deer crossing", "mark:horse": "Horse crossing", "mark:cattle": "Cattle crossing",
    "mark:animal": "Animal crossing", "mark:buggy": "Horse-drawn buggies", "mark:covered_bridge": "Covered bridge", "mark:ford": "Water crossing",
    "mark:unpaved": "Unpaved road", "mark:rough": "Rough road", "line:sun_ahead": "Sun in your eyes ahead.", "line:brakes_hot": "Brakes are getting hot. Use a lower gear and ease off.",
    "line:descent": "Long descent ahead. A lower gear saves the brakes.", "dot:crash": "Crash ahead.", "dot:lane": "Lane closed ahead.",
    "dot:ramp": "Ramp closed ahead.", "dot:closure": "Road closed ahead.", "dot:roadwork": "Roadwork ahead.", "dot:obstruction": "Obstruction ahead.",
    "dot:slow": "Slow traffic ahead.", "dot:stop_go": "Stop and go ahead.", "dot:weather": "Weather ahead.", "dot:alert": "Traffic alert ahead.",
    "dot:closed_north": "Closed northbound ahead.", "dot:closed_south": "Closed southbound ahead.", "dot:closed_east": "Closed eastbound ahead.",
    "dot:closed_west": "Closed westbound ahead.", "lim:10": "Limit 10 ahead.", "lim:15": "Limit 15 ahead.", "lim:20": "Limit 20 ahead.",
    "lim:25": "Limit 25 ahead.", "lim:30": "Limit 30 ahead.", "lim:35": "Limit 35 ahead.", "lim:40": "Limit 40 ahead.", "lim:45": "Limit 45 ahead.",
    "lim:50": "Limit 50 ahead.", "lim:55": "Limit 55 ahead.", "lim:60": "Limit 60 ahead.", "lim:65": "Limit 65 ahead.", "lim:70": "Limit 70 ahead.",
    "lim:75": "Limit 75 ahead.", "lim:80": "Limit 80 ahead.", "lim:85": "Limit 85 ahead.", "lim:90": "Limit 90 ahead.", "lim:95": "Limit 95 ahead.",
    "lim:100": "Limit 100 ahead.", "lim:105": "Limit 105 ahead.", "lim:110": "Limit 110 ahead.", "lim:115": "Limit 115 ahead.",
    "lim:120": "Limit 120 ahead.", "lim:125": "Limit 125 ahead.", "lim:130": "Limit 130 ahead.", "flow:5": "Five clean in a row.",
    "flow:10": "Ten clean in a row.", "flow:20": "Twenty clean in a row.", "flow:30": "Thirty clean in a row.", "flow:40": "Forty clean in a row.",
    "flow:50": "Fifty clean in a row.", "flow:60": "Sixty clean in a row.", "flow:70": "Seventy clean in a row.", "flow:80": "Eighty clean in a row.",
    "flow:90": "Ninety clean in a row.", "frag:clean_best": "clean in a row, your best this month.", "frag:clean": "clean in a row.", "frag:miles_c": "miles,",
    "frag:kilometres_c": "kilometres,", "frag:corners_c": "corners,", "frag:corners": "corners.", "frag:hairpin": "hairpin.", "frag:hairpins": "hairpins.",
    "frag:twisty": "Twisty section ahead.", "span:half a mile": "half a mile.", "span:three quarters of a mile": "three quarters of a mile.",
    "span:a mile": "a mile.", "span:one and a half miles": "one and a half miles.", "span:two miles": "two miles.", "span:two and a half miles": "two and a half miles.",
    "span:three miles": "three miles.", "span:three and a half miles": "three and a half miles.", "span:four miles": "four miles.",
    "span:four and a half miles": "four and a half miles.", "span:five miles": "five miles.", "span:five and a half miles": "five and a half miles.",
    "span:six miles": "six miles.", "span:six and a half miles": "six and a half miles.", "span:seven miles": "seven miles.", "span:seven and a half miles": "seven and a half miles.",
    "span:eight miles": "eight miles.", "span:eight and a half miles": "eight and a half miles.", "span:nine miles": "nine miles.",
    "span:nine and a half miles": "nine and a half miles.", "span:ten miles": "ten miles.", "span:ten and a half miles": "ten and a half miles.",
    "span:eight hundred metres": "eight hundred metres.", "span:a kilometre": "a kilometre.", "span:one and a half kilometres": "one and a half kilometres.",
    "span:two kilometres": "two kilometres.", "span:two and a half kilometres": "two and a half kilometres.", "span:three kilometres": "three kilometres.",
    "span:three and a half kilometres": "three and a half kilometres.", "span:four kilometres": "four kilometres.", "span:four and a half kilometres": "four and a half kilometres.",
    "span:five kilometres": "five kilometres.", "span:five and a half kilometres": "five and a half kilometres.", "span:six kilometres": "six kilometres.",
    "span:six and a half kilometres": "six and a half kilometres.", "span:seven kilometres": "seven kilometres.", "span:seven and a half kilometres": "seven and a half kilometres.",
    "span:eight kilometres": "eight kilometres.", "span:eight and a half kilometres": "eight and a half kilometres.", "span:nine kilometres": "nine kilometres.",
    "span:nine and a half kilometres": "nine and a half kilometres.", "span:ten kilometres": "ten kilometres.", "span:ten and a half kilometres": "ten and a half kilometres.",
    "pl:c1": "Careful", "pl:tc1": "then careful", "pl:c2": "Slow down", "pl:tc2": "then slow down", "pl:c3": "Slow right down",
    "pl:tc3": "then slow right down", "pl:c4": "Very slow", "pl:tc4": "then very slow", "pl:h:tightL": "Tight left", "pl:th:tightL": "then tight left",
    "pl:h:tightR": "Tight right", "pl:th:tightR": "then tight right", "pl:h:mediumL": "Medium left", "pl:th:mediumL": "then medium left",
    "pl:h:mediumR": "Medium right", "pl:th:mediumR": "then medium right", "pl:h:openL": "Open left", "pl:th:openL": "then open left",
    "pl:h:openR": "Open right", "pl:th:openR": "then open right", "pl:h:easyL": "Easy left", "pl:th:easyL": "then easy left", "pl:h:easyR": "Easy right",
    "pl:th:easyR": "then easy right", "pl:h:slightL": "Slight left", "pl:th:slightL": "then slight left", "pl:h:slightR": "Slight right",
    "pl:th:slightR": "then slight right", "pl:h:hairpinL": "Hairpin left", "pl:th:hairpinL": "then hairpin left", "pl:h:hairpinR": "Hairpin right",
    "pl:th:hairpinR": "then hairpin right", "pl:h:squareL": "Square left", "pl:th:squareL": "then square left", "pl:h:squareR": "Square right",
    "pl:th:squareR": "then square right", "pl:m:tightens": "tightens", "pl:m:opens": "opens", "pl:m:long": "long", "pl:m:off-camber": "slopes away",
    "pl:m:over-crest": "over a crest", "pl:m:banked": "banked", "pl:m:short": "short", "pl:then": "then", "pl:in:50 feet": "in 50 feet",
    "pl:in:100 feet": "in 100 feet", "pl:in:150 feet": "in 150 feet", "pl:in:200 feet": "in 200 feet", "pl:in:250 feet": "in 250 feet",
    "pl:in:300 feet": "in 300 feet", "pl:in:350 feet": "in 350 feet", "pl:in:400 feet": "in 400 feet", "pl:in:450 feet": "in 450 feet",
    "pl:in:500 feet": "in 500 feet", "pl:in:550 feet": "in 550 feet", "pl:in:600 feet": "in 600 feet", "pl:in:650 feet": "in 650 feet",
    "pl:in:700 feet": "in 700 feet", "pl:in:750 feet": "in 750 feet", "pl:in:800 feet": "in 800 feet", "pl:in:850 feet": "in 850 feet",
    "pl:in:900 feet": "in 900 feet", "pl:in:950 feet": "in 950 feet", "pl:in:a quarter mile": "in a quarter mile", "pl:in:10 metres": "in 10 metres",
    "pl:in:20 metres": "in 20 metres", "pl:in:30 metres": "in 30 metres", "pl:in:40 metres": "in 40 metres", "pl:in:50 metres": "in 50 metres",
    "pl:in:60 metres": "in 60 metres", "pl:in:70 metres": "in 70 metres", "pl:in:80 metres": "in 80 metres", "pl:in:90 metres": "in 90 metres",
    "pl:in:100 metres": "in 100 metres", "pl:in:110 metres": "in 110 metres", "pl:in:120 metres": "in 120 metres", "pl:in:130 metres": "in 130 metres",
    "pl:in:140 metres": "in 140 metres", "pl:in:150 metres": "in 150 metres", "pl:in:160 metres": "in 160 metres", "pl:in:170 metres": "in 170 metres",
    "pl:in:180 metres": "in 180 metres", "pl:in:190 metres": "in 190 metres", "pl:in:200 metres": "in 200 metres", "pl:in:210 metres": "in 210 metres",
    "pl:in:220 metres": "in 220 metres", "pl:in:230 metres": "in 230 metres", "pl:in:240 metres": "in 240 metres", "pl:in:250 metres": "in 250 metres",
    "pl:in:260 metres": "in 260 metres", "pl:in:270 metres": "in 270 metres", "pl:in:280 metres": "in 280 metres", "pl:in:290 metres": "in 290 metres",
    "pl:in:300 metres": "in 300 metres", "pl:in:310 metres": "in 310 metres", "pl:in:320 metres": "in 320 metres", "pl:in:330 metres": "in 330 metres",
    "pl:in:340 metres": "in 340 metres", "pl:in:350 metres": "in 350 metres", "pl:in:360 metres": "in 360 metres", "pl:in:370 metres": "in 370 metres",
    "pl:in:380 metres": "in 380 metres", "pl:in:390 metres": "in 390 metres", "pl:in:400 metres": "in 400 metres", "pl:in:410 metres": "in 410 metres",
    "pl:in:420 metres": "in 420 metres"
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
  /** A number 0-999 as clips: n:48, or n:h1 + n:12 ("one hundred" "twelve"), or null. */
  function nums(n) {
    if (!Number.isInteger(n) || n < 0 || n > 999) return null;
    if (n < 100) return [`n:${n}`];
    const h = Math.floor(n / 100), r = n % 100;
    return r ? [`n:h${h}`, `n:${r}`] : [`n:h${h}`];
  }
  const WORD_N = {};
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen'].forEach((w, i) => { WORD_N[w] = i; });
  ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].forEach((w, i) => { WORD_N[w] = (i + 2) * 10;
    for (let k = 1; k < 10; k++) WORD_N[`${w}-${Object.keys(WORD_N)[k]}`] = (i + 2) * 10 + k; });
  const DOT = {};
  for (const [k, v] of Object.entries(TEXT)) if (k.startsWith('dot:')) DOT[v.replace(/ ahead\.$/, '').toLowerCase()] = k;
  /**
   * The pack's clips for a line built with numbers or a label (web/limit_ahead.js, flow_live.js, briefing.js,
   * corners_ahead.js, the DOTs' traffic events), word for word, or null: the caller then speaks the text with the phone's
   * voice. Fixed lines go through forText.
   */
  function compose(text) {
    const t = String(text || '').trim();
    let m;
    if ((m = /^Limit (\d+) ahead\.?$/.exec(t))) return TEXT[`lim:${m[1]}`] ? [`lim:${m[1]}`] : null;
    if ((m = /^([A-Za-z-]+|\d+) clean in a row(, your best this month)?\.?$/.exec(t))) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : WORD_N[m[1].toLowerCase()];
      if (n == null) return null;
      if (n >= 100) { const d = nums(n); return d ? [...d, m[2] ? 'frag:clean_best' : 'frag:clean'] : null; }
      if (!m[2] && TEXT[`flow:${n}`]) return [`flow:${n}`];
      return m[2] && n < 100 ? [`n:${n}`, 'frag:clean_best'] : null;
    }
    if ((m = /^(?:(\d+) (miles|kilometres), )?(\d+) corners(?:, (\d+) (hairpins?))?\.$/.exec(t))) {
      const out = [];
      if (m[1]) { const d = nums(+m[1]); if (!d) return null; out.push(...d, m[2] === 'miles' ? 'frag:miles_c' : 'frag:kilometres_c'); }
      const c = nums(+m[3]); if (!c) return null;
      out.push(...c, m[4] ? 'frag:corners_c' : 'frag:corners');
      if (m[4]) { const h = nums(+m[4]); if (!h) return null; out.push(...h, m[5] === 'hairpin' ? 'frag:hairpin' : 'frag:hairpins'); }
      return out;
    }
    if ((m = /^Twisty section ahead\. (\d+) corners\.$/.exec(t))) { const c = nums(+m[1]); return c ? ['frag:twisty', ...c, 'frag:corners'] : null; }
    if ((m = /^(.+) ahead\.?$/.exec(t)) && DOT[m[1].toLowerCase()]) return [DOT[m[1].toLowerCase()]];
    return null;
  }

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
        "end:score": "Score", "end:best": "your best on this road.", "sys:quiet_for": "Quiet for",
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
        "end:best": "Best yet on this road.", "sys:quiet_for": "Nothing for",
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
        "end:score": "Score,", "end:best": "Best on this road.", "sys:quiet_for": "Clear,",
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
  /** The clips for quietLine(id, span): the pack's own "Quiet for" and the span ("two miles."), or null past ten. */
  const quietTokens = (id, span) => (span && packLine(id, 'sys:quiet_for') && TEXT[`span:${span}`] ? ['sys:quiet_for', `span:${span}`] : null);
  /** The clips for openerLine's mode part (the road's name stays on the screen, as a direction's street does). */
  const openerTokens = (id, { awake, span = null }) => (awake ? (packLine(id, 'sys:stage') ? ['sys:stage'] : null) : quietTokens(id, span) || (packLine(id, 'sys:cruise') ? ['sys:cruise'] : null));
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

  const api = { TEXT, PACKS, ADVICE, maneuver, distToken, laneToken, forText, compose, nums, quietTokens, openerTokens, num, packLine, quietLine, openerLine, asideToken, asideKind, createAsides, sample, signOffs, ASIDE_GAP_MS, ASIDE_SAME_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexVoiceLines = api;
})(typeof window !== 'undefined' ? window : globalThis);
