// Live coaching against your best pass, on any road you have driven before (no saved stage needed). Every corner your
// drives scored is remembered with its best pass (the Driver Score's technique: grip use, smoothness, braking). On a live
// drive, each remembered corner you finish is scored the same way and set against that best; a stretch of them gives a
// running delta in points for the phone's bar. The co-driver says little: a corner clearly better than your best, a hint
// when one is clearly rougher (smoothness or braking, never grip use, so never "go faster"), and how a stretch went once
// it is over. Technique, never time or speed: a voice urging more speed on a public road is not coaching (PHILOSOPHY §1).
// Pure (tests/test_pass_coach.py); the cockpit (cockpit.js feedCoach) decides when it may speak and draws the bar.
(function (root) {
  'use strict';
  const SAME_CORNER_M = 30, NEAR_M = 25, PAST_M = 12, SAME_WAY_COS = 0.7, CELL = 0.002;
  const STRETCH_GAP_ROWS = 120;      // 600 m with no remembered corner ends a stretch
  const STRETCH_MIN = 4;             // a stretch of fewer remembered corners is not summed up aloud
  const BEST_BY = 30, ROUGH_BY = 60; // points (of 1000) one corner must beat, or trail, its best by to be said
  const SPOKEN = {
    best: 'Best yet through there.',
    smooth: 'Smoother on your best.',
    brake: 'Brakes were cleaner on your best.',
    stretch_best: 'Best stretch yet.',
    stretch_level: 'Level with your best.',
  };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const xy = (lat0, lon0, lat, lon) => [(lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * 110540];
  const metres = (a, b) => Math.hypot(...xy(a[0], a[1], b[0], b[1]));
  const unit = ([x, y]) => { const n = Math.hypot(x, y); return n > 0 ? [x / n, y / n] : null; };
  const cellKey = (lat, lon) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
  const one = (Core, t) => Core.techniqueScore([t]).score;

  /**
   * Each corner your drives scored, once per spot and direction, with its best pass: [{ id, s, a, e ([lat, lon] where it
   * starts, peaks, ends), hx, hy (its way at the apex), len, apex_mps, t (the best pass's technique), sc (its score),
   * n (passes), driveId, date }]. cornersOf(d) gives a record's scorable corners ({ start, apex, end, apex_mps }).
   * max bounds the work to your newest drives.
   */
  function build(Core, records, cornersOf, { max = 40 } = {}) {
    const recs = (records || []).filter((d) => d && d.lat && d.lat.length > 4 && d.speed_mps && d.lon_g && d.lat_g)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, max);
    const out = [], grid = new Map();
    for (const d of recs) {
      let cs = [];
      try { cs = cornersOf(d) || []; } catch (_) { cs = []; }
      for (const c of cs) {
        const t = Core.cornerTechnique(d.speed_mps, d.lon_g, d.lat_g, c);
        if (!t) continue;
        const sc = one(Core, t), i = c.apex, a = [d.lat[i], d.lon[i]];
        const h = unit(xy(d.lat[Math.max(0, i - 2)], d.lon[Math.max(0, i - 2)], d.lat[Math.min(d.lat.length - 1, i + 2)], d.lon[Math.min(d.lon.length - 1, i + 2)]));
        if (!h || !finite(sc) || !finite(a[0]) || !finite(a[1])) continue;
        const near = [];
        const [cy, cx] = [Math.floor(a[0] / CELL), Math.floor(a[1] / CELL)];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const r of grid.get(`${cy + dy},${cx + dx}`) || []) near.push(r);
        const same = near.find((r) => metres(r.a, a) < SAME_CORNER_M && r.hx * h[0] + r.hy * h[1] > SAME_WAY_COS);
        const ref = { id: `pc:${d.id}:${i}`, s: [d.lat[c.start], d.lon[c.start]], a, e: [d.lat[c.end], d.lon[c.end]], hx: h[0], hy: h[1],
                      len: c.end - c.start, apex_mps: c.apex_mps, t, sc, n: 1, driveId: d.id, date: d.date || null };
        if (same) { const n = same.n + 1; if (sc > same.sc) Object.assign(same, { ...ref, id: same.id }); same.n = n; continue; }
        out.push(ref);
        const k = cellKey(a[0], a[1]);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(ref);
      }
    }
    return out;
  }

  /**
   * Follows the live 5 m rows ({ lat, lon, speed_mps, lat_g, lon_g }) against the remembered corners. update(rows) returns
   * { events, view }: events since the last call, each { kind: 'corner', ref, sc, delta, t, say } or { kind: 'stretch', n,
   * delta, say } (a stretch of remembered corners just ended; say is the line to speak or null, already kept sparse); view { delta, n } while a stretch runs (delta in points, null until a
   * corner scored), else null.
   */
  function createCoach(Core, refs) {
    const grid = new Map();
    for (const r of refs || []) { const k = cellKey(r.e[0], r.e[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r); }
    const watch = new Map();         // ref id -> { ref, m, i } closest approach to its end so far
    const done = new Map();          // ref id -> row it was scored at (not scored twice on one pass)
    let scanned = 0, stretch = null;
    const near = (lat, lon) => {
      const out = [], cy = Math.floor(lat / CELL), cx = Math.floor(lon / CELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const r of grid.get(`${cy + dy},${cx + dx}`) || []) out.push(r);
      return out;
    };
    function scoreCorner(rows, ref, iEnd) {
      const closest = (p, from, to) => { let bi = -1, bm = Infinity; for (let j = from; j <= to; j++) { const m = metres([rows[j].lat, rows[j].lon], p); if (m < bm) { bm = m; bi = j; } } return [bi, bm]; };
      const lo = Math.max(0, iEnd - 3 * ref.len - 20);
      const [iS, mS] = closest(ref.s, lo, iEnd), [iA, mA] = closest(ref.a, Math.max(iS, 0), iEnd);
      if (iS < 0 || mS > NEAR_M || mA > NEAR_M || !(iS < iA && iA <= iEnd)) return null;
      // driven the same way: start, apex and end in order, and the heading at the apex as remembered
      const b = rows[Math.max(iS, iA - 2)], f = rows[Math.min(iEnd, iA + 2)], h = b && f ? unit(xy(b.lat, b.lon, f.lat, f.lon)) : null;
      if (!h || h[0] * ref.hx + h[1] * ref.hy < SAME_WAY_COS) return null;
      const num = (x) => (finite(x) ? x : NaN), v = [], lon = [], lat = [];
      for (let j = iS; j <= iEnd; j++) { v.push(num(rows[j].speed_mps)); lon.push(num(rows[j].lon_g)); lat.push(num(rows[j].lat_g)); }
      return Core.cornerTechnique(v, lon, lat, { start: 0, apex: iA - iS, end: iEnd - iS, apex_mps: ref.apex_mps });
    }
    const delta = (s) => { const a = Core.techniqueScore(s.live).score, b = Core.techniqueScore(s.best).score; return finite(a) && finite(b) ? a - b : null; };
    return {
      update(rows) {
        const events = [];
        for (let i = scanned; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !finite(r.lat) || !finite(r.lon)) continue;
          if (stretch && i - stretch.lastI > STRETCH_GAP_ROWS) {
            if (stretch.live.length >= STRETCH_MIN) { const ev = { kind: 'stretch', n: stretch.live.length, delta: delta(stretch) }; ev.say = line(ev); events.push(ev); }
            stretch = null;
          }
          for (const ref of near(r.lat, r.lon)) {
            if (watch.has(ref.id) || (done.has(ref.id) && i - done.get(ref.id) < 200)) continue;
            if (metres([r.lat, r.lon], ref.e) > 3 * NEAR_M) continue;
            watch.set(ref.id, { ref, m: Infinity, i: -1, from: i });
          }
          for (const [id, w] of watch) {
            const m = metres([r.lat, r.lon], w.ref.e);
            if (m < w.m) { w.m = m; w.i = i; }
            if (w.m <= NEAR_M && m > w.m + PAST_M) {
              watch.delete(id); done.set(id, i);
              const t = scoreCorner(rows, w.ref, w.i), sc = t ? one(Core, t) : null;
              if (!finite(sc)) continue;
              if (!stretch) stretch = { live: [], best: [], lastI: i, said: new Set(), bestAt: -Infinity };
              stretch.live.push(t); stretch.best.push(w.ref.t); stretch.lastI = i;
              const ev = { kind: 'corner', ref: w.ref, t, sc, delta: sc - w.ref.sc };
              // sparse: each hint once a stretch, "best yet" at most every third corner
              let say = line(ev);
              const k = stretch.live.length;
              if (say === SPOKEN.best) { if (k - stretch.bestAt < 3) say = null; else stretch.bestAt = k; }
              else if (say) { if (stretch.said.has(say)) say = null; else stretch.said.add(say); }
              ev.say = say;
              events.push(ev);
            } else if (i - w.from > 60) watch.delete(id);           // went another way
          }
        }
        scanned = rows.length;
        return { events, view: stretch ? { delta: delta(stretch), n: stretch.live.length } : null };
      },
    };
  }

  /**
   * What the co-driver says for one event, or null (most corners say nothing). A corner beaten by BEST_BY says so; one
   * trailing by ROUGH_BY names the part that was cleaner on your best (smoothness or braking only); a stretch that ended
   * says how it went in points.
   */
  function line(ev) {
    if (!ev) return null;
    if (ev.kind === 'stretch') {
      if (!finite(ev.delta)) return null;
      if (ev.delta === 0) return SPOKEN.stretch_level;
      return ev.delta > 0 ? `${SPOKEN.stretch_best} ${ev.delta} up.` : `That stretch: ${-ev.delta} down on your best.`;
    }
    if (ev.kind !== 'corner' || !finite(ev.delta)) return null;
    if (ev.delta >= BEST_BY) return SPOKEN.best;
    if (ev.delta <= -ROUGH_BY && ev.t && ev.ref && ev.ref.t) {
      const dBrake = ev.ref.t.brake - ev.t.brake, dSmooth = ev.ref.t.smooth - ev.t.smooth;
      if (dBrake >= 0.2 && dBrake >= dSmooth) return SPOKEN.brake;
      if (dSmooth >= 0.15) return SPOKEN.smooth;
    }
    return null;
  }

  /** "+12 vs best", "−8 vs best", "level with best", or "--" while nothing compares yet (as the stage bar). */
  function label(d) {
    if (!finite(d)) return '--';
    if (d === 0) return 'level with best';
    return `${d > 0 ? '+' : '−'}${Math.abs(d)} vs best`;
  }

  const api = { build, createCoach, line, label, SPOKEN, BEST_BY, ROUGH_BY, STRETCH_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPassCoach = api;
})(typeof window !== 'undefined' ? window : globalThis);
