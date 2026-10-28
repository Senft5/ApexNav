// Your taste in roads (IDEAS R-33): each "Which road was better?" answer (road_votes.js) is kept with both roads' TECH,
// FLOW (the reference lap, apex_core) and how smooth the surface felt (the phone's own roughness), and a small logistic
// fit learns how much each matters to you. Planned fun routes then lean toward your taste, by at most TASTE_GAIN fun points.
// Kept on this phone (apex.taste); a crowd-wide fit needs the server and isn't here. Pure (tests/test_taste.py).
(function (root) {
  'use strict';
  const KEY = 'apex.taste', MIN_VOTES = 5, MAX_PAIRS = 200, TASTE_GAIN = 8, AXES = ['tech', 'flow', 'smooth'];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** { tech, flow, smooth } (0-100; smooth null when the phone measured no roughness) for a drive or a route (5 m samples). */
  function featuresOf(Core, d, opts = {}) {
    if (!d || !Array.isArray(d.lat) || d.lat.length < 40) return null;
    const { kappa, ds } = Core.computeCurvature(d.lat, d.lon);
    // opts.quick (ranking several long candidates on the phone): open sight everywhere; it only moves TECH's blind share
    const sight = opts.quick ? new Float64Array(d.lat.length).fill(Core.SIGHT_MAX_M) : Core.sightDistanceM(d.lat, d.lon);
    const corners = Core.detectCorners(kappa, ds);
    const lap = Core.referenceLap(kappa, ds, { sightM: sight });
    const ax = Core.axisScores(Core.windowFeatures(lap, corners, sight, 0, d.lat.length));
    const r = Array.isArray(d.rough) ? d.rough.filter(finite) : [];
    const smooth = r.length >= 20 ? Math.round(100 * (1 - Math.max(0, Math.min(1, (r.reduce((s, x) => s + x, 0) / r.length - 0.08) / 0.30)))) : null;
    return { tech: ax.tech, flow: ax.flow, smooth };
  }

  function load(storage) { try { const v = JSON.parse(storage.getItem(KEY) || 'null'); if (v && Array.isArray(v.pairs)) return v; } catch (_) {} return { pairs: [] }; }
  function save(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

  /** The answer "w beat l" with both roads' features; unknown features (null) count as no difference on that axis. */
  function record(state, w, l) {
    if (!w || !l) return state;
    const x = AXES.map((k) => (finite(w[k]) && finite(l[k]) ? (w[k] - l[k]) / 100 : 0));
    return { pairs: [...state.pairs, x].slice(-MAX_PAIRS) };
  }

  /**
   * Weights per axis from the answers: logistic regression P(win) = 1/(1+e^(-w·x)) with a pull toward equal weights
   * (so a few answers can't swing it far), by gradient steps. Null under MIN_VOTES answers.
   */
  function fit(state) {
    const P = (state && state.pairs) || [];
    if (P.length < MIN_VOTES) return null;
    const prior = [1, 1, 1], lambda = 0.5, w = prior.slice();
    for (let it = 0; it < 400; it++) {
      const g = w.map((wk, k) => -lambda * (wk - prior[k]));
      for (const x of P) {
        const z = w.reduce((s, wk, k) => s + wk * x[k], 0), p = 1 / (1 + Math.exp(-z * 4));
        for (let k = 0; k < 3; k++) g[k] += (1 - p) * x[k] * 4;
      }
      for (let k = 0; k < 3; k++) w[k] += 0.05 * g[k] / Math.max(1, P.length / 10);
    }
    const pos = w.map((x) => Math.max(0, x)), sum = pos.reduce((a, b) => a + b, 0) || 1;
    return { tech: Math.round(100 * pos[0] / sum) / 100, flow: Math.round(100 * pos[1] / sum) / 100, smooth: Math.round(100 * pos[2] / sum) / 100, votes: P.length };
  }

  /** "You lean toward flow (52%), then technical (31%), then smooth surfaces (17%)." */
  function describe(t) {
    if (!t) return '';
    const word = { tech: 'technical roads', flow: 'flowing roads', smooth: 'smooth surfaces' };
    const order = AXES.slice().sort((a, b) => t[b] - t[a]);
    return `From ${t.votes} answers you lean toward ${word[order[0]]} (${Math.round(t[order[0]] * 100)}%), then ${word[order[1]]} (${Math.round(t[order[1]] * 100)}%), then ${word[order[2]]} (${Math.round(t[order[2]] * 100)}%).`;
  }

  /**
   * Fun points for a candidate route with features f: how much more it suits you than an even taste would say: the
   * taste-weighted mean of its axes against their plain mean, 50 points apart = TASTE_GAIN, capped at ±TASTE_GAIN.
   */
  function bonus(t, f) {
    if (!t || !f) return 0;
    const ks = AXES.filter((k) => finite(f[k]));
    const wsum = ks.reduce((s, k) => s + t[k], 0);
    if (!ks.length || !(wsum > 0)) return 0;
    const mine = ks.reduce((s, k) => s + t[k] * f[k], 0) / wsum, even = ks.reduce((s, k) => s + f[k], 0) / ks.length;
    return Math.round(10 * Math.max(-TASTE_GAIN, Math.min(TASTE_GAIN, TASTE_GAIN * (mine - even) / 50))) / 10;
  }

  const api = { KEY, MIN_VOTES, TASTE_GAIN, AXES, featuresOf, load, save, record, fit, describe, bonus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTaste = api;
})(typeof window !== 'undefined' ? window : globalThis);
