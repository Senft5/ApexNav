// Enforcement cameras from OpenStreetMap: plate readers (surveillance:type=ALPR, mapped by DeFlock) and speed cameras
// (highway=speed_camera), via the public Overpass servers. Why it was slow (the owner, 2026-10-30: "why the lpr data takes
// so long to load"): one query for a route's whole bounding box, the three servers tried one after another with no time
// limit, and a cache keyed to that exact box so no other route could use it. Now the box is cut into fixed tiles, only the
// tiles the route passes through are asked for, in one query raced against every server, and each tile is kept a week.
// Pure helpers are exported for tests (tests/test_cameras.py); `load` takes fetch and storage from the page.
// Our own list first (Nate, 2026-11-12: "the camera server always says it's down"; all four Overpass servers timed out
// when asked from the Worker): inside Ohio, Kentucky and Indiana the tiles come from /api/cameras/v1/region.json, built
// weekly from the Geofabrik extracts (tools/graph_etl/cameras.py). Only tiles it doesn't cover go to Overpass.
(function (root) {
  'use strict';
  const TILE = 0.25;                                   // degrees: about 28 x 20 km in the US, a few per drive
  const KEEP_MS = 7 * 864e5, OLD_MS = 90 * 864e5, PREFIX = 'apex.cam.', MAX_TILES = 400, TIMEOUT_MS = 12000;
  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const REGION_PATH = '/api/cameras/v1/region.json', WORKER = 'https://apexnav.senftns.workers.dev', REGION_WAIT_MS = 8000, REGION_RETRY_MS = 10 * 60000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  const keyOf = (i, j) => `${i}_${j}`;
  /** A tile's box [s, w, n, e]. */
  function tileBox(key) {
    const [i, j] = key.split('_').map(Number);
    return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE];
  }
  /** The tiles within `pad` degrees of any point ([{lat, lon}] or [[lat, lon]]), in a stable order. */
  function tilesNear(points, pad = 0.005) {
    const out = new Set();
    for (const p of points || []) {
      const lat = Array.isArray(p) ? p[0] : p && p.lat, lon = Array.isArray(p) ? p[1] : p && p.lon;
      if (!finite(lat) || !finite(lon)) continue;
      for (const la of [lat - pad, lat + pad]) for (const lo of [lon - pad, lon + pad]) out.add(keyOf(Math.floor(la / TILE), Math.floor(lo / TILE)));
    }
    return [...out].sort();
  }
  /** The tiles covering a box [s, w, n, e]. */
  function tilesInBox(s, w, n, e) {
    const out = [];
    for (let i = Math.floor(s / TILE); i <= Math.floor(n / TILE); i++) for (let j = Math.floor(w / TILE); j <= Math.floor(e / TILE); j++) out.push(keyOf(i, j));
    return out;
  }
  /** One Overpass query for every tile asked: plate readers and speed cameras, positions only. */
  function query(tiles) {
    const parts = tiles.map((k) => tileBox(k).map((v) => v.toFixed(4)).join(',')).flatMap((b) =>
      [`node["surveillance:type"="ALPR"](${b});`, `node["highway"="speed_camera"](${b});`]);
    return `[out:json][timeout:25];(${parts.join('')});out tags qt;`;
  }
  /** An Overpass element as a camera: { id, lat, lon, kind: 'alpr' | 'speed' }, or null. */
  function classify(x) {
    if (!x || x.type !== 'node' || !finite(x.lat) || !finite(x.lon)) return null;
    const t = x.tags || {};
    const kind = t['surveillance:type'] === 'ALPR' ? 'alpr' : t.highway === 'speed_camera' ? 'speed' : null;
    return kind ? { id: x.id, lat: x.lat, lon: x.lon, kind } : null;
  }
  /** The cameras split back into the tiles they were asked for (a tile with none is kept as known-empty). */
  function byTile(tiles, cams) {
    const out = new Map(tiles.map((k) => [k, []]));
    for (const c of cams) { const k = keyOf(Math.floor(c.lat / TILE), Math.floor(c.lon / TILE)); if (out.has(k)) out.get(k).push(c); }
    return out;
  }

  /** The first server to answer wins; the rest are cancelled. Each gets TIMEOUT_MS. null when none answers. */
  async function fetchFirst(fetchFn, body, servers = SERVERS, timeoutMs = TIMEOUT_MS) {
    const ctrls = servers.map(() => (typeof AbortController === 'function' ? new AbortController() : null));
    const tries = servers.map((url, i) => (async () => {
      const t = setTimeout(() => ctrls[i] && ctrls[i].abort(), timeoutMs);
      try {
        const r = await fetchFn(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrls[i] ? ctrls[i].signal : undefined });
        if (!r.ok) throw new Error(`http ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    })());
    try {
      const json = await Promise.any(tries);
      ctrls.forEach((c) => { try { if (c) c.abort(); } catch (_) {} });
      return json;
    } catch (_) { return null; }
  }

  function readTile(storage, k, now, maxMs = KEEP_MS) {
    try { const c = JSON.parse(storage.getItem(PREFIX + k) || 'null'); return c && now - c.at < maxMs && Array.isArray(c.cams) ? c.cams : null; } catch (_) { return null; }
  }
  const keptAtOf = (storage, k) => { try { const c = JSON.parse(storage.getItem(PREFIX + k) || 'null'); return c && Number.isFinite(c.at) ? c.at : null; } catch (_) { return null; } };
  function writeTiles(storage, tiles, now) {
    for (const [k, cams] of tiles) { try { storage.setItem(PREFIX + k, JSON.stringify({ at: now, cams })); } catch (_) {} }
    try {                                                              // keep the newest MAX_TILES tiles
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
      if (keys.length > MAX_TILES) {
        const aged = keys.map((k) => { try { return [k, JSON.parse(storage.getItem(k)).at || 0]; } catch (_) { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
        for (const [k] of aged.slice(0, keys.length - MAX_TILES)) storage.removeItem(k);
      }
    } catch (_) {}
  }

  /** Our region file ({ tiles, cams: [[lat, lon, 'a' | 's']] }) -> Map tile -> cameras, for every tile it covers. */
  function regionTiles(doc) {
    if (!doc || !Array.isArray(doc.tiles) || !Array.isArray(doc.cams)) return null;
    const out = new Map(doc.tiles.filter((k) => typeof k === 'string').map((k) => [k, []]));
    doc.cams.forEach((c, n) => {
      if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || (c[2] !== 'a' && c[2] !== 's')) return;
      const k = keyOf(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
      if (out.has(k)) out.get(k).push({ id: `r${n}`, lat: c[0], lon: c[1], kind: c[2] === 'a' ? 'alpr' : 'speed' });
    });
    return out;
  }
  const apiBase = () => (root.ApexSync && root.ApexSync.apiBase != null ? root.ApexSync.apiBase
    : root.location && root.location.protocol === 'apexnav:' ? WORKER : '');
  let region = null, regionAt = -Infinity;           // the page's one ask: a promise of the Map, or of null (asked again in 10 min)
  async function askRegion(fetchFn, url, waitMs) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => ctrl && ctrl.abort(), waitMs);
    try {
      const r = await fetchFn(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
      return r.ok ? regionTiles(await r.json()) : null;
    } catch (_) { return null; } finally { clearTimeout(t); }
  }
  function regionOnce(fetchFn, url, nowMs = Date.now()) {
    if (!region || (nowMs - regionAt > REGION_RETRY_MS && region.failed)) {
      regionAt = nowMs;
      const p = askRegion(fetchFn, url, REGION_WAIT_MS).then((m) => { if (!m) p.failed = true; return m; });
      region = p;
    }
    return region;
  }

  /**
   * The cameras on these tiles: kept ones at once, then the ones our region file covers, the rest in one query raced
   * against every Overpass server. Returns [{ id, lat, lon, kind }], or null when some tiles were wanted and no source had them.
   * No source answering (no signal) but every wanted tile kept within OLD_MS: the kept ones, the list marked `keptAt` (the
   * oldest tile's time) so the page can say how old. Cameras are fixed hardware: a month-old list beats none on a dead road.
   * `region`: our file's URL (null: don't ask it; tests).
   */
  async function load(tiles, { fetchFn = root.fetch && root.fetch.bind(root), storage = root.localStorage, now = Date.now(), region: regionUrl } = {}) {
    const have = [];
    let missing = [];
    for (const k of tiles) { const c = storage ? readTile(storage, k, now) : null; if (c) have.push(...c); else missing.push(k); }
    if (!missing.length) return have;
    const url = regionUrl === null ? null : regionUrl || apiBase() + REGION_PATH;
    const ours = url ? await (regionUrl ? askRegion(fetchFn, url, REGION_WAIT_MS) : regionOnce(fetchFn, url)) : null;
    if (ours) {
      const got = new Map(missing.filter((k) => ours.has(k)).map((k) => [k, ours.get(k)]));
      if (storage && got.size) writeTiles(storage, got, now);
      have.push(...[].concat(...got.values()));
      missing = missing.filter((k) => !got.has(k));
      if (!missing.length) return have;
    }
    const json = await fetchFirst(fetchFn, 'data=' + encodeURIComponent(query(missing)));
    if (!json) {
      const old = storage ? missing.map((k) => readTile(storage, k, now, OLD_MS)) : [];
      if (!old.length || old.some((c) => !c)) return null;
      const out = have.concat(...old);
      out.keptAt = Math.min(...missing.map((k) => keptAtOf(storage, k)));
      return out;
    }
    const cams = (json.elements || []).map(classify).filter(Boolean);
    const split = byTile(missing, cams);
    if (storage) writeTiles(storage, split, now);
    return have.concat(...split.values());
  }

  const api = { TILE, SERVERS, REGION_PATH, tileBox, tilesNear, tilesInBox, query, classify, byTile, regionTiles, fetchFirst, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCameras = api;
})(typeof window !== 'undefined' ? window : globalThis);
