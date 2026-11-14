// How sure the phone is of where you are (as Apple and Google Maps draw it): a faint disc round the arrow, as wide on the
// map as the fix's accuracy, shown only when it reaches past the arrow. A fix without an accuracy draws none: unknown
// stays unknown. Pure (tests/test_gps_halo.py); cockpit.js paints it round the idle puck.
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

  const api = { radiusPx, metresPerPx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexGpsHalo = api;
})(typeof window !== 'undefined' ? window : globalThis);
