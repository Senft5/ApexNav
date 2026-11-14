// Live ghost duels (IDEAS D-04, the owner 2026-11-10/11: time duels; 2026-11-14: live time gaps). A friend's quickest
// run on one of your stages, as they shared it (backend/src/social.ts ghosts: their splits, only where their times reach
// you, on a road like yours), is a ghost to drive against: the drive bar and the co-driver say "+0.3 s vs @sam" as you
// go, and the drive page sets your pass against it corner by corner.
// A shared run's splits are cut at its corners' apexes only (cutsOf: 100 m apart at least, and the finish), so the time
// between two of them always holds a corner: what a friend can read is how quickly you got from corner to corner, never
// how fast you went down a straight (about.html: "No top speeds"). Your own pass, on your phone, is cut finely (every
// 25 m) to set against them. Times are the drive's own clock (Core.elapsedS, the same time a stage result's time_s is).
// Splits are [[q, t]]: q the fraction of the stage (0..1, the last 1), t the seconds from its start.
// Pure (tests/test_ghost_duel.py); the cockpit and the drive page draw it.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const MAX = 200, STEP_M = 25, APART_M = 100;                          // backend SPLITS_MAX; your own pass every 25 m
  const metres = (a, b) => Math.hypot((b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180), (b[0] - a[0]) * 110540);
  const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
  const turn = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const r3 = (x) => Math.round(x * 1000) / 1000, r1 = (x) => Math.round(x * 10) / 10;

  /** How many even cuts your own pass of n_m metres gets: one every 25 m, at least 2, at most 200. */
  const countFor = (n_m) => Math.max(2, Math.min(MAX, Math.round(n_m / STEP_M)));
  /** Even cuts: k/N, k = 1..N. */
  const evenCuts = (n) => Array.from({ length: n }, (_, k) => (k + 1) / n);

  /**
   * Where a shared run is cut: each corner's apex inside [lo, hi] (sample indices), as a fraction of the pass, at least
   * 100 m from the start, the finish and the cut before it, then the finish (1). At most 200.
   */
  function cutsOf(lo, hi, apexes) {
    const span = (hi - lo) * 5, out = [];
    if (!(span > 0)) return [1];
    let last = 0;
    for (const a of [...(apexes || [])].filter(finite).sort((x, y) => x - y)) {
      const m = (a - lo) * 5;
      if (m - last < APART_M || span - m < APART_M) continue;
      out.push(r3(m / span)); last = m;
      if (out.length >= MAX - 1) break;
    }
    out.push(1);
    return out;
  }

  /**
   * A drive's splits over [lo, hi] (its pass of a stage, Core.segmentPass) at cuts (fractions, the last 1; even 25 m cuts
   * when none are given): [[q, t]], t to a tenth. Null when the pass is too short or its clock has a gap.
   */
  function splitsOf(Core, d, lo, hi, cuts = null) {
    if (!d || !d.speed_mps || !(d.speed_mps.length > hi) || !(hi > lo + 1)) return null;
    const t = Core.elapsedS(d.speed_mps), qs = Array.isArray(cuts) && cuts.length ? cuts : evenCuts(countFor((hi - lo) * 5)), out = [];
    for (const q of qs) {
      const x = lo + q * (hi - lo), i = Math.floor(x), f = x - i;
      const a = t[i], b = t[Math.min(hi, i + 1)];
      if (!finite(a) || !finite(b)) return null;
      out.push([r3(q), r1(a + (b - a) * f - t[lo])]);
    }
    return out.every((p, k) => p[1] >= 0 && (!k || (p[0] > out[k - 1][0] && p[1] >= out[k - 1][1]))) ? out : null;
  }

  /** The elapsed seconds at fraction q (0..1) of the stage, between the splits around it (0 at the start). */
  function timeAt(splits, q) {
    if (!Array.isArray(splits) || !splits.length || !finite(q)) return null;
    const x = Math.max(0, Math.min(1, q));
    let p0 = [0, 0];
    for (const p of splits) {
      if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null;
      if (x <= p[0]) return p[0] > p0[0] ? p0[1] + (p[1] - p0[1]) * (x - p0[0]) / (p[0] - p0[0]) : p[1];
      p0 = p;
    }
    return p0[1];
  }

  /** Seconds you are behind the ghost (above 0) or ahead (below 0), at fraction q having taken elapsed_s. */
  function gapAt(splits, q, elapsed_s) {
    const g = timeAt(splits, q);
    return finite(g) && finite(elapsed_s) ? elapsed_s - g : null;
  }

  /**
   * Corner by corner, your pass (`mine`, finely cut) against the ghost: one row for each stretch between two of its splits
   * (the start to its first corner, corner to corner, the last to the finish), with the time each of you took and the gap
   * (above 0: you were slower), and `total` the gap at the finish.
   */
  function cornerSplits(mine, ghost) {
    if (!Array.isArray(ghost) || !ghost.length) return { rows: [], total: null };
    const rows = [];
    let q0 = 0, g0 = 0;
    for (const [q, g] of ghost) {
      const m = timeAt(mine, q) - timeAt(mine, q0);
      if (finite(m)) rows.push({ k: rows.length + 1, a: q0, b: q, mine_s: Math.round(m * 100) / 100, ghost_s: Math.round((g - g0) * 100) / 100, gap_s: Math.round((m - (g - g0)) * 100) / 100 });
      q0 = q; g0 = g;
    }
    const total = timeAt(mine, 1) - ghost[ghost.length - 1][1];
    return { rows, total: finite(total) ? Math.round(total * 10) / 10 : null };
  }

  /**
   * The few stretches that decided it (cornerSplits rows): where you lost most to the ghost and where you gained most, at
   * most n of each, each over 0.05 s, biggest first.
   */
  function standout(rows, n = 3) {
    const ok = (rows || []).filter((r) => r && finite(r.gap_s));
    return { lost: ok.filter((r) => r.gap_s > 0.05).sort((a, b) => b.gap_s - a.gap_s).slice(0, n),
             gained: ok.filter((r) => r.gap_s < -0.05).sort((a, b) => a.gap_s - b.gap_s).slice(0, n) };
  }

  /** "+0.3 vs @sam", "−1.2 vs @sam", "level with @sam"; "--" when nothing compares yet. */
  function label(gap, who) {
    const w = who ? `@${String(who).replace(/^@/, '')}` : 'them';
    if (!finite(gap)) return '--';
    if (Math.abs(gap) < 0.05) return `level with ${w}`;
    return `${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)} s vs ${w}`;
  }
  /** What the co-driver says: "Three tenths up on Sam." / "1.4 seconds down on Sam." / "Level with Sam." */
  function spoken(gap, who, say) {
    if (!finite(gap)) return null;
    const w = String(who || 'them').replace(/^@/, '');
    if (Math.abs(gap) < 0.05) return `Level with ${w}.`;
    return `${say ? say(Math.abs(gap)) : `${Math.abs(gap).toFixed(1)} seconds`} ${gap > 0 ? 'down on' : 'up on'} ${w}.`;
  }

  const ENTRY_M = 30, HEADING_DEG = 60, NEAR_M = 25, PAST_M = 12, SAY_EVERY = 2;
  /**
   * Follows the live 5 m rows ({ lat, lon, t_s }) against ghosts [{ stage: { id, name, start, end, length_m, geom }, who,
   * splits, time_s }]. update(rows) → null outside a stage, { state: 'in', name, who, gap, q } inside, and
   * { state: 'done', ..., gap, time_s } once on finishing. Time is the rows' own clock (t_s); without one nothing shows.
   * gap is as of the last of the ghost's splits passed (null before the first). say: true at the first split past half
   * way, and at the finish (the co-driver's moments: two lines a stage, no more).
   */
  function createTracker(ghosts) {
    let cur = null, near = null, scanned = 0;
    const list = (ghosts || []).filter((g) => g && g.stage && Array.isArray(g.splits) && g.splits.length && finite(g.stage.length_m) && Array.isArray(g.stage.geom) && g.stage.geom.length > 1);
    return {
      update(rows) {
        const n = rows.length;
        let say = false;
        for (let i = scanned; i < n; i++) {
          const r = rows[i], p = [r.lat, r.lon];
          if (!finite(p[0]) || !finite(p[1])) continue;
          if (!cur) {
            // near a stage's start, heading its way: the clock starts at the closest approach to the start line
            if (near && metres(p, near.g.stage.start) > near.m) {
              const e = rows[near.i];
              cur = { g: near.g, entry: near.i, t0: e.t_s, endMin: { m: Infinity, i: -1 }, said: 0, gap: null, q: 0, k: 0 };
              near = null;
              // fall through: this row is already inside the stage
            } else {
              for (const g of list) {
                const m = metres(p, g.stage.start);
                if (i < 3 || m > ENTRY_M) continue;
                const q = [rows[i - 3].lat, rows[i - 3].lon], gm = g.stage.geom;
                if (metres(q, p) < 5 || turn(bearing(q, p), bearing(gm[0], gm[Math.min(2, gm.length - 1)])) > HEADING_DEG) continue;
                if (!finite(r.t_s)) continue;
                if (!near || near.g !== g || m <= near.m) near = { g, i, m };
                break;
              }
              if (near && i - near.i > 20) near = null;              // stopped short of the start: no duel
              continue;
            }
          }
          // the gap is taken at each of the ghost's splits as you pass it (its corners), and held between them
          const L = cur.g.stage.length_m, q = Math.min(1, (i - cur.entry) * 5 / L), sp = cur.g.splits;
          cur.q = q;
          while (cur.k < sp.length - 1 && q >= sp[cur.k][0]) {
            if (finite(r.t_s)) cur.gap = r.t_s - cur.t0 - sp[cur.k][1];
            cur.k++;
            const mark = Math.floor(sp[cur.k - 1][0] * SAY_EVERY);
            if (mark > cur.said && mark < SAY_EVERY && finite(cur.gap)) { cur.said = mark; say = true; }
          }
          const me = metres(p, cur.g.stage.end), half = (i - cur.entry) * 5 >= 0.5 * L;
          if (half && me < cur.endMin.m) cur.endMin = { m: me, i };
          const off = (i - cur.entry) * 5 > 1.5 * L + 200;
          if (off) { cur = null; scanned = i + 1; return null; }       // left the stage: no result
          if (cur.endMin.m <= NEAR_M && me > cur.endMin.m + PAST_M) {
            const e = rows[cur.endMin.i], time = finite(e.t_s) ? e.t_s - cur.t0 : null;
            const out = { state: 'done', name: cur.g.stage.name, who: cur.g.who, stageId: cur.g.stage.id, q: 1, time_s: time,
                          gap: finite(time) ? time - cur.g.time_s : cur.gap, say: true };
            cur = null; scanned = i + 1;
            return out;
          }
        }
        scanned = n;
        return cur ? { state: 'in', name: cur.g.stage.name, who: cur.g.who, stageId: cur.g.stage.id, q: cur.q, gap: cur.gap, say } : null;
      },
    };
  }

  const api = { cutsOf, splitsOf, timeAt, gapAt, cornerSplits, standout, label, spoken, createTracker, countFor, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexGhostDuel = api;
})(typeof window !== 'undefined' ? window : globalThis);
