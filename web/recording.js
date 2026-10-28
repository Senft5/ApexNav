// Drive recordings: parse an ApexDrive CSV into a profiled drive and keep it in IndexedDB (shared by the cockpit and the analysis page).
// Recordings can be several MB, so they live in IndexedDB ('apexnav' / 'drives'), not localStorage.
(function (root) {
  const MPH = 2.2369362921;
  const HAZARD_VERSION = 1;   // records profiled with bump/crest/dip detection (parse and repair set it)
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
    const gKnown = cols.lat_g.map((v, i) => (Number.isFinite(v) && Number.isFinite(cols.lon_g[i]) ? 1 : 0));
    const stamp = (fileName.match(/(\d{8})_(\d{6})/) || []);
    const date = meta.date || (stamp.length ? `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}T${stamp[2].slice(0, 2)}:${stamp[2].slice(2, 4)}` : new Date().toISOString());
    const nul = (a) => (a ? a.map((v) => (Number.isFinite(v) ? v : null)) : null);
    return {
      id: meta.id || ('rec_' + fileName.replace(/\W+/g, '_')), name: meta.name || fileName.replace(/\.csv$/i, ''), date, source: meta.source || 'imported',
      lat: cols.lat, lon: cols.lon, dist: cols.distance_m || cols.lat.map((_, i) => i * 5), speed_mps: cols.speed_mph.map((v) => v / MPH),
      lon_g: prepared.lon_g, lat_g: prepared.lat_g, g_known: gKnown.every(Boolean) ? null : gKnown, elev: cols.elevation_m && cols.elevation_m.some(Number.isFinite) ? cols.elevation_m : null, events: prof.events,
      camber: nul(cols.camber_deg), rough: nul(cols.roughness_rms), crest: nul(cols.crest_vertical_g), vpeak: nul(cols.vert_peak_g), kappa: Array.from(Core.computeCurvature(cols.lat, cols.lon).kappa),
      envMps: nul(prof.envMps), sightM: nul(prof.sightM), hz: HAZARD_VERSION,
    };
  }

  /**
   * Drives saved before 2026-10-26 have NaN corner limits (blank camber cells poisoned the envelope), so their score was NaN.
   * Profiles such a record again from its own stored columns; a healthy record is returned unchanged.
   */
  function repair(Core, d) {
    if (!d || !Array.isArray(d.events)) return d;
    const measuredHazards = [d.crest, d.vpeak].some((a) => Array.isArray(a) && a.some(Number.isFinite));
    const stale = d.hz !== HAZARD_VERSION && measuredHazards;        // saved before hazards were found on phone drives
    if (!stale && d.events.every((e) => e.type !== 'corner' || Number.isFinite(e.apex_mph))) return d;
    const nan = (a) => (a ? a.map((v) => (v == null ? NaN : v)) : undefined);
    const prof = Core.profileRecording({ lat: d.lat, lon: d.lon, distance_m: d.dist, speed_mph: d.speed_mps.map((v) => v * MPH), lon_g: d.lon_g, lat_g: d.lat_g,
      camber_deg: nan(d.camber), roughness_rms: nan(d.rough), crest_vertical_g: nan(d.crest), vert_peak_g: nan(d.vpeak), elevation_m: d.elev || undefined });
    const nul = (a) => a.map((v) => (Number.isFinite(v) ? v : null));
    return { ...d, events: prof.events, envMps: nul(prof.envMps), sightM: nul(prof.sightM), hz: HAZARD_VERSION };
  }

  // Adapt the shared Log record without inventing missing road measurements.
  function toTrack(d) {
    return {
      id: d.id, name: root.ApexFormat ? root.ApexFormat.driveName(d.name) : d.name, kind: 'drive',
      subtitle: [d.date ? d.date.slice(0, 10) : '', d.source === 'web-gps' ? 'Phone GPS' : 'Imported'].filter(Boolean).join(' · '),
      lat: d.lat, lon: d.lon, dist: d.dist, elev: d.elev,
      speedMps: d.speed_mps, latG: d.lat_g, lonG: d.lon_g, camberDeg: d.camber || null,
      roughG: d.rough || null, envMps: d.envMps || null, sightM: d.sightM || null, limitMps: null,
      events: d.events.map(e => ({ ...e })), sectors: null, sectorM: 500, alpr: null,
    };
  }

  /** Corners whose g is measured all the way through (g_known: 1 = measured, 0 = blank and zero-filled); unknown g is never scored as smooth. */
  const scorableCorners = (d, corners) => (!d.g_known ? corners
    : corners.filter((c) => { for (let q = c.start; q <= c.end; q++) if (!d.g_known[q]) return false; return true; }));

  const HAZARDS = new Set(['bump', 'crest', 'dip']);
  const PASS_M = 15;        // another drive went over the spot (its path within this of the hazard)
  const SAME_SPOT_M = 25;   // and found the same kind of hazard this close (GPS at 1 Hz, 5 m samples)
  const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180), (lat2 - lat1) * 110540);
  const heading = (d, i) => {
    const a = Math.max(0, i - 2), b = Math.min(d.lat.length - 1, i + 2), c = Math.cos(d.lat[i] * Math.PI / 180);
    return [(d.lon[b] - d.lon[a]) * 111320 * c, (d.lat[b] - d.lat[a]) * 110540];
  };

  /**
   * Pothole/crest/dip confirmation across your own drives: each hazard event gets seen = { hits, passes }, counting this
   * drive. A pass is another drive over the same spot in the same direction that could have measured it (vertical peak
   * for bumps, crest for crests and dips, at 2.5 m/s or more); a hit is a pass that found the same kind of hazard there.
   * Returns new records; the stored ones are not changed.
   */
  function corroborate(records) {
    const CELL = 0.0003, CELL_LON = 0.0006;                                   // degrees: wider than PASS_M up to about 77 degrees latitude
    const key = (la, lo) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL_LON)}`;
    const grids = new Map();
    const grid = (d) => {                                                     // sample indices by cell, built when first needed
      if (!grids.has(d)) {
        const g = new Map();
        for (let i = 0; i < d.lat.length; i++) { const k = key(d.lat[i], d.lon[i]); if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
        grids.set(d, g);
      }
      return grids.get(d);
    };
    const near = (d, la, lo) => {
      const g = grid(d), r = Math.floor(la / CELL), c = Math.floor(lo / CELL_LON), out = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(...(g.get(`${r + dr},${c + dc}`) || []));
      return out;
    };
    const measured = (d, h, j) => {
      const col = h.type === 'bump' ? d.vpeak : d.crest;
      if (!col) return false;
      for (let q = Math.max(0, j - 2); q <= Math.min(col.length - 1, j + 2); q++) if (Number.isFinite(col[q]) && d.speed_mps[q] >= 2.5) return true;
      return false;
    };
    return records.map((a) => {
      if (!a.events.some((e) => HAZARDS.has(e.type))) return a;
      const events = a.events.map((h) => {
        if (!HAZARDS.has(h.type)) return h;
        const [hx, hy] = heading(a, h.index);
        let hits = 1, passes = 1;
        for (const b of records) {
          if (b === a) continue;
          let j = -1, best = PASS_M;
          for (const i of near(b, h.lat, h.lon)) {
            const m = metres(h.lat, h.lon, b.lat[i], b.lon[i]);
            if (m < best) { best = m; j = i; }
          }
          if (j < 0) continue;
          const [bx, by] = heading(b, j);
          if (!(hx * bx + hy * by > 0) || !measured(b, h, j)) continue;     // the other way (or no heading), or nothing measured there
          passes++;
          // found on this pass: the same kind within SAME_SPOT_M along b's own path at the spot (not on a return leg)
          if (b.events.some((e) => e.type === h.type && Math.abs(e.dist_m - b.dist[j]) <= SAME_SPOT_M)) hits++;
        }
        return { ...h, seen: { hits, passes } };
      });
      return { ...a, events };
    });
  }

  /** "Confirmed on 3 of 4 drives", "Seen on 1 of 3 drives" or "Driven once" for a hazard event. */
  function seenLabel(e) {
    const s = e.seen;
    if (!s || s.passes < 2) return 'Driven once';
    return `${s.hits >= 2 ? 'Confirmed' : 'Seen'} on ${s.hits} of ${s.passes} drives`;
  }

  const api = { all, store, remove, parse, repair, scorableCorners, toTrack, corroborate, seenLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRecording = api;
})(typeof window !== 'undefined' ? window : globalThis);
