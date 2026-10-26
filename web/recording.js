// Drive recordings: parse an ApexDrive CSV into a profiled drive and keep it in IndexedDB (shared by the cockpit and the analysis page).
// Recordings can be several MB, so they live in IndexedDB ('apexnav' / 'drives'), not localStorage.
(function (root) {
  const MPH = 2.2369362921;
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('apexnav', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drives', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  async function all() {
    try {
      const db = await idb();
      return await new Promise((res) => { const q = db.transaction('drives').objectStore('drives').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
    } catch (_) { return []; }
  }
  async function store(d) {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('drives', 'readwrite'); t.objectStore('drives').put(d); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function remove(id) {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('drives', 'readwrite'); t.objectStore('drives').delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }

  /**
   * ApexDrive CSV (iOS app or the web DRIVE mode): segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,...
   * Blank cells are unknown (NaN) and stay unknown. `meta.date` (ISO) and `meta.source` override what the file name implies.
   */
  function parse(Core, text, fileName, meta = {}) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(',').map((s) => s.trim());
    const cols = Object.fromEntries(head.map((h) => [h, []]));
    for (const line of lines.slice(1)) { const v = line.split(','); head.forEach((h, i) => cols[h].push(v[i] === '' || v[i] === undefined ? NaN : parseFloat(v[i]))); }
    for (const need of ['lat', 'lon', 'speed_mph', 'lon_g', 'lat_g']) if (!cols[need]) throw new Error(`missing column ${need}`);
    // g columns recorded without a value (web GPS has no lateral g when stopped) are zero for the profiler, which needs numbers
    const zeroFill = (a) => a.map((v) => (Number.isFinite(v) ? v : 0));
    const prepared = { ...cols, lon_g: zeroFill(cols.lon_g), lat_g: zeroFill(cols.lat_g) };
    const prof = Core.profileRecording(prepared);
    const stamp = (fileName.match(/(\d{8})_(\d{6})/) || []);
    const date = meta.date || (stamp.length ? `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}T${stamp[2].slice(0, 2)}:${stamp[2].slice(2, 4)}` : new Date().toISOString());
    const nul = (a) => (a ? a.map((v) => (Number.isFinite(v) ? v : null)) : null);
    return {
      id: meta.id || ('rec_' + fileName.replace(/\W+/g, '_')), name: meta.name || fileName.replace(/\.csv$/i, ''), date, source: meta.source || 'imported',
      lat: cols.lat, lon: cols.lon, dist: cols.distance_m || cols.lat.map((_, i) => i * 5), speed_mps: cols.speed_mph.map((v) => v / MPH),
      lon_g: prepared.lon_g, lat_g: prepared.lat_g, elev: cols.elevation_m && cols.elevation_m.some(Number.isFinite) ? cols.elevation_m : null, events: prof.events,
      camber: nul(cols.camber_deg), rough: nul(cols.roughness_rms), crest: nul(cols.crest_vertical_g), kappa: Array.from(Core.computeCurvature(cols.lat, cols.lon).kappa),
      envMps: nul(prof.envMps), sightM: nul(prof.sightM),
    };
  }

  // Adapt the shared Log record without inventing missing road measurements.
  function toTrack(d) {
    return {
      id: d.id, name: d.name, kind: 'drive',
      subtitle: [d.date ? d.date.slice(0, 10) : '', d.source === 'web-gps' ? 'Phone GPS' : 'Imported'].filter(Boolean).join(' · '),
      lat: d.lat, lon: d.lon, dist: d.dist, elev: d.elev,
      speedMps: d.speed_mps, latG: d.lat_g, lonG: d.lon_g, camberDeg: d.camber || null,
      roughG: d.rough || null, envMps: d.envMps || null, sightM: d.sightM || null, limitMps: null,
      events: d.events.map(e => ({ ...e })), sectors: null, sectorM: 500, alpr: null,
    };
  }

  const api = { all, store, remove, parse, toTrack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRecording = api;
})(typeof window !== 'undefined' ? window : globalThis);
