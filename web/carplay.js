// What the car's screen is told (CarPlay/ApexCarPlay.swift, docs/CARPLAY.md). The page plans and guides; these build the
// `{cmd:'car', kind}` messages from its state. Pure (tests/test_carplay.py): the page posts what they return.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const MAX_POINTS = 400;

  /** The route line for the base map: at most MAX_POINTS [lat, lon], both ends kept. */
  function line(t) {
    if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return [];
    const n = t.lat.length, step = Math.max(1, Math.ceil(n / MAX_POINTS)), out = [];
    for (let i = 0; i < n; i += step) out.push([+t.lat[i].toFixed(6), +t.lon[i].toFixed(6)]);
    if ((n - 1) % step) out.push([+t.lat[n - 1].toFixed(6), +t.lon[n - 1].toFixed(6)]);
    return out;
  }

  /**
   * A planned route for the trip preview: its line, where it ends and up to three choices ("Fun 99 · 77 min").
   * `options` is the card's list ({ fun, timeS, route: { coords } }); a route without options is one choice.
   */
  function routeMessage(t, options, picked, fmtDist) {
    const pts = line(t);
    if (pts.length < 2) return null;
    const total = t.dist[t.dist.length - 1];
    const corners = Array.isArray(t.events) ? t.events.filter((e) => e && e.type === 'corner').length : null;
    // One route: the card's title is its name and the car prints the time and length itself, so the summary is what
    // neither says (the Fun score, else the corners). Several: each choice's summary tells it from the others (Fun and
    // time). The owner's car showed "32 min loop" twice, 2026-10-29.
    const several = Array.isArray(options) && options.length > 1;
    const cornersText = (n) => (finite(n) ? `${n} corner${n === 1 ? '' : 's'}` : null);
    const one = (fun, timeS, distM, n) => ({
      summary: (several ? [fun != null ? `Fun ${fun}` : null, finite(timeS) ? `${Math.round(timeS / 60)} min` : null]
        : [fun != null ? `Fun ${fun}` : cornersText(n)]).filter(Boolean).join(' · ') || 'Route',
      // U-89: one route's card prints its length on the estimates line and only the detail above it (the summary shows in
      // the Options list alone), so the detail is what the route is: its Fun score and corners, the length only when
      // neither is known. The review recording's card read "35.4 mi" twice, its middle blank.
      detail: several ? [finite(distM) && fmtDist ? fmtDist(distM) : null, cornersText(n)].filter(Boolean).join(' · ')
        : [fun != null ? `Fun ${fun}` : null, cornersText(n)].filter(Boolean).join(' · ') || (finite(distM) && fmtDist ? fmtDist(distM) : ''),
      timeS: finite(timeS) ? timeS : null, distM: finite(distM) ? distM : null,
    });
    const list = Array.isArray(options) && options.length > 1
      ? options.slice(0, 3).map((c, i) => one(c.fun ? c.fun.fun : null, c.timeS, finite(c.distM) ? c.distM : null, i === picked ? corners : null))
      : [one(t.fun ? t.fun.fun : null, t.timeS, total, corners)];
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

  // U-63: a corner or turn more than CONTINUE_M ahead is not yet the card's maneuver. Until it is near, the card says which
  // road to follow, as Apple Maps does on a motorway ("Continue on I-275 West for 13 mi"): a 13-mile "Tight right" sat on
  // the card for seven minutes in the review recording (docs/design/REVIEW4.md). Standing still (under STILL_MPS), a
  // corner within STILL_M is the one the car is already at, not news: the start of a drive showed "0 ft · Very tight
  // right" under the car, a corner the phone never called.
  const CONTINUE_M = 2000, STILL_MPS = 2, STILL_M = 15;
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
   * road under the car from the map). `opts.speedMps` is the car's speed, for the standing-still rule.
   */
  function guideMessage(t, cursorM, leftS, phrase, opts = {}) {
    // a route without turn-by-turn steps (a loop, a GPX track) still has its corners: the CarPlay run on 2026-10-30
    // showed a loop with no guidance at all, the card never came up
    if (!t || !finite(cursorM)) return null;
    const total = Array.isArray(t.dist) && t.dist.length ? t.dist[t.dist.length - 1] : null;
    const remain = { remainM: finite(total) ? Math.max(0, Math.round(total - cursorM)) : null, remainS: finite(leftS) ? Math.round(leftS) : null };
    const turns = (Array.isArray(t.steps) ? t.steps : []).filter((s) => s && finite(s.m) && phrase(s));
    const st = turns.find((s) => s.m > cursorM - 5);
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
      return { kind: 'guide', key: `${t.id || ''}:f${Math.round(nextM)}:${road}`, instruction: road ? `Follow ${road}` : 'Follow the route',
               street: road, type: 8, follow: true, distM: Math.max(0, Math.round(nextM - cursorM)), ...remain };
    }
    if (co) {
      const v = sevOf(co), said = typeof opts.call === 'function' ? opts.call(co) : co.call;
      return { kind: 'guide', key: `${t.id || ''}:c${Math.round(coM)}`, instruction: String(said || cornerWords(co, v)),
               street: `${co.dir}${v}`,                                  // the short variant (CPManeuver instructionVariants) where the call doesn't fit
               type: cornerType(co.dir, v), corner: { dir: co.dir, sev: v }, distM: Math.max(0, Math.round(coM - cursorM)), ...remain };
    }
    return { kind: 'guide', key: `${t.id || ''}:${Math.round(st.m)}`, instruction: phrase(st), street: st.street || '', type: st.type,
             distM: Math.max(0, Math.round(st.m - cursorM)), ...remain };
  }

  /**
   * U-59: a drive with no route, on the car's card. It says the drive is recording and, once there is any, how far it has
   * driven, in the words: never as a distance to a maneuver, because there is none. { kind:'guide', key, instruction,
   * street, type: 8, recording: true } and no distM. `drivenM` is the distance recorded; `fmtDist` the phone's ("4.2 mi").
   */
  function recordingMessage(drivenM, fmtDist) {
    const d = finite(drivenM) && drivenM >= 160 && typeof fmtDist === 'function' ? String(fmtDist(drivenM)) : '';
    return { kind: 'guide', key: `rec:${d}`, instruction: d ? `Recording · ${d} driven` : 'Recording · the road ahead',
             street: d ? `${d} driven` : 'Recording', type: 8, recording: true };
  }

  /** Recent places for the car's Places list: [{ name, at: [lat, lon] }], newest first. */
  function placesMessage(recent) {
    const list = (Array.isArray(recent) ? recent : []).filter((p) => p && p.label && finite(p.lat) && finite(p.lon))
      .slice(0, 12).map((p) => ({ name: p.label, at: [p.lat, p.lon] }));
    return { kind: 'places', list };
  }

  /**
   * The road book on the car's map (web/carmap.js): every corner's rating at its apex, { kind:'corners', list:[{ at, text,
   * tight }] }. `at(m)` places an event that carries no position of its own (a planned route's corners have dist_m only).
   */
  function cornersMessage(t, at) {
    const list = [];
    for (const e of (t && Array.isArray(t.events) ? t.events : [])) {
      if (!e || e.type !== 'corner' || (e.dir !== 'L' && e.dir !== 'R')) continue;
      const p = finite(e.lat) && finite(e.lon) ? { lat: e.lat, lon: e.lon } : (at && finite(e.dist_m) ? at(e.dist_m) : null);
      if (!p || !finite(p.lat) || !finite(p.lon)) continue;
      const hp = e.severity === 'HP' || e.shape === 'hairpin';
      list.push({ at: [+p.lat.toFixed(6), +p.lon.toFixed(6)], text: `${e.dir}${hp ? 'HP' : e.severity}`, tight: hp || (finite(e.severity) && e.severity <= 2) });
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
   * The theme for the car's screen: its id (the car's map paints it, web/carmap.js), the guidance card's colours (the
   * theme's dark panel, so the card reads in both the car's light and dark modes), whether the voice is on and the units.
   */
  function lookMessage(theme, voiceOn, units) {
    const t = theme || {}, n = t.night || {};
    // units: the car shows distances in the driver's (miles and feet, or km and metres), not the metres it is sent
    return { kind: 'look', theme: t.id || 'roadbook', card: n.panel || '#151310', cardInk: n.panelInk || '#EDE4D3', accent: n.accent || '#E65252', voice: !!voiceOn,
             units: units === 'metric' ? 'metric' : 'imperial' };
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
   * U-60: the sight-line speed as a display holds it. The raw value moves every sample (the recording read 67, 55, 97,
   * 88, 124 ten seconds apart at a steady 70), and a red that flickers teaches the driver to ignore the one red on the
   * map. So: steps of 5 mph (10 km/h), rounded down (it is a speed you can stop within); a new step or OPEN only once it
   * has held 2 s; red ("faster than you can see") only once you have been faster than it for 3 s; no plate under 5 mph
   * (8 km/h), where it means nothing; OPEN when it clears the posted limit by 15 mph (25 km/h). Unknown hides at once
   * and starts over: a held number is never shown for road it wasn't measured on.
   * step({ sight, open, speed, limit, unit }, nowMs), numbers in display units, returns { msg, value, open }: msg is a
   * sightMessage for the plate (phone and car), value/open the held number for the binnacle's Sight cell.
   */
  const SIGHT_HOLD_MS = 2000, SIGHT_RED_MS = 3000;
  function sightFilter() {
    // shown and the readings as numbers, OPEN as Infinity. A change is adopted only when every reading for 2 s has been at
    // least a step away on the same side, and then by the least of them (the change all of that 2 s agrees on): a value
    // that jumps up and down around the shown one never moves it.
    let shown = null, pend = null, redSince = null;
    const reset = () => { shown = null; pend = null; redSince = null; };
    function step(r, now) {
      r = r || {};
      const km = /^km/i.test(String(r.unit || '')), q = km ? 10 : 5, slow = km ? 8 : 5, margin = km ? 25 : 15;
      if (!finite(now) || (!r.open && !(finite(r.sight) && r.sight >= 0))) { reset(); return { msg: sightMessage(null), value: null, open: false }; }
      const open = !!r.open || (finite(r.limit) && r.limit > 0 && r.sight > r.limit + margin);
      const want = open ? Infinity : Math.floor(r.sight / q) * q;
      const dir = shown === null ? 0 : Math.sign(want - shown);
      if (shown === null) { shown = want; pend = null; }
      else if (!dir) pend = null;
      else if (!pend || pend.dir !== dir) pend = { dir, since: now, near: want };
      else {
        pend.near = dir > 0 ? Math.min(pend.near, want) : Math.max(pend.near, want);
        if (now - pend.since >= SIGHT_HOLD_MS) { shown = pend.near; pend = null; }
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

  const api = { sightMessage, line, routeMessage, guideMessage, recordingMessage, placesMessage, cornersMessage, hazardsMessage, lookMessage, tulipSVG, cornerTulipSVG,
                recordSVG, CORNER_MODES, CONTINUE_M, MAX_POINTS };
  api.sightFilter = sightFilter;                                       // U-60 (its own line: the list above is shared)
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarPlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
