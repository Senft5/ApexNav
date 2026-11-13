// One corner, two passes (the corner overlay): this drive's pass and your best pass from another drive, side by
// side on this drive's road, the way a data logger overlays two laps. Pure: no DOM. For each 5 m bin of this drive from
// before its braking to after the exit, the other pass's nearest bin by position (never by time), so the two traces line up
// where the car was on the road. Speeds and g are the drives' own; a bin with no match within MATCH_M stays null.
(function (root) {
  'use strict';
  const LEAD = 36, TAIL = 12, MATCH_M = 20, SEARCH = 8, MARK_SEARCH = 10;   // bins: 180 m before the apex, 60 m after the exit
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);

  // b's index x placed on a's road (an index of a), or null when it is not within MATCH_M of it
  function onA(Core, a, guess, b, x) {
    if (x === null || x === undefined) return null;
    const [i, d] = Core.nearestIndexWin(b.lat[x], b.lon[x], a.lat, a.lon, Math.max(0, guess), MARK_SEARCH);
    return d <= MATCH_M ? i : null;
  }
  // a pass's marks, as indexes of its own drive: braking onset, slowest point (Core.passMarks), turn-in (Core.turnIn)
  function marks(Core, d, s, e, apex) {
    if (!Core.knownRun(d, s, e, apex)) return { brake: null, slow: null, turn: null, min: null };
    const [brake, slow] = Core.passMarks(d, s, e, apex), turn = Core.turnIn(d, s, e);
    let min = null;
    for (let i = s; i <= e; i++) if (fin(d.speed_mps[i]) && (min === null || d.speed_mps[i] < min)) min = d.speed_mps[i];
    return { brake, slow, turn: turn !== null && turn <= apex ? turn : null, min };
  }

  /**
   * Corner k of drive a against the same corner in drive b. Returns null when b did not drive it (Core.matchWindow) or a's
   * stretch has no speed. Otherwise { x_m: metres from a's apex per bin, a_mps, b_mps, a_g, b_g (longitudinal g, null where
   * unknown), gap_s (b's time against a's, summed from the first bin: above 0, this pass is behind), corner_s (that gap over
   * the corner alone, start to end), a: marks, b: marks } with marks { brake_m, turn_m (m before a's apex), slow_m (m after
   * it, below 0 before), min_mps }, each null when the pass shows none.
   */
  function trace(Core, a, k, b) {
    const c = a && a.corners && a.corners[k];
    if (!c || !b) return null;
    const w = Core.matchWindow(a, c.start, c.end, b, -1);
    if (!w) return null;
    const [bs, be] = w, n = a.speed_mps.length;
    const i0 = Math.max(0, Math.min(c.start, c.apex - LEAD)), i1 = Math.min(n - 1, c.end + TAIL);
    const out = { x_m: [], a_mps: [], b_mps: [], a_g: [], b_g: [], gap_s: [], corner_s: null };
    let hint = Math.max(0, bs - (c.start - i0)), gap = 0, at0 = null, any = false;
    for (let i = i0; i <= i1; i++) {
      const [j, d] = Core.nearestIndexWin(a.lat[i], a.lon[i], b.lat, b.lon, hint, SEARCH);
      const ok = d <= MATCH_M;
      if (ok) hint = j;
      const va = a.speed_mps[i], vb = ok ? b.speed_mps[j] : null;
      out.x_m.push((i - c.apex) * 5);
      out.a_mps.push(fin(va) ? va : null);
      out.b_mps.push(fin(vb) ? vb : null);
      out.a_g.push(a.lon_g && fin(a.lon_g[i]) && (!a.g_known || a.g_known[i]) ? a.lon_g[i] : null);
      out.b_g.push(ok && b.lon_g && fin(b.lon_g[j]) && (!b.g_known || b.g_known[j]) ? b.lon_g[j] : null);
      if (fin(va) && fin(vb)) { gap += 5 / Math.max(va, 0.5) - 5 / Math.max(vb, 0.5); any = true; }
      out.gap_s.push(any ? gap : null);
      if (i === c.start) at0 = any ? gap : 0;
      if (i === c.end && at0 !== null && fin(va) && fin(vb)) out.corner_s = gap - at0;
    }
    if (!out.a_mps.some(fin)) return null;
    const bApex = bs + Math.round((c.apex - c.start) * (be - bs) / Math.max(1, c.end - c.start));
    const ma = marks(Core, a, c.start, c.end, c.apex), mb = marks(Core, b, bs, be, bApex);
    const before = (i) => (i === null ? null : (c.apex - i) * 5), after = (i) => (i === null ? null : (i - c.apex) * 5);
    const place = (x) => onA(Core, a, c.apex - (bApex - x), b, x);
    out.a = { brake_m: before(ma.brake), turn_m: before(ma.turn), slow_m: after(ma.slow), min_mps: ma.min };
    out.b = { brake_m: before(place(mb.brake)), turn_m: before(place(mb.turn)), slow_m: after(place(mb.slow)), min_mps: mb.min };
    return out;
  }

  /**
   * The overlay's words, a labelled row a measure, this pass first then the best pass: "Braking: 85 m before the middle ·
   * best pass 70 m". fmt: { dist(m) -> "85 m", speed(mps) -> "38 mph" }. Rows with neither pass known are left out.
   */
  function rows(t, fmt) {
    if (!t) return [];
    const out = [], m = (x) => fmt.dist(Math.abs(x));
    const where = (x) => (x === null ? '--' : Math.abs(x) < 2.5 ? 'at the middle' : `${m(x)} ${x < 0 ? 'before' : 'after'} the middle`);
    const pair = (label, a, b, say) => { if (a !== null || b !== null) out.push(`${label}: ${a === null ? '--' : say(a)} · best pass ${b === null ? '--' : say(b)}`); };
    pair('Braking', t.a.brake_m, t.b.brake_m, (x) => `${m(x)} before the middle`);
    pair('Turn-in', t.a.turn_m, t.b.turn_m, (x) => `${m(x)} before the middle`);
    const slow = (v, x) => (v === null ? '--' : `${fmt.speed(v)}${x === null ? '' : `, ${where(x)}`}`);
    if (t.a.min_mps !== null || t.b.min_mps !== null) out.push(`Slowest: ${slow(t.a.min_mps, t.a.slow_m)} \u00b7 best pass ${slow(t.b.min_mps, t.b.slow_m)}`);
    if (fin(t.corner_s)) out.push(Math.abs(t.corner_s) < 0.05 ? 'Through the corner: level with the best pass'
      : `Through the corner: ${Math.abs(t.corner_s).toFixed(1)} s ${t.corner_s > 0 ? 'slower' : 'quicker'} than the best pass`);
    return out;
  }

  const api = { trace, rows, LEAD, TAIL, MATCH_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexCornerTrace = api;
})(typeof window !== 'undefined' ? window : globalThis);
