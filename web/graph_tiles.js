// ApexGraphTiles — Vetta's own scored road network, read on the phone (docs/OWN_ROUTING.md §4; the format and the
// writer: tools/graph_etl/tiles.py). Tiles are 0.25° (about 28 x 21 km here): i = floor((lon + 180) / 0.25),
// j = floor((lat + 90) / 0.25); one file each, data/graph/v1/<i>_<j>.vgr, with data/graph/v1/index.json naming the tiles
// there, the build date, the OSM timestamp and the route engine's weights hash.
//
// decode(arrayBuffer) -> {
//   tile: { i, j, key, buildDay, modelHash },
//   nodes: { count, lat: Int32Array, lon: Int32Array (microdegrees), firstEdge: Uint32Array (count + 1: node v's edges are
//            firstEdge[v] .. firstEdge[v + 1] - 1), flags: Uint8Array (NODE_FLAGS: signal, stop, give_way, barrier,
//            level_crossing, dead_end, crossing, calming) },
//   edges: { count, from: Uint32Array (the CSR expanded), to: Uint32Array (node index in toTile), toTile: Uint32Array
//            (packed tile key (i << 16) | j; the tile itself for a local edge), len_dm, t_ds: Uint32Array, quality, scenery:
//            Uint8Array (0..254 = 0..1, 255 unknown), fun: Uint16Array (gated corner points x 100, 65535 unknown), conf:
//            Uint8Array (0..255 = share of the model's weight known), flags: Uint16Array (FLAGS), cls: Uint8Array (0
//            motorway .. 7 service, 8 track, 9 ferry), speed: Uint8Array (km/h, 0 unknown), name: Uint16Array (0xFFFF none),
//            geomOff: Uint32Array, hIn, hOut: Uint8Array (bearing over the first / last 60 m, 256ths of a turn, 0 north),
//            ch: { [CHANNELS name]: Float32Array, NaN unknown } (v2: businesses, driveways and side roads, signals, stops,
//            crossings, calming, schools and churches per km, sidewalk 0/1, built 0..1, density 0..15, buildings and
//            addresses per km; {} in a v1 tile) },
//   restrictions: [{ fromEdge, fromTile (packed key), via (local node), toEdge (local edge), only }],
//   restrictionsVia: [{ from, fromTile, via: [edge...], viaTiles: [key...], to, toTile, only }] (v3, via-way: no / only
//            from edge `from` through the via edges in order onto `to`; every index is in its own tile, keys packed),
//   names: [string],
//   geom(edgeIdx) -> Float64Array [lat0, lon0, lat1, lon1, ...] in degrees, in the edge's direction of travel,
// }
// load(i, j, opts?) -> Promise<decoded | null>: memory, then IndexedDB ('vetta-graph'), then the shipped tiles
// (data/graph/v1, Cincinnati) or the Worker's region (/api/graph/v1, OH+KY+IN); null when neither index lists the tile or
// it can't be had. index() is the union of both indexes; prefetchArea(bbox) keeps a saved area's tiles for offline. Unknown stays unknown: a 255 / 65535 is never read as 0.
(function (root) {
  'use strict';
  const VERSION = 3, READS = [1, 2, 3], HEADER = 64, TILE_DEG = 0.25, BASE = 'data/graph/v1/', GEOM_Q = 5;   // geometry in 5 µdeg steps
  const UNKNOWN_U8 = 255, UNKNOWN_FUN = 0xffff, NO_NAME = 0xffff;
  const FLAGS = { oneway: 1, toll: 2, ferry: 4, unpaved: 8, tunnel: 16, bridge: 32, motorway: 64, ramp: 128, roundabout: 256, private: 512,
    geomRev: 1024, speedEst: 2048, barrier: 4096, destination: 8192 };
  const NODE_FLAGS = { signal: 1, stop: 2, giveWay: 4, barrier: 8, levelCrossing: 16, deadEnd: 32, crossing: 64, calming: 128 };
  // the road channels a v2 tile carries per edge (tools/graph_etl/tiles.py CHANNELS: name, scale; the file's order)
  const CHANNELS = [['business_per_km', 4], ['access_per_km', 2], ['signals_per_km', 20], ['stops_per_km', 20], ['crossings_per_km', 10],
    ['calming_per_km', 20], ['schools_per_km', 20], ['worship_per_km', 20], ['sidewalk', 1], ['built', 254], ['density', 16], ['bldg_per_km', 1], ['addr_per_km', 1]];
  const CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, service: 7, track: 8, ferry: 9 };

  const tileOf = (lat, lon) => ({ i: Math.floor((lon + 180) / TILE_DEG), j: Math.floor((lat + 90) / TILE_DEG) });
  const keyOf = (i, j) => ((i << 16) | j) >>> 0;
  const unkey = (k) => ({ i: k >>> 16, j: k & 0xffff });
  const origin = (i, j) => ({ lat: Math.round((j * TILE_DEG - 90) * 1e6), lon: Math.round((i * TILE_DEG - 180) * 1e6) });
  /** 0..254 -> 0..1, 255 -> NaN (unknown). */
  const unq8 = (b) => (b === UNKNOWN_U8 ? NaN : b / 254);
  const funPts = (u) => (u === UNKNOWN_FUN ? NaN : u / 100);

  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'VGR1') throw new Error('not a VGR1 tile');
    // typed views need aligned offsets: copy into a fresh buffer when the caller's view is not 4-aligned
    const b = u8.byteOffset % 4 === 0 ? u8 : u8.slice();
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const version = dv.getUint16(4, true);
    if (!READS.includes(version)) throw new Error(`graph tile version ${version}`);
    const hb = dv.getUint16(6, true), ti = dv.getInt32(8, true), tj = dv.getInt32(12, true);
    const n = dv.getUint32(16, true), e = dv.getUint32(20, true), r = dv.getUint32(24, true), nn = dv.getUint32(28, true);
    const nb = dv.getUint32(32, true), gb = dv.getUint32(36, true), nref = dv.getUint32(40, true);
    const buildDay = dv.getUint32(44, true), modelHash = dv.getUint32(48, true), wide = dv.getUint8(52) & 1;
    const nch = version >= 2 ? dv.getUint8(53) : 0, ng = version >= 2 ? dv.getUint32(56, true) : 0, nvr = version >= 3 ? dv.getUint32(60, true) : 0;
    let p = hb;
    const refs = [];
    for (let k = 0; k < nref; k++) refs.push(keyOf(dv.getUint16(p + 4 * k, true), dv.getUint16(p + 4 * k + 2, true)));
    p += 4 * nref;
    const take = (T, count) => { const a = new T(b.buffer, b.byteOffset + p, count); p += count * T.BYTES_PER_ELEMENT; return a; };
    const align = () => { p += (4 - (p % 4)) % 4; };
    const o = origin(ti, tj), qlat = take(Uint16Array, n), qlon = take(Uint16Array, n);
    align();
    const lat = new Int32Array(n), lon = new Int32Array(n);
    for (let v = 0; v < n; v++) { lat[v] = o.lat + GEOM_Q * qlat[v]; lon[v] = o.lon + GEOM_Q * qlon[v]; }
    const firstEdge = take(Uint32Array, n + 1), nflags = take(Uint8Array, n);
    align();
    const geomOff = take(Uint32Array, e), toRaw = take(wide ? Uint32Array : Uint16Array, e);
    const len_dm = Uint32Array.from(take(Uint16Array, e)), t_ds = Uint32Array.from(take(Uint16Array, e));
    const to = Uint32Array.from(toRaw);
    const fun = take(Uint16Array, e), flags = take(Uint16Array, e), name = take(Uint16Array, e);
    align();
    const quality = take(Uint8Array, e), scenery = take(Uint8Array, e), conf = take(Uint8Array, e), cls = take(Uint8Array, e);
    const speed = take(Uint8Array, e), toRef = take(Uint8Array, e), hIn = take(Uint8Array, e), hOut = take(Uint8Array, e);
    align();
    const self = keyOf(ti, tj);
    const restrictions = [];
    for (let k = 0; k < r; k++, p += 16) {
      const ft = dv.getUint8(p + 12);
      restrictions.push({ fromEdge: dv.getUint32(p, true), via: dv.getUint32(p + 4, true), toEdge: dv.getUint32(p + 8, true), fromTile: ft ? refs[ft - 1] : self, only: dv.getUint8(p + 13) === 1 });
    }
    const offs = take(Uint32Array, nn + 1);
    const td = new TextDecoder();
    const names = [];
    for (let k = 0; k < nn; k++) names.push(td.decode(b.subarray(p + offs[k], p + offs[k + 1])));
    p += nb;
    align();
    const geo = b.subarray(p, p + gb);
    p += gb;
    align();
    // the road channels (v2): one u8 column over the polylines each, expanded here per edge (NaN = unknown)
    const ch = {};
    if (nch && ng) {
      const starts = new Uint32Array(ng);
      let q = 0;
      const skip = () => { while (geo[q++] >= 0x80); };
      const rdc = () => { let v = 0, sh = 0, c; do { c = geo[q++]; v += (c & 0x7f) * 2 ** sh; sh += 7; } while (c >= 0x80); return v; };
      for (let g = 0; g < ng; g++) { starts[g] = q; const cnt = rdc(); for (let m = 0; m < 2 * cnt; m++) skip(); }
      const gIdx = new Uint32Array(e);
      for (let k = 0; k < e; k++) {           // starts is ascending: binary search the edge's polyline
        let lo = 0, hi = ng - 1; const x = geomOff[k];
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x) lo = mid; else hi = mid - 1; }
        gIdx[k] = lo;
      }
      for (let c = 0; c < Math.min(nch, CHANNELS.length); c++) {
        const [name, scale] = CHANNELS[c], col = b.subarray(p, p + ng), out = new Float32Array(e);
        for (let k = 0; k < e; k++) { const v = col[gIdx[k]]; out[k] = v === UNKNOWN_U8 ? NaN : v / scale; }
        ch[name] = out;
        p += ng;
      }
    }
    align();
    // via-way restrictions (v3): from edge, the via edges in order, to edge; each with its tile's packed key
    const restrictionsVia = [];
    const refKey = (x) => (x ? refs[x - 1] : self);
    for (let k = 0; k < nvr; k++) {
      const from = dv.getUint32(p, true), to = dv.getUint32(p + 4, true), fr = dv.getUint8(p + 8), tr = dv.getUint8(p + 9);
      const only = dv.getUint8(p + 10) === 1, nv = dv.getUint8(p + 11);
      p += 12;
      const via = [], viaTiles = [];
      for (let m = 0; m < nv; m++) via.push(dv.getUint32(p + 4 * m, true));
      p += 4 * nv;
      for (let m = 0; m < nv; m++) viaTiles.push(refKey(dv.getUint8(p + m)));
      p += nv;
      align();
      restrictionsVia.push({ from, fromTile: refKey(fr), via, viaTiles, to, toTile: refKey(tr), only });
    }
    const toTile = new Uint32Array(e), from = new Uint32Array(e);
    for (let k = 0; k < e; k++) toTile[k] = toRef[k] ? refs[toRef[k] - 1] : self;
    for (let v = 0; v < n; v++) for (let k = firstEdge[v]; k < firstEdge[v + 1]; k++) from[k] = v;
    function geom(k) {
      let q = geomOff[k];
      const rd = () => { let v = 0, s = 0, c; do { c = geo[q++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c >= 0x80); return v; };
      const zz = (v) => (v % 2 ? -(v + 1) / 2 : v / 2);
      const cnt = rd(), out = new Float64Array(cnt * 2);
      let la = Math.floor(o.lat / GEOM_Q), lo = Math.floor(o.lon / GEOM_Q);
      for (let m = 0; m < cnt; m++) { la += zz(rd()); lo += zz(rd()); out[2 * m] = la * GEOM_Q / 1e6; out[2 * m + 1] = lo * GEOM_Q / 1e6; }
      if (flags[k] & FLAGS.geomRev) {
        for (let a = 0, z = cnt - 1; a < z; a++, z--) {
          const x = out[2 * a], y = out[2 * a + 1]; out[2 * a] = out[2 * z]; out[2 * a + 1] = out[2 * z + 1]; out[2 * z] = x; out[2 * z + 1] = y;
        }
      }
      // the ends exactly on their nodes (the to node when it is in this tile)
      if (cnt) { out[0] = lat[from[k]] / 1e6; out[1] = lon[from[k]] / 1e6; }
      if (cnt > 1 && toTile[k] === self) { out[2 * cnt - 2] = lat[to[k]] / 1e6; out[2 * cnt - 1] = lon[to[k]] / 1e6; }
      return out;
    }
    return {
      tile: { i: ti, j: tj, key: self, buildDay, modelHash, refs },
      nodes: { count: n, lat, lon, firstEdge, flags: nflags },
      edges: { count: e, ch, from, to, toTile, len_dm, t_ds, quality, scenery, fun, conf, flags, cls, speed, name, geomOff, hIn, hOut },
      restrictions, restrictionsVia, names, geom,
    };
  }

  // ---- loading: memory, IndexedDB, network ---------------------------------------------------------------------------
  const DB = 'vetta-graph', STORE = 'tiles', MEM_MAX = 64;
  const mem = new Map();
  const remember = (k, v) => { mem.delete(k); mem.set(k, v); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((ok) => {
      try {
        if (!root.indexedDB) return ok(null);
        const rq = root.indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore(STORE); } catch (_) {} };
        rq.onsuccess = () => ok(rq.result);
        rq.onerror = () => ok(null);
        rq.onblocked = () => ok(null);
      } catch (_) { ok(null); }
    });
    return dbP;
  }
  async function idb(mode, key, val) {
    const d = await db();
    if (!d) return null;
    return new Promise((ok) => {
      try {
        const tx = d.transaction(STORE, mode), st = tx.objectStore(STORE), rq = mode === 'readonly' ? st.get(key) : st.put(val, key);
        rq.onsuccess = () => ok(mode === 'readonly' ? rq.result || null : true);
        rq.onerror = () => ok(null);
      } catch (_) { ok(null); }
    });
  }
  // Two sources: the tiles shipped in the app (data/graph/v1: Cincinnati) and the region's from the Worker
  // (/api/graph/v1: the rest of Ohio, Kentucky and Indiana, relayed from the repository's graph-data branch). The coverage
  // is the union of their indexes; the region's index is asked once a day (kept in IndexedDB for offline). A tile comes
  // from memory, then IndexedDB, then its source; one fetched from the Worker is kept in IndexedDB, so a road once
  // planned (or an area saved, prefetchArea) works offline.
  const REGION_PATH = '/api/graph/v1/', DAY = 864e5, WORKER = 'https://apexnav.senftns.workers.dev';
  const apiBase = (o) => (o.apiBase !== undefined ? o.apiBase : root.ApexSync && root.ApexSync.apiBase != null ? root.ApexSync.apiBase
    : root.location && root.location.protocol === 'apexnav:' ? WORKER : '');
  const regionBase = (o) => (o.region === null ? null : o.region || apiBase(o) + REGION_PATH);
  const fetchOf = (o) => o.fetchFn || (root.fetch && root.fetch.bind(root));
  const indexes = new Map();
  /** One base's index.json, null if none: memory, then (within ttl) IndexedDB, then the network, else the kept copy. */
  function baseIndex(base, fetchFn, ttl, memoMs) {
    const had = indexes.get(base);
    if (had && Date.now() - had.at < had.ttl) return had.p;
    const p = (async () => {
      let kept = null;
      try { const c = await idb('readonly', `ix:${base}`); kept = c ? JSON.parse(c) : null; } catch (_) { kept = null; }
      if (kept && kept.j && Date.now() - kept.at < ttl) return kept.j;
      try {
        const r = await fetchFn(base + 'index.json');
        if (r.ok) { const j = await r.json(); if (j && j.tiles) { idb('readwrite', `ix:${base}`, JSON.stringify({ at: Date.now(), j })); return j; } }
      } catch (_) {}
      return kept ? kept.j : null;
    })();
    const memo = { at: Date.now(), p, ttl: memoMs };
    indexes.set(base, memo);
    p.then((v) => { if (!v) memo.ttl = 6e5; });          // none there (offline, or no region yet): ask again in 10 min
    return p;
  }
  async function sources(o = {}) {
    const fetchFn = fetchOf(o), bundled = o.base || BASE, region = regionBase(o);
    const [b, r] = await Promise.all([baseIndex(bundled, fetchFn, 0, Infinity), region ? baseIndex(region, fetchFn, DAY, DAY) : Promise.resolve(null)]);
    return { bundled, region, b, r };
  }
  const has = (ix, name) => !!(ix && ix.tiles && Object.prototype.hasOwnProperty.call(ix.tiles, name));
  const buildOf = (ix) => (ix ? String(ix.build || ix.built || '') : '');
  /**
   * Where tile `name` comes from, in order. The shipped copy first; but a tile's edges into its neighbours index their
   * nodes as THAT build numbered them, so where the region holds the tile from another build, its build wins (the shipped
   * copy stays the fallback offline) and a route never mixes two builds across a tile edge.
   */
  function order(src, name) {
    const inB = has(src.b, name), inR = has(src.r, name);
    const same = !src.r || !buildOf(src.r) || buildOf(src.r) === 'none' || buildOf(src.r) === buildOf(src.b);
    const B = [src.bundled, buildOf(src.b)], R = src.region ? [src.region, buildOf(src.r)] : null;
    if (inB && (!inR || same)) return inR && R ? [B, R] : [B];
    if (inR && R) return inB ? [R, B] : [R];
    return [];
  }
  /** The union of both indexes ({ tiles: { "i_j": meta }, bundled, region }), what the router plans over; null if none. */
  async function index(o = {}) {
    const src = await sources(o);
    if (!src.b && !src.r) return null;
    const tiles = { ...((src.r && src.r.tiles) || {}), ...((src.b && src.b.tiles) || {}) };
    return { version: VERSION, tiles, bundled: src.b ? { build: buildOf(src.b), tiles: Object.keys(src.b.tiles || {}).length } : null,
      region: src.r ? { build: buildOf(src.r), tiles: Object.keys(src.r.tiles || {}).length } : null };
  }
  async function fetchTile(base, ver, name, fetchFn, keep) {
    const key = `${base}${name}.vgr@${ver}`;
    if (mem.has(key)) { const t = mem.get(key); remember(key, t); return t; }
    let bytes = await idb('readonly', key);
    if (!bytes && fetchFn) {
      try { const r = await fetchFn(`${base}${name}.vgr`); if (r.ok) { bytes = await r.arrayBuffer(); if (keep) idb('readwrite', key, bytes); } } catch (_) {}
    }
    if (!bytes) return null;
    try { const t = decode(bytes); remember(key, t); return t; } catch (_) { return null; }
  }
  /** Tile (i, j): decoded, or null where neither index has it or it can't be had (offline, never fetched). */
  async function load(i, j, o = {}) {
    const fetchFn = fetchOf(o), src = await sources(o), name = `${i}_${j}`;
    for (const [base, ver] of order(src, name)) {
      const t = await fetchTile(base, ver, name, fetchFn, true);
      if (t) return t;
    }
    return null;
  }
  /**
   * Keep every graph tile a box needs for offline use (web/offline_tiles.js calls it when an area is saved): bbox
   * { s, w, n, e } or [s, w, n, e]. Resolves { tiles, kept }: the tiles in the box that either index has, and how many are
   * now loadable without the network.
   */
  async function prefetchArea(bbox, o = {}) {
    const [s, w, n, e] = Array.isArray(bbox) ? bbox : [bbox.s, bbox.w, bbox.n, bbox.e];
    const src = await sources(o), want = tilesIn(s, w, n, e).map(({ i, j }) => `${i}_${j}`).filter((k) => has(src.b, k) || has(src.r, k));
    let kept = 0, k = 0;
    await Promise.all(Array.from({ length: Math.min(4, want.length) }, async () => {
      while (k < want.length) { const [i, j] = want[k++].split('_').map(Number); if (await load(i, j, o)) kept++; }
    }));
    return { tiles: want.length, kept };
  }
  /** The tiles (i, j) a box touches (degrees). */
  function tilesIn(south, west, north, east) {
    const a = tileOf(south, west), z = tileOf(north, east), out = [];
    for (let i = a.i; i <= z.i; i++) for (let j = a.j; j <= z.j; j++) out.push({ i, j });
    return out;
  }

  const api = { VERSION, READS, CHANNELS, BASE, TILE_DEG, FLAGS, NODE_FLAGS, CLASS, UNKNOWN_U8, UNKNOWN_FUN, NO_NAME, tileOf, keyOf, unkey, origin, unq8, funPts, decode, index, load, prefetchArea, tilesIn, _mem: mem, _indexes: indexes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexGraphTiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
