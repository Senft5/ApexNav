// Shared helpers for the route-context providers in web/route_ctx/ (docs/ROUTE_CTX.md; ROUTE_ENGINE_CONTRACT): builder D's
// at the top level, builder E's under `.E` (merged from the two files each wrote).
// A provider registers on root.ApexRouteCtx.register(...). If the engine's registry (web/route_ctx/registry.js, builder A)
// isn't loaded yet, a minimal shim keeps the providers in `ApexRouteCtx.pending` for it to adopt, so load order doesn't
// matter. Everything here is pure or takes fetch/storage from the caller (tests run it under node).
//
// Corridor (the contract): { id, lat: Float64Array, lon: Float64Array, distM: Float64Array, heading: Float32Array (radians,
// clockwise from north), bbox: [s, w, n, e], edges?, departAt, etaAt: Float64Array (epoch ms), car, driver }, samples 25 m
// apart. Optional extras a provider reads when the engine passes them (never required): corridor.channels / opts.channels[id]
// with elev_m (DEM metres), tpi_m (topographic position: + ridge, − valley), forest_frac, canopy_frac, farmland_frac,
// urban_density (router 0-15), bridge (1/0), park (1/0).
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const DEG = Math.PI / 180, R_EARTH = 6371008.8;

  // ---- the registry shim ----------------------------------------------------------------------------------------------
  function registry() {
    if (root.ApexRouteCtx && typeof root.ApexRouteCtx.register === 'function') return root.ApexRouteCtx;
    const pending = [];
    root.ApexRouteCtx = { pending, shim: true, register(p) { pending.push(p); return p; }, providers: () => pending.slice() };
    return root.ApexRouteCtx;
  }
  const register = (p) => registry().register(p);

  // ---- results ----------------------------------------------------------------------------------------------------------
  const nanArray = (n) => new Float32Array(n).fill(NaN);
  /** An empty result for a corridor: every named channel all-NaN (unknown, never 0). */
  function emptyResult(corridor, channels, status = 'unavailable', note) {
    const n = corridor.lat.length, out = { status, channels: {}, spans: [], points: [] };
    if (note) out.note = note;
    for (const c of channels) out.channels[c] = nanArray(n);
    return out;
  }
  /** The same status for every corridor (e.g. 'no-key'). */
  function allStatus(corridors, channels, status, note) {
    const out = {};
    for (const c of corridors) out[c.id] = emptyResult(c, channels, status, note);
    return out;
  }
  /**
   * Spans from a per-sample test: runs of samples where `test(i)` is true become { fromM, toM, kind, value, label }, value
   * the run's max of valueAt(i). Runs closer than `joinM` merge; runs shorter than `minM` are dropped.
   */
  function spansWhere(distM, test, kind, { valueAt, label, joinM = 50, minM = 0 } = {}) {
    const out = [];
    let cur = null;
    for (let i = 0; i < distM.length; i++) {
      if (!test(i)) continue;
      const v = valueAt ? valueAt(i) : undefined;
      if (cur && distM[i] - cur.toM <= joinM) { cur.toM = distM[i]; if (finite(v) && !(v <= cur.value)) cur.value = v; continue; }
      if (cur) out.push(cur);
      cur = { fromM: distM[i], toM: distM[i], kind };
      if (finite(v)) cur.value = v;
      if (label) cur.label = typeof label === 'function' ? label(i) : label;
    }
    if (cur) out.push(cur);
    return out.filter((s) => s.toM - s.fromM >= minM);
  }

  // ---- geometry ---------------------------------------------------------------------------------------------------------
  /** Great-circle distance in metres. */
  function metres(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * DEG, p2 = lat2 * DEG, dp = p2 - p1, dl = (lon2 - lon1) * DEG;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Initial bearing from 1 to 2, radians clockwise from north in [0, 2π). */
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
    const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
    return (b + 2 * Math.PI) % (2 * Math.PI);
  }
  /** Smallest absolute difference of two angles (radians), in [0, π]. */
  const angleOff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  const GRID = 0.01;                                    // degrees: the index cell for nearest-sample lookups
  const indexes = typeof WeakMap === 'function' ? new WeakMap() : null;
  function sampleIndex(corridor) {
    let idx = indexes && indexes.get(corridor);
    if (idx) return idx;
    idx = new Map();
    for (let i = 0; i < corridor.lat.length; i++) {
      const k = Math.floor(corridor.lat[i] / GRID) + ',' + Math.floor(corridor.lon[i] / GRID);
      let a = idx.get(k); if (!a) idx.set(k, (a = [])); a.push(i);
    }
    if (indexes) indexes.set(corridor, idx);
    return idx;
  }
  /**
   * The corridor sample nearest a point, if within maxM: { i, atM, dM } or null. maxM up to ~1 km uses the grid index
   * (cells of 0.01°); a larger radius scans every sample.
   */
  function nearestSample(corridor, lat, lon, maxM = 50) {
    if (!finite(lat) || !finite(lon)) return null;
    let best = null;
    const consider = (i) => {
      const d = metres(lat, lon, corridor.lat[i], corridor.lon[i]);
      if (d <= maxM && (!best || d < best.dM)) best = { i, atM: corridor.distM[i], dM: d };
    };
    if (maxM <= 1100) {
      const idx = sampleIndex(corridor), ci = Math.floor(lat / GRID), cj = Math.floor(lon / GRID);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const s = idx.get((ci + a) + ',' + (cj + b)); if (s) s.forEach(consider); }
    } else for (let i = 0; i < corridor.lat.length; i++) consider(i);
    return best;
  }
  /** Samples within radiusM of a point: [{ i, dM }] (each corridor pass near it counts; a loop can pass twice). */
  function samplesWithin(corridor, lat, lon, radiusM) {
    const out = [];
    if (!finite(lat) || !finite(lon)) return out;
    const r = Math.ceil(radiusM / 1100), idx = radiusM <= 5500 ? sampleIndex(corridor) : null;
    const ci = Math.floor(lat / GRID), cj = Math.floor(lon / GRID);
    const test = (i) => { const d = metres(lat, lon, corridor.lat[i], corridor.lon[i]); if (d <= radiusM) out.push({ i, dM: d }); };
    if (idx) { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const s = idx.get((ci + a) + ',' + (cj + b)); if (s) s.forEach(test); } }
    else for (let i = 0; i < corridor.lat.length; i++) test(i);
    return out.sort((x, y) => x.i - y.i);
  }
  /** Contiguous index runs from a sorted list of sample indexes: [[from, to]]. */
  function runs(list, gap = 1) {
    const out = [];
    for (const { i } of list) { const last = out[out.length - 1]; if (last && i - last[1] <= gap) last[1] = i; else out.push([i, i]); }
    return out;
  }

  /** The union bbox [s, w, n, e] of several corridors, padded by padDeg. */
  function unionBox(corridors, padDeg = 0) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const c of corridors) {
      const b = c.bbox || boxOf(c);
      s = Math.min(s, b[0]); w = Math.min(w, b[1]); n = Math.max(n, b[2]); e = Math.max(e, b[3]);
    }
    return [s - padDeg, w - padDeg, n + padDeg, e + padDeg];
  }
  function boxOf(c) {
    let s = 90, w = 180, n = -90, e = -180;
    for (let i = 0; i < c.lat.length; i++) { s = Math.min(s, c.lat[i]); n = Math.max(n, c.lat[i]); w = Math.min(w, c.lon[i]); e = Math.max(e, c.lon[i]); }
    return [s, w, n, e];
  }
  /** Fixed grid cells (size degrees) that any corridor sample passes within padDeg of, keys "i_j", sorted. */
  function cellsAlong(corridors, size, padDeg = 0, every = 4) {
    const out = new Set();
    for (const c of corridors) for (let i = 0; i < c.lat.length; i += every) {
      for (const la of [c.lat[i] - padDeg, c.lat[i] + padDeg]) for (const lo of [c.lon[i] - padDeg, c.lon[i] + padDeg]) out.add(Math.floor(la / size) + '_' + Math.floor(lo / size));
    }
    return [...out].sort();
  }
  /** A cell's box [s, w, n, e]. */
  function cellBox(key, size) { const [i, j] = key.split('_').map(Number); return [i * size, j * size, (i + 1) * size, (j + 1) * size]; }
  /** The cell's centre [lat, lon]. */
  function cellCentre(key, size) { const b = cellBox(key, size); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  const cellOf = (lat, lon, size) => Math.floor(lat / size) + '_' + Math.floor(lon / size);

  // ---- local time -------------------------------------------------------------------------------------------------------
  // The seven states straddle Eastern and Central time. A coarse split, good to a county or two along the line (western KY,
  // middle/west TN and the Indiana corners are Central); used for bell times and church hours, never shown as a time.
  function zoneAt(lat, lon) {
    if (lat < 36.7 && lat > 34.9 && lon < (lat < 35.3 ? -85.6 : -85.0)) return 'America/Chicago';   // Tennessee west of the Plateau (Chattanooga is Eastern)
    if (lat >= 36.4 && lat < 38.3 && lon < -85.3 - (lat - 36.6) * 0.785) return 'America/Chicago';  // western Kentucky (Bowling Green, Owensboro)
    if (lat >= 37.7 && lat < 38.3 && lon < -86.7) return 'America/Chicago';                         // SW Indiana (Evansville)
    if (lat >= 41.1 && lon < -86.75) return 'America/Chicago';                                      // NW Indiana (Gary)
    return 'America/New_York';
  }
  const fmtCache = new Map();
  // the answer to the minute, per zone (a corridor's samples are seconds apart: formatToParts once a minute, not per
  // sample; live 2026-11-07 it was 75 ms of every ranking on a 30 km trip). Same answer as uncached: the clock is to the
  // minute and the seconds never enter it.
  const minuteCache = new Map(), MINUTE_MAX = 4096;
  /** Local calendar and clock at an instant: { y, m (1-12), d, dow (0 Sun), hour (fractional), doy, zone }. */
  function localTime(ms, lat, lon) {
    const zone = zoneAt(lat, lon), mk = Number.isFinite(ms) ? `${zone}|${Math.floor(ms / 60000)}` : null;
    const hit = mk && minuteCache.get(mk);
    if (hit) return { ...hit };
    const out = localTimeOf(ms, zone);
    if (mk) { if (minuteCache.size >= MINUTE_MAX) minuteCache.clear(); minuteCache.set(mk, out); }
    return { ...out };
  }
  function localTimeOf(ms, zone) {
    let f = fmtCache.get(zone);
    if (!f) {
      try { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }); }
      catch (_) { f = null; }
      fmtCache.set(zone, f);
    }
    let y, m, d, h, mi, wd;
    if (f) {
      const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
      y = +p.year; m = +p.month; d = +p.day; h = +p.hour % 24; mi = +p.minute; wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    } else {                                                                      // no Intl zones: fixed US Eastern standard
      const t = new Date(ms - 5 * 3600e3); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); h = t.getUTCHours(); mi = t.getUTCMinutes(); wd = t.getUTCDay();
    }
    const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
    return { y, m, d, dow: wd, hour: h + mi / 60, doy, zone };
  }
  // Which of the seven route states a point is in, coarsely: the Ohio River as a polyline, the KY/TN line at 36.6°, the
  // TN/NC line as a straight line along the crest, the VA/KY and VA/WV lines as straight lines. Good to a few km; used only
  // to pick a row of a seasonal table (the rows differ little between neighbours). null outside the region.
  const OHIO_RIVER = [[-88.1, 37.0], [-87.57, 37.97], [-86.5, 37.95], [-85.76, 38.26], [-85.38, 38.73], [-84.85, 39.09], [-84.5, 39.09],
    [-84.2, 38.88], [-83.6, 38.66], [-82.99, 38.73], [-82.6, 38.42], [-82.2, 38.81], [-81.45, 39.41], [-80.72, 40.06], [-80.52, 40.64]];
  function riverLat(lon) {
    for (let k = 1; k < OHIO_RIVER.length; k++) {
      const [x0, y0] = OHIO_RIVER[k - 1], [x1, y1] = OHIO_RIVER[k];
      if (lon >= x0 && lon <= x1) return y0 + (y1 - y0) * (lon - x0) / (x1 - x0);
    }
    return null;
  }
  function stateAt(lat, lon) {
    if (!finite(lat) || !finite(lon) || lat < 34.0 || lat > 42.0 || lon < -90.3 || lon > -75.2) return null;
    const river = riverLat(lon);
    if (river !== null && lat >= river) return lon < -84.82 ? 'IN' : lon < -80.52 ? 'OH' : null;
    if (lon < -88.1) return lat < 36.6 ? 'TN' : null;                      // west of the river's mouth: Tennessee or outside
    if (lon > -80.52 && lat > 39.72) return null;                           // Pennsylvania
    if (lat < 36.6) return lon > -84.3 + (lat - 35.0) * (2.62 / 1.59) ? 'NC' : 'TN';
    const vaKy = -83.68 + (lat - 36.6) * (1.71 / 0.9);                      // the VA/KY line, Cumberland Gap to the Big Sandy
    if (lon < vaKy && (lon < -82.6 || lat < 37.6)) return 'KY';
    if (lon <= -77.72 && lat > 37.25 + Math.max(0, lon + 81.0) * 0.55) return 'WV';
    return lon > vaKy ? 'VA' : 'KY';
  }

  // ---- channels the engine may pass in ----------------------------------------------------------------------------------
  /** A channel by any of `names`, from the corridor or opts.channels[corridor.id]; null when none is there. */
  function chan(corridor, opts, names) {
    for (const n of names) {
      const a = (corridor.channels && corridor.channels[n]) || (opts && opts.channels && opts.channels[corridor.id] && opts.channels[corridor.id][n]);
      if (a && a.length === corridor.lat.length) return a;
    }
    return null;
  }
  /** Grade (rise/run) per sample from an elevation channel, over ±2 samples (±50 m); NaN where unknown. */
  function gradeOf(distM, elev) {
    const n = distM.length, out = new Float32Array(n).fill(NaN);
    if (!elev) return out;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      if (b > a && finite(elev[a]) && finite(elev[b]) && distM[b] > distM[a]) out[i] = (elev[b] - elev[a]) / (distM[b] - distM[a]);
    }
    return out;
  }

  // ---- keys -------------------------------------------------------------------------------------------------------------
  // A free key the owner (or a driver, Settings) enters is kept on the phone under localStorage 'apex.keys' as JSON
  // { settingName: value }, or passed by the engine as opts.keys. Never in the code.
  function keyFor(opts, name) {
    if (opts && opts.keys && typeof opts.keys[name] === 'string' && opts.keys[name]) return opts.keys[name];
    try {
      const st = (opts && opts.storage) || root.localStorage;
      const all = st ? JSON.parse(st.getItem('apex.keys') || 'null') : null;
      return all && typeof all[name] === 'string' && all[name] ? all[name] : null;
    } catch (_) { return null; }
  }

  /**
   * The owner's free client keys from the Worker (GET /api/ctx/keys, set as its CTX_KEYS secret), merged under 'apex.keys'
   * once a day; a key already there (entered on this phone) wins. Call once at start-up; never throws.
   */
  async function loadKeys({ fetchFn, storage, apiBase, now = Date.now() } = {}) {
    try {
      storage = storage || root.localStorage;
      const base = apiBase !== undefined ? apiBase : root.ApexSync ? root.ApexSync.apiBase : null;
      if (!storage || base === null || base === undefined) return null;
      const at = +(storage.getItem('apex.keys.at') || 0);
      if (now - at < 864e5) return JSON.parse(storage.getItem('apex.keys') || '{}');
      const j = await getJSON(fetchFn || (root.fetch && root.fetch.bind(root)), base + '/api/ctx/keys', { timeoutMs: 5000, headers: { 'x-apexnav': '1' } });
      if (!j || !j.keys) return null;
      const mine = JSON.parse(storage.getItem('apex.keys') || '{}') || {};
      const merged = { ...j.keys, ...mine };
      storage.setItem('apex.keys', JSON.stringify(merged)); storage.setItem('apex.keys.at', String(now));
      return merged;
    } catch (_) { return null; }
  }

  // ---- cache ------------------------------------------------------------------------------------------------------------
  const PREFIX = 'apex.rctx.', MAX_KEYS = 600;
  /** A cached value younger than ttlMs, or undefined. */
  function cacheGet(storage, key, ttlMs, now) {
    if (!storage) return undefined;
    try { const c = JSON.parse(storage.getItem(PREFIX + key) || 'null'); return c && now - c.at < ttlMs ? c.v : undefined; } catch (_) { return undefined; }
  }
  function cachePut(storage, key, v, now) {
    if (!storage) return;
    try { storage.setItem(PREFIX + key, JSON.stringify({ at: now, v })); } catch (_) { prune(storage, Math.floor(MAX_KEYS / 2)); try { storage.setItem(PREFIX + key, JSON.stringify({ at: now, v })); } catch (__) {} }
    if (Math.random() < 0.05) prune(storage, MAX_KEYS);
  }
  /** Keep the newest `keep` cache entries. */
  function prune(storage, keep) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
      if (keys.length <= keep) return;
      const aged = keys.map((k) => { try { return [k, JSON.parse(storage.getItem(k)).at || 0]; } catch (_) { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
      for (const [k] of aged.slice(0, keys.length - keep)) storage.removeItem(k);
    } catch (_) {}
  }

  // ---- network ----------------------------------------------------------------------------------------------------------
  /**
   * fetch → parsed body, or null on any failure (never throws). Aborts at timeoutMs or when opts.signal aborts.
   * `as`: 'json' (default) or 'text'.
   */
  async function getJSON(fetchFn, url, { timeoutMs = 8000, signal, headers, as = 'json', method, body } = {}) {
    if (!fetchFn || (signal && signal.aborted)) return null;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let quit;
    const gaveUp = new Promise((res) => { quit = () => res(null); });     // resolves null even if fetchFn ignores the signal
    const stop = () => { try { ctrl && ctrl.abort(); } catch (_) {} quit(); };
    const t = setTimeout(stop, Math.max(1, timeoutMs));
    if (signal && signal.addEventListener) signal.addEventListener('abort', stop, { once: true });
    const go = (async () => {
      const r = await fetchFn(url, { method: method || 'GET', body, headers, signal: ctrl ? ctrl.signal : undefined });
      if (!r || !r.ok) return null;
      return as === 'text' ? await r.text() : await r.json();
    })().catch(() => null);
    try { return await Promise.race([go, gaveUp]); } finally { clearTimeout(t); if (signal && signal.removeEventListener) signal.removeEventListener('abort', stop); }
  }
  /** Run async jobs at most `limit` at a time; resolves to their results in order (a failed job is null). */
  async function pool(jobs, limit = 3) {
    const out = new Array(jobs.length).fill(null);
    let next = 0;
    const worker = async () => { while (next < jobs.length) { const k = next++; try { out[k] = await jobs[k](); } catch (_) { out[k] = null; } } };
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return out;
  }
  /** Resolve with `p`, or with `fallback` once ms pass (the provider's budget); `ctrl` (an AbortController) is aborted then. */
  function within(p, ms, fallback, ctrl) {
    let t;
    return Promise.race([p, new Promise((res) => { t = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (_) {} res(fallback); }, Math.max(0, ms)); })]).finally(() => clearTimeout(t));
  }
  /** An AbortController that also aborts when `signal` does (the engine's plan was cancelled). */
  function linked(signal) {
    const c = typeof AbortController === 'function' ? new AbortController() : null;
    if (c && signal) { if (signal.aborted) c.abort(); else if (signal.addEventListener) signal.addEventListener('abort', () => c.abort(), { once: true }); }
    return c;
  }
  /** opts → { fetchFn, storage, now, signal } with the page's defaults. */
  function env(opts = {}) {
    let storage = opts.storage;
    if (storage === undefined) { try { storage = root.localStorage || null; } catch (_) { storage = null; } }
    return { fetchFn: opts.fetchFn || (root.fetch ? root.fetch.bind(root) : null), storage, now: finite(opts.now) ? opts.now : Date.now(), signal: opts.signal };
  }

  // ---- builder E's helpers (crowd, driver, car, ios_context, crew_meet) -------------------------------------------------
  // Both builders wrote a ctx_util.js; this is the one file. E's providers read these as `ApexRouteCtxUtil.E`: four of them
  // (spansWhere, within, metres, unionBox) take other arguments than D's helpers of the same name.
  /** A channel of n samples, all unknown. */
  const nan = (n) => new Float32Array(n).fill(NaN);

  /**
   * Spans where pred(value, i) holds for at least minLenM of corridor distance: [{ fromM, toM, kind, value, label }], value the
   * mean over the span (NaN samples never count as holding).
   */
  function eSpansWhere(ch, distM, pred, minLenM, kind, label) {
    const out = [];
    let a = -1, sum = 0, n = 0;
    const close = (end) => {
      if (a >= 0 && distM[end] - distM[a] >= minLenM) {
        const lab = typeof label === 'function' ? label(a, end) : label;
        out.push({ fromM: Math.round(distM[a]), toM: Math.round(distM[end]), kind, value: Math.round((sum / n) * 1000) / 1000, ...(lab ? { label: lab } : {}) });
      }
      a = -1; sum = 0; n = 0;
    };
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (finite(v) && pred(v, i)) { if (a < 0) a = i; sum += v; n++; } else if (a >= 0) close(i - 1);
    }
    if (a >= 0) close(ch.length - 1);
    return out;
  }

  /** Resolves p's value, or `fallback` after ms or when signal aborts. Never rejects. */
  function eWithin(p, ms, signal, fallback = null) {
    return new Promise((resolve) => {
      let done = false;
      const end = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => end(fallback), Math.max(0, ms));
      if (signal) { if (signal.aborted) end(fallback); else signal.addEventListener('abort', () => end(fallback), { once: true }); }
      Promise.resolve(p).then(end, () => end(fallback));
    });
  }

  // ~30 m cells (prefer.js uses 80 m for whole roads; map features along a road need finer)
  const CELL_M = 30;
  const cellKey = (lat, lon) => `${Math.round((lat * 110540) / CELL_M)}:${Math.round((lon * 111320 * Math.cos((lat * Math.PI) / 180)) / CELL_M)}`;
  /** Adds a polyline's cells to `map` with `value` (densified so no cell is skipped). geometry: [{lat, lon}] or [[lat, lon]]. */
  function paint(map, geometry, value) {
    const pts = (geometry || []).map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : p)).filter((p) => p && finite(p.lat) && finite(p.lon));
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[k + 1] || a;
      const d = Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
      const steps = Math.max(1, Math.ceil(d / (CELL_M / 2)));
      for (let s = 0; s < steps; s++) { const f = s / steps; map.set(cellKey(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f), value); }
    }
    return map;
  }
  /** The value of the cell under (lat, lon) or a neighbour; undefined when none. */
  function lookup(map, lat, lon) {
    const [y, x] = cellKey(lat, lon).split(':').map(Number);
    let hit;
    for (let dy = -1; dy <= 1 && hit === undefined; dy++) for (let dx = -1; dx <= 1; dx++) { const v = map.get(`${y + dy}:${x + dx}`); if (v !== undefined) { hit = v; break; } }
    return hit;
  }
  /** Metres between two points (flat earth, road scale). */
  const eMetres = (a, b) => Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));

  /** The union bbox [s, w, n, e] of corridors (their bbox, else their points). */
  function eUnionBox(corridors) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const c of corridors || []) {
      const b = Array.isArray(c.bbox) && c.bbox.length === 4 ? c.bbox : null;
      if (b) { s = Math.min(s, b[0]); w = Math.min(w, b[1]); n = Math.max(n, b[2]); e = Math.max(e, b[3]); continue; }
      for (let i = 0; i < (c.lat ? c.lat.length : 0); i++) { s = Math.min(s, c.lat[i]); n = Math.max(n, c.lat[i]); w = Math.min(w, c.lon[i]); e = Math.max(e, c.lon[i]); }
    }
    return s <= n && w <= e ? [s, w, n, e] : null;
  }

  const api = {
    finite, DEG, register, registry, nanArray, emptyResult, allStatus, spansWhere, metres, bearing, angleOff, nearestSample, samplesWithin, runs,
    unionBox, boxOf, cellsAlong, cellBox, cellCentre, cellOf, zoneAt, localTime, stateAt, chan, gradeOf, keyFor, loadKeys, cacheGet, cachePut, prune,
    getJSON, pool, within, linked, env, PREFIX, nan, cellKey, paint, lookup, CELL_M,
    E: { registry, nan, finite, spansWhere: eSpansWhere, within: eWithin, cellKey, paint, lookup, metres: eMetres, unionBox: eUnionBox, CELL_M },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCtxUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
