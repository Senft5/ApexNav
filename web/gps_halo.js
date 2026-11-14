// How sure the phone is of where you are (as Apple and Google Maps draw it): a faint disc round the arrow, as wide on the
// map as the fix's accuracy, shown only when it reaches past the arrow. A fix without an accuracy draws none: unknown
// stays unknown. And the heading beam: where the phone points, from the app's compass, while standing or walking.
// Pure (tests/test_gps_halo.py); cockpit.js paints both round the idle puck.
(function (root) {
  'use strict';
  const EARTH_M = 40075016.686, TILE = 512;                          // MapLibre's world at zoom 0 is one 512 px tile
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Metres per CSS pixel on the map at `lat` and `zoom`. */
  const metresPerPx = (lat, zoom) => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (TILE * Math.pow(2, zoom));

  /**
   * The disc's radius in px for an accuracy of `accM` metres, or 0 when there is none to draw: no accuracy, a bad
   * number, or a disc that stays under the arrow (`puckPx`, its radius, plus a margin). Capped at `maxPx`.
   */
  function radiusPx(accM, lat, zoom, puckPx = 13, maxPx = 1600) {
    if (!finite(accM) || accM <= 0 || !finite(lat) || Math.abs(lat) > 85 || !finite(zoom)) return 0;
    const r = accM / metresPerPx(lat, zoom);
    return r < puckPx + 6 ? 0 : Math.min(maxPx, Math.round(r));
  }

  /**
   * The heading beam (Apple Maps' cone from the dot): where the phone points, in compass degrees 0-360, or null for no beam:
   * no compass reading, or moving faster than `walkMps` (in a car the arrow already points along the road, by the course).
   */
  function beam(headingDeg, speedMps, walkMps = 3) {
    if (!finite(headingDeg) || headingDeg < 0 || headingDeg > 360) return null;
    if (finite(speedMps) && speedMps > walkMps) return null;
    return headingDeg % 360;
  }

  const api = { radiusPx, metresPerPx, beam };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexGpsHalo = api;
})(typeof window !== 'undefined' ? window : globalThis);
