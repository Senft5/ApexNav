// Drive recordings: parse an ApexDrive CSV into a profiled drive and keep it in IndexedDB (shared by the cockpit and the analysis page).
// Recordings can be several MB, so they live in IndexedDB ('apexnav' / 'drives'), not localStorage.
(function (root) {
  const MPH = 2.2369362921;
  const HAZARD_VERSION = 1;   // records profiled with bump/crest/dip detection (parse and repair set it)
  let dbp = null;
  // v3 (REVIEW_FEEL F-06): 'summaries' holds a few hundred bytes per drive (its name, date, length, score, corners, box),
  // so the Log lists a year of drives without reading 1.6 MB of rows each. Opening v3 only adds the store: 'drives' is
  // never touched by the upgrade, so every drive already on a phone stays; summaries() builds the missing ones from the
  // drives' own rows the first time it is asked (in the analysis worker, off the page's thread).
  const DB_VERSION = 3, SUMMARY_VERSION = 1;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      // v2 (Round 3, drive_keep.js): 'keep' holds the drive in progress, a head and its row chunks, until it is saved
      const r = indexedDB.open('apexnav', DB_VERSION);
      r.onupgradeneeded = () => {
        const names = r.result.objectStoreNames;
        if (!names.contains('drives')) r.result.createObjectStore('drives', { keyPath: 'id' });
        if (!names.contains('keep')) r.result.createObjectStore('keep', { keyPath: 'key' });
        if (!names.contains('summaries')) r.result.createObjectStore('summaries', { keyPath: 'id' });
      };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
      r.onerror = () => { dbp = null; rej(r.error); };
      r.onblocked = () => {};                                         // an older page still holds v2: it closes on versionchange
    });
    return dbp;
  }
  const req = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  async function all() {
    try {
      const db = await idb();
      return await new Promise((res) => { const q = db.transaction('drives').objectStore('drives').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
    } catch (_) { return []; }
  }
  /** One drive's full record, or null. */
  async function get(id) {
    try { const db = await idb(); return (await req(db.transaction('drives').objectStore('drives').get(id))) || null; } catch (_) { return null; }
  }
  /** The ids of every saved drive (no rows read). */
  async function ids() {
    try { const db = await idb(); return (await req(db.transaction('drives').objectStore('drives').getAllKeys())) || []; } catch (_) { return []; }
  }
  const finiteN = (v) => typeof v === 'number' && Number.isFinite(v);
  /**
   * What the Log's list, the end card and the Garage need of a drive, from its own record: no row is copied, nothing is
   * estimated (a score without clean corners stays null). Null without the core (the drive is summarised later).
   */
  function summarize(Core, d) {
    if (!Core || !d || !d.id || !Array.isArray(d.lat)) return null;
    let ds = { score: null, corners: 0, components: null }, corners = [];
    try { const s = scoreOf(Core, d); ds = s.ds; corners = s.corners.map((c) => [c.start, c.end, c.apex]); } catch (_) {}
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (let i = 0; i < d.lat.length; i++) { const la = d.lat[i], lo = d.lon[i]; if (!finiteN(la) || !finiteN(lo)) continue; if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    let secs = null;
    try { const T = Core.elapsedS(d.speed_mps); secs = finiteN(T[T.length - 1]) ? T[T.length - 1] : null; } catch (_) { secs = null; }
    const len = Array.isArray(d.dist) && d.dist.length ? d.dist[d.dist.length - 1] : null;
    return {
      id: d.id, sv: SUMMARY_VERSION, name: d.name, date: d.date, date_known: d.date_known, source: d.source,
      len_m: finiteN(len) ? len : null, n: d.lat.length, secs, bbox: s <= n ? [s, n, w, e] : null,
      ds: { score: ds.score, corners: ds.corners || 0, components: ds.components || null }, corners,
      tags: d.tags, note: d.note, ended: d.ended, contributed: d.contributed, car: d.car ? { label: d.car.label } : undefined,
      battery: d.battery, laps: Array.isArray(d.laps) ? d.laps.length : undefined,
      feel: !!(d.rough && d.kappa),                                  // ApexContributor.eligible asks for both
    };
  }
  async function store(d) {
    const db = await idb(), sum = summarize(root.ApexCore, d);
    const t = db.transaction(['drives', 'summaries'], 'readwrite');
    t.objectStore('drives').put(d);
    if (sum) t.objectStore('summaries').put(sum); else t.objectStore('summaries').delete(d.id);   // rebuilt when next listed
    await done(t);
    return sum;
  }
  /** Changes a few fields of a stored drive (tags, a note, shared) in one transaction; its summary follows. */
  const META = ['name', 'tags', 'note', 'contributed', 'ended'];
  async function patch(id, fields) {
    const db = await idb(), t = db.transaction(['drives', 'summaries'], 'readwrite');
    const ds = t.objectStore('drives'), ss = t.objectStore('summaries');
    let out = null;
    ds.get(id).onsuccess = (e) => {
      const d = e.target.result;
      if (!d) return;
      ds.put(Object.assign(d, fields));
      ss.get(id).onsuccess = (f) => {
        const old = f.target.result, cheap = old && old.sv === SUMMARY_VERSION && Object.keys(fields).every((k) => META.includes(k));
        out = cheap ? Object.assign(old, ...META.filter((k) => k in fields).map((k) => ({ [k]: fields[k] }))) : summarize(root.ApexCore, d);
        if (out) ss.put(out); else ss.delete(id);
      };
    };
    await done(t);
    return out;
  }
  /**
   * Every saved drive's summary, newest last by date. Missing or outdated ones are built from the drive's rows, each in
   * the transaction that reads it (so a drive saved meanwhile is never summarised from its older self), and summaries of
   * drives that are gone are dropped. The drives store is only read. Core null: only what is there (list.missing says
   * how many are not), never a drive's rows.
   */
  async function summaries(Core = root.ApexCore) {   // (null: read only)
    let db;
    try { db = await idb(); } catch (_) { return []; }
    const t0 = db.transaction(['drives', 'summaries']);
    const [keys, sums] = await Promise.all([req(t0.objectStore('drives').getAllKeys()), req(t0.objectStore('summaries').getAll())]);
    const have = new Map((sums || []).filter((x) => x && x.sv === SUMMARY_VERSION).map((x) => [x.id, x]));
    const live = new Set(keys), gone = (sums || []).filter((x) => x && !live.has(x.id)).map((x) => x.id);
    for (const id of keys) {
      if (have.has(id) || !Core) continue;
      const t = db.transaction(['drives', 'summaries'], 'readwrite');
      t.objectStore('drives').get(id).onsuccess = (e) => {
        const x = summarize(Core, e.target.result);
        if (x) { t.objectStore('summaries').put(x); have.set(id, x); }
      };
      try { await done(t); } catch (_) {}
    }
    if (gone.length) {
      const t = db.transaction('summaries', 'readwrite');
      for (const id of gone) t.objectStore('summaries').delete(id);
      try { await done(t); } catch (_) {}
    }
    const out = keys.map((k) => have.get(k)).filter(Boolean).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    out.missing = keys.length - out.length;                         // with no core: drives still to summarise (in the worker)
    return out;
  }
  async function remove(id) {
    const db = await idb();
    const t = db.transaction(['drives', 'summaries'], 'readwrite');
    t.objectStore('drives').delete(id); t.objectStore('summaries').delete(id);
    await done(t);
  }

  // The drive in progress (drive_keep.js): a checkpoint is its head and one chunk of new rows, written in one transaction,
  // so what is kept is always a head with every chunk it names.
  async function keepPut(head, chunk) {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction('keep', 'readwrite'), s = t.objectStore('keep');
      s.put({ ...chunk, key: `${chunk.id}:c${String(chunk.n).padStart(6, '0')}`, kind: 'chunk' });
      s.put({ ...head, key: `${head.id}:h`, kind: 'head' });
      t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  /** Every drive in progress: [{ id, head (or null), chunks }]. */
  async function keepAll() {
    try {
      const db = await idb();
      const recs = await new Promise((res) => { const q = db.transaction('keep').objectStore('keep').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
      const by = new Map();
      for (const r of recs) {
        if (!by.has(r.id)) by.set(r.id, { id: r.id, head: null, chunks: [] });
        if (r.kind === 'head') by.get(r.id).head = r; else by.get(r.id).chunks.push(r);
      }
      return [...by.values()];
    } catch (_) { return []; }
  }
  async function keepRemove(id) {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction('keep', 'readwrite');
      t.objectStore('keep').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
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
      id: meta.id || ('rec_' + fileName.replace(/\W+/g, '_')), name: meta.name || fileName.replace(/\.csv$/i, ''), date, date_known: !!(meta.date || stamp.length), source: meta.source || 'imported',
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

  /**
   * A record's corner events in the shape Core.driverScore and Core.coach take (5 m bins), with the corner limit for the car
   * it was driven in (d.car.mu, IDEAS D-19: only ever lower than the street default). A drive without a car: as recorded.
   */
  const cornersOf = (d) => {
    const list = d.events.filter((e) => e.type === 'corner').map((e) => ({ start: Math.round(e.start_m / 5), end: Math.round(e.end_m / 5), apex: e.index,
      apex_mps: e.apex_mph / MPH, code: e.code, call: e.call, dir: e.dir, severity: e.severity, turn_rad: e.turn_rad, mods: e.mods || [] }));
    const Core = root.ApexCore;
    return d.car && Number.isFinite(d.car.mu) && Core && Core.cornersForCar ? Core.cornersForCar(list, d.car.mu) : list;
  };

  /**
   * U-91: the drive's Vetta Score, the one way every page computes it (the end card, the live score, the Log, the Garage):
   * the record repaired, its corners for its car, only those with measured g. Returns { ds, corners }; ds.score is null
   * (shown "--") when there are not enough clean corners, never NaN.
   */
  function scoreOf(Core, d) {
    const x = repair(Core, d), corners = cornersOf(x);
    let ds = null;
    try { ds = Core.driverScore(x.speed_mps, x.lon_g, x.lat_g, scorableCorners(x, corners)); } catch (_) { ds = null; }
    return { ds: ds && Number.isFinite(ds.score) ? ds : { ...(ds || {}), score: null }, corners };
  }

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

  const api = { all, get, ids, store, patch, summaries, summarize, remove, keepPut, keepAll, keepRemove, parse, repair, scorableCorners, toTrack, corroborate, seenLabel, cornersOf, scoreOf, DB_VERSION, SUMMARY_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRecording = api;
})(typeof window !== 'undefined' ? window : globalThis);
