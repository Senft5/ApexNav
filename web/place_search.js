// Search that knows roads (IDEAS U-19): what you type in Where to? first matches your own stages and spots by name (a
// stage goes to its start), then the map search, from which roads you can't drive (cycleways, paths, footways, steps,
// bridleways) are left out, so "Tail of the Dragon" finds the road and the shop at it, not a bike path in Iowa.
// Pure (tests/test_place_search.py).
(function (root) {
  'use strict';
  const NOT_DRIVABLE = new Set(['cycleway', 'footway', 'path', 'steps', 'bridleway', 'pedestrian', 'track', 'corridor', 'via_ferrata']);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /** Your stages ({ name, lat0, lon0 }) and spots ({ name, lat, lon }) whose name holds every word typed: [{ label, lat, lon, kind }]. */
  function localMatches(q, stages, spots, max = 4) {
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length || norm(q).length < 2) return [];
    const has = (name) => { const n = norm(name); return words.every((w) => n.includes(w)); };
    const out = [];
    for (const s of stages || []) if (s && s.name && Number.isFinite(s.lat0) && Number.isFinite(s.lon0) && has(s.name)) out.push({ label: s.name, lat: s.lat0, lon: s.lon0, kind: 'Your stage' });
    for (const h of spots || []) if (h && h.name && Number.isFinite(h.lat) && Number.isFinite(h.lon) && has(h.name)) out.push({ label: h.name, lat: h.lat, lon: h.lon, kind: 'Spot' });
    const seen = new Set();
    return out.filter((p) => { const k = norm(p.label); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
  }

  /** Map search features you can drive to: not a cycleway, path, footway... (Photon's osm_key/osm_value). */
  const drivable = (feature) => {
    const p = (feature && feature.properties) || {};
    return !(p.osm_key === 'highway' && NOT_DRIVABLE.has(p.osm_value));
  };

  const api = { localMatches, drivable, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlaceSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
