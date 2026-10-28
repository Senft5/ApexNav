// Measured road feel and confirmed hazards in stage discovery (IDEAS R-04). Discovery (stages.js) scores roads from the map's
// geometry; before routes, loops and Explore pick which stages to time, this lays members' measurements over them: a stage
// the crowd found broken drops down the list, a smooth or banked one moves up, and one with a confirmed hazard on it loses
// points (a reported closure takes it out). Only roads two or more members measured exist here (/api/coverage); a stage
// nobody measured keeps its map score exactly. Pure (tests/test_measured_stages.py); index.html fetches.
(function (root) {
  'use strict';
  const NEAR_M = 15, STEP = 4, MIN_SHARE = 0.25;                 // a stage point counts as measured within 15 m of a measured road
  const SMOOTH_G = 0.08, ROUGH_G = 0.30;                         // as contributor.js
  const ROUGH_MAX = 6, SMOOTH_MAX = 2, BANK_MAX = 1, HAZARD_PTS = 3, HAZARD_MAX = 6, HAZARD_NEAR_M = 30;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const M_LAT = 110540;
  const mLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const known = (pair) => (pair || []).filter(finite);

  /** Distance (m) from a point to a polyline [[lat, lon], ...], flat-earth around the point. */
  function toLine(lat, lon, line) {
    const k = mLon(lat);
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = (line[i][1] - lon) * k, ay = (line[i][0] - lat) * M_LAT, bx = (line[i + 1][1] - lon) * k, by = (line[i + 1][0] - lat) * M_LAT;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? clamp01(-(ax * dx + ay * dy) / L2) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }
  const boxOf = (line) => {
    const la = line.map((p) => p[0]), lo = line.map((p) => p[1]);
    return [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)];
  };

  /**
   * What members measured along one stage: { share (of its points on a measured road), rough (g), banked, offCamber } or null
   * when under MIN_SHARE of it is measured. ways: the /api/coverage `ways` (both directions averaged: a stage has no direction yet).
   */
  function measuredOn(stage, ways) {
    if (!stage || !Array.isArray(stage.lat) || stage.lat.length < 2 || !ways || !ways.length) return null;
    const pad = NEAR_M / M_LAT * 2;
    const cand = ways.filter((w) => Array.isArray(w.line) && w.line.length >= 2).map((w) => ({ w, b: w.box || boxOf(w.line) }));
    let pts = 0, hit = 0;
    const rough = [], banked = [], off = [];
    for (let i = 0; i < stage.lat.length; i += STEP) {
      const la = stage.lat[i], lo = stage.lon[i];
      pts++;
      let best = null, bestD = NEAR_M;
      for (const c of cand) {
        const dLon = pad * M_LAT / mLon(la);
        if (la < c.b[0] - pad || la > c.b[2] + pad || lo < c.b[1] - dLon || lo > c.b[3] + dLon) continue;
        const d = toLine(la, lo, c.w.line);
        if (d <= bestD) { bestD = d; best = c.w; }
      }
      if (!best) continue;
      hit++;
      const r = known(best.rough), b = known(best.banked), o = known(best.offCamber);
      if (r.length) rough.push(mean(r));
      if (b.length) banked.push(mean(b));
      if (o.length) off.push(mean(o));
    }
    const share = pts ? hit / pts : 0;
    if (share < MIN_SHARE) return null;
    return { share: Math.round(share * 100) / 100, rough: rough.length ? mean(rough) : null,
             banked: banked.length ? mean(banked) : null, offCamber: off.length ? mean(off) : null };
  }

  /** The score change for a stage's measurements, in stages.js points (good-corner equivalents). 0 for null. */
  function adjustFor(m, score) {
    if (!m) return 0;
    const w = clamp01(m.share * 1.5);
    let adj = 0;
    if (finite(m.rough)) {
      adj -= Math.min(ROUGH_MAX, Math.max(0, score) * 0.5) * w * clamp01((m.rough - SMOOTH_G) / (ROUGH_G - SMOOTH_G));
      adj += SMOOTH_MAX * w * clamp01((SMOOTH_G - m.rough) / 0.03);
    }
    if (finite(m.banked)) adj += BANK_MAX * w * clamp01(m.banked / 0.3);
    if (finite(m.offCamber)) adj -= BANK_MAX * w * clamp01(m.offCamber / 0.3);   // off-camber is a hazard, never a bonus
    return Math.round(adj * 100) / 100;
  }

  /** Confirmed hazards on a stage: { closure, kinds[] }. Confirmed = two or more "still there" and not outvoted. */
  function hazardsOn(stage, hazards) {
    const out = { closure: false, kinds: [] };
    for (const h of hazards || []) {
      if (!h || !finite(h.lat) || !finite(h.lon)) continue;
      const closure = h.kind === 'closure';
      if (!closure && !((h.confirms || 0) >= 2 && (h.clears || 0) < (h.confirms || 0))) continue;
      let d = Infinity;
      for (let i = 0; i < stage.lat.length && d > HAZARD_NEAR_M; i += 2) d = Math.min(d, Math.hypot((stage.lat[i] - h.lat) * M_LAT, (stage.lon[i] - h.lon) * mLon(h.lat)));
      if (d > HAZARD_NEAR_M) continue;
      if (closure) out.closure = true; else out.kinds.push(h.kind);
    }
    return out;
  }

  /**
   * Stages re-scored by measurements and hazards, best first. Each touched stage gets `measured` ({share, rough, banked,
   * offCamber}), `measuredAdj` and/or `hazards` (kinds). A stage with a reported closure on it is left out. Pure: new objects.
   */
  function rescore(stages, ways, hazards) {
    const cached = (ways || []).map((w) => (Array.isArray(w.line) && w.line.length >= 2 ? { ...w, box: boxOf(w.line) } : w));
    const out = [];
    for (const s of stages || []) {
      const m = measuredOn(s, cached), hz = hazardsOn(s, hazards);
      if (hz.closure) continue;
      const adj = adjustFor(m, s.score), hzPts = Math.min(HAZARD_MAX, HAZARD_PTS * hz.kinds.length);
      if (!m && !hzPts) { out.push(s); continue; }
      out.push({ ...s, score: s.score + adj - hzPts, ...(m ? { measured: m, measuredAdj: adj } : {}), ...(hz.kinds.length ? { hazards: hz.kinds } : {}) });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** The /api/coverage boxes (at most 0.5 deg a side, the server's limit) that cover a discovery circle; at most 9. */
  function boxesFor(c, radiusKm) {
    const dLat = radiusKm / 110.54, dLon = radiusKm / (111.32 * Math.max(0.2, Math.cos(c.lat * Math.PI / 180)));
    const s = c.lat - dLat, n = c.lat + dLat, w = c.lon - dLon, e = c.lon + dLon, STEP_DEG = 0.4999;
    const rows = Math.ceil((n - s) / STEP_DEG), cols = Math.ceil((e - w) / STEP_DEG);
    if (rows * cols > 9) return null;                                      // too big an area to ask about: unmeasured, like offline
    const r = (x) => Math.round(x * 1e4) / 1e4, out = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const bs = s + i * (n - s) / rows, bw = w + j * (e - w) / cols;
      out.push([r(bs), r(bw), r(bs + (n - s) / rows), r(bw + (e - w) / cols)]);
    }
    return out;
  }

  const api = { measuredOn, adjustFor, hazardsOn, rescore, boxesFor, toLine, NEAR_M, MIN_SHARE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMeasuredStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
