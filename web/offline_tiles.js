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
        t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error);
      });
      return true;
    } catch (_) { return false; }   // a full phone (QuotaExceededError) or no IndexedDB: the caller says so
  }
  async function clear() { try { await tx('readwrite', (s) => s.clear()); } catch (_) {} try { root.localStorage.removeItem(AREAS); root.localStorage.removeItem(CAR_AHEAD); } catch (_) {} tellShell(); }

  function areas() { try { const v = JSON.parse(root.localStorage.getItem(AREAS) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function saveAreas(list) { try { root.localStorage.setItem(AREAS, JSON.stringify(list)); } catch (_) {} tellShell(); }
  /** The iOS shell keeps the car map's own offline packs to match the saved areas (packOf); the whole list each time. */
  function tellShell() {
    try { const h = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apex; if (h) h.postMessage({ cmd: 'offlinePacks', packs: packs() }); } catch (_) {}
  }
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

  /**
   * The map ahead of a drive on a planned route (IDEAS F-03): its tiles z8-14 within bufferKm of the route kept as recent
   * ones, so a dead zone on the way, a route not saved for offline, still has its map (only the tiles once looked at were
   * kept). Narrow and capped (~4 MB per 100 km); held ones skipped; one at a time. Resolves { tiles, fetched, missing }.
   */
  const AHEAD_KM = 0.3, AHEAD_MAX = 400;
  async function keepAhead({ lat, lon, styleUrl, bufferKm = AHEAD_KM, max = AHEAD_MAX, fetchFn = (u) => fetch(u) }) {
    const json = async (url) => { const kept = await get(url); if (kept) return JSON.parse(new TextDecoder().decode(kept));
      const r = await fetchFn(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); const b = await r.arrayBuffer(); put(url, b); return JSON.parse(new TextDecoder().decode(b)); };
    const style = await json(styleUrl);
    const src = Object.values(style.sources || {}).find((x) => x.type === 'vector' && x.url);
    const template = src ? ((await json(src.url)).tiles || [])[0] : null;
    if (!template) throw new Error('no map tiles');
    const list = tilesAlong(lat, lon, bufferKm, 8, 14).slice(0, max), now = Date.now();
    let fetched = 0, missing = 0, miss = 0;
    for (const [z, x, y] of list) {
      const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      if (servable(await getRec(url), now)) continue;
      try { const r = await fetchFn(url); if (!r.ok) continue; await keepRecent(url, await r.arrayBuffer()); fetched++; miss = 0; } catch (_) { missing++; if (++miss >= 5) break; }   // the signal's gone: stop
    }
    return { tiles: list.length, fetched, missing };
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
   * Resolves the area record ({ id, name, lat, lon, radiusKm, tiles, bytes, at }); a tile the server lacks is skipped, one
   * the phone couldn't fetch or keep is counted as `missing` (with `full` when out of room), so the area says it's partial.
   */
  async function download({ lat, lon, radiusKm = 25, name, styleUrl, onProgress, concurrency = 6, along = null, id: areaId = null }) {
    // `along`: a planned route's line ({ lat, lon }): the corridor along it (planAlong) instead of a disc round (lat, lon)
    const p = along ? planAlong(along.lat, along.lon) : plan(lat, lon, radiusKm), id = areaId || `a${Date.now().toString(36)}`;
    if (!p) throw new Error('route too long to keep');
    // a tile the server hasn't got (HTTP 404: the sea) is fine; one the phone couldn't fetch (signal gone) or couldn't
    // keep (out of room) is `missing`, counted on the area so it says it was only partly kept and offers Update
    const NOT_KEPT = 'not kept';
    const keep = async (url) => {
      const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.arrayBuffer();
      if (!(await put(url, b, id))) { const e = new Error(NOT_KEPT); e.full = true; throw e; }
      return b;
    };
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
    // a saved route: our network within 2 km of it, so a reroute with no signal on the way still has roads (IDEAS F-04)
    if (root.ApexGraphTiles && root.ApexGraphTiles.prefetchAlong && along) graph = root.ApexGraphTiles.prefetchAlong(along.lat, along.lon).catch(() => null);
    let done = 0, bytes = 0, k = 0, missing = 0, full = false;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (k < urls.length) {
        const url = urls[k++];
        try { bytes += (await keep(url)).byteLength; } catch (e) { if (!/^HTTP /.test(e && e.message)) { missing++; if (e && e.full) full = true; } }
        onProgress && onProgress(++done, urls.length);
      }
    }));
    const g = graph ? await graph : null;
    const area = { id, name: name || 'Saved area', lat, lon, radiusKm: along ? null : p.radiusKm, ...(along ? { alongKm: p.bufferKm, box: boxOf(along.lat, along.lon), line: lineOf(along.lat, along.lon, LINE_TOL_KM), lineTolKm: LINE_TOL_KM } : {}),
      tiles: urls.length, bytes, at: new Date().toISOString(), graphTiles: g ? g.kept : 0, ...(missing ? { missing, full } : {}) };
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
  /** The share of an area's map kept, 0..1 (1 for an area with nothing missing, or an older record without the count). */
  const keptShare = (a) => (a && a.missing > 0 && a.tiles > 0 ? Math.max(0, Math.min(1, 1 - a.missing / a.tiles)) : 1);
  // The car's map (CarPlay/ApexCarOffline.swift): MapLibre Native can't read this page's IndexedDB, so the shell keeps its
  // own offline pack for each saved area, from this description. A disc area: its box (the square the tiles cover). A route:
  // the z13 tiles within its corridor, as squares [s, w, n, e], from its kept line walked every 500 m (the line is thinned,
  // so its points alone can be km apart). Areas saved before the line was kept: their box. null for a record it can't use.
  const tileBox = (z, x, y) => { const n = 2 ** z, lat = (t) => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n))) * 180 / Math.PI;
    return [lat(y + 1), x / n * 360 - 180, lat(y), (x + 1) / n * 360 - 180].map((v) => Math.round(v * 1e5) / 1e5); };
  function packOf(a) {
    if (!a || typeof a.id !== 'string') return null;
    const at = typeof a.at === 'string' ? a.at : '', r5 = (v) => Math.round(v * 1e5) / 1e5;
    if (Number.isFinite(a.radiusKm) && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
      const dLat = a.radiusKm / 110.54, dLon = a.radiusKm / (111.32 * Math.cos(a.lat * Math.PI / 180));
      return { id: a.id, at, bounds: [r5(a.lat - dLat), r5(a.lon - dLon), r5(a.lat + dLat), r5(a.lon + dLon)] };
    }
    if (Array.isArray(a.line) && a.line.length >= 2) {
      const lat = [], lon = [];
      for (let i = 0; i < a.line.length; i++) {
        const [la, lo] = a.line[i];
        if (i) {
          const [pa, po] = a.line[i - 1], km = Math.hypot((la - pa) * 110.54, (lo - po) * 111.32 * Math.cos(la * Math.PI / 180)), steps = Math.ceil(km / 0.5);
          for (let k = 1; k < steps; k++) { lat.push(pa + (la - pa) * k / steps); lon.push(po + (lo - po) * k / steps); }
        }
        lat.push(la); lon.push(lo);
      }
      const squares = tilesAlong(lat, lon, Number.isFinite(a.alongKm) ? a.alongKm : 1.5, 13, 13).map(([z, x, y]) => tileBox(z, x, y));
      return { id: a.id, at, bounds: boxOf(lat, lon), squares };
    }
    if (Array.isArray(a.box) && a.box.length === 4 && a.box.every(Number.isFinite)) return { id: a.id, at, bounds: a.box.slice() };
    return null;
  }
  /**
   * The car's copy of the map ahead (keepAhead's, for CarPlay's MapLibre Native map, which can't read IndexedDB): the last
   * planned route driven, as a corridor pack, kept until the next drive's replaces it (or Delete offline data). Its id is
   * the route's box, so the same route driven again isn't fetched again.
   */
  const CAR_AHEAD = 'apex.carAhead';
  function setCarAhead(lat, lon) {
    const line = lineOf(lat, lon, LINE_TOL_KM), b = line && boxOf(lat, lon);
    if (!line || !b) return null;
    const rec = { id: `drive_${b.join(',')}`, at: '', alongKm: AHEAD_KM, line };
    try { root.localStorage.setItem(CAR_AHEAD, JSON.stringify(rec)); } catch (_) {}
    tellShell();
    return rec.id;
  }
  function carAhead() { try { return packOf(JSON.parse(root.localStorage.getItem(CAR_AHEAD) || 'null')); } catch (_) { return null; } }
  /** What the car's map should keep: one pack per saved area that describes itself, and the last drive's corridor. */
  const packs = () => { const list = areas().map(packOf).filter(Boolean), d = carAhead(); return d ? [...list, d] : list; };
  /** Bytes saved, from the areas list. */
  const bytesSaved = () => areas().reduce((s, a) => s + (a.bytes || 0), 0);

  const api = { tilesFor, plan, tilesAlong, planAlong, boxOf, lineOf, areasOf, servable, overflow, RECENT_MAX, keepAhead, AHEAD_KM, AHEAD_MAX, RECENT_DAYS, transform, install, download, get, put, clear, areas, setArea, removeArea, bytesSaved, ageOf, keptShare, packOf, packs, tellShell, setCarAhead, STALE_DAYS, MAX_TILES, PROTO, DEM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexOfflineTiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
