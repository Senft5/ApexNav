// ApexRouteCtx — the route-context registry (docs/ROUTE_ENGINE.md). Every data family (the router's edge attributes,
// the DEM, map features, the national grid, weather and time, the crowd) is a provider in web/route_ctx/<name>.js that
// registers here. The planner turns each candidate route into a corridor (samples every 25 m with heading and the time
// you'd be there) and runs every provider on all candidates of one plan at once, under one overall time budget, so a slow
// or missing source never holds a route up: what came back in time is merged, the rest is reported and left unknown.
//
// Provider shape (the contract all builders share):
//   ApexRouteCtx.register({ id, version, channels: [names], needs: { network, key? }, budgetMs, priority?, stageOk?,
//                           fetch(corridors, opts) })
//   fetch resolves to { [corridor.id]: { status: 'ok'|'partial'|'unavailable'|'no-key', note?, channels: { name:
//   Float32Array(len) } (NaN = unknown, never 0), spans: [{ fromM, toM, kind, value?, label?, when? }], points: [{ atM,
//   kind, value?, label?, when? }] } }. opts = { signal (AbortSignal), budgetMs, departAt, settings, fetch }.
// Unknown stays unknown (CLAUDE.md rule 3): a provider that can't answer says so; it never fills in zeros.
(function (root) {
  'use strict';

  const STEP_M = 25;                 // corridor sample spacing (the contract)
  const DEFAULT_BUDGET_MS = 2500;    // the whole context run for one plan (REVIEW_FEEL: Where to? never waits on it)
  const providers = new Map();

  /** Adds (or replaces, by id) a provider. Returns it. Bad shapes are refused loudly in development, never at run time. */
  function register(p) {
    if (!p || typeof p.id !== 'string' || typeof p.fetch !== 'function' || !Array.isArray(p.channels)) throw new Error('ApexRouteCtx.register: needs id, channels and fetch');
    const entry = { version: 1, needs: {}, budgetMs: DEFAULT_BUDGET_MS, priority: 50, stageOk: false, ...p };
    providers.set(p.id, entry);
    return entry;
  }
  const unregister = (id) => { providers.delete(id); if (Array.isArray(shared.providers)) shared.providers = shared.providers.filter((p) => p.id !== id); };
  // Providers that loaded before this file register on a shim (`{ providers: [], register }`, web/route_ctx/osm_common.js);
  // the registry adopts that object rather than replacing it, so a provider holding the shim registers here too, in any
  // script order, and anything pushed onto `providers` directly is picked up when the list is read.
  const shared = root.ApexRouteCtx && typeof root.ApexRouteCtx === 'object' ? root.ApexRouteCtx : {};
  // (builder E's shim, ctx_util.js, queues them on `pending` instead: both are adopted)
  const adopt = () => { for (const p of [...(Array.isArray(shared.providers) ? shared.providers : []), ...(Array.isArray(shared.pending) ? shared.pending : [])]) if (p && p.id && !providers.has(p.id) && typeof p.fetch === 'function') { try { register(p); } catch (_) { /* a bad shape stays out */ } } };
  const list = () => { adopt(); return [...providers.values()].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1)); };

  // ---- corridors --------------------------------------------------------------------------------------------------
  const R = 6371008.8;
  const rad = (d) => d * Math.PI / 180;
  function hav(lat1, lon1, lat2, lon2) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Initial bearing p → q in radians (0 = north, clockwise), the heading convention of web/sun.js azimuths. */
  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    const b = Math.atan2(y, x);
    return b < 0 ? b + 2 * Math.PI : b;
  }
  /** Cumulative metres along [[lon, lat]] coords. */
  function cumulative(coords) {
    const out = new Float64Array(coords.length);
    for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + hav(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    return out;
  }
  /**
   * A route ([[lon, lat]] coords) as a corridor: samples every STEP_M with heading (radians), the bbox [s, w, n, e], and the
   * epoch ms you'd be at each sample. Times come from the router's own clock (`marks`: [[metres, seconds so far]], e.g.
   * cockpit timeMarksOf) else its total time spread by distance, else 50 km/h; scaled by the driver's pace (real / router
   * seconds, 0.6–1.8) when known. `edges` (router edge spans) ride along untouched.
   */
  function corridor(id, coords, o = {}) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const cum = cumulative(coords), total = cum[cum.length - 1];
    const n = Math.max(2, Math.floor(total / STEP_M) + 1 + (total % STEP_M > 1 ? 1 : 0));
    const lat = new Float64Array(n), lon = new Float64Array(n), distM = new Float64Array(n), heading = new Float32Array(n), etaAt = new Float64Array(n);
    let s = 90, w = 180, nn = -90, e = -180;
    for (let k = 0, j = 0; k < n; k++) {
      const m = Math.min(total, k * STEP_M);
      while (j < cum.length - 2 && cum[j + 1] < m) j++;
      const seg = cum[j + 1] - cum[j], f = seg > 0 ? (m - cum[j]) / seg : 0;
      lat[k] = coords[j][1] + (coords[j + 1][1] - coords[j][1]) * f;
      lon[k] = coords[j][0] + (coords[j + 1][0] - coords[j][0]) * f;
      distM[k] = m;
      heading[k] = bearing(coords[j][1], coords[j][0], coords[j + 1][1], coords[j + 1][0]);
      s = Math.min(s, lat[k]); nn = Math.max(nn, lat[k]); w = Math.min(w, lon[k]); e = Math.max(e, lon[k]);
    }
    const departAt = Number.isFinite(o.departAt) ? o.departAt : Date.now();
    const pace = Number.isFinite(o.pace) ? Math.max(0.6, Math.min(1.8, o.pace)) : 1;
    const marks = Array.isArray(o.marks) ? o.marks.filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])).sort((a, b) => a[0] - b[0]) : [];
    const timeS = Number.isFinite(o.timeS) && o.timeS > 0 ? o.timeS : total / (50 / 3.6);
    const secAt = (m) => {
      if (marks.length >= 2) {
        let i = 0;
        while (i < marks.length - 2 && marks[i + 1][0] < m) i++;
        const [m0, s0] = marks[i], [m1, s1] = marks[i + 1];
        if (m >= m1 && i === marks.length - 2) return s1 + (timeS - s1) * (total > m1 ? (m - m1) / (total - m1) : 0);
        return m1 > m0 ? s0 + (s1 - s0) * Math.max(0, Math.min(1, (m - m0) / (m1 - m0))) : s0;
      }
      return total > 0 ? timeS * m / total : 0;
    };
    for (let k = 0; k < n; k++) etaAt[k] = departAt + secAt(distM[k]) * pace * 1000;
    return { id, lat, lon, distM, heading, bbox: [s, w, nn, e], edges: o.edges || null, departAt, etaAt, car: o.car || null, driver: o.driver || null,
             coords, totalM: total, timeS: timeS * pace };
  }
  /** The union bbox [s, w, n, e] of corridors (what a provider fetches once for a whole plan), padded by `padDeg`. */
  function unionBox(corridors, padDeg = 0) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const c of corridors || []) if (c && c.bbox) { s = Math.min(s, c.bbox[0]); w = Math.min(w, c.bbox[1]); n = Math.max(n, c.bbox[2]); e = Math.max(e, c.bbox[3]); }
    return s > n ? null : [s - padDeg, w - padDeg, n + padDeg, e + padDeg];
  }
  /** Sample index nearest `m` metres along a corridor. */
  const indexAt = (c, m) => Math.max(0, Math.min(c.distM.length - 1, Math.round(m / STEP_M)));
  /** A channel of NaN (unknown) for a corridor. */
  const unknown = (c) => new Float32Array(c.distM.length).fill(NaN);
  /** Fills a channel from spans along the corridor ([{ fromM, toM, value }]); samples no span covers stay NaN. */
  function fillSpans(c, spans, ch = unknown(c)) {
    for (const sp of spans || []) {
      if (!Number.isFinite(sp.fromM) || !Number.isFinite(sp.toM) || !Number.isFinite(sp.value)) continue;
      const i0 = Math.max(0, Math.ceil(sp.fromM / STEP_M - 1e-9)), i1 = Math.min(ch.length - 1, Math.floor(sp.toM / STEP_M));
      for (let i = i0; i <= i1; i++) ch[i] = sp.value;
    }
    return ch;
  }

  // ---- caching (per tile/cell/candidate, with a TTL) --------------------------------------------------------------
  /** A small in-memory TTL cache with a size cap (oldest out first). Providers keep their own per tile/cell/candidate. */
  function cache(ttlMs, max = 200) {
    const m = new Map();
    return {
      get(k) { const v = m.get(k); if (!v) return undefined; if (Date.now() - v.at > ttlMs) { m.delete(k); return undefined; } return v.value; },
      set(k, value) { m.delete(k); m.set(k, { at: Date.now(), value }); while (m.size > max) m.delete(m.keys().next().value); return value; },
      clear() { m.clear(); }, get size() { return m.size; },
    };
  }
  /** A stable short key for a polyline (a candidate's cache key): FNV-1a over coords rounded to ~1 m. */
  function keyOf(coords) {
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(coords.length / 400));
    for (let i = 0; i < coords.length; i += step) {
      const s = `${coords[i][0].toFixed(5)},${coords[i][1].toFixed(5)};`;
      for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    }
    return `${coords.length}:${h.toString(36)}`;
  }

  // ---- running providers ------------------------------------------------------------------------------------------
  const STATUSES = new Set(['ok', 'partial', 'unavailable', 'no-key']);
  /** One provider's answer for one corridor, cleaned: channels the wrong length or type are dropped (never trusted). */
  // Channels a provider gives under a name it shares with another but in its own codes, translated to the canonical codes
  // (docs/ROUTE_ENGINE.md) before merging. The map tiles' class (OpenMapTiles: 1 motorway … 6 minor, 7 service, 8 track)
  // becomes the router's (0 motorway … 6 residential, 7 service).
  const TRANSLATE = { osm_tiles: { road_class: (v) => ({ 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 6, 7: 7, 8: 7, 9: 7 }[v] ?? NaN) } };
  function clean(c, r, id = null) {
    const out = { status: r && STATUSES.has(r.status) ? r.status : 'unavailable', note: r && r.note ? String(r.note) : undefined, channels: {}, spans: [], points: [] };
    if (!r) return out;
    const tr = (id && TRANSLATE[id]) || {};
    for (const [k, v] of Object.entries(r.channels || {})) {
      if (!v || v.length !== c.distM.length || typeof v[Symbol.iterator] !== 'function') continue;
      const f = tr[k];
      out.channels[k] = f ? Float32Array.from(v, (x) => (x == null || Number.isNaN(x) ? NaN : f(x))) : v instanceof Float32Array ? v : Float32Array.from(v, (x) => (x == null ? NaN : x));
    }
    for (const s of r.spans || []) if (s && Number.isFinite(s.fromM) && Number.isFinite(s.toM) && typeof s.kind === 'string') out.spans.push(s);
    for (const p of r.points || []) if (p && Number.isFinite(p.atM) && typeof p.kind === 'string') out.points.push(p);
    return out;
  }
  /**
   * Merges providers' answers for one corridor. A channel two providers both give takes, per sample, the first known value
   * in provider priority order (lower first): the better source wins where it knows, the other fills its gaps.
   */
  function merge(c, parts) {
    const channels = {}, spans = [], points = [], from = {};
    for (const { id, res } of parts) {
      for (const [k, v] of Object.entries(res.channels)) {
        if (!channels[k]) { channels[k] = Float32Array.from(v); from[k] = [id]; continue; }
        const ch = channels[k];
        let used = false;
        for (let i = 0; i < ch.length; i++) if (Number.isNaN(ch[i]) && !Number.isNaN(v[i])) { ch[i] = v[i]; used = true; }
        if (used) from[k].push(id);
      }
      for (const s of res.spans) spans.push({ ...s, source: id });
      for (const p of res.points) points.push({ ...p, source: id });
    }
    spans.sort((a, b) => a.fromM - b.fromM); points.sort((a, b) => a.atM - b.atM);
    return { channels, spans, points, from };
  }
  /** One status for a provider over all corridors: ok when every one is, partial when some answered, else the first failure. */
  const overall = (ss) => (ss.every((s) => s === 'ok') ? 'ok' : ss.some((s) => s === 'ok' || s === 'partial') ? 'partial' : ss[0] || 'unavailable');
  const LATE = new Set(['conditions', 'wildlife', 'hazards-live', 'events', 'car']), LATE_AT = 0.5;
  /**
   * What the second phase gets from the first (per corridor id): `channels` under the names D's providers read (forest_frac,
   * farmland_frac, canopy_frac, urban_density, elev_m, tpi_m, bridge, park, precip_48h_mm), `peer` (all channels, for E's car:
   * C's mobile_coverage) and `places` ({ schools, worship } as [{ lat, lon }] from the map providers' points).
   */
  function inputsFor(cs, res) {
    const channels = {}, peer = {}, schools = [], worship = [];
    const pick = (ch, names, f = (v) => v) => { for (const n of names) if (ch[n]) return Float32Array.from(ch[n], (v) => (Number.isFinite(v) ? f(v) : NaN)); return null; };
    for (const c of cs) {
      const r = res.byId[c.id];
      if (!r) continue;
      const ch = r.channels, out = {};
      const put = (k, v) => { if (v) out[k] = v; };
      put('forest_frac', pick(ch, ['forest_share', 'lu_forest']));
      put('farmland_frac', pick(ch, ['lu_farmland', 'open_country']));
      put('canopy_frac', pick(ch, ['canopy_pct'], (v) => v / 100));
      put('urban_density', pick(ch, ['density']));
      put('park', pick(ch, ['lu_park', 'protected']));
      for (const k of ['elev_m', 'tpi_m', 'bridge', 'precip_48h_mm']) put(k, pick(ch, [k]));
      channels[c.id] = out;
      peer[c.id] = { channels: ch };
      for (const pt of r.points || []) {
        const i = Math.max(0, Math.min(c.lat.length - 1, Math.round(pt.atM / STEP_M)));
        if (pt.kind === 'school') schools.push({ lat: c.lat[i], lon: c.lon[i], name: pt.label || null });
        if (pt.kind === 'worship') worship.push({ lat: c.lat[i], lon: c.lon[i], name: pt.label || null });
      }
    }
    return { channels, peer, ...(schools.length || worship.length ? { places: { schools, worship } } : {}) };
  }
  const sleep = (ms, signal) => new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
  /**
   * Runs every registered provider (or `opts.only`) on the corridors concurrently, under one overall budget. Each provider
   * gets min(its budgetMs, what's left) and an AbortSignal that fires at the deadline (or when opts.signal does). Resolves at
   * the deadline at the latest with what came back: { byId: { [corridorId]: { channels, spans, points, from } }, status:
   * { [providerId]: { status, ms, note } }, complete: bool }. `opts.onUpdate(result)` is called each time a provider lands,
   * so the ranking can refine as data arrives. Never throws.
   */
  async function run(corridors, opts = {}) {
    const cs = (corridors || []).filter((c) => c && c.distM && c.distM.length);
    const budget = Number.isFinite(opts.budgetMs) ? opts.budgetMs : DEFAULT_BUDGET_MS;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (opts.signal) { if (opts.signal.aborted) ctrl && ctrl.abort(); else opts.signal.addEventListener('abort', () => ctrl && ctrl.abort(), { once: true }); }
    const t0 = Date.now(), status = {}, landed = new Map();
    const chosen = list().filter((p) => (!opts.only || opts.only.includes(p.id)) && !(opts.skip && opts.skip.includes(p.id)) && (!opts.stage || p.stageOk));
    const settings = opts.settings || {};
    const result = () => {
      const byId = {};
      for (const c of cs) byId[c.id] = merge(c, [...landed.entries()].map(([id, all]) => ({ id, res: all[c.id] })).filter((x) => x.res)
        .sort((a, b) => providers.get(a.id).priority - providers.get(b.id).priority));
      return { byId, status: { ...status }, complete: chosen.every((p) => status[p.id] && status[p.id].status !== 'pending') };
    };
    if (!cs.length || !chosen.length) return result();
    for (const p of chosen) status[p.id] = { status: 'pending', ms: null };
    // Two phases: providers that read other providers' channels (D's conditions, wildlife and live hazards read land use,
    // terrain and density; E's car reads C's coverage; D's events reads schools and churches) start once the first phase
    // has landed, or at LATE_AT of the budget, whichever is first, with what has arrived as opts.channels / peer / places.
    const late = (p) => (p.needs && p.needs.channels === true) || LATE.has(p.id);
    const early = chosen.filter((p) => !late(p));
    let firstDone = null;
    const firstPhase = new Promise((resolve) => { firstDone = resolve; });
    setTimeout(() => firstDone(), Math.max(0, budget * LATE_AT));
    const tasks = chosen.map(async (p) => {
      if (late(p)) await firstPhase;
      const t = Date.now();
      const inputs = late(p) ? inputsFor(cs, result()) : {};
      if (p.needs && p.needs.key && !settings[p.needs.key]) { status[p.id] = { status: 'no-key', ms: 0, note: `needs ${p.needs.key}` }; return; }
      if (ctrl && ctrl.signal.aborted) { status[p.id] = { status: 'unavailable', ms: 0, note: 'cancelled' }; return; }
      const mine = typeof AbortController === 'function' ? new AbortController() : null;
      const left = Math.max(0, budget - (Date.now() - t0)), ms = Math.min(left, p.budgetMs || left);
      const timer = setTimeout(() => mine && mine.abort(), ms);
      const off = () => mine && mine.abort();
      if (ctrl) ctrl.signal.addEventListener('abort', off, { once: true });
      try {
        const raw = await Promise.race([
          Promise.resolve().then(() => p.fetch(cs, { ...(opts.providerOpts || {}), ...inputs, signal: mine ? mine.signal : undefined, budgetMs: ms, departAt: opts.departAt, settings, ...(opts.fetch ? { fetch: opts.fetch } : {}) })),
          sleep(ms + 50, mine ? mine.signal : undefined).then(() => null),
        ]);
        if (!raw) { status[p.id] = { status: 'unavailable', ms: Date.now() - t, note: 'out of time' }; return; }
        const all = {};
        for (const c of cs) all[c.id] = clean(c, raw[c.id], p.id);
        landed.set(p.id, all);
        status[p.id] = { status: overall(cs.map((c) => all[c.id].status)), ms: Date.now() - t };
        if (typeof opts.onUpdate === 'function') { try { opts.onUpdate(result()); } catch (_) { /* a listener's bug is not the provider's */ } }
      } catch (e) {
        status[p.id] = { status: 'unavailable', ms: Date.now() - t, note: String((e && e.message) || e).slice(0, 80) };
      } finally {
        clearTimeout(timer);
        if (ctrl) ctrl.signal.removeEventListener('abort', off);
      }
    });
    Promise.allSettled(tasks.filter((_, k) => early.includes(chosen[k]))).then(() => firstDone());
    await Promise.race([Promise.allSettled(tasks), sleep(budget + 100, ctrl ? ctrl.signal : undefined)]);
    if (ctrl) ctrl.abort();
    for (const p of chosen) if (status[p.id].status === 'pending') status[p.id] = { status: 'unavailable', ms: Date.now() - t0, note: 'out of time' };
    return result();
  }

  const api = { STEP_M, DEFAULT_BUDGET_MS, TRANSLATE, LATE, inputsFor, register, unregister, list, corridor, unionBox, indexAt, unknown, fillSpans, cache, keyOf, run, merge, clean, hav, bearing, cumulative };
  adopt();
  if (!Array.isArray(shared.providers)) shared.providers = [];
  delete shared.shim;
  // providers registering later through the shim's own reference land here too (and stay visible on `providers`)
  Object.assign(shared, api, { register: (p) => { const e = register(p); if (!shared.providers.some((x) => x.id === p.id)) shared.providers.push(p); return e; } });
  if (typeof module !== 'undefined' && module.exports) module.exports = shared;
  root.ApexRouteCtx = shared;
})(typeof window !== 'undefined' ? window : globalThis);
