// ApexRoughness — the one scale for how rough a road's pavement is, wherever the app says it (the map's measured roads,
// the route card's Surface and rough km, the story's "smooth" / "rough", the Rough road call, the ranking of routes).
//
// Roughness is what the phone measures: the RMS of its vertical acceleration above 8 Hz over each 5 m (core/live_pipeline.py),
// in g. A phone in a cradle feels far less than the body of the car, so the scale is read from what phones measured, not
// from a textbook: on the 24,885 road bins in production on 2026-11-15 (7,264 driven twice or more) the median was
// 0.04 g, a quarter read 0.034 g or under and one in ten 0.068 g or over; the highest bin mean was 0.19 g. The old cut points
// (0.22 g and 0.30 g rough, 0.08 g and 0.10 g smooth) were above almost every road measured, so nothing was ever rough and
// every road was "smooth". tools/rough_scale.py recomputes the cut points from the bins and fits them to roads known to be
// smooth or broken (FIT below), so they move together, in one place.
(function (root) {
  'use strict';

  // smooth at or under SMOOTH_G (the smoothest quarter), rough at or over ROUGH_G (the roughest tenth), and VERY_ROUGH_G the
  // roughest one in a hundred: where the Surface number reaches 0 and a route is marked down in full.
  const SMOOTH_G = 0.034, ROUGH_G = 0.068, VERY_ROUGH_G = 0.11;
  const FIT = { from: 'percentiles of production road_bins, 2026-11-15 (p25, p90, p99 of bins with 2+ passes)', truth: null };

  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  /** 'smooth', 'fair' or 'rough' for a roughness in g; null when unknown. */
  function level(g) {
    if (!fin(g) || g < 0) return null;
    return g <= SMOOTH_G ? 'smooth' : g >= ROUGH_G ? 'rough' : 'fair';
  }
  /** How bad, 0 (smooth or better) to 1 (very rough or worse): what a ranking marks a road down by. null when unknown. */
  function badness(g) {
    if (!fin(g) || g < 0) return null;
    return Math.max(0, Math.min(1, (g - SMOOTH_G) / (VERY_ROUGH_G - SMOOTH_G)));
  }
  /** How much smoother than the smooth line, 0 to 1 over the smoothest stretch below it: what a ranking adds for glass. */
  function glass(g) {
    if (!fin(g) || g < 0) return null;
    return Math.max(0, Math.min(1, (SMOOTH_G - g) / (SMOOTH_G / 2)));
  }
  /** Surface 0 to 100 (100 = glass): 100 at the smooth line or under, 0 at very rough. null when unknown. */
  const surface = (g) => { const b = badness(g); return b === null ? null : Math.round(100 * (1 - b)); };

  const api = { SMOOTH_G, ROUGH_G, VERY_ROUGH_G, FIT, level, badness, glass, surface };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoughness = api;
})(typeof window !== 'undefined' ? window : globalThis);
