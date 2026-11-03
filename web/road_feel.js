// ApexRoadFeel: what this phone felt through the road on one drive (panel round 2, HE-1 / LA-3), from the drive's own 5 m
// rows. Pure; no DOM.
//
// Nothing is said for a drive whose mount never calibrated: the recorder keeps a row's camber only once the mount is
// locked (sensors.js; a browser only once checked against GPS), so a drive with fewer than MIN_ROWS rows of camber has no
// road feel to show, and its line is empty. No number is invented: unknown stays unknown (CLAUDE.md rule 3).
//
//   columns(rows)                 the recorder's rows [{ distance_m, camber_deg, roughness_rms }] -> { dist, camber, rough }
//   summary({ dist, camber, rough }) -> null | { rows, bankDeg, bankAtM, roughAtM }
//        bankDeg: the most banked 20 m (signed: + into the turn, - off-camber), roughAtM: the start of the roughest 100 m
//        when it is rough enough to matter (null when the whole drive was smooth), distances from the drive's start
//   endLine(summary, fmtDist)     "Road feel: banked 4° at 2.4 mi · roughest at 3.1 mi", or '' with nothing measured
(function (root) {
  'use strict';
  const MIN_ROWS = 40;      // 200 m of calibrated road before anything is said
  const BANK_ROWS = 4;      // banking: the mean of 20 m, so one noisy sample is never the headline
  const BANK_MAX = 15;      // a sample past 15° is no public road: a measurement artefact, and its 20 m are left out
  const BANK_MIN = 1;       // under 1° anywhere: the line says the road was flat, measured
  const ROUGH_ROWS = 20;    // roughness: the worst 100 m on average
  const ROUGH_G = 0.08;     // where roughness starts to cost grip (apex_core.js effectiveMu)

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);

  function columns(rows) {
    const r = Array.isArray(rows) ? rows : [];
    return { dist: r.map((x, i) => (x && fin(x.distance_m) ? x.distance_m : i * 5)), camber: r.map((x) => (x && fin(x.camber_deg) ? x.camber_deg : null)),
      rough: r.map((x) => (x && fin(x.roughness_rms) ? x.roughness_rms : null)) };
  }

  function summary(d) {
    if (!d || !Array.isArray(d.camber)) return null;
    const cam = d.camber, n = cam.length;
    const dist = Array.isArray(d.dist) && d.dist.length === n ? d.dist : cam.map((_, i) => i * 5);
    const rows = cam.filter(fin).length;
    if (rows < MIN_ROWS) return null;
    const d0 = fin(dist[0]) ? dist[0] : 0, at = (i) => (fin(dist[i]) ? dist[i] - d0 : i * 5);
    let bankDeg = null, bankAtM = null;
    for (let i = 0; i + BANK_ROWS <= n; i++) {
      let s = 0, k = 0, wild = false;
      for (let j = i; j < i + BANK_ROWS; j++) if (fin(cam[j])) { s += cam[j]; k++; if (Math.abs(cam[j]) > BANK_MAX) wild = true; }
      if (k < BANK_ROWS || wild) continue;                            // a gap, or a sample no road could give: not trusted
      const m = s / k;
      if (bankDeg == null || Math.abs(m) > Math.abs(bankDeg)) { bankDeg = m; bankAtM = at(i); }
    }
    let roughAtM = null, worst = -Infinity;
    const rough = Array.isArray(d.rough) && d.rough.length === n ? d.rough : null;
    if (rough) {
      for (let i = 0; i + ROUGH_ROWS <= n; i++) {
        let s = 0, k = 0;
        for (let j = i; j < i + ROUGH_ROWS; j++) if (fin(rough[j])) { s += rough[j]; k++; }
        if (k < ROUGH_ROWS * 0.8) continue;
        if (s / k > worst) { worst = s / k; roughAtM = at(i); }
      }
      if (!(worst >= ROUGH_G)) roughAtM = null;
    }
    return { rows, bankDeg, bankAtM, roughAtM, rough: rough ? worst >= ROUGH_G : null };
  }

  function endLine(s, fmtDist) {
    if (!s) return '';
    const f = typeof fmtDist === 'function' ? fmtDist : (m) => `${(m / 1609.344).toFixed(1)} mi`;
    const parts = [];
    if (s.bankDeg != null) {
      const deg = Math.round(Math.abs(s.bankDeg));
      parts.push(Math.abs(s.bankDeg) < BANK_MIN ? 'flat, no banking over 1°' : `${s.bankDeg < 0 ? 'off-camber' : 'banked'} ${deg}° at ${f(s.bankAtM)}`);
    }
    if (s.roughAtM != null) parts.push(`roughest at ${f(s.roughAtM)}`);
    else if (s.rough === false) parts.push('a smooth surface');
    return parts.length ? `Road feel: ${parts.join(' · ')}.` : '';
  }

  const api = { columns, summary, endLine, MIN_ROWS, BANK_MAX, ROUGH_G };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadFeel = api;
})(typeof window !== 'undefined' ? window : globalThis);
