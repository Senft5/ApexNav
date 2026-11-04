// Route context: deer hours (ROUTE_ENGINE_CONTRACT provider `wildlife`). No network: sun times (web/sun.js) at each sample's
// eta x the month's share of deer crashes in that state x the land the road runs through.
//
// Calibration (state agencies; the table below records each source and what it reported):
//  - Time of day: Ohio State Highway Patrol, Traffic Safety Bulletin "Deer Crashes", Oct 2022 (2017-2022, 101,912 crashes):
//    26 % between 05:00 and 07:59 and 31 % between 18:00 and 21:59, i.e. about 2.1x and 1.9x the hourly average, both tied to
//    dawn and dusk. The curve here peaks at sunrise and in the 1.5 h after sunset (deer move at dusk and into the first dark
//    hours), with the night at the average and midday low: relative rate by hour, normalised to a daily mean of 1.
//  - Season: the share of the year's deer crashes in Oct-Dec (Q4) and in November. Months outside Q4 share the rest, with
//    May-June raised a little (yearlings dispersing, fawning) and Feb-Apr lowered, the pattern state reports describe.
//  - Land: crashes concentrate where forest meets open land on rural roads (forest edges, farmland); towns and highways
//    with fencing see few. With forest_frac / farmland_frac / urban_density channels from the engine, the land factor is
//    0.25 (dense town) to 1.6 (forest edge); without them `deer_risk` is NaN and `deer_time_risk` (time x season only) is
//    still known.
// Channels:
//   deer_time_risk  x   relative deer-crash rate at this sample's eta from time of day x month in its state (1 = the state's
//                       average hour of the year). Always known inside the seven states; NaN outside them.
//   deer_risk       x   deer_time_risk x land factor (NaN without land use).
// Spans: deer-hour (deer_risk ≥ 2.5, or deer_time_risk ≥ 3 where land is unknown; value the risk): the engine prefers open
// roads and avoids forest edges there, and the co-driver can caution. Points: deer-crossing (OSM hazard=animal_crossing /
// hazard=deer passed in opts.places.animal_crossing by the OSM provider) inside a deer-hour, value its risk.
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const U = NODE ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const SUN = NODE ? require('../sun.js') : root.ApexSun;
  const { finite } = U;
  const ID = 'wildlife', VERSION = 1, CHANNELS = ['deer_time_risk', 'deer_risk'];

  // q4: share of the year's deer crashes in Oct-Dec; nov: in November (null = not reported, the regional 0.22 is used).
  const SEASON = {
    OH: { q4: 0.47, nov: 0.22, src: 'Ohio State Highway Patrol, Traffic Safety Bulletin Oct 2022 (Q4 47 %); OSHP 2019-2023 release (November 22 %)' },
    KY: { q4: 0.50, nov: null, src: 'Kentucky Transportation Cabinet "Antler Alert" 2025: nearly half in Oct-Dec, November the highest month' },
    IN: { q4: 0.48, nov: null, src: 'Indiana State Police 2022 (15,454 deer collisions); nearly half in Oct-Dec (Evansville post)' },
    WV: { q4: 0.40, nov: 0.17, src: 'West Virginia DNR: about 40 % in Oct-Dec; October and November coincide with the rut peak' },
    TN: { q4: 0.50, nov: null, src: 'Tennessee DOT: 50 % of deer crashes Oct-Dec; TWRA ties it to the rut' },
    NC: { q4: 0.47, nov: null, src: 'NCDOT annual animal-strike releases: the fall peak; share not published here, regional 47 % used' },
    VA: { q4: 0.50, nov: 0.24, src: 'Virginia DMV via AAA Mid-Atlantic: half in Q4, nearly a quarter in November (2021, 7,486 crashes)' },
  };
  const NOV_DEFAULT = 0.22;
  // Relative weights for the nine non-Q4 months (Jan..Sep), mean 1: low late winter/spring, a May-June bump.
  const OFF_SHAPE = [1.0, 0.75, 0.7, 0.8, 1.25, 1.3, 0.95, 0.95, 1.3];

  /** Month multiplier (1 = average month) for a state and month 1-12; null outside the table. */
  function monthFactor(state, month) {
    const s = SEASON[state];
    if (!s || !(month >= 1 && month <= 12)) return null;
    const nov = s.nov !== null ? s.nov : Math.min(NOV_DEFAULT, s.q4 * 0.5);
    let share;
    if (month === 11) share = nov;
    else if (month === 10 || month === 12) share = (s.q4 - nov) / 2;
    else share = (1 - s.q4) / 9 * OFF_SHAPE[month - 1] / (OFF_SHAPE.reduce((a, b) => a + b, 0) / 9);
    return Math.round(share * 12 * 1000) / 1000;
  }

  // Hour-of-day curve against the sun: Gaussian peaks at sunrise (σ 50 min, from 1 h before) and 45 min after sunset (σ 70 min),
  // on a base of 0.95 at night and 0.3 in full day. Normalised so the 24 h mean is 1 (checked in the tests for an equinox day).
  const DAWN_SIG = 50, DUSK_SIG = 70, DUSK_LAG = 45, DAWN_AMP = 2.5, DUSK_AMP = 1.8, NIGHT = 0.95, DAY = 0.3;
  /** Relative hourly rate at minutes since sunrise and since sunset (night when before sunrise or after sunset). */
  function hourFactor(minSinceRise, minSinceSet) {
    const night = minSinceRise < 0 || minSinceSet > 0;
    const base = night ? NIGHT : DAY;
    const dawn = DAWN_AMP * Math.exp(-0.5 * (minSinceRise / DAWN_SIG) ** 2);
    const dusk = DUSK_AMP * Math.exp(-0.5 * ((minSinceSet - DUSK_LAG) / DUSK_SIG) ** 2);
    return base + dawn + dusk;
  }
  // 24 h mean of hourFactor at the equinox (12 h of daylight). With it the curve puts 24 % of a day in 05:00-07:59 and 30 %
  // in 18:00-21:59 (sunrise 06:00, sunset 18:00); OSHP measured 26 % and 31 % (tests/test_route_ctx_wildlife.py).
  const NORM = 1.06;
  /** Minutes since that day's sunrise and sunset at the instant, by the local solar day (web/sun.js); null at polar extremes. */
  function sunMinutes(ms, lat, lon) {
    if (!SUN) return null;
    let best = null;
    for (const dd of [-1, 0, 1]) {                                            // the UTC day around it whose sunrise/sunset are nearest
      const t = SUN.sunTimes(new Date(ms + dd * 864e5), lat, lon);
      if (!t.sunrise || !t.sunset) continue;
      const r = (ms - t.sunrise.getTime()) / 60000, s = (ms - t.sunset.getTime()) / 60000;
      if (!best || Math.abs(r) + Math.abs(s) < Math.abs(best.r) + Math.abs(best.s)) best = { r, s };
    }
    return best;
  }
  /** Time x season risk at a point and instant; null outside the seven states. */
  function timeRisk(ms, lat, lon) {
    const st = U.stateAt(lat, lon);
    if (!st || !finite(ms)) return null;
    const lt = U.localTime(ms, lat, lon), mf = monthFactor(st, lt.m), sm = sunMinutes(ms, lat, lon);
    if (mf === null || !sm) return null;
    return Math.round(mf * hourFactor(sm.r, sm.s) / NORM * 100) / 100;
  }
  /**
   * Land factor from fractions of forest and farmland around the sample and the router's urban density (0-15): edges of forest
   * and open land are worst (both present), deep forest next, open farmland and towns least. null when nothing is known.
   */
  function landFactor(forest, farm, urban) {
    const f = finite(forest) ? forest : null, a = finite(farm) ? farm : null, u = finite(urban) ? urban : null;
    if (f === null && a === null && u === null) return null;
    let k = 0.9;
    if (f !== null) k = 0.6 + 0.9 * f + (a !== null ? 1.6 * Math.min(f, a) : 0);   // edge bonus when both
    else if (a !== null) k = 0.7 + 0.4 * a;
    if (u !== null) k *= u >= 8 ? 0.25 : u >= 4 ? 0.55 : 1;
    return Math.round(Math.min(1.6, Math.max(0.2, k)) * 100) / 100;
  }

  function evaluate(corridor, opts = {}) {
    const n = corridor.lat.length, time = U.nanArray(n), risk = U.nanArray(n);
    const forest = U.chan(corridor, opts, ['forest_frac', 'canopy_frac']), farm = U.chan(corridor, opts, ['farmland_frac']), urban = U.chan(corridor, opts, ['urban_density']);
    let land = 0, known = 0;
    for (let i = 0; i < n; i++) {
      const r = timeRisk(corridor.etaAt[i], corridor.lat[i], corridor.lon[i]);
      if (r === null) continue;
      known++; time[i] = r;
      const lf = landFactor(forest && forest[i], farm && farm[i], urban && urban[i]);
      if (lf !== null) { risk[i] = Math.round(r * lf * 100) / 100; land++; }
    }
    const d = corridor.distM;
    const spans = U.spansWhere(d, (i) => risk[i] >= 2.5 || (!finite(risk[i]) && time[i] >= 3), 'deer-hour',
      { valueAt: (i) => (finite(risk[i]) ? risk[i] : time[i]), label: 'Deer hour', joinM: 200, minM: 100 });
    const points = [];
    for (const p of (opts.places && opts.places.animal_crossing) || []) {
      const s = U.nearestSample(corridor, p.lat, p.lon, 40);
      if (s && (risk[s.i] >= 2.5 || time[s.i] >= 3)) points.push({ atM: s.atM, kind: 'deer-crossing', value: finite(risk[s.i]) ? risk[s.i] : time[s.i], label: 'Deer crossing, deer hour' });
    }
    const status = !known ? 'unavailable' : known < n || land < n ? 'partial' : 'ok';
    const out = { status, channels: { deer_time_risk: time, deer_risk: risk }, spans, points };
    if (!known) out.note = 'outside the seven states with a deer calendar';
    else if (land < n) out.note = land ? 'land use missing for part of the route' : 'no land-use data: deer_risk unknown, time x season only';
    return out;
  }

  async function fetch(corridors, opts = {}) {
    const out = {};
    for (const c of corridors) {
      try { out[c.id] = evaluate(c, opts); } catch (_) { out[c.id] = U.emptyResult(c, CHANNELS, 'unavailable', 'failed'); }
    }
    return out;
  }

  const provider = { id: ID, version: VERSION, channels: CHANNELS, needs: { network: false }, budgetMs: 200, fetch };
  U.register(provider);
  const api = { provider, CHANNELS, SEASON, monthFactor, hourFactor, NORM, sunMinutes, timeRisk, landFactor, evaluate, fetch };
  if (NODE) module.exports = api; else root.ApexCtxWildlife = api;
})(typeof window !== 'undefined' ? window : globalThis);
