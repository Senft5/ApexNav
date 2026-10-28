// Road pages (IDEAS Q-13): what a road is like before you drive it, from the reference lap (apex_core referenceLap, the
// same simulation the Python profiler uses) over the map's shape and the DEM: its archetype ("Esses", "Switchbacks"),
// TECH and FLOW, SURF from members' roughness, CLEAR from junctions, how sure we are (L0 map only, L1 some member
// passes, L2 most of it measured by 2+ runs), the climb and the better way round. Unknown stays unknown (--).
// describe() is pure (tests/test_road_page.py); open() draws the sheet.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * s: a stage ({ lat[], lon[], km, name, junctionsPerKm, tight, elevA, elevB }); opts.elev: elevation (m) per 5 m sample
   * or null; opts.measured: ApexContributor.measuredAlong summary or null; opts.surf: its surface score (0-100) or null.
   */
  function describe(Core, s, opts = {}) {
    const rs = Core.resamplePolyline(s.lat, s.lon, 5);
    const n = rs.lat.length;
    if (n < 20) return null;
    const elev = Array.isArray(opts.elev) && opts.elev.length === n && opts.elev.every(finite) ? opts.elev : null;
    const { kappa, ds } = Core.computeCurvature(rs.lat, rs.lon);
    const sight = Core.sightDistanceM(rs.lat, rs.lon, elev, undefined, opts.side || null);
    const corners = Core.detectCorners(kappa, ds);
    const lap = Core.referenceLap(kappa, ds, { sightM: sight, elevationM: elev });
    const f = Core.windowFeatures(lap, corners, sight, 0, n);
    const axes = Core.axisScores(f), archetype = Core.archetype(f);
    let climb = null, drop = null;
    if (elev) { climb = 0; drop = 0; for (let i = 1; i < n; i++) { const d = elev[i] - elev[i - 1]; if (d > 0) climb += d; else drop -= d; } climb = Math.round(climb); drop = Math.round(drop); }
    const m = opts.measured || null;
    const confidence = m && m.coverage >= 0.6 && m.avgPasses >= 2 ? 'L2' : m && m.coverage >= 0.1 ? 'L1' : 'L0';
    const clear = finite(s.junctionsPerKm) ? Math.max(0, Math.min(100, Math.round(100 - 25 * s.junctionsPerKm))) : null;
    return {
      name: s.name || null, archetype, km: rs.lat.length * 5 / 1000, corners: corners.length,
      hairpins: corners.filter((c) => c.severity === 'HP').length, tech: axes.tech, flow: axes.flow,
      surf: finite(opts.surf) ? opts.surf : null, clear, confidence, climb, drop,
      minutes: Math.round(f.seconds / 60), blind: Math.round(100 * f.blind_share),
    };
  }

  const CONF = { L0: 'From the map only', L1: 'Some of it driven by members', L2: 'Measured by members on most of it' };

  /** The line a driver reads first: "Esses · 3.1 mi · climbing 240 m". */
  function headline(d, fmtKm = (km) => `${km.toFixed(1)} km`, fmtM = (m) => `${m} m`) {
    if (!d) return '';
    const bits = [d.archetype, fmtKm(d.km)];
    if (finite(d.climb) && finite(d.drop) && Math.max(d.climb, d.drop) >= 40) bits.push(d.climb >= d.drop ? `climbing ${fmtM(d.climb)}` : `descending ${fmtM(d.drop)}`);
    return bits.join(' · ');
  }

  /** Rows for the sheet: [label, value] with '--' for unknown. */
  function rows(d) {
    const v = (x) => (finite(x) ? String(x) : '--');
    return [['TECH', v(d.tech)], ['FLOW', v(d.flow)], ['SURF', v(d.surf)], ['CLEAR', v(d.clear)],
      ['Corners', `${d.corners}${d.hairpins ? ` (${d.hairpins} hairpins)` : ''}`], ['Blind corners', `${v(d.blind)}%`], ['Confidence', `${d.confidence} · ${CONF[d.confidence]}`]];
  }

  /**
   * A route's character (IDEAS Q-05): adaptive sectors (apex_core adaptiveSectors, split at its turns `breaks`), each read
   * by the reference lap as an archetype, neighbours of the same kind merged: [{ archetype, startM, endM }].
   */
  function character(Core, t, breaks = []) {
    if (!t || !Array.isArray(t.kappa) || t.kappa.length < 60) return [];
    const n = t.kappa.length, ds = new Float64Array(n).fill(5), sight = Array.isArray(t.sightM) && t.sightM.length === n ? t.sightM : new Float64Array(n).fill(Core.SIGHT_MAX_M);
    const corners = Core.detectCorners(t.kappa, ds), lap = Core.referenceLap(t.kappa, ds, { sightM: sight });
    const out = [];
    for (const [a, b] of Core.adaptiveSectors(t.kappa, ds, breaks)) {
      const arch = Core.archetype(Core.windowFeatures(lap, corners, sight, a, b));
      const last = out[out.length - 1];
      if (last && last.archetype === arch) last.endM = b * 5; else out.push({ archetype: arch, startM: a * 5, endM: b * 5 });
    }
    return out;
  }
  const PLAIN = new Set(['Connector', 'Fast open', 'Town']);
  /** "Esses 2.1 mi at 14 mi · Switchbacks 1.2 mi at 31 mi": the stretches worth knowing about, longest first (at most 3). */
  function characterLine(list, fmt = (m) => `${(m / 1000).toFixed(1)} km`) {
    const good = (list || []).filter((x) => !PLAIN.has(x.archetype) && x.endM - x.startM >= 500)
      .sort((a, b) => (b.endM - b.startM) - (a.endM - a.startM)).slice(0, 3).sort((a, b) => a.startM - b.startM);
    return good.map((x) => `${x.archetype} ${fmt(x.endM - x.startM)}${x.startM >= 500 ? ` at ${fmt(x.startM)}` : ' from the start'}`).join(' · ');
  }

  const api = { describe, headline, rows, CONF, character, characterLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadPage = api;
})(typeof window !== 'undefined' ? window : globalThis);
