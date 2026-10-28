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
  const LEVELS = {
    quick: { budget: 0.10, slackS: 60, perMin: 3.0, label: 'Quick' },        // a detour must add ~6 good corners a minute
    fun: { budget: 0.35, slackS: 240, perMin: 1.0, label: 'Fun' },           // ~2 a minute
    max: { budget: 0.90, slackS: 600, perMin: 0.35, label: 'Max fun' },      // ~0.7 a minute
  };

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
  function cornerWeight(sev) {
    if (sev === 'HP') return 0.6;
    if (sev >= 2 && sev <= 5) return 1.0;
    if (sev === 6) return 0.6;
    if (sev === 1) return 0.5;
    return 0;
  }

  /**
   * Fun score of a routed track ({dist[], events[]}, as trackFromPolyline builds it).
   * turnsM: distances along the route of the router's turn maneuvers (left/right/sharp/U),
   * used to drop junction turns. Returns null when the line is too short to judge.
   */
  function score(track, turnsM = []) {
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
      .map(c => ({ at: c.dist_m, start: Number.isFinite(c.start_m) ? c.start_m : c.dist_m, end: Number.isFinite(c.end_m) ? c.end_m : c.dist_m, w: cornerWeight(c.severity), sev: c.severity }))
      .filter(c => c.w > 0)
      .sort((a, b) => a.start - b.start);
    const km = totalM / 1000;
    const weighted = corners.reduce((s, c) => s + c.w, 0);
    const good = corners.filter(c => c.sev !== 'HP' && c.sev >= 2 && c.sev <= 5).length;
    // Flow: runs of 3+ corners each within FLOW_GAP_M of the last; their length over the route.
    let flowM = 0;
    for (let i = 0; i < corners.length;) {
      let j = i;
      while (j + 1 < corners.length && corners[j + 1].start - corners[j].end <= FLOW_GAP_M) j++;
      if (j - i + 1 >= 3) flowM += corners[j].end - corners[i].start;
      i = j + 1;
    }
    // Dull: straights (gaps between corners, and before the first / after the last) longer than DULL_STRAIGHT_M.
    let dullM = 0, prev = 0;
    for (const c of corners) { const gap = c.start - prev; if (gap > DULL_STRAIGHT_M) dullM += gap; prev = Math.max(prev, c.end); }
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
  /** How many sections: 1 up to SINGLE_KM crow fly, then one per SECTION_KM, at most `max`. */
  function sectionCount(from, to, max = 3) {
    const d = kmBetween(from, to);
    return d <= SINGLE_KM ? 1 : Math.max(1, Math.min(max, Math.ceil(d / SECTION_KM)));
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
   * Chain per-section plans (each section's list best first, possibly empty) into whole-trip plans: the best of every
   * section, then variants that swap one section for its next best. Stages in travel order; at most `maxStages` in all
   * (the router's 10 locations), dropping the weakest sections' picks first.
   */
  function combineSections(sections, count = 2, maxStages = 4) {
    const chain = (choice) => {
      let picks = sections.map((plans, k) => plans[choice[k]]).map((p, k) => ({ p, k })).filter(x => x.p);
      while (picks.reduce((n, x) => n + x.p.legs.length, 0) > maxStages && picks.length) {
        picks = picks.filter(x => x !== picks.reduce((a, b) => (b.p.value < a.p.value ? b : a)));
      }
      picks.sort((a, b) => a.k - b.k);
      if (!picks.length) return null;
      return { legs: picks.flatMap(x => x.p.legs), value: picks.reduce((v, x) => v + x.p.value, 0), timeS: picks.reduce((t, x) => t + x.p.timeS, 0) };
    };
    const out = [], seen = new Set();
    const add = (choice) => {
      const p = chain(choice);
      if (!p) return;
      const key = p.legs.map(l => `${l.s.lat[0]},${l.s.lon[0]}`).join('|');
      if (seen.has(key)) return;
      seen.add(key); out.push(p);
    };
    add(sections.map(() => 0));
    for (let k = 0; k < sections.length && out.length < count; k++) if (sections[k].length > 1) add(sections.map((_, j) => (j === k ? 1 : 0)));
    return out.slice(0, count);
  }

  /**
   * The stages worth asking the router about: inside the budget's ellipse around A→B (crow fly,
   * so only a sanity cut), not duplicates of each other, best scores first. At most `k`, so the
   * connector matrix stays within the public server's 100 pairs: (1 + 2k) x (2k + 1).
   */
  function shortlist(from, to, stages, budget, k = 4) {
    const maxKm = kmBetween(from, to) * (1 + budget) + 3;
    const out = [];
    for (const s of stages || []) {
      const m = midOf(s), u = along(from, to, m);
      if (u < -0.15 || u > 1.15 || kmBetween(from, m) + kmBetween(m, to) > maxKm) continue;
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
        time += c + stageS(leg.s); value += leg.s.score; stageKm += leg.s.km;
        row = src(leg.exit);
      }
      const last = T(row, B);
      if (last == null) return;
      time += last;
      if (time > limit) return;
      out.push({ legs: legs.map(({ s, fwd }) => ({ s, fwd })), timeS: time, stageKm, value: value - L.perMin * Math.max(0, time - quickestS) / 60 });
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
   * Stages worth timing for a loop of targetKm from start: the best-scoring ones close enough to
   * reach and come back from (crow fly out and back within the target), no duplicates. At most `k`;
   * the matrix is (1 + 2k) x (2k + 1), split into calls of 100 pairs.
   */
  function loopShortlist(start, stages, targetKm, k = 6) {
    const out = [];
    for (const s of stages || []) {
      if (2 * kmBetween(start, midOf(s)) + s.km > targetKm * 1.1) continue;
      if (out.some(t => overlap(s, t))) continue;
      out.push(s);
      if (out.length === k) break;
    }
    return out;
  }
  /**
   * Loops of 1–3 shortlisted stages in any order and direction, measured with real road distances
   * (matrix km; null = no road): start→entry + stage + exit→next entry ... + exit→start. Crow-fly
   * guesses ran 40–75 % long in hills. Kept within 25 % of the target; value = stage score x
   * (1 − length error) − 0.08 per connector km (the old plans() formula). Best `count`, distinct lead stage.
   */
  function loopPlansFromMatrix(list, distKm, targetKm, count = 3) {
    const n = list.length, home = 2 * n;
    const D = (row, col) => { const v = distKm[row] && distKm[row][col]; return Number.isFinite(v) ? v : null; };
    const out = [];
    const walk = (legs, used, row, connector, stageKm, score) => {
      if (legs.length) {
        const back = D(row, home);
        if (back != null) {
          const total = stageKm + connector + back, err = Math.abs(total - targetKm) / targetKm;
          if (err <= 0.25) out.push({ legs: legs.slice(), total, stageKm, value: score * (1 - err) - (connector + back) * 0.08, share: stageKm / total });
        }
      }
      if (legs.length === 3) return;
      for (let i = 0; i < n; i++) {
        if (used & (1 << i)) continue;
        for (const fwd of [true, false]) {
          const entry = 2 * i + (fwd ? 0 : 1), exit = 2 * i + (fwd ? 1 : 0), c = D(row, entry);
          if (c == null || stageKm + connector + c > targetKm * 1.25) continue;
          legs.push({ s: list[i], fwd });
          walk(legs, used | (1 << i), 1 + exit, connector + c, stageKm + list[i].km, score + list[i].score);
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
   * - perMin x extra minutes (+ `adjust`, e.g. measured roughness). Fun is a density, so a longer
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
    return cands.map(c => {
      const extraS = Number.isFinite(c.timeS) ? Math.max(0, c.timeS - quick.timeS) : Infinity;
      const fun = c.fun ? c.fun.fun : 0, gain = c.fun ? Math.min(GAIN_CAP, Math.max(0, c.fun.good - quickGood)) : 0;
      return { ...c, extraS, value: fun + GAIN_PER_CORNER * gain - L.perMin * extraS / 60 + (c.adjust || 0) };
    }).filter(c => c.extraS === 0 || c.timeS <= limit).sort((a, b) => b.value - a.value);
  }

  const api = { LEVELS, geometry, alongPoints, insertVia, loopShortlist, loopPlansFromMatrix, score, shortlist, matrixPoints, plansFromMatrix, sectionCount, sectionPoints, combineSections, searchArea, waypoints, rank, along, kmBetween };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFunRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
