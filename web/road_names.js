// ApexRoadNames — name a drive after the road it was mostly on.
//
// Names come from the map's own vector tiles (OpenMapTiles `transportation_name` lines already on the phone),
// so naming a drive sends nothing anywhere. A road that carried under a third of the drive does not name it:
// the drive keeps its date name and unknown stays unknown.
(function (root) {
  'use strict';

  const NAME_KEYS = ['name:en', 'name_en', 'name', 'ref'];

  function nameOf(props) {
    if (!props) return null;
    for (const k of NAME_KEYS) { const v = props[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
    return null;
  }

  // Metres from (lat, lon) to the segment a-b ([lon, lat] pairs), on a local flat-earth projection.
  function segmentDistanceM(lat, lon, a, b) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
    const ax = (a[0] - lon) * kx, ay = (a[1] - lat) * ky, bx = (b[0] - lon) * kx, by = (b[1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  /** Name of the closest named road line within maxM metres of the point, or null. Features are GeoJSON-like. */
  function nearestRoadName(features, lat, lon, maxM = 30) {
    let best = null, bestM = maxM;
    for (const f of features || []) {
      const name = nameOf(f && f.properties);
      const g = f && f.geometry;
      if (!name || !g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const ln of lines) {
        for (let i = 1; i < ln.length; i++) {
          const m = segmentDistanceM(lat, lon, ln[i - 1], ln[i]);
          if (m < bestM) { bestM = m; best = name; }
        }
      }
    }
    return best;
  }

  /** Metres driven per road name -> the road that carried at least `share` of the drive, or null. */
  function mainRoad(metresByName, totalM, share = 1 / 3) {
    let best = null, bestM = 0;
    for (const [name, m] of Object.entries(metresByName || {})) if (m > bestM) { bestM = m; best = name; }
    return best && totalM > 0 && bestM >= share * totalM ? best : null;
  }

  // A road's name as a sign or a map's label shortens it, for a line that must fit (REVIEW4 U-100: Tapedeck's wide dot font
  // put "Quiet · Northwest Expressway · next corner 0.7 mi" on three lines): the compass word first or last ("NW"), the kind
  // of road last ("Expy", "Rd"). A ref ("I-275") or a name with neither is left as it is.
  const COMPASS = { northwest: 'NW', northeast: 'NE', southwest: 'SW', southeast: 'SE', north: 'N', south: 'S', east: 'E', west: 'W' };
  const KIND = { road: 'Rd', street: 'St', avenue: 'Ave', drive: 'Dr', highway: 'Hwy', expressway: 'Expy', freeway: 'Fwy',
    parkway: 'Pkwy', boulevard: 'Blvd', lane: 'Ln', court: 'Ct', turnpike: 'Tpke', place: 'Pl', terrace: 'Ter', trail: 'Trl', circle: 'Cir', mountain: 'Mtn' };
  function shortRoadName(name) {
    if (typeof name !== 'string') return name;
    const w = name.trim().split(/\s+/);
    if (w.length < 2) return name.trim();
    const last = w.length - 1, kind = KIND[w[last].toLowerCase()];
    if (kind) w[last] = kind;
    const first = COMPASS[w[0].toLowerCase()];
    if (first && w.length > 2) w[0] = first;                     // "North Road" stays a name, "North Main Street" is "N Main St"
    else if (!kind && COMPASS[w[last].toLowerCase()] && w.length > 2) w[last] = COMPASS[w[last].toLowerCase()];
    return w.join(' ');
  }

  // U-137: the binnacle's road name through a junction. The tiles' nearest name drops out for a beat where roads meet ("Road:
  // --" in a junction the strip was calling), so the last name is held for HOLD_MS after the matcher has none, and for as
  // long as the car is inside a junction the app knows about (`inJunction`). A new name always wins at once.
  // hold: { name, at } (the last name seen and when), or null; returns the name to show and the hold to keep.
  const HOLD_MS = 5000;
  function holdRoadName(hold, name, now, inJunction = false) {
    if (typeof name === 'string' && name.trim()) return { name, hold: { name, at: now } };
    if (hold && hold.name && (inJunction || now - hold.at <= HOLD_MS)) return { name: hold.name, hold: inJunction ? { name: hold.name, at: now } : hold };
    return { name: null, hold: null };
  }

  /**
   * An imported drive's main road (IDEAS U-04): every `stepM` metres along it ({ lat[], lon[], dist[]? }, dist from the
   * start; 5 m a sample without it), the named road line nearest (nearestRoadName), totalled, then mainRoad. null when no
   * road carried a third of it.
   */
  function roadOfTrack(features, t, stepM = 150) {
    if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return null;
    const dist = Array.isArray(t.dist) && t.dist.length === t.lat.length ? t.dist : t.lat.map((_, i) => i * 5);
    const total = dist[dist.length - 1] - dist[0];
    if (!(total > 0)) return null;
    const by = {};
    let next = dist[0];
    for (let i = 0; i < t.lat.length; i++) {
      if (!(dist[i] >= next)) continue;
      next = dist[i] + stepM;
      const name = nearestRoadName(features, t.lat[i], t.lon[i]);
      if (name) by[name] = (by[name] || 0) + stepM;
    }
    return mainRoad(by, total);
  }
  /** Is an imported drive's name only a stand-in: missing, its file's name, or a date ("Drive 10/26/2026 5:03 PM",
   *  "web_20261027_080000")? A name the driver gave it in the app is kept. */
  function isStandInName(name, fileName = '') {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) return true;
    if (fileName && n === String(fileName).replace(/\.csv$/i, '')) return true;
    return /^web_\d{8}_\d{6}$/.test(n) || /^Drive \d{1,2}\/\d{1,2}\/\d{4}\b/.test(n);
  }

  const api = { nearestRoadName, mainRoad, shortRoadName, holdRoadName, HOLD_MS, roadOfTrack, isStandInName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadNames = api;
})(typeof window !== 'undefined' ? window : globalThis);
