// ApexTwisty — the "Twisty roads" map layer (docs/IDEAS.md U-13).
//
// The same stage finder that plans loops (web/stages.js: map tiles, corner detection, best 2–10 km
// window per road) is run around the map's centre, and its stretches are drawn in two strengths.
// Geometry only: this is the map's shape, never measured road feel, and it is labelled that way.
(function (root) {
  'use strict';

  const STRONG = 5;          // stage score (good corners less a per-km cost) for the bold line
  const SHOWN = 2;           // below this a stretch is not worth drawing
  const MAX_JUNCTIONS_PER_KM = 4;   // housing estates: twisty on the map, not a drive
  const MIN_ZOOM = 10;
  const MAX_STAGES = 600;

  /** 2 = very twisty, 1 = twisty, 0 = not drawn. */
  function tier(s) {
    if (!s || !(s.score >= SHOWN) || s.junctionsPerKm > MAX_JUNCTIONS_PER_KM) return 0;
    return s.score >= STRONG ? 2 : 1;
  }

  const r4 = (v) => Math.round(v * 1e4);
  const keyOf = (s) => `${r4(s.lat[0])},${r4(s.lon[0])},${r4(s.lat[s.lat.length - 1])},${r4(s.lon[s.lon.length - 1])}`;

  /** Adds new stretches to the cache (a Map, oldest first, capped). Returns how many were new. */
  function add(cache, stages) {
    let added = 0;
    for (const s of stages || []) {
      if (!tier(s) || !s.lat || s.lat.length < 2) continue;
      const k = keyOf(s);
      if (cache.has(k)) continue;
      cache.set(k, s);
      added++;
    }
    while (cache.size > MAX_STAGES) cache.delete(cache.keys().next().value);
    return added;
  }

  function geojson(cache) {
    const features = [];
    for (const s of cache.values()) {
      features.push({ type: 'Feature', properties: { t: tier(s) },
        geometry: { type: 'LineString', coordinates: s.lat.map((la, i) => [s.lon[i], la]) } });
    }
    return { type: 'FeatureCollection', features };
  }

  const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 110.54, (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));

  /**
   * Where to look next, or null. view = { lat, lon, zoom, halfDiagKm }; searched = earlier {lat, lon, radiusKm}.
   * The radius covers the visible map (3–10 km). A view centred inside the inner half of an earlier search, at a
   * similar size, is not fetched again: panning a little must not refetch 64 tiles.
   */
  function nextSearch(view, searched) {
    if (!view || !(view.zoom >= MIN_ZOOM) || !Number.isFinite(view.lat) || !Number.isFinite(view.lon)) return null;
    const radiusKm = Math.max(3, Math.min(10, view.halfDiagKm || 0));
    for (const s of searched || []) if (kmBetween(s, view) <= s.radiusKm / 2 && radiusKm <= s.radiusKm * 1.5) return null;
    return { lat: view.lat, lon: view.lon, radiusKm };
  }

  const api = { tier, add, geojson, nextSearch, MIN_ZOOM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTwisty = api;
})(typeof window !== 'undefined' ? window : globalThis);
