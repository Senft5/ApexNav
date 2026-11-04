// ApexRouteEngine — Vetta's route model: which way is worth driving (docs/ROUTE_ENGINE.md is the reference).
//
// Kurviger and Calimoto rank by curvature with road-class switches; REVER by community roads; the academic "pleasant
// routing" work (Quercia's happy maps, scenic routing on crowd photos, Zheng's road-network attractiveness) by a learned or
// crowd-voted edge attractiveness under a time budget. All of them treat the corners and the road as one number. A curvy
// subdivision is not a fun road, and a strip-mall arterial is not a quick one, so here each 25 m of a candidate gets two
// separate scores from every data source the route context (web/route_ctx) brought back:
//   quality  0–1  is this a road worth driving at all: speed limit, class and use, density, signals and stops, driveways,
//                 businesses, land use, night lights, impervious ground, addresses, traffic volume, surface …
//                 a weighted GEOMETRIC mean, so one damning signal (25 mph, a driveway every 30 m) pulls it down;
//   scenery  0–1  what it's like: forest and canopy, water and creeks, ridges and relief, photos, loved roads, byways …
// Corners only count where the road is worth driving (a quality gate on each corner), so twisty side streets are worth
// nothing; detours must buy real quality; side streets and business districts cost points per km, so the highway beats a
// neighbourhood cut-through. Time-dependent penalties (deer at dusk, school hours, events, fog, wind, floods, works)
// are read at the time you'd be there. Hard constraints (closures, private roads, a car that doesn't fit, fuel range) drop
// a candidate. Unknown never helps or hurts: a missing channel drops out of the means and lowers the confidence.
// With no context at all the value is exactly today's ApexFunRoute.rank value (tests/test_route_engine.py holds it).
(function (root) {
  'use strict';
  const FunRoute = root.ApexFunRoute || (typeof require === 'function' ? require('./fun_route.js') : null);
  const Ctx = root.ApexRouteCtx && root.ApexRouteCtx.corridor ? root.ApexRouteCtx : typeof require === 'function' ? require('./route_ctx/registry.js') : root.ApexRouteCtx || null;
  const Sun = () => root.ApexSun || null;
  // the time at the place you'd be (ctx_util.js localTime: the sample's own zone), not the phone's
  const Util = () => root.ApexRouteCtxUtil || (typeof require === 'function' ? (() => { try { return require('./route_ctx/ctx_util.js'); } catch (_) { return null; } })() : null);
  function local(ms, lat, lon) {
    const U = Util();
    if (U && U.localTime && Number.isFinite(lat) && Number.isFinite(lon)) { const t = U.localTime(ms, lat, lon); return { day: t.dow, min: Math.floor(t.hour * 60), month: t.m }; }
    const d = new Date(ms); return { day: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), month: d.getMonth() + 1 };
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  /** Piecewise-linear over [[x, y]] (x ascending), held flat past the ends. */
  const ramp = (pts) => (v) => {
    if (v <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (v <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (v - x0) / (x1 - x0); }
    return pts[pts.length - 1][1];
  };
  const decay = (k) => (v) => Math.exp(-Math.max(0, v) / k);
  const table = (t, dflt = null) => (v) => (t[Math.round(v)] != null ? t[Math.round(v)] : dflt);
  const yes = (good, bad) => (v) => (v >= 0.5 ? good : bad);

  // ---- the channels (every catalogue item; ROUTE_ENGINE.md lists them with units and providers) ----------------------
  const SPEED = ramp([[30, 0], [40, 0.03], [56, 0.35], [72, 0.7], [89, 0.95], [105, 1]]);   // km/h → goodness; never falls with speed
  /** Quality terms: channel, weight, goodness (0 worst … 1 best) of a value. `unless`: used only where those are unknown. */
  const QUALITY = [
    { ch: 'speed_limit_kph', w: 3, g: SPEED, family: 'speed' },
    { ch: 'speed_limit_est_kph', w: 1.2, g: SPEED, family: 'speed', unless: ['speed_limit_kph'] },        // a class estimate weighs less
    { ch: 'speed_kph', w: 0.8, g: SPEED, family: 'speed', unless: ['speed_limit_kph', 'speed_limit_est_kph'] },
    { ch: 'road_class', w: 2, g: table({ 0: 0.55, 1: 0.6, 2: 0.65, 3: 0.85, 4: 0.95, 5: 0.85, 6: 0.12, 7: 0.05 }), family: 'road' },
    { ch: 'road_use', w: 2, g: table({ 0: 1, 1: 0.6, 2: 0.7, 3: 0.3, 4: 0, 5: 0.03, 6: 0, 7: 0, 8: 0, 9: 0.05, 10: 0, 11: 0.08 }, 0.5), family: 'road' },
    { ch: 'density', w: 2, g: ramp([[2, 1], [6, 0.55], [11, 0.05], [15, 0]]), family: 'built' },
    { ch: 'signals_per_km', w: 2, g: decay(1.5), family: 'stops' },
    { ch: 'stops_per_km', w: 1.5, g: decay(1.5), family: 'stops' },
    { ch: 'crossings_per_km', w: 0.8, g: decay(2.5), family: 'stops' },
    { ch: 'access_per_km', w: 1.5, g: decay(25), family: 'access' },
    { ch: 'calming_per_km', w: 2, g: decay(0.7), family: 'stops' },
    { ch: 'lanes', w: 0.5, g: ramp([[2, 1], [3, 0.8], [4, 0.6], [6, 0.5]]), family: 'road' },
    { ch: 'divided', w: 0.4, g: yes(0.6, 1), family: 'road' },
    { ch: 'surface', w: 1, g: table({ 0: 1, 1: 1, 2: 0.7, 3: 0.4, 4: 0.15, 5: 0.2, 6: 0, 7: 0 }), family: 'surface' },
    { ch: 'sidewalk', w: 0.7, g: yes(0.3, 1), family: 'built' },
    { ch: 'truck_route', w: 0.4, g: yes(0.7, 1), family: 'road' },
    { ch: 'access_destination', w: 2, g: yes(0.1, 1), family: 'road' },
    { ch: 'business_per_km', w: 2.5, g: decay(6), family: 'business' },              // shops, amenities, offices; NOT fuel or cafés
    { ch: 'landuse_urban', w: 1.5, g: (v) => 1 - clamp01(v), family: 'business' },    // share commercial / retail / industrial
    { ch: 'landuse_residential', w: 1, g: (v) => 1 - 0.8 * clamp01(v), family: 'built' },
    { ch: 'bldg_per_km', w: 1, g: decay(40), family: 'built' },        // map tiles: buildings within 60 m
    { ch: 'night_lights', w: 0.6, g: ramp([[0.15, 1], [0.6, 0.4], [1, 0.3]]), family: 'built' },   // C: Black Marble 0-1, saturates in suburbs: dark vs lit
    { ch: 'impervious_pct', w: 1, g: ramp([[5, 1], [50, 0]]), family: 'built' },
    { ch: 'address_per_km', w: 1, g: decay(40), family: 'built' },
    { ch: 'address_density', w: 1, g: decay(500), family: 'built', unless: ['address_per_km'] },   // C: address points /km²
    { ch: 'housing_per_km2', w: 0.8, g: decay(300), family: 'built' },
    { ch: 'noise_db', w: 0.6, g: ramp([[50, 1], [70, 0]]), family: 'busy' },
    { ch: 'aadt', w: 1.5, g: (v) => 1 - clamp01(Math.log10(Math.max(1, v) / 1000) / Math.log10(25)), family: 'busy' },
    { ch: 'iri', w: 0.8, g: ramp([[60, 1], [200, 0]]), family: 'surface' },          // HPMS roughness, in/mi
    { ch: 'crowd_rough_g', w: 1, g: ramp([[0.05, 1], [0.38, 0]]), family: 'surface' },
    { ch: 'crowd_flow', w: 1, g: clamp01, family: 'crowd' },
  ];
  /** Scenery terms (arithmetic weighted mean: one nice thing is nice; nothing nice is neutral-low). */
  const SCENERY = [
    { ch: 'forest_share', w: 1.5, g: clamp01, family: 'forest' },
    { ch: 'canopy_pct', w: 1.2, g: ramp([[0, 0.15], [70, 1]]), family: 'forest' },
    { ch: 'water_near', w: 1, g: clamp01, family: 'water' },
    { ch: 'creek_follow', w: 1, g: yes(1, 0.35), family: 'water' },
    { ch: 'open_country', w: 0.6, g: (v) => 0.4 + 0.45 * clamp01(v), family: 'open' },
    { ch: 'protected', w: 1, g: yes(1, 0.4), family: 'park' },
    { ch: 'photo_score', w: 1, g: clamp01, family: 'photos', rural: true },   // D: Commons + Flickr; towns are photographed too
    { ch: 'curve_sign', w: 0.6, g: yes(1, 0.5), family: 'drama' },      // D: Mapillary curve-warning signs
    { ch: 'tpi_m', w: 0.8, g: (v) => ramp([[0, 0.25], [40, 1]])(Math.abs(v)), family: 'terrain' },   // a ridge or a valley, not a plain
    { ch: 'grade_pct', w: 0.6, g: (v) => ramp([[0, 0.3], [6, 1]])(Math.abs(v)), family: 'terrain' },   // climbs and descents
    { ch: 'relief_m', w: 1, g: ramp([[10, 0.1], [150, 1]]), family: 'terrain' },
    { ch: 'foliage', w: 0.8, g: clamp01, family: 'forest' },    // D: autumn colour near its peak, already × canopy
    { ch: 'loved', w: 1.5, g: clamp01, family: 'crowd' },
    { ch: 'guardrail', w: 0.6, g: yes(0.9, 0.5), family: 'drama' },
    { ch: 'crowd_camber_deg', w: 0.5, g: ramp([[-3, 0], [0, 0.5], [4, 1]]), family: 'crowd' },
    { ch: 'name_age', w: 0.5, g: (v) => 0.5 + 0.5 * Math.max(-1, Math.min(1, v)), family: 'history' },   // a weak prior from the name
    { ch: 'built_year', w: 0.6, g: ramp([[1900, 1], [1960, 0.6], [2000, 0.2]]), family: 'history' },   // county parcels: an old road's houses
  ];
  /** Per-sample penalty channels: points per km at full strength, `at` = how strong at that time (0–1). */
  const PER_KM = [
    { ch: 'deer_risk', perKm: 1.5, label: 'deer', value: (v) => clamp01((v - 1) / 3), at: (ctx) => ctx.deerHour, timedBy: 'deer_time_risk', motorway: 0.25 },   // fenced, wide verges   // D: a rate, 1 = the state's average hour
    { ch: 'fog_vis_m', perKm: 1.2, label: 'fog', value: (v) => clamp01(1 - v / 1000), valley: true, skipIf: 'fog_risk' },   // worse in the valleys, lighter on ridges
    { ch: 'fog_risk', perKm: 1.2, label: 'fog', value: clamp01 },                                  // D: 0-1, valleys and ridges already in it
    { ch: 'crosswind_ms', perKm: 0.6, label: 'crosswind', value: (v) => clamp01((v - 8) / 10), exposed: true },   // D's crosswind_mps, × its exposure
    { ch: 'road_temp_c', perKm: 0.6, label: 'cold road', value: (v) => clamp01((7 - v) / 10) },
    { ch: 'crash_density', perKm: 0.6, label: 'fatal crashes', value: (v) => clamp01(v / 0.1), perVehicle: true },   // C: FARS fatal /km/yr
    { ch: 'cyclist_route', perKm: 0.5, label: 'cyclists', value: clamp01, at: (ctx) => ctx.weekendMorning, atCh: 'cyclist_time', pref: 'cyclists' },   // Cyclist courtesy (driver.js)
    { ch: 'buggy', perKm: 0.8, label: 'buggies', value: clamp01 },
    { ch: 'unlit', perKm: 0.6, label: 'unlit at night', value: clamp01, at: (ctx) => ctx.dark, atCh: 'dark', pref: 'lit' },             // Lit roads at night (driver.js)
    { ch: 'crowd_busy', perKm: 0.6, label: 'busy at that hour', value: (v) => clamp01(v - 1) },      // crowd.js: 1 = the road's average hour, 2 = twice (quiet_hours flag, off)
    { ch: 'park_visitors', perKm: 0.5, label: 'park crowds', value: clamp01, at: (ctx) => ctx.weekendDay },
    { ch: 'signal_coverage', perKm: 0.4, label: 'no phone signal', value: (v) => 1 - clamp01(v) },
    { ch: 'event_crowd', perKm: 2, label: 'event traffic', value: (v) => clamp01(v / 20) },        // D: thousands of people heading there then
    { ch: 'school_zone', perKm: 3, label: 'school zone', value: clamp01 },                         // D: at arrival and dismissal on school days
    { ch: 'school_bus_hour', perKm: 0.8, label: 'school buses', value: clamp01, rural: true },     // D: bus-run hours, on country roads
    { ch: 'church_window', perKm: 1, label: 'church traffic', value: clamp01 },                    // D: service windows by a church
    { ch: 'harvest_traffic', perKm: 0.5, label: 'farm traffic', value: clamp01, crop: true },       // D × C's crop at that place
    { ch: 'flood_zone', perKm: 2, label: 'flood-prone', value: (v) => clamp01((v - 1) / 2), wet: true },   // C: only when D says it's wet
    { ch: 'passenger_cost', perKm: 1.5, label: 'hard on your passenger', value: clamp01, pref: 'passenger' },   // driver.js, Passenger aboard
    { ch: 'fuel_margin', perKm: 0.5, label: 'low on fuel', value: (v) => clamp01((0.25 - v) / 0.25) },          // car.js: the last quarter of the safe range
  ];
  // Spans and points: points each (+ per km), the default time they apply when the provider gives none, hard = no go.
  const DAY_MS = 864e5;
  const SPANS = {
    closure: { hard: true, label: 'closed' },
    no_access: { hard: true, label: 'private road' },
    flood: { hard: (s) => (s.value == null || s.value >= 1), each: 5, label: 'flooding' },        // value < 1: risk, ≥ 1 water over the road
    school: { each: 2, perKm: 1, label: 'school zone', unlessChannel: 'school_zone', when: { weekly: [{ days: [1, 2, 3, 4, 5], from: '07:00', to: '08:45' }, { days: [1, 2, 3, 4, 5], from: '14:00', to: '16:15' }], months: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12] } },
    church: { each: 1, label: 'church traffic', unlessChannel: 'church_window', when: { weekly: [{ days: [0], from: '08:00', to: '12:30' }] } },
    event: { each: 6, label: 'event traffic', unlessChannel: 'event_crowd' },
    works: { each: 4, perMinValue: true, label: 'road works' },                    // value: delay in minutes when known
    harvest: { perKm: 0.5, label: 'farm traffic', unlessChannel: 'harvest_traffic', when: { months: [9, 10, 11], weekly: [{ from: '07:00', to: '20:00' }] } },
    byway: { bonusPerKm: 0.4, bonusCap: 12, label: 'scenic byway' },
    level_crossing: { each: 0.7, label: 'level crossings' },
    one_lane_bridge: { each: 0.5, label: 'one-lane bridges' },
    animal_crossing: { each: 0.3, dusk: 3, label: 'deer crossings' },
    speed_bump: { each: 0.5, label: 'speed bumps', unlessChannel: 'calming_per_km' },
    stop: { each: 0.4, label: 'stop signs', unlessChannel: 'stops_per_km' },
    viewpoint: { bonus: 1.5, bonusCap: 6, label: 'viewpoints' },
    covered_bridge: { bonus: 2, bonusCap: 4, label: 'a covered bridge' },
    historic: { bonus: 0.5, bonusCap: 3, label: 'history' },
    tunnel: { bonus: 1.5, bonusCap: 4.5, pref: 'tunnels', label: 'tunnels' },
    resurfaced: { bonusPerKm: 0.3, bonusCap: 3, label: 'fresh asphalt' },
    fuel_gap: { hard: true, label: 'longer than your range without fuel' },        // car.js
    past_next_event: { each: 0, perMinValue: true, label: 'past your next event' },  // ios_context.js: value = minutes late
    gate: { each: 1, label: 'gates' },
    ice: { perKm: 3, label: 'ice' },                                               // conditions.js: frost on the road at that hour
    buggy: { each: 0.5, label: 'buggies', unlessChannel: 'buggy' },
    curve_sign: { bonus: 0.2, bonusCap: 2, label: 'curve signs', unlessChannel: ['curve_signs_per_km', 'curve_sign'] },
    access_destination: { each: 1, perKm: 2, label: 'destination-only road', unlessChannel: 'access_destination' },
    cycle_route: { perKm: 0.5, label: 'cyclists', unlessChannel: 'cyclist_route', when: { weekly: [{ days: [0, 6], from: '07:00', to: '11:00' }] } },                     // counted on the card; avoided by the router when asked (Avoid → Cameras), never ranked
  };
  // Channel names other builders may use for the same thing (the integrator's safety net; ROUTE_ENGINE.md is canonical).
  // Span and point kinds other providers name differently (osm_tiles.js, osm_overpass.js).
  const KIND_ALIASES = { worship: 'church', rail_crossing: 'level_crossing', give_way: 'stop', calming: 'speed_bump', access_private: 'no_access', old_road_name: null, subdivision_name: null,
    // D's kinds (hyphenated): the channels carry fog, glare, dark, deer hours, school zones and photos; these are said, not ranked twice
    'deer-crossing': 'animal_crossing', 'curve-sign': 'curve_sign', 'farm-traffic': 'harvest', 'low-water': 'flood', paving: 'resurfaced',
    'park-season': null, nps_unit: null, 'school-zone': null, 'deer-hour': null, 'golden-view': null, glare: null, dark: null, 'cold-tyres': null,
    'fall-colour': null, 'photo-spot': null, 'speed-sign': null, gauge: null, venue: null, fatal_crash: null };
  const ALIASES = { crowd_bank_deg: 'crowd_camber_deg', signal: 'signal_coverage', businesses_per_km: 'business_per_km', maxspeed_kph: 'speed_limit_kph', viirs: 'night_light', canopy: 'canopy_pct',
    impervious: 'impervious_pct', addresses_per_km: 'address_per_km', photos_per_km: 'photo_per_km', forest: 'forest_share', deer: 'deer_risk' };

  // ---- weights of the route value (points, the 0–100 fun scale) -----------------------------------------------------
  const W = {
    QUALITY: 0.3,          // points per quality point (0–100) above or below 50, times the share of the route known
    // side streets and business districts; no grace at the ends: every candidate starts in the same street, so the shared
    // start costs them all the same, while a plan that drives 2 km of strip mall out of town pays for it (live, Northgate)
    POOR_Q_HI: 0.45, POOR_Q_LO: 0.25, POOR_PER_KM: 10, POOR_CAP: 120, END_GRACE_M: 0,
    BUSINESS_PER_KM: 4, BUSINESS_FROM: 4, BUSINESS_FULL: 14, BUSINESS_CAP: 40,   // the owner: more businesses = a worse road
    SCENERY: 20,           // points for scenery 1 vs 0.5 (so ±10), times how much of it is known
    Q_FULL_CONF: 0.3, S_FULL_CONF: 0.2,            // the share of the weights known at which a sample's quality / scenery counts in full
    STAGE_UNKNOWN_GATE: 0.4,                        // a stage's samples with no road data: trusted this much
    GATE_LO: 0.25, GATE_HI: 0.6,                    // a corner on quality ≤ 0.25 counts nothing, ≥ 0.6 in full
    PENALTY_CAP: 40, BONUS_CAP: 15,
    DRIVER: 6,             // points for a route that fits the driver (driver_fit 1) vs one that doesn't (-1): ±6
    LOG_FLOOR: 0.05,
    SPEED_FLOOR: 0.7, ACCESS_FLOOR: 0.75,           // a low limit / driveways in open country: at most this damning
    KIND_CAP: 12,          // the most one kind of penalty costs (deer alone can't fill the total)
  };
  // The families one bad signal of which damns a road (the soft minimum in samples()), and the router density at or under
  // which a "residential" road with no sidewalk is taken for a country lane.
  const DAMNING = new Set(['speed', 'road', 'stops', 'access', 'business']);
  const RURAL_DENSITY = 2;
  const gate = (q) => (finite(q) ? clamp01((q - W.GATE_LO) / (W.GATE_HI - W.GATE_LO)) : 1);

  // ---- time of day --------------------------------------------------------------------------------------------------
  const minutesOf = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  /** Is a `when` ({ windows: [[startMs, endMs]], weekly: [{ days?, from, to }], months? (1–12) }) on at epoch ms? None = always. */
  function active(when, ms, lat, lon) {
    if (!when) return true;
    if (Array.isArray(when.windows) && when.windows.length && !when.windows.some(([a, b]) => ms >= a && ms < b)) return false;
    const t = local(ms, lat, lon);
    if (Array.isArray(when.months) && !when.months.includes(t.month)) return false;
    if (Array.isArray(when.weekly) && when.weekly.length) {
      const day = t.day, min = t.min;
      return when.weekly.some((w) => {
        if (Array.isArray(w.days) && !w.days.includes(day)) return false;
        const a = minutesOf(w.from), b = minutesOf(w.to);
        if (a == null || b == null) return true;
        return a <= b ? min >= a && min < b : min >= a || min < b;      // 19:00–07:00 wraps midnight
      });
    }
    return true;
  }
  /** What time-dependent terms need at one sample: deer hour (sun −10°…+8°), dark (sun under −6°), weekend morning, golden light. */
  function moment(ms, lat, lon) {
    const d = new Date(ms), t = local(ms, lat, lon), day = t.day, h = t.min / 60;
    const out = { weekendMorning: (day === 0 || day === 6) && h >= 7 && h < 11 ? 1 : 0, weekendDay: (day === 0 || day === 6) && h >= 9 && h < 18 ? 1 : 0, deerHour: null, dark: null, sun: null };
    const S = Sun();
    if (S && S.sunPosition) {
      const p = S.sunPosition(d, lat, lon), alt = p.altitude * 180 / Math.PI;
      out.sun = p; out.deerHour = alt >= -10 && alt <= 8 ? 1 : alt < -10 ? 0.35 : 0.1; out.dark = alt < -6 ? 1 : 0;
    }
    return out;
  }

  // ---- per-sample model ---------------------------------------------------------------------------------------------
  /** A context's channel by canonical name (aliases accepted). */
  // Other providers' channels that fill a canonical one where it is unknown (first known wins, in this order after the
  // canonical name itself): the OSM map-feature providers' names (osm_tiles.js, osm_overpass.js) mapped to the model's.
  // Land-use shares count only where the map has land use at all (lu_mapped ≥ 0.3): unmapped is unknown, not "no shops".
  const LU = (names) => (ch, i) => (ch.lu_mapped && !(ch.lu_mapped[i] >= 0.3) ? NaN : names.reduce((a, k) => (ch[k] && Number.isFinite(ch[k][i]) ? (Number.isNaN(a) ? 0 : a) + ch[k][i] : a), NaN));
  const SUM = (names) => (ch, i) => (names.every((k) => ch[k] && Number.isFinite(ch[k][i])) ? names.reduce((a, k) => a + ch[k][i], 0) : NaN);
  const MAP = (k, f) => (ch, i) => (ch[k] && Number.isFinite(ch[k][i]) ? f(ch[k][i]) : NaN);
  const SOURCES = {
    // the speed-limit chain: router → OSM → Mapillary signs (D) → HPMS (C, mph); all measured, ahead of the class estimate
    speed_limit_kph: [MAP('maxspeed_kph', (v) => v), MAP('sign_maxspeed_mps', (v) => v * 3.6), MAP('hpms_speed_limit', (v) => v * 1.609344)],
    lanes: [MAP('hpms_lanes', (v) => Math.ceil(v / 2))],                                          // HPMS counts both directions
    road_class: [MAP('hpms_fclass', (v) => ({ 1: 0, 2: 0, 3: 2, 4: 3, 5: 4, 6: 4, 7: 6 }[v] ?? NaN))],
    fog_vis_m: [MAP('visibility_m', (v) => v)],
    crosswind_ms: [MAP('crosswind_mps', (v) => v)],
    housing_per_km2: [MAP('housing_density', (v) => v), MAP('population_density', (v) => v / 2.5)],
    built_year: [MAP('median_year_built', (v) => v)],
    signal_coverage: [MAP('mobile_coverage', (v) => (v >= 1 ? 1 : 0))],
    park_visitors: [MAP('park_busy', (v) => clamp01(v - 1)), MAP('park_visits', (v) => (v >= 1e6 ? 1 : v >= 1e5 ? 0.5 : v > 0 ? 0.2 : 0))],
    dark: [MAP('light', (v) => (v === 0 ? 1 : 0))],
    business_per_km: [MAP('biz_per_km', (v) => v)],
    address_per_km: [MAP('addr_per_km', (v) => v)],
    access_per_km: [SUM(['side_roads_per_km', 'driveway_joins_per_km'])],
    landuse_residential: [LU(['lu_residential'])],
    landuse_urban: [(ch, i) => Math.min(1, LU(['lu_commercial', 'lu_retail', 'lu_industrial'])(ch, i))],
    forest_share: [LU(['lu_forest'])],
    open_country: [(ch, i) => Math.min(1, LU(['lu_farmland', 'lu_open'])(ch, i))],
    protected: [LU(['lu_park'])],
    bridge: [MAP('on_bridge', (v) => v)],
    tunnel: [MAP('in_tunnel', (v) => v)],
    surface: [MAP('smoothness', (v) => (v <= 1 ? 0 : v === 2 ? 1 : v === 3 ? 2 : v === 4 ? 3 : v === 5 ? 4 : 7)), MAP('surface_paved', (v) => (v >= 0.5 ? 1 : 5)), MAP('unpaved', (v) => (v >= 0.5 ? 5 : 1))],
    truck_route: [MAP('hgv', (v) => (v >= 2 ? 1 : 0))],
    access_destination: [MAP('access_level', (v) => (v >= 1 ? 1 : 0))],
    guardrail: [MAP('guard_rail', (v) => v)],
    cyclist_route: [MAP('cycle_route', (v) => (v > 0 ? 1 : 0))],
    unlit: [(ch, i) => (ch.dark && ch.lit && Number.isFinite(ch.dark[i]) && Number.isFinite(ch.lit[i]) ? (ch.dark[i] >= 0.5 && ch.lit[i] < 0.5 ? 1 : 0) : NaN), MAP('lit', (v) => (v >= 0.5 ? 0 : 1)),
      MAP('night_lights', (v) => (v < 0.15 ? 1 : 0))],                                           // C: dark country vs lit
  };
  /** A context's channel by canonical name: its own values, gaps filled from the aliases and other providers' names. */
  function channel(ctx, name) {
    if (!ctx || !ctx.channels) return null;
    const cache = ctx.__canon || (Object.defineProperty(ctx, '__canon', { value: new Map(), enumerable: false }), ctx.__canon);
    if (cache.has(name)) return cache.get(name);
    const ch = ctx.channels, own = ch[name] || null;
    const fills = [...Object.entries(ALIASES).filter(([, b]) => b === name).map(([a]) => MAP(a, (v) => v)), ...(SOURCES[name] || [])];
    const any = Object.values(ch)[0];
    let out = own;
    if (fills.length && any) {
      const n = any.length, arr = own ? Float32Array.from(own) : new Float32Array(n).fill(NaN);
      let used = false;
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(arr[i])) continue;
        for (const f of fills) { const v = f(ch, i); if (Number.isFinite(v)) { arr[i] = v; used = true; break; } }
      }
      if (used || own) out = arr;
    }
    cache.set(name, out);
    return out;
  }
  /**
   * How built-up a sample is, 0 open country … 1 town, from whatever says so (router density, sidewalks, a residential or
   * service road, businesses, housing, impervious ground, addresses, buildings, residential or urban land use); the most
   * built signal wins. null where none of them is known (then a low limit stays as damning as it reads).
   */
  function builtEvidence(ctx) {
    const f = [['density', (v) => clamp01((v - 2) / 5)], ['sidewalk', (v) => (v >= 0.5 ? 1 : 0)], ['road_class', (v) => (v >= 6 ? 0.8 : 0)],
      ['road_use', (v) => ([4, 5, 6, 8, 9, 10, 11].includes(Math.round(v)) ? 1 : 0)], ['business_per_km', (v) => clamp01(v / 8)],
      ['housing_per_km2', (v) => clamp01(v / 500)], ['impervious_pct', (v) => clamp01((v - 8) / 25)], ['address_per_km', (v) => clamp01(v / 50)],
      ['address_density', (v) => clamp01(v / 600)], ['buildings_per_ha', (v) => clamp01(v / 4)], ['bldg_per_km', (v) => clamp01(v / 50)],
      ['landuse_residential', (v) => clamp01(v / 0.6)], ['landuse_urban', (v) => clamp01(v / 0.4)]]
      .map(([k, fn]) => [channel(ctx, k), fn, k]).filter(([v]) => v);
    const dens = channel(ctx, 'density');
    return (i) => {
      let b = null;
      for (const [v, fn, k] of f) {
        if (!Number.isFinite(v[i])) continue;
        // a "residential" class in open country is the TIGER county road (samples() reads it as a lane): not built
        const x = k === 'road_class' && v[i] === 6 && dens && dens[i] <= RURAL_DENSITY ? 0 : fn(v[i]);
        b = b == null ? x : Math.max(b, x);
      }
      return b;
    };
  }
  /**
   * Per-sample quality, scenery and their confidences (share of the possible weight that was known) for a corridor's
   * context. Pure. { n, quality, qConf, scenery, sConf, terms: { [channel]: known share } }.
   */
  function samples(c, ctx) {
    const n = c.distM.length;
    const quality = new Float32Array(n).fill(NaN), scenery = new Float32Array(n).fill(NaN), qConf = new Float32Array(n), sConf = new Float32Array(n);
    const qTotal = QUALITY.filter((t) => !t.unless).reduce((s, t) => s + t.w, 0), sTotal = SCENERY.reduce((s, t) => s + t.w, 0);
    const qs = QUALITY.map((t) => ({ t, v: channel(ctx, t.ch), u: (t.unless || []).map((u) => channel(ctx, u)) })).filter((x) => x.v);
    // A motorway or its ramps has no frontage: the shops, houses and lights beside it don't stop you (a trunk road can have them).
    const rcCh = channel(ctx, 'road_class'), useCh = channel(ctx, 'road_use');
    const limited = (i) => (rcCh && rcCh[i] === 0) || (useCh && useCh[i] === 1);
    const ss = SCENERY.map((t) => ({ t, v: channel(ctx, t.ch), need: t.needs ? channel(ctx, t.needs) : null }))
      .filter((x) => x.v && (!x.t.needs || x.need) && !(x.t.unless || []).some((u) => channel(ctx, u)));
    const terms = {};
    for (const x of [...qs, ...ss]) { let k = 0; for (let i = 0; i < n; i++) if (Number.isFinite(x.v[i])) k++; terms[x.t.ch] = k / n; }
    const dens = channel(ctx, 'density'), walk = channel(ctx, 'sidewalk');
    const builtAt = builtEvidence(ctx);
    for (let i = 0; i < n; i++) {
      let lw = 0, sw = 0;
      const fam = {}, built = builtAt(i);
      for (const x of qs) {
        let v = x.v[i];
        if (!Number.isFinite(v) || x.u.some((u) => u && Number.isFinite(u[i]))) continue;
        // a motorway carries its traffic by design: its volume, noise and trucks say nothing against it (live traffic still does)
        if ((x.t.family === 'built' || x.t.family === 'business' || (x.t.family === 'busy' && x.t.ch !== 'traffic_ratio')) && limited(i)) continue;
        // a "residential" road in open country with no sidewalk is a country lane (US TIGER imports tag county roads so)
        if (x.t.ch === 'road_class' && v === 6 && dens && dens[i] <= RURAL_DENSITY && !(walk && walk[i] >= 0.5)) v = 5;
        let g = x.t.g(v);
        if (!finite(g)) continue;
        // a 30 mph limit or driveways every 50 m on a twisty country road (no houses, shops, sidewalks or density around) is
        // the road's character, not a town: the floor holds unless the built signals agree (built evidence, below)
        if (x.t.family === 'speed' && built != null) g = Math.max(g, W.SPEED_FLOOR * (1 - built));
        if (x.t.family === 'access' && built != null) g = Math.max(g, W.ACCESS_FLOOR * (1 - built));
        const lg = Math.log(Math.max(W.LOG_FLOOR, g));
        lw += x.t.w * lg; sw += x.t.w;
        if (DAMNING.has(x.t.family)) { const f = fam[x.t.family] || (fam[x.t.family] = [0, 0]); f[0] += x.t.w * lg; f[1] += x.t.w; }
      }
      if (sw > 0) {
        // the weighted geometric mean, times the square root of the worst damning family: plenty of absent signals
        // and stop signs can't make a 25 mph side street, a driveway every 30 m or a row of shops a good road
        let worst = 1;
        for (const [a, b] of Object.values(fam)) worst = Math.min(worst, Math.exp(a / b));
        quality[i] = Math.exp(lw / sw) * Math.sqrt(worst); qConf[i] = Math.min(1, sw / qTotal);
      }
      let a = 0, b = 0;
      for (const x of ss) {
        const v = x.v[i];
        if (x.t.rural && dens && dens[i] >= 4) continue;                // photos in town are of the town
        if (!Number.isFinite(v) || (x.need && !Number.isFinite(x.need[i]))) continue;
        const g = x.t.g(v) * (x.need ? clamp01(x.need[i] / 70) : 1);
        if (!finite(g)) continue;
        a += x.t.w * g; b += x.t.w;
      }
      if (b > 0) { scenery[i] = a / b; sConf[i] = Math.min(1, b / sTotal); }
    }
    return { n, quality, qConf, scenery, sConf, terms };
  }

  // ---- one candidate ------------------------------------------------------------------------------------------------
  /** Index of the corridor sample at `m` metres. */
  const at = (c, m) => Math.max(0, Math.min(c.distM.length - 1, Math.round(m / ((Ctx && Ctx.STEP_M) || 25))));
  const kmh2mph = (v) => v / 1.609344;
  function median(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; }
  function quantile(xs, q) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

  /**
   * Everything the model knows about one candidate { t (5 m geometry), corridor, ctx, fun?, timeS, route } at the level's
   * prefs. `opts.score(cand, scaleAt)` re-scores its corners with a per-metre multiplier (the cockpit's funOf with the
   * router's junction turns); without it ApexFunRoute.score on cand.t. Returns the evaluation (also kept as cand.ev).
   */
  function evaluate(cand, opts = {}) {
    const c = cand.corridor, ctx = cand.ctx || null, prefs = opts.prefs || {};
    const out = { quality: null, qCoverage: 0, poorKm: 0, poorCost: 0, scenery: null, sCoverage: 0, sceneryPts: 0, bonusPts: 0, bonuses: [],
      penalties: [], penaltyPts: 0, hard: [], confidence: 0, fun: cand.fun || null, stats: {} };
    if (!c || !ctx) { cand.ev = out; return out; }
    const s = samples(c, ctx), n = s.n, step = c.distM.length > 1 ? c.distM[1] - c.distM[0] : 25, total = c.totalM || c.distM[n - 1];
    // quality: length-weighted mean of the known samples, and the side-street / business-district km
    let qs = 0, qn = 0, qw = 0, poorM = 0, poorCost = 0, ss = 0, sn = 0, sp = 0, conf = 0, bizCost = 0, bizM = 0;
    const bizC = channel(ctx, 'business_per_km'), rcQ = channel(ctx, 'road_class'), useQ = channel(ctx, 'road_use');
    const limitedQ = (i) => (rcQ && rcQ[i] === 0) || (useQ && useQ[i] === 1);
    const poorBy = { business: 0, residential: 0, stops: 0, other: 0 };
    const rc = channel(ctx, 'road_class'), use = channel(ctx, 'road_use'), biz = channel(ctx, 'business_per_km'), sig = channel(ctx, 'signals_per_km');
    for (let i = 0; i < n; i++) {
      const q = s.quality[i];
      conf += (s.qConf[i] * 2 + s.sConf[i]) / 3;
      if (Number.isFinite(q)) { qs += q; qn++; qw += Math.min(1, s.qConf[i] / W.Q_FULL_CONF); }
      if (Number.isFinite(s.scenery[i])) { ss += s.scenery[i]; sn++; sp += (s.scenery[i] - 0.5) * Math.min(1, s.sConf[i] / W.S_FULL_CONF); }
      // business districts cost on their own (the owner, 2026-11-03: "more businesses = worse route generally"): shops,
      // restaurants and offices beside the road (not fuel or cafés), never beside a motorway
      if (bizC && Number.isFinite(bizC[i]) && !limitedQ(i)) { const b = clamp01((bizC[i] - W.BUSINESS_FROM) / (W.BUSINESS_FULL - W.BUSINESS_FROM)); if (b > 0) { bizCost += b * step / 1000 * W.BUSINESS_PER_KM; bizM += b * step; } }
      if (!Number.isFinite(q) || c.distM[i] < W.END_GRACE_M || total - c.distM[i] < W.END_GRACE_M) continue;
      const bad = clamp01((W.POOR_Q_HI - q) / (W.POOR_Q_HI - W.POOR_Q_LO));
      if (bad > 0) {
        poorM += step; poorCost += bad * step / 1000 * W.POOR_PER_KM;
        const why = biz && biz[i] >= 4 ? 'business' : (rc && rc[i] >= 6) || (use && use[i] >= 4 && use[i] !== 1) ? 'residential' : sig && sig[i] >= 1.5 ? 'stops' : 'other';
        poorBy[why] += step;
      }
    }
    out.quality = qn ? Math.round(qs / qn * 1000) / 10 : null;
    out.qCoverage = qn / n;
    out.qWeight = qw / n;           // how much the quality term counts: the share known, at full weight once a third of the weights is
    out.poorKm = poorM / 1000; out.poorBy = Object.fromEntries(Object.entries(poorBy).map(([k, v]) => [k, v / 1000]));
    out.poorCost = Math.min(W.POOR_CAP, poorCost);
    out.businessCost = Math.min(W.BUSINESS_CAP, bizCost); out.businessKm = bizM / 1000;
    out.scenery = sn ? ss / sn : null; out.sCoverage = sn / n;
    out.sceneryPts = sn ? W.SCENERY * sp / n : 0;       // terrain alone (a fifth of the weights) moves it a little; the full picture ±10
    out.confidence = conf / n;
    out.samples = s;
    // corners worth driving: each corner's weight times the quality gate where it is
    let gs = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(s.quality[i])) gs += gate(s.quality[i]);
    out.meanGate = qn ? gs / qn : null; out.knownKm = qn * step / 1000; out.km = total / 1000;
    out.poorPerKnownKm = qn ? out.poorCost / Math.max(0.1, Math.min(out.km, qn * step / 1000) - 2 * W.END_GRACE_M / 1000) : null;   // per km the cost could apply to
    // unknown samples take the pool's mean gate when rank() knows it (opts.unknownGate), else count in full as before
    const ug = finite(opts.unknownGate) ? opts.unknownGate : 1;
    const scaleAt = qn || finite(opts.unknownGate) ? (m) => { const q = s.quality[at(c, m)]; return Number.isFinite(q) ? gate(q) : ug; } : null;
    if (scaleAt && (cand.t || opts.score)) {
      const f = opts.score ? opts.score(cand, scaleAt) : FunRoute.score(cand.t, cand.turnsM || [], prefs, scaleAt);
      out.funGated = f || null;
    } else out.funGated = cand.fun || null;
    // time-dependent penalties per km, spans and points at the time you'd be there
    const moments = [], every = 10;
    for (let i = 0; i < n; i += every) moments.push(moment(c.etaAt[i], c.lat[i], c.lon[i]));
    const mom = (i) => moments[Math.min(moments.length - 1, Math.floor(i / every))];
    const pen = new Map(), addPen = (label, pts, km = 0) => { const p = pen.get(label) || { label, points: 0, km: 0 }; p.points += pts; p.km += km; pen.set(label, p); };
    const exposed = (i) => { const b = channel(ctx, 'bridge'), t = channel(ctx, 'tpi_m'); return (b && b[i] >= 0.5) || (t && t[i] >= 20); };
    const tpiCh = channel(ctx, 'tpi_m'), valleyFactor = (i) => (!tpiCh || !Number.isFinite(tpiCh[i]) ? 1 : tpiCh[i] <= -10 ? 1.5 : tpiCh[i] >= 20 ? 0.5 : 1);
    const expoCh = channel(ctx, 'exposure'), densCh = channel(ctx, 'density'), cropCh = channel(ctx, 'cropland_class'), aadtCh = channel(ctx, 'aadt');
    const rcC = channel(ctx, 'road_class'), useC = channel(ctx, 'road_use'), limited = (i) => (rcC && rcC[i] === 0) || (useC && useC[i] === 1);
    const rainCh = channel(ctx, 'precip_48h_mm'), floodCh = channel(ctx, 'flood_risk');
    const CropGroup = root.ApexContextGrid && root.ApexContextGrid.cropGroup;
    const cropFactor = (i) => (!cropCh || !Number.isFinite(cropCh[i]) || !CropGroup ? 1 : ['crops', 'hay'].includes(CropGroup(cropCh[i])) ? 1 : 0.2);
    const wet = (i) => ((rainCh && rainCh[i] >= 25) || (floodCh && floodCh[i] >= 0.5) ? 1 : 0);
    for (const term of PER_KM) {
      const v = channel(ctx, term.ch), atCh = term.atCh ? channel(ctx, term.atCh) : null;
      if (!v || (term.pref && !prefs[term.pref]) || (term.skipIf && channel(ctx, term.skipIf))) continue;
      const timed = term.timedBy && channel(ctx, term.timedBy);   // the provider already put the time of day in the value
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(v[i])) continue;
        const when = timed ? 1 : atCh && Number.isFinite(atCh[i]) ? atCh[i] : term.at ? (term.at(mom(i)) ?? 0) : 1;
        const place = (term.rural ? (densCh && densCh[i] >= 4 ? 0 : 1) : 1) * (term.crop ? cropFactor(i) : 1) * (term.wet ? wet(i) : 1) * (term.motorway && limited(i) ? term.motorway : 1);
        if (term.perVehicle) {
          // crashes per km follow traffic: with the road's AADT, the rate per 100 million vehicle-km against the US fatal rate
          // (~0.8 per 100 M vehicle-km); without it, a busy road's count says nothing (motorways) and a quiet road's counts as is
          const a = aadtCh && Number.isFinite(aadtCh[i]) && aadtCh[i] > 0 ? aadtCh[i] : null;
          if (a) { const rate = v[i] / (a * 365) * 1e8; const sx = clamp01((rate - 0.8) / 2.4) * place; if (sx > 0) addPen(term.label, sx * term.perKm * step / 1000, sx * step / 1000); continue; }
          if (limited(i)) continue;
        }
        const exp = term.exposed ? (expoCh && Number.isFinite(expoCh[i]) ? expoCh[i] : exposed(i) ? 1 : 0) : 1;
        const strength = (term.value ? term.value(v[i]) : clamp01(v[i])) * when * place * exp * (term.valley ? valleyFactor(i) : 1);
        if (strength > 0) addPen(term.label, strength * term.perKm * step / 1000, strength * step / 1000);
      }
    }
    // golden light: west-facing ground with the sun low in the west at the time (a view, not glare; glare is costed apart)
    const west = channel(ctx, 'west_descent'), aspect = channel(ctx, 'aspect_rad'), gview = channel(ctx, 'golden_view');
    if (gview) {                                                       // D's golden_view: a descent toward the low sun, never the glare cone
      let km = 0;
      for (let i = 0; i < n; i++) if (gview[i] >= 0.5) km += step / 1000;
      if (km >= 0.5) out.bonuses.push({ label: 'golden light', points: Math.min(4, 0.5 * km), km });
    } else if (aspect) {
      let km = 0;
      for (let i = 0; i < n; i++) {
        const m = mom(i), p = m.sun;
        if (!p || !Number.isFinite(aspect[i])) continue;
        const alt = p.altitude * 180 / Math.PI, off = Math.abs(Math.atan2(Math.sin(aspect[i] - p.azimuth), Math.cos(aspect[i] - p.azimuth)));
        if (alt > 0 && alt < 12 && off < Math.PI / 3 && (!west || west[i] >= 0.5 || p.azimuth > Math.PI)) km += step / 1000;
      }
      if (km >= 0.5) out.bonuses.push({ label: 'golden light', points: Math.min(4, 0.5 * km), km });
    }
    const counted = {};
    const spanKm = (sp) => Math.max(0, (sp.toM - sp.fromM) / 1000);
    for (const sp of features(ctx)) {
      const kind = sp.kind, rule = kind && SPANS[kind];
      if (!rule) continue;
      if (rule.unlessChannel && [].concat(rule.unlessChannel).some((u) => channel(ctx, u))) continue;
      if (rule.pref && !prefs[rule.pref]) continue;
      const i = at(c, sp.fromM), when = sp.when || rule.when || null;
      if (!active(when, c.etaAt[i], c.lat[i], c.lon[i])) continue;
      const hard = sp.hard === true || (typeof rule.hard === 'function' ? rule.hard(sp) : rule.hard);
      if (hard) { out.hard.push({ kind, label: sp.label || rule.label, atM: sp.fromM }); continue; }
      if (!rule.each && !rule.perKm && !rule.bonus && !rule.bonusPerKm && !rule.perMinValue) continue;   // known, shown elsewhere, not ranked
      if (rule.bonus || rule.bonusPerKm) {
        const pts = rule.bonus || rule.bonusPerKm * spanKm(sp);
        counted[kind] = Math.min(rule.bonusCap || Infinity, (counted[kind] || 0) + pts);
        continue;
      }
      let pts = (rule.each || 0) + (rule.perKm || 0) * spanKm(sp);
      if (rule.perMinValue && finite(sp.value)) pts += (opts.perMin || 1) * Math.max(0, sp.value);
      if (rule.dusk && mom(i).deerHour === 1) pts *= rule.dusk;
      addPen(rule.label, pts, spanKm(sp));
    }
    for (const [kind, pts] of Object.entries(counted)) if (pts > 0) out.bonuses.push({ label: SPANS[kind].label, points: pts });
    // the car: width, height and weight limits, unpaved for a low car, and fuel range between stations
    const car = c.car || opts.car || null;
    if (car) {
      const lim = [['maxwidth_m', finite(car.width_cm) ? car.width_cm / 100 : null, 'too narrow for your car'],
        ['maxheight_m', finite(car.height_cm) ? car.height_cm / 100 : null, 'too low for your car'],
        ['maxweight_t', finite(car.weight_kg) ? car.weight_kg / 1000 : null, 'weight limit'], ['surface', car.clearance === 'low' ? 3 : null, 'unpaved for a low car']];
      for (const [ch, mine, label] of lim) {
        const v = channel(ctx, ch);
        if (!v || mine == null) continue;
        for (let i = 0; i < n; i++) if (Number.isFinite(v[i]) && (ch === 'surface' ? v[i] >= mine : v[i] < mine)) { out.hard.push({ kind: 'car_fit', label, atM: c.distM[i] }); break; }
      }
      // fuel range: car.js's fuel_gap span (hard only where its station data covers the stretch), not a guess from here
    }
    if (prefs.passenger && !channel(ctx, 'passenger_cost') && cand.t && Array.isArray(cand.t.events)) {
      const tight = cand.t.events.filter((e) => e.type === 'corner' && (e.severity === 'HP' || e.severity === 1 || e.severity === 2)).length;
      if (tight) addPen('tight corners with a passenger', Math.min(15, 0.3 * tight), 0);
    }
    // each kind saturates softly at KIND_CAP (deer alone can't fill the total, and a longer deer road still costs more), then
    // the total softly at PENALTY_CAP: monotonic all the way, so ice, a school zone or works always still count
    const soft = (x, cap) => cap * (1 - Math.exp(-x / cap));
    out.penalties = [...pen.values()].map((p) => ({ ...p, raw: p.points, points: Math.round(soft(p.points, W.KIND_CAP) * 10) / 10 })).filter((p) => p.points > 0).sort((a, b) => b.points - a.points);
    out.penaltyPts = soft(out.penalties.reduce((a, p) => a + p.points, 0), W.PENALTY_CAP);
    out.penaltyRaw = [...pen.values()].reduce((a, p) => a + p.points, 0);      // before saturation (tests, the card)
    out.bonusPts = Math.min(W.BONUS_CAP, out.bonuses.reduce((a, p) => a + p.points, 0));
    // the driver (driver.js): driver_fit, else skill_fit, -1..1 → ±6 points by the share known; the taste channel (crowd.js,
    // fun points over 2 km windows) is the taste term for candidates the cockpit's tasteOn didn't score
    const mean = (ch) => { if (!ch) return null; let a = 0, k = 0; for (let i = 0; i < n; i++) if (Number.isFinite(ch[i])) { a += ch[i]; k++; } return k ? { m: a / k, share: k / n } : null; };
    const fit = mean(channel(ctx, 'driver_fit')) || mean(channel(ctx, 'skill_fit'));
    out.driverPts = fit ? W.DRIVER * Math.max(-1, Math.min(1, fit.m)) * fit.share : 0;
    const tc = mean(channel(ctx, 'taste'));
    out.tastePts = tc ? Math.max(-8, Math.min(8, tc.m)) * tc.share : null;
    out.stats = stats(c, ctx, s);
    cand.ev = out;
    return out;
  }
  /**
   * A context's spans and points as one list, kinds normalised (KIND_ALIASES) and duplicates across providers dropped: the
   * same kind within DEDUPE_M of one already kept (a signal from the router and from OSM, a level crossing as rail_crossing
   * and level_crossing, a tunnel as a span and a point). Kept on the context; the why line counts from it too.
   */
  const DEDUPE_M = 40, DEDUPE_FEATURE_M = 150;
  function features(ctx) {
    if (ctx.__features) return ctx.__features;
    const all = [...(ctx.spans || []), ...(ctx.points || []).map((p) => ({ ...p, fromM: p.atM, toM: p.atM, point: true }))]
      .map((x) => ({ ...x, kind: x.kind in KIND_ALIASES ? KIND_ALIASES[x.kind] : x.kind })).filter((x) => x.kind)
      .sort((a, b) => a.fromM - b.fromM || (a.point ? 1 : -1));
    const kept = [];
    for (const x of all) {
      const near = ['signal', 'stop', 'crossing', 'junction', 'driveway'].includes(x.kind) ? DEDUPE_M : DEDUPE_FEATURE_M;
      if (kept.some((k) => k.kind === x.kind && Math.abs(k.fromM - x.fromM) <= near && (x.point || k.point || Math.abs(k.toM - x.toM) <= near))) continue;
      kept.push(x);
    }
    Object.defineProperty(ctx, '__features', { value: kept, enumerable: false, configurable: true });
    return kept;
  }
  /** Plain facts for the why line and the card: limits off the highway, signals, km by kind of road, forest, climb. */
  function stats(c, ctx, s) {
    const n = c.distM.length, step = n > 1 ? c.distM[1] - c.distM[0] : 25;
    const lim = channel(ctx, 'speed_limit_kph'), est = channel(ctx, 'speed_limit_est_kph'), rc = channel(ctx, 'road_class'), use = channel(ctx, 'road_use');
    const forest = channel(ctx, 'forest_share'), canopy = channel(ctx, 'canopy_pct'), water = channel(ctx, 'water_near'), creek = channel(ctx, 'creek_follow'), tpi = channel(ctx, 'tpi_m'), biz = channel(ctx, 'business_per_km');
    const elev = channel(ctx, 'elev_m');
    const limits = [];
    let hwyM = 0, resM = 0, bizM = 0, forestM = 0, waterM = 0, ridgeM = 0, known = { forest: 0, water: 0, ridge: 0, biz: 0, rc: 0 };
    for (let i = 0; i < n; i++) {
      const cls = rc ? rc[i] : NaN;
      if (Number.isFinite(cls)) { known.rc++; if (cls <= 1 || (use && use[i] === 1)) hwyM += step; if (cls >= 6) resM += step; }
      const l = lim && Number.isFinite(lim[i]) ? lim[i] : est && Number.isFinite(est[i]) ? est[i] : NaN;
      if (Number.isFinite(l) && !(Number.isFinite(cls) && cls <= 1)) limits.push(l);
      if (biz && Number.isFinite(biz[i])) { known.biz++; if (biz[i] >= 4) bizM += step; }
      const f = forest && Number.isFinite(forest[i]) ? forest[i] : canopy && Number.isFinite(canopy[i]) ? canopy[i] / 100 : NaN;
      if (Number.isFinite(f)) { known.forest++; if (f >= 0.5) forestM += step; }
      const w = water && Number.isFinite(water[i]) ? water[i] : creek && Number.isFinite(creek[i]) ? creek[i] : NaN;
      if (Number.isFinite(w)) { known.water++; if (w >= 0.5) waterM += step; }
      if (tpi && Number.isFinite(tpi[i])) { known.ridge++; if (tpi[i] >= 20) ridgeM += step; }
    }
    let climb = null;
    if (elev) { climb = 0; let ref = null; for (let i = 0; i < n; i++) { const e = elev[i]; if (!Number.isFinite(e)) continue; if (ref == null) ref = e; else if (e > ref + 3) { climb += e - ref; ref = e; } else if (e < ref - 3) ref = e; } }
    const fts = features(ctx), signals = fts.filter((p) => p.point && p.kind === 'signal').length, stops = fts.filter((p) => p.point && p.kind === 'stop').length;
    const km = (m) => m / 1000;
    return { limitLoKph: quantile(limits, 0.25), limitHiKph: quantile(limits, 0.75), limitMedKph: median(limits), signals: channel(ctx, 'signals_per_km') ? signals : null,
      stops: channel(ctx, 'stops_per_km') || stops ? stops : null, highwayKm: known.rc ? km(hwyM) : null, residentialKm: known.rc ? km(resM) : null,
      businessKm: known.biz ? km(bizM) : null, forestKm: known.forest ? km(forestM) : null, forestShare: known.forest ? forestM / (known.forest * step) : null,
      waterKm: known.water ? km(waterM) : null, ridgeKm: known.ridge ? km(ridgeM) : null, climbM: climb == null ? null : Math.round(climb), km: km(c.totalM || c.distM[n - 1]) };
  }

  // ---- ranking ------------------------------------------------------------------------------------------------------
  const glareCost = (c) => (FunRoute ? FunRoute.glareCost(c) : 0), townCost = (c) => (FunRoute ? FunRoute.townCost(c) : 0);
  /**
   * The value of each candidate (points; higher is better) and the ranking, best first, with candidates past the level's
   * time budget or failing a hard constraint dropped (unless every one fails: then they stay, flagged, and the card says
   * why). With no context this is exactly ApexFunRoute.rank. opts: { level, prefs, score, perMinOverride }.
   *   value = fun (corners gated by quality) + 0.5 × good corners gained over the quickest (cap 60)
   *         + 0.3 × (quality − 50) × known share + 20 × (scenery − 0.5) × known share + bonuses (≤ 15)
   *         − 3 per km of side street / business district (smooth below quality 0.45, full at 0.25; cap 60; not the first/last 1.2 km)
   *         − perMin × extra minutes − penalties (≤ 40) − glare − towns − weather + measured + taste + prefer
   */
  function rank(cands, opts = {}) {
    const level = opts.level || 'fun', L = (FunRoute && FunRoute.LEVELS[level]) || { budget: 0.35, slackS: 240, perMin: 1 };
    const perMin = Number.isFinite(opts.perMinOverride) ? opts.perMinOverride : L.perMin;
    for (const c of cands) if (c.corridor && c.ctx && (!c.ev || opts.fresh)) evaluate(c, { ...opts, perMin });
    // Unknown data must not win: where some candidates' road quality is known and another's isn't (or only in part), the
    // unknown stretches take the pool's known mean (gate, quality, side-street cost per km) instead of counting as perfect.
    const known = cands.filter((c) => c.ev && c.ev.knownKm > 0);
    if (known.length) {
      const kkm = known.reduce((a, c) => a + c.ev.knownKm, 0);
      // corners and quality where unknown: the lowest of the known candidates (nothing vouches for them, so they can't beat a
      // road whose data is known), and side-street cost per unknown km: the highest of theirs
      const pool = { gate: Math.min(...known.map((c) => c.ev.meanGate)), quality: Math.min(...known.map((c) => c.ev.quality)),
        poorPerKm: Math.max(...known.map((c) => c.ev.poorPerKnownKm || 0)), poorShare: Math.max(...known.map((c) => clamp01(c.ev.poorKm / c.ev.knownKm))), weight: Math.max(...known.map((c) => c.ev.qWeight)) };
      for (const c of cands) {
        if (!c.ev || !c.corridor || c.ev.knownKm >= c.ev.km - 0.05) continue;
        const k = c.ev.km > 0 ? c.ev.knownKm / c.ev.km : 0;
        evaluate(c, { ...opts, perMin, unknownGate: pool.gate });
        c.ev.qualityFilled = (c.ev.quality != null ? c.ev.quality * k : 0) + pool.quality * (1 - k);
        c.ev.qWeightFilled = Math.max(c.ev.qWeight, pool.weight * (1 - k) + c.ev.qWeight);
        c.ev.poorFilled = Math.min(W.POOR_CAP, c.ev.poorCost + pool.poorPerKm * (c.ev.km - c.ev.knownKm));
        c.ev.poorKmFilled = c.ev.poorKm + pool.poorShare * (c.ev.km - c.ev.knownKm);
      }
    }
    const timed = cands.filter((c) => Number.isFinite(c.timeS));
    if (!timed.length) return cands.slice();
    // the quickest and the budget come from the candidates that can be driven; if none can, the least bad stays, flagged
    const feasible = timed.filter((c) => !(c.ev && c.ev.hard.length));
    const base = feasible.length ? feasible : timed;
    const quick = base.reduce((a, b) => (b.timeS < a.timeS ? b : a));
    const funOf = (c) => (c.ev && c.ev.funGated) || c.fun || null;
    const quickGood = funOf(quick) ? funOf(quick).good : 0;
    const limit = quick.timeS * (1 + L.budget) + L.slackS;
    const valued = cands.map((c) => {
      const extraS = Number.isFinite(c.timeS) ? Math.max(0, c.timeS - quick.timeS) : Infinity;
      const ev = c.ev || null;
      // a drive, not a stretch: corners count by the share of the route that isn't side streets or strip malls, so a plan
      // that crawls 6 km of suburbs and shops to reach 3 km of back road doesn't outscore the highway (live, Northgate)
      const share = ev && ev.poorKmFilled != null && ev.km > 0.5 ? 1 - clamp01(ev.poorKmFilled / ev.km)
        : ev && ev.knownKm > 0.5 ? 1 - clamp01(ev.poorKm / ev.knownKm) : 1;
      const f = funOf(c), fun = f ? f.fun * share : 0, gain = f ? Math.min(60, Math.max(0, f.good - quickGood)) * share : 0;
      const parts = {
        fun, gain: 0.5 * gain, time: -perMin * extraS / 60,
        quality: ev && ev.qualityFilled != null ? W.QUALITY * (ev.qualityFilled - 50) * ev.qWeightFilled : ev && ev.quality != null ? W.QUALITY * (ev.quality - 50) * ev.qWeight : 0,
        poor: ev ? -(ev.poorFilled != null ? ev.poorFilled : ev.poorCost) : 0, business: ev ? -(ev.businessCost || 0) : 0, scenery: ev ? ev.sceneryPts : 0, bonus: ev ? ev.bonusPts : 0, penalty: ev ? -ev.penaltyPts : 0,
        glare: -glareCost(c), towns: -townCost(c), weather: -(c.weatherCost || 0), measured: c.adjust || 0, taste: c.tasteBonus != null ? c.tasteBonus : ev && ev.tastePts != null ? ev.tastePts : 0, prefer: c.preferBonus || 0,
        driver: ev ? ev.driverPts || 0 : 0,
      };
      const value = Object.values(parts).reduce((a, b) => a + b, 0);
      return { ...c, extraS, value, parts, infeasible: !!(ev && ev.hard.length) };
    });
    const ok = valued.filter((c) => !c.infeasible);
    if (!ok.length) {                                                    // every one breaks a hard constraint: the least bad, flagged
      const fewest = Math.min(...valued.map((c) => (c.ev ? c.ev.hard.length : 0)));
      return valued.filter((c) => (c.ev ? c.ev.hard.length : 0) === fewest).sort((a, b) => b.value - a.value).slice(0, 1);
    }
    return ok.filter((c) => c.extraS === 0 || c.timeS <= limit).sort((a, b) => b.value - a.value);
  }

  // ---- the why line -------------------------------------------------------------------------------------------------
  const mi = (km, metric) => (metric ? `${km < 10 ? km.toFixed(1) : Math.round(km)} km` : `${(km / 1.609344) < 10 ? (km / 1.609344).toFixed(1) : Math.round(km / 1.609344)} mi`);
  const speedText = (lo, hi, metric) => {
    const r = (v) => (metric ? Math.round(v / 5) * 5 : Math.round(kmh2mph(v) / 5) * 5);
    const a = r(lo), b = r(hi), u = metric ? 'km/h' : 'mph';
    return a === b ? `${a} ${u}` : `${a}–${b} ${u}`;
  };
  /**
   * Why the winner beat the quickest route: the 2–3 terms of the value that separate them most (the parts rank() computed),
   * in words, e.g. "Back roads at 45–55 mph · through forest · 2 signals, +6 min"; "Avoids 3.1 mi of strip malls";
   * "Highway instead of 1.2 mi of side streets". null when the winner is the quickest, or nothing the context knew made
   * the difference (the caller then says what it said before: roads and corners).
   */
  function why(best, quick, o = {}) {
    if (!best || !quick || best === quick || !best.parts || !quick.parts) return null;
    if (best.route && quick.route && best.route === quick.route) return null;
    const metric = !!o.metric, b = best.ev || {}, q = quick.ev || {}, bs = b.stats || {}, qs = q.stats || {};
    const facts = [];
    const d = (k) => (best.parts[k] || 0) - (quick.parts[k] || 0);
    // side streets and business districts the winner avoids (or the highway that avoids them)
    if (d('poor') > 0.5 && q.poorBy && b.poorBy) {
      const by = Object.entries(q.poorBy).map(([k, v]) => [k, v - (b.poorBy[k] || 0)]).sort((x, y) => y[1] - x[1])[0];
      // the kind it avoids most, in that kind's km (a route can carry more side street in all yet avoid the subdivision)
      const km = by ? Math.max(0, by[1]) : Math.max(0, q.poorKm - b.poorKm);
      if (km >= 0.3) {
        const what = by && by[0] === 'business' ? 'strip malls' : by && by[0] === 'stops' ? 'stop-and-go streets' : 'side streets';
        const hwy = finite(bs.highwayKm) && finite(qs.highwayKm) && bs.highwayKm - qs.highwayKm >= 1;
        facts.push({ w: d('poor'), text: hwy ? `Highway instead of ${mi(km, metric)} of ${what}` : `Avoids ${mi(km, metric)} of ${what}` });
      }
    }
    if (d('gain') + d('fun') > 1 && best.ev && best.ev.funGated && quick.ev && quick.ev.funGated) {
      const g = Math.round(best.ev.funGated.good - quick.ev.funGated.good);
      if (g >= 3) facts.push({ w: d('gain') + d('fun'), text: `${g} more good corners` });
    }
    if (d('quality') > 1 && finite(bs.limitLoKph) && finite(bs.limitHiKph) && bs.limitLoKph >= 64) {
      facts.push({ w: d('quality'), text: `${(bs.residentialKm || 0) < 1 && (bs.highwayKm || 0) < 0.5 * bs.km ? 'Back roads' : 'Open roads'} at ${speedText(bs.limitLoKph, bs.limitHiKph, metric)}` });
    }
    if (finite(bs.signals) && finite(qs.signals) && qs.signals - bs.signals >= 3) facts.push({ w: Math.max(0.6, d('quality') * 0.5), text: bs.signals === 0 ? 'no signals' : `${bs.signals} signal${bs.signals === 1 ? '' : 's'} (not ${qs.signals})` });
    // never "through forest" on a plan that drives more strip mall than the quickest: scenery there isn't what you'd see
    const shops = finite(b.businessKm) && b.businessKm - (q.businessKm || 0) >= 0.3;
    if (d('scenery') > 1 && !shops) {
      const fk = (bs.forestKm || 0) - (qs.forestKm || 0), wk = (bs.waterKm || 0) - (qs.waterKm || 0), rk = (bs.ridgeKm || 0) - (qs.ridgeKm || 0);
      const top = [[fk, 'through forest'], [wk, 'along the water'], [rk, 'up on the ridges']].sort((x, y) => y[0] - x[0])[0];
      facts.push({ w: d('scenery'), text: top[0] >= 1 ? top[1] : 'nicer country' });
    }
    if (d('penalty') > 1 && q.penalties && q.penalties.length) {
      const top = q.penalties.map((p) => [p, p.points - ((b.penalties || []).find((x) => x.label === p.label) || { points: 0 }).points]).sort((x, y) => y[1] - x[1])[0];
      if (top && top[1] > 1) facts.push({ w: d('penalty'), text: top[0].label === 'deer' ? 'Deer hour: open roads' : `${/s$/.test(top[0].label) ? 'fewer' : 'less'} ${top[0].label}` });
    }
    if (d('bonus') > 1 && b.bonuses && b.bonuses.length) facts.push({ w: d('bonus'), text: b.bonuses[0].label === 'golden light' ? 'golden light on the hills' : `${b.bonuses[0].label}` });
    if (d('towns') > 1 && finite(best.townKm) && finite(quick.townKm) && quick.townKm - best.townKm >= 0.5) facts.push({ w: d('towns'), text: `${mi(quick.townKm - best.townKm, metric)} less in towns` });
    if (d('weather') > 1) facts.push({ w: d('weather'), text: 'drier' });
    if (d('glare') > 1) facts.push({ w: d('glare'), text: 'less low sun' });
    // nothing to name but the road itself is better on the whole (shallower side streets, a higher mean quality): say that,
    // never the old line's raw corner count, which counts corners on side streets the engine gated to nothing
    if (!facts.length && d('quality') + d('poor') > 1 && finite(b.quality) && finite(q.quality) && b.quality > q.quality) facts.push({ w: d('quality') + d('poor'), text: 'Better roads than the quickest' });
    if (!facts.length) return null;
    facts.sort((x, y) => y.w - x.w);
    const pick = facts.slice(0, 3).map((f, i) => (i ? f.text.charAt(0).toLowerCase() + f.text.slice(1) : f.text.charAt(0).toUpperCase() + f.text.slice(1)));
    const extra = Math.round(((best.timeS || 0) - (quick.timeS || 0)) / 60);
    return { text: `${pick.join(' · ')}${extra >= 1 ? `, +${extra} min` : ''}`, factors: facts.slice(0, 3), extraMin: extra };
  }

  // ---- candidates: corridors, costing, the road network --------------------------------------------------------------
  /** The router's maneuver clock ([lon, lat, seconds]) placed along its own line: [[metres, seconds]]. */
  function placeTimes(coords, times) {
    if (!Array.isArray(times) || !times.length || !Ctx) return [];
    const cum = Ctx.cumulative(coords), out = [];
    let j = 0;
    for (const [lon, lat, sec] of times) {
      let best = -1, bd = Infinity;
      for (let k = j; k < Math.min(coords.length, j + 4000); k++) {
        const dd = Math.abs(coords[k][0] - lon) + Math.abs(coords[k][1] - lat);
        if (dd < bd) { bd = dd; best = k; if (dd < 1e-7) break; }
      }
      if (best < 0 || bd > 0.001) continue;
      j = best; out.push([cum[best], sec]);
    }
    return out;
  }
  /** A candidate's corridor (25 m samples, heading, eta at each from the router's clock and the driver's pace). */
  function corridorFor(cand, id, o = {}) {
    if (!Ctx || !cand || !cand.route || !Array.isArray(cand.route.coords)) return null;
    return Ctx.corridor(id, cand.route.coords, { timeS: cand.timeS, marks: placeTimes(cand.route.coords, cand.route.times), departAt: o.departAt, pace: o.pace, car: o.car, driver: o.driver });
  }
  /** A stage (web/stages.js: lat[], lon[]) as a corridor, driven forward. */
  function stageCorridor(s, id, o = {}) {
    if (!Ctx || !s || !s.lat || s.lat.length < 2) return null;
    const c = Ctx.corridor(id, s.lat.map((la, i) => [s.lon[i], la]), { departAt: o.departAt, car: o.car });
    if (c) c.match = 'map_snap';                     // map-tile geometry, not the router's own line: providers snap it
    return c;
  }
  /**
   * Router costing for connector legs (stage plans, the matrix between stages, the plain highway candidate): highways are
   * welcome between good roads (use_highways 0.6, the quickest 1.0) unless the driver avoids them; every other avoid and
   * the car stay as ApexFunRoute.costing sets them. The good roads themselves are pinned by shaping points, so this only
   * changes how the plan gets between them.
   */
  function connectorCosting(avoid, car, useHighways = 0.6) {
    const base = FunRoute.costing(avoid, car);
    const auto = { ...base.costing_options.auto };
    if (!(avoid && avoid.highways)) auto.use_highways = useHighways;
    return { costing: 'auto', costing_options: { auto } };
  }
  const highwayCosting = (avoid, car) => (avoid && avoid.highways ? null : connectorCosting(avoid, car, 1.0));
  /**
   * Stages re-scored by what the context says about the road (the network step: good roads, not just twisty lines): each
   * stage's geometry score times its corner gate (a curvy subdivision street falls to 40 %), plus scenery. Sorted best
   * first; stages with no context keep their score. Mutates s.score (s.mapScore keeps the original) and sets s.ev.
   */
  function rescoreStages(stages, ctxById) {
    const any = (stages || []).some((s) => ctxById && ctxById[s.__ctxId]);
    for (const s of stages || []) {
      const ctx = ctxById && ctxById[s.__ctxId];
      if (!s.__corridor) continue;
      if (!ctx) {                                    // asked about but nothing came back while others' did: not trusted either
        if (any) { if (s.mapScore == null) s.mapScore = s.score; s.score = s.mapScore * (0.4 + 0.6 * W.STAGE_UNKNOWN_GATE); s.ev = { gate: W.STAGE_UNKNOWN_GATE, scenery: null, quality: null }; }
        continue;
      }
      const smp = samples(s.__corridor, ctx);
      let q = 0, qn = 0, sc = 0, sn = 0;
      for (let i = 0; i < smp.n; i++) { if (Number.isFinite(smp.quality[i])) { q += gate(smp.quality[i]); qn++; } if (Number.isFinite(smp.scenery[i])) { sc += smp.scenery[i]; sn++; } }
      if (s.mapScore == null) s.mapScore = s.score;
      // a stage nothing vouches for isn't trusted: its unknown samples take STAGE_UNKNOWN_GATE, not a full gate (live, the
      // router out of time: a stage on a strip-mall arterial kept its map score and was planned)
      const g = (q + (smp.n - qn) * W.STAGE_UNKNOWN_GATE) / Math.max(1, smp.n), scen = sn ? sc / sn : 0.5, cov = sn / smp.n;
      s.score = s.mapScore * (0.4 + 0.6 * g) * (1 + 0.4 * (scen - 0.5) * cov);
      s.ev = { gate: g, scenery: sn ? scen : null, quality: qn ? smp.quality.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0) / qn : null };
    }
    return (stages || []).slice().sort((a, b) => b.score - a.score);
  }
  /** Corridors for the stages worth asking about (the first `k`), tagged so rescoreStages finds their context. */
  function stageCorridors(stages, k = 8, o = {}) {
    const out = [];
    (stages || []).slice(0, k).forEach((s, i) => { const c = stageCorridor(s, `stage${i}`, o); if (c) { s.__corridor = c; s.__ctxId = c.id; out.push(c); } });
    return out;
  }
  /**
   * A routed loop's value on the same scale (loops and explore use the model too): ApexFunRoute.loopValue on the
   * quality-gated fun, plus quality, scenery, bonuses, side-street cost, penalties, glare and towns.
   */
  function loopValue(d, km, targetKm, retraced, opts = {}) {
    const ev = d.ev || (d.corridor && d.ctx ? evaluate(d, opts) : null);
    const f = ev && ev.funGated ? ev.funGated : d.fun || (d.t && d.t.fun) || null;
    const base = FunRoute.loopValue(f, km, targetKm, retraced);
    if (!ev) return base;
    return base + (ev.quality != null ? W.QUALITY * (ev.quality - 50) * ev.qWeight : 0) + ev.sceneryPts + ev.bonusPts - ev.poorCost - ev.penaltyPts + (ev.driverPts || 0);
  }

  const api = { VERSION: 1, QUALITY, SCENERY, PER_KM, SPANS, ALIASES, KIND_ALIASES, SOURCES, W, SPEED, gate, active, moment, channel, samples, evaluate, stats, rank, why,
    placeTimes, corridorFor, stageCorridor, stageCorridors, connectorCosting, highwayCosting, rescoreStages, loopValue, ramp, decay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexRouteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
