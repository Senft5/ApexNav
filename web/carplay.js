// What the car's screen is told (CarPlay/ApexCarPlay.swift, docs/CARPLAY.md). The page plans and guides; these build the
// `{cmd:'car', kind}` messages from its state. Pure (tests/test_carplay.py): the page posts what they return.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const MAX_POINTS = 2000, LINE_TOL_M = 2.5;

  /**
   * The route line for the base map: at most MAX_POINTS [lat, lon], both ends kept. F-01: the car's arrow is dead reckoned
   * along this line (web/car_glide.js, CarGlide.swift), so it must follow the road: simplified to within LINE_TOL_M of every
   * point of the route (Douglas-Peucker), not every nth point (400 of a 57 km road's points were one every 140 m, a chord
   * across every hairpin). The tolerance doubles only if a very long route would need more points.
   */
  function line(t) {
    if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return [];
    const n = t.lat.length, c = Math.cos(t.lat[0] * Math.PI / 180), x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = (t.lon[i] - t.lon[0]) * 111320 * c; y[i] = (t.lat[i] - t.lat[0]) * 110540; }
    let keep;
    for (let tol = LINE_TOL_M; ; tol *= 2) {
      keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
      const stack = [[0, n - 1]];
      while (stack.length) {
        const [a, b] = stack.pop(), dx = x[b] - x[a], dy = y[b] - y[a], L2 = dx * dx + dy * dy;
        let far = -1, worst = tol;
        for (let i = a + 1; i < b; i++) {   // from the segment, not its line: a road that bends back past an end is kept
          const u = L2 > 0 ? Math.max(0, Math.min(1, ((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / L2)) : 0;
          const d = Math.hypot(x[a] + u * dx - x[i], y[a] + u * dy - y[i]);
          if (d > worst) { worst = d; far = i; }
        }
        if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
      }
      let count = 0; for (let i = 0; i < n; i++) count += keep[i];
      if (count <= MAX_POINTS) break;
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push([+t.lat[i].toFixed(6), +t.lon[i].toFixed(6)]);
    return out;
  }

  /**
   * A planned route for the trip preview: its line, where it ends and up to three choices ("11 good corners · 77 min").
   * `options` is the card's list ({ fun, timeS, route: { coords } }); a route without options is one choice. Panel round 2
   * SO-1: no "Fun 99" (Fun is the route style, never a number; web/vocabulary.js): the fun score's good corners instead.
   */
  function routeMessage(t, options, picked, fmtDist) {
    const pts = line(t);
    if (pts.length < 2) return null;
    const total = t.dist[t.dist.length - 1];
    const corners = Array.isArray(t.events) ? t.events.filter((e) => e && e.type === 'corner').length : null;
    // One route: the card's title is its name and the car prints the time and length itself, so the summary is what
    // neither says (its good corners, else the corners). Several: each choice's summary tells it from the others (good
    // corners and time). The owner's car showed "32 min loop" twice, 2026-10-29.
    const several = Array.isArray(options) && options.length > 1;
    const cornersText = (n) => (finite(n) ? `${n} corner${n === 1 ? '' : 's'}` : null);
    const goodText = (n) => (finite(n) ? `${n} good corner${n === 1 ? '' : 's'}` : null);
    const one = (good, timeS, distM, n) => ({
      summary: (several ? [goodText(good), finite(timeS) ? `${Math.round(timeS / 60)} min` : null]
        : [goodText(good) || cornersText(n)]).filter(Boolean).join(' · ') || 'Route',
      // U-89: one route's card prints its length on the estimates line and only the detail above it (the summary shows in
      // the Options list alone), so the detail is what the route is: its good corners and corners, the length only when
      // neither is known. The review recording's card read "35.4 mi" twice, its middle blank.
      detail: several ? [finite(distM) && fmtDist ? fmtDist(distM) : null, cornersText(n)].filter(Boolean).join(' · ')
        : [goodText(good), cornersText(n)].filter(Boolean).join(' · ') || (finite(distM) && fmtDist ? fmtDist(distM) : ''),
      timeS: finite(timeS) ? timeS : null, distM: finite(distM) ? distM : null,
    });
    const list = Array.isArray(options) && options.length > 1
      ? options.slice(0, 3).map((c, i) => one(c.fun ? c.fun.good : null, c.timeS, finite(c.distM) ? c.distM : null, i === picked ? corners : null))
      : [one(t.fun ? t.fun.good : null, t.timeS, total, corners)];
    if (Array.isArray(options) && options.length > 1 && list[picked]) {   // the picked one is built: its length and corners are known
      const p = list[picked], again = one(null, null, total, corners);
      p.distM = total; p.detail = again.detail;
    }
    return { kind: 'route', name: t.name || 'Route', coords: pts, dest: pts[pts.length - 1], options: list,
             picked: Number.isInteger(picked) && picked >= 0 && picked < list.length ? picked : 0 };
  }

  // A corner as guidance (the owner, 2026-10-29: "if you take a R5 when you're supposed to take a RHP you're gonna have a
  // bad time"): the card shows whichever comes first, the next turn or the next corner. `corners` picks which corners:
  // 'all' (every rating, the default), 'tight' (1, 2 and hairpins only: the fallback if App Review objects, docs/APP_REVIEW.md)
  // or 'off'. A corner within 40 m of a turn is the turn itself and is left to the turn.
  const CORNER_MODES = ['all', 'tight', 'off'];
  const isHairpin = (e) => e.severity === 'HP' || e.shape === 'hairpin';
  const sevOf = (e) => (isHairpin(e) ? 'HP' : (finite(+e.severity) && +e.severity >= 1 && +e.severity <= 6 ? Math.round(+e.severity) : null));
  const tightCorner = (e) => { const v = sevOf(e); return v === 'HP' || (v != null && v <= 2); };
  const cornerAt = (e) => (finite(e.start_m) && (!finite(e.dist_m) || e.start_m <= e.dist_m) ? e.start_m : e.dist_m);
  // the Valhalla turn with the same bend, for the car's stock arrow until the page's corner tulip is drawn
  const cornerType = (dir, v) => (dir === 'L' ? (v === 'HP' ? 13 : v <= 2 ? 14 : v <= 4 ? 15 : 16) : (v === 'HP' ? 12 : v <= 2 ? 11 : v <= 4 ? 10 : 9));
  const cornerWords = (e, v) => `${e.dir === 'L' ? 'Left' : 'Right'} ${v === 'HP' ? 'hairpin' : v}`;

  // U-112: the card's words at a glance. The card wrapped the phone's whole plain-words call ("Very sharp left, almost back
  // on itself, long, careful") onto four lines for half a mile (REVIEW5 guided-drive car/035). An instruction longer than
  // GLANCE_MAX gets `short`: the same instruction in fewer words, longest first, which the shell sends the card in place of
  // the whole call (CarPlay/ApexCarPlay.swift guideChanged, T-1). A corner keeps its kind and its caution and drops its
  // modifiers ("Very sharp left, careful", then "Very sharp left"); a turn drops the road it goes onto ("Turn left"), which
  // the card's street variant and the map still say.
  const GLANCE_MAX = 24;
  // Panel round 1 M-1: plain words in the call's grammar (web/plain_notes.js), the warning first ("Careful, hairpin left")
  const PLAIN_SEV = { 1: 'Tight', 2: 'Tight', 3: 'Medium', 4: 'Open', 5: 'Easy', 6: 'Slight' };        // web/plain_notes.js
  const PLAIN_CARE = ['', 'Careful', 'Slow down', 'Slow right down', 'Very slow'];
  const RALLY_CARE = ['', 'care', 'caution', 'double caution', 'triple caution'];                      // web/apex_core.js
  function cornerShort(e, v, plain) {
    const side = e.dir === 'L' ? 'left' : 'right', k = Math.round(+e.caution) || 0;
    const core = !plain ? cornerWords(e, v) : v === 'HP' || e.shape === 'acute' ? `Hairpin ${side}`
      : e.shape === 'square' ? `Square ${side}` : `${PLAIN_SEV[v] || 'Bend'} ${side}`;
    const care = (plain ? PLAIN_CARE : RALLY_CARE)[k];
    return [care ? (plain ? `${care}, ${core.toLowerCase()}` : `${core}, ${care}`) : core, core];
  }
  // T-1/I-4 (panel round 1, guided-drive car/005-011): putting the short form first did nothing, because CarPlay shows the
  // LONGEST variant that fits its card, and a four-line card fits the whole call. So the card is sent glance forms only:
  // every form here is at most GLANCE_MAX, and a call too long for a glance always gets at least one. The whole call stays
  // the phone's and the voice's.
  // `clip`: a call cut to a glance at its last clause that fits ("Very sharp left, almost back on itself" -> "Very sharp
  // left"), else at its last word, never mid-word; the words are the call's own, nothing added
  function clip(s) {
    s = String(s || '').trim();
    if (s.length <= GLANCE_MAX) return s;
    const cut = s.slice(0, GLANCE_MAX + 1);
    let i = cut.lastIndexOf(',');
    if (i < 6) i = cut.lastIndexOf(' ');
    return (i > 0 ? cut.slice(0, i) : s.slice(0, GLANCE_MAX)).replace(/[\s,·.-]+$/, '');
  }
  // the glance forms of `long`, longest first, each at most GLANCE_MAX and shorter than the one before; none when `long`
  // already fits a glance; when no form given fits, the call clipped
  function shortForms(long, forms) {
    const out = [];
    if (long.length <= GLANCE_MAX) return out;
    for (const f of forms) {
      const s = String(f || '').trim();
      if (s && s.length <= GLANCE_MAX && s.length < (out.length ? out[out.length - 1] : long).length) out.push(s);
    }
    if (!out.length) { const c = clip(long); if (c) out.push(c); }
    return out;
  }

  // U-63: a corner or turn more than CONTINUE_M ahead is not yet the card's maneuver. Until it is near, the card says which
  // road to follow, as Apple Maps does on a motorway ("Continue on I-275 West for 13 mi"): a 13-mile "Tight right" sat on
  // the card for seven minutes in the review recording (docs/design/REVIEW4.md). Standing still (under STILL_MPS), a
  // corner within STILL_M is the one the car is already at, not news: the start of a drive showed "0 ft · Very tight
  // right" under the car, a corner the phone never called.
  const CONTINUE_M = 2000, STILL_MPS = 2, STILL_M = 15;
  const TAKEN_M = 30;   // a turn is taken this far past it, as the voice has it (web/directions.js TAKEN_M)
  // The road the route is on at `m`: the street of the last step at or behind it (a Valhalla step names the road it goes
  // onto), so a planned route names its own roads; '' when it has none (a loop or a GPX track).
  function roadAt(t, m) {
    let road = '';
    for (const s of (Array.isArray(t.steps) ? t.steps : [])) {
      if (!s || !finite(s.m) || s.m > m + 5) break;
      if (typeof s.street === 'string' && s.street.trim()) road = s.street.trim();
    }
    return road;
  }

  /**
   * The next maneuver ahead of `cursorM`: { kind:'guide', key, instruction, street, type, distM, remainM, remainS }, or null
   * with none ahead. `phrase` is ApexDirections.phrase; `leftS` the live time left (eta.js), null when unknown. A corner
   * ahead of the next turn comes first, with `corner: { dir, sev }` (sev 1-6 or 'HP') for its tulip. `opts.corners` is
   * one of CORNER_MODES; `opts.call(e)` words a corner as the phone does (the plain-words setting), else its own call.
   * A maneuver more than CONTINUE_M away gives a continue step instead ("Follow I-275", type 8, `follow: true`, distM to
   * that maneuver), the road named from the route's steps, else from `opts.road` (a name, or a function that reads the
   * road under the car from the map). `opts.speedMps` is the car's speed, for the standing-still rule. `opts.step` is the
   * next turn as the page tracks it (null for none left); nothing past it, corner or turn, is the card's until it is taken.
   */
  function guideMessage(t, cursorM, leftS, phrase, opts = {}) {
    // a route without turn-by-turn steps (a loop, a GPX track) still has its corners: the CarPlay run on 2026-10-30
    // showed a loop with no guidance at all, the card never came up
    if (!t || !finite(cursorM)) return null;
    const total = Array.isArray(t.dist) && t.dist.length ? t.dist[t.dist.length - 1] : null;
    const remain = { remainM: finite(total) ? Math.max(0, Math.round(total - cursorM)) : null, remainS: finite(leftS) ? Math.round(leftS) : null };
    const turns = (Array.isArray(t.steps) ? t.steps : []).filter((s) => s && finite(s.m) && phrase(s));
    // the next turn: `opts.step` when the page tracks it (ApexDirections.createProgress, shared with the voice, so the card
    // and the spoken calls are about the same turn and a turn once taken never comes back to the card), else the first not
    // yet taken. The owner's car, 2026-10-30: the card went exit 19, sharp right, exit 19 again.
    const st = Object.prototype.hasOwnProperty.call(opts, 'step') ? (opts.step && finite(opts.step.m) && phrase(opts.step) ? opts.step : null)
      : turns.find((s) => s.m > cursorM - TAKEN_M);
    const mode = CORNER_MODES.includes(opts.corners) ? opts.corners : 'all';
    const still = finite(opts.speedMps) && opts.speedMps < STILL_MPS;
    let co = null, coM = Infinity;
    if (mode !== 'off') {
      for (const e of (Array.isArray(t.events) ? t.events : [])) {
        if (!e || e.type !== 'corner' || (e.dir !== 'L' && e.dir !== 'R') || sevOf(e) == null) continue;
        const m = cornerAt(e);
        // U-63: a corner already begun is behind the card, and one at the wheels of a standing car is never its first maneuver
        if (!finite(m) || m < cursorM || (still && m < cursorM + STILL_M) || m >= coM || (st && m >= st.m)) continue;
        if (mode === 'tight' && !tightCorner(e)) continue;
        if (turns.some((s) => Math.abs(s.m - m) < 40)) continue;
        co = e; coM = m;
      }
    }
    const nextM = co ? coM : st ? st.m : null;
    if (nextM == null) return null;
    if (nextM - cursorM > CONTINUE_M) {
      let road = roadAt(t, cursorM);
      if (!road && opts.road != null) {
        try { road = String((typeof opts.road === 'function' ? opts.road() : opts.road) || '').trim(); } catch (_) { road = ''; }
      }
      road = road.slice(0, 60);
      // the key holds still for the whole stretch (the same road, the same maneuver at its end), so the card is built once
      const instruction = road ? `Follow ${road}` : 'Follow the route', short = shortForms(instruction, []);
      return { kind: 'guide', key: `${t.id || ''}:f${Math.round(nextM)}:${road}`, instruction, ...(short.length ? { short } : {}),
               street: road, type: 8, follow: true, distM: Math.max(0, Math.round(nextM - cursorM)), ...remain };
    }
    if (co) {
      const v = sevOf(co), said = typeof opts.call === 'function' ? opts.call(co) : co.call, instruction = String(said || cornerWords(co, v));
      // the glance in the words the call is in: plain words when the phone says them (not a recce's own notes), else rally's
      const plain = (typeof opts.plain === 'function' ? !!opts.plain(co) : !!opts.plain) && !co.recce;
      const short = shortForms(instruction, cornerShort(co, v, plain));
      return { kind: 'guide', key: `${t.id || ''}:c${Math.round(coM)}`, instruction,
               ...(short.length ? { short } : {}),
               street: `${co.dir}${v}`,                                  // the shortest variant (CPManeuver instructionVariants), the map plate's code
               type: cornerType(co.dir, v), corner: { dir: co.dir, sev: v }, distM: Math.max(0, Math.round(coM - cursorM)), ...remain };
    }
    const instruction = phrase(st), short = shortForms(instruction, [phrase({ ...st, street: '', toward: '' })]);
    // the junction's lanes (web/lanes.js pack), as the phone's road book draws them under the turn: the page draws them for
    // the card's junction image (cockpit.js carLanes) and leaves them out of the message
    return { kind: 'guide', key: `${t.id || ''}:${Math.round(st.m)}`, instruction, ...(short.length ? { short } : {}), street: st.street || '', type: st.type,
             distM: Math.max(0, Math.round(st.m - cursorM)), ...remain, ...(Array.isArray(st.lanes) && st.lanes.length > 1 ? { lanes: st.lanes } : {}) };
  }

  /**
   * The lanes on the car's guidance card (CPManeuver.junctionImage), drawn as the phone's road book draws them
   * (web/instruments.js): one arrow per lane, left to right, in a 24-unit box each. `lanes` is ApexLanes.lanes(packed):
   * [{ angle, use, ok }]. Each glyph: { d, rotate, alpha } with the lanes to use at full ink, the ones that also work at
   * 0.55, the rest at 0.22. [] with fewer than two lanes or more than 8 (too narrow to read on the card).
   */
  const LANE_UTURN = 'M4 10 V-2 A4 4 0 0 0 -4 -2 V4 M-7 1 L-4 4 L-1 1', LANE_ARROW = 'M0 10 V-8 M-5 -3 L0 -8 L5 -3', LANES_MAX = 8;
  function laneGlyphs(lanes) {
    if (!Array.isArray(lanes) || lanes.length < 2 || lanes.length > LANES_MAX || !lanes.some((l) => l && (l.use || l.ok))) return [];
    return lanes.map((l) => {
      const a = l && finite(l.angle) ? l.angle : 0, u = Math.abs(a) >= 170;
      return { d: u ? LANE_UTURN : LANE_ARROW, rotate: u ? 0 : a, alpha: l && l.use ? 1 : l && l.ok ? 0.55 : 0.22 };
    });
  }

  /**
   * U-59: a drive with no route, on the car's card. It says the drive is recording and, once there is any, how far it has
   * driven, in the words: never as a distance to a maneuver, because there is none. { kind:'guide', key, instruction,
   * street, type: 8, recording: true } and no distM. `drivenM` is the distance recorded; `fmtDist` the phone's ("4.2 mi").
   */
  function recordingMessage(drivenM, fmtDist) {
    const d = finite(drivenM) && drivenM >= 160 && typeof fmtDist === 'function' ? String(fmtDist(drivenM)) : '';
    // U-120: `drivenM` (the distance the card's words say) goes to the trip strip, which CarPlay always shows in a session:
    // the strip carries the drive's own distance rather than three dashes, and never an arrival (there is nothing to arrive at)
    // T-1: the card's glance ("Recording · the road ahead" is 26 characters)
    const instruction = d ? `Recording · ${d} driven` : 'Recording · the road ahead';
    const short = shortForms(instruction, d ? [`Rec · ${d} driven`, 'Recording'] : ['Recording']);
    return { kind: 'guide', key: `rec:${d}`, instruction, ...(short.length ? { short } : {}),
             street: d ? `${d} driven` : 'Recording', type: 8, recording: true, ...(d ? { drivenM: Math.round(drivenM) } : {}) };
  }

  /**
   * The car's Loops list as the phone's loop dial (cockpit.js labelLoops): `by` 'time' gives its five times, otherwise its
   * five distances in the driver's units (`metric`), so the car never offers lengths the phone's dial doesn't.
   * { kind:'loops', list:[{ name, minutes }] | [{ name, miles }] }, the miles kept as the dial keeps them.
   */
  const LOOP_MINUTES = [30, 60, 90, 120, 180], LOOP_MI = [15, 30, 45, 60, 90], LOOP_KM = [25, 50, 75, 100, 150];
  function loopHours(m) {
    if (m < 60) return `${m} minutes`;
    const h = Math.floor(m / 60), half = m % 60 === 30;
    return `${h}${half ? '½' : ''} hour${h === 1 && !half ? '' : 's'}`;
  }
  function loopsMessage(by, metric) {
    if (by === 'time') return { kind: 'loops', list: LOOP_MINUTES.map((m) => ({ name: loopHours(m), minutes: m })) };
    return { kind: 'loops', list: metric ? LOOP_KM.map((km) => ({ name: `${km} km`, miles: km / 1.609344 }))
                                         : LOOP_MI.map((mi) => ({ name: `${mi} mi`, miles: mi })) };
  }

  /** Recent places for the car's Places list: [{ name, at: [lat, lon] }], newest first. */
  // The car's Places, as Where to?'s list with nothing typed (cockpit.js renderPlaces): your pinned places first (Home,
  // Work; `detail` the address it was pinned from), then the time attacks you've entered (`attacks` [{ id, name, detail }],
  // the featured one first: the phone drives the loop itself), then up to SAVED_MAX saved routes (`saved` its id, opened from the
  // phone's copy, so no position; `detail` "Saved · 12 mi" via `fmtDist`), then recents. One row per name, at most 12.
  const PLACES_MAX = 12, SAVED_MAX = 4;
  function placesMessage(recent, pinned, saved, fmtDist, attacks) {
    const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
    const name = (s) => (typeof s === 'string' ? s.trim().slice(0, 60) : '');
    const rows = [
      ...arr(pinned).filter((p) => name(p.name) && finite(p.lat) && finite(p.lon)).map((p) => {
        const label = name(p.label), detail = label && label.toLowerCase() !== name(p.name).toLowerCase() ? label : '';
        return { name: name(p.name), at: [p.lat, p.lon], ...(detail ? { detail } : {}) };
      }),
      ...arr(attacks).filter((a) => name(a.name) && a.id != null && String(a.id)).slice(0, 3).map((a) => ({ name: name(a.name), attack: String(a.id).slice(0, 80),
        detail: ['Time attack', name(a.detail)].filter(Boolean).join(' · ').slice(0, 60) })),
      ...arr(saved).filter((p) => name(p.name) && typeof p.id === 'string' && p.id).slice(0, SAVED_MAX).map((p) => ({
        name: name(p.name), saved: p.id.slice(0, 80),
        detail: finite(p.miles) && typeof fmtDist === 'function' ? `Saved · ${fmtDist(p.miles * 1609.344)}` : 'Saved' })),
      ...arr(recent).filter((p) => name(p.label) && finite(p.lat) && finite(p.lon)).map((p) => ({ name: name(p.label), at: [p.lat, p.lon] })),
    ];
    const seen = new Set();
    const list = rows.filter((r) => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, PLACES_MAX);
    return { kind: 'places', list };
  }

  /**
   * The road book on the car's map (web/carmap.js): every corner's rating at its apex, { kind:'corners', list:[{ at, text,
   * tight }] }. `at(m)` places an event that carries no position of its own (a planned route's corners have dist_m only).
   * Panel round 1 M-3: `words` ('plain' | 'rally') is the driver's notation, the strip's next cells' (plain_notes.js
   * noteCode): "TIGHT R" with plain words on, "L4-", "LHP", "SQ L" with rally words.
   */
  const plainNotes = () => root.ApexPlainNotes || (typeof module !== 'undefined' && typeof require === 'function' ? require('./plain_notes.js') : null);
  function cornersMessage(t, at, words = 'rally') {
    const P = plainNotes();
    const list = [];
    for (const e of (t && Array.isArray(t.events) ? t.events : [])) {
      if (!e || e.type !== 'corner' || (e.dir !== 'L' && e.dir !== 'R')) continue;
      const p = finite(e.lat) && finite(e.lon) ? { lat: e.lat, lon: e.lon } : (at && finite(e.dist_m) ? at(e.dist_m) : null);
      if (!p || !finite(p.lat) || !finite(p.lon)) continue;
      const hp = e.severity === 'HP' || e.shape === 'hairpin';
      list.push({ at: [+p.lat.toFixed(6), +p.lon.toFixed(6)], text: (P && P.noteCode(e, words)) || `${e.dir}${hp ? 'HP' : e.severity}`, tight: hp || (finite(e.severity) && e.severity <= 2) });
      if (list.length >= 600) break;
    }
    return { kind: 'corners', list };
  }

  /** Reported hazards for the car's map: { kind:'hazards', list:[{ id, at, title }] }, at most 40. */
  function hazardsMessage(reports, labels) {
    const list = (Array.isArray(reports) ? reports : []).filter((h) => h && finite(h.lat) && finite(h.lon)).slice(0, 40)
      .map((h) => ({ id: String(h.id || ''), at: [+h.lat.toFixed(6), +h.lon.toFixed(6)], title: h.label || (labels && labels[h.kind]) || 'Hazard' }));
    return { kind: 'hazards', list };
  }

  /**
   * The cafés and fuel stations along the planned route, by name, for the car's route preview (the owner, 2026-11-11:
   * "just show the name"): { kind:'along', full, short }. full names up to two of each kind, in route order, "+N" for the
   * rest (the unnamed ones too); short is the first name of each. An unnamed kind is only counted. Both '' with nothing
   * along, which clears the car's line. `list` is web/scenic.js along() (t.scenic); viewpoints stay on the phone.
   * `places` are the same ones for the car's map, a plate each at the place ({ at, kind, text }, at most ALONG_PLATES,
   * in route order): its name, or "Café" / "Fuel" when the map has none. `descent` is the route's first long descent in
   * a few words ('' with none), for the same line.
   */
  const ALONG_NAME_MAX = 28, ALONG_MAX = 90, ALONG_PLATES = 30, PLATE_NAME_MAX = 18;
  function alongMessage(list, descent) {
    const rows = Array.isArray(list) ? list.filter((p) => p && (p.kind === 'cafe' || p.kind === 'fuel' || p.kind === 'charge')) : [];   // charge: an EV's chargers (scenic.js forCar)
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
    const part = (kind, label, one, many, keep) => {
      const all = rows.filter((p) => p.kind === kind);
      if (!all.length) return '';
      const names = [...new Set(all.map((p) => (typeof p.name === 'string' ? p.name.trim() : '')).filter(Boolean))].slice(0, keep).map((n) => cut(n, ALONG_NAME_MAX));
      const named = all.filter((p) => typeof p.name === 'string' && names.some((n) => n === cut(p.name.trim(), ALONG_NAME_MAX))).length;
      if (!names.length) return `${label}${all.length} ${all.length === 1 ? one : many}`;
      const rest = all.length - named;
      return label + names.join(', ') + (rest > 0 ? ` +${rest}` : '');
    };
    const full = [part('cafe', 'Café: ', 'café', 'cafés', 2), part('fuel', 'Fuel: ', 'stop', 'stops', 2), part('charge', 'Charge: ', 'charger', 'chargers', 2)].filter(Boolean).join(' · ');
    const short = [part('cafe', '', 'café', 'cafés', 1), part('fuel', '', 'fuel stop', 'fuel stops', 1), part('charge', '', 'charger', 'chargers', 1)].filter(Boolean).join(' · ');
    const places = rows.filter((p) => finite(p.lat) && finite(p.lon)).slice(0, ALONG_PLATES).map((p) => ({
      at: [+p.lat.toFixed(6), +p.lon.toFixed(6)], kind: p.kind,
      text: cut((typeof p.name === 'string' && p.name.trim()) || (p.kind === 'cafe' ? 'Café' : p.kind === 'charge' ? 'Charger' : 'Fuel'), PLATE_NAME_MAX) }));
    // a long descent on the way (brake_heat.js descentShort), said beside the places: the brakes' warning before Drive
    const fall = typeof descent === 'string' ? cut(descent.trim(), 48) : '';
    return { kind: 'along', full: cut(full, ALONG_MAX), short: cut(short, ALONG_MAX), places, descent: fall };
  }

  /**
   * A phone offer with one key, on the car's screen too (a navigation alert there: the key and "Not now"): the police
   * report ahead's Go round, a late loop's Skip or Head home. { kind:'offer', id, title, short, key, seconds }: title
   * and short are the words, longest first (the car shows the longest that fits); key at most OFFER_KEY_MAX; seconds 5 to
   * 20, the phone toast's own time. The car answers { action:'offer', id }; null when there are no words or no key.
   * `cancel`, when given, names the alert's other key (a report's Undo has "OK"; the car says "Not now" without it).
   */
  const OFFER_KEY_MAX = 16, OFFER_TITLE_MAX = 64;
  function offerMessage(id, title, short, key, ms, cancel) {
    const t = String(title || '').trim(), k = String(key || '').trim();
    if (!id || !t || !k) return null;
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
    const sh = cut(String(short || '').trim(), OFFER_TITLE_MAX);
    return { kind: 'offer', id: String(id), title: cut(t, OFFER_TITLE_MAX), short: sh && sh !== t ? sh : '', key: cut(k, OFFER_KEY_MAX),
             seconds: Math.round(Math.max(5, Math.min(20, (finite(ms) ? ms : 15000) / 1000))),
             ...(String(cancel || '').trim() ? { cancel: cut(String(cancel).trim(), OFFER_KEY_MAX) } : {}) };
  }

  /**
   * What the phone said back to a request made on the car (a loop or a place to go that couldn't be planned, a report
   * with no GPS fix): { kind:'notice', titles } with its first sentence only, the reason, longest first. The rest is the
   * phone's advice ("Type a start or tap the map") and errors on the car never send the driver to the phone. Null when
   * there are no words.
   */
  const NOTICE_MAX = 96, NOTICE_SHORT = 48;
  function noticeMessage(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const first = (s.match(/^.+?[.!?](?=\s|$)/) || [s])[0];
    const cut = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/[\s,·.-]+$/, '') + '…' : t);
    return { kind: 'notice', titles: [...new Set([cut(first, NOTICE_MAX), cut(first, NOTICE_SHORT)])] };
  }

  /**
   * The theme for the car's screen: its id (the car's map paints it, web/carmap.js), the guidance card's colours (the
   * theme's dark panel, so the card reads in both the car's light and dark modes), whether the voice is on and the units.
   */
  function lookMessage(theme, voiceOn, units) {
    const t = theme || {}, n = t.night || {};
    // F-07: the native car map (CarPlay/ApexCarMap.swift) paints the theme's map itself: its day and night palettes
    // (web/themes.js `map`) with the route, plate and accent inks, the same colours web/carmap.js takes from themes.js
    const pal = (m) => (t.map && t.map[m] && t[m] ? { ...t.map[m], route: t[m].route, plate: t[m].panel, plateInk: t[m].panelInk, accent: t[m].accent } : null);
    const day = pal('day'), night = pal('night');
    // units: the car shows distances in the driver's (miles and feet, or km and metres), not the metres it is sent
    const msg = { kind: 'look', theme: t.id || 'roadbook', card: n.panel || '#151310', cardInk: n.panelInk || '#EDE4D3', accent: n.accent || '#E65252', voice: !!voiceOn,
             units: units === 'metric' ? 'metric' : 'imperial', palette: day && night ? { day, night } : null };
    const puck = carPuck(t);
    if (puck) msg.puck = puck;
    return msg;
  }
  /** A car's own theme (theme.car, the private themes): its outline from above, nose up, in the car map's 34-point arrow box,
   *  and its paint, for the native car map's arrow (ApexCarMap.swift ApexCarPuckView); null for every other theme. Pure. */
  function carPuck(t) {
    const car = t && t.car, s = car && car.silhouette;
    if (!s || !car.paint || !/^#[0-9A-Fa-f]{6}$/.test(car.paint.hex || '') || !Array.isArray(s.body)) return null;
    const k = Math.min(34 / s.w, 34 / s.h), ox = (34 - s.w * k) / 2, oy = (34 - s.h * k) / 2;
    const pts = (a) => (Array.isArray(a) ? a.map(([x, y]) => [Math.round((ox + x * k) * 10) / 10, Math.round((oy + y * k) * 10) / 10]) : null);
    return { paint: car.paint.hex, glass: '#1A1D22', body: pts(s.body), ...(s.glass ? { glass_shape: pts(s.glass) } : {}), ...(s.roof ? { roof: pts(s.roof) } : {}) };
  }

  /**
   * A tulip for a turn (Valhalla maneuver type, web/directions.js), as SVG: the road book's own symbol instead of an arrow
   * on the car's guidance card. `ink` is the card's ink. The page draws it to a PNG for the shell.
   */
  function tulipSVG(type, ink) {
    const c = /^#[0-9A-Fa-f]{3,8}$/.test(ink || '') ? ink : '#EDE4D3';
    // the exit angle in degrees from straight ahead (left negative), or a special shape
    const A = { 9: 40, 10: 90, 11: 135, 12: 180, 13: -180, 14: -135, 15: -90, 16: -40, 17: 0, 18: 30, 19: -30, 20: 30, 21: -30,
                22: 0, 23: 25, 24: -25, 25: 0, 37: 30, 38: -30 };
    let path;
    if (type === 8) {                                                    // U-63 follow the road: one straight line, no junction dot
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120"><g fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M50 92 V14"/><path d="M38 27 L50 14 L62 27"/></g></svg>`;
    }
    if ([4, 5, 6].includes(type)) {                                      // arrive: a flag on the stem
      path = '<path d="M50 92 V22"/><path d="M50 24 H76 L68 33 L76 42 H50" fill="' + c + '"/>';
    } else if (type === 26 || type === 27) {                             // roundabout: a ring and the exit
      path = '<path d="M50 92 V64"/><circle cx="50" cy="46" r="17"/><path d="M67 46 H90"/><path d="M81 36 L91 46 L81 56"/>';
    } else {
      const a = (A[type] != null ? A[type] : 0) * Math.PI / 180;
      if (Math.abs(a) >= Math.PI - 0.01) {                             // U-turn: up, over and back down
        const s = a > 0 ? 1 : -1;
        path = `<path d="M50 92 V40 A14 14 0 0 ${s > 0 ? 1 : 0} ${50 + 28 * s} 40 V64"/><path d="M${50 + 28 * s - 11} 54 L${50 + 28 * s} 66 L${50 + 28 * s + 11} 54"/>`;
      } else {
        const top = Math.abs(a) > 1.7 ? 34 : 46;                     // a sharp turn bends higher, so its arm has room to come back down
        const ex = 50 + Math.sin(a) * 34, ey = top - Math.cos(a) * 34;
        const hx = Math.sin(a), hy = -Math.cos(a), px = -hy, py = hx;   // heading and its normal, for the arrow head
        path = `<path d="M50 92 V${top + 4} Q50 ${top} ${ex.toFixed(1)} ${ey.toFixed(1)}"/>`
          + `<path d="M${(ex - hx * 12 + px * 9).toFixed(1)} ${(ey - hy * 12 + py * 9).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - hx * 12 - px * 9).toFixed(1)} ${(ey - hy * 12 - py * 9).toFixed(1)}"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120"><g fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${path}</g><circle cx="50" cy="92" r="7" fill="${c}"/></svg>`;
  }

  /**
   * A corner's tulip: the road bending by its rating (6 a kink, 1 nearly doubling back, a hairpin all the way round), one
   * unbroken line with no junction dot, so a corner never reads as a turn onto another road. `sev` is 1-6 or 'HP'.
   */
  const CORNER_BEND = { 1: 140, 2: 115, 3: 90, 4: 65, 5: 45, 6: 25 };
  function cornerTulipSVG(dir, sev, ink) {
    const c = /^#[0-9A-Fa-f]{3,8}$/.test(ink || '') ? ink : '#EDE4D3', s = dir === 'L' ? -1 : 1;
    let path, width = 9;
    if (sev === 'HP') {
      // U-78: the road book's hairpin, not a pennant (a stem, a tight arc and a down arrow read as a flag at card size): a
      // long stem, a wide turn (radius 20) and a return leg that runs back down beside it and leaves at 45 degrees, the
      // arrowhead on that leg. A thinner line (7) keeps the two legs apart at 60 px.
      const x0 = 50 - 20 * s, x1 = 50 + 20 * s, ex = x1 + 14 * s, ey = 68, k = Math.SQRT1_2;
      const hx = k * s, hy = k, px = -hy, py = hx, f = (v) => +v.toFixed(1);
      path = `<path d="M${x0} 92 V40 A20 20 0 0 ${s > 0 ? 1 : 0} ${x1} 40 V${ey - 14} L${ex} ${ey}"/>`
        + `<path d="M${f(ex - hx * 11 + px * 8)} ${f(ey - hy * 11 + py * 8)} L${ex} ${ey} L${f(ex - hx * 11 - px * 8)} ${f(ey - hy * 11 - py * 8)}"/>`;
      width = 7;
    } else {
      // U-78: the bend is a true arc of the road (a radius per rating, the stem set off to the outside so a tight one has room
      // to come round) and a short straight exit carrying the arrowhead. The old curve put the head right on top of a short
      // hook, and a 1 ("Very tight right, opens up", the review recording's car/02) read as a pennant on a pole.
      const deg = CORNER_BEND[sev] || 45, a = deg * Math.PI / 180, f = (v) => +v.toFixed(1);
      const R = deg > 100 ? 20 : deg > 60 ? 26 : 34, x0 = 50 - s * (deg > 100 ? 20 : deg > 60 ? 14 : 6), top = deg > 100 ? 44 : 52;
      const cx = x0 + s * R, bx = cx - s * R * Math.cos(a), by = top - R * Math.sin(a);   // where the arc ends
      const hx = s * Math.sin(a), hy = -Math.cos(a), px = -hy, py = hx, ex = bx + hx * 14, ey = by + hy * 14;
      path = `<path d="M${x0} 92 V${top} A${R} ${R} 0 0 ${s > 0 ? 1 : 0} ${f(bx)} ${f(by)} L${f(ex)} ${f(ey)}"/>`
        + `<path d="M${f(ex - hx * 12 + px * 9)} ${f(ey - hy * 12 + py * 9)} L${f(ex)} ${f(ey)} L${f(ex - hx * 12 - px * 9)} ${f(ey - hy * 12 - py * 9)}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120"><g fill="none" stroke="${c}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;
  }

  /** U-59: the free drive's symbol, the record dot: a ring in the card's ink around a dot in the theme's accent. */
  function recordSVG(ink, accent) {
    const c = /^#[0-9A-Fa-f]{3,8}$/.test(ink || '') ? ink : '#EDE4D3', a = /^#[0-9A-Fa-f]{3,8}$/.test(accent || '') ? accent : '#E65252';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120"><g fill="none" stroke="${c}" stroke-width="7"><circle cx="50" cy="50" r="34"/></g><circle cx="50" cy="50" r="18" fill="${a}"/></svg>`;
  }

  /**
   * The sight-line speed on the position arrow (the owner, 2026-10-29), for the car's map and the phone's: the speed you
   * can stop within what you can see, in the chosen units. { kind:'sight', text, unit, short }: text '52' and unit 'MPH',
   * or 'OPEN' with no unit when nothing limits you; short when you are going faster than it. text null when unknown
   * (no route under you, no sight line measured): the tag is hidden, never a guess. Numbers come in display units.
   */
  function sightMessage(sight, open, speed, unit) {
    if (open) return { kind: 'sight', text: 'OPEN', unit: '', short: false };
    if (!finite(sight) || sight < 0) return { kind: 'sight', text: null, unit: '', short: false };
    return { kind: 'sight', text: String(Math.round(sight)), unit: String(unit || '').toUpperCase(), short: finite(speed) && speed > sight + 1 };
  }

  /**
   * The posted speed limit for the car's map (web/carmap.js and CarPlay/ApexCarMap.swift draw the sign at the bottom left,
   * where Apple Maps and Waze show it): { kind:'limit', value, unit, round } in the driver's units, `round` for the
   * km/h sign (the red ring) and false for the US "SPEED LIMIT" one. value null: unknown, no sign (the map never guesses).
   */
  function limitMessage(limit, unit) {
    const u = String(unit || '').toUpperCase(), km = /^KM/.test(u);
    if (!finite(limit) || limit <= 0 || limit > 200) return { kind: 'limit', value: null, unit: '', round: false };
    return { kind: 'limit', value: Math.round(limit / 5) * 5 || Math.round(limit), unit: km ? 'KM/H' : 'MPH', round: km };
  }

  /**
   * Panel round 2 (TH-2, IN-3): what the sight plate under the arrow draws, on the phone and on the car (web/carmap.js and
   * CarPlay/ApexCarMap.swift draw the same). null draws nothing: unknown, or OPEN (nothing ahead limits you; the binnacle's
   * Sight cell says Open). Else { label, text, short }: "SIGHT" by the number and no unit, so it never reads as a limit sign;
   * faster than it, "SLOW" and short (the signal colour and the eye barred: two channels, never hue alone).
   */
  function sightTag(m) {
    if (!m || typeof m.text !== 'string' || !m.text) return null;
    if (m.text === 'OPEN' && !m.short) return null;
    return { label: m.short ? 'SLOW' : 'SIGHT', text: m.text, short: !!m.short };
  }

  /**
   * U-60: the sight-line speed as a display holds it. The raw value moves every sample (the recording read 67, 55, 97,
   * 88, 124 ten seconds apart at a steady 70), and a red that flickers teaches the driver to ignore the one red on the
   * map. So: steps of 5 mph (10 km/h), rounded down (it is a speed you can stop within); a new step or OPEN only once it
   * has held 2 s; red ("faster than you can see") only once you have been faster than it for 3 s; no plate under 5 mph
   * (8 km/h), where it means nothing; OPEN when it clears the posted limit by 15 mph (25 km/h). Unknown hides at once
   * and starts over: a held number is never shown for road it wasn't measured on.
   * U-60 (the second recording): with no posted limit there was nothing to clear, so the plate went 120, OPEN, 105 in nine
   * seconds on a suburban road. With no limit: OPEN above 80 mph (130 km/h), and once OPEN it stays until the sight line
   * is two steps under that; a shown value holds at least 6 s before it rises (the rise still needs its 2 s of agreement);
   * a fall of two steps or more shows at once (it is the one a driver needs), a one-step fall waits its 2 s like any other.
   * step({ sight, open, speed, limit, unit }, nowMs), numbers in display units, returns { msg, value, open }: msg is a
   * sightMessage for the plate (phone and car), value/open the held number for the binnacle's Sight cell.
   */
  const SIGHT_HOLD_MS = 2000, SIGHT_RED_MS = 3000, SIGHT_KEEP_MS = 6000;
  function sightFilter() {
    // shown and the readings as numbers, OPEN as Infinity. A change is adopted only when every reading for 2 s has been at
    // least a step away on the same side, and then by the least of them (the change all of that 2 s agrees on): a value
    // that jumps up and down around the shown one never moves it.
    let shown = null, shownAt = null, pend = null, redSince = null;
    const reset = () => { shown = null; shownAt = null; pend = null; redSince = null; };
    const show = (v, now) => { shown = v; shownAt = now; pend = null; };
    function step(r, now) {
      r = r || {};
      const km = /^km/i.test(String(r.unit || '')), q = km ? 10 : 5, slow = km ? 8 : 5, margin = km ? 25 : 15;
      if (!finite(now) || (!r.open && !(finite(r.sight) && r.sight >= 0))) { reset(); return { msg: sightMessage(null), value: null, open: false }; }
      const limited = finite(r.limit) && r.limit > 0, ceiling = (km ? 130 : 80) - (shown === Infinity ? 2 * q : 0);
      const open = !!r.open || (limited ? r.sight > r.limit + margin : r.sight > ceiling);
      const want = open ? Infinity : Math.floor(r.sight / q) * q;
      const dir = shown === null ? 0 : Math.sign(want - shown);
      if (shown === null) show(want, now);
      else if (!dir) pend = null;
      else if (!limited && dir < 0 && shown - want >= 2 * q) show(want, now);
      else if (!pend || pend.dir !== dir) pend = { dir, since: now, near: want };
      else {
        pend.near = dir > 0 ? Math.min(pend.near, want) : Math.max(pend.near, want);
        if (now - pend.since >= SIGHT_HOLD_MS && (limited || dir < 0 || now - shownAt >= SIGHT_KEEP_MS)) show(pend.near, now);
      }
      const isOpen = shown === Infinity, value = isOpen ? null : shown;
      // faster than the raw sight line and than the number on the plate: never red under the figure the driver reads
      const fast = !isOpen && finite(r.speed) && finite(r.sight) && r.speed > r.sight + 1 && r.speed > shown + 1;
      redSince = fast ? (redSince === null ? now : redSince) : null;
      if (finite(r.speed) && r.speed < slow) return { msg: sightMessage(null), value, open: isOpen };
      const msg = sightMessage(value, isOpen, null, r.unit);
      msg.short = redSince !== null && now - redSince >= SIGHT_RED_MS;
      return { msg, value, open: isOpen };
    }
    return { step, reset };
  }

  const api = { sightMessage, limitMessage, line, routeMessage, loopsMessage, laneGlyphs, LOOP_MINUTES, LOOP_MI, LOOP_KM, guideMessage, recordingMessage, placesMessage, cornersMessage, hazardsMessage, alongMessage, offerMessage, noticeMessage, lookMessage, tulipSVG, cornerTulipSVG,
                recordSVG, CORNER_MODES, CONTINUE_M, MAX_POINTS };
  api.sightFilter = sightFilter;                                       // U-60 (its own line: the list above is shared)
  api.sightTag = sightTag;                                             // panel round 2, TH-2
  api.GLANCE_MAX = GLANCE_MAX;                                         // U-112
  api.glanceClip = clip;                                               // T-1
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarPlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
