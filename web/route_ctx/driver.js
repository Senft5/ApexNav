// Route context: the driver (builder E). Who is driving and who is with them, laid on a candidate route's 25 m samples:
// a passenger aboard (gentler, flowing roads), the driver's own skill trend (how technical a route to offer), roads lit or
// unlit after dark, mapped cycle routes (courtesy), and tunnels. Sources: the corridor's own geometry and router timing,
// the driver's drives in the Log (Smooth and Brakes of the Vetta Score, on the phone only), web/sun.js for dark, and
// OpenStreetMap via Overpass (lit=*, tunnel=yes, route=bicycle relations; ODbL, attributed in About > Sources; cached per
// 0.1-degree tile for TILE_MS). Nothing about the driver leaves the phone; Overpass gets tile boxes, as cameras.js does.
//
// Settings (vocabulary.js, one home each: the plan sheet's More, "For this drive" row; saved as apex.driverPrefs):
//   passenger (Passenger aboard), lit (Lit roads at night), cyclists (Cyclist courtesy), tunnels (Tunnels: prefer them).
//   Passenger aboard also tags the recorded drive "Passenger" (drive_tags.js), so the Log knows it too.
//
// Channels (Float32Array per sample; NaN = unknown):
//   passenger_cost  0..1   how hard a sample is on a passenger: 1 a hairpin (over HAIRPIN_DEG of turn in 100 m), 0.6 an
//                          abrupt sequence (a left and a right of ABRUPT_DEG each within 150 m), else the lateral load at the
//                          router's expected speed above COMFORT_G (0) to HARSH_G (1). Geometry is always known; without
//                          the router's timing the load term drops out
//   tech_level      0..1   how technical the road is here: share of samples within 500 m that turn tighter than a 60 m
//                          radius, TECH_FULL of them = 1
//   skill_fit      -1..1   how well tech_level suits the technicality offered from the driver's skill trend (skillTrend);
//                          NaN until SKILL_MIN_DRIVES scored drives
//   dark            0/1    after dusk at the sample's ETA (sun.js isDark); NaN without an ETA
//   lit             0/1    OSM lit=yes (or 24/7, automatic...) 1 / lit=no 0; NaN untagged or not fetched (most back roads are untagged: unknown)
//   cyclist_route   0/1    on a mapped bicycle route (OSM route=bicycle) 1, not on one 0; NaN when OSM didn't answer
//   cyclist_time    0..1   how many riders to expect then: weekend morning 1, other daylight 0.5, dark 0.2; NaN no ETA
//   tunnel          0/1    in a tunnel (OSM tunnel=yes); NaN when OSM didn't answer
//   driver_fit     -1..1   the driver's preferences applied (FIT weights below); NaN when no preference is on and the skill
//                          is unknown. The engine adds it to fun (route_engine.js), as it does the other channels
// Spans: hairpins / abrupt (passenger aboard), unlit_dark (Lit roads at night), cycle_route (Cyclist courtesy), tunnel.
// Points: tunnel (its entrance). Pure parts are exported for tests (tests/test_route_ctx_driver.py).
(function (root) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports ? require('./ctx_util.js') : root.ApexRouteCtxUtil).E;   // E's helpers (ctx_util.js)
  const KEY = 'apex.driverPrefs', PREFS = ['passenger', 'lit', 'cyclists', 'tunnels'];
  const LABELS = { passenger: 'Passenger aboard', lit: 'Lit roads at night', cyclists: 'Cyclist courtesy', tunnels: 'Tunnels' };
  const CH = ['passenger_cost', 'tech_level', 'skill_fit', 'dark', 'lit', 'cyclist_route', 'cyclist_time', 'tunnel', 'driver_fit'];
  const HAIRPIN_DEG = 120, ABRUPT_DEG = 35, COMFORT_G = 0.25, HARSH_G = 0.45, TECH_R_M = 60, TECH_FULL = 0.3;
  const SKILL_MIN_DRIVES = 5, SKILL_DRIVES = 12, SKILL_MIN_CORNERS = 5;
  // driver_fit: what each preference is worth per sample (fun points come from the engine's weight on driver_fit)
  const FIT = { passenger: 1, unlit: 0.8, litBonus: 0.2, cyclists: 0.6, tunnels: 0.5, skill: 0.4 };
  const G = 9.80665, finite = U.finite;

  // ---- settings ---------------------------------------------------------------------------------------------------------
  function load(storage) {
    const o = Object.fromEntries(PREFS.map((k) => [k, false]));
    try { const v = JSON.parse((storage && storage.getItem(KEY)) || 'null'); if (v && typeof v === 'object') for (const k of PREFS) o[k] = v[k] === true; } catch (_) {}
    return o;
  }
  function save(storage, prefs) { const o = clean(prefs); try { storage.setItem(KEY, JSON.stringify(o)); } catch (_) {} return o; }
  const clean = (p) => Object.fromEntries(PREFS.map((k) => [k, !!(p && p[k])]));
  /** Tags a recorded drive gets from the preferences (drive_tags.js presets): Passenger aboard -> 'Passenger'. */
  const driveTags = (prefs) => (prefs && prefs.passenger ? ['Passenger'] : []);

  // ---- geometry -----------------------------------------------------------------------------------------------------------
  const bearing = (a, b) => Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat);
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  /** Signed turn (rad, + left) at each sample between the headings in and out (one sample each side). */
  function turns(t) {
    const n = t.lat.length, out = new Float32Array(n);
    const p = (i) => ({ lat: t.lat[i], lon: t.lon[i] });
    for (let i = 1; i < n - 1; i++) out[i] = -wrap(bearing(p(i), p(i + 1)) - bearing(p(i - 1), p(i)));   // bearing is clockwise; + left
    return out;
  }
  /** Turn summed over a window of samples [i - w, i + w]. */
  const windowTurn = (tr, i, w) => { let s = 0; for (let k = Math.max(0, i - w); k <= Math.min(tr.length - 1, i + w); k++) s += tr[k]; return s; };

  /** passenger_cost and tech_level from geometry and, when the corridor has etaAt, the router's speed (pure). */
  function geometryChannels(t) {
    const n = t.lat.length, tr = turns(t), cost = new Float32Array(n), tech = new Float32Array(n);
    const ds = (i) => (i > 0 ? t.distM[i] - t.distM[i - 1] : t.distM[1] - t.distM[0]) || 25;
    const hairpin = new Uint8Array(n), abrupt = new Uint8Array(n), tight = new Uint8Array(n);
    const d2r = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const w2 = Math.abs(windowTurn(tr, i, 2));                       // about 100 m of road
      if (w2 >= HAIRPIN_DEG * d2r) hairpin[i] = 1;
      const local = Math.abs(windowTurn(tr, i, 1)) / (2 * ds(i));      // curvature over ~50 m
      if (local >= 1 / TECH_R_M) tight[i] = 1;
    }
    for (let i = 0; i < n; i++) {                                     // a left and a right of ABRUPT_DEG within 150 m
      const a = windowTurn(tr, i, 1);
      if (Math.abs(a) < ABRUPT_DEG * d2r) continue;
      for (let k = i + 2; k < n && t.distM[k] - t.distM[i] <= 150; k++) {
        const b = windowTurn(tr, k, 1);
        if (Math.abs(b) >= ABRUPT_DEG * d2r && Math.sign(b) !== Math.sign(a)) { for (let q = i; q <= k; q++) abrupt[q] = 1; break; }
      }
    }
    const eta = t.etaAt && t.etaAt.length === n ? t.etaAt : null;
    for (let i = 0; i < n; i++) {
      let load = 0;
      if (eta && i > 0 && i < n - 1) {
        const v = (t.distM[i + 1] - t.distM[i - 1]) / Math.max(0.5, (eta[i + 1] - eta[i - 1]) / 1000);
        const kappa = Math.abs(tr[i]) / ds(i);
        load = Math.max(0, Math.min(1, ((v * v * kappa) / G - COMFORT_G) / (HARSH_G - COMFORT_G)));
      }
      cost[i] = Math.max(hairpin[i] ? 1 : 0, abrupt[i] ? 0.6 : 0, load);
    }
    for (let i = 0, a = 0, b = 0, sum = 0; i < n; i++) {               // share of tight samples within 500 m
      while (b < n && t.distM[b] - t.distM[i] <= 500) sum += tight[b++];
      while (t.distM[i] - t.distM[a] > 500) sum -= tight[a++];
      tech[i] = Math.min(1, sum / (b - a) / TECH_FULL);
    }
    return { passenger_cost: cost, tech_level: tech, hairpin, abrupt };
  }

  // ---- skill trend from the Log -------------------------------------------------------------------------------------------
  /**
   * The driver's skill from their last SKILL_DRIVES scored drives (Log summaries: ds.components.smoothness and .braking, 0..1,
   * drives with SKILL_MIN_CORNERS clean corners): { level 0..1 (the last six's mean), trend (per drive, + improving),
   * offer 0..1 (the technicality to offer: level 0.4 -> 0, 0.9 -> 1, a tenth more while improving, less while slipping),
   * drives }. null under SKILL_MIN_DRIVES.
   */
  function skillTrend(summaries) {
    const xs = (summaries || []).filter((s) => s && s.ds && s.ds.components && s.ds.corners >= SKILL_MIN_CORNERS
      && finite(s.ds.components.smoothness) && finite(s.ds.components.braking))
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-SKILL_DRIVES)
      .map((s) => 0.5 * s.ds.components.smoothness + 0.5 * s.ds.components.braking);
    if (xs.length < SKILL_MIN_DRIVES) return null;
    const last = xs.slice(-6), level = last.reduce((a, b) => a + b, 0) / last.length;
    const mx = (xs.length - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / xs.length;
    let num = 0, den = 0; xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    const trend = den ? num / den : 0;
    const nudge = trend > 0.01 ? 0.1 : trend < -0.01 ? -0.1 : 0;
    const offer = Math.max(0, Math.min(1, (level - 0.4) / 0.5 + nudge));
    const r = (x) => Math.round(x * 1000) / 1000;
    return { level: r(level), trend: r(trend), offer: r(offer), drives: xs.length };
  }
  /** The plan sheet's line under For this drive: how technical a route is offered, from how many drives, and the trend. */
  function skillLine(k) {
    if (!k) return '';
    const kind = k.offer < 0.34 ? 'flowing' : k.offer < 0.67 ? 'a mix of flowing and technical' : 'technical';
    const way = k.trend > 0.01 ? ', and you’re getting smoother' : k.trend < -0.01 ? ', a little gentler while your braking settles' : '';
    return `From your last ${k.drives} drives, routes lean ${kind}${way}.`;
  }
  /** -1..1: 1 when the road's technicality is what's offered, -1 a full step away (an over-technical road for a learner). */
  const skillFit = (tech, offer) => (finite(tech) && finite(offer) ? Math.max(-1, 1 - 2 * Math.abs(tech - offer)) : NaN);

  // ---- time of day ---------------------------------------------------------------------------------------------------------
  /** Riders to expect at that moment: weekend morning (6-12, Sat/Sun) 1, other daylight 0.5, dark 0.2. */
  function cyclistTime(ms, dark) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return NaN;
    if (dark) return 0.2;
    return (d.getDay() === 0 || d.getDay() === 6) && d.getHours() >= 6 && d.getHours() < 12 ? 1 : 0.5;
  }

  // ---- OSM features ----------------------------------------------------------------------------------------------------------
  const TILE = 0.1, TILE_MS = 30 * 864e5, PREFIX = 'apex.drvosm.', TIMEOUT_MS = 12000;
  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const tileKey = (lat, lon) => `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;
  const tileBox = (k) => { const [i, j] = k.split('_').map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE]; };
  function tilesOf(corridors) {
    const s = new Set();
    for (const c of corridors) for (let i = 0; i < c.lat.length; i += 4) s.add(tileKey(c.lat[i], c.lon[i]));
    return [...s].sort();
  }
  /** One Overpass query: driven roads with a lit tag, road tunnels (tags + geometry), and the roads of bicycle routes (geometry). */
  function query(tiles) {
    const bs = tiles.map((k) => tileBox(k).map((v) => v.toFixed(4)).join(','));
    const road = '["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$"]';
    return `[out:json][timeout:25];(${bs.map((b) => `way${road}["lit"](${b});way${road}["tunnel"="yes"](${b});`).join('')})->.a;.a out tags geom qt;`
      // a cycle route's roads inside the tiles only: a national route's relation spans states
      + `(${bs.map((b) => `relation["route"="bicycle"](${b});`).join('')})->.r;(${bs.map((b) => `way(r.r)["highway"](${b});`).join('')});out ids geom qt;`;
  }
  const LIT = { yes: 1, '24/7': 1, automatic: 1, 'sunset-sunrise': 1, interval: 1, limited: 1, no: 0, disused: 0 };
  /** Overpass elements as features: [{ kind: 'lit'|'tunnel'|'cycle', value, geom }]. A way without tags is a bicycle route's. */
  function parseOsm(json) {
    const out = [];
    for (const x of (json && json.elements) || []) {
      if (!x || x.type !== 'way' || !Array.isArray(x.geometry)) continue;
      const g = x.geometry.map((p) => [p.lat, p.lon]);
      if (!x.tags) { out.push({ kind: 'cycle', value: 1, geom: g }); continue; }
      const lit = LIT[x.tags.lit];                                      // 24/7, automatic, sunset-sunrise... are lit; no and disused are not
      if (lit !== undefined) out.push({ kind: 'lit', value: lit, geom: g });
      if (x.tags.tunnel === 'yes') out.push({ kind: 'tunnel', value: 1, geom: g });
    }
    return out;
  }
  /** Feature lists -> cell maps per kind. */
  function gridsOf(features) {
    const g = { lit: new Map(), tunnel: new Map(), cycle: new Map() };
    for (const f of features || []) if (g[f.kind]) U.paint(g[f.kind], f.geom, f.value);
    return g;
  }
  async function fetchFirst(fetchFn, body, signal) {
    const ctrls = SERVERS.map(() => (typeof AbortController === 'function' ? new AbortController() : null)), timers = [];
    let stop = null;
    const stopped = new Promise((r) => { stop = r; });
    if (signal) signal.addEventListener('abort', () => { timers.forEach(clearTimeout); ctrls.forEach((c) => c && c.abort()); stop(null); }, { once: true });
    const tries = SERVERS.map((url, i) => (async () => {
      const t = setTimeout(() => ctrls[i] && ctrls[i].abort(), TIMEOUT_MS); timers.push(t);
      try {
        const r = await fetchFn(url, { method: 'POST', body: 'data=' + encodeURIComponent(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrls[i] ? ctrls[i].signal : undefined });
        if (!r.ok) throw new Error(`http ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    })());
    try { const j = await Promise.race([Promise.any(tries), stopped]); timers.forEach(clearTimeout); ctrls.forEach((c) => { try { if (c) c.abort(); } catch (_) {} }); return j; } catch (_) { return null; }
  }
  /** Features for the tiles: cached tiles first, the rest in one raced query; null when nothing could be had. */
  async function osmFeatures(tiles, { fetch: fetchFn, storage, signal, now = Date.now() } = {}) {
    const have = [], need = [];
    for (const k of tiles) {
      let c = null; try { c = JSON.parse((storage && storage.getItem(PREFIX + k)) || 'null'); } catch (_) {}
      if (c && now - c.at < TILE_MS && Array.isArray(c.f)) have.push(...c.f); else need.push(k);
    }
    if (!need.length) return have;
    if (!fetchFn) return have.length ? have : null;
    const json = await fetchFirst(fetchFn, query(need), signal);
    if (!json) return have.length ? have : null;
    const feats = parseOsm(json);
    for (const k of need) {
      const [s, w, n, e] = tileBox(k);
      const mine = feats.filter((f) => f.geom.some(([la, lo]) => la >= s && la < n && lo >= w && lo < e));
      try { storage && storage.setItem(PREFIX + k, JSON.stringify({ at: now, f: mine })); } catch (_) {}
    }
    return [...have, ...feats];
  }

  // ---- the corridor --------------------------------------------------------------------------------------------------------
  /**
   * Every channel for corridor t. ctx: { prefs, skill (skillTrend), grids (gridsOf, or null when OSM didn't answer),
   * isDark(date, lat, lon) (sun.js) }.
   */
  function channelsFor(t, ctx = {}) {
    const n = t.lat.length, prefs = clean(ctx.prefs), ch = Object.fromEntries(CH.map((k) => [k, U.nan(n)]));
    const geo = geometryChannels(t);
    ch.passenger_cost = geo.passenger_cost; ch.tech_level = geo.tech_level;
    const offer = ctx.skill ? ctx.skill.offer : NaN;
    const eta = t.etaAt && t.etaAt.length === n ? t.etaAt : null, g = ctx.grids;
    for (let i = 0; i < n; i++) {
      ch.skill_fit[i] = skillFit(geo.tech_level[i], offer);
      if (eta && ctx.isDark) { try { ch.dark[i] = ctx.isDark(new Date(eta[i]), t.lat[i], t.lon[i]) ? 1 : 0; } catch (_) { /* unknown */ } }
      if (eta) ch.cyclist_time[i] = cyclistTime(eta[i], ch.dark[i] === 1);
      if (g) {
        const lv = U.lookup(g.lit, t.lat[i], t.lon[i]); if (lv !== undefined) ch.lit[i] = lv;
        ch.tunnel[i] = U.lookup(g.tunnel, t.lat[i], t.lon[i]) !== undefined ? 1 : 0;
        ch.cyclist_route[i] = U.lookup(g.cycle, t.lat[i], t.lon[i]) !== undefined ? 1 : 0;
      }
      // the preferences that are on, each only where its inputs are known
      let fit = 0, known = 0;
      if (prefs.passenger) { fit -= FIT.passenger * ch.passenger_cost[i]; known++; }
      if (prefs.lit && ch.dark[i] === 1 && finite(ch.lit[i])) { fit += ch.lit[i] ? FIT.litBonus : -FIT.unlit; known++; }
      if (prefs.cyclists && finite(ch.cyclist_route[i]) && finite(ch.cyclist_time[i])) { fit -= FIT.cyclists * ch.cyclist_route[i] * ch.cyclist_time[i]; known++; }
      if (prefs.tunnels && finite(ch.tunnel[i])) { fit += FIT.tunnels * ch.tunnel[i]; known++; }
      if (finite(ch.skill_fit[i])) { fit += FIT.skill * ch.skill_fit[i] * (prefs.passenger ? 0.5 : 1); known++; }   // with a passenger, gentleness leads
      ch.driver_fit[i] = known ? Math.max(-1, Math.min(1, fit)) : NaN;
    }
    const hair = Float32Array.from(geo.hairpin), abr = Float32Array.from(geo.abrupt), unlitDark = new Float32Array(n);
    for (let i = 0; i < n; i++) unlitDark[i] = ch.dark[i] === 1 && ch.lit[i] === 0 ? 1 : NaN;
    const spans = [
      ...(prefs.passenger ? [...U.spansWhere(hair, t.distM, (v) => v === 1, 0, 'hairpin', 'Hairpin'),
        ...U.spansWhere(abr, t.distM, (v) => v === 1, 50, 'abrupt', 'Quick left-right')] : []),
      ...(prefs.lit ? U.spansWhere(unlitDark, t.distM, (v) => v === 1, 300, 'unlit_dark', 'Unlit after dark') : []),
      ...(prefs.cyclists ? U.spansWhere(ch.cyclist_route, t.distM, (v) => v === 1, 300, 'cycle_route', 'A cycle route') : []),
      ...U.spansWhere(ch.tunnel, t.distM, (v) => v === 1, 0, 'tunnel', 'Tunnel'),
    ];
    const points = spans.filter((s) => s.kind === 'tunnel').map((s) => ({ atM: s.fromM, kind: 'tunnel', label: 'Tunnel' }));
    return { channels: ch, spans, points };
  }

  /**
   * opts: { signal, budgetMs, fetch, storage, prefs (else apex.driverPrefs), summaries (Log summaries; else none), isDark }.
   * corridor.driver, when the engine sets it, may carry { prefs, skill } and wins over opts. OSM is fetched only when Lit roads,
   * Cyclist courtesy or Tunnels is on. Never throws.
   */
  async function fetchCtx(corridors, opts = {}) {
    const out = {};
    const storage = opts.storage || (typeof root.localStorage !== 'undefined' ? root.localStorage : null);
    const basePrefs = opts.prefs ? clean(opts.prefs) : load(storage);
    const baseSkill = opts.skill !== undefined ? opts.skill : skillTrend(opts.summaries || []);
    const isDark = opts.isDark || (root.ApexSun && root.ApexSun.isDark) || null;
    const wantsOsm = corridors.some((c) => { const p = (c.driver && c.driver.prefs) || basePrefs; return p.lit || p.cyclists || p.tunnels; });
    let grids = null;
    if (wantsOsm) {
      // past the budget the lookup is called off (its tiles are fetched again next time), so nothing runs on unseen
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      if (opts.signal && ac) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
      const feats = await U.within(osmFeatures(tilesOf(corridors), { fetch: opts.fetch || (root.fetch && root.fetch.bind(root)), storage, signal: ac ? ac.signal : opts.signal }),
        (opts.budgetMs || provider.budgetMs) - 500, opts.signal, null);
      if (ac) ac.abort();
      grids = feats ? gridsOf(feats) : null;
    }
    for (const c of corridors) {
      try {
        const prefs = (c.driver && c.driver.prefs) || basePrefs, skill = c.driver && c.driver.skill !== undefined ? c.driver.skill : baseSkill;
        const r = channelsFor(c, { prefs, skill, grids, isDark });
        const missing = wantsOsm && !grids;
        out[c.id] = { status: missing ? 'partial' : 'ok', ...(missing ? { note: 'Couldn’t check lighting, cycle routes and tunnels' } : {}), ...r };
      } catch (_) {
        out[c.id] = { status: 'unavailable', channels: Object.fromEntries(CH.map((k) => [k, U.nan(c.lat.length)])), spans: [], points: [] };
      }
    }
    return out;
  }

  const provider = { id: 'driver', version: 1, channels: CH, needs: { network: true }, budgetMs: 8000, fetch: fetchCtx };
  U.registry().register(provider);

  const api = { provider, KEY, PREFS, LABELS, CH, FIT, load, save, clean, driveTags, skillLine, turns, geometryChannels, skillTrend, skillFit, cyclistTime,
    query, parseOsm, gridsOf, osmFeatures, tilesOf, channelsFor, SKILL_MIN_DRIVES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteDriver = api;
})(typeof window !== 'undefined' ? window : globalThis);
