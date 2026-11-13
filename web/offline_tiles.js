// Offline areas (IDEAS F-02): the map, its labels and the terrain for an area, saved on the phone so the map, loops,
// Explore and climbs work with no signal. Map requests go through an `apexc://` MapLibre protocol: a saved copy first,
// else the network (and the style, its data description and label fonts are kept as they arrive, so a saved area opens
// offline). Tiles live in IndexedDB ('apexnav-tiles'); the areas list in apex.offlineAreas. Pure parts are tested
// (tests/test_offline_tiles.py).
(function (root) {
  'use strict';
  const DB = 'apexnav-tiles', STORE = 'tiles', AREAS = 'apex.offlineAreas', MAX_TILES = 2500, PROTO = 'apexc';
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  const tileOf = (lat, lon, z) => { const n = 2 ** z, r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
  /** Every tile [z, x, y] covering radiusKm round (lat, lon) for zooms zmin..zmax. */
  function tilesFor(lat, lon, radiusKm, zmin = 8, zmax = 14) {
    const dLat = radiusKm / 110.54, dLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180)), out = [];
    for (let z = zmin; z <= zmax; z++) {
      const [x0, y0] = tileOf(lat + dLat, lon - dLon, z), [x1, y1] = tileOf(lat - dLat, lon + dLon, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    }
    return out;
  }
  /** The plan for an area: map tiles z8-14 and terrain z10-12, shrinking the radius until it fits MAX_TILES. */
  function plan(lat, lon, radiusKm) {
    for (let r = radiusKm; r >= 2; r -= 2) {
      const map = tilesFor(lat, lon, r, 8, 14), dem = tilesFor(lat, lon, r, 10, 12);
      if (map.length + dem.length <= MAX_TILES) return { radiusKm: r, map, dem };
    }
    return { radiusKm: 2, map: tilesFor(lat, lon, 2, 8, 14), dem: tilesFor(lat, lon, 2, 10, 12) };
  }

  /** Every tile [z, x, y] within bufferKm of a line (lat[], lon[]) for zooms zmin..zmax, each once. */
  function tilesAlong(lat, lon, bufferKm, zmin = 8, zmax = 14) {
    const n = Array.isArray(lat) && Array.isArray(lon) ? Math.min(lat.length, lon.length) : 0, out = [];
    for (let z = zmin; z <= zmax; z++) {
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(lat[i]) || !Number.isFinite(lon[i])) continue;
        const dLat = bufferKm / 110.54, dLon = bufferKm / (111.32 * Math.cos(lat[i] * Math.PI / 180));
        const [x0, y0] = tileOf(lat[i] + dLat, lon[i] - dLon, z), [x1, y1] = tileOf(lat[i] - dLat, lon[i] + dLon, z);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x}/${y}`; if (!seen.has(k)) { seen.add(k); out.push([z, x, y]); } }
      }
    }
    return out;
  }
  /** [south, west, north, east] of a line, or null. */
  function boxOf(lat, lon) {
    let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
    for (let i = 0; i < Math.min(lat.length, lon.length); i++) {
      if (!Number.isFinite(lat[i]) || !Number.isFinite(lon[i])) continue;
      s = Math.min(s, lat[i]); n = Math.max(n, lat[i]); w = Math.min(w, lon[i]); e = Math.max(e, lon[i]);
    }
    return Number.isFinite(s) ? [s, w, n, e].map((v) => Math.round(v * 1e5) / 1e5) : null;
  }
  /**
   * The route's line thinned to within `tolKm` (Douglas-Peucker in local km), [[lat, lon], ...] rounded to 1e-5: kept on a
   * route's area so the drive page can tell a drive that stayed in the corridor from one that left it inside the box.
   */
  function lineOf(lat, lon, tolKm = 0.1) {
    const pts = [];
    for (let i = 0; i < Math.min(lat.length, lon.length); i++) if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) pts.push([lat[i], lon[i]]);
    if (pts.length < 2) return null;
    const k = Math.cos(pts[0][0] * Math.PI / 180), X = (p) => p[1] * 111.32 * k, Y = (p) => p[0] * 110.54;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let far = -1, at = -1;
      const ax = X(pts[a]), ay = Y(pts[a]), dx = X(pts[b]) - ax, dy = Y(pts[b]) - ay, L = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const px = X(pts[i]) - ax, py = Y(pts[i]) - ay, t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
        const d = Math.hypot(px - t * dx, py - t * dy); if (d > far) { far = d; at = i; }
      }
      if (far > tolKm) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return pts.filter((_, i) => keep[i]).map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
  }
  const LINE_TOL_KM = 0.1;
  /**
   * The plan for a route (IDEAS F-03): map tiles z8-14 and terrain z10-12 within 1.5 km of it, the corridor narrowing to
   * 0.5 km, then the closest zoom left out, until it fits MAX_TILES. null for no line.
   */
  function planAlong(lat, lon) {
    if (!Array.isArray(lat) || lat.length < 2) return null;
    for (const zmax of [14, 13, 12]) for (const b of [1.5, 1, 0.5]) {
      const map = tilesAlong(lat, lon, b, 8, zmax), dem = tilesAlong(lat, lon, b, 10, Math.min(12, zmax));
      if (map.length + dem.length <= MAX_TILES) return { bufferKm: b, zmax, map, dem };
    }
    return null;
  }

  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((ok, fail) => {
      const r = root.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'url' });
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    return dbp;
  }
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, fail) => { const t = d.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => fail(t.error); }); };
  async function getRec(url) { try { return (await tx('readonly', (s) => s.get(url))) || null; } catch (_) { return null; } }
  async function get(url) { const v = await getRec(url); return v ? v.data : null; }
  // the areas a kept copy belongs to: one tile can serve two areas (a saved route inside a saved area, two areas that
  // overlap), so it is tagged with each, and goes only when the last of them is deleted (an older copy has one `area`)
  const areasOf = (v) => (v && Array.isArray(v.areas) ? v.areas : v && v.area ? [v.area] : []);
  async function put(url, data, area = null) {
    try {
      const d = await db();
      await new Promise((ok, fail) => {
        const t = d.transaction(STORE, 'readwrite'), s = t.objectStore(STORE), g = s.get(url);
        g.onsuccess = () => { const tags = areasOf(g.result); if (area && !tags.includes(area)) tags.push(area); s.put({ url, data, areas: tags, at: Date.now() }); };
        t.oncomplete = ok; t.onerror = () => fail(t.error);
      });
    } catch (_) {}
  }
  async function clear() { try { await tx('readwrite', (s) => s.clear()); } catch (_) {} try { root.localStorage.removeItem(AREAS); } catch (_) {} }

  function areas() { try { const v = JSON.parse(root.localStorage.getItem(AREAS) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function saveAreas(list) { try { root.localStorage.setItem(AREAS, JSON.stringify(list)); } catch (_) {} }
  async function removeArea(id) {
    saveAreas(areas().filter((a) => a.id !== id));
    try {
      const d = await db();
      await new Promise((ok) => { const t = d.transaction(STORE, 'readwrite'), s = t.objectStore(STORE), c = s.openCursor();
        c.onsuccess = () => {
          const cur = c.result; if (!cur) return;
          const tags = areasOf(cur.value);
          if (tags.includes(id)) { const rest = tags.filter((a) => a !== id); if (rest.length) cur.update({ ...cur.value, area: undefined, areas: rest }); else cur.delete(); }
          cur.continue();
        }; t.oncomplete = ok; t.onerror = ok; });
    } catch (_) {}
  }

  // Native speed (big bet #10): the map tiles last seen are kept too, so a launch draws the map from the phone (no network
  // wait, no signal needed for where you were), as Apple Maps and Google Maps open on their last view. At most RECENT_MAX
  // (vector tiles, ~25-60 KB each: ~10-25 MB), the oldest dropped first; a kept one is fetched again after RECENT_DAYS so
  // roads and names don't go stale. A tile that belongs to a saved area is the area's and never dropped here.
  const RECENT_MAX = 400, RECENT_DAYS = 30, TILE_URL = /\/\d+\/\d+\/\d+\.pbf$/;
  /** A kept copy good to draw now: an area's always; a recent one until RECENT_DAYS old. */
  const servable = (v, nowMs) => !!v && (areasOf(v).length > 0 || !v.recent || nowMs - (v.at || 0) < RECENT_DAYS * 86400000);
  /** Which recent tiles to drop: the oldest beyond `max` of those no saved area holds. records: [{ url, at, recent, areas }]. */
  function overflow(records, max = RECENT_MAX) {
    const mine = records.filter((v) => v.recent && !areasOf(v).length).sort((a, b) => (a.at || 0) - (b.at || 0));
    return mine.slice(0, Math.max(0, mine.length - max)).map((v) => v.url);
  }
  let keptSince = 0;
  async function keepRecent(url, data) {
    try {
      const d = await db();
      await new Promise((ok, fail) => {
        const t = d.transaction(STORE, 'readwrite'), s = t.objectStore(STORE), g = s.get(url);
        g.onsuccess = () => { const tags = areasOf(g.result); s.put({ url, data, areas: tags, recent: !tags.length, at: Date.now() }); };
        t.oncomplete = ok; t.onerror = () => fail(t.error);
      });
      if (++keptSince >= 50) { keptSince = 0; trimRecent(); }
    } catch (_) {}
  }
  async function trimRecent() {
    try {
      const d = await db(), recs = [];
      await new Promise((ok) => { const t = d.transaction(STORE, 'readonly'), c = t.objectStore(STORE).openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return; const v = cur.value; if (v.recent) recs.push({ url: v.url, at: v.at, recent: true, areas: areasOf(v) }); cur.continue(); };
        t.oncomplete = ok; t.onerror = ok; });
      const drop = overflow(recs);
      if (drop.length) await tx('readwrite', (s) => { for (const u of drop) s.delete(u); });
    } catch (_) {}
  }

  const KEEP = new Set(['Style', 'Source', 'Glyphs']);   // small, needed to open the map offline: kept as they arrive
  /** For MapLibre's transformRequest: map requests through the protocol; anything else unchanged. */
  const transform = (url, type) => (/^https:\/\/tiles\.openfreemap\.org\//.test(url) && (type === 'Tile' || KEEP.has(type)) ? { url: `${PROTO}://${url}`, type } : undefined);
  /** The protocol: a saved copy first, else the network (keeping the small ones). JSON for json requests, bytes otherwise. */
  function install(maplibregl) {
    maplibregl.addProtocol(PROTO, async (params, abort) => {
      const url = params.url.slice(PROTO.length + 3);
      const kept = await getRec(url);
      let data = servable(kept, Date.now()) ? kept.data : null;
      if (!data) {
        let r = null;
        try { r = await fetch(url, { signal: abort && abort.signal }); } catch (e) { if (kept) r = null; else throw e; }
        if (!r || !r.ok) { if (kept) return { data: params.type === 'json' ? JSON.parse(new TextDecoder().decode(kept.data)) : kept.data }; throw new Error(`HTTP ${r ? r.status : 'offline'}`); }
        data = await r.arrayBuffer();
        if (TILE_URL.test(url)) keepRecent(url, data.slice(0));   // a copy: MapLibre hands the bytes on to its worker (detached)
        else if (params.type === 'json' || /\/styles\/|\/planet$|\.pbf$/.test(url)) put(url, data);
      }
      return { data: params.type === 'json' ? JSON.parse(new TextDecoder().decode(data)) : data };
    });
  }

  /**
   * Saves the area round (lat, lon): the style, its data description, label fonts, map tiles and terrain. onProgress(done, of).
   * Resolves the area record ({ id, name, lat, lon, radiusKm, tiles, bytes, at }); a failed tile is skipped, not fatal.
   */
  async function download({ lat, lon, radiusKm = 25, name, styleUrl, onProgress, concurrency = 6, along = null, id: areaId = null }) {
    // `along`: a planned route's line ({ lat, lon }): the corridor along it (planAlong) instead of a disc round (lat, lon)
    const p = along ? planAlong(along.lat, along.lon) : plan(lat, lon, radiusKm), id = areaId || `a${Date.now().toString(36)}`;
    if (!p) throw new Error('route too long to keep');
    const keep = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); const b = await r.arrayBuffer(); await put(url, b, id); return b; };
    const style = JSON.parse(new TextDecoder().decode(await keep(styleUrl)));
    const src = Object.values(style.sources || {}).find((s) => s.type === 'vector' && s.url);
    const tilejson = src ? JSON.parse(new TextDecoder().decode(await keep(src.url))) : null;
    const template = tilejson && tilejson.tiles && tilejson.tiles[0];
    if (!template) throw new Error('no map tiles');
    const fonts = new Set();
    for (const l of style.layers || []) { const f = l.layout && l.layout['text-font']; if (Array.isArray(f) && f.every((x) => typeof x === 'string')) fonts.add(f.join(',')); }
    const urls = [];
    if (style.glyphs) for (const f of fonts) for (const range of ['0-255', '256-511', '8192-8447']) urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', range));
    for (const [z, x, y] of p.map) urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    for (const [z, x, y] of p.dem) urls.push(DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    // the route context bundles for the area (route_ctx/context_grid.js), so offline plans keep their traffic and land data
    if (root.ApexContextGrid && !along) { try { urls.push(...await root.ApexContextGrid.urlsNear(lat, lon, p.radiusKm)); } catch (_) {} }
    // Vetta's own road network for the area (web/graph_tiles.js), kept in its IndexedDB store so own routing works offline
    let graph = null;
    if (root.ApexGraphTiles && root.ApexGraphTiles.prefetchArea && !along) {
      const dLat = p.radiusKm / 110.54, dLon = p.radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
      graph = root.ApexGraphTiles.prefetchArea({ s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon }).catch(() => null);
    }
    let done = 0, bytes = 0, k = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (k < urls.length) {
        const url = urls[k++];
        try { bytes += (await keep(url)).byteLength; } catch (_) { /* a missing tile (the sea) is fine */ }
        onProgress && onProgress(++done, urls.length);
      }
    }));
    const g = graph ? await graph : null;
    const area = { id, name: name || 'Saved area', lat, lon, radiusKm: along ? null : p.radiusKm, ...(along ? { alongKm: p.bufferKm, box: boxOf(along.lat, along.lon), line: lineOf(along.lat, along.lon, LINE_TOL_KM), lineTolKm: LINE_TOL_KM } : {}),
      tiles: urls.length, bytes, at: new Date().toISOString(), graphTiles: g ? g.kept : 0 };
    saveAreas([...areas().filter((a) => a.id !== id), area]);
    // ask the browser to keep the saved map under storage pressure (Safari and Chrome may otherwise evict it); best-effort
    try { const st = root.navigator && root.navigator.storage; if (st && st.persist) st.persist().catch(() => {}); } catch (_) {}
    return area;
  }
  /** Adds fields to a saved area's record (members' road feel counts, set after the tiles). */
  function setArea(id, fields) { saveAreas(areas().map((a) => (a.id === id ? { ...a, ...fields } : a))); }
  /** How old a saved area's map is: `stale` after STALE_DAYS (roads, names and closures change), unknown date stays unknown. */
  const STALE_DAYS = 180;
  function ageOf(area, nowMs) {
    const t = area && Date.parse(area.at);
    if (!Number.isFinite(t)) return { days: null, stale: false, month: null };
    const days = Math.max(0, Math.floor((nowMs - t) / 86400000)), d = new Date(t);
    return { days, stale: days >= STALE_DAYS, month: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  }
  /** Bytes saved, from the areas list. */
  const bytesSaved = () => areas().reduce((s, a) => s + (a.bytes || 0), 0);

  const api = { tilesFor, plan, tilesAlong, planAlong, boxOf, lineOf, areasOf, servable, overflow, RECENT_MAX, RECENT_DAYS, transform, install, download, get, put, clear, areas, setArea, removeArea, bytesSaved, ageOf, STALE_DAYS, MAX_TILES, PROTO, DEM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexOfflineTiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
