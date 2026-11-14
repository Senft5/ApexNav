// The road's surface on a drive (conditions-aware analysis): dry, wet or icy, from what the app already knows while you
// drive. The weather where you are (wet_roads.js stateOf, the place plate's word) and ODOT's road weather sensors near
// you (road_events.js rows of kind 'wet' / 'ice' from backend/src/traffic.ts parseOhgoWeather). The worst seen on the
// drive is kept on its record (`d.surface`), so your passes of a road compare like with like: a wet pass against wet
// ones, never against your dry best. Unknown stays unknown (null): no weather word and no sensor is not a dry road.
// Pure (tests/test_road_surface.py).
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const RANK = { dry: 1, wet: 2, ice: 3 };
  const SENSOR_KM = 8;                                              // a sensor this near reads the roads you are on
  const ok = (s) => (s === 'dry' || s === 'wet' || s === 'ice' ? s : null);

  /** The worse of two states (ice over wet over dry); null only when both are unknown. */
  function worse(a, b) {
    const x = ok(a), y = ok(b);
    if (!x) return y;
    if (!y) return x;
    return RANK[y] > RANK[x] ? y : x;
  }

  /** The worst ODOT sensor reading within km of a point: 'wet' | 'ice' | null (sensors report only wet or icy sites). */
  function sensorAt(events, lat, lon, km = SENSOR_KM) {
    if (!Array.isArray(events) || !finite(lat) || !finite(lon)) return null;
    const c = Math.cos(lat * Math.PI / 180);
    let out = null;
    for (const e of events) {
      if (!e || (e.kind !== 'wet' && e.kind !== 'ice') || !/sensor/i.test(String(e.src || '')) || !finite(e.lat) || !finite(e.lon)) continue;
      const dx = (e.lon - lon) * c * 111.32, dy = (e.lat - lat) * 110.54;
      if (dx * dx + dy * dy <= km * km) out = worse(out, e.kind);
    }
    return out;
  }

  /** A drive's log: see(state) as the drive goes, value() the worst seen (null when nothing was ever known). */
  function createLog() {
    let worst = null;
    return { see(s) { worst = worse(worst, s); return worst; }, value: () => worst };
  }

  /** A drive's surface as stored ('dry' | 'wet' | 'ice'), or null when it wasn't known. */
  const of = (d) => ok(d && d.surface);
  /** A slippery surface: wet or icy. */
  const slick = (s) => ok(s) === 'wet' || ok(s) === 'ice';

  /**
   * Whether two passes compare like with like: a wet (or icy) pass only with another of the same, a dry or unknown one
   * with dry or unknown ones (most drives before this was kept are unknown, and nearly all of them dry).
   */
  function alike(a, b) {
    const x = ok(a), y = ok(b);
    if (slick(x) || slick(y)) return x === y;
    return true;
  }

  const WORDS = { dry: 'Dry road', wet: 'Wet road', ice: 'Icy road' };
  /** The word for the drive page and the Log ('' for dry or unknown: a dry road needs no tag). */
  const label = (s) => (slick(s) ? WORDS[ok(s)] : '');

  const api = { worse, sensorAt, createLog, of, slick, alike, label, SENSOR_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadSurface = api;
})(typeof window !== 'undefined' ? window : globalThis);
