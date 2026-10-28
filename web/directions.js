// Spoken directions at junctions, in the same voice as the pace notes (IDEAS V-04). The router's maneuvers, placed along
// the route, become two calls each: one early ("In 0.3 miles, turn left onto Deals Gap Road") and one at the turn ("Turn
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

  /** "500 feet", "0.3 miles", "half a mile", "1 mile": US units, rounded the way people say them. */
  function distWords(m) {
    const mi = m / M_PER_MI;
    if (mi < 0.15) return `${Math.max(100, Math.round(m * FT_PER_M / 100) * 100)} feet`;
    const r = Math.round(mi * 10) / 10;
    if (r === 0.5) return 'half a mile';
    if (r === 1) return '1 mile';
    return `${r} miles`;
  }

  /** What to say for a maneuver { type, street, exits }, or null for one that isn't said. */
  function phrase(s) {
    const verb = VERB[s.type];
    if (!verb) return null;
    if (ARRIVE.has(s.type)) return 'Arriving at your destination';
    const onto = s.street ? ` onto ${s.street}` : '';
    if (s.type === 26) return `At the roundabout, take the ${finite(s.exits) && s.exits > 0 ? ord(s.exits) : 'next'} exit${onto}`;
    return verb + onto;
  }

  /** When to call: early from max(400 m, 30 s) out but not inside max(150 m, 10 s); at the turn inside max(40 m, 5 s). */
  const earlyFar = (v) => Math.max(400, v * 30), earlyNear = (v) => Math.max(150, v * 10), nowAt = (v) => Math.max(40, v * 5);

  /**
   * The lines due at `cursorM` (metres along the route) at `vMps`: [{ key, text, now, atM }]. `steps` are [{ m, type,
   * street, exits }] in route order; `said` holds keys already said (the page adds them). `id` keeps keys per route.
   */
  function due(steps, cursorM, vMps, said, id = '') {
    const out = [], v = finite(vMps) ? Math.max(0, vMps) : 0;
    if (!Array.isArray(steps) || !finite(cursorM)) return out;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], d = s.m - cursorM;
      if (d < -5) continue;
      if (d > earlyFar(v)) break;
      const text = phrase(s);
      if (!text) continue;
      const kNow = `${id}:dir:${i}:now`, kEarly = `${id}:dir:${i}:early`;
      if (d <= nowAt(v)) {
        if (said.has(kNow)) continue;
        const next = steps[i + 1], nextText = next && next.m - s.m <= THEN_M && !ARRIVE.has(next.type) ? phrase(next) : null;
        out.push({ key: kNow, text: nextText ? `${text}, then ${lower(nextText)}` : text, now: true, atM: s.m });
        said.add(kEarly);
        if (nextText) said.add(`${id}:dir:${i + 1}:early`);
      } else if (d >= earlyNear(v) && !said.has(kEarly) && !ARRIVE.has(s.type)
                 && !(i > 0 && s.m - steps[i - 1].m <= THEN_M && phrase(steps[i - 1]))) {   // said as the "then" of the one before
        out.push({ key: kEarly, text: `In ${distWords(d)}, ${lower(text)}`, now: false, atM: s.m });
      }
    }
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
      if (finite(m) && (!out.length || m >= out[out.length - 1].m)) out.push({ m, type: r.type, street: r.street || null, exits: finite(r.exits) ? r.exits : null });
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
    const code = s.type === 26 && finite(s.exits) && s.exits > 0 ? `Roundabout · exit ${s.exits}` : x[0];
    return { code, call: ARRIVE.has(s.type) ? 'Destination' : s.street || '', dir: x[1], angle: x[2] };
  }

  const api = { due, phrase, distWords, atJunction, placeSteps, stripNote, VERB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDirections = api;
})(typeof window !== 'undefined' ? window : globalThis);
