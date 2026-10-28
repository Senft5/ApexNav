// Live delta on a stage you saved (IDEAS D-05): while you drive one of your Log stages, each corner you finish is scored
// the way the Driver Score scores it (envelope use, smoothness, braking) and the running score is set against your best
// pass over the same corners: "+12" ahead, "-8" behind. Technique, never time or speed (the guardrails).
// reference() and createTracker() are pure over ApexCore (tests/test_stage_delta.py); the cockpit draws the bar.
(function (root) {
  'use strict';
  const NEAR_M = 25, ENTRY_M = 30, HEADING_DEG = 60, PAST_M = 12;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const metres = (a, b) => Math.hypot((b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180), (b[0] - a[0]) * 110540);
  const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
  const turn = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const geomOf = (seg) => { try { const g = typeof seg.geom === 'string' ? JSON.parse(seg.geom) : seg.geom; return Array.isArray(g) && g.length > 1 ? g : null; } catch (_) { return null; } };

  /**
   * One drive's pass over a stage as a reference: each scorable corner inside it (where it starts, peaks and ends, and its
   * technique), and the pass's score. `corners` are the drive's scorable corners (ApexRecording.scorableCorners). Null when
   * the drive doesn't cover the stage or has no corner that scores.
   */
  function reference(Core, seg, d, corners) {
    const w = Core.segmentWindow(seg, d);
    if (!w) return null;
    const [lo, hi] = w, at = (i) => [d.lat[i], d.lon[i]], out = [];
    for (const c of corners || []) {
      if (c.start < lo || c.end > hi) continue;
      const t = Core.cornerTechnique(d.speed_mps, d.lon_g, d.lat_g, c);
      if (t) out.push({ s: at(c.start), a: at(c.apex), e: at(c.end), len: c.end - c.start, apexOff: c.apex - c.start, apex_mps: c.apex_mps, t });
    }
    if (!out.length) return null;
    return { id: seg.id, name: seg.name || 'Stage', start: [seg.lat0, seg.lon0], end: [seg.lat1, seg.lon1], length_m: seg.length_m,
             geom: geomOf(seg), corners: out, score: Core.techniqueScore(out.map((c) => c.t)).score, driveId: d.id };
  }

  /** The best of several references for one stage (highest score; ties go to the newest drive). */
  function best(refs) {
    return (refs || []).filter((r) => r && finite(r.score)).reduce((b, r) => (!b || r.score >= b.score ? r : b), null);
  }

  /**
   * Follows the live 5 m rows ({lat, lon, speed_mps, lat_g, lon_g}) against references. update(rows) returns what to show:
   * null outside a stage, { state: 'in', name, done, of, delta } inside (delta null until a corner both passes scored), and
   * { state: 'done', ... } once, on leaving the stage.
   */
  function createTracker(Core, refs) {
    let cur = null, scanned = 0;
    const startPass = (rows, i, ref) => ({ ref, entry: i, next: 0, mins: ref.corners.map(() => ({ m: Infinity, i: -1 })), live: [], best: [], endMin: { m: Infinity, i: -1 } });
    function view(state) {
      const live = Core.techniqueScore(cur.live).score, bst = Core.techniqueScore(cur.best).score;
      return { state, name: cur.ref.name, done: cur.live.length + cur.skipped, of: cur.ref.corners.length,
               delta: finite(live) && finite(bst) ? live - bst : null, score: finite(live) ? live : null };
    }
    function scoreCorner(rows, k, iEnd) {
      const c = cur.ref.corners[k];
      const near = (p, from, to) => { let bi = -1, bm = Infinity; for (let j = from; j <= to; j++) { const m = metres([rows[j].lat, rows[j].lon], p); if (m < bm) { bm = m; bi = j; } } return [bi, bm]; };
      const lo = Math.max(cur.entry, iEnd - 3 * c.len - 20);
      const [iS, mS] = near(c.s, lo, iEnd), [iA] = near(c.a, Math.max(iS, 0), iEnd);
      if (iS < 0 || mS > NEAR_M || !(iS < iA && iA <= iEnd)) return null;
      const v = [], lon = [], lat = [];
      for (let j = iS; j <= iEnd; j++) { v.push(rows[j].speed_mps); lon.push(rows[j].lon_g); lat.push(rows[j].lat_g); }
      const num = (a) => a.map((x) => (finite(x) ? x : NaN));
      return Core.cornerTechnique(num(v), num(lon), num(lat), { start: 0, apex: iA - iS, end: iEnd - iS, apex_mps: c.apex_mps });
    }
    return {
      update(rows) {
        const n = rows.length;
        for (let i = scanned; i < n; i++) {
          const p = [rows[i].lat, rows[i].lon];
          if (!finite(p[0]) || !finite(p[1])) continue;
          if (!cur) {
            // entering: at a stage's start, heading the way it runs
            for (const ref of refs) {
              if (metres(p, ref.start) > ENTRY_M || i < 3 || !ref.geom) continue;
              const q = [rows[i - 3].lat, rows[i - 3].lon];
              if (metres(q, p) < 5 || turn(bearing(q, p), bearing(ref.geom[0], ref.geom[Math.min(2, ref.geom.length - 1)])) > HEADING_DEG) continue;
              cur = { ...startPass(rows, i, ref), skipped: 0 };
              break;
            }
            continue;
          }
          // each corner ahead: closest approach to where it ends, then a few metres past it scores it
          for (let k = cur.next; k < cur.ref.corners.length; k++) {
            const mk = cur.mins[k], m = metres(p, cur.ref.corners[k].e);
            if (m < mk.m) { mk.m = m; mk.i = i; }
            if (mk.m <= NEAR_M && m > mk.m + PAST_M) {
              const t = scoreCorner(rows, k, mk.i);
              cur.skipped += k - cur.next;                      // corners before it that were never reached
              if (t) { cur.live.push(t); cur.best.push(cur.ref.corners[k].t); } else cur.skipped++;
              cur.next = k + 1;
              break;
            }
            if (k > cur.next + 2) break;                        // look a few corners ahead, not the whole stage
          }
          const me = metres(p, cur.ref.end);
          if (me < cur.endMin.m) cur.endMin = { m: me, i };
          const off = (i - cur.entry) * 5 > 1.5 * cur.ref.length_m + 200;
          if ((cur.endMin.m <= NEAR_M && me > cur.endMin.m + PAST_M) || off) {
            const out = view('done'); cur = null; scanned = i + 1;
            return out;
          }
        }
        scanned = n;
        return cur ? view('in') : null;
      },
    };
  }

  /** "+12 vs best", "-8 vs best", "level with best", or "--" while nothing compares yet. */
  function label(delta) {
    if (!finite(delta)) return '--';
    if (delta === 0) return 'level with best';
    return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs best`;
  }

  const api = { reference, best, createTracker, label, NEAR_M, ENTRY_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexStageDelta = api;
})(typeof window !== 'undefined' ? window : globalThis);
