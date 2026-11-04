// Route context: the car (builder E). Range and fuel-stop spacing, phone signal along the way, and the offline prep that
// follows from it. The car's width and ride height already shape the router's costing (fun_route.js costing, carNote); this
// adds what the router can't know. Sources: the Garage's daily car (fuel, range_km; kept on the phone as apex.routingCar),
// fuel stations from OpenStreetMap (amenity=fuel via Overpass, ODbL, 0.25-degree tiles cached FUEL_MS), EV chargers from
// NREL's Alternative Fuel Stations API (public domain, US DOE; through our Worker, GET /api/chargers, which holds the free
// key the owner creates: docs/OWNER_TODO.md; no key = status 'no-key'), and builder C's `mobile_coverage` channel when the
// engine passes it in opts.peer (FCC coverage). Overpass and our Worker get tile ids/boxes, never the route.
//
// Channels (Float32Array per sample; NaN = unknown):
//   fuel_since_km  km     road since the last fuel station (or charger for an electric car) passed within NEAR_M; NaN
//                         before the first one (the tank at the start is not known) and when stations couldn't be loaded
//   fuel_margin    0..1   1 - fuel_since_km / safe range (SAFE_SHARE of the car's range, EV_SAFE_SHARE electric); NaN
//                         without a range
//   signal         0..1   phone coverage along the route, from C's mobile_coverage when present; else NaN
// Spans: fuel_gap (hard: true) a stretch between stations longer than the safe range, value km; fuel_check the first
//   stretch from the start beyond half the safe range (fill up before you go); no_signal coverage under NO_SIGNAL for 2+ km.
// Points: fuel_stop (the last station before a fuel_gap: fill up here), share_eta (before the first no_signal stretch),
//   ask_range (once per car, when a long stationless stretch meets a car with no range: "add it in the Garage").
// Pure parts are exported for tests (tests/test_route_ctx_car.py).
(function (root) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports ? require('./ctx_util.js') : root.ApexRouteCtxUtil).E;   // E's helpers (ctx_util.js)
  const CH = ['fuel_since_km', 'fuel_margin', 'signal'];
  const NEAR_M = 1000, SAFE_SHARE = 0.8, EV_SAFE_SHARE = 0.75, ASK_KM = 150, NO_SIGNAL = 0.3, NO_SIGNAL_M = 2000;
  const TILE = 0.25, FUEL_MS = 14 * 864e5, PREFIX = 'apex.fuel.', ASKED = 'apex.rangeAsked', TIMEOUT_MS = 12000;
  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const finite = U.finite;

  /** The car as routing sees it: { fuel, rangeKm, electric, label } or null. Unknown range stays null. */
  function carOf(c) {
    if (!c) return null;
    const fuel = ['petrol', 'diesel', 'electric', 'hybrid'].includes(c.fuel) ? c.fuel : null;
    const rangeKm = Number.isFinite(c.range_km) && c.range_km >= 30 ? c.range_km : null;
    return { fuel, rangeKm, electric: fuel === 'electric', label: c.label || null };
  }
  /** Safe range in km (a reserve kept), or null. */
  const safeKm = (car) => (car && car.rangeKm ? car.rangeKm * (car.electric ? EV_SAFE_SHARE : SAFE_SHARE) : null);

  const tileKey = (lat, lon) => `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;
  const tileBox = (k) => { const [i, j] = k.split('_').map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE]; };
  function tilesOf(corridors) {
    const s = new Set();
    for (const c of corridors) for (let i = 0; i < c.lat.length; i += 8) for (const d of [-0.01, 0.01]) s.add(tileKey(c.lat[i] + d, c.lon[i] + d));
    return [...s].sort();
  }
  /** Every station tile along a stretch of a corridor was answered (or read from the cache). */
  function gapCovered(c, g, covered) {
    if (!covered) return false;
    for (let i = 0; i < c.lat.length; i++) if (c.distM[i] >= g.fromM && c.distM[i] <= g.toM && !covered.has(tileKey(c.lat[i], c.lon[i]))) return false;
    return true;
  }
  /** Overpass: fuel stations (nodes and ways, their centre), positions only. */
  const fuelQuery = (tiles) => `[out:json][timeout:25];(${tiles.map((k) => { const b = tileBox(k).map((v) => v.toFixed(4)).join(','); return `node["amenity"="fuel"](${b});way["amenity"="fuel"](${b});`; }).join('')});out center qt;`;
  /** Overpass elements as stations [{ lat, lon }]. */
  function parseFuel(json) {
    const out = [];
    for (const x of (json && json.elements) || []) {
      const lat = x.type === 'node' ? x.lat : x.center && x.center.lat, lon = x.type === 'node' ? x.lon : x.center && x.center.lon;
      if (finite(lat) && finite(lon)) out.push({ lat, lon });
    }
    return out;
  }
  /** Our Worker's /api/chargers answer as stations [{ lat, lon, dc }]. */
  function parseChargers(json) {
    return ((json && json.stations) || []).filter((s) => s && finite(s.lat) && finite(s.lon)).map((s) => ({ lat: s.lat, lon: s.lon, dc: !!s.dc }));
  }

  /** Where along t each station is (the nearest sample within NEAR_M), sorted: [{ atM, i, lat, lon }]. */
  function stationsAlong(t, stations) {
    const out = [];
    for (const s of stations || []) {
      let best = -1, bd = NEAR_M;
      for (let i = 0; i < t.lat.length; i += 2) {
        if (Math.abs(t.lat[i] - s.lat) > 0.02 || Math.abs(t.lon[i] - s.lon) > 0.03) continue;
        const d = U.metres({ lat: t.lat[i], lon: t.lon[i] }, s);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) out.push({ atM: t.distM[best], i: best, lat: s.lat, lon: s.lon });
    }
    out.sort((a, b) => a.atM - b.atM);
    return out.filter((s, k) => !k || s.atM - out[k - 1].atM > 100);   // one per 100 m: two pumps of a station are one stop
  }

  /** The fuel plan for t: channels fuel_since_km / fuel_margin, spans and points (pure). along: stationsAlong; car: carOf. */
  function fuelPlan(t, along, car) {
    const n = t.lat.length, since = U.nan(n), margin = U.nan(n), spans = [], points = [];
    const safe = safeKm(car), end = t.distM[n - 1];
    let k = 0, last = null;
    for (let i = 0; i < n; i++) {
      while (k < along.length && along[k].atM <= t.distM[i]) last = along[k++];
      if (last) { since[i] = (t.distM[i] - last.atM) / 1000; if (safe) margin[i] = 1 - since[i] / safe; }
    }
    const marks = [{ atM: 0, start: true }, ...along, { atM: end, end: true }];
    let longest = 0;
    for (let j = 1; j < marks.length; j++) {
      const a = marks[j - 1], b = marks[j], km = (b.atM - a.atM) / 1000;
      longest = Math.max(longest, km);
      if (!safe) continue;
      if (a.start) {
        if (km > safe / 2) spans.push({ fromM: 0, toM: Math.round(b.atM), kind: 'fuel_check', value: Math.round(km), label: b.end ? `No ${car.electric ? 'charger' : 'fuel'} on the way (${Math.round(km)} km): start full` : `First ${car.electric ? 'charger' : 'fuel'} at ${Math.round(km)} km: start full` });
      } else if (km > safe) {
        spans.push({ fromM: Math.round(a.atM), toM: Math.round(b.atM), kind: 'fuel_gap', hard: true, value: Math.round(km),
          label: `${Math.round(km)} km without ${car.electric ? 'a charger' : 'fuel'}, over your safe ${Math.round(safe)} km` });
      }
    }
    // planned stops, greedy: full at the first station, then stop at the farthest station still within the safe range, until
    // the end is in reach (a station before a fuel_gap is always a stop: the gap starts there)
    if (safe && along.length) {
      let at = along[0], k2 = 0;
      while (end - at.atM > safe * 1000) {
        let next = -1;
        for (let q = k2 + 1; q < along.length && along[q].atM - at.atM <= safe * 1000; q++) next = q;
        if (next < 0) break;                                           // a fuel_gap: nothing in reach
        k2 = next; at = along[next];
        points.push({ atM: Math.round(at.atM), kind: 'fuel_stop', lat: at.lat, lon: at.lon, label: car.electric ? 'Charge here' : 'Fill up here' });
      }
      for (const g of spans.filter((x) => x.kind === 'fuel_gap')) {
        const st = along.find((x) => Math.round(x.atM) === g.fromM);
        if (st && !points.some((p) => p.atM === g.fromM)) points.push({ atM: g.fromM, kind: 'fuel_stop', lat: st.lat, lon: st.lon, label: car.electric ? 'Charge here' : 'Fill up here' });
      }
    }
    points.sort((a, b) => a.atM - b.atM);
    return { since, margin, spans, points, longestKm: Math.round(longest) };
  }

  /** Signal: C's coverage channel copied, no_signal spans, and the share_eta point before the first. */
  function signalPlan(t, coverage) {
    const n = t.lat.length, sig = U.nan(n);
    if (coverage && coverage.length === n) for (let i = 0; i < n; i++) sig[i] = finite(coverage[i]) ? coverage[i] : NaN;
    const spans = U.spansWhere(sig, t.distM, (v) => v < NO_SIGNAL, NO_SIGNAL_M, 'no_signal', (a, b) => `No signal for ${Math.round((t.distM[b] - t.distM[a]) / 1000)} km`);
    const points = spans.length ? [{ atM: Math.max(0, spans[0].fromM - 2000), kind: 'share_eta', label: 'Share your ETA before the signal goes' }] : [];
    return { signal: sig, spans, points };
  }

  /**
   * Circles to save for offline use, covering each no_signal span plus 2 km either side, in pieces of at most 20 km:
   * [{ lat, lon, radiusKm, name }]. For ApexOfflineTiles.download.
   */
  function offlineAreas(t, spans) {
    const out = [];
    for (const s of (spans || []).filter((x) => x.kind === 'no_signal')) {
      const a = Math.max(0, s.fromM - 2000), b = Math.min(t.distM[t.distM.length - 1], s.toM + 2000);
      for (let m = a; m < b; m += 20000) {
        const mid = Math.min(b, m + 10000), i = t.distM.findIndex((d) => d >= mid);
        const j = i < 0 ? t.distM.length - 1 : i;
        out.push({ lat: t.lat[j], lon: t.lon[j], radiusKm: Math.min(25, Math.max(3, (Math.min(b, m + 20000) - m) / 2000 + 2)), name: 'No signal on the route' });
      }
    }
    return out;
  }
  /** Saves the areas through offline_tiles.js (deps: { tiles: ApexOfflineTiles, styleUrl }); resolves the saved count. */
  async function prepareOffline(areas, deps = {}) {
    const T = deps.tiles || root.ApexOfflineTiles;
    if (!T || !deps.styleUrl) return 0;
    let saved = 0;
    for (const a of areas || []) { try { await T.download({ ...a, styleUrl: deps.styleUrl }); saved++; } catch (_) { /* a failed area: the rest still go */ } }
    return saved;
  }

  /** Ask once per car: true the first time a car without a range meets a stretch of ASK_KM or more without fuel. */
  function askRangeOnce(storage, car, longestKm) {
    if (!car || car.rangeKm || !(longestKm >= ASK_KM)) return false;
    const key = car.label || 'car';
    let asked = {};
    try { asked = JSON.parse((storage && storage.getItem(ASKED)) || '{}') || {}; } catch (_) {}
    if (asked[key]) return false;
    asked[key] = 1;
    try { storage && storage.setItem(ASKED, JSON.stringify(asked)); } catch (_) {}
    return true;
  }

  async function raceOverpass(fetchFn, body, signal) {
    const ctrls = SERVERS.map(() => (typeof AbortController === 'function' ? new AbortController() : null)), timers = [];
    let stop = null;
    const stopped = new Promise((r) => { stop = r; });
    if (signal) signal.addEventListener('abort', () => { timers.forEach(clearTimeout); ctrls.forEach((c) => c && c.abort()); stop(null); }, { once: true });
    try {
      const j = await Promise.race([stopped, Promise.any(SERVERS.map((url, i) => (async () => {
        const t = setTimeout(() => ctrls[i] && ctrls[i].abort(), TIMEOUT_MS); timers.push(t);
        try { const r = await fetchFn(url, { method: 'POST', body: 'data=' + encodeURIComponent(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrls[i] ? ctrls[i].signal : undefined });
          if (!r.ok) throw new Error(`http ${r.status}`); return await r.json(); } finally { clearTimeout(t); }
      })()))]);
      timers.forEach(clearTimeout); ctrls.forEach((c) => { try { if (c) c.abort(); } catch (_) {} });
      return j;
    } catch (_) { return null; }
  }
  /**
   * Stations for the tiles: cached first, the rest from Overpass (fuel) or our Worker (chargers). { stations, status } where
   * status is 'ok', 'partial' (some tiles missing), 'unavailable', or 'no-key' (chargers with no NREL key on the server).
   */
  async function stationsFor(tiles, { electric, fetch: fetchFn, apiGet, storage, signal, now = Date.now() } = {}) {
    const kind = electric ? 'ev' : 'fuel', have = [], need = [], covered = new Set();   // covered: tiles whose stations are known
    for (const k of tiles) {
      let c = null; try { c = JSON.parse((storage && storage.getItem(`${PREFIX}${kind}.${k}`)) || 'null'); } catch (_) {}
      if (c && now - c.at < FUEL_MS && Array.isArray(c.s)) { have.push(...c.s); covered.add(k); } else need.push(k);
    }
    if (!need.length) return { stations: have, status: 'ok', covered };
    const none = (status) => ({ stations: have.length ? have : null, status: have.length ? 'partial' : status, covered });   // unknown, never "no stations"
    let got = null, status = 'ok';
    if (electric) {
      if (!apiGet) return none('unavailable');
      const parts = [];
      const answered = [];
      for (let s = 0; s < need.length; s += 40) {
        const r = await apiGet(`/api/chargers?tiles=${need.slice(s, s + 40).join(',')}`).catch(() => null);
        if (r && r.status === 503) return none('no-key');
        const j = r && r.ok ? await r.json().catch(() => null) : null;
        if (!j) { status = 'partial'; continue; }
        parts.push(...parseChargers(j)); answered.push(...need.slice(s, s + 40));
      }
      need.splice(0, need.length, ...answered);
      got = parts;
    } else {
      const j = fetchFn ? await raceOverpass(fetchFn, fuelQuery(need), signal) : null;
      got = j ? parseFuel(j) : null;
    }
    if (!got) return none('unavailable');
    for (const k of need) {
      const [s, w, n, e] = tileBox(k), mine = got.filter((x) => x.lat >= s && x.lat < n && x.lon >= w && x.lon < e);
      try { storage && storage.setItem(`${PREFIX}${kind}.${k}`, JSON.stringify({ at: now, s: mine })); } catch (_) {}
      covered.add(k);
    }
    return { stations: [...have, ...got], status, covered };
  }

  /**
   * opts: { signal, budgetMs, fetch, apiGet (the app's apiCall GET, for /api/chargers), storage, car (else corridor.car,
   * else apex.routingCar), peer: { [corridorId]: { channels: { mobile_coverage } } } (builder C's result, when the engine has it) }.
   */
  async function fetchCtx(corridors, opts = {}) {
    const out = {}, storage = opts.storage || (typeof root.localStorage !== 'undefined' ? root.localStorage : null);
    let stored = null; try { stored = JSON.parse((storage && storage.getItem('apex.routingCar')) || 'null'); } catch (_) {}
    const car = carOf(opts.car || (corridors[0] && corridors[0].car) || stored);
    const ac = typeof AbortController === 'function' ? new AbortController() : null;   // called off past the budget
    if (opts.signal && ac) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
    const st = await U.within(stationsFor(tilesOf(corridors), { electric: !!(car && car.electric), fetch: opts.fetch || (root.fetch && root.fetch.bind(root)), apiGet: opts.apiGet, storage, signal: ac ? ac.signal : opts.signal }),
      (opts.budgetMs || provider.budgetMs) - 500, opts.signal, { stations: null, status: 'unavailable' });
    if (ac) ac.abort();
    for (const c of corridors) {
      const n = c.lat.length, channels = Object.fromEntries(CH.map((k) => [k, U.nan(n)]));
      let spans = [], points = [], notes = [], status = 'ok';
      if (st.stations) {
        const f = fuelPlan(c, stationsAlong(c, st.stations), car);
        // a gap is a hard limit only where the stations along it are known (every tile it crosses answered); elsewhere it
        // may be stations we couldn't load: said, not enforced
        for (const g of f.spans) if (g.kind === 'fuel_gap' && !gapCovered(c, g, st.covered)) { g.hard = false; g.kind = 'fuel_unsure'; }
        channels.fuel_since_km = f.since; channels.fuel_margin = f.margin; spans.push(...f.spans); points.push(...f.points);
        if (!safeKm(car)) { status = 'partial'; notes.push('No range for your car'); if (askRangeOnce(storage, car || { label: 'car' }, f.longestKm)) points.push({ atM: 0, kind: 'ask_range', label: `${f.longestKm} km without ${car && car.electric ? 'a charger' : 'fuel'} on this route. How far does your car go on a full ${car && car.electric ? 'charge' : 'tank'}? Add it in the Garage.` }); }
        if (st.status !== 'ok') status = 'partial';
      } else { status = st.status === 'no-key' ? 'no-key' : 'partial'; notes.push(st.status === 'no-key' ? 'Chargers need the NREL key' : 'Couldn’t load fuel stations'); }
      const cov = opts.peer && opts.peer[c.id] && opts.peer[c.id].channels ? opts.peer[c.id].channels.mobile_coverage : null;
      const sg = signalPlan(c, cov);
      channels.signal = sg.signal; spans.push(...sg.spans); points.push(...sg.points);
      if (!cov) notes.push('No coverage data');
      if (!cov && !st.stations) status = st.status === 'no-key' ? 'no-key' : 'unavailable';
      out[c.id] = { status, ...(notes.length ? { note: notes.join('; ') } : {}), channels, spans, points: points.sort((a, b) => a.atM - b.atM) };
    }
    return out;
  }

  const provider = { id: 'car', version: 1, channels: CH, needs: { network: true }, budgetMs: 8000, fetch: fetchCtx };
  U.registry().register(provider);

  const api = { provider, CH, carOf, safeKm, tilesOf, gapCovered, fuelQuery, parseFuel, parseChargers, stationsAlong, fuelPlan, signalPlan, offlineAreas, prepareOffline,
    askRangeOnce, stationsFor, SAFE_SHARE, EV_SAFE_SHARE, ASK_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCar = api;
})(typeof window !== 'undefined' ? window : globalThis);
