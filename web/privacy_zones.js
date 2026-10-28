// Privacy zones (IDEAS Z-02): circles you place (home, work) where nothing is recorded or shared. They live on this phone
// only (localStorage), never on the server. Inside one, the cockpit still shows where you are, but no drive samples are kept,
// no road data is sent, and convoys get no position. Pure apart from load/save, which take the storage to use.
(function (root) {
  'use strict';
  const KEY = 'apex.privacyZones', MAX_ZONES = 10, RADII = [200, 500, 1000], MIN_R = 100, MAX_R = 2000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const metres = (aLat, aLon, bLat, bLon) => Math.hypot((bLat - aLat) * 110540, (bLon - aLon) * 111320 * Math.cos(aLat * Math.PI / 180));

  function valid(z) {
    return !!z && finite(z.lat) && finite(z.lon) && Math.abs(z.lat) <= 90 && Math.abs(z.lon) <= 180 && finite(z.r) && z.r >= MIN_R && z.r <= MAX_R;
  }
  function clean(list) {
    return (Array.isArray(list) ? list : []).filter(valid).slice(0, MAX_ZONES)
      .map((z, i) => ({ id: typeof z.id === 'string' && z.id ? z.id : `z${i}`, name: typeof z.name === 'string' && z.name.trim() ? z.name.trim().slice(0, 40) : 'Private place',
                        lat: z.lat, lon: z.lon, r: Math.round(z.r) }));
  }
  function load(storage) { try { return clean(JSON.parse(storage.getItem(KEY) || '[]')); } catch (_) { return []; } }
  function save(storage, zones) { try { storage.setItem(KEY, JSON.stringify(clean(zones))); return true; } catch (_) { return false; } }

  // A new zone, or null when it can't be added (a bad place or radius, or MAX_ZONES already).
  function add(zones, { lat, lon, r, name }, id = `z${Date.now().toString(36)}`) {
    const z = { id, name, lat, lon, r };
    if (!valid(z) || zones.length >= MAX_ZONES) return null;
    return clean([...zones, z]);
  }
  const remove = (zones, id) => zones.filter((z) => z.id !== id);

  // The zone a point is in, or null. An unknown position is treated as inside nothing (it can't be recorded anyway).
  function zoneAt(zones, lat, lon) {
    if (!finite(lat) || !finite(lon)) return null;
    return zones.find((z) => metres(z.lat, z.lon, lat, lon) <= z.r) || null;
  }

  const api = { load, save, add, remove, zoneAt, clean, KEY, MAX_ZONES, RADII };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPrivacyZones = api;
})(typeof window !== 'undefined' ? window : globalThis);
