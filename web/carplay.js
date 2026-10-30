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
      detail: [finite(distM) && fmtDist ? fmtDist(distM) : null, several || fun != null ? cornersText(n) : null].filter(Boolean).join(' · '),
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

  /**
   * The next maneuver ahead of `cursorM`: { kind:'guide', key, instruction, street, type, distM, remainM, remainS }, or null
   * with none ahead. `phrase` is ApexDirections.phrase; `leftS` the live time left (eta.js), null when unknown. A corner
   * ahead of the next turn comes first, with `corner: { dir, sev }` (sev 1-6 or 'HP') for its tulip. `opts.corners` is
   * one of CORNER_MODES; `opts.call(e)` words a corner as the phone does (the plain-words setting), else its own call.
   */
  function guideMessage(t, cursorM, leftS, phrase, opts = {}) {
    if (!t || !Array.isArray(t.steps) || !finite(cursorM)) return null;
    const total = Array.isArray(t.dist) && t.dist.length ? t.dist[t.dist.length - 1] : null;
    const remain = { remainM: finite(total) ? Math.max(0, Math.round(total - cursorM)) : null, remainS: finite(leftS) ? Math.round(leftS) : null };
    const turns = t.steps.filter((s) => s && finite(s.m) && phrase(s));
    const st = turns.find((s) => s.m > cursorM - 5);
    const mode = CORNER_MODES.includes(opts.corners) ? opts.corners : 'all';
    let co = null, coM = Infinity;
    if (mode !== 'off') {
      for (const e of (Array.isArray(t.events) ? t.events : [])) {
        if (!e || e.type !== 'corner' || (e.dir !== 'L' && e.dir !== 'R') || sevOf(e) == null) continue;
        const m = cornerAt(e);
        if (!finite(m) || m <= cursorM - 5 || m >= coM || (st && m >= st.m)) continue;
        if (mode === 'tight' && !tightCorner(e)) continue;
        if (turns.some((s) => Math.abs(s.m - m) < 40)) continue;
        co = e; coM = m;
      }
    }
    if (co) {
      const v = sevOf(co), said = typeof opts.call === 'function' ? opts.call(co) : co.call;
      return { kind: 'guide', key: `${t.id || ''}:c${Math.round(coM)}`, instruction: String(said || cornerWords(co, v)),
               street: `${co.dir}${v}`,                                  // the short variant (CPManeuver instructionVariants) where the call doesn't fit
               type: cornerType(co.dir, v), corner: { dir: co.dir, sev: v }, distM: Math.max(0, Math.round(coM - cursorM)), ...remain };
    }
    if (!st) return null;
    return { kind: 'guide', key: `${t.id || ''}:${Math.round(st.m)}`, instruction: phrase(st), street: st.street || '', type: st.type,
             distM: Math.max(0, Math.round(st.m - cursorM)), ...remain };
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
    let path;
    if (sev === 'HP') {
      path = `<path d="M50 92 V44 A16 16 0 0 ${s > 0 ? 1 : 0} ${50 + 32 * s} 44 V70"/><path d="M${50 + 32 * s - 11} 59 L${50 + 32 * s} 71 L${50 + 32 * s + 11} 59"/>`;
    } else {
      const deg = CORNER_BEND[sev] || 45, a = s * deg * Math.PI / 180;
      const top = deg > 100 ? 40 : 50, r = 36;
      const ex = 50 + Math.sin(a) * r, ey = top - Math.cos(a) * r;
      const hx = Math.sin(a), hy = -Math.cos(a), px = -hy, py = hx;
      // a smooth bend: the control point sits up the stem, so the line arcs instead of kinking at a junction
      path = `<path d="M50 92 V${top + 14} C50 ${top - 6} ${(ex - hx * 20).toFixed(1)} ${(ey - hy * 20).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"/>`
        + `<path d="M${(ex - hx * 12 + px * 9).toFixed(1)} ${(ey - hy * 12 + py * 9).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - hx * 12 - px * 9).toFixed(1)} ${(ey - hy * 12 - py * 9).toFixed(1)}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120"><g fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;
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

  const api = { sightMessage, line, routeMessage, guideMessage, placesMessage, cornersMessage, hazardsMessage, lookMessage, tulipSVG, cornerTulipSVG, CORNER_MODES, MAX_POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarPlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
