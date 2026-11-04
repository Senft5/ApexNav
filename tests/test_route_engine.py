"""The route engine's model (web/route_engine.js) on synthetic roads with stub channels for every catalogue item:
no context = today's ranking exactly; unknown never helps or hurts; monotonic in speed limit, businesses, signals and the
rest; time-dependent spans; hard constraints; the why line. Real roads are in test_route_engine_calibration.py."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const root = process.argv[1];
const Core = require(root + '/web/apex_core.js'); globalThis.ApexCore = Core;
globalThis.ApexSun = require(root + '/web/sun.js');
const F = require(root + '/web/fun_route.js'); globalThis.ApexFunRoute = F;
const C = require(root + '/web/route_ctx/registry.js');
const E = require(root + '/web/route_engine.js');
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = (len) => ll(Array.from({ length: len / 10 + 1 }, (_, i) => [i * 10, 0]));
const wiggly = (len) => ll(Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
const DEPART = Date.parse('2026-11-04T12:00:00-05:00');          // a Wednesday noon
let seq = 0;
/** A candidate on `coords` taking timeS, with stub channels { name: value | fn(i, m) } and spans/points. */
function cand(coords, timeS, chans = {}, extra = {}) {
  const route = { coords, turns: [], times: [], names: new Map(), timeS };
  const c = { id: 'c' + (seq++), route, timeS, ...extra.c };
  c.t = F.geometry(coords, Core); c.turnsM = []; c.fun = F.score(c.t, []);
  c.corridor = E.corridorFor(c, c.id, { departAt: extra.departAt || DEPART, car: extra.car || null });
  if (chans === null) return c;
  const n = c.corridor.distM.length, ch = {};
  for (const [k, v] of Object.entries(chans)) ch[k] = Float32Array.from({ length: n }, (_, i) => (typeof v === 'function' ? v(i, c.corridor.distM[i]) : v));
  c.ctx = { channels: ch, spans: extra.spans || [], points: extra.points || [] };
  return c;
}
const rank = (cs, o = {}) => E.rank(cs, { level: 'fun', ...o, fresh: true });
const value = (c, others = [], o = {}) => { const r = rank([c, ...others], o).find((x) => x.id === c.id); return r ? r.value : null; };
const out = {};
// 1. no context: exactly ApexFunRoute.rank
{
  const fun = (f, g) => ({ fun: f, good: g });
  let same = true;
  for (let k = 0; k < 200; k++) {
    const cs = Array.from({ length: 4 }, (_, i) => ({ id: 'x' + i, timeS: 1500 + Math.round(Math.random() * 1500), fun: fun(Math.round(Math.random() * 100), Math.round(Math.random() * 80)),
      adjust: Math.random() < 0.3 ? -5 : 0, glare: { minutes: Math.random() * 12 }, townKm: Math.random() < 0.5 ? Math.random() * 6 : null, weatherCost: Math.random() < 0.3 ? 4 : 0, tasteBonus: Math.random(), preferBonus: Math.random() }));
    for (const lv of ['quick', 'fun', 'max']) {
      const a = F.rank(cs, lv), b = E.rank(cs, { level: lv });
      if (a.map((c) => c.id).join() !== b.map((c) => c.id).join() || a.some((c, i) => Math.abs(c.value - b[i].value) > 1e-9)) same = false;
    }
  }
  out.noContextSame = same;
}
// a back road (wiggly, rural, 55 mph) and the same road as a subdivision (25 mph residential, driveways)
const back = { speed_limit_kph: 89, road_class: 4, road_use: 0, density: 1, signals_per_km: 0, access_per_km: 4, surface: 0, sidewalk: 0 };
const subdiv = { speed_limit_est_kph: 40, road_class: 6, road_use: 0, density: 7, signals_per_km: 0, access_per_km: 30, surface: 0, sidewalk: 1 };
const hwy = { speed_limit_kph: 105, road_class: 0, road_use: 0, density: 4, signals_per_km: 0, access_per_km: 0, surface: 0, lanes: 2 };
const arterial = { speed_limit_kph: 56, road_class: 2, road_use: 0, density: 9, signals_per_km: 3, access_per_km: 30, surface: 0, sidewalk: 1, business_per_km: 15, lanes: 2 };
{
  const s = (ch) => { const c = cand(wiggly(8000), 900, ch); E.evaluate(c, {}); return c.ev; };
  const a = s(back), b = s(subdiv), h = s(hwy), m = s(arterial);
  out.quality = { back: a.quality, subdiv: b.quality, hwy: h.quality, arterial: m.quality };
  out.gated = { back: a.funGated.good, subdiv: b.funGated.good, raw: cand(wiggly(8000), 900, null).fun.good };
  out.poorKm = { back: a.poorKm, subdiv: +b.poorKm.toFixed(2), arterial: +m.poorKm.toFixed(2), hwy: h.poorKm };
}
// 2. the highway beats a neighbourhood cut-through a minute quicker; a detour must buy real quality
{
  const h = cand(straight(10000), 600, hwy), n = cand(wiggly(8000), 540, subdiv);
  out.hwyVsHood = ['quick', 'fun', 'max'].map((lv) => rank([h, n], { level: lv })[0].id === h.id);
  const h2 = cand(straight(10000), 600, hwy), b = cand(wiggly(9000), 780, back);
  out.backRoad = ['quick', 'fun', 'max'].map((lv) => rank([h2, b], { level: lv })[0].id === b.id);
  const h3 = cand(straight(10000), 600, hwy), a = cand(straight(8000), 570, arterial);
  out.hwyVsArterial = ['quick', 'fun', 'max'].map((lv) => rank([h3, a], { level: lv })[0].id === h3.id);
}
// 3. unknown never helps or hurts: an all-NaN channel, or a channel missing, changes nothing
{
  let ok = true;
  const names = [...E.QUALITY, ...E.SCENERY, ...E.PER_KM].map((t) => t.ch);
  for (const nm of names) {
    const base = cand(wiggly(6000), 700, back), other = cand(straight(6000), 600, hwy);
    const v0 = value(base, [other]);
    const withNaN = cand(wiggly(6000), 700, { ...back, [nm]: NaN }), other2 = cand(straight(6000), 600, hwy);
    if (Math.abs(value(withNaN, [other2]) - v0) > 1e-6 && !(nm in back)) { ok = false; out.unknownBad = nm; }
  }
  out.unknownNeutral = ok;
  // half known: the known half counts, the unknown half neither helps nor hurts (confidence drops)
  const full = cand(wiggly(6000), 700, back), half = cand(wiggly(6000), 700, Object.fromEntries(Object.entries(back).map(([k, v]) => [k, (i) => (i % 2 ? v : NaN)])));
  E.evaluate(full, {}); E.evaluate(half, {});
  out.halfConf = [+full.ev.confidence.toFixed(3), +half.ev.confidence.toFixed(3)];
  out.halfQuality = [full.ev.quality, half.ev.quality];
}
// 4. monotonic: every quality term's goodness never moves the wrong way over its range, and the route value follows
{
  const dir = { speed_limit_kph: 1, speed_limit_est_kph: 1, speed_kph: 1, mapillary_limit_kph: 1, density: -1, signals_per_km: -1, stops_per_km: -1, crossings_per_km: -1, access_per_km: -1,
    calming_per_km: -1, lanes: -1, business_per_km: -1, landuse_urban: -1, landuse_residential: -1, buildings_per_ha: -1, night_light: -1, impervious_pct: -1, address_per_km: -1,
    housing_per_km2: -1, noise_db: -1, aadt: -1, traffic_ratio: 1, iri: -1, crowd_rough_g: -1, crowd_flow: 1, hgv_share: -1 };
  const bad = [];
  for (const t of E.QUALITY) {
    if (!(t.ch in dir)) continue;
    let prev = null;
    for (let k = 0; k <= 200; k++) {
      const v = t.ch.includes('kph') ? 10 + k * 0.6 : t.ch === 'aadt' ? k * 300 : t.ch === 'noise_db' ? 30 + k * 0.25 : t.ch.endsWith('_g') ? k * 0.003 : t.ch === 'iri' ? k * 1.5 : ['landuse_urban', 'landuse_residential', 'traffic_ratio', 'crowd_flow', 'hgv_share'].includes(t.ch) ? k / 200 : k * 0.3;
      const g = t.g(v);
      if (prev != null && dir[t.ch] * (g - prev) < -1e-9) { bad.push(t.ch); break; }
      prev = g;
    }
  }
  out.monotoneTerms = bad;
  const vAt = (ch, v) => { const c = cand(wiggly(6000), 700, { ...back, [ch]: v }), o = cand(straight(6000), 650, hwy); return value(c, [o]); };
  const series = (ch, vs) => vs.map((v) => vAt(ch, v));
  const nondec = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-9), noninc = (xs) => xs.every((x, i) => i === 0 || x <= xs[i - 1] + 1e-9);
  out.monoLimit = nondec(series('speed_limit_kph', [24, 40, 56, 72, 89, 105, 120]));
  out.monoBiz = noninc(series('business_per_km', [0, 1, 3, 6, 12, 25]));
  out.monoSignals = noninc(series('signals_per_km', [0, 0.5, 1, 2, 4]));
  out.monoAccess = noninc(series('access_per_km', [0, 5, 15, 30, 60]));
  out.monoDensity = noninc(series('density', [0, 2, 5, 8, 12, 15]));
  const vTown = (lim) => { const c = cand(wiggly(6000), 700, { ...back, density: 7, sidewalk: 1, speed_limit_kph: lim }), o = cand(straight(6000), 650, hwy); return value(c, [o]); };
  out.limitMatters = vTown(89) - vTown(40);
  out.limitRural = vAt('speed_limit_kph', 89) - vAt('speed_limit_kph', 40);
  out.bizMatters = vAt('business_per_km', 0) - vAt('business_per_km', 20);
}
// 5. every catalogue channel changes the ranking the right way: the same road, "good" vs "bad" value of one channel
{
  const goodBad = { forest_share: [1, 0], canopy_pct: [80, 0], water_near: [1, 0], creek_follow: [1, 0], open_country: [1, 0], protected: [1, 0], photo_per_km: [10, 0],
    tpi_m: [50, 0], relief_m: [200, 5], foliage: [1, 0], old_road: [1, 0], loved: [1, 0], guardrail: [1, 0], curve_signs_per_km: [4, 0], crowd_camber_deg: [4, -3],
    divided: [0, 1], surface: [0, 5], sidewalk: [0, 1], truck_route: [0, 1], access_destination: [0, 1], road_class: [4, 6], road_use: [0, 4], built_year: [1900, 2010], name_age: [1, -1], photo_score: [1, 0], curve_sign: [1, 0], night_lights: [0.05, 0.9], address_density: [10, 3000], grade_pct: [6, 0] };
  const wrong = [];
  const extraCh = { canopy_pct: 80 };                 // foliage counts where there are trees
  for (const t of [...E.QUALITY, ...E.SCENERY]) {
    let pair = goodBad[t.ch];
    if (!pair) { const vs = t.ch.includes('kph') ? [100, 30] : t.ch === 'aadt' ? [300, 30000] : t.ch === 'noise_db' ? [45, 75] : t.ch.endsWith('_g') ? [0.03, 0.4] : t.ch === 'iri' ? [50, 220] : ['landuse_urban', 'landuse_residential', 'hgv_share'].includes(t.ch) ? [0, 1] : ['traffic_ratio', 'crowd_flow'].includes(t.ch) ? [1, 0] : [0, 30]; pair = vs; }
    const base = { ...back }; delete base[t.ch];
    if (t.unless) for (const u of t.unless) delete base[u];
    const g = cand(wiggly(6000), 700, { ...base, ...(t.ch === 'foliage' ? extraCh : {}), [t.ch]: pair[0] }), b = cand(wiggly(6000), 700, { ...base, ...(t.ch === 'foliage' ? extraCh : {}), [t.ch]: pair[1] });
    if (!(value(g, [b]) > value(b, [g]))) wrong.push(t.ch);
  }
  for (const t of E.PER_KM) {
    const v = { deer_risk: 4, fog_vis_m: 100, crosswind_ms: 20, road_temp_c: -5, crash_rate: 5, cyclist_route: 1, buggy: 1, unlit: 1, snow_cover: 1, crowd_busy: 2, park_visitors: 1, signal_coverage: 0, passenger_cost: 1, fuel_margin: 0, fog_risk: 1, crash_density: 0.2, event_crowd: 30, school_zone: 1, school_bus_hour: 1, church_window: 1, harvest_traffic: 1, flood_zone: 3, ice: 1 }[t.ch];
    const extraWet = t.ch === 'flood_zone' ? { precip_48h_mm: 30 } : {};
    const when = t.ch === 'deer_risk' ? Date.parse('2026-11-04T17:20:00-05:00') : t.ch === 'cyclist_route' ? Date.parse('2026-11-07T08:30:00-05:00') : t.ch === 'park_visitors' ? Date.parse('2026-11-07T13:00:00-05:00') : t.ch === 'unlit' ? Date.parse('2026-11-04T21:00:00-05:00') : DEPART;
    const exposedCh = { ...(t.ch === 'crosswind_ms' ? { tpi_m: 40 } : {}), ...extraWet };
    const prefs = t.pref ? { [t.pref]: true } : {};
    const clean = cand(wiggly(6000), 700, { ...back, ...exposedCh }, { departAt: when }), dirty = cand(wiggly(6000), 700, { ...back, ...exposedCh, [t.ch]: v }, { departAt: when });
    if (!(value(clean, [dirty], { prefs }) > value(dirty, [clean], { prefs }))) wrong.push(t.ch);
  }
  out.channelsWrong = wrong;
  out.channelCount = E.QUALITY.length + E.SCENERY.length + E.PER_KM.length;
}
// 6. spans and points: time-dependent, bonuses, hard constraints
{
  const wed8 = Date.parse('2026-11-04T07:50:00-05:00'), sun8 = Date.parse('2026-11-08T07:50:00-05:00');
  const school = [{ fromM: 1000, toM: 1400, kind: 'school' }];
  const pen = (when, spans, points = [], prefs = {}) => { const c = cand(wiggly(6000), 700, back, { departAt: when, spans, points }); E.evaluate(c, { prefs }); return c.ev.penaltyRaw; };
  out.schoolWeekday = pen(wed8, school); out.schoolSunday = pen(sun8, school);
  out.churchSunday = pen(Date.parse('2026-11-08T09:30:00-05:00'), [{ fromM: 500, toM: 600, kind: 'church' }]);
  out.churchWednesday = pen(wed8 + 2 * 3600e3, [{ fromM: 500, toM: 600, kind: 'church' }]);
  const ev = [{ fromM: 0, toM: 2000, kind: 'event', when: { windows: [[DEPART - 3600e3, DEPART + 3600e3]] } }];
  out.eventOn = pen(DEPART, ev); out.eventOff = pen(DEPART + 6 * 3600e3, ev);
  out.works = pen(DEPART, [{ fromM: 100, toM: 600, kind: 'works', value: 5 }]);
  out.points = pen(DEPART, [], [{ atM: 900, kind: 'level_crossing' }, { atM: 1900, kind: 'one_lane_bridge' }, { atM: 2900, kind: 'animal_crossing' }]);
  const bonus = (spans, points = [], prefs = {}) => { const c = cand(wiggly(6000), 700, back, { spans, points }); E.evaluate(c, { prefs }); return c.ev.bonusPts; };
  out.byway = bonus([{ fromM: 0, toM: 5000, kind: 'byway' }]);
  out.views = bonus([], [1, 2, 3, 4, 5, 6].map((k) => ({ atM: k * 500, kind: 'viewpoint' })));
  out.tunnelNoPref = bonus([], [{ atM: 1000, kind: 'tunnel' }]); out.tunnelPref = bonus([], [{ atM: 1000, kind: 'tunnel' }], { tunnels: true });
  out.resurfaced = bonus([{ fromM: 0, toM: 4000, kind: 'resurfaced' }]); out.camera = bonus([], [{ atM: 100, kind: 'camera' }]) + pen(DEPART, [], [{ atM: 100, kind: 'camera' }]);
  // a passenger aboard: the hairpins cost; fog weighs more in a valley than on a ridge
  const hairpins = ll(Array.from({ length: 1201 }, (_, i) => [i * 5, 22 * Math.sin(2 * Math.PI * i * 5 / 130)]));
  const pp = (prefs) => { const c = cand(hairpins, 700, back); E.evaluate(c, { prefs }); return c.ev.penaltyPts; };
  out.passenger = [pp({}), pp({ passenger: true })];
  const fogAt = (tpi) => { const c = cand(wiggly(6000), 700, { ...back, fog_vis_m: 200, tpi_m: tpi }); E.evaluate(c, {}); return c.ev.penaltyPts; };
  out.fog = [fogAt(-30), fogAt(0), fogAt(40)];
  // a closure when you'd get there drops the route; at another time it doesn't; all closed: they stay, flagged
  const closed = cand(wiggly(6000), 600, back, { spans: [{ fromM: 2000, toM: 2100, kind: 'closure', when: { weekly: [{ from: '11:00', to: '13:00' }] } }] });
  const open = cand(wiggly(6000), 900, back);
  out.closedDropped = rank([closed, open]).map((c) => c.id).includes(closed.id) === false;
  const closedLate = cand(wiggly(6000), 600, back, { departAt: DEPART + 4 * 3600e3, spans: [{ fromM: 2000, toM: 2100, kind: 'closure', when: { weekly: [{ from: '11:00', to: '13:00' }] } }] });
  out.closedLaterKept = rank([closedLate, cand(wiggly(6000), 900, back)])[0].id === closedLate.id;
  const only = rank([cand(wiggly(6000), 600, back, { spans: [{ fromM: 0, toM: 10, kind: 'no_access' }] })]);
  out.allInfeasibleKept = only.length === 1 && only[0].infeasible;
  // the car: a 2.1 m car on a 2.0 m road; a low car on gravel; 300 km range with no fuel on a 400 km route
  const fit = (chans, car) => { const c = cand(wiggly(6000), 700, { ...back, ...chans }, { car }); E.evaluate(c, {}); return c.ev.hard.map((h) => h.kind); };
  out.carWidth = fit({ maxwidth_m: 2.0 }, { width_cm: 210 }); out.carFits = fit({ maxwidth_m: 2.5 }, { width_cm: 210 });
  out.lowCarGravel = fit({ surface: 5 }, { clearance: 'low' });
  // the engine leaves range to car.js: fuel points alone never make a route infeasible; car.js's fuel_gap span does
  const fuelRoute = cand(straight(40000), 2400, back, { car: { range_km: 30 }, points: [{ atM: 5000, kind: 'fuel' }] });
  E.evaluate(fuelRoute, {}); out.fuel = fuelRoute.ev.hard.map((h) => h.kind);
  const gapRoute = cand(straight(40000), 2400, back, { car: { range_km: 30 }, spans: [{ fromM: 5000, toM: 40000, kind: 'fuel_gap', hard: true }] });
  E.evaluate(gapRoute, {}); out.fuelGap = gapRoute.ev.hard.map((h) => h.kind);
  const fuelOk = cand(straight(40000), 2400, back, { car: { range_km: 30 }, points: [{ atM: 15000, kind: 'fuel' }, { atM: 28000, kind: 'fuel' }] });
  E.evaluate(fuelOk, {}); out.fuelOk = fuelOk.ev.hard.length;
}
// 6b. the OSM providers' own names (osm_tiles.js, osm_overpass.js) fill the model's channels
{
  const canon = { road_class: 2, density: 9, speed_limit_kph: 56, business_per_km: 30, landuse_urban: 0.8, access_per_km: 30, surface: 1, guardrail: 0 };
  const osm = { road_class: 2, density: 9, maxspeed_kph: 56, biz_per_km: 30, lu_commercial: 0.5, lu_retail: 0.3, lu_mapped: 1, side_roads_per_km: 10, driveway_joins_per_km: 20, smoothness: 2, guard_rail: 0 };
  const a = cand(straight(6000), 600, canon), b = cand(straight(6000), 600, osm);
  E.evaluate(a, {}); E.evaluate(b, {});
  out.osmNames = [a.ev.quality, b.ev.quality];
  const unmapped = cand(straight(6000), 600, { ...back, lu_commercial: 0, lu_mapped: 0 }), plain = cand(straight(6000), 600, back);
  E.evaluate(unmapped, {}); E.evaluate(plain, {});
  out.unmappedLanduse = [unmapped.ev.quality, plain.ev.quality];
  out.kindAliases = (() => { const c = cand(wiggly(6000), 700, back, { spans: [{ fromM: 0, toM: 10, kind: 'access_private' }], points: [{ atM: 500, kind: 'rail_crossing' }] }); E.evaluate(c, {}); return [c.ev.hard.map((h) => h.kind), c.ev.penaltyRaw]; })();
}
// 6c. builder E's channels (crowd.js, driver.js, car.js, ios_context.js)
{
  const ev = (chans, extra = {}, prefs = {}) => { const c = cand(wiggly(6000), 700, { ...back, ...chans }, extra); E.evaluate(c, { prefs }); return c.ev; };
  out.eUnlit = [ev({ dark: 1, lit: 0 }, {}, { lit: true }).penaltyPts > 0, ev({ dark: 1, lit: 1 }, {}, { lit: true }).penaltyPts, ev({ dark: 1, lit: 0 }).penaltyPts];
  out.eFuelGap = ev({}, { spans: [{ fromM: 100, toM: 5000, kind: 'fuel_gap', value: 300, hard: true }] }).hard.map((h) => h.kind);
  out.eDriver = [ev({ driver_fit: 1 }).driverPts, ev({ driver_fit: -1 }).driverPts, ev({ skill_fit: 0.5 }).driverPts, ev({}).driverPts];
  out.eTaste = ev({ taste: 4 }).tastePts;
  const tasteRank = rank([cand(wiggly(6000), 700, { ...back, taste: 6 }), cand(wiggly(6000), 700, { ...back, taste: -6 })]);
  out.eTasteRank = tasteRank[0].parts.taste > tasteRank[1].parts.taste;
  out.eTunnelOnce = ev({}, { spans: [{ fromM: 1000, toM: 1300, kind: 'tunnel' }], points: [{ atM: 1000, kind: 'tunnel' }] }, { tunnels: true }).bonusPts;
  out.eBank = ev({ crowd_bank_deg: 4 }).scenery > ev({ crowd_bank_deg: -3 }).scenery;
  out.eLate = ev({}, { spans: [{ fromM: 3000, toM: 6000, kind: 'past_next_event', value: 12 }] }).penaltyRaw;
  out.ePassenger = [ev({ passenger_cost: 0.8 }, {}, { passenger: true }).penaltyPts > 0, ev({ passenger_cost: 0.8 }).penaltyPts];
  out.eBusyAvg = ev({ crowd_busy: 1 }).penaltyPts;
}
// 6d. builder C's grid and builder D's names: each maps onto the model's meaning
{
  globalThis.ApexContextGrid = require(root + '/web/route_ctx/context_grid.js');
  const ch = (chans, name) => { const c = cand(straight(3000), 300, chans), a = E.channel(c.ctx, name); return a ? Array.from(a).slice(0, 2).map((v) => (Number.isNaN(v) ? null : +v.toFixed(3))) : null; };
  out.cAlias = {
    housing: ch({ housing_density: 800 }, 'housing_per_km2'), year: ch({ median_year_built: 1952 }, 'built_year'),
    unlitDark: ch({ night_lights: 0.05 }, 'unlit'), unlitLit: ch({ night_lights: 0.7 }, 'unlit'),
    coverageUnknown: ch({ mobile_coverage: NaN }, 'signal_coverage'), coverage: ch({ mobile_coverage: 2 }, 'signal_coverage'),
    hpmsLimit: ch({ hpms_speed_limit: 45 }, 'speed_limit_kph'), hpmsLanes: ch({ hpms_lanes: 4 }, 'lanes'), hpmsClass: ch({ hpms_fclass: 7 }, 'road_class'),
    chainRouterFirst: ch({ speed_limit_kph: 89, sign_maxspeed_mps: 15.6, hpms_speed_limit: 25 }, 'speed_limit_kph'),
    chainSignBeforeHpms: ch({ sign_maxspeed_mps: 15.6, hpms_speed_limit: 25 }, 'speed_limit_kph'),
    vis: ch({ visibility_m: 300 }, 'fog_vis_m'), cross: ch({ crosswind_mps: 14 }, 'crosswind_ms'), dark: ch({ light: 0 }, 'dark'),
    park: ch({ park_busy: 1.6 }, 'park_visitors'), parkC: ch({ park_visits: 2e6 }, 'park_visitors'),
  };
  const pen = (chans, extra = {}, departAt = DEPART) => { const c = cand(wiggly(6000), 700, { ...back, ...chans }, { departAt, ...extra }); E.evaluate(c, {}); return +c.ev.penaltyPts.toFixed(2); };
  out.cPen = {
    floodDry: pen({ flood_zone: 3 }), floodWet: pen({ flood_zone: 3, precip_48h_mm: 40 }),
    harvestCorn: pen({ harvest_traffic: 1, cropland_class: 1 }), harvestForest: pen({ harvest_traffic: 1, cropland_class: 141 }),
    crashQuiet: pen({ crash_density: 0.1, aadt: 1000 }), crashBusy: pen({ crash_density: 0.1, aadt: 60000 }),
    crashMotorwayNoAadt: pen({ ...hwy, crash_density: 0.1 }),
    deerTimed: pen({ deer_risk: 4, deer_time_risk: 4 }, {}, DEPART), deerUntimed: pen({ deer_risk: 4 }, {}, DEPART),
    eventOnce: pen({ event_crowd: 30 }, { spans: [{ fromM: 0, toM: 6000, kind: 'event', value: 30 }] }) === pen({ event_crowd: 30 }),
    fogRiskOnce: pen({ fog_risk: 1, visibility_m: 100 }) === pen({ fog_risk: 1 }),
    crossExposure: [pen({ crosswind_mps: 20, exposure: 1 }), pen({ crosswind_mps: 20, exposure: 0.4 })],
  };
  const glareSame = (() => { const a = cand(wiggly(6000), 700, back), b = cand(wiggly(6000), 700, { ...back, glare: 1 }); return value(a, [b]) === value(b, [a]); })();
  out.glareOnce = glareSame;
  const sc = (chans) => { const c = cand(wiggly(6000), 700, { ...back, ...chans }); E.evaluate(c, {}); return c.ev.scenery; };
  out.photoRural = [sc({ photo_score: 1 }) > sc({ photo_score: 0 }), sc({ photo_score: 1, density: 9 }) === sc({ photo_score: 0, density: 9 })];
}
// 6e. the review's cases: low-limit country roads, infeasible quickest, unknown data, penalty saturation, duplicates, time zones
{
  // a Dragon: 30 mph, a primary in the forest, no houses; a 55 mph straight; the same twisty road built up
  const dragon = { speed_limit_kph: 48, road_class: 2, road_use: 0, density: 0, signals_per_km: 0, access_per_km: 3, surface: 0, sidewalk: 0, forest_share: 0.9 };
  const straight55 = { speed_limit_kph: 89, road_class: 3, road_use: 0, density: 1, signals_per_km: 0, access_per_km: 6, surface: 0, sidewalk: 0 };
  const townTwisty = { ...dragon, density: 7, sidewalk: 1, access_per_km: 30, housing_per_km2: 900 };
  const hairpins = ll(Array.from({ length: 2401 }, (_, i) => [i * 5, 40 * Math.sin(2 * Math.PI * i * 5 / 260)]));
  const d1 = cand(hairpins, 900, dragon), s1 = cand(straight(10000), 600, straight55), t1 = cand(hairpins, 900, townTwisty);
  const rk = rank([d1, s1, t1], { level: 'fun' });
  E.evaluate(d1, {});
  out.dragon = { top: rk[0].id === d1.id, townBelow: rk.findIndex((c) => c.id === t1.id) > rk.findIndex((c) => c.id === d1.id),
    q: d1.ev.quality, gate: d1.ev.meanGate, poor: d1.ev.poorKm, beatsStraight: rank([d1, s1], { level: 'fun' })[0].id === d1.id };
  // stages: the 30 mph forest road isn't killed by the network step
  const st = (name, coords, score) => ({ name, score, km: 6, lat: coords.map((p) => p[1]), lon: coords.map((p) => p[0]) });
  const sD = st('dragon', hairpins, 30), sS = st('straight', straight(6000).map(([x, y]) => [x, y + 0.02]), 20);
  const cs = E.stageCorridors([sD, sS], 8), sctx = {};
  for (const c of cs) { const n = c.distM.length, ch = c.id === sD.__ctxId ? dragon : straight55; sctx[c.id] = { channels: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, new Float32Array(n).fill(v)])), spans: [], points: [] }; }
  out.dragonStage = E.rescoreStages([sD, sS], sctx).map((s) => s.name)[0] === 'dragon' && sD.score >= 0.95 * sD.mapScore;
  // the network step trusts only what it knows: a stage on a strip-mall arterial (the map tiles' shops and class) and one
  // with no road data at all (the router out of time, DEM only) or no answer both lose to a known back road scored lower
  const line = (dy) => straight(6000).map(([x, y]) => [x, y + dy]);
  const sA = st('arterial', line(0.04), 40), sU = st('unknown', line(0.06), 34), sN = st('none', line(0.08), 34), sB = st('back', line(0.1), 24);
  const cs3 = E.stageCorridors([sA, sU, sN, sB], 8), ctx3 = {};
  const fill = (c, ch) => ({ channels: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, new Float32Array(c.distM.length).fill(v)])), spans: [], points: [] });
  for (const c of cs3) { if (c.id === sA.__ctxId) ctx3[c.id] = fill(c, arterial); else if (c.id === sU.__ctxId) ctx3[c.id] = fill(c, { elev_m: 240 }); else if (c.id === sB.__ctxId) ctx3[c.id] = fill(c, back); }
  out.stageTrust = E.rescoreStages([sA, sU, sN, sB], ctx3).map((s) => s.name);
  // country driveways on a 45 mph tertiary don't gate the corners
  const farm = cand(hairpins, 900, { speed_limit_kph: 72, road_class: 4, road_use: 0, density: 1, access_per_km: 22, surface: 0, sidewalk: 0 });
  E.evaluate(farm, {}); out.farmGate = farm.ev.meanGate;
  // the quickest is closed and the rest over budget: the detour is kept (never an empty ranking); all closed: the least bad
  const closed = cand(straight(10000), 600, back, { spans: [{ fromM: 4000, toM: 4100, kind: 'closure' }] }), detour = cand(straight(14000), 1500, back);
  out.closedQuick = ['quick', 'fun'].map((lv) => rank([closed, detour], { level: lv }).map((c) => (c.id === detour.id ? 'detour' : 'closed')));
  const c2 = cand(straight(10000), 600, back, { spans: [{ fromM: 4000, toM: 4100, kind: 'closure' }] }), c3 = cand(straight(10000), 700, back, { spans: [{ fromM: 1, toM: 2, kind: 'closure' }, { fromM: 3, toM: 4, kind: 'no_access' }] });
  const allBad = rank([c2, c3]); out.allBad = [allBad.length, allBad[0].id === c2.id, allBad[0].infeasible];
  // unknown data can't win: the same subdivision with and without the router's data
  const known = cand(wiggly(8000), 900, subdiv), unknown = cand(wiggly(8000), 900, {}), quickHwy = cand(straight(8000), 700, hwy);
  const ru = rank([known, unknown, quickHwy], { level: 'fun' });
  out.unknownLoses = ru.findIndex((c) => c.id === unknown.id) >= ru.findIndex((c) => c.id === known.id);
  // deer can't fill the total: ice still counts, and a longer deer road still costs more
  const deer = (km, spans = []) => { const c = cand(straight(km * 1000), km * 60, { ...back, deer_risk: 4 }, { departAt: Date.parse('2026-11-04T17:20:00-05:00'), spans }); E.evaluate(c, {}); return c.ev.penaltyPts; };
  out.deerSat = { d40: deer(40), d80: deer(80), d40ice: deer(40, [{ fromM: 1000, toM: 4000, kind: 'ice' }]) };
  const hwDeer = (() => { const c = cand(straight(40000), 1500, { ...hwy, deer_risk: 4 }, { departAt: Date.parse('2026-11-04T17:20:00-05:00') }); E.evaluate(c, {}); return c.ev.penaltyPts; })();
  out.deerMotorway = hwDeer < out.deerSat.d40;
  // a signal from the router and the same one from OSM, a level crossing under two names: once each
  const dup = cand(wiggly(6000), 700, { ...back, signals_per_km: 1 }, { points: [{ atM: 1000, kind: 'signal', source: 'router' }, { atM: 1012, kind: 'signal', source: 'osm' }, { atM: 3000, kind: 'signal' },
    { atM: 2000, kind: 'rail_crossing' }, { atM: 2010, kind: 'level_crossing' }], spans: [{ fromM: 4000, toM: 4300, kind: 'tunnel' }, { fromM: 4140, toM: 4300, kind: 'tunnel' }] });
  E.evaluate(dup, { prefs: { tunnels: true } }); out.dedupe = { signals: dup.ev.stats.signals, crossing: dup.ev.penaltyRaw, tunnel: dup.ev.bonusPts };
  // time windows in the place's zone: a church at 9:30 Sunday in Cincinnati, whatever zone the phone is in
  const sunday830 = Date.parse('2026-11-08T08:30:00-05:00');
  out.tz = E.active({ weekly: [{ days: [0], from: '08:00', to: '12:30' }] }, sunday830, 39.1, -84.5);
  out.tzDenver = E.active({ weekly: [{ days: [0], from: '08:00', to: '12:30' }] }, sunday830, 37.97, -87.57);   // Evansville, Central: 7:30 there
}
// 6f. the small terms decide close calls: the same road, the better one a minute slower (a 1-point deficit at Fun)
{
  const cases = { name_age: [1, -1], built_year: [1900, 2010], guardrail: [1, 0], road_temp_c: [15, -5], school_bus_hour: [0, 1], signal_coverage: [1, 0], forest_share: [0.8, 0.2] };
  out.nearTie = {};
  for (const [ch, [good, bad]] of Object.entries(cases)) {
    const base = { ...back };
    const a = cand(wiggly(6000), 760, { ...base, [ch]: good }), b = cand(wiggly(6000), 700, { ...base, [ch]: bad });
    const a0 = cand(wiggly(6000), 760, base), b0 = cand(wiggly(6000), 700, base);
    const withIt = rank([a, b], { level: 'fun' }), without = rank([a0, b0], { level: 'fun' });
    const swing = (withIt.find((c) => c.id === a.id).value - withIt.find((c) => c.id === b.id).value) - (without.find((c) => c.id === a0.id).value - without.find((c) => c.id === b0.id).value);
    out.nearTie[ch] = { flips: without[0].id === b0.id && withIt[0].id === a.id, swing: +swing.toFixed(2) };
  }
}
// 7. active(): windows, weekly (wrapping midnight), months
out.active = [E.active(null, DEPART), E.active({ weekly: [{ from: '19:00', to: '07:00' }] }, Date.parse('2026-11-04T23:30:00-05:00')),
  E.active({ weekly: [{ from: '19:00', to: '07:00' }] }, DEPART), E.active({ months: [6, 7] }, DEPART), E.active({ windows: [[0, 1]] }, DEPART)];
// 8. the why line
{
  const q = cand(straight(10000), 600, arterial), w = cand(straight(10200), 640, hwy);
  const r = rank([q, w], { level: 'quick' }), best = r[0], quick = r.find((c) => c.id === q.id);
  out.whyHighway = E.why(best, quick).text;
  const q2 = cand(straight(10000), 600, hwy), b2 = cand(wiggly(9000), 780, { ...back, forest_share: 1 });
  const r2 = rank([q2, b2], { level: 'fun' });
  out.whyBack = E.why(r2[0], r2.find((c) => c.id === q2.id), { metric: false }).text;
  out.whyNone = E.why(r2[0], r2[0]);
}
// 9. stages: a curvy subdivision street falls behind a straighter country road once the network knows
{
  const st = (name, coords, score) => ({ name, score, km: 2, lat: coords.map((p) => p[1]), lon: coords.map((p) => p[0]) });
  const s1 = st('subdiv', wiggly(2000), 30), s2 = st('country', wiggly(2000).map(([x, y]) => [x, y + 0.01]), 20);
  const cs = E.stageCorridors([s1, s2], 8);
  const ctx = {}; for (const c of cs) { const n = c.distM.length, ch = c.id === s1.__ctxId ? subdiv : back; ctx[c.id] = { channels: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, new Float32Array(n).fill(v)])), spans: [], points: [] }; }
  out.stages = E.rescoreStages([s1, s2], ctx).map((s) => s.name);
  out.stageKept = s1.mapScore;
}
// 10. connector costing: highways welcome between good roads unless avoided
out.costing = [E.connectorCosting(F.AVOID_DEFAULT, null).costing_options.auto.use_highways, E.connectorCosting({ ...F.AVOID_DEFAULT, highways: true }, null).costing_options.auto.use_highways,
  E.highwayCosting(F.AVOID_DEFAULT, null).costing_options.auto.use_highways, E.highwayCosting({ ...F.AVOID_DEFAULT, highways: true }, null), E.connectorCosting({ ...F.AVOID_DEFAULT, tolls: true }, { width_cm: 200 }).costing_options.auto];
// 11. placeTimes: the router's maneuver clock lands on its own line
{
  const coords = straight(2000);
  out.marks = E.placeTimes(coords, [[...coords[0], 0], [...coords[100], 60], [...coords[200], 130]]).map(([m, s]) => [Math.round(m), s]);
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    # the phone's local time decides school hours, Sunday mornings and dusk: the fixtures are Cincinnati's
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=120, env={**os.environ, "TZ": "America/New_York"})
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_no_context_is_todays_ranking_exactly(r):
    assert r["noContextSame"], "providers all down or slow: the ranking is ApexFunRoute.rank, value for value"


def test_quality_separates_the_roads_a_driver_would(r):
    q = r["quality"]
    assert q["back"] > 75 and q["hwy"] > 55, q
    assert q["subdiv"] < 25 and q["arterial"] < 25, q
    assert r["gated"]["subdiv"] == 0 and r["gated"]["back"] == r["gated"]["raw"] > 20, "corners on a side street count nothing"
    assert r["poorKm"]["back"] == 0 and r["poorKm"]["hwy"] == 0 and r["poorKm"]["subdiv"] > 5 and r["poorKm"]["arterial"] > 5


def test_the_highway_beats_side_streets_and_detours_buy_quality(r):
    assert r["hwyVsHood"] == [True, True, True], "a minute quicker through a subdivision: the highway still wins, at every level"
    assert r["hwyVsArterial"] == [True, True, True], "the highway beats a strip-mall arterial"
    assert r["backRoad"] == [False, True, True], "+3 min for a real back road: Fun and Max take it, Quick doesn't"


def test_unknown_never_helps_or_hurts(r):
    assert r["unknownNeutral"], r.get("unknownBad")
    full, half = r["halfConf"]
    assert half < full, "half known: less confident"
    assert abs(r["halfQuality"][0] - r["halfQuality"][1]) < 0.5, "and the same quality from what is known"


def test_monotonic(r):
    assert r["monotoneTerms"] == []
    assert r["monoLimit"] and r["monoBiz"] and r["monoSignals"] and r["monoAccess"] and r["monoDensity"]
    assert r["limitMatters"] > 5 and r["bizMatters"] > 3, (r["limitMatters"], r["bizMatters"])
    assert 0 < r["limitRural"] < r["limitMatters"], "in open country a low limit counts, but far less than in town"


def test_every_catalogue_channel_moves_the_ranking_the_right_way(r):
    assert r["channelsWrong"] == [], r["channelsWrong"]
    assert r["channelCount"] >= 55


def test_time_dependent_spans_and_points(r):
    assert r["schoolWeekday"] > 2 and r["schoolSunday"] == 0
    assert r["churchSunday"] > 0 and r["churchWednesday"] == 0
    assert r["eventOn"] > 5 and r["eventOff"] == 0
    assert r["works"] >= 9, "works: 4 points and the delay at the level's minute"
    assert abs(r["points"] - 1.5) < 0.01, "a level crossing, a one-lane bridge and a deer crossing at noon"
    assert r["byway"] == 2 and r["views"] == 6, "a 5 km byway; six viewpoints capped at 6"
    assert r["tunnelNoPref"] == 0 and r["tunnelPref"] == 1.5
    assert abs(r["resurfaced"] - 1.2) < 0.01 and r["camera"] == 0, "cameras are counted on the card, never ranked"
    assert r["passenger"][0] == 0 and r["passenger"][1] > 0
    assert r["fog"][0] > r["fog"][1] > r["fog"][2] > 0, "valley fog"



def test_osm_provider_names_fill_the_model(r):
    a, b = r["osmNames"]
    assert abs(a - b) < 0.5, r["osmNames"]
    u, p = r["unmappedLanduse"]
    assert u == p, "land use where the map has none is unknown, not 'no shops'"
    assert r["kindAliases"] == [["no_access"], 0.7]


def test_builder_e_channels(r):
    on, lit, off = r["eUnlit"]
    assert on and lit == 0 and off == 0, "unlit after dark costs only with Lit roads at night on"
    assert r["eFuelGap"] == ["fuel_gap"], "car.js marks a stretch past the safe range hard"
    assert r["eDriver"] == [6, -6, 3, 0]
    assert r["eTaste"] == 4 and r["eTasteRank"]
    assert r["eTunnelOnce"] == 1.5, "the same tunnel from two providers counts once"
    assert r["eBank"]
    assert r["eLate"] == 12, "12 min past the next event at the Fun level's minute"
    assert r["ePassenger"][0] and r["ePassenger"][1] == 0
    assert r["eBusyAvg"] == 0, "an average hour costs nothing"


def test_builder_c_and_d_names_keep_their_meaning(r):
    a = r["cAlias"]
    assert a["housing"] == [800, 800] and a["year"] == [1952, 1952]
    assert a["unlitDark"] == [1, 1] and a["unlitLit"] == [0, 0], "Black Marble saturates in suburbs: read as dark vs lit"
    assert a["coverageUnknown"] is None and a["coverage"] == [1, 1], "no FCC data yet: unknown, never 0"
    assert a["hpmsLimit"] == [72.42, 72.42] and a["hpmsLanes"] == [2, 2] and a["hpmsClass"] == [6, 6]
    assert a["chainRouterFirst"] == [89, 89] and a["chainSignBeforeHpms"] == [56.16, 56.16], "router/OSM, then signs, then HPMS"
    assert a["vis"] == [300, 300] and a["cross"] == [14, 14] and a["dark"] == [1, 1]
    assert a["park"] == [0.6, 0.6] and a["parkC"] == [1, 1]
    p = r["cPen"]
    assert p["floodDry"] == 0 and p["floodWet"] > 0, "a flood zone only matters when it's wet"
    assert p["harvestCorn"] > p["harvestForest"] > 0, "harvest traffic where the crop is"
    assert p["crashQuiet"] > p["crashBusy"] and p["crashMotorwayNoAadt"] == 0, "fatal crashes per vehicle, not per km"
    assert p["deerTimed"] > 5 * p["deerUntimed"] > 0, "D's deer_time_risk already holds the hour: not scaled down again by the noon sun"
    assert p["eventOnce"] and p["fogRiskOnce"]
    assert p["crossExposure"][0] > p["crossExposure"][1] > 0
    assert r["glareOnce"], "glare is counted once, by the cockpit's glare term"
    assert r["photoRural"] == [True, True], "photos count in the country, not in town"


def test_hard_constraints(r):
    assert r["closedDropped"] and r["closedLaterKept"] and r["allInfeasibleKept"]
    assert r["carWidth"] == ["car_fit"] and r["carFits"] == [] and r["lowCarGravel"] == ["car_fit"]
    assert r["fuel"] == [] and r["fuelOk"] == 0 and r["fuelGap"] == ["fuel_gap"], "range is car.js's fuel_gap, not a guess from OSM fuel points"
    assert r["active"] == [True, True, False, False, False]


def test_why_line_names_what_separated_them(r):
    assert r["whyHighway"].startswith("Highway instead of") and "strip malls" in r["whyHighway"] and r["whyHighway"].endswith("+1 min"), r["whyHighway"]
    assert "more good corners" in r["whyBack"] and "through forest" in r["whyBack"], r["whyBack"]
    assert r["whyNone"] is None


def test_the_road_network_and_connectors(r):
    assert r["stages"] == ["country", "subdiv"] and r["stageKept"] == 30, "the twistier subdivision street falls behind"
    hw, avoided, quickest, none, other = r["costing"]
    assert hw == 0.6 and avoided == 0 and quickest == 1.0 and none is None
    assert other["use_tolls"] == 0 and other["width"] == 2.0 and other["use_highways"] == 0.6
    assert [s for _, s in r["marks"]] == [0, 60, 130] and all(abs(m - e) <= 3 for (m, _), e in zip(r["marks"], [0, 1000, 2000])), r["marks"]


def test_low_limit_country_roads_keep_their_corners(r):
    d = r["dragon"]
    assert d["q"] > 60 and d["gate"] > 0.9 and d["poor"] == 0, d
    assert d["top"] and d["beatsStraight"] and d["townBelow"], "a 30 mph forest road beats a 55 mph straight, and its built-up twin loses"
    assert r["dragonStage"], "the network step keeps it"
    assert r["stageTrust"][0] == "back" and r["stageTrust"][-1] == "arterial", r["stageTrust"]
    assert r["farmGate"] > 0.9, "country driveways don't gate the corners"


def test_infeasible_quickest_never_empties_the_ranking(r):
    assert r["closedQuick"] == [["detour"], ["detour"]]
    assert r["allBad"] == [1, True, True], "all closed: the least bad, flagged"


def test_unknown_data_cannot_win(r):
    assert r["unknownLoses"]


def test_penalties_saturate_per_kind(r):
    s = r["deerSat"]
    assert s["d40"] < 12.01 and s["d80"] > s["d40"] and s["d40ice"] > s["d40"] + 3, s
    assert r["deerMotorway"]


def test_duplicates_across_providers_count_once(r):
    d = r["dedupe"]
    assert d["signals"] == 2 and abs(d["crossing"] - 0.7) < 1e-6 and d["tunnel"] == 1.5, d


def test_time_windows_use_the_places_zone(r):
    assert r["tz"] is True and r["tzDenver"] is False


def test_small_terms_decide_near_ties_never_blowouts(r):
    """name_age, built_year, guardrail, cold road, school buses, phone signal and land-use-only scenery each turn a 1-point
    deficit (a minute at Fun) around, and none moves a route by more than 10 points on its own (6 km)."""
    for ch, x in r["nearTie"].items():
        assert x["flips"] and 1 < x["swing"] < 10, (ch, x)
