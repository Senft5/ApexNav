// Route context: crowds near the route when you'd pass (ROUTE_ENGINE_CONTRACT provider `events`). Game and concert traffic,
// Sunday-morning church traffic and school-run hours, each evaluated at the sample's own eta in local time.
//
// Sources and terms (checked 2026-11-03):
//  - MLB Stats API (statsapi.mlb.com, no key, CORS open): MLB (sportId 1: Reds, Guardians) and Triple-A (sportId 11:
//    Louisville Bats, Columbus Clippers, Indianapolis Indians, Nashville Sounds, Charlotte Knights, Durham Bulls, Norfolk
//    Tides...) schedules with venue coordinates. Terms: "Copyright MLB Advanced Media, L.P. Use of any content on this page
//    acknowledges agreement to the terms posted here http://gdx.mlb.com/components/copyright.txt" (individual, non-commercial,
//    non-bulk use). We ask for one date range per plan and keep it 6 h. Owner to confirm (docs/OWNER_TODO.md).
//  - SeatGeek Platform API (api.seatgeek.com, free client_id, CORS open; key slot `seatgeekClientId`): NFL, MLS, NBA, NHL,
//    NCAA football/basketball, motorsports and concerts near a point with venue coordinates. Terms: seatgeek.com/api-terms
//    (attribution "Event data by SeatGeek"; the owner accepts them when creating the id). Without the id these are unknown.
//  - Not used: ESPN's site API (undocumented, its terms forbid automated use), NHL's api-web.nhle.com (no CORS, no terms),
//    team ICS feeds (most go through third-party calendar services whose terms bar apps). City open data for festivals,
//    parades and street-closure permits, checked: Cincinnati (data.cincinnati-oh.gov, Socrata) publishes building and
//    small-cell right-of-way permits but no street-closure or special-event permits; Columbus (opendata.columbus.gov) none;
//    Louisville (data.louisvilleky.gov) "Right of Way Permits (Historical)", last updated 2024; Lexington (data.lexingtonky.gov)
//    none. Closures that do get published reach us as WZDx work zones (hazards_live.js).
//  - Places of worship and schools: OpenStreetMap (ODbL), from the OSM provider via opts.places.worship / opts.places.schools
//    ([{lat, lon, name?}]), else our weekly build's 0.25° cells (GET /api/ctx/points, Ohio, Kentucky and Indiana, since
//    2026-11-14), else one Overpass query per 0.25° tile left (kept 30 days), the public servers raced (web/cameras.js).
//  - Bell times and calendars (heuristic, labelled as such): NCES National Teacher and Principal Survey 2017-18 (average public
//    high school start 8:00 a.m.; elementary later, ~8:30-9:00) and state school-year law/practice: OH, IN, KY, TN, WV start
//    early-to-mid August; NC (G.S. 115C-84.2: the Monday nearest Aug 26) and VA late August; all end late May / early June.
//    Breaks: Thanksgiving Wed-Fri and Dec 21 - Jan 2 off. Spring breaks vary by district and are not modelled.
//    Church windows: Sunday 08:00-12:30 (services mostly 9-11 and the traffic either side), Saturday 16:30-18:30 (vigil Masses).
//
// Channels:
//   event_crowd     k people  expected attendees of events whose traffic reaches this sample at its eta (arrival from 2.5 h
//                   before the start, departure until 1 h after the end; the venue's radius grows with its size); 0 = none
//                   known; NaN when the schedules could not be had.
//   school_zone     0/1  within 300 m of a school during the arrival (07:00-09:15) or dismissal (14:00-16:15) window on a
//                   school day; NaN without school locations.
//   school_bus_hour 0/1  the eta is inside bus-run hours (06:15-08:45, 14:00-16:45) on a school day in this state (time only:
//                   stopped buses on rural roads; the engine weighs it by road type).
//   church_window   0/1  within 150 m of a place of worship during a service window; NaN without places.
// Spans: event (value k people, label the event), school-zone, church. Points: venue (atM nearest the venue, value k people).
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const U = NODE ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const { finite } = U;
  const ID = 'events', VERSION = 1, BUDGET_MS = 6000;
  const CHANNELS = ['event_crowd', 'school_zone', 'school_bus_hour', 'church_window'];

  // Big venues of the region: [name, lat, lon, capacity, kind]. Coordinates are the venue's OSM centroid to ~100 m. Used to
  // size a crowd when the schedule doesn't (SeatGeek often reports capacity 0) and to name it.
  const VENUES = [
    ['Great American Ball Park', 39.0974, -84.5066, 42319, 'baseball'], ['Paycor Stadium', 39.0954, -84.5160, 65515, 'football'],
    ['TQL Stadium', 39.1113, -84.5222, 26000, 'soccer'], ['Heritage Bank Center', 39.0969, -84.5157, 17556, 'arena'],
    ['Nippert Stadium', 39.1311, -84.5161, 38088, 'football'], ['Fifth Third Arena', 39.1316, -84.5163, 12012, 'arena'],
    ['Cintas Center', 39.1489, -84.4741, 10250, 'arena'], ['Riverbend Music Center', 39.0505, -84.4185, 20500, 'concert'],
    ['Ohio Stadium', 40.0017, -83.0197, 102780, 'football'], ['Nationwide Arena', 39.9693, -83.0061, 18500, 'arena'],
    ['Lower.com Field', 39.9686, -83.0170, 20371, 'soccer'], ['Value City Arena', 40.0074, -83.0251, 18809, 'arena'],
    ['Huntington Park', 39.9686, -83.0108, 10100, 'baseball'], ['Progressive Field', 41.4962, -81.6852, 34830, 'baseball'],
    ['Huntington Bank Field', 41.5061, -81.6995, 67431, 'football'], ['Rocket Arena', 41.4965, -81.6881, 19432, 'arena'],
    ['Mid-Ohio Sports Car Course', 40.6889, -82.6375, 60000, 'motorsport'], ['UD Arena', 39.7389, -84.2006, 13409, 'arena'],
    ['Lucas Oil Stadium', 39.7601, -86.1639, 67000, 'football'], ['Gainbridge Fieldhouse', 39.7640, -86.1555, 17274, 'arena'],
    ['Victory Field', 39.7653, -86.1686, 12230, 'baseball'], ['Indianapolis Motor Speedway', 39.7950, -86.2347, 250000, 'motorsport'],
    ['Churchill Downs', 38.2027, -85.7703, 150000, 'racing'], ['KFC Yum! Center', 38.2575, -85.7536, 22090, 'arena'],
    ['L&N Stadium', 38.2058, -85.7590, 60800, 'football'], ['Louisville Slugger Field', 38.2569, -85.7446, 13131, 'baseball'],
    ['Lynn Family Stadium', 38.2600, -85.7317, 15304, 'soccer'], ['Kroger Field', 38.0220, -84.5053, 61000, 'football'],
    ['Rupp Arena', 38.0496, -84.4963, 20545, 'arena'], ['Keeneland', 38.0480, -84.6060, 40000, 'racing'],
    ['Nissan Stadium', 36.1665, -86.7713, 69143, 'football'], ['Bridgestone Arena', 36.1592, -86.7785, 17159, 'arena'],
    ['Geodis Park', 36.1302, -86.7657, 30000, 'soccer'], ['First Horizon Park', 36.1735, -86.7849, 10000, 'baseball'],
    ['Neyland Stadium', 35.9550, -83.9250, 101915, 'football'], ['Thompson-Boling Arena', 35.9550, -83.9358, 21678, 'arena'],
    ['Bristol Motor Speedway', 36.5157, -82.2570, 146000, 'motorsport'], ['Bank of America Stadium', 35.2258, -80.8528, 74867, 'football'],
    ['Spectrum Center', 35.2251, -80.8392, 19077, 'arena'], ['Charlotte Motor Speedway', 35.3520, -80.6828, 95000, 'motorsport'],
    ['Lenovo Center', 35.8033, -78.7220, 18700, 'arena'], ['Carter-Finley Stadium', 35.8007, -78.7196, 56919, 'football'],
    ['Kenan Stadium', 35.9069, -79.0478, 50500, 'football'], ['Wallace Wade Stadium', 35.9954, -78.9418, 40004, 'football'],
    ['Lane Stadium', 37.2199, -80.4180, 65632, 'football'], ['Scott Stadium', 38.0311, -78.5137, 61500, 'football'],
    ['Milan Puskar Stadium', 39.6500, -79.9548, 60000, 'football'], ['Joan C. Edwards Stadium', 38.4243, -82.4210, 38227, 'football'],
  ].map(([name, lat, lon, cap, kind]) => ({ name, lat, lon, cap, kind }));
  // Hours an event lasts, by kind; how full it usually is (share of capacity) when the schedule gives no attendance.
  const HOURS = { baseball: 3, aaa: 2.75, football: 3.5, soccer: 2, basketball: 2.5, hockey: 2.5, arena: 2.75, concert: 3, motorsport: 4, racing: 6, other: 3 };
  const FILL = { baseball: 0.6, aaa: 0.55, football: 0.95, soccer: 0.85, basketball: 0.85, hockey: 0.85, arena: 0.75, concert: 0.8, motorsport: 0.7, racing: 0.4, other: 0.6 };
  const BEFORE_MS = 2.5 * 3600e3, AFTER_MS = 1 * 3600e3;

  /** Radius (m) a crowd's traffic reaches: 600 m + 800 m per decade of thousands (40k → 1.9 km, 100k → 2.2 km). */
  const radiusM = (people) => 600 + 800 * Math.log10(Math.max(1, people / 1000));
  /** How much of the crowd is on the roads at `ms`: 1 arriving (2.5 h before → start), 0.25 during, 1 leaving (end → +1 h). */
  function phase(ev, ms) {
    if (ms < ev.startMs - BEFORE_MS || ms > ev.endMs + AFTER_MS) return 0;
    if (ms < ev.startMs) return ms < ev.startMs - 1.5 * 3600e3 ? 0.5 : 1;
    if (ms <= ev.endMs) return 0.25;
    return 1;
  }
  const nearestVenue = (lat, lon, maxM = 600) => {
    let best = null;
    for (const v of VENUES) { const d = U.metres(lat, lon, v.lat, v.lon); if (d <= maxM && (!best || d < best.d)) best = { v, d }; }
    return best && best.v;
  };

  // ---- MLB Stats API ----------------------------------------------------------------------------------------------------
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const mlbUrl = (fromMs, toMs) => `https://statsapi.mlb.com/api/v1/schedule?sportId=1,11&startDate=${ymd(fromMs - 864e5)}&endDate=${ymd(toMs)}&hydrate=venue(location)`;
  /** MLB schedule JSON → events [{ startMs, endMs, lat, lon, people, label, kind }] (postponed/cancelled dropped). */
  function parseMlb(json) {
    const out = [];
    for (const d of (json && json.dates) || []) for (const g of d.games || []) {
      const st = g.status || {}, loc = g.venue && g.venue.location && g.venue.location.defaultCoordinates;
      if (!loc || !finite(loc.latitude) || !finite(loc.longitude)) continue;
      if (/Postponed|Cancelled|Suspended/i.test(st.detailedState || '')) continue;
      const startMs = Date.parse(g.gameDate);
      if (!finite(startMs)) continue;
      // calendarEventID starts "14-" for MLB and "44-" for Triple-A (observed in the API's answers).
      const kind = /^44-/.test(g.calendarEventID || '') ? 'aaa' : 'baseball';
      const v = nearestVenue(loc.latitude, loc.longitude);
      const cap = v ? v.cap : kind === 'aaa' ? 10000 : 40000;
      const home = g.teams && g.teams.home && g.teams.home.team ? g.teams.home.team.name : '';
      out.push({ startMs, endMs: startMs + HOURS[kind] * 3600e3, lat: loc.latitude, lon: loc.longitude, people: Math.round(cap * FILL[kind]), label: `${home} home game`.trim(), kind, venue: (g.venue && g.venue.name) || (v && v.name) || '' });
    }
    return out;
  }

  // ---- SeatGeek ---------------------------------------------------------------------------------------------------------
  function seatgeekUrl(box, fromMs, toMs, clientId) {
    const lat = (box[0] + box[2]) / 2, lon = (box[1] + box[3]) / 2;
    const miles = Math.ceil(U.metres(box[0], box[1], box[2], box[3]) / 2 / 1609.344) + 3;
    const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
    return `https://api.seatgeek.com/2/events?client_id=${encodeURIComponent(clientId)}&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&range=${Math.min(100, miles)}mi`
      + `&datetime_utc.gte=${iso(fromMs - 8 * 3600e3)}&datetime_utc.lte=${iso(toMs + BEFORE_MS)}&per_page=100`;
  }
  const SG_KIND = [[/baseball/, 'baseball'], [/football/, 'football'], [/soccer|mls/, 'soccer'], [/basketball/, 'basketball'], [/hockey/, 'hockey'],
    [/concert|music/, 'concert'], [/nascar|auto_racing|motorsport|indycar/, 'motorsport'], [/horse_racing/, 'racing']];
  /** SeatGeek events JSON → events (minor ones under 2,000 people dropped: they don't move traffic). */
  function parseSeatgeek(json) {
    const out = [];
    for (const e of (json && json.events) || []) {
      const loc = e.venue && e.venue.location;
      if (!loc || !finite(loc.lat) || !finite(loc.lon) || e.time_tbd || e.date_tbd) continue;
      const startMs = Date.parse(e.datetime_utc + (/[zZ]|[+-]\d\d:?\d\d$/.test(e.datetime_utc || '') ? '' : 'Z'));
      if (!finite(startMs)) continue;
      const tax = ((e.taxonomies || []).map((t) => t.name).join(' ') + ' ' + (e.type || '')).toLowerCase();
      const kind = (SG_KIND.find(([re]) => re.test(tax)) || [null, 'other'])[1];
      const v = nearestVenue(loc.lat, loc.lon);
      const cap = (e.venue.capacity > 0 ? e.venue.capacity : 0) || (v ? v.cap : 0);
      if (!cap) continue;
      const people = Math.round(cap * FILL[kind]);
      if (people < 2000) continue;
      out.push({ startMs, endMs: startMs + HOURS[kind] * 3600e3, lat: loc.lat, lon: loc.lon, people, label: e.short_title || e.title || '', kind, venue: e.venue.name || (v && v.name) || '' });
    }
    return out;
  }
  /** Drop duplicates (MLB and SeatGeek both list a Reds game): same venue within 600 m, starts within 2 h. */
  function dedupe(events) {
    const out = [];
    for (const e of events.sort((a, b) => b.people - a.people)) {
      if (!out.some((o) => Math.abs(o.startMs - e.startMs) < 2 * 3600e3 && U.metres(o.lat, o.lon, e.lat, e.lon) < 600)) out.push(e);
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  // ---- calendars --------------------------------------------------------------------------------------------------------
  // [first school day (month, day), last school day (month, day)] by state (typical; districts vary by a week or two).
  const SCHOOL_YEAR = { OH: [[8, 20], [5, 29]], IN: [[8, 6], [5, 22]], KY: [[8, 12], [5, 22]], TN: [[8, 6], [5, 22]], WV: [[8, 18], [5, 29]], NC: [[8, 25], [6, 5]], VA: [[8, 25], [6, 12]] };
  function schoolDay(lt, state) {
    const y = SCHOOL_YEAR[state];
    if (!y || lt.dow === 0 || lt.dow === 6) return false;
    const md = lt.m * 100 + lt.d, start = y[0][0] * 100 + y[0][1], end = y[1][0] * 100 + y[1][1];
    if (md > end && md < start) return false;                                // summer
    if (md >= 1221 || md <= 102) return false;                               // winter break
    if (lt.m === 11 && lt.dow >= 3 && lt.dow <= 5 && lt.d >= 22 && lt.d <= 29) return false;   // Thanksgiving Wed-Fri
    if (lt.m === 9 && lt.dow === 1 && lt.d <= 7) return false;               // Labor Day
    if (lt.m === 1 && lt.dow === 1 && lt.d >= 15 && lt.d <= 21) return false; // Martin Luther King Jr. Day
    return true;
  }
  const inAny = (h, wins) => wins.some(([a, b]) => h >= a && h < b);
  const ZONE_HOURS = [[7, 9.25], [14, 16.25]], BUS_HOURS = [[6.25, 8.75], [14, 16.75]];
  const churchWindow = (lt) => (lt.dow === 0 && lt.hour >= 8 && lt.hour < 12.5) || (lt.dow === 6 && lt.hour >= 16.5 && lt.hour < 18.5);

  // ---- places (OSM) -----------------------------------------------------------------------------------------------------
  const TILE = 0.25, PLACE_TTL = 30 * 864e5;
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  function placesQuery(tiles) {
    const parts = tiles.map((k) => U.cellBox(k, TILE).map((v) => v.toFixed(4)).join(',')).flatMap((b) =>
      [`nwr["amenity"="school"](${b});`, `nwr["amenity"="place_of_worship"](${b});`]);
    return `[out:json][timeout:25];(${parts.join('')});out center tags qt;`;
  }
  /** Overpass elements → { schools: [{lat, lon}], worship: [{lat, lon}] }. */
  function parsePlaces(json) {
    const out = { schools: [], worship: [] };
    for (const x of (json && json.elements) || []) {
      const lat = finite(x.lat) ? x.lat : x.center && x.center.lat, lon = finite(x.lon) ? x.lon : x.center && x.center.lon;
      if (!finite(lat) || !finite(lon)) continue;
      const t = x.tags || {};
      if (t.amenity === 'school') out.schools.push({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
      else if (t.amenity === 'place_of_worship') out.worship.push({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
    }
    return out;
  }
  async function loadPlaces(corridors, e) {
    const tiles = U.cellsAlong(corridors, TILE, 0.005, 4), have = { schools: [], worship: [] };
    let missing = [];
    for (const k of tiles) { const c = U.cacheGet(e.storage, 'pl.' + k, PLACE_TTL, e.now); if (c) { have.schools.push(...c.schools); have.worship.push(...c.worship); } else missing.push(k); }
    if (!missing.length) return have;
    // our weekly build first (Ohio, Kentucky, Indiana; U.builtPoints): only the cells it doesn't cover go to Overpass
    const ours = await U.builtPoints(e.apiGet, missing);
    for (const [k, c] of ours) {
      const v = { schools: c.schools, worship: c.worship };
      U.cachePut(e.storage, 'pl.' + k, v, e.now); have.schools.push(...v.schools); have.worship.push(...v.worship);
    }
    missing = missing.filter((k) => !ours.has(k));
    if (!missing.length) return have;
    if (missing.length > 24) return null;                                    // a cross-state plan: leave it to the OSM provider
    const body = 'data=' + encodeURIComponent(placesQuery(missing));
    const race = root.ApexCameras && root.ApexCameras.fetchFirst
      ? root.ApexCameras.fetchFirst(e.fetchFn, body, OVERPASS, 10000)
      : Promise.any(OVERPASS.map((u) => U.getJSON(e.fetchFn, u, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: 10000, signal: e.signal }).then((j) => j || Promise.reject(new Error('none'))))).catch(() => null);
    const json = await race;
    if (!json) return null;
    const got = parsePlaces(json);
    for (const k of missing) {
      const [s, w, n, ea] = U.cellBox(k, TILE), inside = (p) => p.lat >= s && p.lat < n && p.lon >= w && p.lon < ea;
      U.cachePut(e.storage, 'pl.' + k, { schools: got.schools.filter(inside), worship: got.worship.filter(inside) }, e.now);
    }
    return { schools: have.schools.concat(got.schools), worship: have.worship.concat(got.worship) };
  }

  // ---- evaluation (pure) ------------------------------------------------------------------------------------------------
  /**
   * Channels, spans and points for one corridor. events: [{ startMs, endMs, lat, lon, people, label, kind, venue }] or null
   * (schedules unknown); places: { schools, worship } (either null when unknown).
   */
  function evaluate(corridor, events, places) {
    const n = corridor.lat.length, ch = {};
    for (const c of CHANNELS) ch[c] = U.nanArray(n);
    const lts = new Array(n), states = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!finite(corridor.etaAt[i])) continue;
      lts[i] = U.localTime(corridor.etaAt[i], corridor.lat[i], corridor.lon[i]);
      states[i] = U.stateAt(corridor.lat[i], corridor.lon[i]);
      if (states[i] && SCHOOL_YEAR[states[i]]) ch.school_bus_hour[i] = schoolDay(lts[i], states[i]) && inAny(lts[i].hour, BUS_HOURS) ? 1 : 0;
    }
    const spans = [], points = [], d = corridor.distM;
    if (events) {
      ch.event_crowd.fill(0);
      for (const ev of events) {
        const r = radiusM(ev.people), near = U.samplesWithin(corridor, ev.lat, ev.lon, 2 * r);
        if (!near.length) continue;
        let hit = false;
        for (const { i, dM } of near) {
          const k = phase(ev, corridor.etaAt[i]) * (dM <= r ? 1 : 0.5) * ev.people / 1000;
          if (k > 0) { ch.event_crowd[i] += Math.round(k * 10) / 10; hit = true; }
        }
        if (!hit) continue;
        for (const [a, b] of U.runs(near.filter(({ i }) => phase(ev, corridor.etaAt[i]) > 0), 2)) spans.push({ fromM: d[a], toM: d[b], kind: 'event', value: Math.round(ev.people / 100) / 10, label: `${ev.label}${ev.venue ? ' at ' + ev.venue : ''}` });
        const c = near.reduce((x, y) => (y.dM < x.dM ? y : x));
        points.push({ atM: d[c.i], kind: 'venue', value: Math.round(ev.people / 100) / 10, label: ev.venue || ev.label });
      }
    }
    if (places && places.schools) {
      for (let i = 0; i < n; i++) if (lts[i]) ch.school_zone[i] = 0;
      for (const s of places.schools) for (const { i } of U.samplesWithin(corridor, s.lat, s.lon, 300)) {
        if (lts[i] && states[i] && schoolDay(lts[i], states[i]) && inAny(lts[i].hour, ZONE_HOURS)) ch.school_zone[i] = 1;
      }
      spans.push(...U.spansWhere(d, (i) => ch.school_zone[i] === 1, 'school-zone', { label: 'School run', joinM: 100 }));
    }
    if (places && places.worship) {
      for (let i = 0; i < n; i++) if (lts[i]) ch.church_window[i] = 0;
      for (const w of places.worship) for (const { i } of U.samplesWithin(corridor, w.lat, w.lon, 150)) {
        if (lts[i] && churchWindow(lts[i])) ch.church_window[i] = 1;
      }
      spans.push(...U.spansWhere(d, (i) => ch.church_window[i] === 1, 'church', { label: 'Church traffic', joinM: 100 }));
    }
    const parts = [events ? null : 'no schedules', places && places.schools ? null : 'no schools', places && places.worship ? null : 'no places of worship'].filter(Boolean);
    const out = { status: parts.length ? 'partial' : 'ok', channels: ch, spans: spans.sort((a, b) => a.fromM - b.fromM), points };
    if (parts.length) out.note = parts.join('; ');
    return out;
  }

  async function gather(corridors, opts) {
    const e = U.env(opts), box = U.unionBox(corridors, 0.05);
    let fromMs = Infinity, toMs = -Infinity;
    for (const c of corridors) for (const t of [c.etaAt[0], c.etaAt[c.etaAt.length - 1]]) if (finite(t)) { fromMs = Math.min(fromMs, t); toMs = Math.max(toMs, t); }
    const inBox = (ev) => ev.lat >= box[0] - 0.05 && ev.lat <= box[2] + 0.05 && ev.lon >= box[1] - 0.05 && ev.lon <= box[3] + 0.05;
    const jobs = [];
    // MLB: one call for the plan's dates, kept 6 h (schedules change only with postponements).
    jobs.push((async () => {
      if (!finite(fromMs)) return null;
      const key = 'mlb.' + ymd(fromMs) + '.' + ymd(toMs);
      let ev = U.cacheGet(e.storage, key, 6 * 3600e3, e.now);
      if (!ev) { const j = await U.getJSON(e.fetchFn, mlbUrl(fromMs, toMs), { timeoutMs: BUDGET_MS - 500, signal: e.signal }); if (!j) return null; ev = parseMlb(j); U.cachePut(e.storage, key, ev, e.now); }
      return ev.filter(inBox);
    })());
    const sgKey = U.keyFor(opts, 'seatgeekClientId');
    jobs.push((async () => {
      if (!sgKey || !finite(fromMs)) return undefined;
      const key = 'sg.' + box.map((v) => v.toFixed(1)).join(',') + '.' + Math.floor(fromMs / 36e5);
      let ev = U.cacheGet(e.storage, key, 3 * 3600e3, e.now);
      if (!ev) { const j = await U.getJSON(e.fetchFn, seatgeekUrl(box, fromMs, toMs, sgKey), { timeoutMs: BUDGET_MS - 500, signal: e.signal }); if (!j) return null; ev = parseSeatgeek(j); U.cachePut(e.storage, key, ev, e.now); }
      return ev.filter(inBox);
    })());
    const placesIn = opts.places && (opts.places.schools || opts.places.worship) ? { schools: opts.places.schools || null, worship: opts.places.worship || null } : null;
    jobs.push(placesIn ? Promise.resolve(placesIn) : loadPlaces(corridors, { ...e, apiGet: opts.apiGet }).catch(() => null));
    const [mlb, sg, places] = await Promise.all(jobs);
    const events = mlb === null && !sg ? null : dedupe([...(mlb || []), ...(sg || [])]);
    return { events, places, noKey: !sgKey, mlbFailed: mlb === null };
  }

  async function fetch(corridors, opts = {}) {
    const ctrl = U.linked(opts.signal);
    const g = await U.within(gather(corridors, { ...opts, signal: ctrl ? ctrl.signal : opts.signal }), opts.budgetMs || BUDGET_MS, null, ctrl);
    const out = {};
    for (const c of corridors) {
      const r = evaluate(c, g ? g.events : null, g ? g.places : null);
      if (g && g.noKey) r.note = (r.note ? r.note + '; ' : '') + 'NFL/MLS/NBA/NHL/college/concerts need a SeatGeek client id (Settings)';
      if (!g) r.note = 'timed out';
      out[c.id] = r;
    }
    return out;
  }

  const provider = { id: ID, version: VERSION, channels: CHANNELS, needs: { network: true, key: 'seatgeekClientId' }, budgetMs: BUDGET_MS, fetch };
  U.register(provider);
  const api = { provider, CHANNELS, VENUES, HOURS, FILL, radiusM, phase, mlbUrl, parseMlb, seatgeekUrl, parseSeatgeek, dedupe, SCHOOL_YEAR, schoolDay, churchWindow, placesQuery, parsePlaces, evaluate, fetch };
  if (NODE) module.exports = api; else root.ApexCtxEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
