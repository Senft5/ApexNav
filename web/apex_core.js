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
  const HAIRPIN_COMPACT = 1.8;
  const SPLIT_RATIO = 0.5;
  const SPLIT_MIN_TURN_RAD = 45 * Math.PI / 180;
  const HAIRPIN_CORE_SHARE = 0.64;
  const SPLIT_CORE_EDGE = 0.7;
  const MIN_RADIUS_M = 8;
  const LONG_TURN_RAD = 100 * Math.PI / 180;
  const LONG_ARC_M = 90, SHORT_ARC_M = 20;
  const ACUTE_TURN_RAD = 105 * Math.PI / 180, ACUTE_MAX_RADIUS_M = 25;
  const SQUARE_TURN_RAD = 75 * Math.PI / 180, SQUARE_MAX_RADIUS_M = 25;
  const GRADE_EDGE = 0.25;
  const CAUTION_WORDS = ['', 'care', 'caution', 'double caution', 'triple caution'];
  const APPROACH_CAP_MPS = 27;
  const LINK_INTO_M = 25, LINK_AND_M = 60, LINK_MAX_M = 500;
  const RALLY_DISTANCES = [30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 250, 300, 350, 400, 450, 500];
  const SEVERITY_RADIUS_M = [25, 40, 65, 100, 160, 260];
  const MU_EFF_DEFAULT = 0.60;
  const BRAKE_DECEL_MPS2 = 0.5 * G_STD;
  const REACTION_S = 1.5;
  const EYE_HEIGHT_M = 1.08;
  const OBJECT_HEIGHT_M = 0.60;
  const SIGHT_OFFSET_M = 4.0;
  const SIGHT_MAX_M = 400.0;
  const CAMBER_CLIP_RAD = 0.15;
  const CREST_UNWEIGHT_G = -0.08;
  const ALPR_RADIUS_M = 60;
  // IMU hazards (core/road_dna.py)
  const SPIKE_PEAK_G = 0.35;
  const SPIKE_CONTRAST = 6.0;
  const SPIKE_BACKGROUND_BINS = 41;
  const ROUGH_RMS_FALLBACK_G = 0.25;
  const DIP_COMPRESS_G = 0.10;
  const HAZARD_MIN_SEPARATION_M = 150.0;

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

  // Unknown camber (null/NaN, e.g. a blank CSV cell) is flat and unknown roughness is full grip, as when the whole column is missing.
  function apexSpeedMps(radiusM, camberRad = 0, mu = MU_EFF_DEFAULT) {
    const phi = Number.isFinite(camberRad) ? Math.max(-CAMBER_CLIP_RAD, Math.min(CAMBER_CLIP_RAD, camberRad)) : 0;
    return Math.sqrt(Math.max(0, radiusM * G_STD * (mu + Math.tan(phi))));
  }

  function effectiveMu(roughG, mu = MU_EFF_DEFAULT) {
    if (roughG == null || !Number.isFinite(roughG)) return mu;
    return mu * (1 - Math.max(0, Math.min(0.30, (roughG - 0.08) / 0.30)));
  }

  // Geometric sight distance ahead of each sample (see core/road_dna.sight_distance_m).
  function sightDistanceM(lat, lon, elevation = null, offsetM = SIGHT_OFFSET_M) {
    const n = lat.length, out = new Float64Array(n).fill(SIGHT_MAX_M);
    if (n < 3) return out;
    const { x, y } = localXY(lat, lon);
    const xs = movingAverage(x, SMOOTH_WINDOW), ys = movingAverage(y, SMOOTH_WINDOW);
    const s = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    let end = 0;
    for (let i = 0; i < n - 2; i++) {
      while (end < n && s[end] <= s[i] + SIGHT_MAX_M) end++;
      const eye = elevation ? elevation[i] + EYE_HEIGHT_M : 0;
      for (let j = i + 2; j < end; j++) {
        const cx = xs[j] - xs[i], cy = ys[j] - ys[i];
        const chord = Math.max(Math.hypot(cx, cy), 1e-6);
        let blocked = false;
        for (let k = i + 1; k < j && !blocked; k++) {
          const off = Math.abs(cx * (ys[k] - ys[i]) - cy * (xs[k] - xs[i])) / chord;
          if (off > offsetM) blocked = true;
          else if (elevation) {
            const line = eye + (elevation[j] + OBJECT_HEIGHT_M - eye) * ((s[k] - s[i]) / (s[j] - s[i]));
            if (elevation[k] > line) blocked = true;
          }
        }
        if (blocked) { out[i] = Math.min(SIGHT_MAX_M, s[j - 1] - s[i]); break; }
      }
    }
    return out;
  }

  function sightSpeedMps(sightM, reactionS = REACTION_S, decel = BRAKE_DECEL_MPS2) {
    return decel * (-reactionS + Math.sqrt(reactionS * reactionS + 2 * sightM / decel));
  }

  function brakingEnvelopeMps(kappa, ds, camberRad = null, roughG = null, mu = MU_EFF_DEFAULT, sightM = null) {
    const n = kappa.length, v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = 1 / Math.max(Math.abs(kappa[i]), 1e-6);
      const m = effectiveMu(roughG ? roughG[i] : null, mu);
      const sight = sightM ? sightM[i] : SIGHT_MAX_M;
      v[i] = Math.min(apexSpeedMps(r, camberRad ? camberRad[i] : 0, m), sightSpeedMps(sight));
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

    // Two same-direction corners close together merge into one run; split at curvature valleys.
    function split(a, b) {
      if (b - a < 6) return [[a, b]];
      let m = a + 2;
      for (let q = a + 2; q < b - 1; q++) if (Math.abs(kappa[q]) < Math.abs(kappa[m])) m = q;
      const left = maxAbs(kappa, a, m), right = maxAbs(kappa, m, b);
      if (Math.abs(kappa[m]) < SPLIT_RATIO * Math.min(left, right)) {
        let lt = 0, rt = 0;
        for (let q = a; q <= m; q++) lt += kappa[q] * ds[q];
        for (let q = m + 1; q <= b; q++) rt += kappa[q] * ds[q];
        if (Math.abs(lt) >= SPLIT_MIN_TURN_RAD && Math.abs(rt) >= SPLIT_MIN_TURN_RAD) return split(a, m).concat(split(m + 1, b));
      }
      // Hairpin-sized turn that isn't one tight arc: split off the tight core.
      let turnAB = 0, ap = a;
      for (let q = a; q <= b; q++) { turnAB += kappa[q] * ds[q]; if (Math.abs(kappa[q]) > Math.abs(kappa[ap])) ap = q; }
      if (Math.abs(turnAB) >= HAIRPIN_TURN_RAD) {
        const peak = Math.abs(kappa[ap]);
        let coreTurn = 0;
        for (let q = a; q <= b; q++) if (Math.abs(kappa[q]) >= 0.5 * peak) coreTurn += kappa[q] * ds[q];
        if (coreTurn / turnAB < HAIRPIN_CORE_SHARE) {
          let lo = ap, hi = ap;
          while (lo > a && Math.abs(kappa[lo - 1]) >= SPLIT_CORE_EDGE * peak) lo--;
          while (hi < b && Math.abs(kappa[hi + 1]) >= SPLIT_CORE_EDGE * peak) hi++;
          let before = 0, after = 0;
          for (let q = a; q < lo; q++) before += kappa[q] * ds[q];
          for (let q = hi + 1; q <= b; q++) after += kappa[q] * ds[q];
          if (Math.abs(after) >= Math.abs(before) && Math.abs(after) >= SPLIT_MIN_TURN_RAD) return split(a, hi).concat(split(hi + 1, b));
          if (Math.abs(before) >= SPLIT_MIN_TURN_RAD) return split(a, lo - 1).concat(split(lo, b));
        }
      }
      return [[a, b]];
    }
    const pieces = [];
    for (const [a, b, sgn] of runs) for (const [a2, b2] of split(a, b)) pieces.push([a2, b2, sgn]);

    const corners = [];
    for (const [start, end, sgn] of pieces) {
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
      // Compactness on the arc's core (|kappa| >= half the apex), not the smoothed tails.
      let coreArc = 0;
      for (let q = start; q <= end; q++) if (Math.abs(kappa[q]) >= 0.5 * Math.abs(kappa[apex])) coreArc += ds[q];
      const hairpin = Math.abs(turn) >= HAIRPIN_TURN_RAD && radius < HAIRPIN_MAX_RADIUS_M && coreArc <= HAIRPIN_COMPACT * Math.abs(turn) * radius;
      const sev = hairpin ? 'HP' : severityForRadius(radius);
      if (sev === null) continue;

      // McRae shapes beyond the 1-6 scale, then +/- within a band.
      let arc = 0;
      for (let q = start; q <= end; q++) arc += ds[q];
      let shape = null;
      if (hairpin) shape = 'hairpin';
      else if (radius < ACUTE_MAX_RADIUS_M && Math.abs(turn) >= ACUTE_TURN_RAD) shape = 'acute';
      else if (radius < SQUARE_MAX_RADIUS_M && Math.abs(turn) >= SQUARE_TURN_RAD) shape = 'square';
      let grade = '';
      if (shape === null) {
        const loB = sev === 1 ? MIN_RADIUS_M : SEVERITY_RADIUS_M[sev - 2];
        const frac = (radius - loB) / (SEVERITY_RADIUS_M[sev - 1] - loB);
        grade = frac < GRADE_EDGE ? '-' : (frac > 1 - GRADE_EDGE ? '+' : '');
      }

      const mods = [];
      if (!hairpin && (Math.abs(turn) >= LONG_TURN_RAD || arc >= LONG_ARC_M)) mods.push('long');
      else if (shape === null && arc < SHORT_ARC_M) mods.push('short');
      const mid = Math.floor((start + end) / 2);
      if (end - start >= 4) {
        const r1 = 1 / Math.max(maxAbs(kappa, start, mid), 1e-6);
        const r2 = 1 / Math.max(maxAbs(kappa, mid, end), 1e-6);
        if (r2 < 0.7 * r1) mods.push('tightens');
        else if (r1 < 0.7 * r2) mods.push('opens');
      }

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
        grade, shape, arc_m: arc,
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
    let code, call;
    if (c.severity === 'HP' || c.shape === 'hairpin') { code = `${c.dir}HP`; call = `${word} hairpin`; }
    else if (c.shape === 'square') { code = `${c.dir}SQ`; call = `Square ${word.toLowerCase()}`; }
    else if (c.shape === 'acute') { code = `${c.dir}AC`; call = `Acute ${word.toLowerCase()}`; }
    else {
      const g = c.grade || '';
      code = `${c.dir}${c.severity}${g}`;
      call = `${word} ${c.severity}` + (g === '-' ? ' minus' : g === '+' ? ' plus' : '');
    }
    if (c.mods.length) call += ' ' + c.mods.join(' ');
    if (c.caution) call += ', ' + CAUTION_WORDS[c.caution];
    return { code, call };
  }

  function annotateCautions(corners, env, sight) {
    for (const c of corners) {
      const lo = Math.max(0, c.start - 30);
      let vApp = 0;
      for (let q = lo; q <= c.start; q++) vApp = Math.max(vApp, env[q]);
      vApp = Math.min(vApp, APPROACH_CAP_MPS);
      const ratio = vApp / Math.max(c.apex_mps, 1);
      let score = ratio >= 3 ? 2 : (ratio >= 2 ? 1 : 0);
      const vc = c.apex_mps;
      if (sight[c.start] < 0.5 * (vc * REACTION_S + vc * vc / (2 * BRAKE_DECEL_MPS2))) score += 1;
      for (const m of ['tightens', 'off-camber', 'over crest']) if (c.mods.includes(m)) score += 1;
      c.caution = Math.min(score, 4);
    }
    return corners;
  }

  function rallyDistance(gap) {
    let best = RALLY_DISTANCES[0];
    for (const d of RALLY_DISTANCES) if (Math.abs(d - gap) < Math.abs(best - gap)) best = d;
    return best;
  }

  // Chain notes as a co-driver reads them: "into"/"and" when the next follows at once,
  // otherwise the distance to it. notes sorted by start_m, each with start_m/end_m.
  function linkNotes(notes) {
    notes.forEach((n, i) => {
      n.link = null;
      if (i + 1 === notes.length) return;
      const gap = notes[i + 1].start_m - n.end_m;
      if (gap < LINK_INTO_M) n.link = 'into';
      else if (gap < LINK_AND_M) n.link = 'and';
      else if (gap <= LINK_MAX_M) n.link = String(rallyDistance(gap));
    });
    return notes;
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

  // -------------------------------------------------------------------------
  // Drive analysis — port of core/drive_analysis.py (parity-tested).
  // -------------------------------------------------------------------------
  const MATCH_RADIUS_M = 20, SEARCH_WINDOW = 400, BRAKE_G = -0.15, BRAKE_LOOKBACK = 40, DELTA_STRIDE = 5, STOPPED_MPS = 2.5;

  function elapsedS(v, ds = 5) {
    const t = new Float64Array(v.length);
    for (let i = 1; i < v.length; i++) t[i] = t[i - 1] + ds / Math.max(v[i - 1], 0.5);
    return t;
  }
  function nearestIndexWin(lat, lon, pathLat, pathLon, hint = -1, window = SEARCH_WINDOW) {
    const n = pathLat.length, lo = hint >= 0 ? Math.max(0, hint - window) : 0, hi = hint >= 0 ? Math.min(n, hint + window) : n;
    const c = Math.cos(lat * Math.PI / 180);
    let best = lo, bestD = Infinity;
    for (let i = lo; i < hi; i++) {
      const dx = (pathLon[i] - lon) * 111320 * c, dy = (pathLat[i] - lat) * 110540, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return [best, Math.sqrt(bestD)];
  }
  function cornerMetrics(v, lonG, latG, start, end, apex, apexMps) {
    let iMin = start;
    for (let i = start; i <= end; i++) if (v[i] < v[iMin]) iMin = i;
    let time = 0;
    for (let i = start; i < end; i++) time += 5 / Math.max(v[i], 0.5);
    time += 5 / Math.max(v[end], 0.5);
    const lo = Math.max(0, apex - BRAKE_LOOKBACK);
    let brakeM = null, i = apex;
    while (i > lo && lonG[i] < BRAKE_G) i--;
    if (i < apex) brakeM = (apex - i) * 5;
    else { for (let k = lo; k <= apex; k++) if (lonG[k] < BRAKE_G) { brakeM = (apex - k) * 5; break; } }
    let peakBrake = 0;
    for (let k = lo; k <= apex; k++) peakBrake = Math.min(peakBrake, lonG[k]);
    let peakLat = 0, jerk2 = 0, nj = 0;
    for (let k = start; k <= end; k++) {
      peakLat = Math.max(peakLat, Math.abs(latG[k]));
      if (k < end) { const j = (latG[k + 1] - latG[k]) / (5 / Math.max(v[k], 0.5)); jerk2 += j * j; nj++; }
    }
    return { time_s: time, entry_mps: v[start], min_mps: v[iMin], exit_mps: v[end], min_offset_m: (iMin - apex) * 5,
             brake_m: brakeM, peak_brake_g: peakBrake, peak_lat_g: peakLat, envelope_use: v[iMin] / Math.max(apexMps, 0.5),
             smoothness_gps: Math.sqrt(nj ? jerk2 / nj : 0) };
  }
  function matchWindow(a, start, end, b, hint = -1) {
    let [bs, d1] = nearestIndexWin(a.lat[start], a.lon[start], b.lat, b.lon, hint);
    if (d1 > MATCH_RADIUS_M) { [bs, d1] = nearestIndexWin(a.lat[start], a.lon[start], b.lat, b.lon, -1); if (d1 > MATCH_RADIUS_M) return null; }
    const [be, d2] = nearestIndexWin(a.lat[end], a.lon[end], b.lat, b.lon, bs, 2 * (end - start) + 20);
    if (d2 > MATCH_RADIUS_M || be <= bs) return null;
    const ratio = (be - bs) / Math.max(1, end - start);
    return ratio >= 0.7 && ratio <= 1.3 ? [bs, be] : null;
  }
  function compareDrives(a, b) {
    const corners = [];
    let hint = -1;
    for (const c of a.corners) {
      const ma = cornerMetrics(a.speed_mps, a.lon_g, a.lat_g, c.start, c.end, c.apex, c.apex_mps);
      const w = matchWindow(a, c.start, c.end, b, hint);
      let mb = null;
      if (w) {
        const [bs, be] = w;
        hint = be;
        const bApex = bs + Math.round((c.apex - c.start) * (be - bs) / Math.max(1, c.end - c.start));
        mb = cornerMetrics(b.speed_mps, b.lon_g, b.lat_g, bs, be, bApex, c.apex_mps);
      }
      const stopped = ma.min_mps < STOPPED_MPS || (mb !== null && mb.min_mps < STOPPED_MPS);
      corners.push({ code: c.code, call: c.call, apex: c.apex, a: ma, b: mb, stopped, delta_s: mb ? mb.time_s - ma.time_s : null });
    }
    const ta = elapsedS(a.speed_mps), tb = elapsedS(b.speed_mps), curve = [];
    let overlapBins = 0, runA0 = null, runB0 = null, runTotal = 0, runLast = 0, prevJ = -1;
    for (let i = 0; i < a.lat.length; i += DELTA_STRIDE) {
      let [j, d] = nearestIndexWin(a.lat[i], a.lon[i], b.lat, b.lon, prevJ);
      if (d > MATCH_RADIUS_M && prevJ >= 0) [j, d] = nearestIndexWin(a.lat[i], a.lon[i], b.lat, b.lon, -1);
      const sameWay = prevJ < 0 || j >= prevJ;
      if (d <= MATCH_RADIUS_M && sameWay) {
        if (runA0 === null) { runA0 = i; runB0 = j; }
        runLast = (tb[j] - tb[runB0]) - (ta[i] - ta[runA0]);
        curve.push([i * 5, runLast]);
        overlapBins += DELTA_STRIDE;
        prevJ = j;
      } else {
        if (runA0 !== null) { curve.push([i * 5, null]); runTotal += runLast; runLast = 0; }
        runA0 = runB0 = null;
        prevJ = d <= MATCH_RADIUS_M ? j : -1;
      }
    }
    runTotal += runA0 !== null ? runLast : 0;
    const matched = corners.filter(c => c.delta_s !== null && !c.stopped);
    return { corners, overlap_m: overlapBins * 5, matched_corners: matched.length,
             corner_delta_s: matched.reduce((s, c) => s + c.delta_s, 0), overlap_delta_s: runTotal, delta_curve: curve };
  }

  // -------------------------------------------------------------------------
  // Route hygiene: cut out-and-back spurs (route returns to the same point within
  // 2 km after wandering > 40 m away), the signature of a waypoint snapped into a dead end.
  // -------------------------------------------------------------------------
  function removeSpurs(lat, lon, { closeM = 12, wanderM = 40, minSpan = 8, maxSpan = 400 } = {}) {
    const c = Math.cos(lat[0] * Math.PI / 180);
    const d = (i, j) => Math.hypot((lon[i] - lon[j]) * 111320 * c, (lat[i] - lat[j]) * 110540);
    const keep = [];
    let i = 0;
    while (i < lat.length) {
      keep.push(i);
      let cut = -1;
      for (let j = Math.min(lat.length - 1, i + maxSpan); j >= i + minSpan; j--) {
        if (d(i, j) >= closeM) continue;
        let far = 0;
        for (let k = i + 1; k < j; k++) far = Math.max(far, d(i, k));
        if (far > wanderM) { cut = j; break; }
      }
      i = cut > 0 ? cut + 1 : i + 1;
    }
    return { lat: keep.map(k => lat[k]), lon: keep.map(k => lon[k]), removed: lat.length - keep.length };
  }

  // How much of a route retraces itself (share of samples within 12 m of a point >= 300 m earlier).
  function retracedShare(lat, lon) {
    const c = Math.cos(lat[0] * Math.PI / 180);
    let re = 0, n = 0;
    for (let i = 0; i < lat.length; i += 2) {
      n++;
      for (let j = 0; j < i - 60; j += 2) {
        const dx = (lon[i] - lon[j]) * 111320 * c, dy = (lat[i] - lat[j]) * 110540;
        if (dx * dx + dy * dy < 144) { re++; break; }
      }
    }
    return n ? re / n : 0;
  }

  // Driver Score — port of core/drive_analysis.driver_score (parity-tested).
  const PACE_TARGET = 0.85, PACE_CEILING = 1.0;
  function paceCredit(u) {
    if (u <= PACE_TARGET) return Math.max(0, u / PACE_TARGET);
    if (u <= PACE_CEILING) return 1;
    return Math.max(0, 1 - 4 * (u - PACE_CEILING));
  }
  function std(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); }
  // One clean corner's Driver Score inputs (port of drive_analysis.corner_technique), or null when it is not scored.
  function cornerTechnique(v, lonG, latG, c) {
    if (!Number.isFinite(c.apex_mps)) return null;
    for (let q = c.start; q <= c.end; q++) if (!Number.isFinite(v[q])) return null;   // a speed gap (blank GPS speed) leaves the corner out, not NaN
    const m = cornerMetrics(v, lonG, latG, c.start, c.end, c.apex, c.apex_mps);
    if (m.min_mps < STOPPED_MPS) return null;
    // Smoothness per metre of road (speed-invariant): how abruptly lateral load changes.
    let sq = 0, nd = 0;
    for (let q = c.start; q < c.end; q++) { const dl = latG[q + 1] - latG[q]; sq += dl * dl; nd++; }
    let mn = Infinity;
    for (let q = c.apex; q <= c.end; q++) mn = Math.min(mn, lonG[q]);
    const late = Math.max(0, -mn);
    return { use: m.envelope_use, smooth: Math.exp(-(nd ? Math.sqrt(sq / nd) : 0) / 0.15), brake: 1 - Math.min(1, Math.max(0, (late - 0.10) / 0.30)) };
  }
  function driverScore(v, lonG, latG, corners, lo = 0, hi = null) {
    hi = hi === null ? v.length : hi;
    const uses = [], pace = [], smooth = [], brake = [];
    for (const c of corners) {
      if (c.start < lo || c.end >= hi) continue;
      const t = cornerTechnique(v, lonG, latG, c);
      if (!t) continue;
      uses.push(t.use); pace.push(paceCredit(t.use)); smooth.push(t.smooth); brake.push(t.brake);
    }
    if (!uses.length) return { score: null, corners: 0, components: null };
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const consistency = 1 - Math.min(1, std(uses) / 0.25);
    const comp = { pace: mean(pace), smoothness: mean(smooth), braking: mean(brake), consistency };
    const raw = 0.40 * comp.pace + 0.25 * comp.smoothness + 0.15 * comp.braking + 0.20 * comp.consistency;
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    return { score: Math.round(1000 * raw), corners: uses.length,
             components: Object.fromEntries(Object.entries(comp).map(([k, x]) => [k, r4(x)])) };
  }
  // Fatigue cues (IDEAS D-16) — port of drive_analysis.fatigue (parity-tested): on a drive of an hour's moving time or
  // more, did smoothness or braking fade from the first third to the last? A cue, never a verdict: the road can change too.
  const FATIGUE_MIN_S = 3600, FATIGUE_MIN_CORNERS = 8, FATIGUE_MIN_DROP = 0.05, FATIGUE_SE = 2;
  function fatigue(v, lonG, latG, corners) {
    const n = v.length, t = new Float64Array(n);
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + (Number.isFinite(v[i - 1]) && v[i - 1] >= STOPPED_MPS ? 5 / v[i - 1] : 0);
    const total = n ? t[n - 1] : 0;
    if (total < FATIGUE_MIN_S) return null;
    const early = [], late = [];
    for (const c of corners) {
      const tc = cornerTechnique(v, lonG, latG, c);
      if (!tc) continue;
      const at = t[c.apex];
      if (at <= total / 3) early.push(tc); else if (at >= 2 * total / 3) late.push(tc);
    }
    if (early.length < FATIGUE_MIN_CORNERS || late.length < FATIGUE_MIN_CORNERS) return null;
    const meanSe = (xs) => { let m = 0; for (const x of xs) m += x; m /= xs.length; let q = 0; for (const x of xs) q += (x - m) ** 2; return [m, Math.sqrt((xs.length > 1 ? q / (xs.length - 1) : 0) / xs.length)]; };
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    const out = { minutes: Math.round(total / 6) / 10, early: { corners: early.length }, late: { corners: late.length }, cues: [] };
    for (const [k, name] of [['smooth', 'smoothness'], ['brake', 'braking']]) {
      const [me, se] = meanSe(early.map((x) => x[k])), [ml, sl] = meanSe(late.map((x) => x[k]));
      out.early[name] = r4(me); out.late[name] = r4(ml);
      const drop = me - ml;
      if (drop >= FATIGUE_MIN_DROP && drop >= FATIGUE_SE * Math.sqrt(se ** 2 + sl ** 2)) out.cues.push(name);
    }
    return out;
  }
  // Corner coach — port of core/drive_analysis.coach (parity-tested). Phases of each corner and the
  // time lost to the person's own best clean pass of it; passes over the sane limit never count as best.
  const COAST_G = 0.05, THROTTLE_G = 0.05, TRAIL_LAT_G = 0.20, BRAKE_GAP = 20, SOLO_APEX_DIP_MPS = 0.3, THROTTLE_LOOKAHEAD = 20, TIP_SPEED_MPS = 0.9, TIP_BRAKE_M = 10,
    TIP_COAST_M = 15, TIP_GAIN_S = 0.20, SOLO_COAST_M = 20, SOLO_EARLY_APEX_M = -15, SOLO_LATE_BRAKE_G = 0.25, TOP_OPPORTUNITIES = 3;
  function cornerPhases(v, lonG, latG, start, end, apex, apexMps) {
    const m = cornerMetrics(v, lonG, latG, start, end, apex, apexMps), n = v.length;
    const lo = Math.max(0, apex - BRAKE_LOOKBACK);
    let r1 = apex;
    while (r1 >= lo && !(lonG[r1] < BRAKE_G)) r1--;
    let r0 = null;
    if (r1 >= lo && r1 >= start - BRAKE_GAP) { r0 = r1; while (r0 - 1 >= lo && lonG[r0 - 1] < BRAKE_G) r0--; }
    let trail = 0;
    if (r0 !== null) for (let k = r0; k <= r1; k++) if (Math.abs(latG[k]) >= TRAIL_LAT_G) trail++;
    const iMin = apex + Math.round(m.min_offset_m / 5);
    let kThr = null;
    for (let k = iMin; k < Math.min(n, end + THROTTLE_LOOKAHEAD + 1); k++) if (lonG[k] > THROTTLE_G) { kThr = k; break; }
    const b0 = r0 === null ? start : r0, b1 = kThr === null ? end : kThr;
    let coast = 0;
    for (let k = b0; k <= b1; k++) if (Math.abs(lonG[k]) < COAST_G) coast++;
    let late = 0;
    for (let k = apex; k <= end; k++) late = Math.max(late, -lonG[k]);
    return { ...m, brake_m: r0 === null ? null : (apex - r0) * 5, trail_m: trail * 5, coast_m: coast * 5,
             throttle_m: kThr === null ? null : (kThr - apex) * 5, late_brake_g: late, apex_mps_driven: v[apex] };
  }
  function knownRun(d, start, end, apex) {
    const v = d.speed_mps, gk = d.g_known, n = v.length;
    if (!(start >= 0 && start <= apex && apex <= end && end < n)) return false;
    for (let q = start; q <= end; q++) if (!Number.isFinite(v[q])) return false;
    if (!gk) return true;
    for (let q = Math.max(0, apex - BRAKE_LOOKBACK); q <= Math.min(n - 1, end + THROTTLE_LOOKAHEAD); q++) if (q >= gk.length || !gk[q]) return false;
    return true;
  }
  function fracIndex(lat, lon, b, j) {
    const n = b.lat.length, c = Math.cos(lat * Math.PI / 180);
    const xy = (k) => [(b.lon[k] - lon) * 111320 * c, (b.lat[k] - lat) * 110540];
    let best = null;
    for (const k of [j - 1, j]) {
      if (k < 0 || k + 1 >= n) continue;
      const [x0, y0] = xy(k), [x1, y1] = xy(k + 1), dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
      const u = L2 <= 0 ? 0 : Math.min(1, Math.max(0, -(x0 * dx + y0 * dy) / L2));
      const px = x0 + u * dx, py = y0 + u * dy, d2 = px * px + py * py;
      if (best === null || d2 < best[0]) best = [d2, k + u];
    }
    return best === null ? j : best[1];
  }
  // b's time over exactly a's stretch [start, end], aligned by the median sub-bin offset of a's bins projected onto b.
  function alignedTimeS(a, start, end, b, bs) {
    const offs = [];
    for (let i = start; i <= end; i++) {
      const [j] = nearestIndexWin(a.lat[i], a.lon[i], b.lat, b.lon, Math.min(b.lat.length - 1, bs + (i - start)), 6);
      offs.push(fracIndex(a.lat[i], a.lon[i], b, j) - i);
    }
    offs.sort((p, q) => p - q);
    const h = Math.floor(offs.length / 2), off = offs.length % 2 ? offs[h] : 0.5 * (offs[h - 1] + offs[h]);
    const x0 = start + off, x1 = end + 1 + off, vb = b.speed_mps;
    if (x0 < 0 || x1 > vb.length - 1) return null;
    for (let q = Math.floor(x0); q <= Math.floor(x1); q++) if (!Number.isFinite(vb[q])) return null;
    const k0 = Math.floor(x0), seg = vb.slice(k0, Math.floor(x1) + 1), t = elapsedS(seg);   // only over the stretch
    const at = (x) => { const k = Math.floor(x); return t[k] + (x - k) * 5 / Math.max(seg[k], 0.5); };
    return at(x1 - k0) - at(x0 - k0);
  }
  function coachTip(m, ref) {
    if (ref) {
      if (ref.min_mps - m.min_mps >= TIP_SPEED_MPS) return { kind: 'min_speed', value: ref.min_mps - m.min_mps, vs_best: true };
      if (m.brake_m !== null && ref.brake_m !== null && m.brake_m - ref.brake_m >= TIP_BRAKE_M) return { kind: 'brake_later', value: m.brake_m - ref.brake_m, vs_best: true };
      if (m.throttle_m !== null && ref.throttle_m !== null && m.throttle_m - ref.throttle_m >= TIP_BRAKE_M) return { kind: 'throttle_sooner', value: m.throttle_m - ref.throttle_m, vs_best: true };
      if (m.coast_m - ref.coast_m >= TIP_COAST_M) return { kind: 'coast', value: m.coast_m - ref.coast_m, vs_best: true };
      return null;
    }
    if (m.late_brake_g >= SOLO_LATE_BRAKE_G) return { kind: 'brake_after_apex', value: m.late_brake_g, vs_best: false };
    if (m.brake_m !== null && m.coast_m >= SOLO_COAST_M) return { kind: 'coast', value: m.coast_m, vs_best: false };
    if (m.min_offset_m <= SOLO_EARLY_APEX_M && m.apex_mps_driven - m.min_mps >= SOLO_APEX_DIP_MPS) return { kind: 'early_apex', value: -m.min_offset_m, vs_best: false };
    return null;
  }
  function coach(a, others) {
    const hints = others.map(() => -1), out = [];
    for (const c of a.corners) {
      if (!Number.isFinite(c.apex_mps) || !knownRun(a, c.start, c.end, c.apex)) { out.push({ apex: c.apex, m: null, best: null, gain_s: null, tip: null, passes: 0 }); continue; }
      const ma = cornerPhases(a.speed_mps, a.lon_g, a.lat_g, c.start, c.end, c.apex, c.apex_mps);
      if (ma.min_mps < STOPPED_MPS) { out.push({ apex: c.apex, m: ma, best: null, gain_s: null, tip: null, passes: 0 }); continue; }
      let best = ma, bestFrom = -1, passes = 1;
      others.forEach((b, j) => {
        const w = matchWindow(a, c.start, c.end, b, hints[j]);
        if (!w) return;
        const [bs, be] = w;
        hints[j] = be;
        const bApex = bs + Math.round((c.apex - c.start) * (be - bs) / Math.max(1, c.end - c.start));
        if (!knownRun(b, bs, be, bApex)) return;
        const mb = cornerPhases(b.speed_mps, b.lon_g, b.lat_g, bs, be, bApex, c.apex_mps);
        const tb = alignedTimeS(a, c.start, c.end, b, bs);                 // over exactly A's stretch: a bin off is up to 0.3 s
        if (tb === null) return;
        mb.time_s = tb;
        if (mb.min_mps < STOPPED_MPS) return;
        passes++;
        if (mb.envelope_use <= PACE_CEILING && mb.time_s < best.time_s) { best = mb; bestFrom = j; }
      });
      const gain = ma.time_s - best.time_s;
      out.push({ apex: c.apex, m: ma, best: bestFrom < 0 ? null : best, best_from: bestFrom, gain_s: gain,
                 tip: coachTip(ma, bestFrom >= 0 && gain >= TIP_GAIN_S ? best : null), passes });
    }
    const clean = out.filter(x => x.gain_s !== null);
    const thisS = clean.reduce((s, x) => s + x.m.time_s, 0), gainS = clean.reduce((s, x) => s + (x.gain_s >= TIP_GAIN_S ? x.gain_s : 0), 0);
    const top = out.map((x, k) => k).filter(k => out[k].gain_s !== null && out[k].gain_s >= TIP_GAIN_S)
      .sort((p, q) => out[q].gain_s - out[p].gain_s || p - q).slice(0, TOP_OPPORTUNITIES);
    return { corners: out, clean: clean.length, this_s: thisS, ideal_s: thisS - gainS, gain_s: gainS, top };
  }
  // Friction circle — port of core/drive_analysis.gg_envelope / grip_use (parity-tested).
  const GG_SECTORS = 16, GG_PCTL = 0.95, GG_MIN_POINTS = 8, GG_MIN_G = 0.05, GG_USE_MIN_G = 0.15;
  const pctl = (vals, q) => { const s = vals.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
  function ggSector(lat, lon) {
    const T = 2 * Math.PI, w = T / GG_SECTORS;                      // slice k centred on k x 22.5 deg
    let a = (Math.atan2(lat, lon) + 0.5 * w) % T; if (a < 0) a += T;
    return Math.floor(a / w) % GG_SECTORS;
  }
  function ggEnvelope(latG, lonG, gKnown = null) {
    const buckets = Array.from({ length: GG_SECTORS }, () => []), total = [];
    for (let i = 0; i < latG.length; i++) {
      const la = latG[i], lo = lonG[i];
      if ((gKnown && !gKnown[i]) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const r = Math.hypot(la, lo);
      if (r < GG_MIN_G) continue;
      buckets[ggSector(la, lo)].push(r); total.push(r);
    }
    const radius = buckets.map(b => (b.length >= GG_MIN_POINTS ? pctl(b, GG_PCTL) : null));
    const q = GG_SECTORS / 4;
    return { radius_g: radius, points: total.length, peak_g: total.length >= GG_MIN_POINTS ? pctl(total, GG_PCTL) : null,
             brake_g: radius[2 * q], throttle_g: radius[0], left_g: radius[q], right_g: radius[3 * q] };
  }
  // Smoothness map (port of core/drive_analysis.abrupt_moments, parity-tested): g/s per 5 m sample and the 3 most abrupt moments.
  const JERK_MIN_MPS = 5.0, JERK_FLOOR_GPS = 0.3, JERK_SEPARATION = 40, JERK_TOP = 3;
  function abruptMoments(latG, lonG, speed, gKnown = null) {
    const n = latG.length, fin = (x) => typeof x === 'number' && Number.isFinite(x);
    const ok = Array.from({ length: n }, (_, i) => (!gKnown || !!gKnown[i]) && fin(latG[i]) && fin(lonG[i]));
    const jerk = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const v = speed[i], v0 = speed[i - 1];
      if (!(ok[i] && ok[i - 1] && fin(v) && fin(v0) && Math.min(v, v0) >= JERK_MIN_MPS)) continue;
      jerk[i] = Math.hypot(latG[i] - latG[i - 1], lonG[i] - lonG[i - 1]) * v / 5.0;
    }
    const order = [];
    for (let i = 0; i < n; i++) if (jerk[i] != null && jerk[i] >= JERK_FLOOR_GPS) order.push(i);
    order.sort((a, b) => (jerk[b] - jerk[a]) || (a - b));
    const picks = [];
    for (const i of order) {
      if (picks.length === JERK_TOP) break;
      if (picks.every((p) => Math.abs(i - p) >= JERK_SEPARATION)) picks.push(i);
    }
    return { jerk, moments: picks.map((i) => ({ index: i, jerk_gps: jerk[i] })) };
  }

  function gripUse(latG, lonG, lo, hi, env, gKnown = null) {
    let sum = 0, n = 0;
    for (let i = lo; i <= hi; i++) {
      if (gKnown && !gKnown[i]) return null;
      const la = latG[i], lg = lonG[i];
      if (!Number.isFinite(la) || !Number.isFinite(lg)) return null;
      const r = Math.hypot(la, lg), cap = r >= GG_USE_MIN_G ? env.radius_g[ggSector(la, lg)] : null;
      if (cap) { sum += Math.min(r / cap, 1.5); n++; }
    }
    return n ? sum / n : null;
  }
  function segmentWindow(seg, d) {
    const [i0, d0] = nearestIndexWin(seg.lat0, seg.lon0, d.lat, d.lon, -1);
    if (d0 > MATCH_RADIUS_M) return null;
    const span = Math.floor(seg.length_m / 5);
    const [i1, d1] = nearestIndexWin(seg.lat1, seg.lon1, d.lat, d.lon, i0 + span, Math.max(40, Math.floor(span / 2)));
    if (d1 > MATCH_RADIUS_M || i1 <= i0) return null;
    const ratio = (i1 - i0) / Math.max(1, span);
    return ratio >= 0.7 && ratio <= 1.3 ? [i0, i1] : null;
  }
  function segmentPass(seg, d) {
    const w = segmentWindow(seg, d);
    if (!w) return null;
    const [lo, hi] = w, t = elapsedS(d.speed_mps);
    return { lo, hi, time_s: t[hi] - t[lo], ...driverScore(d.speed_mps, d.lon_g, d.lat_g, d.corners, lo, hi + 1) };
  }

  // Profile a raw 5 m recording (the iOS app's ApexDrive CSV) in the browser with the same
  // geometry/envelope/corner pipeline tools/export_web_profile.py uses. Hazards and sectors need
  // the offline pipeline (multi-pass + reference lap) and are left out.
  // Strongest sample of each cluster of mask, clusters at least HAZARD_MIN_SEPARATION_M apart (road_dna._peak_events).
  function peakEvents(values, mask, dist, pickMax) {
    const picks = [];
    for (let i = 0; i < values.length; i++) {
      if (!mask[i]) continue;
      const last = picks[picks.length - 1];
      if (picks.length && dist[i] - dist[last] < HAZARD_MIN_SEPARATION_M) {
        if (pickMax ? values[i] > values[last] : values[i] < values[last]) picks[picks.length - 1] = i;
      } else picks.push(i);
    }
    return picks;
  }

  // Centred rolling median of the measured values in the window (NaN where none are).
  function rollingMedian(v, window) {
    const half = Math.floor(window / 2), n = v.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = [];
      for (let j = Math.max(0, i - half); j < Math.min(n, i + half + 1); j++) if (Number.isFinite(v[j])) w.push(v[j]);
      w.sort((a, b) => a - b);
      const m = w.length;
      out[i] = !m ? NaN : (m % 2 ? w[(m - 1) / 2] : (w[m / 2 - 1] + w[m / 2]) / 2);
    }
    return out;
  }

  /**
   * Bumps (vertical spike), crests (unweighting) and dips (compression) from measured IMU (road_dna.detect_hazards).
   * Unmeasured samples (null/NaN) never make a hazard. With no vertPeak, roughness stands in for bumps unless
   * roughFallback is false (phone recordings: a roughness RMS alone cannot tell a pothole from broken pavement).
   */
  function detectHazards(dist, crest, rough, vertPeak = null, { roughFallback = true } = {}) {
    const num = (a, n) => Float64Array.from({ length: n }, (_, i) => (a && Number.isFinite(a[i]) ? a[i] : NaN));
    const n = dist.length, c = num(crest, n), r = num(rough, n), out = [];
    if (vertPeak) {
      const peak = num(vertPeak, n), bg = rollingMedian(r, SPIKE_BACKGROUND_BINS);
      const spike = Array.from(peak, (p, i) => p > SPIKE_PEAK_G && p > SPIKE_CONTRAST * bg[i]);
      for (const i of peakEvents(peak, spike, dist, true)) out.push({ index: i, type: 'bump', severity_g: peak[i] });
    } else if (roughFallback) {
      for (const i of peakEvents(r, Array.from(r, (v) => v > ROUGH_RMS_FALLBACK_G), dist, true)) out.push({ index: i, type: 'bump', severity_g: r[i] });
    }
    for (const i of peakEvents(c, Array.from(c, (v) => v < CREST_UNWEIGHT_G), dist, false)) out.push({ index: i, type: 'crest', severity_g: c[i] });
    for (const i of peakEvents(c, Array.from(c, (v) => v > DIP_COMPRESS_G), dist, true)) out.push({ index: i, type: 'dip', severity_g: c[i] });
    return out.sort((a, b) => a.index - b.index);
  }

  const HAZARD_CALLS = { bump: ['BUMP', 'Bump'], crest: ['CREST', 'Crest'], dip: ['DIP', 'Dip'] };
  const MIN_CORNER_SPEED_MPS = 2.5;
  function profileRecording(cols) {
    const { lat, lon } = cols, n = lat.length;
    const { kappa, ds } = computeCurvature(lat, lon);
    const camber = cols.camber_deg ? cols.camber_deg.map(d => d * Math.PI / 180) : null;
    const sight = sightDistanceM(lat, lon, cols.elevation_m || null);
    const env = brakingEnvelopeMps(kappa, ds, camber, cols.roughness_rms || null, undefined, sight);
    const speed = cols.speed_mph.map(v => v / MPS_TO_MPH);
    const corners = annotateCautions(detectCorners(kappa, ds, camber, cols.crest_vertical_g || null, cols.roughness_rms || null)
      .filter(c => speed[c.apex] >= MIN_CORNER_SPEED_MPS), env, sight);
    const dist = cols.distance_m || lat.map((_, i) => i * 5);
    const events = corners.map(c => {
      const t = paceNoteText(c);
      return { type: 'corner', code: t.code, call: t.call, index: c.apex, dist_m: dist[c.apex], start_m: dist[c.start], end_m: dist[c.end],
               lat: lat[c.apex], lon: lon[c.apex], radius_m: c.radius_m, apex_mph: c.apex_mps * MPS_TO_MPH, dir: c.dir,
               severity: c.severity, grade: c.grade, shape: c.shape, caution: c.caution, turn_rad: Math.abs(c.turn_rad), mods: c.mods };
    });
    // Hazards only from what the phone measured: spikes need the per-sample vertical peak, crests and dips a solved mount.
    const peak = cols.vert_peak_g && cols.vert_peak_g.some(Number.isFinite) ? cols.vert_peak_g : null;
    for (const h of detectHazards(dist, cols.crest_vertical_g || null, cols.roughness_rms || null, peak, { roughFallback: false })) {
      if (!(speed[h.index] >= MIN_CORNER_SPEED_MPS)) continue;           // walking pace: the phone is being handled, not reading the road
      const [code, call] = HAZARD_CALLS[h.type];
      events.push({ type: h.type, code, call, index: h.index, dist_m: dist[h.index], start_m: dist[h.index], end_m: dist[h.index],
                    lat: lat[h.index], lon: lon[h.index], severity_g: h.severity_g });
    }
    events.sort((a, b) => a.start_m - b.start_m);
    linkNotes(events);
    return { events, envMps: Array.from(env), sightM: Array.from(sight), n };
  }

  const api = {
    profileRecording,
    driverScore, cornerTechnique, fatigue, segmentPass, segmentWindow,
    removeSpurs, retracedShare,
    compareDrives, cornerMetrics, elapsedS, cornerPhases, coach, ggEnvelope, gripUse, ggSector, abruptMoments,
    G_STD, MPS_TO_MPH, ALPR_RADIUS_M,
    movingAverage, gradient, unwrap, localXY, resamplePolyline,
    computeCurvature, apexSpeedMps, effectiveMu, brakingEnvelopeMps, sightDistanceM, sightSpeedMps, SIGHT_MAX_M,
    severityForRadius, detectCorners, paceNoteText, annotateCautions, linkNotes, rallyDistance, nearestIndex, detectHazards
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
