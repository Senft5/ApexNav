// Privacy zones (IDEAS Z-02), "home zones" on the friends layer: circles you place (home, work) where nothing is recorded
// or shared. They live on this phone (localStorage); only while you show yourself on the map (friends_map.js) does a copy
// go to the server, so it can drop a position inside one too, and choosing Nobody deletes it. Inside one, the cockpit still shows where you are, but no drive samples are kept,
// no road data is sent, convoys get no position, and no "near me" lookup goes out (VI-1, cell below). Pure apart from load/save, which take the storage to use.
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

  // ---- VI-1: "near me" lookups ask by a coarse cell, never by where you are ---------------------------------------
  // The server is asked about the 0.1-degree cell you are in (about 11 km north-south), written with one decimal, and
  // covers the whole cell itself (backend/src/util.ts nearCell); the phone filters and sorts by its own distance. No lookup
  // goes from inside a privacy zone, and none before a drive's private edge (contributor.js privateEdge, 0.5 to 1.5 km).
  const CELL_DEG = 0.1;
  function cell(lat, lon) {
    if (!finite(lat) || !finite(lon)) return null;
    const r = (x) => Math.round(x * 10) / 10, c = { lat: r(lat), lon: r(lon) };
    return { ...c, key: `${c.lat.toFixed(1)},${c.lon.toFixed(1)}` };
  }
  // the query string for a cell lookup, or '' when the point is unknown
  function cellQuery(lat, lon, km) {
    const c = cell(lat, lon);
    if (!c) return '';
    return `lat=${c.lat.toFixed(1)}&lon=${c.lon.toFixed(1)}${km == null ? '' : `&km=${Math.max(1, Math.round(km))}`}`;
  }
  // may a lookup go now? Not from an unknown place, not inside a zone, not before `edgeM` of the drive is behind you
  function mayLookUp(zones, lat, lon, drivenM = Infinity, edgeM = 0) {
    if (!finite(lat) || !finite(lon) || zoneAt(zones, lat, lon)) return false;
    return !(drivenM < edgeM);
  }
  // rows within km of a point, nearest first, each with its own `m` measured here (the server's is from the cell's centre)
  function nearFirst(rows, lat, lon, km, latKey = 'lat', lonKey = 'lon') {
    return (Array.isArray(rows) ? rows : []).filter((r) => r && finite(r[latKey]) && finite(r[lonKey]))
      .map((r) => ({ ...r, m: Math.round(metres(lat, lon, r[latKey], r[lonKey])) }))
      .filter((r) => r.m <= km * 1000).sort((a, b) => a.m - b.m);
  }
  // a per-cell cache: get(key) gives what was kept for that cell within ttlMs, or undefined
  function cellCache(ttlMs = 120000, max = 12) {
    const m = new Map();
    return {
      get(key, now = Date.now()) { const e = m.get(key); return e && now - e.at < ttlMs ? e.v : undefined; },
      set(key, v, now = Date.now()) { m.delete(key); m.set(key, { at: now, v }); while (m.size > max) m.delete(m.keys().next().value); },
      clear() { m.clear(); },
    };
  }

  const api = { load, save, add, remove, zoneAt, clean, cell, cellQuery, mayLookUp, nearFirst, cellCache, metres, CELL_DEG, KEY, MAX_ZONES, RADII };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPrivacyZones = api;
})(typeof window !== 'undefined' ? window : globalThis);
