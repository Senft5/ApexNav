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

  const api = { nearestRoadName, mainRoad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadNames = api;
})(typeof window !== 'undefined' ? window : globalThis);
