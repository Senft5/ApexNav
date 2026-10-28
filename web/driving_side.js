// Which side of the road people drive on (IDEAS U-22), for sight distance: on bends toward your own side you sit half a
// lane nearer the inside edge (apex_core sightDistanceM keepSide). Left-hand traffic from coarse boxes around the
// countries that drive on the left; everywhere else the right. A box edge near a border can be wrong; the effect of a
// wrong answer is only more caution on the other bends, never less. Settings → Units can set it by hand.
(function (root) {
  'use strict';
  // [south, west, north, east]
  const LEFT = [
    [49.9, -8.7, 60.9, 1.45],  // Great Britain (east edge stops short of Calais and Boulogne)
    [51.3, -10.7, 55.5, -5.4], // Ireland and Northern Ireland
    [24.0, 122.9, 45.6, 146.0], // Japan
    [-44.0, 112.0, -10.0, 154.5], [-47.5, 166.0, -34.0, 179.0],   // Australia, New Zealand
    [6.5, 60.8, 37.1, 92.0],   // Pakistan, India, Nepal, Bhutan, Bangladesh, Sri Lanka
    [-35.0, 16.0, -17.5, 33.0], [-11.7, 29.6, 5.0, 41.9],         // southern Africa; Kenya, Tanzania, Uganda
    [-11.0, 95.0, 6.0, 141.5], [0.8, 99.6, 7.4, 119.3], [5.6, 97.3, 20.5, 105.7],   // Indonesia, Malaysia and Singapore, Thailand
    [22.1, 113.5, 22.56, 114.5], // Hong Kong and Macau
    [17.7, -78.4, 18.6, -76.1], [20.9, -79.4, 27.3, -72.7], [10.0, -61.95, 11.4, -60.5],   // Jamaica, the Bahamas, Trinidad
    [34.5, 32.2, 35.7, 34.6], [35.8, 14.1, 36.1, 14.6],          // Cyprus, Malta
    [1.1, -61.4, 8.6, -53.9],  // Guyana, Suriname
  ];
  const KEY = 'apex.drivingSide';
  const inBox = (lat, lon, b) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  /** 'left' or 'right' for a point; null when the point is unknown. */
  function at(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return LEFT.some((b) => inBox(lat, lon, b)) ? 'left' : 'right';
  }
  /** The saved choice: 'auto' (default), 'left' or 'right'. */
  function choice(storage = root.localStorage) {
    try { const v = storage && storage.getItem(KEY); return v === 'left' || v === 'right' ? v : 'auto'; } catch (_) { return 'auto'; }
  }
  function setChoice(v, storage = root.localStorage) {
    try { if (v === 'left' || v === 'right') storage.setItem(KEY, v); else storage.removeItem(KEY); } catch (_) {}
  }
  /** The side for a route starting at (lat, lon): your choice, else where it is. */
  const forRoute = (lat, lon, storage) => { const c = choice(storage); return c === 'auto' ? at(lat, lon) : c; };

  const api = { at, choice, setChoice, forRoute, LEFT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDrivingSide = api;
})(typeof window !== 'undefined' ? window : globalThis);
