// ApexFunRoute — the most fun way from A to B within a time budget (docs/ROUTING.md).
// 1. Score any routed line for fun from its geometry: corners worth driving per km, how they
//    flow into each other, and how much of it is long dull straight. Turns at junctions
//    (the router's maneuver points) are not corners: a grid of town streets is not a twisty road.
// 2. Find stages (web/stages.js) inside the A→B corridor, time the connectors between them with
//    one router matrix call (crow-fly guesses are wildly wrong in hills: 10 km apart can be 80 km
//    by road), and chain the 1–2 stages that fit the budget, so the router drives them on the way.
// 3. Rank every candidate (the quickest route, the router's alternates, stage detours) by fun
//    minus a time cost that depends on the chosen fun level, never past that level's budget.
// Geometry only: these are map-derived scores, labelled as such, never measured road feel.
(function (root) {
  'use strict';

  // Fun levels: how much extra time a more fun route may cost, and what a minute is worth.
  // `budget` is the most extra time over the quickest route (share of its time, plus `slackS`
  // so short trips can still take a good road); `perMin` is fun points given up per extra minute.
  // The owner (2026-11-08): "fun should never go on the highway. Quick should essentially be a normal route". Quick is
  // the quickest way as any nav app drives it, highways welcome, a nicer road only in a near-tie (a minute at most); Fun
  // and Long way never drive a motorway or trunk road (`noHighway`, levelHighways below; graph_router.js K.NO_HWY).
  const LEVELS = {
    quick: { budget: 0, slackS: 60, perMin: 3.0, label: 'Quick' },           // the quickest; a minute at most for a nicer road
    fun: { budget: 0.35, slackS: 240, perMin: 1.0, label: 'Fun', noHighway: true },           // ~2 a minute
    max: { budget: 0.90, slackS: 600, perMin: 0.35, label: 'Long way', noHighway: true },     // ~0.7 a minute (was "Max fun": plain words, vocabulary.js)
  };
  // Highways at Fun and Long way: a candidate with at most HWY_FREE_KM on motorway or trunk is highway-free (a matched
  // line can catch a few metres of the road it crosses over); a highway-free way more than HWY_ABSURD x the quickest's
  // time is still the level's way, and the card says Quick is the way; the exception (no highway-free way at all) keeps
  // the candidates within HWY_LINK_TOL_KM of the least highway.
  const HWY = { FREE_KM: 0.1, ABSURD: 2, LINK_TOL_KM: 0.3, SLACK_S: 60 };
  /**
   * km of a candidate on motorway, trunk or their links: our router's own count (route.hwyKm), else the route engine's from
   * the context's road class (ev.stats.highwayKm), else the router's summary flag (route.has.highways false: none);
   * null when unknown.
   */
  function highwayKm(c) {
    const r = c && c.route;
    if (r && Number.isFinite(r.hwyKm)) return r.hwyKm;
    const st = c && c.ev && c.ev.stats;
    if (st && Number.isFinite(st.highwayKm)) return st.highwayKm;
    if (r && r.has && r.has.highways === false) return 0;
    return null;
  }
  /**
   * Which candidates a level may pick, by the highways they drive. Quick (and any level without `noHighway`): all of them,
   * rule 'any'. Fun and Long way: the highway-free ones when any exists (rule 'free'; `absurd` when the quickest of them
   * takes more than HWY.ABSURD x quickS); else the ones with the least highway (rule 'link', the exception: `minKm`);
   * nothing known about highways: all of them, rule 'unknown'. { list, rule, absurd, freeS, minKm }.
   */
  function levelHighways(cands, level, quickS) {
    const L = LEVELS[level];
    if (!L || !L.noHighway) return { list: cands, rule: 'any', absurd: false, freeS: null, minKm: null };
    const km = cands.map((c) => highwayKm(c));
    const free = cands.filter((c, i) => km[i] != null && km[i] <= HWY.FREE_KM);
    if (free.length) {
      const times = free.map((c) => c.timeS).filter(Number.isFinite), freeS = times.length ? Math.min(...times) : null;
      return { list: free, rule: 'free', absurd: freeS != null && Number.isFinite(quickS) && freeS > HWY.ABSURD * quickS, freeS, minKm: 0 };
    }
    const known = km.filter((k) => k != null);
    if (!known.length) return { list: cands, rule: 'unknown', absurd: false, freeS: null, minKm: null };
    const minKm = Math.min(...known);
    return { list: cands.filter((c, i) => km[i] != null && km[i] <= minKm + HWY.LINK_TOL_KM), rule: 'link', absurd: false, freeS: null, minKm };
  }
  /**
   * A ranked list for a level that never drives a highway: its candidates kept by levelHighways, the budget opened so the
   * quickest of them always stays in (+ HWY.SLACK_S), and each marked { hwyRule, hwyKm, hwyAbsurd, hwyFreeS } for the
   * card. valued: [{ timeS, extraS, ... }] (copies, as the rankings make them); quickS the quickest's time; limit the
   * level's own. Returns { list, limit }.
   */
  function applyHighways(valued, level, quickS, limit) {
    const h = levelHighways(valued, level, quickS);
    if (h.rule === 'any' || h.rule === 'unknown') return { list: valued, limit };
    const times = h.list.map((c) => c.timeS).filter(Number.isFinite);
    const lim = Math.max(limit, (times.length ? Math.min(...times) : 0) + HWY.SLACK_S);
    for (const c of h.list) Object.assign(c, { hwyRule: h.rule, hwyKm: highwayKm(c), hwyAbsurd: h.absurd, hwyFreeS: h.freeS });
    return { list: h.list, limit: lim };
  }

  // Corners between houses (2026-11-04, the owner's report: 15 corners on a road lined with houses, a house every 20 m,
  // won a 12-minute detour). The route engine's built evidence, where two of its signals agree (builtAgree), cuts a
  // corner's weight from BUILT.lo, by BUILT.cut at BUILT.hi and above; open country keeps it in full. The route engine
  // (W.BUILT_*) and our router (graph_router.js, from the tiles' road channels) use these same numbers.
  const BUILT = { lo: 0.4, hi: 0.85, cut: 1 };
  const builtKeep = (b) => (typeof b === 'number' && Number.isFinite(b) ? 1 - BUILT.cut * Math.max(0, Math.min(1, (b - BUILT.lo) / (BUILT.hi - BUILT.lo))) : 1);
  /** Built evidence two signals agree on: the second highest of the 0..1 readings known (null under two: one map layer's
   * outbuildings or one wide parking lot isn't a town). */
  function builtAgree(xs) {
    let a = -1, b = -1, n = 0;
    for (const x of xs) { if (typeof x !== 'number' || !Number.isFinite(x)) continue; n++; if (x > a) { b = a; a = x; } else if (x > b) b = x; }
    return n >= 2 ? b : null;
  }

  const TURN_NEAR_M = 30;          // a corner whose apex is this close to a junction turn is the turn
  const FLOW_GAP_M = 250;          // corners closer than this run together
  const DULL_STRAIGHT_M = 1500;    // straights longer than this are dull
  const TWIST_FULL_PER_KM = 3.0;   // weighted corners per km that make Twist 100
  const FLOW_FULL_SHARE = 0.5;     // share of the route in flowing runs that makes Flow 100

  const isCorner = (e) => e && e.type === 'corner';
  /** Just what score() needs from a router polyline ([[lon, lat]]): 5 m samples, distances and corners. */
  function geometry(coords, Core = root.ApexCore) {
    const rs = Core.resamplePolyline(coords.map(c => c[1]), coords.map(c => c[0]), 5);
    const { kappa, ds } = Core.computeCurvature(rs.lat, rs.lon);
    const dist = rs.lat.map((_, i) => i * 5);
    const events = Core.detectCorners(kappa, ds).map(c => ({ type: 'corner', severity: c.severity, dist_m: dist[c.apex], start_m: dist[c.start], end_m: dist[c.end] }));
    return { lat: rs.lat, lon: rs.lon, dist, events };
  }
  // What a corner is worth: 2–5 are the good stuff; fast 6s and tight 1s a bit less; hairpins
  // are a moment, not a rhythm.
  function cornerWeight(sev, prefs = null) {
    let w = sev === 'HP' ? 0.6 : sev >= 2 && sev <= 5 ? 1.0 : sev === 6 ? 0.6 : sev === 1 ? 0.5 : 0;
    // Road character the driver asked for (IDEAS R-19): tight corners (hairpins, 1s and 2s) and fast sweepers (5s and 6s)
    // count PREF_STEP more or less each; nothing asked, the weights above unchanged.
    if (prefs && w) {
      const tight = sev === 'HP' || sev === 1 || sev === 2, fast = sev === 5 || sev === 6;
      if (tight && Number.isFinite(prefs.tight)) w *= 1 + PREF_STEP * Math.max(-1, Math.min(1, prefs.tight));
      if (fast && Number.isFinite(prefs.fast)) w *= 1 + PREF_STEP * Math.max(-1, Math.min(1, prefs.fast));
    }
    return w;
  }
  const PREF_STEP = 0.6;

  /**
   * Fun score of a routed track ({dist[], events[]}, as trackFromPolyline builds it).
   * turnsM: distances along the route of the router's turn maneuvers (left/right/sharp/U),
   * used to drop junction turns. Returns null when the line is too short to judge. scaleAt (optional, metres along → 0–1):
   * how much a corner there counts, the route engine's quality gate (web/route_engine.js: a corner on a side street is
   * worth nothing); `good` is then the gated count. Without it, every corner counts in full, as before.
   */
  function score(track, turnsM = [], prefs = null, scaleAt = null) {
    const dist = track && track.dist;
    if (!Array.isArray(dist) || dist.length < 2) return null;
    const totalM = dist[dist.length - 1];
    if (!(totalM >= 500)) return null;
    const turns = (turnsM || []).filter(Number.isFinite).sort((a, b) => a - b);
    const nearTurn = (m) => {
      let lo = 0, hi = turns.length - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (turns[mid] < m) lo = mid + 1; else hi = mid - 1; }
      return (lo < turns.length && turns[lo] - m <= TURN_NEAR_M) || (lo > 0 && m - turns[lo - 1] <= TURN_NEAR_M);
    };
    const corners = (track.events || []).filter(isCorner)
      .filter(c => Number.isFinite(c.dist_m) && !nearTurn(c.dist_m))
      .map(c => { const k = scaleAt ? scaleAt(c.dist_m) : 1, g = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 1;
        return { at: c.dist_m, start: Number.isFinite(c.start_m) ? c.start_m : c.dist_m, end: Number.isFinite(c.end_m) ? c.end_m : c.dist_m, w: cornerWeight(c.severity, prefs) * g, g, sev: c.severity }; })
      .filter(c => c.w > 0)
      .sort((a, b) => a.start - b.start);
    const km = totalM / 1000;
    const weighted = corners.reduce((s, c) => s + c.w, 0);
    const goodList = corners.filter(c => c.sev !== 'HP' && c.sev >= 2 && c.sev <= 5);
    const good = scaleAt ? Math.round(goodList.reduce((s, c) => s + c.g, 0)) : goodList.length;
    // Flow: runs of 3+ corners each within FLOW_GAP_M of the last; their length over the route. Gated (scaleAt), a run
    // counts by its corners' mean gate: a wiggle through a subdivision or between houses is not flow (2026-11-04: it was
    // counted in full, so Flow and Dull, half the fun score, ignored the gate)
    let flowM = 0;
    for (let i = 0; i < corners.length;) {
      let j = i, g = corners[i].g;
      while (j + 1 < corners.length && corners[j + 1].start - corners[j].end <= FLOW_GAP_M) { j++; g += corners[j].g; }
      if (j - i + 1 >= 3) flowM += (corners[j].end - corners[i].start) * g / (j - i + 1);
      i = j + 1;
    }
    // Dull: straights (gaps between corners, and before the first / after the last) longer than DULL_STRAIGHT_M. Gated,
    // only a corner the gate counts at least half breaks a straight.
    let dullM = 0, prev = 0;
    for (const c of corners) { if (c.g < 0.5) continue; const gap = c.start - prev; if (gap > DULL_STRAIGHT_M) dullM += gap; prev = Math.max(prev, c.end); }
    if (totalM - prev > DULL_STRAIGHT_M) dullM += totalM - prev;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const twist = clamp(weighted / km / TWIST_FULL_PER_KM * 100);
    const flow = clamp(flowM / totalM / FLOW_FULL_SHARE * 100);
    const dullShare = Math.min(1, dullM / totalM);
    const fun = clamp(0.5 * twist + 0.35 * flow + 0.15 * (1 - dullShare) * 100);
    return { fun: Math.round(fun), twist: Math.round(twist), flow: Math.round(flow), dullShare, good, goodPerKm: good / km, km };
  }

  // ---- corridor stages ------------------------------------------------------------
  const kmBetween = (a, b) => {
    const dy = (a.lat - b.lat) * 110.54, dx = (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dx, dy);
  };
  // Along-track position of p on A→B: 0 at A, 1 at B.
  function along(a, b, p) {
    const kx = 111.32 * Math.cos(a.lat * Math.PI / 180), ky = 110.54;
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky, px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
    const L2 = bx * bx + by * by;
    return L2 > 0 ? (px * bx + py * by) / L2 : 0;
  }
  const endsOf = (s) => ({ a: { lat: s.lat[0], lon: s.lon[0] }, b: { lat: s.lat[s.lat.length - 1], lon: s.lon[s.lon.length - 1] } });
  const midOf = (s) => ({ lat: s.lat[s.lat.length >> 1], lon: s.lon[s.lon.length >> 1] });
  function overlap(s, t) {
    const ms = midOf(s);
    for (let i = 0; i < t.lat.length; i += 40) if (kmBetween(ms, { lat: t.lat[i], lon: t.lon[i] }) < 0.3) return true;
    return false;
  }
  /** Where to look for stages: the corridor's middle, with a radius that covers it (capped by the tile budget). */
  function searchArea(from, to, maxRadiusKm = 14) {
    const d = kmBetween(from, to);
    return { center: { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 }, radiusKm: Math.max(5, Math.min(maxRadiusKm, d / 2 + 3)) };
  }
  // ---- long trips ---------------------------------------------------------------------
  // The public server's cost matrix gives up on long connections (Knoxville → Asheville, 130 km crow fly, comes back null
  // although the route exists), and one search circle only covers ~22 km of corridor. So a long trip is cut along its
  // quickest route into sections of about SECTION_KM crow fly, each planned like a short trip, and the sections' best
  // stages are chained into one route (at most 4 stages: the router takes 10 locations).
  const SECTION_KM = 24, SINGLE_KM = 22;
  /** How many sections: 1 up to SINGLE_KM crow fly, then at least 2 and one per SECTION_KM, at most `max`. */
  function sectionCount(from, to, max = 3) {
    const d = kmBetween(from, to);
    return d <= SINGLE_KM || max < 2 ? 1 : Math.max(2, Math.min(max, Math.ceil(d / SECTION_KM)));
  }
  /** n + 1 cut points along a route polyline ([[lon, lat]]) at equal distances, first = start, last = end. */
  function sectionPoints(coords, n) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + kmBetween({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: coords[i][1], lon: coords[i][0] }));
    const total = cum[cum.length - 1], out = [];
    for (let k = 0, i = 0; k <= n; k++) {
      const at = total * k / n;
      while (i < cum.length - 1 && cum[i] < at) i++;
      out.push({ lat: coords[i][1], lon: coords[i][0] });
    }
    return out;
  }
  /**
   * Chain per-section plans (each section's list best first, possibly empty; section k planned against quickS / n) into
   * whole-trip plans: the best of every section, then variants that swap one section for its next best. Stages in travel
   * order; at most `maxStages` in all (the router's 10 locations), dropping the weakest sections' picks first; a pick that
   * re-drives a stage an earlier section already took is dropped. Time and value are recomputed for the whole trip (a
   * section without a pick counts its quick share) and plans past the level's budget are left out.
   */
  function combineSections(sections, quickS, level = 'fun', count = 2, maxStages = 4) {
    const L = LEVELS[level] || LEVELS.fun, n = sections.length;
    const limit = quickS * (1 + L.budget) + L.slackS;
    const chain = (choice) => {
      let picks = [];
      for (let k = 0; k < n; k++) {
        const p = sections[k][choice[k]];
        if (p && !p.legs.some(l => picks.some(x => x.p.legs.some(m => overlap(l.s, m.s) || overlap(m.s, l.s))))) picks.push({ p, k });
      }
      while (picks.reduce((c, x) => c + x.p.legs.length, 0) > maxStages && picks.length) {
        picks = picks.filter(x => x !== picks.reduce((a, b) => (b.p.value < a.p.value ? b : a)));
      }
      if (!picks.length) return null;
      const legs = picks.flatMap(x => x.p.legs);
      const timeS = picks.reduce((t, x) => t + x.p.timeS, 0) + (n - picks.length) * quickS / n;
      if (timeS > limit) return null;
      const score = legs.reduce((v, l) => v + l.s.score, 0);
      return { legs, timeS, stageKm: legs.reduce((v, l) => v + l.s.km, 0), value: score + setList(legs) - L.perMin * Math.max(0, timeS - quickS) / 60 };
    };
    const out = [], seen = new Set();
    const add = (choice) => {
      const p = chain(choice);
      if (!p) return;
      const key = planKey(p);
      if (seen.has(key)) return;
      seen.add(key); out.push(p);
    };
    add(sections.map(() => 0));
    for (let k = 0; k < n && out.length < count; k++) if (sections[k].length > 1) add(sections.map((_, j) => (j === k ? 1 : 0)));
    return out.slice(0, count);
  }
  /** A plan's identity: its stages in order with their direction (for de-duplicating plans from different searches). */
  const planKey = (p) => p.legs.map(l => `${l.s.lat[0]},${l.s.lon[0]}${l.fwd ? '>' : '<'}`).join('|');

  /**
   * The stages worth asking the router about: inside the budget's ellipse around A→B (crow fly,
   * so only a sanity cut), not duplicates of each other, best scores first. At most `k`, so the
   * connector matrix stays within the public server's 100 pairs: (1 + 2k) x (2k + 1). `slack`: how far past
   * either end (as a share of A→B) a stage's middle may lie; sections use 0 so neighbours don't share stages.
   */
  function shortlist(from, to, stages, budget, k = 4, slack = 0.15) {
    const maxKm = kmBetween(from, to) * (1 + budget) + 3;
    const out = [];
    for (const s of stages || []) {
      const m = midOf(s), u = along(from, to, m);
      if (u < -slack || u > 1 + slack || kmBetween(from, m) + kmBetween(m, to) > maxKm) continue;
      if (out.some(t => overlap(s, t))) continue;
      out.push(s);
      if (out.length === k) break;
    }
    return out;
  }
  /** Matrix request: sources = [A, every stage end], targets = [every stage end, B]. Stage i has ends 2i and 2i+1. */
  function matrixPoints(from, to, list) {
    const ends = [];
    for (const s of list) { const e = endsOf(s); ends.push(e.a, e.b); }
    return { sources: [from, ...ends], targets: [...ends, to] };
  }
  // Which way round a stage is better (IDEAS R-11): technical ones climbed, flowing ones descended, worth DIRECTION_BONUS of
  // the stage's value in the ranking when the DEM says it really climbs (stages.js addElevations); unknown, no bonus.
  const DIRECTION_BONUS = 0.15, CLIMB_M = 40, TECH_PER_KM = 1.2;
  function directionBonus(s, fwd) {
    if (!s || !Number.isFinite(s.elevA) || !Number.isFinite(s.elevB) || Math.abs(s.elevB - s.elevA) < CLIMB_M || !(s.km > 0)) return 0;
    const up = fwd ? s.elevB > s.elevA : s.elevA > s.elevB, technical = (s.tight || 0) / s.km >= TECH_PER_KM;
    return (technical ? up : !up) ? DIRECTION_BONUS * Math.max(0, s.score || 0) : 0;
  }
  // Set list (IDEAS R-12, ROAD_INTELLIGENCE §7.2.5): with the same stages, the order that finishes on the most technical one
  // is worth SET_FINISH of their value, and three max-TECH stages back to back (tight corners per km ≥ MAX_TECH_PER_KM) lose
  // SET_FATIGUE of it: tiring is a safety issue. Builds and rests follow: the hardest comes last, the others before it.
  const SET_FINISH = 0.04, SET_FATIGUE = 0.25, MAX_TECH_PER_KM = 2.5;
  const techOf = (s) => (s && s.km > 0 ? (s.tight || 0) / s.km : 0);
  function setList(legs) {
    if (!legs || legs.length < 2) return 0;
    const tech = legs.map(l => techOf(l.s)), total = legs.reduce((v, l) => v + Math.max(0, l.s.score || 0), 0);
    let adjust = 0;
    if (tech[tech.length - 1] >= Math.max(...tech) && Math.max(...tech) > Math.min(...tech)) adjust += SET_FINISH * total;
    for (let i = 2; i < tech.length; i++) if (tech.slice(i - 2, i + 1).every(t => t >= MAX_TECH_PER_KM)) { adjust -= SET_FATIGUE * total; break; }
    return adjust;
  }
  const STAGE_KMH = 50;   // drive time on a stage itself (twisty roads; the router's own time replaces it once routed)
  /**
   * Plans of 1–2 shortlisted stages from the connector matrix (seconds; null = no road), each stage
   * driven either way. Time = A→entry + stage + exit→next entry ... + exit→B. Kept when within the
   * level's budget over the quickest route; ranked by stage value minus the level's time cost.
   */
  function plansFromMatrix(list, timesS, quickestS, level = 'fun', count = 3, maxStages = 2) {
    const L = LEVELS[level] || LEVELS.fun;
    const limit = quickestS * (1 + L.budget) + L.slackS;
    const n = list.length, B = 2 * n;
    const src = (end) => 1 + end;                         // row of a stage end as a source (A is row 0)
    const T = (row, col) => { const v = timesS[row] && timesS[row][col]; return Number.isFinite(v) ? v : null; };
    const stageS = (s) => s.km / STAGE_KMH * 3600;
    const out = [];
    const legsOf = (picks) => picks.map(([i, fwd]) => ({ s: list[i], fwd, entry: 2 * i + (fwd ? 0 : 1), exit: 2 * i + (fwd ? 1 : 0) }));
    const consider = (picks) => {
      const legs = legsOf(picks);
      let row = 0, time = 0, value = 0, stageKm = 0;
      for (const leg of legs) {
        const c = T(row, leg.entry);
        if (c == null) return;
        time += c + stageS(leg.s); value += leg.s.score + directionBonus(leg.s, leg.fwd); stageKm += leg.s.km;
        row = src(leg.exit);
      }
      const last = T(row, B);
      if (last == null) return;
      time += last;
      if (time > limit) return;
      out.push({ legs: legs.map(({ s, fwd }) => ({ s, fwd })), timeS: time, stageKm, value: value + setList(legs) - L.perMin * Math.max(0, time - quickestS) / 60 });
    };
    for (let i = 0; i < n; i++) for (const fi of [true, false]) {
      consider([[i, fi]]);
      if (maxStages > 1) for (let j = 0; j < n; j++) if (j !== i) for (const fj of [true, false]) consider([[i, fi], [j, fj]]);
    }
    out.sort((a, b) => b.value - a.value);
    const picked = [], seen = new Set();
    for (const p of out) {
      const key = p.legs.map(l => list.indexOf(l.s)).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key); picked.push(p);
      if (picked.length === count) break;
    }
    return picked;
  }
  // ---- loops ------------------------------------------------------------------------
  /**
   * A routed loop's value on the same 0–100 fun scale as A→B routes (so the measured adjustment means the same
   * on both): fun score minus 2 points per % of the loop driven twice (out-and-back spurs, the same road both ways)
   * and 0.8 per % it misses the asked length. Unscored geometry (too short) is worth nothing.
   */
  function loopValue(fun, km, targetKm, retraced) {
    const f = fun && Number.isFinite(fun.fun) ? fun.fun : 0;
    return f - 200 * (retraced || 0) - 80 * Math.abs(km - targetKm) / targetKm;
  }
  /**
   * A loop's level (the plan flow, finding 6), as a destination route has one: Quick keeps nearest the length you asked
   * for, Long way gives more for corners and lets the length run. What it adds to a loop's value (loopValue's Fun level is
   * 0), from the loop's fun score and how far off the asked length it is (a share: 0.1 is 10 % long or short). The card's
   * level switch re-ranks the loops already built with it; nothing is planned again.
   */
  const LOOP_LEVEL = { quick: { fun: 0.6, len: 2.0 }, fun: { fun: 1, len: 1 }, max: { fun: 1.4, len: 0.5 } };
  function loopLevelAdjust(fun, offShare, level) {
    const L = LOOP_LEVEL[level] || LOOP_LEVEL.fun, f = fun && Number.isFinite(fun.fun) ? fun.fun : 0;
    return (L.fun - 1) * f - 80 * (L.len - 1) * (Number.isFinite(offShare) ? Math.abs(offShare) : 0);
  }
  /**
   * A loop is a drive for fun back to the start (the owner, 2026-11-04: "it also seems to route mostly highway for
   * loops"): a motorway or trunk road may be a short link to the good roads, never the bulk. What a loop gives up for the
   * share of it on motorway or trunk (0..1) beyond the level's free share: 1.5 points per % over (retraced road is 2 per %,
   * loopValue). Quick lets a quarter be highway, Fun a tenth, Long way a twentieth. Unknown (null) costs nothing: the road
   * class wasn't known, which is not the same as no highway.
   */
  const LOOP_HWY = { quick: { free: 0.25, per: 100 }, fun: { free: 0.10, per: 150 }, max: { free: 0.05, per: 150 } };
  function loopHighwayCost(share, level) {
    if (!Number.isFinite(share)) return 0;
    const L = LOOP_HWY[level] || LOOP_HWY.fun;
    return L.per * Math.max(0, share - L.free);
  }
  /**
   * Does loop a beat loop b on everything the card shows (corners and time), without more of it retraced or on highway,
   * and not much further off the asked length (0.2 of it: a 28 mi loop isn't the answer to a 15 mi ask because it is
   * quicker than a slow 15)? Then b must never rank above a, at any level (the owner, a 90 mi Long way loop: C, 2:03 and 89
   * corners, picked over A, 1:53 and 118). Items: { corners, timeS, retraced, hwyShare, off, hard }; unknown numbers never
   * dominate.
   */
  function loopDominates(a, b) {
    const n = Number.isFinite;
    if (!a || !b || a.hard || !n(a.corners) || !n(b.corners) || !n(a.timeS) || !n(b.timeS)) return false;
    if (!(a.corners >= b.corners && a.timeS <= b.timeS && (a.corners > b.corners || a.timeS < b.timeS))) return false;
    if ((a.retraced || 0) > (b.retraced || 0) + 0.05) return false;
    if (n(a.off) && Math.abs(a.off) > (n(b.off) ? Math.abs(b.off) : 0) + 0.2) return false;
    if (n(a.hwyShare) ? n(b.hwyShare) && a.hwyShare > b.hwyShare + 0.05 : n(b.hwyShare)) return false;
    return true;
  }
  /**
   * Which way a loop heads (the owner, 2026-11-10: "why do loops need a long way a fun and a quick? the whole point is
   * aimless driving"): a loop's own choice is where it goes, not a route style. The compass bearing from its start to the
   * middle of its road (each stretch weighed by its length), as { deg: 0..360 clockwise from north, name } with one of
   * eight names; null when it circles its start (the middle within a tenth of its furthest reach) or has no shape.
   */
  const WAYS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  function loopWay(t) {
    const la = t && t.lat, lo = t && t.lon;
    if (!Array.isArray(la) || !Array.isArray(lo) || la.length < 3 || la.length !== lo.length) return null;
    const k = Math.cos(la[0] * Math.PI / 180);
    let x = 0, y = 0, w = 0, far = 0, px = 0, py = 0;
    for (let i = 1; i < la.length; i++) {
      const dx = (lo[i] - lo[0]) * k, dy = la[i] - la[0], seg = Math.hypot(dx - px, dy - py);
      if (!Number.isFinite(seg)) return null;
      x += seg * (dx + px) / 2; y += seg * (dy + py) / 2; w += seg;
      far = Math.max(far, Math.hypot(dx, dy)); px = dx; py = dy;
    }
    if (!(w > 0) || !(far > 0)) return null;
    x /= w; y /= w;
    if (Math.hypot(x, y) < 0.1 * far) return null;
    const deg = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    return { deg, name: WAYS[Math.round(deg / 45) % 8] };
  }
  /**
   * The loops to offer, of the ranked ones (loopRank's order: [{ item, v }], item { km, timeS, way }): the best first,
   * then loops that head another way (60 degrees or more from every one offered, or one circles the start and the
   * other doesn't) while they are within LOOP_OFFER.within points of the best, then a loop that heads the same way as
   * one offered only when it is a different drive (its length or time LOOP_OFFER.differs of the way off: two cards
   * both named "Southeast", 39 and 37 min, were no choice), up to `max`. The choices on a loop's card are these, named
   * by their way.
   */
  const LOOP_OFFER = { apartDeg: 60, within: 100, differs: 0.2 };
  function loopOffer(order, max = 3) {
    const all = (order || []).filter((x) => x && x.item), out = [];
    const same = (a, b) => Math.abs(a.km - b.km) < 0.3 && Math.abs((a.timeS || 0) - (b.timeS || 0)) < 30;
    const apart = (a, b) => (a.way && b.way ? Math.abs(((a.way.deg - b.way.deg + 540) % 360) - 180) >= LOOP_OFFER.apartDeg : !!a.way !== !!b.way);
    if (!all.length) return out;
    out.push(all[0]);
    for (const x of all) {
      if (out.length >= max) break;
      if (out.includes(x) || !(x.v >= all[0].v - LOOP_OFFER.within)) continue;
      if (out.every((y) => apart(x.item, y.item) && !same(x.item, y.item))) out.push(x);
    }
    const off = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && Math.max(a, b) > 0 ? Math.abs(a - b) / Math.max(a, b) : 0);
    const differs = (a, b) => off(a.km, b.km) >= LOOP_OFFER.differs || off(a.timeS, b.timeS) >= LOOP_OFFER.differs;
    for (const x of all) {
      if (out.length >= max) break;
      if (!out.includes(x) && out.every((y) => !same(x.item, y.item) && (apart(x.item, y.item) || differs(x.item, y.item)))) out.push(x);
    }
    return out;
  }
  /**
   * The loops built, best first for a level: value = score (the Fun ranking, no highway cost in it) + the level's
   * adjustment (loopLevelAdjust) - the level's highway cost (loopHighwayCost); then no loop stays above one that
   * dominates it (loopDominates). items: [{ score, fun, off, hwyShare, corners, timeS, retraced, hard }]. Returns
   * [{ item, v }] in order.
   */
  function loopRank(items, level) {
    // Fun and Long way: a loop on a highway never goes above one that keeps off them (the owner, 2026-11-08: "fun should
    // never go on the highway"); its share known, with HWY.FREE_KM of slack over its length for a matched line
    const L = LEVELS[level], hwyKm = (d) => (Number.isFinite(d.hwyShare) && Number.isFinite(d.km) ? d.hwyShare * d.km : Number.isFinite(d.hwyShare) && d.hwyShare === 0 ? 0 : null);
    const free = (d) => { const k = hwyKm(d); return k != null && k <= HWY.FREE_KM; };
    const anyFree = !!(L && L.noHighway) && (items || []).some(free);
    const out = (items || []).map((d) => ({ item: d, v: d.score + loopLevelAdjust(d.fun, d.off, level) - loopHighwayCost(d.hwyShare, level) - (anyFree && !free(d) ? 1000 : 0) })).sort((a, b) => b.v - a.v);
    for (let guard = 0, moved = true; moved && guard < out.length * out.length; guard++) {
      moved = false;
      for (let i = 0; i < out.length && !moved; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (!loopDominates(out[j].item, out[i].item) || (anyFree && free(out[i].item) && !free(out[j].item))) continue;
          out.splice(i, 0, out.splice(j, 1)[0]);                     // the better loop goes ahead of the one it beats
          moved = true;
          break;
        }
      }
    }
    return out;
  }
  /**
   * Stages worth timing for a loop of targetKm from start: the best-scoring ones close enough to
   * reach and come back from (crow fly out and back within the target), no duplicates. At most `k`;
   * the matrix is (1 + 2k) x (2k + 1), split into calls of 100 pairs.
   */
  function loopShortlist(start, stages, targetKm, k = 6) {
    const out = [];
    for (const s of stages || []) {
      if (s.notRoad) continue;                                  // a neighbourhood street or a poor road (rescoreStages)
      if (2 * kmBetween(start, midOf(s)) + s.km > targetKm * 1.1) continue;
      if (out.some(t => overlap(s, t))) continue;
      out.push(s);
      if (out.length === k) break;
    }
    return out;
  }
  // A neighbourhood street is not a road to drive (Best roads nearby: the owner's top pick was a residential neighbourhood).
  // One 25 m sample (or one edge of our tiles) is a street when its class is residential, living street or service AND
  // what is beside it is built up: houses (addresses or buildings) every 25 m or less, the area's density 6 or more
  // (0-15, the tiles' and the router's scale), or a posted 25 mph (40 km/h) limit where there is any density at all.
  // Class alone never decides: US TIGER imports tag county lanes "residential", and those are some of the best roads
  // here (Second Creek Road, Big Cedar Road: no houses, density 1). Nothing known beside it: unknown (null), never a guess.
  // A stage is a street when half of the samples whose answer is known are, and they cover a third of it (streetShare).
  const STREET = { CLS: 6, ADDR_PER_KM: 40, BLDG_PER_KM: 60, DENSITY: 6, SLOW_KPH: 40, RURAL_DENSITY: 2, SHARE: 0.5, KNOWN: 0.33 };
  const has = (v) => typeof v === 'number' && Number.isFinite(v);
  /** x: { cls (0 motorway .. 5 unclassified, 6 residential, 7 service), limit (posted km/h), addr, bldg (per km), density }. */
  function streetSample(x) {
    if (!x || !has(x.cls)) return null;
    if (x.cls < STREET.CLS) return false;
    if ((has(x.addr) && x.addr >= STREET.ADDR_PER_KM) || (has(x.bldg) && x.bldg >= STREET.BLDG_PER_KM) || (has(x.density) && x.density >= STREET.DENSITY)) return true;
    if (has(x.limit) && x.limit <= STREET.SLOW_KPH && has(x.density) && x.density > STREET.RURAL_DENSITY) return true;
    return has(x.addr) || has(x.bldg) || has(x.density) ? false : null;
  }
  /** Per-sample answers (true / false / null) -> { street, share, known }: street is null when too little is known. */
  function streetShare(answers) {
    const n = answers ? answers.length : 0;
    let k = 0, yes = 0;
    for (let i = 0; i < n; i++) if (answers[i] != null) { k++; if (answers[i]) yes++; }
    const known = n ? k / n : 0, share = k ? yes / k : null;
    return { street: known >= STREET.KNOWN ? share >= STREET.SHARE : null, share, known };
  }
  // Explore (R-10): the best stages near here, at most `k`, no two the same road (by place or by name). Stages arrive best first.
  // A stage the route engine found to be a neighbourhood street or a poor road (rescoreStages: s.notRoad) is never listed,
  // and once the engine has looked at any (it looks at the first 12, s.ev), one it never looked at isn't either: else the
  // unchecked 13th fills the list when the checked ones were all streets.
  function exploreShortlist(here, stages, maxKm, k = 8) {
    const out = [], looked = (stages || []).some((s) => s.ev);
    for (const s of stages || []) {
      if (s.notRoad || (looked && !s.ev)) continue;
      const e = endsOf(s);
      if (Math.min(kmBetween(here, e.a), kmBetween(here, e.b)) > maxKm) continue;
      if (out.some(t => overlap(s, t) || (s.name && t.name === s.name))) continue;   // one entry per road
      out.push(s);
      if (out.length === k) break;
    }
    return out;
  }
  /** Matrix targets for exploreShortlist: stage i's ends are 2i and 2i+1. */
  const exploreTargets = (list) => list.flatMap(s => { const e = endsOf(s); return [e.a, e.b]; });
  /**
   * The shortlisted stages you can reach within maxS by road (row 0 of a here → ends matrix in seconds, null = no road),
   * each entered from its nearer end, still best first. awayS is the drive to its start.
   */
  function explorePicks(list, timesS, maxS, count = 5) {
    const T = (col) => { const v = timesS && timesS[0] && timesS[0][col]; return Number.isFinite(v) ? v : null; };
    const out = [];
    list.forEach((s, i) => {
      const a = T(2 * i), b = T(2 * i + 1);
      if (a == null && b == null) return;
      const fwd = b == null || (a != null && a <= b), awayS = fwd ? a : b;
      if (awayS <= maxS && out.length < count) out.push({ s, fwd, awayS });
    });
    return out;
  }
  // Loops by drive time ("home in 90 minutes", R-16): stages at 25 km/h, since the router times twisty back roads well
  // below STAGE_KMH (a 43 km Smokies loop: 83 min); a connector second costs what a connector km does at 60 km/h.
  const LOOP_BY_TIME = { stageCost: (s) => s.km / 25 * 3600, perUnit: 0.08 / 60 };
  /**
   * Loops of 1–3 shortlisted stages in any order and direction, measured with real road distances
   * (matrix km; null = no road): start→entry + stage + exit→next entry ... + exit→start. Crow-fly
   * guesses ran 40–75 % long in hills. Kept within 25 % of the target; value = stage score x
   * (1 − length error) − 0.08 per connector km (the old plans() formula). Best `count`, distinct lead stage.
   * With `by` = LOOP_BY_TIME, `cost` is the matrix in seconds and `target` is seconds.
   */
  function loopPlansFromMatrix(list, cost, target, count = 3, by = { stageCost: (s) => s.km, perUnit: 0.08 }) {
    const n = list.length, home = 2 * n;
    const D = (row, col) => { const v = cost[row] && cost[row][col]; return Number.isFinite(v) ? v : null; };
    const out = [];
    const walk = (legs, used, row, connector, stageKm, score) => {
      if (legs.length) {
        const back = D(row, home);
        if (back != null) {
          const total = stageKm + connector + back, err = Math.abs(total - target) / target;
          if (err <= 0.25) out.push({ legs: legs.slice(), total, stageKm, value: (score + setList(legs)) * (1 - err) - (connector + back) * by.perUnit, share: stageKm / total });
        }
      }
      if (legs.length === 3) return;
      for (let i = 0; i < n; i++) {
        if (used & (1 << i)) continue;
        for (const fwd of [true, false]) {
          const entry = 2 * i + (fwd ? 0 : 1), exit = 2 * i + (fwd ? 1 : 0), c = D(row, entry);
          if (c == null || stageKm + connector + c > target * 1.25) continue;
          legs.push({ s: list[i], fwd });
          walk(legs, used | (1 << i), 1 + exit, connector + c, stageKm + by.stageCost(list[i]), score + list[i].score + directionBonus(list[i], fwd));
          legs.pop();
        }
      }
    };
    walk([], 0, 0, 0, 0, 0);
    out.sort((a, b) => b.value - a.value);
    // Distinct stage sets (a loop and the same loop driven backwards are one choice), then distinct lead stages.
    const picked = [], sets = new Set(), leads = new Set();
    for (const p of out) {
      const set = p.legs.map(l => list.indexOf(l.s)).sort().join(','), lead = p.legs[0].s;
      if (sets.has(set) || leads.has(lead)) continue;
      sets.add(set); leads.add(lead); picked.push(p);
      if (picked.length === count) break;
    }
    return picked;
  }

  /** Router locations: A, each stage's entry, midpoints while the 10-location budget lasts, exit, B. */
  function waypoints(from, to, plan, maxLocations = 10) {
    const legs = plan.legs.map(({ s, fwd }) => ({ lat: fwd ? s.lat : s.lat.slice().reverse(), lon: fwd ? s.lon : s.lon.slice().reverse(), km: s.km, mids: 0 }));
    let spare = maxLocations - 2 - 2 * legs.length;
    for (const leg of legs.slice().sort((a, b) => b.km - a.km)) {
      if (spare <= 0) break;
      const want = Math.min(spare, Math.max(1, Math.floor(leg.km / 2.5)));
      leg.mids = want; spare -= want;
    }
    const pts = [from];
    for (const leg of legs) {
      const n = leg.lat.length - 1;
      for (let k = 0; k <= leg.mids + 1; k++) {
        const i = Math.round((k / (leg.mids + 1)) * n);
        pts.push({ lat: leg.lat[i], lon: leg.lon[i], shaping: true });
      }
    }
    pts.push(to);
    return pts;
  }

  /**
   * Shaping points along a router polyline ([[lon, lat]]), about every `everyKm` and at most `max`, ends
   * excluded. A winning alternate keeps them as vias, so a reroute or an added stop stays on that road
   * instead of falling back to the quickest one.
   */
  function alongPoints(coords, everyKm = 6, max = 8) {
    if (!Array.isArray(coords) || coords.length < 3) return [];
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + kmBetween({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: coords[i][1], lon: coords[i][0] }));
    const total = cum[cum.length - 1], n = Math.min(max, Math.floor(total / everyKm));
    const out = [];
    for (let k = 1, i = 0; k <= n; k++) {
      const at = total * k / (n + 1);
      while (i < cum.length - 1 && cum[i] < at) i++;
      out.push({ lat: coords[i][1], lon: coords[i][0], shaping: true });
    }
    return out;
  }
  /** Where a new stop goes among a route's vias (each with distM along it): before the first via past it. */
  function insertVia(vias, stop, stopM) {
    const i = vias.findIndex(v => Number.isFinite(v.distM) && v.distM > stopM);
    const out = vias.slice();
    out.splice(i < 0 ? out.length : i, 0, stop);
    return out;
  }

  // ---- ranking --------------------------------------------------------------------
  /**
   * cands: [{ fun: score(), timeS, adjust? }]. Drops candidates past the level's budget over the
   * quickest, then ranks by fun + GAIN_PER_CORNER x good corners gained over the quickest route
   * - perMin x extra minutes (+ `adjust`, e.g. measured roughness; − glareCost, minutes into a low sun). Fun is a density, so a longer
   * route through a great stage would barely move it; the corner gain is what pays for the detour.
   * The quickest route always stays in, so there is always an answer.
   */
  const GAIN_PER_CORNER = 0.5, GAIN_CAP = 60;
  function rank(cands, level = 'fun') {
    const L = LEVELS[level] || LEVELS.fun;
    const timed = cands.filter(c => Number.isFinite(c.timeS));
    if (!timed.length) return cands.slice();
    const quick = timed.reduce((a, b) => (b.timeS < a.timeS ? b : a));
    const quickGood = quick.fun ? quick.fun.good : 0;
    const limit = quick.timeS * (1 + L.budget) + L.slackS;
    const valued = cands.map(c => {
      const extraS = Number.isFinite(c.timeS) ? Math.max(0, c.timeS - quick.timeS) : Infinity;
      const fun = c.fun ? c.fun.fun : 0, gain = c.fun ? Math.min(GAIN_CAP, Math.max(0, c.fun.good - quickGood)) : 0;
      return { ...c, extraS, value: fun + GAIN_PER_CORNER * gain - L.perMin * extraS / 60 + (c.adjust || 0) - glareCost(c) - townCost(c) - (c.weatherCost || 0) + (c.tasteBonus || 0) + (c.preferBonus || 0) };
    });
    // Fun and Long way: off the highways (applyHighways); the quickest stays in only where it may be picked
    const h = applyHighways(valued, level, quick.timeS, limit);
    return h.list.filter(c => (c.extraS === 0 && h.list === valued) || c.timeS <= h.limit).sort((a, b) => b.value - a.value);
  }

  /**
   * Why the winner beat the quickest route, from the router's own road names (km per named road): the roads it
   * spends at least `minKm` more on than the quickest, most first (at most 3), the good corners it gains and the
   * minutes it costs. null when the winner is the quickest, or nothing is known (no names, no fun score).
   */
  function why(best, quick, minKm = 2) {
    if (!best || !quick || best === quick || !(best.timeS > quick.timeS)) return null;
    const bn = best.route && best.route.names, qn = quick.route && quick.route.names;
    const roads = bn instanceof Map ? [...bn].map(([name, km]) => ({ name, km: km - ((qn instanceof Map && qn.get(name)) || 0) }))
      .filter(r => r.km >= minKm).sort((a, b) => b.km - a.km).slice(0, 3) : [];
    const gained = best.fun && quick.fun ? Math.max(0, best.fun.good - quick.fun.good) : null;
    if (!roads.length && !gained) return null;
    return { roads, gained, extraMin: Math.round((best.timeS - quick.timeS) / 60) };
  }

  // ---- avoid options ------------------------------------------------------------------
  // What the driver asked to stay off. Unpaved is avoided by default: stages never use it (web/stages.js) and most cars
  // that want this app don't want gravel. Highways and tolls are already de-prioritised, not avoided, by default.
  const AVOID_DEFAULT = { highways: false, tolls: false, ferries: false, unpaved: true, towns: false, cameras: false, police: false };
  const AVOID_LABELS = { highways: 'highways', tolls: 'tolls', ferries: 'ferries', unpaved: 'unpaved roads', towns: 'towns', cameras: 'cameras', police: 'police reports' };
  /**
   * Did the router actually drive the stages (IDEAS R-14, ROAD_INTELLIGENCE §7.2.4)? For each stage of `plan`, the share of
   * its length (sampled every ~50 m) that lies within `nearM` of the returned route ([lon, lat] coords). The lowest share
   * across stages; 1 for a plan with no stages. Under STAGE_KEPT the router took a shortcut and the plan didn't happen.
   */
  const STAGE_KEPT = 0.7;
  function stageCoverage(coords, plan, nearM = 40) {
    if (!plan || !Array.isArray(plan.legs) || !plan.legs.length) return 1;
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    const lat0 = coords[0][1], c = Math.cos(lat0 * Math.PI / 180), mx = 111320 * c, my = 110540;
    const rx = coords.map((p) => p[0] * mx), ry = coords.map((p) => p[1] * my);
    let worst = 1;
    for (const { s } of plan.legs) {
      const n = (s.lat || []).length;
      if (n < 2) continue;
      const step = Math.max(1, Math.round(n / Math.max(2, (s.km || 0) * 20)));       // about every 50 m
      let near = 0, total = 0;
      for (let i = 0; i < n; i += step) {
        const x = s.lon[i] * mx, y = s.lat[i] * my;
        total++;
        for (let j = 0; j < rx.length; j++) {
          if (Math.abs(rx[j] - x) <= nearM && Math.abs(ry[j] - y) <= nearM && Math.hypot(rx[j] - x, ry[j] - y) <= nearM) { near++; break; }
        }
      }
      if (total) worst = Math.min(worst, near / total);
    }
    return worst;
  }
  const keptStages = (coords, plan) => stageCoverage(coords, plan) >= STAGE_KEPT;
  /** The camera span a trip may ask the camera map for (degrees each way); bigger trips route without (IDEAS R-35). */
  const CAMERA_BOX_DEG = 1.0;
  /**
   * Plate-reading cameras (OSM, DeFlock) to send the router as exclude_locations (IDEAS R-35): those within `padKm` of the
   * trip's box, nearest the straight line from start to end first, at most `max` (the public router's limit is shared with
   * closures). The router avoids the road edge nearest each one.
   */
  function camerasToExclude(nodes, points, max = 40, padKm = 2) {
    const pts = (points || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 2 || max <= 0) return [];
    const lat0 = Math.min(...pts.map((p) => p.lat)), lat1 = Math.max(...pts.map((p) => p.lat));
    const lon0 = Math.min(...pts.map((p) => p.lon)), lon1 = Math.max(...pts.map((p) => p.lon));
    const c = Math.max(0.2, Math.cos(((lat0 + lat1) / 2) * Math.PI / 180)), dLat = padKm / 110.54, dLon = padKm / (111.32 * c);
    const a = pts[0], b = pts[pts.length - 1];
    const off = (n) => {                                            // km from the start-end line, flat-earth
      const ax = 0, ay = 0, bx = (b.lon - a.lon) * 111.32 * c, by = (b.lat - a.lat) * 110.54, px = (n.lon - a.lon) * 111.32 * c, py = (n.lat - a.lat) * 110.54;
      const L = bx * bx + by * by, t = L ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0;
      return Math.hypot(px - (ax + t * bx), py - (ay + t * by));
    };
    return (nodes || []).filter((n) => n && Number.isFinite(n.lat) && Number.isFinite(n.lon)
        && n.lat >= lat0 - dLat && n.lat <= lat1 + dLat && n.lon >= lon0 - dLon && n.lon <= lon1 + dLon)
      .map((n) => ({ lat: n.lat, lon: n.lon, k: off(n) })).sort((x, y) => x.k - y.k).slice(0, max).map(({ lat, lon }) => ({ lat, lon }));
  }
  /** Valhalla auto costing for the avoid options (preferences, not hard bans: the router may still need one). */
  /**
   * Router options for the avoid chips and the car you drive (IDEAS R-20, your Garage's daily car): a lowered car never gets
   * unpaved roads, and a width (mirrors included) keeps to roads whose posted width fits. No car or unknown: nothing changes.
   */
  function costing(avoid = AVOID_DEFAULT, car = null) {
    const auto = { use_highways: avoid.highways ? 0 : 0.15, use_tolls: avoid.tolls ? 0 : 0.3 };
    if (avoid.ferries) auto.use_ferry = 0;
    if (avoid.unpaved || (car && car.clearance === 'low')) auto.exclude_unpaved = true;
    if (car && Number.isInteger(car.width_cm) && car.width_cm >= 120 && car.width_cm <= 300) auto.width = car.width_cm / 100;
    return { costing: 'auto', costing_options: { auto } };
  }
  /**
   * Where a route's stages are along it (IDEAS V-07, for "how far to the next stage" and "skip this stage"): each stage's
   * entry and exit placed on the route `t` ({lat, lon, dist}) in order, as { name, a, b, startM, endM }. `stages` are a
   * plan's legs ({ s, fwd }) or spans from before (a reroute: placed again on the new route). A stage whose ends aren't
   * within 60 m of the route (the reroute left it) is dropped.
   */
  function stageSpans(t, stages) {
    if (!t || !t.lat || !t.lat.length || !Array.isArray(stages)) return [];
    const c = Math.cos(t.lat[0] * Math.PI / 180), out = [];
    const near = (p, from) => {
      let best = -1, bd = Infinity;
      for (let i = from; i < t.lat.length; i++) {
        const d = Math.hypot((t.lat[i] - p.lat) * 110540, (t.lon[i] - p.lon) * 111320 * c);
        if (d < bd) { bd = d; best = i; }
      }
      return bd <= 60 ? best : -1;
    };
    let from = 0;
    for (const x of stages) {
      let a = x.a, b = x.b;
      if (x.s) {
        const n = x.s.lat.length - 1, i0 = x.fwd ? 0 : n, i1 = x.fwd ? n : 0;
        a = { lat: x.s.lat[i0], lon: x.s.lon[i0] }; b = { lat: x.s.lat[i1], lon: x.s.lon[i1] };
      }
      const ia = near(a, from), ib = ia < 0 ? -1 : near(b, ia);
      if (ia < 0 || ib < 0) continue;
      out.push({ name: (x.s ? x.s.name : x.name) || null, a, b, startM: t.dist[ia], endM: t.dist[ib] });
      from = ib;
    }
    return out;
  }
  /** The stage you're on or the next one ahead of `atM`, or null: { span, on, toM } (toM: to its start, or to its end when on it). */
  function stageAhead(spans, atM) {
    const s = (spans || []).find((x) => x.endM > atM);
    if (!s) return null;
    return s.startM <= atM ? { span: s, on: true, toM: s.endM - atM } : { span: s, on: false, toM: s.startM - atM };
  }
  /** What the car changed, for the route card: '' when nothing did. */
  function carNote(car, avoid = AVOID_DEFAULT) {
    if (!car) return '';
    const bits = [];
    if (car.clearance === 'low' && !avoid.unpaved) bits.push('no unpaved roads');
    if (Number.isInteger(car.width_cm)) bits.push('roads wide enough');
    return bits.length ? `Planned for your ${car.label || 'car'}: ${bits.join(', ')}.` : '';
  }
  /** Which avoided things a route still uses, from the router's summary flags (route.has = { highways, tolls, ferries }); unknown flags say nothing. */
  function unavoided(avoid, route) {
    const has = (route && route.has) || {};
    const out = ['highways', 'tolls', 'ferries'].filter(k => avoid && avoid[k] && has[k] === true);
    if (avoid && avoid.police && policeOn(avoid, route)) out.push('police');
    return out;
  }
  // Avoid police reports: avoid.points are the live reports near this trip (hazard_reports.js policeFor), worked out once
  // per plan; whether a route passes one is kept on the route for that set (route.has.police), so the card can say it later
  const policeSeen = new WeakMap();
  function policeOn(avoid, route) {
    if (!route) return false;
    const pts = Array.isArray(avoid.points) ? avoid.points : null, H = root.ApexHazardReports || (typeof require === 'function' && typeof module !== 'undefined' ? require('./hazard_reports.js') : null);
    if (pts && H && Array.isArray(route.coords)) {
      if (policeSeen.get(route) !== pts) { route.has = { ...(route.has || {}), police: H.passesNear(route.coords, pts) }; policeSeen.set(route, pts); }
    }
    return !!(route.has && route.has.police === true);
  }
  /** Candidates that keep to the avoid options, when any do; otherwise all of them (the card then says what couldn't be avoided). */
  function keepAvoiding(cands, avoid) {
    const clean = cands.filter(c => !unavoided(avoid, c.route).length);
    return clean.length ? clean : cands;
  }

  // ---- towns (R-15) -------------------------------------------------------------------------
  // The router can't avoid towns, so candidates are ranked on how much of them is in one: within a radius of a city
  // (4 km), town (1.5 km) or village (0.6 km) point from the map tiles. A rough circle, not the town's real edge. The
  // places you start or end in don't count: every route has those.
  const TOWN_KM = { city: 4, town: 1.5, village: 0.6 };
  /** km of a route ({lat, lon, dist}) near a town, in 100 m steps; null when the places are unknown. */
  function townKm(t, places) {
    if (!Array.isArray(places) || !t || !t.lat || !t.lat.length) return null;
    const n = t.lat.length, start = { lat: t.lat[0], lon: t.lon[0] }, end = { lat: t.lat[n - 1], lon: t.lon[n - 1] };
    let w = 180, e = -180, so = 90, no = -90;
    for (let i = 0; i < n; i += 20) { w = Math.min(w, t.lon[i]); e = Math.max(e, t.lon[i]); so = Math.min(so, t.lat[i]); no = Math.max(no, t.lat[i]); }
    const pad = 0.05;   // ~4–5 km
    const near = places.filter(p => TOWN_KM[p.cls] && p.lon >= w - pad && p.lon <= e + pad && p.lat >= so - pad && p.lat <= no + pad
      && kmBetween(p, start) > TOWN_KM[p.cls] && kmBetween(p, end) > TOWN_KM[p.cls]);
    if (!near.length) return 0;
    let km = 0, next = 0;
    for (let i = 0; i < n; i++) {
      if (t.dist[i] < next) continue;
      next = t.dist[i] + 100;
      const q = { lat: t.lat[i], lon: t.lon[i] };
      if (near.some(p => kmBetween(p, q) <= TOWN_KM[p.cls])) km += 0.1;
    }
    return Math.round(km * 10) / 10;
  }
  /** Ranking cost of the town km on a candidate when towns are avoided: 3 points a km, at most 60 (a city crossing is ~24). */
  const townCost = (c) => (Number.isFinite(c.townKm) ? Math.min(60, 3 * c.townKm) : 0);

  // ---- sun glare (R-13) ----------------------------------------------------------------
  // Driving into a sun low ahead (0–15° up, within 20° of the heading) blinds you on exactly the roads this app picks.
  // Minutes of it on a route, from its geometry ({lat, lon, dist}) driven evenly over timeS from `start`.
  const GLARE_MAX_ALT = 15 * Math.PI / 180, GLARE_HALF_ANGLE = 20 * Math.PI / 180;
  function glare(t, timeS, start, sun = root.ApexSun) {
    if (!t || !t.dist || t.dist.length < 2 || !(timeS > 0) || !sun || !(start instanceof Date)) return null;
    const total = t.dist[t.dist.length - 1], step = 20;      // 20 samples: 100 m on 5 m geometry
    if (!(total > 0)) return null;
    let seconds = 0;
    for (let i = 0; i + step < t.lat.length; i += step) {
      const j = i + step, kx = Math.cos(t.lat[i] * Math.PI / 180);
      const heading = Math.atan2((t.lon[j] - t.lon[i]) * kx, t.lat[j] - t.lat[i]);
      const at = new Date(start.getTime() + t.dist[i] / total * timeS * 1000);
      const p = sun.sunPosition(at, t.lat[i], t.lon[i]);
      if (p.altitude <= 0 || p.altitude > GLARE_MAX_ALT) continue;
      const off = Math.abs(Math.atan2(Math.sin(heading - p.azimuth), Math.cos(heading - p.azimuth)));
      if (off < GLARE_HALF_ANGLE) seconds += (t.dist[j] - t.dist[i]) / total * timeS;
    }
    return { minutes: seconds / 60 };
  }
  const GLARE_COST_PER_MIN = 1, GLARE_COST_MAX = 20;          // fun points; a 10-minute squint costs a 10-point lead
  const glareCost = (c) => Math.min(GLARE_COST_MAX, GLARE_COST_PER_MIN * ((c.glare && c.glare.minutes) || 0));

  /**
   * What the route card shows of a route (route_card.js tiles): its minutes, rounded as the card rounds them, and its
   * corners, every corner on its line (`c.t.events`, else `c.events`, else `c.corners`). null where unknown.
   */
  function shown(c) {
    const ev = c && c.t && Array.isArray(c.t.events) ? c.t.events : c && Array.isArray(c.events) ? c.events : null;
    return { minutes: c && Number.isFinite(c.timeS) ? Math.round(c.timeS / 60) : null,
      corners: ev ? ev.filter(isCorner).length : c && Number.isFinite(c.corners) ? c.corners : null };
  }
  /**
   * Does route `a` look strictly better than `b` on the numbers the card shows: no slower, at least as many corners, and
   * better on one of them? Then nobody would pick `b` over it without a reason (shared by destination options and loops).
   */
  function dominates(a, b) {
    const x = shown(a), y = shown(b);
    if (x.minutes == null || y.minutes == null || x.corners == null || y.corners == null) return false;
    return x.minutes <= y.minutes && x.corners >= y.corners && (x.minutes < y.minutes || x.corners > y.corners);
  }

  /**
   * Route options to show side by side (R-30): the ranked list's best and the next ones that are really different
   * (not within 30 s and 1 fun point of one already picked: a stage plan the router drew the same way). At most `k`.
   */
  function distinctOptions(ranked, k = 3) {
    const out = [];
    // the route engine's fun (corners gated by road quality) when it ranked them: a subdivision's corners aren't fun
    const funOf = (c) => (c.ev && c.ev.funGated ? c.ev.funGated : c.fun);
    for (const c of ranked || []) {
      const f = funOf(c) ? funOf(c).fun : null;
      if (out.some(o => Math.abs(o.timeS - c.timeS) < 30 && Math.abs((funOf(o) ? funOf(o).fun : null) - f) <= 1)) continue;
      // Never offer a route that is both slower and less fun than one already on the card: nobody would pick it.
      if (out.some(o => funOf(o) && f != null && funOf(o).fun >= f && o.timeS <= c.timeS)) continue;
      out.push(c);
      if (out.length === k) break;
    }
    return out;
  }

  // ---- developer overrides (dev mode, the owner 2026-11-09; web/dev_panel.js) -------------------------------------------
  // A tune is { router: { 'A_MAX.fun': 60, … }, engine: { POOR_PER_KM: 8, … }, levels: { 'fun.budget': 0.5, … }, hwy: { … } },
  // each a flat map of dotted paths to numbers. tuneOnto sets only knobs that exist and are numbers already (an own
  // property at every step of the path), so a tune can't add keys, change a type or reach a prototype, and returns what it
  // changed for untune to put back. With no tune nothing is touched: the default behaviour is the code as written.
  const ownKey = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  function tuneOnto(target, flat, undo = []) {
    if (!target || !flat || typeof flat !== 'object') return undo;
    for (const [path, val] of Object.entries(flat)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      const ks = String(path).split('.');
      let o = target;
      for (let i = 0; i < ks.length - 1 && o; i++) o = ownKey(o, ks[i]) && typeof o[ks[i]] === 'object' ? o[ks[i]] : null;
      const k = ks[ks.length - 1];
      if (!o || !ownKey(o, k) || typeof o[k] !== 'number') continue;
      undo.push([o, k, o[k]]);
      o[k] = val;
    }
    return undo;
  }
  function untune(undo) { for (let i = (undo || []).length - 1; i >= 0; i--) { const [o, k, v] = undo[i]; o[k] = v; } }
  /** Every number in an object as { 'dotted.path': value } (the knobs a tune can set, with their values now). */
  function tuneKnobs(obj, pre = '', out = {}) {
    for (const k of Object.keys(obj || {})) {
      const v = obj[k], p = pre ? `${pre}.${k}` : k;
      if (typeof v === 'number' && Number.isFinite(v)) out[p] = v;
      else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) tuneKnobs(v, p, out);
    }
    return out;
  }
  /** Whether a tune changes anything at all (an empty or absent one is no tune). */
  const tuned = (t) => !!(t && typeof t === 'object' && Object.values(t).some((m) => m && typeof m === 'object' && Object.keys(m).length));

  const api = { tuneOnto, untune, tuned, tuneKnobs, LEVELS, HWY, highwayKm, levelHighways, applyHighways, BUILT, builtKeep, builtAgree, shown, dominates, cornerWeight, townKm, townCost, STREET, streetSample, streetShare, exploreShortlist, exploreTargets, explorePicks, distinctOptions, glare, glareCost, LOOP_BY_TIME, LOOP_LEVEL, loopLevelAdjust, LOOP_HWY, loopHighwayCost, loopDominates, loopRank, loopWay, loopOffer, LOOP_OFFER, AVOID_DEFAULT, AVOID_LABELS, STAGE_KEPT, stageCoverage, keptStages, CAMERA_BOX_DEG, camerasToExclude, costing, unavoided, keepAvoiding, why, geometry, alongPoints, insertVia, loopValue, loopShortlist, loopPlansFromMatrix, score, shortlist, matrixPoints, plansFromMatrix, sectionCount, sectionPoints, combineSections, planKey, searchArea, waypoints, rank, along, kmBetween, directionBonus, setList, SET_FINISH, SET_FATIGUE, MAX_TECH_PER_KM, carNote, stageSpans, stageAhead };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFunRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
