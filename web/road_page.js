// Road pages (IDEAS Q-13): what a road is like before you drive it, from the reference lap (apex_core referenceLap, the
// same simulation the Python profiler uses) over the map's shape and the DEM: its archetype ("Esses", "Switchbacks"),
// Technical and Flow, Surface from members' roughness, Clear road from junctions, how sure we are (L0 map only, L1 some member
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

  /**
   * The four scores as a driver reads them (2026-11-10: the sheet said TECH, FLOW, SURF, CLEAR and "L0", the code's own
   * words): a plain name, what it means in a few words, and the score out of 100, or null when it isn't known (drawn as
   * "--" with an empty bar; never a guess).
   */
  function meters(d) {
    const n = (x) => (finite(x) ? Math.max(0, Math.min(100, Math.round(x))) : null);
    return [
      { key: 'tech', label: 'Technical', hint: 'how tight and busy its corners are', value: n(d.tech) },
      { key: 'flow', label: 'Flow', hint: 'how well one corner leads into the next', value: n(d.flow) },
      { key: 'surf', label: 'Surface', hint: finite(d.surf) ? 'how smooth members\' phones felt it' : 'not measured by members yet', value: n(d.surf) },
      { key: 'clear', label: 'Clear road', hint: finite(d.clear) ? 'how few junctions break it up' : 'its junctions aren\'t counted yet', value: n(d.clear) },
    ];
  }
  /** The facts under the scores: [label, value]; how sure we are in words, never a code. */
  function facts(d) {
    const hp = !d.hairpins ? '' : d.hairpins === d.corners && d.corners > 1 ? ', all hairpins' : ` · ${d.hairpins} ${d.hairpins === 1 ? 'hairpin' : 'hairpins'}`;
    return [['Corners', `${d.corners}${hp}`], ['Blind corners', finite(d.blind) ? `${d.blind}%` : '--'], ['How sure', CONF[d.confidence]]];
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
    // one phrase per kind of road, where each stretch starts: "Flowing sweepers at 13.0, 21.3 and 29.6 mi"
    const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const kinds = [...new Set(good.map((x) => x.archetype))];
    return kinds.map((k) => {
      const at = good.filter((x) => x.archetype === k);
      const later = at.filter((x) => x.startM >= 500).map((x) => fmt(x.startM));
      const nums = later.map((v, i) => (i < later.length - 1 ? v.replace(/\s*[^\d.,\s]+$/, '') : v));
      const parts = [...(at.length > later.length ? ['from the start'] : []), ...(nums.length ? [`at ${and(nums)}`] : [])];
      return `${k} ${and(parts)}`;
    }).join(' · ');
  }

  /**
   * What's on the road now (IDEAS Q-13, verified hazards): bumps members felt (ApexContributor.measuredAlong crowdBumps,
   * verified by 2+ drivers on the server) and live hand reports (GET /api/hazards) within NEAR_M of its line, cleared ones
   * left out, in order along it: [{ kind, title, atM, confirms, crowd }]. rs: the road resampled at 5 m ({ lat[], lon[] });
   * reports: the API's list, or null when it wasn't asked (then only bumps). null when nothing was looked up at all, so the
   * page says nothing rather than "none" (unknown stays unknown).
   */
  const NEAR_M = 30, LABEL = { pothole: 'Pothole', gravel: 'Gravel', debris: 'Debris', animal: 'Animal', police: 'Police', closure: 'Road closed' };
  function onThisRoad(rs, measured, reports) {
    if (!rs || !Array.isArray(rs.lat) || rs.lat.length < 2) return null;
    if (!measured && !Array.isArray(reports)) return null;
    const out = [];
    for (const b of (measured && Array.isArray(measured.crowdBumps) ? measured.crowdBumps : [])) {
      if (b && Number.isInteger(b.index) && b.index >= 0 && b.index < rs.lat.length) out.push({ kind: 'bump', title: 'Bump', atM: b.index * 5, confirms: null, crowd: true });
    }
    const n = rs.lat.length, lat0 = rs.lat[0], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    for (const h of (Array.isArray(reports) ? reports : [])) {
      if (!h || !finite(h.lat) || !finite(h.lon)) continue;
      if ((Number(h.clears) || 0) > (Number(h.confirms) || 0)) continue;
      let best = Infinity, at = -1;
      const px = (h.lon - rs.lon[0]) * kx, py = (h.lat - lat0) * ky;
      for (let i = 1; i < n; i++) {
        const ax = (rs.lon[i - 1] - rs.lon[0]) * kx - px, ay = (rs.lat[i - 1] - lat0) * ky - py;
        const dx = (rs.lon[i] - rs.lon[i - 1]) * kx, dy = (rs.lat[i] - rs.lat[i - 1]) * ky, L = dx * dx + dy * dy;
        const t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) { best = d; at = (i - 1 + t) * 5; }
      }
      if (best > NEAR_M) continue;
      out.push({ kind: h.kind, title: h.label || LABEL[h.kind] || 'Hazard', atM: Math.round(at), confirms: finite(h.confirms) ? h.confirms : null, crowd: false });
    }
    return out.sort((a, b) => a.atM - b.atM);
  }
  /**
   * The page's lines for it: [label, value]. Bumps in one line ("Bumps members felt", "at 0.4 and 1.3 mi"), each report
   * on its own ("Gravel", "at 1.2 mi · 3 confirmed"), at most `max` reports; "None reported" when it was looked up and
   * nothing is there; [] when it wasn't (null).
   */
  function hazardFacts(list, fmt = (m) => `${(m / 1000).toFixed(1)} km`, max = 5) {
    if (!Array.isArray(list)) return [];
    if (!list.length) return [['On this road', 'None reported']];
    const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const bumps = list.filter((x) => x.crowd), reps = list.filter((x) => !x.crowd).slice(0, max), rows = [];
    if (bumps.length) {
      const at = bumps.slice(0, 4).map((b) => fmt(b.atM)), nums = at.map((v, i) => (i < at.length - 1 ? v.replace(/\s*[^\d.,\s]+$/, '') : v));
      rows.push([bumps.length === 1 ? 'Bump members felt' : `${bumps.length} bumps members felt`, `at ${and(nums)}${bumps.length > 4 ? ' and more' : ''}`]);
    }
    for (const r of reps) rows.push([r.title, `at ${fmt(r.atM)}${finite(r.confirms) && r.confirms > 0 ? ` · ${r.confirms} confirmed` : ''}`]);
    return rows;
  }

  const api = { describe, headline, meters, facts, CONF, character, characterLine, onThisRoad, hazardFacts, NEAR_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadPage = api;
})(typeof window !== 'undefined' ? window : globalThis);
