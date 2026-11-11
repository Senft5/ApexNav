// Your driving (the driver profile): what every clean corner of every drive on this phone says, taken together, about
// how you drive. Port of core/driver_profile.py (observe, profile; held to parity by tests/test_driver_profile.py), the
// words for it, and the Log's page. Six skills in the order a corner is driven, each 0-100 and unknown under 30 corners;
// where you are measurably better or worse (lefts and rights, tight and fast, downhill, the first ten minutes, one car, a
// tag), kept only when it is large, far beyond chance and repeats drive after drive; each skill month by month.
// Technique only: no speed, time or legality enters a level, and nothing here is sent anywhere.
(function (root) {
  'use strict';
  const SKILLS = ['squeeze', 'brake', 'arc', 'entry', 'line', 'exit'];
  const SWING_G = 0.10, ARC_SPAN_G = 0.6, SQUEEZE_SPAN_G = 0.5, SQUEEZE_MIN_G = 0.20, SQUEEZE_PAD = 2, SQUEEZE_GAP = 6, ENTRY_SWING_MPS = 0.6, SLOW_PAD = 10, ENTRY_SPAN_MPS = 3.0,
    FOCUS_MAX = 85, EXIT_FREE_M = 10, EXIT_SPAN_M = 40, LINE_FREE_M = 5, LINE_SPAN_M = 25, TRAIL_MIN_M = 10, GRADE_PAD = 10, GRADE_MIN = 0.04,
    WARM_MIN = 10, LONG_MIN = 60, SKILL_MIN = 30, STYLE_MIN = 20, MATRIX_MIN = 10, SPLIT_MIN = 12, SPLIT_FLOOR = 0.08, SPLIT_SE = 3,
    SPLIT_DRIVE_MIN = 3, SPLIT_DRIVES = 2, GROUP_DRIVES = 4, GROUP_DRIVE_MIN = 5, TREND_MIN = 15, TREND_FLOOR = 0.05, TREND_SE = 2, TOP_FINDINGS = 8;
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
      let squeeze = null;
      const run = brakeRun(Core, lon, s, a);
      if (run) {
        const lo = Math.max(0, a - Core.BRAKE_LOOKBACK);
        let first = run[0];
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
  const cmp = (p, q) => (p < q ? -1 : p > q ? 1 : 0);

  /** drives: [{ id, month ('YYYY-MM' or null), car (label or null), tags ([str] or null), obs (observe's) }]. */
  function profile(drivesIn, Core = CoreOf()) {
    const drives = (drivesIn || []).filter((d) => d && Array.isArray(d.obs) && d.obs.length);
    const every = [];
    for (const d of drives) every.push(...d.obs);
    const out = { corners: every.length, drives: drives.length, skills: {}, style: {}, matrix: [], findings: [], trend: {}, change: {}, strongest: null, focus: null };
    const overall = {};
    for (const k of SKILLS) {
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
    const bySize = {};
    for (const size of ['tight', 'medium', 'fast', null]) {
      const cell = every.filter((o) => o.size === size);
      for (const k of SKILLS) { const xs = vals(cell, k); bySize[k + '|' + size] = xs.length ? Core.meanSe(xs)[0] : 0; }
    }
    for (const way of ['L', 'R']) for (const size of ['tight', 'medium', 'fast']) {
      const cell = every.filter((o) => o.dir === way && o.size === size), levels = {};
      for (const k of SKILLS) { const xs = vals(cell, k); levels[k] = xs.length >= MATRIX_MIN ? level(Core.meanSe(xs)[0]) : null; }
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
    for (const k of SKILLS) {
      const left = (o) => o[k] - bySize[k + '|' + o.size], asIs = (o) => o[k];
      for (const [split, a, b, inA, inB] of WITHIN) { const raw = split === 'size'; add(k, split, a, b, within(Core, drives, k, raw ? asIs : left, inA, inB), raw); }
      if (cars.length >= 2) for (const car of cars) add(k, 'car', car, 'rest', between(Core, withCar, k, left, (d) => d.car === car), false);
      for (const tag of tags) add(k, 'tag', tag, 'rest', between(Core, drives, k, left, (d) => (d.tags || []).includes(tag)), false);
    }
    const mag = (f) => (f.z === null ? Infinity : Math.abs(f.z));
    found.sort((p, q) => mag(q) - mag(p) || cmp(p.split, q.split) || cmp(String(p.a), String(q.a)) || SKILLS.indexOf(p.skill) - SKILLS.indexOf(q.skill));
    const seen = new Map();
    for (const f of found) {
      const key = f.split + '|' + f.a;
      if (seen.has(key)) { seen.get(key).also.push(f.skill); continue; }
      const g = { ...f, also: [], z: f.z === null ? null : r(f.z, 2) };
      seen.set(key, g);
      out.findings.push(g);
    }
    out.findings = out.findings.slice(0, TOP_FINDINGS);

    const months = [...new Set(drives.map((d) => d.month).filter(Boolean))].sort(cmp);
    for (const k of SKILLS) {
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
    const line = GENERIC.has(w[0]) ? `is stronger ${sideWords(f.split, w[2])}: ${w[3]} against ${w[1]} ${sideWords(f.split, w[0])}`
      : `is weaker ${sideWords(f.split, w[0])}: ${w[1]} against ${w[3]} ${sideWords(f.split, w[2])}`;
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
  /** The Log's card: one line. */
  function cardLine(p) {
    if (!p || !p.corners) return null;
    const known = SKILLS.filter((k) => p.skills[k].level !== null);
    if (!known.length) return `${p.corners} of ${SKILL_MIN} clean corners measured. The picture of your driving starts at ${SKILL_MIN}.`;
    const bits = [];
    if (p.strongest) bits.push(`Strongest: ${WORDS[p.strongest].name} ${p.skills[p.strongest].level}`);
    if (p.focus) bits.push(`Work on: ${WORDS[p.focus.skill].name} ${p.skills[p.focus.skill].level}`);
    return bits.length ? bits.join(' · ') : `${known.length} of 6 skills measured, from ${p.corners} corners.`;
  }
  /** What to work on, as a heading and a sentence; null when nothing is short. */
  function focusLines(p) {
    if (!p || !p.focus) return null;
    const k = p.focus.skill, w = p.focus.where;
    return { head: `Work on: ${WORDS[k].name}`, where: w && !GENERIC.has(w.worse) ? `It shows most ${sideWords(w.split, w.worse)}.` : null, tip: WORDS[k].tip };
  }

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
    .dp-phase { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--panel-dim); padding: 0 0 6px 38px; }
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
  function render(host, p) {
    styleOnce();
    const metric = root.ApexUnits ? root.ApexUnits.metric() : true;
    host.replaceChildren();
    if (!p) { host.append(el('p', 'note', 'Reading your drives…')); return; }
    if (!p.corners) {
      host.append(el('p', 'dp-say', 'Nothing to read yet. Your driving is read from the corners of your own drives: start a drive on the map, and come back after a twisty road.'));
      return;
    }
    host.append(el('p', 'note', `From ${p.corners} clean corner${p.corners === 1 ? '' : 's'} on ${p.drives} drive${p.drives === 1 ? '' : 's'}, on this phone. Technique only: never speed or time.`));
    const fl = focusLines(p);
    if (fl) {
      const box = el('div', 'dp-focus');
      box.append(el('b', null, fl.head), el('p', 'dp-say', [fl.where, fl.tip].filter(Boolean).join(' ')));
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

    const style = styleLines(p.style, metric);
    if (style.length) { const pn = el('div', 'panel'); pn.append(el('h2', null, 'Your style'), ...style.map((t) => el('p', 'dp-say', t))); host.append(pn); }

    const say = el('div', 'panel');
    say.append(el('h2', null, 'What your drives say'));
    if (p.findings.length) say.append(...p.findings.map((f) => { const n = el('p', 'dp-say', findingLine(f)); n.dataset.split = f.split; return n; }));
    else say.append(el('p', 'dp-say', 'No clear difference yet between lefts and rights, tight and fast corners, uphill and down, or early and late in a drive.'));
    say.append(el('p', 'note', 'A difference is said only when it is large, far beyond chance, and repeats drive after drive. Lefts against rights, hills, time and cars are compared on corners of the same size.'));
    host.append(say);

    if (p.matrix.some((m) => SKILLS.some((k) => m.levels[k] !== null))) {
      const grid = el('div', 'panel');
      grid.append(el('h2', null, 'By kind of corner'));
      // a row a skill, a column a size, lefts and rights side by side in it: six columns of numbers do not fit a phone
      const t = el('table', 'dp-grid'), hr = el('tr'), sizes = ['tight', 'medium', 'fast'];
      hr.append(el('th', 'l', ''), ...sizes.map((z) => el('th', null, `${z[0].toUpperCase()}${z.slice(1)}`)));
      t.append(hr);
      const sub = el('tr', 'dp-lr');
      sub.append(el('td', 'l', ''), ...sizes.map(() => { const td = el('td'); td.append(el('span', null, 'left'), el('span', null, 'right')); return td; }));
      t.append(sub);
      for (const k of SKILLS) {
        const tr = el('tr');
        tr.append(el('td', 'l', WORDS[k].name));
        for (const z of sizes) {
          const td = el('td');
          for (const way of ['L', 'R']) {
            const m = p.matrix.find((x) => x.dir === way && x.size === z), v = m ? m.levels[k] : null;
            const n = el('span', v !== null && p.skills[k].level !== null && v <= p.skills[k].level - 10 ? 'low' : null);
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

  const api = { SKILLS, observe, profile, swing, excess, SKILL_MIN, WORDS, findingLine, styleLines, cardLine, focusLines, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriverProfile = api;
})(typeof window !== 'undefined' ? window : globalThis);
