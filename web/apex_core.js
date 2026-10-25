// ApexCore — browser port of the geometry / pace-note / braking-envelope half of
// core/road_dna.py. Held to numerical parity by tests/test_web_core_parity.py:
// change both or neither. SI + radians inside; curvature + = LEFT (ISO 8855).
(function (root) {
  'use strict';

  const G_STD = 9.80665;
  const MPS_TO_MPH = 2.2369362921;
  const SMOOTH_WINDOW = 5;
  const EDGE_TRIM = 2 * Math.floor(SMOOTH_WINDOW / 2);
  const CORNER_KAPPA_MIN = 1 / 300;
  const CORNER_MIN_TURN_RAD = 20 * Math.PI / 180;
  const CORNER_MERGE_GAP = 3;
  const HAIRPIN_TURN_RAD = 135 * Math.PI / 180;
  const HAIRPIN_MAX_RADIUS_M = 30;
  const MIN_RADIUS_M = 8;
  const LONG_TURN_RAD = 100 * Math.PI / 180;
  const SEVERITY_RADIUS_M = [25, 40, 65, 100, 160, 260];
  const MU_EFF_DEFAULT = 0.60;
  const BRAKE_DECEL_MPS2 = 0.5 * G_STD;
  const V_CAP_MPS = 31.3;
  const CAMBER_CLIP_RAD = 0.15;
  const CREST_UNWEIGHT_G = -0.08;
  const ALPR_RADIUS_M = 60;

  function movingAverage(v, window) {
    const n = v.length, half = Math.floor(window / 2);
    const csum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) csum[i + 1] = csum[i] + v[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      out[i] = (csum[hi] - csum[lo]) / (hi - lo);
    }
    return out;
  }

  // numpy.gradient with unit spacing: central inside, one-sided at the ends.
  function gradient(v) {
    const n = v.length, out = new Float64Array(n);
    if (n < 2) return out;
    out[0] = v[1] - v[0];
    out[n - 1] = v[n - 1] - v[n - 2];
    for (let i = 1; i < n - 1; i++) out[i] = (v[i + 1] - v[i - 1]) / 2;
    return out;
  }

  // numpy.unwrap (period 2*pi).
  function unwrap(p) {
    const n = p.length, out = new Float64Array(n);
    if (!n) return out;
    out[0] = p[0];
    let correction = 0;
    for (let i = 1; i < n; i++) {
      const dd = p[i] - p[i - 1];
      let ddmod = ((dd + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      if (ddmod === -Math.PI && dd > 0) ddmod = Math.PI;
      if (Math.abs(dd) >= Math.PI) correction += ddmod - dd;
      out[i] = p[i] + correction;
    }
    return out;
  }

  function localXY(lat, lon) {
    let mean = 0;
    for (const a of lat) mean += a;
    mean /= lat.length;
    const c = Math.cos(mean * Math.PI / 180);
    const x = new Float64Array(lat.length), y = new Float64Array(lat.length);
    for (let i = 0; i < lat.length; i++) {
      x[i] = (lon[i] - lon[0]) * 111320 * c;
      y[i] = (lat[i] - lat[0]) * 110540;
    }
    return { x, y };
  }

  function resamplePolyline(lat, lon, stepM = 5) {
    const { x, y } = localXY(lat, lon);
    const s = [0];
    for (let i = 1; i < x.length; i++) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    const total = s[s.length - 1];
    if (total < stepM) return { lat: Array.from(lat), lon: Array.from(lon) };
    const outLat = [], outLon = [];
    let j = 0;
    for (let d = 0; d <= total + 1e-9; d += stepM) {
      while (j < s.length - 2 && s[j + 1] < d) j++;
      const span = s[j + 1] - s[j];
      const t = span > 0 ? Math.min(1, Math.max(0, (d - s[j]) / span)) : 0;
      outLat.push(lat[j] + (lat[j + 1] - lat[j]) * t);
      outLon.push(lon[j] + (lon[j + 1] - lon[j]) * t);
    }
    return { lat: outLat, lon: outLon };
  }

  function computeCurvature(lat, lon) {
    const n = lat.length;
    if (n < 3) return { kappa: new Float64Array(n), ds: new Float64Array(n).fill(5) };
    const { x, y } = localXY(lat, lon);
    const xs = movingAverage(x, SMOOTH_WINDOW), ys = movingAverage(y, SMOOTH_WINDOW);
    const dx = gradient(xs), dy = gradient(ys);
    const ds = new Float64Array(n), head = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ds[i] = Math.max(Math.hypot(dx[i], dy[i]), 0.5);
      head[i] = Math.atan2(dy[i], dx[i]);
    }
    const dpsi = gradient(unwrap(head));
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) raw[i] = dpsi[i] / ds[i];
    const kappa = movingAverage(raw, SMOOTH_WINDOW);
    // One-sided differences at the path ends amplify GPS noise into phantom corners.
    const edge = Math.min(EDGE_TRIM, Math.floor(n / 2));
    for (let i = 0; i < edge; i++) { kappa[i] = 0; kappa[n - 1 - i] = 0; }
    return { kappa, ds };
  }

  function apexSpeedMps(radiusM, camberRad = 0, mu = MU_EFF_DEFAULT) {
    const phi = Math.max(-CAMBER_CLIP_RAD, Math.min(CAMBER_CLIP_RAD, camberRad));
    return Math.sqrt(Math.max(0, radiusM * G_STD * (mu + Math.tan(phi))));
  }

  function effectiveMu(roughG, mu = MU_EFF_DEFAULT) {
    if (roughG == null) return mu;
    return mu * (1 - Math.max(0, Math.min(0.30, (roughG - 0.08) / 0.30)));
  }

  function brakingEnvelopeMps(kappa, ds, camberRad = null, roughG = null, mu = MU_EFF_DEFAULT) {
    const n = kappa.length, v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = 1 / Math.max(Math.abs(kappa[i]), 1e-6);
      const m = effectiveMu(roughG ? roughG[i] : null, mu);
      v[i] = Math.min(apexSpeedMps(r, camberRad ? camberRad[i] : 0, m), V_CAP_MPS);
    }
    for (let i = n - 2; i >= 0; i--) {
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * BRAKE_DECEL_MPS2 * ds[i]));
    }
    return v;
  }

  function severityForRadius(r) {
    for (let i = 0; i < SEVERITY_RADIUS_M.length; i++) if (r < SEVERITY_RADIUS_M[i]) return i + 1;
    return null;
  }

  function maxAbs(k, a, b) {
    let m = 0;
    for (let i = a; i <= b; i++) m = Math.max(m, Math.abs(k[i]));
    return m;
  }

  function detectCorners(kappa, ds, camberRad = null, crestG = null, roughG = null, mu = MU_EFF_DEFAULT) {
    const n = kappa.length;
    const sign = new Int8Array(n);
    for (let i = 0; i < n; i++) sign[i] = kappa[i] > CORNER_KAPPA_MIN ? 1 : (kappa[i] < -CORNER_KAPPA_MIN ? -1 : 0);

    const runs = [];
    let i = 0;
    while (i < n) {
      if (sign[i] === 0) { i++; continue; }
      let j = i;
      while (j + 1 < n && sign[j + 1] === sign[i]) j++;
      const last = runs[runs.length - 1];
      if (last && last[2] === sign[i] && i - last[1] - 1 <= CORNER_MERGE_GAP) last[1] = j;
      else runs.push([i, j, sign[i]]);
      i = j + 1;
    }

    const corners = [];
    for (const [start, end, sgn] of runs) {
      let turn = 0, apex = start;
      for (let q = start; q <= end; q++) {
        turn += kappa[q] * ds[q];
        if (Math.abs(kappa[q]) > Math.abs(kappa[apex])) apex = q;
      }
      if (Math.abs(turn) < CORNER_MIN_TURN_RAD) continue;
      // Mean |kappa| over +-2 samples: accurate on clean paths and errs tight (slower,
      // safer) under GPS noise, unlike the raw peak or an arc/turn ratio.
      const lo = Math.max(start, apex - 2), hi = Math.min(end, apex + 2);
      let kSum = 0;
      for (let q = lo; q <= hi; q++) kSum += Math.abs(kappa[q]);
      const radius = 1 / Math.max(kSum / (hi - lo + 1), 1e-6);
      if (radius < MIN_RADIUS_M) continue;
      const hairpin = Math.abs(turn) >= HAIRPIN_TURN_RAD && radius < HAIRPIN_MAX_RADIUS_M;
      const sev = hairpin ? 'HP' : severityForRadius(radius);
      if (sev === null) continue;

      const mods = [];
      const mid = Math.floor((start + end) / 2);
      if (end - start >= 4) {
        const r1 = 1 / Math.max(maxAbs(kappa, start, mid), 1e-6);
        const r2 = 1 / Math.max(maxAbs(kappa, mid, end), 1e-6);
        if (r2 < 0.7 * r1) mods.push('tightens');
        else if (r1 < 0.7 * r2) mods.push('opens');
      }
      if (!hairpin && Math.abs(turn) >= LONG_TURN_RAD) mods.push('long');

      let phi = 0;
      if (camberRad) {
        phi = camberRad[apex];
        if (phi > 2 * Math.PI / 180) mods.push('banked');
        else if (phi < -2 * Math.PI / 180) mods.push('off-camber');
      }
      if (crestG) {
        let mn = Infinity;
        for (let q = start; q <= end; q++) mn = Math.min(mn, crestG[q]);
        if (mn < CREST_UNWEIGHT_G) mods.push('over crest');
      }
      const m = effectiveMu(roughG ? roughG[apex] : null, mu);
      corners.push({
        start, apex, end,
        dir: sgn > 0 ? 'L' : 'R',
        severity: sev,
        turn_rad: turn,
        radius_m: radius,
        apex_mps: apexSpeedMps(radius, phi, m),
        mods
      });
    }
    return corners;
  }

  function paceNoteText(c) {
    const word = c.dir === 'L' ? 'Left' : 'Right';
    const code = `${c.dir}${c.severity}`;
    let call = c.severity === 'HP' ? `${word} hairpin` : `${word} ${c.severity}`;
    if (c.mods.length) call += ' ' + c.mods.join(', ');
    return { code, call };
  }

  // Index of the nearest path sample to (lat, lon), searching around a hint index.
  function nearestIndex(lat, lon, pathLat, pathLon, hint = 0, window = 400) {
    const c = Math.cos(lat * Math.PI / 180);
    let best = -1, bestD = Infinity;
    const lo = hint >= 0 ? Math.max(0, hint - window) : 0;
    const hi = hint >= 0 ? Math.min(pathLat.length, hint + window) : pathLat.length;
    for (let i = lo; i < hi; i++) {
      const dx = (pathLon[i] - lon) * 111320 * c, dy = (pathLat[i] - lat) * 110540;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, distM: Math.sqrt(bestD) };
  }

  const api = {
    G_STD, MPS_TO_MPH, ALPR_RADIUS_M,
    movingAverage, gradient, unwrap, localXY, resamplePolyline,
    computeCurvature, apexSpeedMps, effectiveMu, brakingEnvelopeMps,
    severityForRadius, detectCorners, paceNoteText, nearestIndex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
