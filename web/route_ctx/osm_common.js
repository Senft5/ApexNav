// Shared geometry for the OpenStreetMap route-context providers (osm_tiles.js, osm_overpass.js, road_name_age.js):
// a corridor's samples in local metres, a grid index over them, "which sample is this feature beside, how far, how
// parallel", and per-km densities over a sliding window. Pure; no network. Tests: tests/test_route_ctx_osm_tiles.py.
//
// Also the registry shim: builder A's web/route_ctx/registry.js owns ApexRouteCtx. Until it loads (or in a unit test
// that doesn't load it) `register` keeps providers in `ApexRouteCtx.providers`, which the registry adopts.
(function (root) {
  'use strict';
  const Ctx = root.ApexRouteCtx = root.ApexRouteCtx || {
    providers: [],
    register(p) { this.providers.push(p); return p; },
  };
  void Ctx;
  const D2R = Math.PI / 180;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Local equirectangular projection around lat0 (metres); good to < 0.5 % over a 300 km plan. */
  function projector(lat0, lon0) {
    const kx = 111320 * Math.cos(lat0 * D2R), ky = 110540;
    return { kx, ky, x: (lon) => (lon - lon0) * kx, y: (lat) => (lat - lat0) * ky, lon: (x) => lon0 + x / kx, lat: (y) => lat0 + y / ky };
  }

  /**
   * A corridor's samples projected, with a grid index. `c` = { lat, lon, distM } (typed arrays or arrays).
   * Each sample's direction comes from its neighbours (radians, east = 0, north = pi/2), so a caller's heading convention
   * doesn't matter.
   */
  function sampleIndex(c, cellM = 100, P = null) {
    const n = c.lat.length;
    if (!P) {
      let la = 0, lo = 0, k = 0;
      for (let i = 0; i < n; i++) if (finite(c.lat[i]) && finite(c.lon[i])) { la += c.lat[i]; lo += c.lon[i]; k++; }
      P = projector(k ? la / k : 0, k ? lo / k : 0);
    }
    const x = new Float64Array(n), y = new Float64Array(n), dir = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = P.x(c.lon[i]); y[i] = P.y(c.lat[i]); }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      dir[i] = Math.atan2(y[b] - y[a], x[b] - x[a]);
    }
    const grid = new Map();
    const key = (gx, gy) => gx * 1e6 + gy;
    for (let i = 0; i < n; i++) {
      if (!finite(x[i]) || !finite(y[i])) continue;
      const k = key(Math.floor(x[i] / cellM), Math.floor(y[i] / cellM));
      let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i);
    }
    /** Sample indices within r metres of (px, py) (exact distance check). */
    function near(px, py, r) {
      const out = [];
      const g0 = Math.floor((px - r) / cellM), g1 = Math.floor((px + r) / cellM), h0 = Math.floor((py - r) / cellM), h1 = Math.floor((py + r) / cellM);
      for (let gx = g0; gx <= g1; gx++) for (let gy = h0; gy <= h1; gy++) {
        const l = grid.get(key(gx, gy)); if (!l) continue;
        for (const i of l) { const dx = x[i] - px, dy = y[i] - py; if (dx * dx + dy * dy <= r * r) out.push(i); }
      }
      return out;
    }
    /**
     * The route's closest approach to (px, py) within r: { i (nearest sample), d (metres to the route's line), atM }.
     * Uses the segments between samples, so a point between two samples 25 m apart still measures true.
     */
    function nearest(px, py, r) {
      let best = null;
      for (const i of near(px, py, r + 30)) {
        for (const j of [i - 1, i]) {
          if (j < 0 || j + 1 >= n) continue;
          const ax = x[j], ay = y[j], bx = x[j + 1], by = y[j + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
          const qx = ax + t * vx - px, qy = ay + t * vy - py, d = Math.sqrt(qx * qx + qy * qy);
          if (d <= r && (!best || d < best.d)) {
            const atM = c.distM[j] + t * (c.distM[j + 1] - c.distM[j]);
            best = { i: t < 0.5 ? j : j + 1, d, atM };
          }
        }
      }
      return best;
    }
    return { n, x, y, dir, P, near, nearest, cellM };
  }

  /** Smallest angle between two undirected lines (radians, 0..pi/2). */
  function lineAngle(a, b) {
    let d = Math.abs(a - b) % Math.PI;
    return d > Math.PI / 2 ? Math.PI - d : d;
  }

  /**
   * Walk a line ([[lon, lat], ...]) in steps of at most `stepM`, calling fn(px, py, segDir) at each step point
   * (projected with the index's projector). The step bounds how far a sample can be from a tested point.
   */
  function walkLine(idx, line, stepM, fn) {
    const P = idx.P;
    for (let k = 0; k + 1 < line.length; k++) {
      const ax = P.x(line[k][0]), ay = P.y(line[k][1]), bx = P.x(line[k + 1][0]), by = P.y(line[k + 1][1]);
      const L = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(L / stepM)), dir = Math.atan2(by - ay, bx - ax);
      for (let s = 0; s <= steps; s++) { if (s === steps && k + 2 < line.length) continue; fn(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps, dir); }
    }
  }

  /**
   * Per-km density at each sample from per-sample counts: the count over a window of `windowM` centred on the sample
   * (clipped at the route's ends) over the known length in it. NaN where under half the window is known
   * (`known[i]` false) — unknown never reads as "none".
   */
  function perKm(counts, distM, known, windowM = 500) {
    const n = counts.length, out = new Float32Array(n).fill(NaN);
    let a = 0, b = 0, sum = 0, knownLen = 0;
    const len = (i) => (i + 1 < n ? distM[i + 1] - distM[i] : i > 0 ? distM[i] - distM[i - 1] : 0);
    for (let i = 0; i < n; i++) {
      const lo = distM[i] - windowM / 2, hi = distM[i] + windowM / 2;
      while (b < n && distM[b] <= hi) { if (known[b]) { sum += counts[b]; knownLen += len(b); } b++; }
      while (a < b && distM[a] < lo) { if (known[a]) { sum -= counts[a]; knownLen -= len(a); } a++; }
      const span = Math.min(hi, distM[n - 1]) - Math.max(lo, distM[0]);
      if (known[i] && knownLen > 0 && knownLen >= 0.5 * Math.max(span, 1)) out[i] = Math.max(0, sum) / (knownLen / 1000);
    }
    return out;
  }

  /** Runs of a per-sample predicate as spans [{ fromM, toM }] (each run covers its samples' half-gaps). */
  function runs(distM, pred, minM = 0) {
    const out = [], n = distM.length;
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && pred(i);
      if (on && s < 0) s = i;
      if (!on && s >= 0) {
        const fromM = distM[s], toM = distM[i - 1];
        if (toM - fromM >= minM) out.push({ fromM, toM, from: s, to: i - 1 });
        s = -1;
      }
    }
    return out;
  }

  /** The cell keys of a corridor's samples at `deg` resolution, for "which tiles does this touch" and coverage. */
  function cellsOf(lat, lon, deg, padM = 0) {
    const out = new Set();
    for (let i = 0; i < lat.length; i++) {
      if (!finite(lat[i]) || !finite(lon[i])) continue;
      const dLat = padM / 110540, dLon = padM / (111320 * Math.cos(lat[i] * D2R));
      for (const a of padM ? [-dLat, 0, dLat] : [0]) for (const b of padM ? [-dLon, 0, dLon] : [0]) out.add(`${Math.floor((lat[i] + a) / deg)}_${Math.floor((lon[i] + b) / deg)}`);
    }
    return out;
  }

  /** An empty per-corridor result: every channel NaN (unknown). */
  function emptyResult(n, channels, status, note) {
    const ch = {};
    for (const k of channels) ch[k] = new Float32Array(n).fill(NaN);
    return { status, note, channels: ch, spans: [], points: [] };
  }

  /** A promise that rejects when `signal` aborts or `ms` passes (whichever first); `.cancel()` clears the timer. */
  function deadline(ms, signal) {
    let t = null, off = null;
    const p = new Promise((_, no) => {
      if (finite(ms) && ms > 0) t = setTimeout(() => no(new Error('budget')), ms);
      if (signal) { if (signal.aborted) no(new Error('aborted')); else { off = () => no(new Error('aborted')); signal.addEventListener('abort', off, { once: true }); } }
    });
    p.catch(() => {});
    p.cancel = () => { clearTimeout(t); if (signal && off) signal.removeEventListener('abort', off); };
    return p;
  }

  const api = { projector, sampleIndex, lineAngle, walkLine, perKm, runs, cellsOf, emptyResult, deadline, finite };
  root.ApexOsmCommon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
