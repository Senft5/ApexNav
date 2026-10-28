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
  async function get(url) { try { const v = await tx('readonly', (s) => s.get(url)); return v ? v.data : null; } catch (_) { return null; } }
  async function put(url, data, area = null) { try { await tx('readwrite', (s) => s.put({ url, data, area, at: Date.now() })); } catch (_) {} }
  async function clear() { try { await tx('readwrite', (s) => s.clear()); } catch (_) {} try { root.localStorage.removeItem(AREAS); } catch (_) {} }

  function areas() { try { const v = JSON.parse(root.localStorage.getItem(AREAS) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function saveAreas(list) { try { root.localStorage.setItem(AREAS, JSON.stringify(list)); } catch (_) {} }
  async function removeArea(id) {
    saveAreas(areas().filter((a) => a.id !== id));
    try {
      const d = await db();
      await new Promise((ok) => { const t = d.transaction(STORE, 'readwrite'), s = t.objectStore(STORE), c = s.openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return; if (cur.value.area === id) cur.delete(); cur.continue(); }; t.oncomplete = ok; t.onerror = ok; });
    } catch (_) {}
  }

  const KEEP = new Set(['Style', 'Source', 'Glyphs']);   // small, needed to open the map offline: kept as they arrive
  /** For MapLibre's transformRequest: map requests through the protocol; anything else unchanged. */
  const transform = (url, type) => (/^https:\/\/tiles\.openfreemap\.org\//.test(url) && (type === 'Tile' || KEEP.has(type)) ? { url: `${PROTO}://${url}`, type } : undefined);
  /** The protocol: a saved copy first, else the network (keeping the small ones). JSON for json requests, bytes otherwise. */
  function install(maplibregl) {
    maplibregl.addProtocol(PROTO, async (params, abort) => {
      const url = params.url.slice(PROTO.length + 3);
      let data = await get(url);
      if (!data) {
        const r = await fetch(url, { signal: abort && abort.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.arrayBuffer();
        if (params.type === 'json' || /\/styles\/|\/planet$|\.pbf$/.test(url) && !/\/\d+\/\d+\/\d+\.pbf$/.test(url)) put(url, data);
      }
      return { data: params.type === 'json' ? JSON.parse(new TextDecoder().decode(data)) : data };
    });
  }

  /**
   * Saves the area round (lat, lon): the style, its data description, label fonts, map tiles and terrain. onProgress(done, of).
   * Resolves the area record ({ id, name, lat, lon, radiusKm, tiles, bytes, at }); a failed tile is skipped, not fatal.
   */
  async function download({ lat, lon, radiusKm = 25, name, styleUrl, onProgress, concurrency = 6 }) {
    const p = plan(lat, lon, radiusKm), id = `a${Date.now().toString(36)}`;
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
    let done = 0, bytes = 0, k = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (k < urls.length) {
        const url = urls[k++];
        try { bytes += (await keep(url)).byteLength; } catch (_) { /* a missing tile (the sea) is fine */ }
        onProgress && onProgress(++done, urls.length);
      }
    }));
    const area = { id, name: name || 'Saved area', lat, lon, radiusKm: p.radiusKm, tiles: urls.length, bytes, at: new Date().toISOString() };
    saveAreas([...areas(), area]);
    return area;
  }
  /** Bytes saved, from the areas list. */
  const bytesSaved = () => areas().reduce((s, a) => s + (a.bytes || 0), 0);

  const api = { tilesFor, plan, transform, install, download, get, put, clear, areas, removeArea, bytesSaved, MAX_TILES, PROTO, DEM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexOfflineTiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
