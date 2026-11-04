// Route context: conditions at the hour you'd be there (ROUTE_ENGINE_CONTRACT provider `conditions`).
// Source: Open-Meteo forecast API (api.open-meteo.com, free, no key; CC BY 4.0 "Weather data by Open-Meteo.com"), hourly,
// for 0.05° cells along the route (the cell centre is all Open-Meteo is told: no route, no position). The forecast is the
// one web/route_weather.js already uses; this adds wind, dew point, low cloud, ground temperature and the past two days of
// rain, and evaluates every 25 m sample at its own eta (corridor.etaAt). Sun position is web/sun.js (NOAA), no network.
// Cached per cell for an hour (forecasts update hourly). Budget 5 s; on failure every forecast channel is NaN ('unavailable'),
// the sun channels are still known.
//
// Channels (per sample; NaN = unknown, never 0 for unknown):
//   air_temp_c      °C   2 m air temperature at the eta (Open-Meteo temperature_2m, linear between hours).
//   road_temp_c     °C   ground-surface temperature, Open-Meteo soil_temperature_0cm: a model's skin temperature, a proxy for
//                        the road surface (asphalt runs warmer in sun, colder on clear nights), never a measurement.
//   dew_point_c     °C   dew point at 2 m.
//   visibility_m    m    the model's horizontal visibility (grid-scale; valley fog is finer than the grid, see fog_risk).
//   fog_risk        0-1  0.8+ fog likely, 0.4 patches possible: max of the model's visibility and a radiation-fog check
//                        (dew-point spread ≤ 1.5 °C, wind < 3 m/s, sun < 6° up, low cloud < 50 %), raised ×1.5 in valleys and
//                        hollows (tpi_m < −20 m, or the sample below its cell's mean terrain by 60 m+) and cut ×0.3 on ridges;
//                        a ridge 150 m+ above the cell's terrain under ≥ 90 % low cloud is in the cloud (0.6).
//   wind_mps        m/s  10 m mean wind.          gust_mps  m/s  10 m gusts.
//   crosswind_mps   m/s  the gust's component across the heading, |gust · sin(wind from − heading)|.
//   exposure        0-1  1 on ridges (tpi_m ≥ +30 m) and bridges, 0.4 in valleys, 0.7 otherwise; NaN without terrain data.
//   precip_6h_mm    mm   rain/snow water at this cell in the 6 h before the eta (observed analysis for past hours, forecast after).
//   precip_48h_mm   mm   the same over 48 h: low-water crossings and creek roads stay wet or flooded after rain.
//   wx_hazard       0-6  web/route_weather.js hazard() at the eta, so the card's forecast line and the engine agree:
//                        0 fine, 1 very hot, 2 fog, 3 rain likely, 4 storms, 5 snow, 6 ice.
//   light           2 day (sun above −0.833°), 1 civil twilight (to −6°), 0 dark. Always known.
//   sun_alt_rad     rad  sun altitude at the sample and eta.
//   glare           1 when the sun is 0-15° up within 20° of the heading (web/fun_route.js R-13 uses the same cone), else 0.
//   golden_view     1 on a descent (grade ≤ −3 %) facing the low sun's side without driving into it: the sun −4°..0° (just
//                   set or about to rise) within 75° of the heading, or 0-10° up between 20° and 75° off the heading.
//                   0 otherwise; NaN without elevation (a descent can't be known). Never rewards the glare cone.
// Spans: fog (fog_risk ≥ 0.5, value fog_risk), crosswind (gust crosswind ≥ 11 m/s where exposed, or ≥ 15 m/s anywhere; value
//   m/s), cold-tyres (air ≤ 7 °C: summer tyres lose grip below about 7 °C, as tyre makers state; value °C), ice (road ≤ 0.5 °C
//   and wet in the last 3 h or at/below the dew point: frost; value °C), dark (light 0), glare, golden-view.
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const U = NODE ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const SUN = NODE ? require('../sun.js') : root.ApexSun;
  const WX = NODE ? require('../route_weather.js') : root.ApexRouteWeather;     // its hazard() names what the route card says
  const { finite, DEG } = U;

  const ID = 'conditions', VERSION = 1, CELL = 0.05, TTL_MS = 3600e3, BUDGET_MS = 5000, MAX_PER_CALL = 40;
  const CHANNELS = ['air_temp_c', 'road_temp_c', 'dew_point_c', 'visibility_m', 'fog_risk', 'wind_mps', 'gust_mps', 'crosswind_mps', 'exposure',
    'precip_6h_mm', 'precip_48h_mm', 'wx_hazard', 'light', 'sun_alt_rad', 'glare', 'golden_view'];
  const VARS = ['precipitation_probability', 'temperature_2m', 'dew_point_2m', 'precipitation', 'weather_code', 'visibility', 'cloud_cover_low', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'soil_temperature_0cm'];
  const GLARE_MAX_ALT = 15 * DEG, GLARE_HALF = 20 * DEG;                     // = web/fun_route.js glare (R-13)
  const GOLD_SIDE = 75 * DEG, GOLD_LOW = -4 * DEG, GOLD_HIGH = 10 * DEG, DESCENT = -0.03;
  const COLD_TYRE_C = 7, ICE_ROAD_C = 0.5;
  const FOG_CODES = new Set([45, 48]);
  // wx_hazard codes: route_weather.js hazard() per sample (0 none, 1 heat, 2 fog, 3 rain, 4 storm, 5 snow, 6 ice)
  const HAZARD_CODE = { none: 0, heat: 1, fog: 2, rain: 3, storm: 4, snow: 5, ice: 6 };

  const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
  /** One request for up to 40 cell centres; past 2 days for rain recency, 3 days ahead. SI wind (m/s). */
  function url(centres) {
    return `${URL_BASE}?latitude=${centres.map((c) => c[0].toFixed(3)).join(',')}&longitude=${centres.map((c) => c[1].toFixed(3)).join(',')}`
      + `&hourly=${VARS.join(',')}&past_days=2&forecast_days=3&timezone=GMT&timeformat=unixtime&wind_speed_unit=ms`;
  }
  /** Open-Meteo's answer (an object for one location, an array for several) → compact series per location, or null. */
  function parse(json) {
    const list = Array.isArray(json) ? json : json ? [json] : [];
    return list.map((x) => {
      const h = x && x.hourly;
      if (!h || !Array.isArray(h.time) || !h.time.length) return null;
      const s = { t: h.time.map((v) => v * 1000), elev: finite(x.elevation) ? x.elevation : null };
      for (const v of VARS) s[v] = Array.isArray(h[v]) ? h[v].map((y) => (finite(y) ? y : null)) : null;
      return s;
    });
  }
  /** A variable at an instant: linear between the two hours around it; null beyond the series or when either is null. */
  function at(s, v, ms) {
    const a = s && s[v];
    if (!a) return null;
    const t = s.t, n = t.length;
    if (ms < t[0] - 1800e3 || ms > t[n - 1] + 1800e3) return null;
    let k = Math.max(0, Math.min(n - 2, Math.floor((ms - t[0]) / 3600e3)));
    while (k > 0 && t[k] > ms) k--;
    while (k < n - 2 && t[k + 1] < ms) k++;
    const f = Math.max(0, Math.min(1, (ms - t[k]) / (t[k + 1] - t[k])));
    if (v === 'weather_code' || v === 'wind_direction_10m') { const j = f < 0.5 ? k : k + 1; return a[j]; }
    if (a[k] === null || a[k + 1] === null) return f < 0.5 ? a[k] : a[k + 1];
    return a[k] + (a[k + 1] - a[k]) * f;
  }
  /** Precipitation (mm) in the `hours` before ms: Open-Meteo's hourly value is the preceding hour's total. null if any is missing. */
  function precipBefore(s, ms, hours) {
    const a = s && s.precipitation;
    if (!a) return null;
    let sum = 0, seen = 0;
    for (let k = 0; k < s.t.length; k++) {
      if (s.t[k] > ms || s.t[k] <= ms - hours * 3600e3) continue;
      if (a[k] === null) return null;
      sum += a[k]; seen++;
    }
    return seen >= Math.floor(hours * 0.8) ? Math.round(sum * 10) / 10 : null;
  }

  /** Fog risk 0-1 from the forecast at a point and its terrain position (see header). null when the forecast is missing. */
  function fogRisk({ visM, code, tempC, dewC, windMps, lowCloud, sunAlt, tpiM, relM }) {
    if (!finite(visM) && !finite(tempC)) return null;
    let base = 0;
    if (FOG_CODES.has(code)) base = 0.8;
    if (finite(visM)) base = Math.max(base, visM < 200 ? 1 : visM < 1000 ? 0.8 : visM < 3000 ? 0.4 : visM < 8000 ? 0.15 : 0);
    let rad = 0;
    if (finite(tempC) && finite(dewC) && finite(windMps) && tempC - dewC <= 1.5 && windMps < 3 && sunAlt < 6 * DEG && !(lowCloud >= 50)) rad = tempC - dewC <= 0.5 ? 0.8 : 0.6;
    const pos = finite(tpiM) ? tpiM : finite(relM) ? relM : null;
    let terrain = 1;
    if (pos !== null) terrain = pos <= (finite(tpiM) ? -20 : -60) ? 1.5 : pos >= (finite(tpiM) ? 30 : 150) ? 0.3 : 1;
    let r = Math.max(base, Math.min(1, rad * terrain));
    if (pos !== null && pos >= (finite(tpiM) ? 30 : 150) && lowCloud >= 90) r = Math.max(r, 0.6);
    return Math.round(r * 100) / 100;
  }
  /** Sun-vs-heading flags: { glare: 0|1, golden: 0|1|null } (golden needs a grade). */
  function sunFlags(alt, az, heading, grade) {
    const off = U.angleOff(heading, az);
    const glare = alt > 0 && alt <= GLARE_MAX_ALT && off < GLARE_HALF ? 1 : 0;
    if (!finite(grade)) return { glare, golden: null };
    const descending = grade <= DESCENT;
    const afterglow = alt >= GOLD_LOW && alt <= 0 && off < GOLD_SIDE;
    const lowSide = alt > 0 && alt <= GOLD_HIGH && off >= GLARE_HALF && off < GOLD_SIDE;
    return { glare, golden: descending && !glare && (afterglow || lowSide) ? 1 : 0 };
  }
  const lightOf = (alt) => (alt > -0.833 * DEG ? 2 : alt > -6 * DEG ? 1 : 0);

  /** Every channel and span for one corridor, given series per cell key (Map) — pure, the unit tests call it directly. */
  function evaluate(corridor, series, opts = {}) {
    const n = corridor.lat.length, ch = {};
    for (const c of CHANNELS) ch[c] = U.nanArray(n);
    const elev = U.chan(corridor, opts, ['elev_m']), tpi = U.chan(corridor, opts, ['tpi_m']), bridge = U.chan(corridor, opts, ['bridge']);
    const grade = U.gradeOf(corridor.distM, elev);
    let known = 0;
    for (let i = 0; i < n; i++) {
      const lat = corridor.lat[i], lon = corridor.lon[i], ms = corridor.etaAt[i], hd = corridor.heading[i];
      if (SUN && finite(ms)) {
        const p = SUN.sunPosition(new Date(ms), lat, lon);
        ch.sun_alt_rad[i] = p.altitude; ch.light[i] = lightOf(p.altitude);
        if (finite(hd)) { const f = sunFlags(p.altitude, p.azimuth, hd, grade[i]); ch.glare[i] = f.glare; if (f.golden !== null) ch.golden_view[i] = f.golden; }
      }
      const s = series.get(U.cellOf(lat, lon, CELL));
      if (!s || !finite(ms)) continue;
      const tempC = at(s, 'temperature_2m', ms);
      if (tempC === null) continue;
      known++;
      const dewC = at(s, 'dew_point_2m', ms), windMps = at(s, 'wind_speed_10m', ms), gust = at(s, 'wind_gusts_10m', ms), dir = at(s, 'wind_direction_10m', ms);
      const visM = at(s, 'visibility', ms), code = at(s, 'weather_code', ms), lowCloud = at(s, 'cloud_cover_low', ms), road = at(s, 'soil_temperature_0cm', ms);
      const put = (k, v) => { if (finite(v)) ch[k][i] = v; };
      put('air_temp_c', tempC); put('dew_point_c', dewC); put('road_temp_c', road); put('visibility_m', visM); put('wind_mps', windMps); put('gust_mps', gust);
      if (finite(gust) && finite(dir) && finite(hd)) ch.crosswind_mps[i] = Math.abs(gust * Math.sin(dir * DEG - hd));
      const relM = elev && finite(elev[i]) && finite(s.elev) ? elev[i] - s.elev : null;
      const tp = tpi && finite(tpi[i]) ? tpi[i] : null;
      put('fog_risk', fogRisk({ visM, code, tempC, dewC, windMps, lowCloud, sunAlt: ch.sun_alt_rad[i], tpiM: tp, relM }));
      if (bridge && bridge[i] === 1) ch.exposure[i] = 1;
      else if (tp !== null) ch.exposure[i] = tp >= 30 ? 1 : tp <= -20 ? 0.4 : 0.7;
      if (WX) { const h = WX.hazard({ prob: at(s, 'precipitation_probability', ms), mm: at(s, 'precipitation', ms + 3600e3), tempC, visM, code }); if (h !== undefined) ch.wx_hazard[i] = HAZARD_CODE[h || 'none']; }
      put('precip_6h_mm', precipBefore(s, ms, 6)); put('precip_48h_mm', precipBefore(s, ms, 48));
    }
    const d = corridor.distM, v = (k) => (i) => ch[k][i];
    const wet3 = (i) => { const s = series.get(U.cellOf(corridor.lat[i], corridor.lon[i], CELL)); const p = precipBefore(s, corridor.etaAt[i], 3); return p !== null && p >= 0.2; };
    const spans = [
      ...U.spansWhere(d, (i) => ch.fog_risk[i] >= 0.5, 'fog', { valueAt: v('fog_risk'), label: 'Fog likely' }),
      ...U.spansWhere(d, (i) => ch.crosswind_mps[i] >= 15 || (ch.crosswind_mps[i] >= 11 && ch.exposure[i] >= 1), 'crosswind', { valueAt: v('crosswind_mps'), label: 'Strong crosswind gusts' }),
      ...U.spansWhere(d, (i) => ch.air_temp_c[i] <= COLD_TYRE_C, 'cold-tyres', { valueAt: (i) => -ch.air_temp_c[i], label: 'Cold tyres: under 7 °C' }).map((s) => ({ ...s, value: -s.value })),
      ...U.spansWhere(d, (i) => ch.road_temp_c[i] <= ICE_ROAD_C && (wet3(i) || ch.road_temp_c[i] <= ch.dew_point_c[i]), 'ice', { valueAt: (i) => -ch.road_temp_c[i], label: 'Ice or frost possible' }).map((s) => ({ ...s, value: -s.value })),
      ...U.spansWhere(d, (i) => ch.light[i] === 0, 'dark', { label: 'After dark' }),
      ...U.spansWhere(d, (i) => ch.glare[i] === 1, 'glare', { label: 'Low sun ahead' }),
      ...U.spansWhere(d, (i) => ch.golden_view[i] === 1, 'golden-view', { label: 'Golden-hour view on the way down', minM: 100 }),
    ];
    const status = known === n ? 'ok' : known > 0 ? 'partial' : 'unavailable';
    const out = { status, channels: ch, spans, points: [] };
    if (status !== 'ok') out.note = known ? 'forecast missing for part of the route' : 'no forecast (offline or beyond 3 days); sun only';
    if (!elev) out.note = (out.note ? out.note + '; ' : '') + 'no elevation: golden_view unknown, fog not terrain-adjusted';
    return out;
  }

  /** The cells to ask for, and which are cached: { want: [key], have: Map(key → series) }. */
  function plan(corridors, storage, now) {
    const want = [], have = new Map();
    for (const k of U.cellsAlong(corridors, CELL, 0, 1)) {
      const c = U.cacheGet(storage, 'om.' + k, TTL_MS, now);
      if (c) have.set(k, c); else want.push(k);
    }
    return { want, have };
  }

  /** The cells' hourly series: { have (Map, filled as the batches land), done (Promise<[answered]>) }. */
  function startSeries(corridors, opts = {}) {
    const { fetchFn, storage, now, signal } = U.env(opts);
    const { want, have } = plan(corridors, storage, now);
    const batches = [];
    for (let k = 0; k < want.length; k += MAX_PER_CALL) batches.push(want.slice(k, k + MAX_PER_CALL));
    const done = U.pool(batches.map((b) => async () => {
      const json = await U.getJSON(fetchFn, url(b.map((key) => U.cellCentre(key, CELL))), { timeoutMs: BUDGET_MS - 500, signal });
      const list = json ? parse(json) : [];
      b.forEach((key, j) => { if (list[j]) { have.set(key, list[j]); U.cachePut(storage, 'om.' + key, list[j], now); } });
      return !!json;
    }), 2);
    return { have, done };
  }
  async function fetchSeries(corridors, opts = {}) {
    const s = startSeries(corridors, opts), results = await s.done;
    return { series: s.have, failed: results.some((r) => !r) };
  }

  // the forecast on its own clock (live: Open-Meteo took 2-3.5 s or failed, and the whole context waited for it): the plan
  // waits WAIT_MS at most and goes on with the cells cached and those landed; the rest land in the cache for the next plan
  const WAIT_MS = 1500;
  async function fetch(corridors, opts = {}) {
    const s = startSeries(corridors, { ...opts, signal: undefined });
    const wait = Math.min(opts.budgetMs || BUDGET_MS, finite(opts.waitMs) ? opts.waitMs : WAIT_MS);
    const series = (await U.within(s.done.then((r) => ({ series: s.have, failed: r.some((x) => !x) })), wait, null)) || { series: new Map(s.have), failed: true };
    const out = {};
    for (const c of corridors) out[c.id] = evaluate(c, series.series, opts);
    return out;
  }

  const provider = { id: ID, version: VERSION, channels: CHANNELS, needs: { network: true }, budgetMs: BUDGET_MS, fetch };
  U.register(provider);
  const api = { provider, CHANNELS, HAZARD_CODE, CELL, url, parse, at, precipBefore, fogRisk, sunFlags, lightOf, evaluate, plan, fetch, GLARE_MAX_ALT, GLARE_HALF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCtxConditions = api;
})(typeof window !== 'undefined' ? window : globalThis);
