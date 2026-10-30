// Spoken directions at junctions, in the same voice as the pace notes (IDEAS V-04). The router's maneuvers, placed along
// the route, become a ladder of calls each: early ("In 0.3 miles, turn left onto Deals Gap Road"), near, and at the turn ("Turn
// left onto Deals Gap Road", with ", then right" when the next one follows straight after). The call at the turn goes ahead
// of corner notes; a corner note at a junction is left out, so a turn is never called twice (once as "left 3", once as a
// direction). Pure (tests/test_directions.py); the page says what due() returns.
(function (root) {
  'use strict';
  // Valhalla maneuver types -> what to say. Starts (0-3), "becomes" (7), "continue" (8), "stay straight" (22), roundabout
  // exits (27, said with the entry) and ferries are left out.
  const VERB = {
    9: 'Bear right', 10: 'Turn right', 11: 'Sharp right', 12: 'Make a U-turn', 13: 'Make a U-turn', 14: 'Sharp left', 15: 'Turn left', 16: 'Bear left',
    17: 'Take the ramp', 18: 'Take the ramp on the right', 19: 'Take the ramp on the left', 20: 'Take the exit on the right', 21: 'Take the exit on the left',
    23: 'Keep right', 24: 'Keep left', 25: 'Merge', 37: 'Merge right', 38: 'Merge left', 26: 'At the roundabout', 4: 'Arrive', 5: 'Arrive', 6: 'Arrive',
  };
  const ARRIVE = new Set([4, 5, 6]);
  const THEN_M = 150, JUNCTION_M = 35, M_PER_MI = 1609.344, FT_PER_M = 3.28084;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  /**
   * "500 feet", "0.3 miles", "half a mile", "1 mile"; or with metric units (units.js, U-22) "300 metres", "1.5 kilometres",
   * "1 kilometre": rounded the way people say them.
   */
  function distWords(m) {
    if (root.ApexUnits && root.ApexUnits.metric()) {
      if (m < 950) return `${Math.max(100, Math.round(m / 100) * 100)} metres`;
      const k = Math.round(m / 100) / 10;
      return k === 1 ? '1 kilometre' : `${k} kilometres`;
    }
    const mi = m / M_PER_MI;
    if (mi < 0.15) return `${Math.max(100, Math.round(m * FT_PER_M / 100) * 100)} feet`;
    const r = Math.round(mi * 10) / 10;
    if (r === 0.5) return 'half a mile';
    if (r === 1) return '1 mile';
    return `${r} miles`;
  }

  /** What to say for a maneuver { type, street, exits, exit, toward }, or null for one that isn't said. */
  function phrase(s) {
    const verb = VERB[s.type];
    if (!verb) return null;
    if (ARRIVE.has(s.type)) return 'Arriving at your destination';
    // a numbered exit says its number and where it goes, as the sign does (IDEAS R-29): "Take exit 386B toward Airport"
    if (s.exit && s.type >= 17 && s.type <= 21) return `Take exit ${s.exit}${s.toward ? ` toward ${s.toward}` : s.street ? ` onto ${s.street}` : ''}`;
    const onto = s.street ? ` onto ${s.street}` : s.toward && s.type >= 17 && s.type <= 25 ? ` toward ${s.toward}` : '';
    if (s.type === 26) return `At the roundabout, take the ${finite(s.exits) && s.exits > 0 ? ord(s.exits) : 'next'} exit${onto}`;
    return verb + onto;
  }

  // The same line from the voice pack's clips (web/voice_lines.js), without the street name, which stays on the screen;
  // null when a piece isn't in the packs (the caller then says the full text another way).
  function packTokens(dist, s, next, lane) {
    const L = root.ApexVoiceLines;
    if (!L) return null;
    const out = [];
    if (dist) { const d = L.distToken(dist); if (!d) return null; out.push(d); }
    const v = L.maneuver(s); if (!v) return null; out.push(...v);
    if (next) { const n = L.maneuver(next); if (!n) return null; out.push('nav:then', ...n); }
    if (lane) { const l = L.laneToken(lane); if (l) out.push(l); }
    return out;
  }

  // One maneuver at a time, in road order, as Apple Maps and Google Maps do (the owner's drive, 2026-10-30: "'take exit 19 in
  // 0.1 miles', then 'sharp right in 1 mile', then 'take exit 19'. This is bad and confusing"). The old version called every
  // turn inside its window, so a sharp right a mile past the exit had its "In 0.6 miles" said between the exit's two calls.
  // Now only the next turn not yet taken is said; nothing past a junction is announced until the car is TAKEN_M beyond it,
  // and a turn once taken is never reinstated by a fix that falls back over it (createProgress). A turn's prompts are a fixed
  // ladder said once each: far (30 s out, 400 m to 1 mile), near (12 s, 150 to 400 m) and at the turn (5 s, at least 40 m);
  // a rung reached too close to the turn's own call (inside 3 s of it) is left out.
  const TAKEN_M = 30, BACK_M = 200;
  const farAt = (v) => Math.min(M_PER_MI, Math.max(400, v * 30)), nearAt = (v) => Math.min(400, Math.max(150, v * 12)), nowAt = (v) => Math.max(40, v * 5);
  const clearOfNow = (v) => nowAt(v) + v * 3;

  /** The index of the next turn not yet taken at `cursorM` (a turn is taken TAKEN_M past it), or -1. Stateless. */
  function pendingAt(steps, cursorM) {
    if (!Array.isArray(steps) || !finite(cursorM)) return -1;
    return steps.findIndex((s) => s && finite(s.m) && phrase(s) && cursorM <= s.m + TAKEN_M);
  }

  /**
   * The next turn as the drive takes them, shared by the voice and the car's card: at(steps, cursorM, routeId) -> its index,
   * or -1. Latched: a turn once taken stays taken while the cursor jitters back over it (GPS at a motorway diverge). A new
   * route, or the car BACK_M behind the last turn taken (a replay seek, the same loop again), starts it over.
   */
  function createProgress(takenM = TAKEN_M) {
    let id = null, list = null, i = 0;
    return {
      at(steps, cursorM, routeId = '') {
        if (!Array.isArray(steps) || !finite(cursorM)) return -1;
        if (routeId !== id || steps !== list || (i > 0 && steps[i - 1] && cursorM < steps[i - 1].m - BACK_M)) { id = routeId; list = steps; i = 0; }
        while (i < steps.length && (!steps[i] || !finite(steps[i].m) || !phrase(steps[i]) || cursorM > steps[i].m + takenM)) i++;
        return i < steps.length ? i : -1;
      },
      reset() { id = null; list = null; i = 0; },
    };
  }

  /**
   * The line due at `cursorM` (metres along the route) at `vMps`, for the next turn only: [] or [{ key, text, now, atM }].
   * `steps` are [{ m, type, street, exits }] in route order; `said` holds keys already said (the page adds them). `id` keeps
   * keys per route. `at` is that turn's index from createProgress (else found here, unlatched).
   */
  function due(steps, cursorM, vMps, said, id = '', at = null) {
    const out = [], v = finite(vMps) ? Math.max(0, vMps) : 0;
    if (!Array.isArray(steps) || !finite(cursorM)) return out;
    const i = Number.isInteger(at) ? at : pendingAt(steps, cursorM), s = steps[i];
    const text = s && finite(s.m) ? phrase(s) : null;
    if (!text) return out;
    const d = s.m - cursorM, key = (rung, j = i) => `${id}:dir:${j}:${rung}`;
    if (d > farAt(v)) return out;
    if (d <= nowAt(v)) {
      if (said.has(key('now'))) return out;
      const next = steps[i + 1], nextText = next && next.m - s.m <= THEN_M && !ARRIVE.has(next.type) ? phrase(next) : null;
      out.push({ key: key('now'), text: nextText ? `${text}, then ${lower(nextText)}` : text, now: true, atM: s.m,
                 tokens: packTokens(null, s, nextText ? next : null, null) });
      said.add(key('early')); said.add(key('near'));                  // the ladder is over: no rung after its turn's call
      if (nextText) { said.add(key('early', i + 1)); said.add(key('near', i + 1)); }
      return out;
    }
    if (ARRIVE.has(s.type) || d < clearOfNow(v)) return out;
    if (i > 0 && steps[i - 1] && s.m - steps[i - 1].m <= THEN_M && phrase(steps[i - 1])) return out;   // said as the "then" of the one before
    const rung = d <= nearAt(v) ? 'near' : 'early';
    if (said.has(key(rung))) return out;
    if (rung === 'near') said.add(key('early'));                        // first seen inside the near rung: the far one is past
    // the lanes go with the early calls, while there is time to move over: ", use the left 2 lanes"
    const lane = root.ApexLanes && s.lanes ? root.ApexLanes.hint(s.lanes) : null;
    out.push({ key: key(rung), text: `In ${distWords(d)}, ${lower(text)}${lane ? `, use ${lane}` : ''}`, now: false, atM: s.m,
               tokens: packTokens(distWords(d), s, null, lane) });
    return out;
  }

  /** True when a corner note at `m` is a junction a direction will call (so the note is left out). */
  function atJunction(steps, m) {
    return Array.isArray(steps) && finite(m) && steps.some((s) => VERB[s.type] && !ARRIVE.has(s.type) && Math.abs(s.m - m) <= JUNCTION_M);
  }

  /** The router's maneuvers [{ lon, lat, type, street, exits }] placed on a track by `place(lat, lon)` -> metres or null. */
  function placeSteps(raw, place) {
    const out = [];
    for (const r of raw || []) {
      if (!VERB[r.type]) continue;
      const m = place(r.lat, r.lon);
      if (finite(m) && (!out.length || m >= out[out.length - 1].m)) out.push({ m, type: r.type, street: r.street || null, exits: finite(r.exits) ? r.exits : null,
        ...(r.lanes ? { lanes: r.lanes } : {}), ...(r.exit ? { exit: r.exit } : {}), ...(r.toward ? { toward: r.toward } : {}) });
    }
    return out;
  }

  // For the road-book strip: a short verb, the road, and how the tulip draws it (dir L/R/S/U/O/A, angle in degrees).
  const SHORT = {
    9: ['Bear right', 'R', 45], 10: ['Right', 'R', 90], 11: ['Sharp right', 'R', 135], 12: ['U-turn', 'U', 180], 13: ['U-turn', 'U', 180],
    14: ['Sharp left', 'L', 135], 15: ['Left', 'L', 90], 16: ['Bear left', 'L', 45], 17: ['Ramp', 'S', 0], 18: ['Ramp right', 'R', 30],
    19: ['Ramp left', 'L', 30], 20: ['Exit right', 'R', 30], 21: ['Exit left', 'L', 30], 23: ['Keep right', 'R', 20], 24: ['Keep left', 'L', 20],
    25: ['Merge', 'S', 0], 37: ['Merge right', 'R', 20], 38: ['Merge left', 'L', 20], 26: ['Roundabout', 'O', 0], 4: ['Arrive', 'A', 0], 5: ['Arrive', 'A', 0], 6: ['Arrive', 'A', 0],
  };
  /** { code, call, dir, angle } for a maneuver in the strip, or null for one that isn't shown. */
  function stripNote(s) {
    const x = SHORT[s.type];
    if (!x) return null;
    const code = s.type === 26 && finite(s.exits) && s.exits > 0 ? `Roundabout · exit ${s.exits}` : s.exit && s.type >= 17 && s.type <= 21 ? `Exit ${s.exit}` : x[0];
    return { code, call: ARRIVE.has(s.type) ? 'Destination' : s.street || s.toward || '', dir: x[1], angle: x[2], ...(s.lanes ? { lanes: s.lanes } : {}) };
  }

  const api = { due, phrase, distWords, atJunction, placeSteps, stripNote, pendingAt, createProgress, TAKEN_M, VERB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDirections = api;
})(typeof window !== 'undefined' ? window : globalThis);
