// Your driving (the driver profile): what every clean corner of every drive on this phone says, taken together, about
// how you drive. Port of core/driver_profile.py (observe, profile; held to parity by tests/test_driver_profile.py), the
// words for it, and the Log's page. Six skills in the order a corner is driven, each 0-100 and unknown under 30 corners;
// where you are measurably better or worse (lefts and rights, tight and fast, downhill, the first ten minutes, one car, a
// tag), kept only when it is large, far beyond chance and repeats drive after drive; each skill month by month.
// Touch: how fast the brakes go on and come off and the car is loaded at turn-in, in g a second, from the ten g readings
// a second kept since #377 (older drives, kept once a second, give none).
// Technique only: no speed, time or legality enters a level, and nothing here is sent anywhere.
(function (root) {
  'use strict';
  const SKILLS = ['squeeze', 'brake', 'arc', 'entry', 'line', 'exit'];
  const PACE = 'pace', MEASURES = [...SKILLS, PACE];                  // pace (IDEAS D-29): read like a skill, never a Work on
  const SWING_G = 0.10, ARC_SPAN_G = 0.6, SQUEEZE_SPAN_G = 0.5, SQUEEZE_MIN_G = 0.20, SQUEEZE_PAD = 2, SQUEEZE_GAP = 6, ENTRY_SWING_MPS = 0.6, SLOW_PAD = 10, ENTRY_SPAN_MPS = 3.0,
    FOCUS_MAX = 85, EXIT_FREE_M = 10, EXIT_SPAN_M = 40, LINE_FREE_M = 5, LINE_SPAN_M = 25, TRAIL_MIN_M = 10, GRADE_PAD = 10, GRADE_MIN = 0.04,
    WARM_MIN = 10, LONG_MIN = 60, SKILL_MIN = 30, STYLE_MIN = 20, MATRIX_MIN = 10, SPLIT_MIN = 12, SPLIT_FLOOR = 0.08, SPLIT_SE = 3,
    SPLIT_DRIVE_MIN = 3, SPLIT_DRIVES = 2, GROUP_DRIVES = 4, GROUP_DRIVE_MIN = 5, TREND_MIN = 15, TREND_FLOOR = 0.05, TREND_SE = 2, TOP_FINDINGS = 8, DRIVE_TOUCH_MIN = 8,
    TOUCH_MIN_G = 0.25, TOUCH_LO = 0.2, TOUCH_HI = 0.8, TOUCH_MIN_BINS = 1.5, FINE_EPS = 3e-4, FINE_FLAT = 0.3;
  const TOUCH = ['brake_on', 'brake_off', 'turn_in'];
  const CoreOf = () => root.ApexCore || (typeof require === 'function' ? require('./apex_core.js') : null);
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const r = (x, k) => Math.round(x * 10 ** k) / 10 ** k;
  const level = (m) => Math.floor(100 * m + 0.5);
  const median = (xs) => { const s = xs.slice().sort((p, q) => p - q), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const sizeOf = (sev) => (!finite(sev) ? null : sev <= 2 ? 'tight' : sev <= 4 ? 'medium' : 'fast');

  /** Total movement of x between its turning points, a turn counting only once x has come back by h or more. */
  function swing(x, h = SWING_G) {
    let tv = 0, ref = x[0], ext = x[0], way = 0;
    for (let i = 1; i < x.length; i++) {
      const val = x[i];
      if (way === 0) { if (Math.abs(val - ref) >= h) { way = val > ref ? 1 : -1; ext = val; } }
      else if (way === 1) { if (val > ext) ext = val; else if (ext - val >= h) { tv += ext - ref; ref = ext; way = -1; ext = val; } }
      else if (val < ext) ext = val;
      else if (val - ext >= h) { tv += ref - ext; ref = ext; way = 1; ext = val; }
    }
    return way !== 0 ? tv + Math.abs(ext - ref) : tv;
  }
  /** Movement beyond the one rise to the peak and one fall from it that x needs. */
  function excess(x, h = SWING_G) {
    let top = -Infinity;
    for (const v of x) if (v > top) top = v;
    return Math.max(0, swing(x, h) - ((top - x[0]) + (top - x[x.length - 1])));
  }
  function brakeRun(Core, lon, start, apex) {
    const lo = Math.max(0, apex - Core.BRAKE_LOOKBACK);
    let r1 = apex;
    while (r1 >= lo && !(lon[r1] < Core.BRAKE_G)) r1--;
    if (r1 < lo || r1 < start - Core.BRAKE_GAP) return null;
    let r0 = r1;
    while (r0 - 1 >= lo && lon[r0 - 1] < Core.BRAKE_G) r0--;
    return [r0, r1];
  }
  /** True when x moves like ten g readings a second, not one a second spread over the bins (a staircase or a ramp). */
  function fine(x) {
    if (x.length < 4) return false;
    let flat = 0;
    for (let i = 1; i < x.length - 1; i++) if (Math.abs(x[i] - x[i - 1]) <= FINE_EPS || Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]) <= FINE_EPS) flat++;
    return flat < FINE_FLAT * (x.length - 2);
  }
  const cross = (y, t, j, k, lv) => { const f = clamp01(y[k] !== y[j] ? (lv - y[j]) / (y[k] - y[j]) : 0); return [t[j] + f * (t[k] - t[j]), j + f * (k - j)]; };
  const QUICK = 'quick';
  /** g a second at which y rose to its peak at pk (way -1) or fell from it (way +1), 20 % to 80 % of the peak; QUICK when
   *  that took under TOUCH_MIN_BINS bins (too quick for 5 m bins to time); null when it does not get there. */
  function touchRate(y, t, pk, way) {
    const p = y[pk], at = {};
    let j = pk;
    for (const lv of [TOUCH_HI, TOUCH_LO]) {
      while (j + way >= 0 && j + way < y.length && y[j + way] >= lv * p) j += way;
      if (!(j + way >= 0 && j + way < y.length)) return null;
      at[lv] = cross(y, t, j + way, j, lv * p);
    }
    if (Math.abs(at[TOUCH_HI][1] - at[TOUCH_LO][1]) < TOUCH_MIN_BINS) return QUICK;
    const dt = (at[TOUCH_HI][0] - at[TOUCH_LO][0]) * -way;
    return dt <= 0 ? null : (TOUCH_HI - TOUCH_LO) * p / dt;
  }
  const argmax = (lo, hi, f) => { let best = lo; for (let i = lo + 1; i <= hi; i++) if (f(i) > f(best)) best = i; return best; };
  // every bin w0..w1 with its g measured and the car moving at a known speed (a blanked g or a bin taking no time makes a false rate)
  function measured(Core, v, known, w0, w1) {
    for (let q = w0; q <= w1; q++) if ((known && !known[q]) || !(Number.isFinite(v[q]) && v[q] >= Core.STOPPED_MPS)) return false;
    return true;
  }
  function cornerTouch(Core, lon, lat, t, s, e, run, first, v, known) {
    const n = lat.length;
    let on = null, off = null, turn = null;
    if (run) {
      const w0 = Math.max(0, first - SQUEEZE_GAP), w1 = Math.min(n - 1, run[1] + SQUEEZE_GAP), dec = [];
      for (let q = w0; q <= w1; q++) dec.push(-lon[q]);
      if (dec.every(Number.isFinite) && measured(Core, v, known, w0, w1) && fine(dec)) {
        const pk = argmax(first - w0, run[1] - w0, (i) => dec[i]);
        if (dec[pk] >= TOUCH_MIN_G) { const tt = Array.from(t.slice(w0, w1 + 1)); on = touchRate(dec, tt, pk, -1); off = touchRate(dec, tt, pk, 1); }
      }
    }
    const w0 = Math.max(0, s - Core.TURN_LEAD), side = [];
    for (let q = w0; q <= e; q++) side.push(lat[q]);
    if (side.every(Number.isFinite) && measured(Core, v, known, w0, e) && fine(side)) {
      const pk = argmax(s - w0, e - w0, (i) => Math.abs(side[i])), way = side[pk] > 0 ? 1 : -1, y = side.map((x) => way * x);
      if (y[pk] >= TOUCH_MIN_G) turn = touchRate(y, Array.from(t.slice(w0, e + 1)), pk, -1);
    }
    return [on, off, turn];
  }

  /**
   * One observation per corner the coach may read. drive: { speed_mps, lon_g, lat_g, g_known?, elev?, corners: [{ start, end,
   * apex, apex_mps, dir?, severity?, mods? }] }. A credit that cannot be told for a corner is null there.
   */
  function observe(drive, Core = CoreOf()) {
    const v = drive.speed_mps.map((x) => (x == null ? NaN : x)), lon = drive.lon_g, lat = drive.lat_g, n = v.length;
    const t = new Float64Array(n);
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + (Number.isFinite(v[i - 1]) && v[i - 1] >= Core.STOPPED_MPS ? 5 / v[i - 1] : 0);
    const elev = drive.elev || null, d = { ...drive, speed_mps: v }, out = [];
    for (const c of drive.corners) {
      const s = c.start, e = c.end, a = c.apex;
      if (!Core.knownRun(d, s, e, a)) continue;
      const tech = Core.cornerTechnique(v, lon, lat, c);
      if (!tech) continue;
      const ph = Core.cornerPhases(v, lon, lat, s, e, a, c.apex_mps), w0 = Math.max(0, s - SLOW_PAD), w1 = Math.min(n - 1, e + SLOW_PAD);
      let slow = null, vKnown = true;                                   // the slowest point may come before the corner starts
      for (let q = w0; q <= w1; q++) if (!Number.isFinite(v[q])) vKnown = false;
      if (vKnown) slow = Core.passMarks(d, w0, w1, a)[1];
      // the load the steering asks for, with the speed taken out: slowing to the middle and driving out is one arc
      const vbar = Core.meanSe(v.slice(s, e + 1))[0], side = [];
      for (let q = s; q <= e; q++) side.push(lat[q] * (vbar / Math.max(v[q], Core.STOPPED_MPS)) ** 2);
      let peak = side[0];
      for (const x of side) if (Math.abs(x) > Math.abs(peak)) peak = x;
      const arc = 1 - clamp01(excess(side.map((x) => (peak >= 0 ? x : -x))) / ARC_SPAN_G);
      let squeeze = null, first = null;
      const run = brakeRun(Core, lon, s, a);
      if (run) {
        const lo = Math.max(0, a - Core.BRAKE_LOOKBACK);
        first = run[0];
        for (let more = true; more;) {                                 // an earlier stab at the brakes on the same approach
          more = false;
          for (let q = first - 1; q >= Math.max(lo, first - SQUEEZE_GAP); q--) if (lon[q] < Core.BRAKE_G) { first = q; more = true; break; }
        }
        const b0 = Math.max(0, first - SQUEEZE_PAD), b1 = Math.min(n - 1, run[1] + SQUEEZE_PAD);
        let known = true;
        for (let q = b0; q <= b1; q++) if (!Number.isFinite(lon[q])) known = false;
        if (known) {
          const dec = lon.slice(b0, b1 + 1).map((x) => -x);
          if (Math.max(...dec) >= SQUEEZE_MIN_G) squeeze = 1 - clamp01(excess(dec) / SQUEEZE_SPAN_G);
        }
      }
      const [brakeOn, brakeOff, turnIn] = cornerTouch(Core, lon, lat, t, s, e, run, first, v, drive.g_known || null);
      let grade = null;
      if (elev) {
        const g0 = Math.max(0, s - GRADE_PAD), g1 = Math.min(n - 1, e + GRADE_PAD), h0 = elev[g0], h1 = elev[g1];
        if (g1 > g0 && finite(h0) && finite(h1)) { const slope = (h1 - h0) / ((g1 - g0) * 5); grade = slope >= GRADE_MIN ? 'up' : slope <= -GRADE_MIN ? 'down' : 'flat'; }
      }
      const mods = Array.isArray(c.mods) ? c.mods : null;
      out.push({
        apex: a, dir: c.dir === 'L' || c.dir === 'R' ? c.dir : null, size: sizeOf(c.severity),
        tightens: mods ? mods.includes('tightens') : null, crest: mods ? mods.includes('over crest') : null, grade, minute: t[a] / 60,
        use: tech.use, squeeze, brake: run ? tech.brake : null, arc,
        entry: 1 - clamp01(excess(v.slice(s, e + 1).map((x) => -x), ENTRY_SWING_MPS) / ENTRY_SPAN_MPS),
        line: slow === null ? null : 1 - clamp01(((a - slow) * 5 - LINE_FREE_M) / LINE_SPAN_M),
        exit: slow === null ? null : 1 - clamp01((ph.coast_m - EXIT_FREE_M) / EXIT_SPAN_M),
        trail: ph.brake_m === null ? null : (ph.trail_m >= TRAIL_MIN_M ? 1 : 0),
        slow_m: slow === null ? null : (slow - a) * 5,
        brake_on: brakeOn, brake_off: brakeOff, turn_in: turnIn, pace: Core.paceCredit(tech.use),
      });
    }
    return out;
  }

  const vals = (obs, k) => { const out = []; for (const o of obs) if (o[k] !== null && o[k] !== undefined) out.push(o[k]); return out; };
  function welch(Core, xa, xb) {
    const [ma, sa] = Core.meanSe(xa), [mb, sb] = Core.meanSe(xb), diff = ma - mb, se = Math.sqrt(sa * sa + sb * sb);
    if (Math.abs(diff) < SPLIT_FLOOR || Math.abs(diff) < SPLIT_SE * se) return null;
    return [ma, mb, se > 0 ? diff / se : null];
  }
  function within(Core, drives, skill, val, inA, inB) {
    const xa = [], xb = [], votes = [];
    for (const d of drives) {
      const a = [], b = [];
      for (const o of d.obs) { if (o[skill] === null) continue; if (inA(o)) a.push(val(o)); if (inB(o)) b.push(val(o)); }
      xa.push(...a); xb.push(...b);
      if (a.length >= SPLIT_DRIVE_MIN && b.length >= SPLIT_DRIVE_MIN) votes.push(Core.meanSe(a)[0] - Core.meanSe(b)[0]);
    }
    if (xa.length < SPLIT_MIN || xb.length < SPLIT_MIN || votes.length < SPLIT_DRIVES) return null;
    const w = welch(Core, xa, xb);
    if (!w) return null;
    const agree = votes.filter((x) => x !== 0 && (x > 0) === (w[0] > w[1])).length;
    if (agree * 3 < votes.length * 2) return null;
    return { mean_a: w[0], mean_b: w[1], n_a: xa.length, n_b: xb.length, drives: votes.length, agree, z: w[2] };
  }
  function between(Core, drives, skill, val, isA) {
    const ma = [], mb = [];
    let na = 0, nb = 0;
    for (const d of drives) {
      const xs = [];
      for (const o of d.obs) if (o[skill] !== null) xs.push(val(o));
      if (xs.length < GROUP_DRIVE_MIN) continue;
      const m = Core.meanSe(xs)[0];
      if (isA(d)) { ma.push(m); na += xs.length; } else { mb.push(m); nb += xs.length; }
    }
    if (ma.length < GROUP_DRIVES || mb.length < GROUP_DRIVES) return null;
    const w = welch(Core, ma, mb);
    if (!w) return null;
    return { mean_a: w[0], mean_b: w[1], n_a: na, n_b: nb, drives: ma.length + mb.length, agree: null, z: w[2] };
  }
  const WITHIN = [
    ['dir', 'L', 'R', (o) => o.dir === 'L', (o) => o.dir === 'R'],
    ['size', 'tight', 'rest', (o) => o.size === 'tight', (o) => o.size === 'medium' || o.size === 'fast'],
    ['size', 'fast', 'rest', (o) => o.size === 'fast', (o) => o.size === 'tight' || o.size === 'medium'],
    ['shape', 'tightens', 'rest', (o) => o.tightens === true, (o) => o.tightens === false],
    ['crest', 'crest', 'rest', (o) => o.crest === true, (o) => o.crest === false],
    ['grade', 'down', 'up', (o) => o.grade === 'down', (o) => o.grade === 'up'],
    ['time', 'start', 'later', (o) => o.minute < WARM_MIN, (o) => o.minute >= WARM_MIN],
    ['time', 'long', 'before', (o) => o.minute >= LONG_MIN, (o) => o.minute < LONG_MIN],
  ];
  // the f quantile of n values of which sorted xs are the lowest (the rest quick); null when it reaches into the quick ones
  function rank(xs, n, f) {
    const pos = f * (n - 1), i = Math.floor(pos), hi = Math.min(i + 1, n - 1);
    if ((hi >= xs.length && pos > i) || i >= xs.length) return null;
    return r(hi < xs.length ? xs[i] + (xs[hi] - xs[i]) * (pos - i) : xs[i], 3);
  }
  /** The touch over corners obs: per measure { rate, lo, hi, n, quick, quick_rate } in g a second (null under STYLE_MIN
   *  corners; a quick corner ranks above every rate), and release (brakes off over on, corners with both timed). */
  function touch(obs, least = STYLE_MIN) {
    const out = {};
    for (const k of TOUCH) {
      const xs = obs.map((o) => o[k]).filter(finite).sort((p, q) => p - q), q = obs.filter((o) => o[k] === QUICK).length, n = xs.length + q, ok = n >= least;
      const at = (f) => (ok ? rank(xs, n, f) : null);
      out[k] = { rate: at(0.5), lo: at(0.25), hi: at(0.75), n, quick: q, quick_rate: ok && at(0.5) === null };
    }
    const both = obs.filter((o) => finite(o.brake_on) && finite(o.brake_off)).map((o) => o.brake_off / o.brake_on);
    out.release = both.length >= least ? r(median(both), 3) : null;
    out.release_n = both.length;
    return out;
  }
  const BEST_N = 3, SIZE_RANK = { tight: 2, medium: 1, fast: 0 };
  const sizeRank = (z) => (z in SIZE_RANK ? SIZE_RANK[z] : -1);
  /** The year's cleanest corners (Your year): [{ id, at, name, obs }] of that year, all six technique credits measured,
   *  by their mean (tighter first on a tie, then earlier); one a drive and one a road. Never pace, speed or a time. */
  function bestCorners(drives, year, n = BEST_N) {
    const picks = [];
    for (const d of drives || []) {
      const at = d && d.at;
      if (typeof at !== 'string' || !at.startsWith(`${year}-`)) continue;
      let best = null;
      for (const o of d.obs || []) {
        if (SKILLS.some((k) => o[k] === null || o[k] === undefined)) continue;
        const key = [level(SKILLS.reduce((a, k) => a + o[k], 0) / SKILLS.length), sizeRank(o.size), -o.apex];
        if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = { key, o };
      }
      if (best) picks.push({ id: d.id, at: at.slice(0, 16), name: d.name || null, apex: best.o.apex, dir: best.o.dir === undefined ? null : best.o.dir, size: best.o.size === undefined ? null : best.o.size, level: best.key[0] });
    }
    picks.sort((p, q) => q.level - p.level || sizeRank(q.size) - sizeRank(p.size) || cmp(p.at, q.at) || cmp(p.id, q.id));
    const out = [], roads = new Set();
    for (const b of picks) {
      if (b.name && roads.has(b.name)) continue;
      roads.add(b.name);
      out.push(b);
    }
    return out.slice(0, n);
  }
  /** A drive's own touch (its Log page): { drive (from DRIVE_TOUCH_MIN corners), usual (every other drive's corners) }. */
  // outside: "above" when the drive's middle corner was beyond the usual upper quartile (or quick where that is timed),
  // "below" under the lower one
  function driveTouch(obs, others) {
    const d = touch(obs || [], DRIVE_TOUCH_MIN), u = touch(others || []), outside = {};
    for (const k of TOUCH) outside[k] = outsideOf(d[k], u[k]);
    return { drive: d, usual: u, outside };
  }
  function outsideOf(d, u) {
    if ((u.rate === null && !u.quick_rate) || (d.rate === null && !d.quick_rate)) return null;
    if (u.hi !== null && (d.quick_rate || d.rate > u.hi)) return 'above';
    if (d.rate !== null && u.lo !== null && d.rate < u.lo) return 'below';
    return null;
  }
  const cmp = (p, q) => (p < q ? -1 : p > q ? 1 : 0);

  /** drives: [{ id, month ('YYYY-MM' or null), car (label or null), tags ([str] or null), obs (observe's) }]. */
  function profile(drivesIn, Core = CoreOf()) {
    const drives = (drivesIn || []).filter((d) => d && Array.isArray(d.obs) && d.obs.length);
    const every = [];
    for (const d of drives) every.push(...d.obs);
    const out = { corners: every.length, drives: drives.length, skills: {}, style: {}, touch: {}, matrix: [], findings: [], pace_findings: [], pace: {}, touch_by: {}, touch_trend: {}, trend: {}, change: {}, strongest: null, focus: null };
    const overall = {};
    for (const k of MEASURES) {
      const xs = vals(every, k);
      overall[k] = xs.length ? Core.meanSe(xs)[0] : null;
      if (xs.length >= SKILL_MIN) { const [m, se] = Core.meanSe(xs); out.skills[k] = { level: level(m), n: xs.length, se: r(100 * se, 2) }; }
      else out.skills[k] = { level: null, n: xs.length, se: null };
    }
    const trail = vals(every, 'trail'), slow = vals(every, 'slow_m'), use = every.map((o) => o.use);
    out.style = {
      trail_share: trail.length >= STYLE_MIN ? r(Core.meanSe(trail)[0], 4) : null, trail_n: trail.length,
      slow_m: slow.length >= STYLE_MIN ? r(Core.meanSe(slow)[0], 2) : null, slow_n: slow.length,
      use: use.length >= SKILL_MIN ? r(median(use), 4) : null,
    };
    out.touch = touch(every);
    // touch by size of corner and month by month: facts, never a level
    for (const z of ['tight', 'medium', 'fast']) out.touch_by[z] = touch(every.filter((o) => o.size === z), MATRIX_MIN);
    const bySize = {};
    for (const size of ['tight', 'medium', 'fast', null]) {
      const cell = every.filter((o) => o.size === size);
      for (const k of MEASURES) { const xs = vals(cell, k); bySize[k + '|' + size] = xs.length ? Core.meanSe(xs)[0] : 0; }
    }
    for (const way of ['L', 'R']) for (const size of ['tight', 'medium', 'fast']) {
      const cell = every.filter((o) => o.dir === way && o.size === size), levels = {};
      for (const k of MEASURES) { const xs = vals(cell, k); levels[k] = xs.length >= MATRIX_MIN ? level(Core.meanSe(xs)[0]) : null; }
      out.matrix.push({ dir: way, size, n: cell.length, levels });
    }
    const found = [];
    const add = (k, split, a, b, res, raw) => {
      if (!res) return;
      const base = raw ? 0 : overall[k];
      found.push({ skill: k, split, a, b, ...res, mean_a: level(clamp01(base + res.mean_a)), mean_b: level(clamp01(base + res.mean_b)) });
    };
    const withCar = drives.filter((d) => d.car), cars = [...new Set(withCar.map((d) => d.car))].sort(cmp);
    const tags = [...new Set(drives.flatMap((d) => d.tags || []))].sort(cmp);
    for (const k of MEASURES) {
      const left = (o) => o[k] - bySize[k + '|' + o.size], asIs = (o) => o[k];
      for (const [split, a, b, inA, inB] of WITHIN) { const raw = split === 'size'; add(k, split, a, b, within(Core, drives, k, raw ? asIs : left, inA, inB), raw); }
      if (cars.length >= 2) for (const car of cars) add(k, 'car', car, 'rest', between(Core, withCar, k, left, (d) => d.car === car), false);
      for (const tag of tags) add(k, 'tag', tag, 'rest', between(Core, drives, k, left, (d) => (d.tags || []).includes(tag)), false);
    }
    const mag = (f) => (f.z === null ? Infinity : Math.abs(f.z));
    found.sort((p, q) => mag(q) - mag(p) || cmp(p.split, q.split) || cmp(String(p.a), String(q.a)) || MEASURES.indexOf(p.skill) - MEASURES.indexOf(q.skill));
    // technique and pace are said apart: "the same shows in pace" would join a fault to a speed
    for (const [name, group] of [['findings', found.filter((f) => f.skill !== PACE)], ['pace_findings', found.filter((f) => f.skill === PACE)]]) {
      const seen = new Map(), kept = [];
      for (const f of group) {
        const key = f.split + '|' + f.a;
        if (seen.has(key)) { seen.get(key).also.push(f.skill); continue; }
        const g = { ...f, also: [], z: f.z === null ? null : r(f.z, 2) };
        seen.set(key, g);
        kept.push(g);
      }
      out[name] = kept.slice(0, TOP_FINDINGS);
    }
    const over = every.map((o) => (o.use > Core.PACE_CEILING ? 1 : 0));
    out.pace = { over: over.length >= SKILL_MIN ? r(Core.meanSe(over)[0], 4) : null, n: over.length };

    const months = [...new Set(drives.map((d) => d.month).filter(Boolean))].sort(cmp);
    for (const k of TOUCH) out.touch_trend[k] = [];
    for (const mth of months) {
      const t = touch(drives.filter((d) => d.month === mth).flatMap((d) => d.obs), TREND_MIN);
      for (const k of TOUCH) if (t[k].n >= TREND_MIN) out.touch_trend[k].push({ month: mth, rate: t[k].rate, quick: t[k].quick_rate, n: t[k].n });
    }
    for (const k of MEASURES) {
      const rows = [], raw = [];
      for (const mth of months) {
        const xs = [];
        for (const d of drives) if (d.month === mth) xs.push(...vals(d.obs, k));
        if (xs.length >= TREND_MIN) { const [m, se] = Core.meanSe(xs); rows.push({ month: mth, level: level(m), n: xs.length }); raw.push([m, se]); }
      }
      out.trend[k] = rows;
      if (rows.length >= 2) {
        const [m0, s0] = raw[0], [m1, s1] = raw[raw.length - 1], diff = m1 - m0, se = Math.sqrt(s0 * s0 + s1 * s1);
        out.change[k] = { from: rows[0].month, to: rows[rows.length - 1].month, delta: rows[rows.length - 1].level - rows[0].level,
          sure: Math.abs(diff) >= TREND_FLOOR && Math.abs(diff) >= TREND_SE * se };
      }
    }
    const known = SKILLS.filter((k) => out.skills[k].level !== null);
    if (known.length >= 2) {
      let best = known[0], worst = known[0];
      for (const k of known) { if (out.skills[k].level > out.skills[best].level) best = k; if (out.skills[k].level < out.skills[worst].level) worst = k; }
      if (out.skills[best].level > out.skills[worst].level) out.strongest = best;
      if (out.skills[worst].level <= FOCUS_MAX) {
        const f = out.findings.find((x) => x.skill === worst);
        out.focus = { skill: worst, where: f ? { split: f.split, a: f.a, b: f.b, worse: f.mean_a < f.mean_b ? f.a : f.b } : null };
      }
    }
    return out;
  }

  // Practice (IDEAS D-27; port of core/driver_profile.py practice): the skill "Work on" names, carried into the next drives.
  // plan: { skill, since ('YYYY-MM-DDTHH:MM', the drives' own local form), where (the focus's place, or null) }.
  const PRACTICE_MIN = 4, PRACTICE_FLOOR = 0.05, PRACTICE_SE = 2;
  function sideTest(where) {
    if (!where || GENERIC.has(where.worse)) return null;
    for (const [split, a, b, inA, inB] of WITHIN) {
      if (split !== where.split) continue;
      if (a === where.worse) return inA;
      if (b === where.worse) return inB;
    }
    return null;
  }
  function against(Core, xs, base) {
    const [m, se] = Core.meanSe(xs);
    if (!base) return [level(m), null, false];
    const diff = m - base[0], s = Math.sqrt(se * se + base[1] * base[1]);
    return [level(m), level(m) - level(base[0]), Math.abs(diff) >= PRACTICE_FLOOR && Math.abs(diff) >= PRACTICE_SE * s];
  }
  /** One drive on the practised skill; base: [mean, se] of every corner before the practice, or null. */
  function drivePractice(obs, plan, base = null, Core = CoreOf()) {
    const k = plan && plan.skill;
    if (!SKILLS.includes(k)) return null;
    const xs = vals(obs, k), out = { skill: k, n: xs.length, level: null, delta: null, sure: false, where_n: null, where_level: null };
    if (xs.length >= PRACTICE_MIN) [out.level, out.delta, out.sure] = against(Core, xs, base);
    const side = sideTest(plan.where);
    if (side) {
      const ws = obs.filter((o) => o[k] !== null && o[k] !== undefined && side(o)).map((o) => o[k]);
      out.where_n = ws.length;
      if (ws.length >= PRACTICE_MIN) out.where_level = level(Core.meanSe(ws)[0]);
    }
    return out;
  }
  /** The practice so far over the profile's drives (each with at: its local start, or null: unknown, counted before). */
  function practice(drivesIn, plan, Core = CoreOf()) {
    const k = plan && plan.skill;
    if (!SKILLS.includes(k)) return null;
    const since = String(plan.since || '');
    const key = (d) => [d.at || '', String(d.id)];
    const order = drivesIn.filter((d) => d.obs && d.obs.length).sort((p, q) => { const a = key(p), b = key(q); return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    const before = [], after = [], rows = [];
    for (const d of order) {
      const xs = vals(d.obs, k);
      if (d.at && d.at >= since) { after.push(...xs); if (xs.length) rows.push(d); } else before.push(...xs);
    }
    let base = null;
    const out = { skill: k, since, before: { level: null, n: before.length, mean: null, se: null }, after: { level: null, n: after.length }, delta: null, sure: false, drives: [] };
    if (before.length >= SKILL_MIN) {
      const [m, se] = Core.meanSe(before);
      base = [r(m, 4), r(se, 4)];                                     // as the plan keeps it for the end card, so both say the same
      Object.assign(out.before, { level: level(base[0]), mean: base[0], se: base[1] });
    }
    if (after.length >= PRACTICE_MIN) [out.after.level, out.delta, out.sure] = against(Core, after, base);
    out.drives = rows.map((d) => ({ id: d.id, at: d.at, ...drivePractice(d.obs, plan, base, Core) }));
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The words (pure, tests/test_driver_profile.py) and the Log's page
  // -------------------------------------------------------------------------------------------------------------
  const WORDS = {
    squeeze: { name: 'One braking', is: 'You brake once for a corner: on, then off.',
      tip: 'Pick the braking point early and squeeze on once. A second go at the pedal means the first was too light or too late.' },
    brake: { name: 'Brakes done by the apex', is: 'Your slowing is finished by the middle of the corner.',
      tip: 'Finish slowing before the middle of the corner. Braking past it means you arrived too fast: brake a little earlier.' },
    arc: { name: 'One steering arc', is: 'You turn in once and hold it, with no corrections on the way round.',
      tip: 'Turn in once and hold the wheel. A correction mid-corner means the turn-in was early or sharp: look further through the corner before you turn.' },
    entry: { name: 'Entry speed', is: 'You set your speed before the corner and keep it to the middle.',
      tip: 'Set the speed before you turn and hold it to the middle of the corner. Speeding up and slowing again mid-corner means the throttle came too soon.' },
    line: { name: 'Patient apex', is: 'You are slowest at the middle of the corner or just after, not long before it.',
      tip: 'Stay slow a little longer. The slowest point belongs at the middle of the corner, where you can see the way out.' },
    pace: { name: 'Pace', less: 'lower', more: 'higher', is: 'How much of each corner\'s sane limit you use, read as the Vetta Score reads it: full from 85% to 100% of it, and less above it, so over the limit never earns it.' },
    exit: { name: 'Back to power', is: 'Once the braking is done you pick the throttle straight up.',
      tip: 'When the braking is done, pick the throttle up gently straight away. A long coast is the car waiting for you.' },
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  // where a comparison's two sides are, as "through lefts" / "through rights"
  const SIDES = {
    'dir|L': 'through lefts', 'dir|R': 'through rights', 'size|tight': 'in tight corners', 'size|fast': 'in fast corners', 'size|rest': 'in the rest',
    'shape|tightens': 'in corners that tighten', 'shape|rest': 'in the rest', 'crest|crest': 'over crests', 'crest|rest': 'elsewhere',
    'grade|down': 'downhill', 'grade|up': 'uphill', 'time|start': 'in the first ten minutes of a drive', 'time|later': 'after them',
    'time|long': 'after an hour at the wheel', 'time|before': 'before it',
  };
  function sideWords(split, x) {
    if (split === 'car') return x === 'rest' ? 'in your other cars' : `in the ${x}`;
    if (split === 'tag') return x === 'rest' ? 'on your other drives' : `on drives tagged ${x}`;
    return SIDES[split + '|' + x] || String(x);
  }
  /** One finding as a sentence: "One steering arc is weaker through rights: 62 against 97 through lefts, on 5 of 5 drives." */
  const GENERIC = new Set(['rest', 'later', 'before']);
  function findingLine(f) {
    const worseA = f.mean_a < f.mean_b, w = worseA ? [f.a, f.mean_a, f.b, f.mean_b] : [f.b, f.mean_b, f.a, f.mean_a];
    const seen = f.agree === null || f.agree === undefined ? `across ${f.drives} drives` : `on ${f.agree} of ${f.drives} drives`;
    const also = (f.also || []).length ? ` The same shows in ${f.also.map((k) => WORDS[k].name.toLowerCase()).join(' and ')}.` : '';
    // said about the side that has a name: "weaker through rights", or "stronger in tight corners" when the rest is the weaker
    const W = WORDS[f.skill], more = W.more || 'stronger', less = W.less || 'weaker';
    const line = GENERIC.has(w[0]) ? `is ${more} ${sideWords(f.split, w[2])}: ${w[3]} against ${w[1]} ${sideWords(f.split, w[0])}`
      : `is ${less} ${sideWords(f.split, w[0])}: ${w[1]} against ${w[3]} ${sideWords(f.split, w[2])}`;
    return `${WORDS[f.skill].name} ${line}, ${seen}.${also}`;
  }
  /** How you drive, as up to three sentences of fact (never advice to go faster). */
  function styleLines(st, metric = true) {
    const out = [];
    if (finite(st.trail_share)) {
      const n = Math.round(st.trail_share * 10);
      out.push(n >= 6 ? `You brake into the corner: still on the brakes as the car turns in ${n} of 10 corners you brake for.`
        : n <= 2 ? `You finish braking in a straight line: still on the brakes as the car turns in only ${n} of 10 corners you brake for.`
          : `You brake into the corner about half the time (${n} of 10 corners you brake for).`);
    }
    if (finite(st.slow_m)) {
      const m = Math.abs(st.slow_m), d = metric ? `${Math.round(m)} m` : `${Math.round(m * 3.28084 / 5) * 5} ft`;
      out.push(m < 2.5 ? 'Your slowest point sits on the middle of the corner.' : `Your slowest point sits about ${d} ${st.slow_m < 0 ? 'before' : 'after'} the middle of the corner.`);
    }
    if (finite(st.use)) {
      const left = Math.round((1 - st.use) * 20) * 5;
      out.push(left > 0 ? `You usually keep about ${left}% of a corner's sane limit in hand.` : 'You usually drive at the corner\'s sane limit. On the road, leave more in hand.');
    }
    return out;
  }
  /** Your touch, as sentences of fact: how the brakes go on and come off, and how the car is loaded at turn-in. */
  const gps = (x) => `${x < 1 ? r(x, 2).toFixed(2).replace(/0$/, '') : r(x, 1).toFixed(1)} g a second`;
  function touchLines(t) {
    const out = [];
    if (!t) return out;
    const on = t.brake_on || {}, off = t.brake_off || {}, turn = t.turn_in || {};
    // a rate, or "quick": most corners quicker than 5 m bins can time
    const how = (m) => (finite(m.rate) ? `at about ${gps(m.rate)}` : m.quick_rate ? 'in one quick movement (quicker than the recording can time)' : null);
    const a = how(on), b = how(off);
    if (a && b) out.push(`You put the brakes on ${a} and let them off ${b}.`);
    else if (a) out.push(`You put the brakes on ${a}.`);
    else if (b) out.push(`You let the brakes off ${b}.`);
    if (finite(t.release)) {
      out.push(t.release <= 0.7 ? 'You let the brakes go more gently than you put them on, which keeps the front tyres loaded as you turn in.'
        : t.release >= 1.3 ? 'You let the brakes go more sharply than you put them on. Easing off them as you turn in keeps the front tyres loaded.'
          : 'You put the brakes on and let them off at about the same rate.');
    }
    if (finite(turn.rate)) out.push(`You load the car up at about ${gps(turn.rate)} as you turn in${finite(turn.lo) && finite(turn.hi) ? `, most corners between ${r(turn.lo, 1).toFixed(1)} and ${r(turn.hi, 1).toFixed(1)}` : ''}.`);
    else if (turn.quick_rate) out.push('You turn in with one quick movement of the wheel (quicker than the recording can time).');
    return out;
  }
  const TOUCH_NAME = { brake_on: 'Brakes on', brake_off: 'Brakes off', turn_in: 'Turn-in' };
  const rateText = (m) => (m && finite(m.rate) ? (m.rate < 1 ? r(m.rate, 2).toFixed(2).replace(/0$/, '') : r(m.rate, 1).toFixed(1)) : m && (m.quick_rate || m.quick === true) ? 'quick' : null);
  /** Touch month by month: a line a measure with two months or more read, the rate each month (facts, never a level). */
  function touchTrendLines(tt) {
    const out = [];
    for (const k of TOUCH) {
      const rows = (tt && tt[k]) || [];
      if (rows.length < 2) continue;
      out.push(`${TOUCH_NAME[k]} month by month, in g a second: ${rows.map((x) => `${MONTHS[+x.month.slice(5, 7) - 1]} ${rateText({ rate: x.rate, quick: x.quick }) || '--'}`).join(', ')}.`);
    }
    return out;
  }
  /** A drive's own touch (driveTouch) as sentences: this drive's rate a measure, beside the usual when there is one. */
  function driveTouchLines(dt) {
    const out = [];
    if (!dt || !dt.drive) return out;
    for (const k of TOUCH) {
      const a = rateText(dt.drive[k]), b = dt.usual ? rateText(dt.usual[k]) : null;
      if (!a) continue;
      const now = a === 'quick' ? 'one quick movement (quicker than the recording can time)' : `about ${a} g a second`;
      const off = dt.outside && dt.outside[k];
      out.push(`${TOUCH_NAME[k]}: ${now} on this drive${b ? `, ${b === 'quick' ? 'quick' : `${b}`} usually` : ''}.${off === 'above' ? ' Sharper than your usual range.' : off === 'below' ? ' Gentler than your usual range.' : ''}`);
    }
    return out;
  }
  /** Pace in words: what the level means for this driver, and how often a corner went over its sane limit. */
  function paceLines(p) {
    const out = [], s = p && p.skills && p.skills.pace, ov = p && p.pace ? p.pace.over : null;
    if (!s || s.level === null) return out;
    if (finite(ov) && ov >= 0.1) out.push(`${Math.round(ov * 10)} of 10 corners went over their sane limit, and pace counts those against you. On the road, leave more in hand.`);
    else if (finite(ov) && ov > 0) out.push(`Few corners went over their sane limit (${Math.max(1, Math.round(ov * 100))} in 100).`);
    else if (finite(ov)) out.push('No corner went over its sane limit.');
    return out;
  }
  /** The Log's card: one line. */
  function cardLine(p, pr = null) {
    if (!p || !p.corners) return null;
    const known = SKILLS.filter((k) => p.skills[k].level !== null);
    if (!known.length) return `${p.corners} of ${SKILL_MIN} clean corners measured. The picture of your driving starts at ${SKILL_MIN}.`;
    const bits = [];
    if (p.strongest) bits.push(`Strongest: ${WORDS[p.strongest].name} ${p.skills[p.strongest].level}`);
    // a practice under way says how it is going (IDEAS D-27); else the skill to work on
    if (pr) bits.push(`Practicing: ${WORDS[pr.skill].name} ${pr.after.level !== null ? `${pr.after.level}${pr.before.level !== null ? `, ${pr.before.level} before` : ''}` : 'from your next drive'}`);
    else if (p.focus) bits.push(`Work on: ${WORDS[p.focus.skill].name} ${p.skills[p.focus.skill].level}`);
    return bits.length ? bits.join(' · ') : `${known.length} of 6 skills measured, from ${p.corners} corners.`;
  }
  /** What to work on, as a heading and a sentence; null when nothing is short. */
  function focusLines(p) {
    if (!p || !p.focus) return null;
    const k = p.focus.skill, w = p.focus.where;
    return { head: `Work on: ${WORDS[k].name}`, where: w && !GENERIC.has(w.worse) ? `It shows most ${sideWords(w.split, w.worse)}.` : null, tip: WORDS[k].tip };
  }

  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const dayOf = (at) => (/^\d{4}-\d{2}-\d{2}/.test(at || '') ? `${+at.slice(8, 10)} ${MONTHS[+at.slice(5, 7) - 1]}` : null);
  /** The end card's line on the practised skill. r: drivePractice's; plan: the kept plan (its before level, its place). */
  function practiceLine(r, plan) {
    if (!r || !WORDS[r.skill]) return null;
    const head = `Practice · ${WORDS[r.skill].name}:`;
    if (r.level === null) return r.n ? `${head} ${r.n} corner${r.n === 1 ? '' : 's'} to judge it on, too few to say.` : `${head} no corner on this drive to judge it on.`;
    const b = plan && plan.before && finite(plan.before.level) ? plan.before.level : null;
    let t = `${head} ${r.level} on ${r.n} corners`;
    t += b === null ? '.' : r.sure ? `, ${Math.abs(r.delta)} ${r.delta > 0 ? 'above' : 'below'} your ${b} before.` : `, close to your ${b} before.`;
    const w = plan && plan.where;
    if (r.where_level !== null && w) t += ` ${cap(sideWords(w.split, w.worse))}: ${r.where_level} on ${r.where_n}.`;
    return t;
  }
  /** The practice so far, as a sentence for its panel. pr: practice's. */
  function practiceSummary(pr) {
    if (!pr) return null;
    const day = dayOf(pr.since), from = day ? `Since ${day}` : 'Since you started';
    if (pr.after.level === null) return `${from}, no drive yet with ${PRACTICE_MIN} or more corners to read it on. Your next twisty road is the first.`;
    const n = pr.drives.length;
    let t = `${from}: ${pr.after.level} on ${pr.after.n} corners over ${n} drive${n === 1 ? '' : 's'}`;
    if (pr.before.level === null) return `${t}. There were too few corners before to compare with.`;
    t += `, against ${pr.before.level} before.`;
    return t + (pr.sure ? (pr.delta > 0 ? ` Up ${pr.delta}: the practice is showing.` : ` Down ${-pr.delta}: keep at it, and take it slower.`) : ' No clear change yet: a change is said once it is well beyond chance.');
  }
  /** "YYYY-MM-DDTHH:MM", local, as the drives' own dates are written: the moment a plan starts. */
  const localStamp = (when = new Date()) => { const z = (x) => String(x).padStart(2, '0'); return `${when.getFullYear()}-${z(when.getMonth() + 1)}-${z(when.getDate())}T${z(when.getHours())}:${z(when.getMinutes())}`; };
  // the plan is kept on the phone (localStorage 'vetta.practice'), so the drive page's end card can read it
  const PLAN_KEY = 'vetta.practice';
  function loadPlan(store) {
    try { const x = JSON.parse(store.getItem(PLAN_KEY) || 'null'); return x && SKILLS.includes(x.skill) ? x : null; } catch (_) { return null; }
  }
  function savePlan(store, plan) { try { if (plan) store.setItem(PLAN_KEY, JSON.stringify(plan)); else store.removeItem(PLAN_KEY); } catch (_) {} }

  const el = (tag, cls, text) => { const n = root.document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; };
  const CSS = `
    .dp-road { display: grid; gap: 0; margin-bottom: 12px; } .dp-st { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 10px; align-items: start; position: relative; padding: 0 0 16px; }
    .dp-st::before { content: ""; position: absolute; left: 13px; top: 0; bottom: 0; width: 2px; background: var(--panel-ink); }
    .dp-st:first-child::before { top: 10px; } .dp-st:last-child::before { bottom: auto; height: 10px; } .dp-st:last-child { padding-bottom: 0; }
    .dp-dot { width: 12px; height: 12px; margin: 4px 0 0 8px; border: 2px solid var(--panel-ink); background: var(--panel); position: relative; z-index: 1; border-radius: 50%; }
    .dp-st.apex .dp-dot { background: var(--panel-ink); }
    .dp-st.weak .dp-dot { border-color: var(--accent); background: var(--accent); }
    .dp-name { font-weight: 700; font-size: 16px; line-height: 1.25; } .dp-is { font-size: 13px; color: var(--panel-dim); line-height: 1.45; margin-top: 2px; }
    .dp-lv { font-family: var(--font-num); font-weight: 700; font-size: 26px; line-height: 1; text-align: right; min-width: 44px; }
    .dp-lv small { display: block; font-family: var(--font-ui); font-weight: 600; font-size: 11px; color: var(--panel-dim); margin-top: 4px; white-space: nowrap; }
    .dp-bar { height: 5px; background: color-mix(in srgb, var(--panel-ink) 14%, transparent); margin-top: 8px; } .dp-bar u { display: block; height: 100%; background: var(--panel-ink); } .dp-st.weak .dp-bar u { background: var(--accent); }
    .dp-touch h3 { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--panel-dim); margin: 18px 0 2px; }
    .dp-phase { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--panel-dim); padding: 0 0 6px 38px; }
    .dp-prs { display: grid; gap: 6px; margin: 10px 0; } .dp-pr { display: grid; grid-template-columns: 56px minmax(0, 1fr) 56px; gap: 10px; align-items: center; font-size: 13px; }
    .dp-pr .dp-bar { margin-top: 0; height: 8px; position: relative; } .dp-pr .dp-bar s { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--accent); }
    .dp-pr b { font-family: var(--font-num); font-size: 16px; text-align: right; white-space: nowrap; } .dp-practice .note { margin-bottom: 10px; } .dp-pr b.up::before { content: "▲ "; font-size: 10px; } .dp-pr b.down::before { content: "▼ "; font-size: 10px; }
    .dp-acts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 4px; } .dp-go { margin-top: 10px; }
    .dp-say { font-size: 15px; line-height: 1.5; } .dp-say + .dp-say { margin-top: 8px; }
    .dp-focus { border: 2px solid var(--panel-ink); padding: 12px; } .dp-focus b { display: block; font-size: 17px; margin-bottom: 4px; }
    .dp-grid { table-layout: fixed; } .dp-grid th.l, .dp-grid td.l { width: 34%; text-align: left; font-family: var(--font-ui); white-space: normal; font-size: 13px; line-height: 1.3; }
    .dp-grid td, .dp-grid th { text-align: center; padding: 8px 2px; } .dp-grid td span { display: inline-block; width: 50%; }
    .dp-grid .dp-lr td { padding: 2px; border-bottom: 0; } .dp-grid .dp-lr span { font-family: var(--font-ui); font-size: 11px; color: var(--panel-dim); }
    .dp-grid span.low { color: var(--accent); font-weight: 700; }
    .dp-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; width: 100%; text-align: left; font: inherit; color: inherit; background: transparent; border: 1px solid var(--rule); padding: 12px; cursor: pointer; min-height: 44px; }
    .dp-card b { font-family: var(--font-num); font-size: 18px; } .dp-card span { grid-column: 1; font-size: 14px; color: var(--panel-dim); line-height: 1.45; } .dp-card i { grid-row: 1 / span 2; grid-column: 2; font-style: normal; font-size: 22px; }
  `;
  function styleOnce() {
    const doc = root.document;
    if (doc.getElementById('dpStyle')) return;
    const st = doc.createElement('style'); st.id = 'dpStyle'; st.textContent = CSS; doc.head.appendChild(st);
  }
  const PHASE = { squeeze: 'Into the corner', arc: 'Through it', line: 'Out of it' };   // the heading above the first station of each part
  const spark = (rows) => {
    if (!rows || rows.length < 2) return '';
    const W = 64, H = 18, lo = Math.min(...rows.map((x) => x.level)), hi = Math.max(...rows.map((x) => x.level)), span = Math.max(10, hi - lo);
    const pts = rows.map((x, i) => `${(2 + i / (rows.length - 1) * (W - 4)).toFixed(1)},${(H - 2 - (x.level - lo) / span * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px;display:inline-block;vertical-align:middle" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  };

  /** Draws the page into `host` (the Log's Your driving view). p: profile(); null while it is being worked out. */
  function render(host, p, opts = {}) {
    styleOnce();
    const metric = root.ApexUnits ? root.ApexUnits.metric() : true;
    host.replaceChildren();
    if (!p) { host.append(el('p', 'note', 'Reading your drives…')); return; }
    if (!p.corners) {
      host.append(el('p', 'dp-say', 'Nothing to read yet. Your driving is read from the corners of your own drives: start a drive on the map, and come back after a twisty road.'));
      return;
    }
    host.append(el('p', 'note', `From ${p.corners} clean corner${p.corners === 1 ? '' : 's'} on ${p.drives} drive${p.drives === 1 ? '' : 's'}, on this phone. Technique only: never speed or time.`));
    const fl = focusLines(p), plan = opts.plan || null, pr = opts.practice || null, onPlan = opts.onPlan || null;
    const key = (text, cls, fn) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
    if (plan && pr) {
      // the practice under way: how it has gone since it started, drive by drive against the level before it
      const box = el('div', 'dp-focus dp-practice');
      box.append(el('b', null, `Practicing: ${WORDS[plan.skill].name}`), el('p', 'dp-say', practiceSummary(pr)));
      const rows = pr.drives.filter((d) => d.level !== null).slice(-8);
      if (rows.length) {
        const list = el('div', 'dp-prs');
        list.setAttribute('role', 'list');
        for (const d of rows) {
          const row = el('div', 'dp-pr'), bar = el('div', 'dp-bar'), u = el('u');
          row.setAttribute('role', 'listitem');
          u.style.width = `${d.level}%`; bar.append(u);
          if (pr.before.level !== null) { const m = el('s'); m.style.left = `${pr.before.level}%`; bar.append(m); }
          row.append(el('span', null, dayOf(d.at) || '--'), bar, el('b', d.sure ? (d.delta > 0 ? 'up' : 'down') : null, String(d.level)));
          row.setAttribute('aria-label', `${dayOf(d.at) || 'date unknown'}: ${d.level} on ${d.n} corners`);
          list.append(row);
        }
        box.append(list);
        if (pr.before.level !== null) box.append(el('p', 'note', `Each drive on this one skill. The mark is your ${pr.before.level} before the practice.`));
      }
      box.append(el('p', 'dp-say', WORDS[plan.skill].tip));
      if (onPlan) {
        const acts = el('div', 'dp-acts');
        acts.append(key('Stop practicing', 'linkbtn', () => onPlan(null)));
        if (p.focus && p.focus.skill !== plan.skill) acts.append(key(`Practice ${WORDS[p.focus.skill].name.toLowerCase()} instead`, 'linkbtn', () => onPlan({ skill: p.focus.skill, where: p.focus.where, since: localStamp() })));
        box.append(acts);
      }
      host.append(box);
    } else if (fl) {
      const box = el('div', 'dp-focus');
      box.append(el('b', null, fl.head), el('p', 'dp-say', [fl.where, fl.tip].filter(Boolean).join(' ')));
      if (onPlan) {
        box.append(key('Practice it on my next drives', 'btn solid dp-go', () => onPlan({ skill: p.focus.skill, where: p.focus.where, since: localStamp() })));
        box.append(el('p', 'note', 'Each drive\'s end card then says how this one skill went, against your level now.'));
      }
      host.append(box);
    }
    const road = el('div', 'panel');
    road.append(el('h2', null, 'A corner, the way you drive it'));
    const list = el('div', 'dp-road');
    for (const k of SKILLS) {
      const s = p.skills[k], weak = !!(p.focus && p.focus.skill === k), ch = p.change[k];
      if (PHASE[k]) list.append(el('div', 'dp-phase', PHASE[k]));
      const row = el('div', 'dp-st' + (weak ? ' weak' : '') + (k === 'line' ? ' apex' : ''));
      row.dataset.skill = k;
      const mid = el('div');
      mid.append(el('div', 'dp-name', WORDS[k].name), el('div', 'dp-is', WORDS[k].is));
      const lv = el('div', 'dp-lv');
      if (s.level === null) {
        lv.innerHTML = '<i class="unk">--</i>';
        lv.append(el('small', null, `${s.n} of ${SKILL_MIN} corners`));
      } else {
        lv.textContent = String(s.level);
        const bar = el('div', 'dp-bar'), u = el('u'); u.style.width = `${s.level}%`; bar.append(u); mid.append(bar);
        if (ch && ch.sure) lv.append(el('small', null, `${ch.delta > 0 ? 'up' : 'down'} ${Math.abs(ch.delta)} since ${MONTHS[+ch.from.slice(5, 7) - 1]}`));
        const sp = spark(p.trend[k]);
        if (sp) { const w = el('small'); w.innerHTML = sp; w.setAttribute('aria-label', p.trend[k].map((x) => `${monthName(x.month)} ${x.level}`).join(', ')); w.setAttribute('role', 'img'); lv.append(w); }
      }
      lv.setAttribute('aria-label', s.level === null ? `not known yet, ${s.n} of ${SKILL_MIN} corners` : `${s.level} of 100`);
      row.append(el('div', 'dp-dot'), mid, lv);
      list.append(row);
    }
    road.append(list);
    road.append(el('p', 'note', `Each is 0 to 100 over every corner where it could be measured, and stays "--" until ${SKILL_MIN} corners. The small line is the level month by month.`));
    host.append(road);

    // Pace (IDEAS D-29): beside the skills, never one of them; it is never the one to work on
    if (p.skills.pace) {
      const s = p.skills.pace, ch = p.change.pace, pn = el('div', 'panel dp-pace'), row = el('div', 'dp-st'), mid = el('div'), lv = el('div', 'dp-lv');
      row.dataset.skill = 'pace';
      pn.append(el('h2', null, 'Your pace'));
      mid.append(el('div', 'dp-name', WORDS.pace.name), el('div', 'dp-is', WORDS.pace.is));
      if (s.level === null) { lv.innerHTML = '<i class="unk">--</i>'; lv.append(el('small', null, `${s.n} of ${SKILL_MIN} corners`)); }
      else {
        lv.textContent = String(s.level);
        const bar = el('div', 'dp-bar'), u = el('u'); u.style.width = `${s.level}%`; bar.append(u); mid.append(bar);
        if (ch && ch.sure) lv.append(el('small', null, `${ch.delta > 0 ? 'up' : 'down'} ${Math.abs(ch.delta)} since ${MONTHS[+ch.from.slice(5, 7) - 1]}`));
        const sp = spark(p.trend.pace);
        if (sp) { const w = el('small'); w.innerHTML = sp; w.setAttribute('role', 'img'); w.setAttribute('aria-label', p.trend.pace.map((x) => `${monthName(x.month)} ${x.level}`).join(', ')); lv.append(w); }
      }
      lv.setAttribute('aria-label', s.level === null ? `not known yet, ${s.n} of ${SKILL_MIN} corners` : `${s.level} of 100`);
      row.append(el('div', 'dp-dot'), mid, lv);
      const list = el('div', 'dp-road'); list.append(row); pn.append(list);
      pn.append(...paceLines(p).map((t) => el('p', 'dp-say', t)));
      pn.append(...(p.pace_findings || []).map((f) => { const n = el('p', 'dp-say', findingLine(f)); n.dataset.split = f.split; return n; }));
      pn.append(el('p', 'note', 'The same pace as in your Vetta Score. It is never the thing to work on here: on a public road, the right pace is the one that leaves you room.'));
      host.append(pn);
    }

    const style = styleLines(p.style, metric);
    if (style.length) { const pn = el('div', 'panel'); pn.append(el('h2', null, 'Your style'), ...style.map((t) => el('p', 'dp-say', t))); host.append(pn); }

    // Your touch: from the ten g readings a second (drives recorded before them have none to give)
    if (p.touch && TOUCH.some((k) => p.touch[k] && p.touch[k].n)) {
      const pn = el('div', 'panel dp-touch'), lines = touchLines(p.touch);
      pn.append(el('h2', null, 'Your touch'));
      if (lines.length) pn.append(...lines.map((t) => el('p', 'dp-say', t)));
      else {
        const most = Math.max(...TOUCH.map((k) => p.touch[k].n));
        pn.append(el('p', 'dp-say', `${most} of ${STYLE_MIN} corners read so far. Your touch is said from ${STYLE_MIN}.`));
      }
      // by size of corner: a row a measure, a column a size (a tight corner takes the brakes on harder: not a fault)
      const tb = p.touch_by || {}, sizes = ['tight', 'medium', 'fast'];
      if (sizes.some((z) => tb[z] && TOUCH.some((k) => tb[z][k] && (finite(tb[z][k].rate) || tb[z][k].quick_rate)))) {
        const t = el('table', 'dp-grid dp-touch-by'), hr = el('tr');
        hr.append(el('th', 'l', 'g a second'), ...sizes.map((z) => el('th', null, `${z[0].toUpperCase()}${z.slice(1)}`)));
        t.append(hr);
        for (const k of TOUCH) {
          const tr = el('tr');
          tr.append(el('td', 'l', TOUCH_NAME[k]));
          for (const z of sizes) {
            const v = rateText(tb[z] && tb[z][k]), td = el('td');
            if (v === null) td.innerHTML = '<i class="unk">--</i>'; else td.textContent = v;
            td.setAttribute('aria-label', `${TOUCH_NAME[k]}, ${z} corners: ${v === null ? 'not known yet' : v === 'quick' ? 'quicker than the recording can time' : `${v} g a second`}`);
            tr.append(td);
          }
          t.append(tr);
        }
        pn.append(el('h3', null, 'By kind of corner'), t, el('p', 'note', `The middle corner of each kind, from ${MATRIX_MIN} corners. Quick: quicker than the recording can time. A tight corner takes the brakes on harder; that is the road, not a fault.`));
      }
      const tl = touchTrendLines(p.touch_trend);
      if (tl.length) pn.append(...tl.map((x) => el('p', 'dp-say', x)));
      pn.append(el('p', 'note', 'Read from the g the phone measures ten times a second: how fast the load comes on and goes off between a fifth and four fifths of its peak. Drives recorded before the phone kept every reading have none to give.'));
      host.append(pn);
    }

    const say = el('div', 'panel');
    say.append(el('h2', null, 'What your drives say'));
    if (p.findings.length) say.append(...p.findings.map((f) => { const n = el('p', 'dp-say', findingLine(f)); n.dataset.split = f.split; return n; }));
    else say.append(el('p', 'dp-say', 'No clear difference yet between lefts and rights, tight and fast corners, uphill and down, or early and late in a drive.'));
    say.append(el('p', 'note', 'A difference is said only when it is large, far beyond chance, and repeats drive after drive. Lefts against rights, hills, time and cars are compared on corners of the same size.'));
    host.append(say);

    if (p.matrix.some((m) => MEASURES.some((k) => m.levels[k] != null))) {
      const grid = el('div', 'panel');
      grid.append(el('h2', null, 'By kind of corner'));
      // a row a skill, a column a size, lefts and rights side by side in it: six columns of numbers do not fit a phone
      const t = el('table', 'dp-grid'), hr = el('tr'), sizes = ['tight', 'medium', 'fast'];
      hr.append(el('th', 'l', ''), ...sizes.map((z) => el('th', null, `${z[0].toUpperCase()}${z.slice(1)}`)));
      t.append(hr);
      const sub = el('tr', 'dp-lr');
      sub.append(el('td', 'l', ''), ...sizes.map(() => { const td = el('td'); td.append(el('span', null, 'left'), el('span', null, 'right')); return td; }));
      t.append(sub);
      for (const k of MEASURES.filter((x) => p.skills[x])) {
        const tr = el('tr');
        tr.append(el('td', 'l', WORDS[k].name));
        for (const z of sizes) {
          const td = el('td');
          for (const way of ['L', 'R']) {
            const m = p.matrix.find((x) => x.dir === way && x.size === z), v = m && m.levels[k] != null ? m.levels[k] : null;
            const n = el('span', v !== null && p.skills[k] && p.skills[k].level !== null && v <= p.skills[k].level - 10 ? 'low' : null);
            if (v === null) n.innerHTML = '<i class="unk">--</i>'; else n.textContent = String(v);
            n.setAttribute('aria-label', `${z} ${way === 'L' ? 'lefts' : 'rights'}: ${v === null ? 'not known yet' : v}`);
            td.append(n);
          }
          tr.append(td);
        }
        t.append(tr);
      }
      grid.append(t, el('p', 'note', `A kind of corner has a level from ${MATRIX_MIN} corners. Marked: 10 or more below your level overall.`));
      host.append(grid);
    }
  }

  const api = { SKILLS, observe, profile, swing, excess, SKILL_MIN, WORDS, findingLine, styleLines, touchLines, touchTrendLines, driveTouchLines, paceLines, PACE, MEASURES, touch, TOUCH, driveTouch, DRIVE_TOUCH_MIN, bestCorners, cardLine, focusLines, render,
    PRACTICE_MIN, practice, drivePractice, practiceLine, practiceSummary, localStamp, loadPlan, savePlan, PLAN_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriverProfile = api;
})(typeof window !== 'undefined' ? window : globalThis);
