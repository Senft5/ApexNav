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
//            geomOff: Uint32Array, hIn, hOut: Uint8Array (bearing over the first / last 60 m, 256ths of a turn, 0 north) },
//   restrictions: [{ fromEdge, fromTile (packed key), via (local node), toEdge (local edge), only }],
//   names: [string],
//   geom(edgeIdx) -> Float64Array [lat0, lon0, lat1, lon1, ...] in degrees, in the edge's direction of travel,
// }
// load(i, j, opts?) -> Promise<decoded | null>: memory, then IndexedDB ('vetta-graph'), then the network; null when the
// index doesn't list the tile or it can't be had. Unknown stays unknown: a 255 / 65535 is never read as 0.
(function (root) {
  'use strict';
  const VERSION = 1, HEADER = 64, TILE_DEG = 0.25, BASE = 'data/graph/v1/';
  const UNKNOWN_U8 = 255, UNKNOWN_FUN = 0xffff, NO_NAME = 0xffff;
  const FLAGS = { oneway: 1, toll: 2, ferry: 4, unpaved: 8, tunnel: 16, bridge: 32, motorway: 64, ramp: 128, roundabout: 256, private: 512,
    geomRev: 1024, speedEst: 2048, barrier: 4096, destination: 8192 };
  const NODE_FLAGS = { signal: 1, stop: 2, giveWay: 4, barrier: 8, levelCrossing: 16, deadEnd: 32, crossing: 64, calming: 128 };
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
    if (version !== VERSION) throw new Error(`graph tile version ${version}`);
    const hb = dv.getUint16(6, true), ti = dv.getInt32(8, true), tj = dv.getInt32(12, true);
    const n = dv.getUint32(16, true), e = dv.getUint32(20, true), r = dv.getUint32(24, true), nn = dv.getUint32(28, true);
    const nb = dv.getUint32(32, true), gb = dv.getUint32(36, true), nref = dv.getUint32(40, true);
    const buildDay = dv.getUint32(44, true), modelHash = dv.getUint32(48, true);
    let p = hb;
    const refs = [];
    for (let k = 0; k < nref; k++) refs.push(keyOf(dv.getUint16(p + 4 * k, true), dv.getUint16(p + 4 * k + 2, true)));
    p += 4 * nref;
    const take = (T, count) => { const a = new T(b.buffer, b.byteOffset + p, count); p += count * T.BYTES_PER_ELEMENT; return a; };
    const align = () => { p += (4 - (p % 4)) % 4; };
    const lat = take(Int32Array, n), lon = take(Int32Array, n), firstEdge = take(Uint32Array, n + 1), nflags = take(Uint8Array, n);
    align();
    const to = take(Uint32Array, e), len_dm = take(Uint32Array, e), t_ds = take(Uint32Array, e), geomOff = take(Uint32Array, e);
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
    const toTile = new Uint32Array(e), from = new Uint32Array(e);
    for (let k = 0; k < e; k++) toTile[k] = toRef[k] ? refs[toRef[k] - 1] : self;
    for (let v = 0; v < n; v++) for (let k = firstEdge[v]; k < firstEdge[v + 1]; k++) from[k] = v;
    const o = origin(ti, tj);
    function geom(k) {
      let q = geomOff[k];
      const rd = () => { let v = 0, s = 0, c; do { c = geo[q++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c >= 0x80); return v; };
      const zz = (v) => (v % 2 ? -(v + 1) / 2 : v / 2);
      const cnt = rd(), out = new Float64Array(cnt * 2);
      let la = o.lat, lo = o.lon;
      for (let m = 0; m < cnt; m++) { la += zz(rd()); lo += zz(rd()); out[2 * m] = la / 1e6; out[2 * m + 1] = lo / 1e6; }
      if (flags[k] & FLAGS.geomRev) {
        for (let a = 0, z = cnt - 1; a < z; a++, z--) {
          const x = out[2 * a], y = out[2 * a + 1]; out[2 * a] = out[2 * z]; out[2 * a + 1] = out[2 * z + 1]; out[2 * z] = x; out[2 * z + 1] = y;
        }
      }
      return out;
    }
    return {
      tile: { i: ti, j: tj, key: self, buildDay, modelHash, refs },
      nodes: { count: n, lat, lon, firstEdge, flags: nflags },
      edges: { count: e, from, to, toTile, len_dm, t_ds, quality, scenery, fun, conf, flags, cls, speed, name, geomOff, hIn, hOut },
      restrictions, names, geom,
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
  const indexes = new Map();
  /** The base's index.json ({ tiles: { "i_j": { bytes, nodes, edges } }, built, osm, model }), once per page; null if none. */
  function index(opts = {}) {
    const base = opts.base || BASE, fetchFn = opts.fetchFn || (root.fetch && root.fetch.bind(root));
    if (indexes.has(base)) return indexes.get(base);
    const p = (async () => {
      try { const r = await fetchFn(base + 'index.json'); if (r.ok) { const j = await r.json(); if (j && j.tiles) { idb('readwrite', base + 'index.json', JSON.stringify(j)); return j; } } } catch (_) {}
      try { const c = await idb('readonly', base + 'index.json'); return c ? JSON.parse(c) : null; } catch (_) { return null; }
    })();
    indexes.set(base, p);
    p.then((v) => { if (!v) indexes.delete(base); });
    return p;
  }
  /** Tile (i, j): decoded, or null where the index doesn't have it or it can't be loaded (offline, never saved). */
  async function load(i, j, opts = {}) {
    const base = opts.base || BASE, fetchFn = opts.fetchFn || (root.fetch && root.fetch.bind(root));
    const ix = await index({ base, fetchFn });
    const name = `${i}_${j}`;
    if (ix && ix.tiles && !ix.tiles[name]) return null;
    const ver = ix && ix.built ? ix.built : '';
    const key = `${base}${name}.vgr@${ver}`;
    if (mem.has(key)) { const t = mem.get(key); remember(key, t); return t; }
    let bytes = await idb('readonly', key);
    if (!bytes && fetchFn) {
      try { const r = await fetchFn(`${base}${name}.vgr`); if (r.ok) { bytes = await r.arrayBuffer(); idb('readwrite', key, bytes); } } catch (_) {}
    }
    if (!bytes) return null;
    try { const t = decode(bytes); remember(key, t); return t; } catch (_) { return null; }
  }
  /** The tiles (i, j) a box touches (degrees). */
  function tilesIn(south, west, north, east) {
    const a = tileOf(south, west), z = tileOf(north, east), out = [];
    for (let i = a.i; i <= z.i; i++) for (let j = a.j; j <= z.j; j++) out.push({ i, j });
    return out;
  }

  const api = { VERSION, BASE, TILE_DEG, FLAGS, NODE_FLAGS, CLASS, UNKNOWN_U8, UNKNOWN_FUN, NO_NAME, tileOf, keyOf, unkey, origin, unq8, funPts, decode, index, load, tilesIn, _mem: mem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexGraphTiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
