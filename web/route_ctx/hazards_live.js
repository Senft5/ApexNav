// Route context: live and seasonal road hazards (ROUTE_ENGINE_CONTRACT provider `hazards-live`), each at the sample's eta.
//
// Sources (checked 2026-11-03; all free):
//  - Flooding: NOAA National Water Prediction Service gauges (api.water.noaa.gov/nwps/v1, no key, CORS open, US Government
//    public domain): observed and forecast flood category per gauge (action / minor / moderate / major). USGS Water Services
//    instantaneous values (waterservices.usgs.gov/nwis/iv, no key, public domain; USGS asks for "U.S. Geological Survey" credit):
//    gage height over the last 24 h, so small creeks with no NWS flood stage still show a rise after rain. Asked by bbox.
//  - Work zones and closures: the USDOT WZDx feed registry (data.transportation.gov 69qe-yiui) lists, for our states,
//    Indiana DOT (in.carsprogram.org, no key, CORS open), Kentucky KYTC (storage.googleapis.com, no key, no CORS: fetched by our
//    Worker /api/ctx/workzones with only 0.5° tiles from the phone) and Ohio ODOT OHGO (publicapi.ohgo.com, free key, key slot
//    `ohgoApiKey`; OHGO terms: "AS IS", rate limited per key). NCDOT and VDOT feeds need keys too and are not wired yet.
//    OHGO's public API has no snowplough endpoint (its v1 resources: cameras, construction, dangerous slowdowns, digital signs,
//    incidents, travel delays, truck parking, weather sensor sites), so plough positions are not available.
//  - Fresh asphalt: no state DOT publishes completed resurfacing as a machine-readable list we could find; active paving
//    shows in the WZDx descriptions ("Paving Operations", "Resurfacing") and is labelled so.
//  - Harvest: USDA NASS Crop Progress (quickstats.nass.usda.gov, free key, key slot `nassApiKey`; public domain): % of corn and
//    soybeans harvested by state, weekly. Without the key, the USDA "Usual Planting and Harvesting Dates for U.S. Field Crops"
//    (Agricultural Handbook 628, 2010) most-active harvest windows, labelled as the typical year.
//  - National parks: monthly recreation visits 2023-2024 from NPS IRMA Visitor Use Statistics (irma.nps.gov/Stats, public
//    domain; tools/make_nps_seasonality.py regenerates the table), as each month's share against the park's average month.
//    Blue Ridge Parkway uses 2023 only (Hurricane Helene closed it from late September 2024).
//  - Fall colour: no free source forecasts peak colour per place (USA-NPN observations are sparse in the fall), so a
//    climatology: peak day = Oct 20 at 40°N and 250 m, 2.5 days later per degree south, 1 day earlier per 83 m of height
//    (matches the published typical peaks: Ohio DNR mid-late October; Great Smoky Mountains NPS early-mid October above
//    1,500 m, late October - early November below; WV high country early October). A typical year, ±1 week.
//
// Channels:
//   flood_risk       0-1  1 major/moderate flooding at a gauge within 1.5 km (observed, or forecast for the eta), 0.75 minor,
//                         0.5 action stage; a low-water crossing (opts.places.ford) 0.6-1 after a 0.5 ft+ rise at a gauge
//                         within 15 km or 25 mm+ of rain in 48 h (conditions' precip_48h_mm via opts.channels); 0 where a gauge
//                         within 15 km reads normal; NaN with no gauge nearby.
//   works            0 none, 1 work zone active at the eta, 2 closed to traffic; NaN where no feed covers the state.
//   harvest_season   0-1  the state's harvest at the eta (1 between 10 % and 90 % harvested, 0.5 at the edges) in daylight
//                         and the first hour after dark (farm machinery moves then); time only.
//   harvest_traffic  0-1  harvest_season x farmland_frac (NaN without land use).
//   park_busy        x    the park's visits this month against its average month (1 = average); 0 outside the parks; NaN
//                         where the engine gave no park channel and the sample is in no listed park box.
//   foliage          0-1  fall-colour bonus: closeness of the eta to the typical peak at this latitude and height x canopy
//                         (forest_frac or canopy_frac; NaN without them).
// Spans: flood (value 0-1), low-water (around a ford at risk), closure (hard), works (value 1, label the description), paving,
// farm-traffic, park-season (value the month's ratio), fall-colour. Points: gauge (a gauge at action stage or above, or rising).
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const U = NODE ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const SUN = NODE ? require('../sun.js') : root.ApexSun;
  const { finite, DEG } = U;
  const ID = 'hazards-live', VERSION = 1, BUDGET_MS = 7000;
  const CHANNELS = ['flood_risk', 'works', 'harvest_season', 'harvest_traffic', 'park_busy', 'foliage'];

  // ---- flooding ---------------------------------------------------------------------------------------------------------
  const CAT = { no_flooding: 0, action: 1, minor: 2, moderate: 3, major: 4 };
  const nwpsUrl = (b) => `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${b[1].toFixed(2)}&bbox.ymin=${b[0].toFixed(2)}&bbox.xmax=${b[3].toFixed(2)}&bbox.ymax=${b[2].toFixed(2)}&srid=EPSG_4326`;
  const usgsUrl = (b) => `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${b[1].toFixed(2)},${b[0].toFixed(2)},${b[3].toFixed(2)},${b[2].toFixed(2)}&parameterCd=00065&siteStatus=active&siteType=ST&period=P1D`;
  /** NWPS gauges → [{ id, name, lat, lon, cat, fcat, fAtMs }] (cat/fcat null when the gauge has no flood stages). */
  function parseNwps(json) {
    return ((json && json.gauges) || []).filter((g) => finite(g.latitude) && finite(g.longitude)).map((g) => {
      const o = (g.status && g.status.observed) || {}, f = (g.status && g.status.forecast) || {};
      const fAt = Date.parse(f.validTime);
      return { id: g.lid, name: g.name, lat: g.latitude, lon: g.longitude, cat: o.floodCategory in CAT ? CAT[o.floodCategory] : null,
        fcat: f.floodCategory in CAT ? CAT[f.floodCategory] : null, fAtMs: finite(fAt) && fAt > 0 ? fAt : null };
    });
  }
  /** USGS IV gage height → [{ id, name, lat, lon, ft, riseFt }] (riseFt: last minus the lowest of the last 24 h). */
  function parseUsgs(json) {
    const out = [];
    for (const t of (json && json.value && json.value.timeSeries) || []) {
      const si = t.sourceInfo || {}, g = si.geoLocation && si.geoLocation.geogLocation, nd = t.variable && t.variable.noDataValue;
      const vals = ((t.values && t.values[0] && t.values[0].value) || []).map((v) => parseFloat(v.value)).filter((v) => finite(v) && v !== nd);
      if (!g || !vals.length) continue;
      out.push({ id: si.siteCode && si.siteCode[0] && si.siteCode[0].value, name: si.siteName, lat: g.latitude, lon: g.longitude, ft: vals[vals.length - 1], riseFt: Math.round((vals[vals.length - 1] - Math.min(...vals)) * 100) / 100 });
    }
    return out;
  }
  /** The flood category that applies at `ms`: the forecast's when the eta is nearer its time than now, else the observed one. */
  function catAt(g, ms, now) {
    if (g.fcat !== null && g.fAtMs && Math.abs(ms - g.fAtMs) < Math.abs(ms - now)) return Math.max(g.cat || 0, g.fcat);
    return g.cat;
  }
  const RISK_OF_CAT = [0, 0.5, 0.75, 1, 1];

  // ---- work zones (WZDx 3.x / 4.x GeoJSON) ------------------------------------------------------------------------------
  const FEEDS = [
    { state: 'IN', url: () => 'https://in.carsprogram.org/carsapi_v1/api/wzdx', ttl: 30 * 60e3 },
    { state: 'OH', key: 'ohgoApiKey', url: (k) => `https://publicapi.ohgo.com/api/work-zones/wzdx/4.2?api-key=${encodeURIComponent(k)}`, ttl: 60 * 60e3 },
    { state: 'KY', relay: true, ttl: 30 * 60e3 },
  ];
  const CLOSED_RE = /\b(road|bridge|highway|street) (is )?closed\b|\bclosed to (all )?traffic\b|^closed\b(?!\s+intermittently)/i;
  const PAVING_RE = /\b(paving|resurfac\w*|milling|mill and fill|asphalt|overlay|chip seal)\b/i;
  const DIRS = { northbound: 0, eastbound: 90, southbound: 180, westbound: 270 };
  /** A WZDx feed → compact zones [{ road, dir, desc, startMs, endMs, closed, paving, line: [[lat, lon]] }] (detours dropped). */
  function parseWzdx(json) {
    const out = [];
    for (const f of (json && json.features) || []) {
      const p = f.properties || {}, c = p.core_details || p, g = f.geometry;
      if (!g || c.event_type === 'detour' || !Array.isArray(g.coordinates)) continue;
      const pts = (g.type === 'LineString' || g.type === 'MultiPoint' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : [])
        .filter((q) => finite(q[0]) && finite(q[1])).map((q) => [+q[1].toFixed(5), +q[0].toFixed(5)]);
      if (!pts.length) continue;
      const lanes = Array.isArray(p.lanes) ? p.lanes.filter((l) => !/shoulder/.test(l.type || '')) : [];
      const desc = String(c.description || '');
      const closed = p.vehicle_impact === 'all-lanes-closed' || (lanes.length > 0 && lanes.every((l) => l.status === 'closed')) || CLOSED_RE.test(desc);
      const startMs = Date.parse(p.start_date), endMs = Date.parse(p.end_date);
      out.push({ road: (c.road_names || []).filter(Boolean).join('/'), dir: c.direction || 'unknown', desc: desc.slice(0, 120),
        startMs: finite(startMs) ? startMs : null, endMs: finite(endMs) ? endMs : null, closed, paving: PAVING_RE.test(desc), multipoint: g.type === 'MultiPoint', line: pts });
    }
    return out;
  }
  /** Zones whose geometry comes within padDeg of the box. */
  const zonesInBox = (zones, b, pad = 0.01) => zones.filter((z) => z.line.some(([la, lo]) => la >= b[0] - pad && la <= b[2] + pad && lo >= b[1] - pad && lo <= b[3] + pad));
  const activeAt = (z, ms) => (z.startMs === null || ms >= z.startMs) && (z.endMs === null || ms <= z.endMs);
  /**
   * Corridor sample runs a zone covers: its line densified to 25 m, each point's nearest sample within 35 m, kept when the
   * route runs along it (heading within 30° of the zone's either way; for interstates the zone's direction must match), and
   * at least 3 samples (75 m) long: a crossing road touches one or two and is not on the route.
   */
  function matchZone(corridor, z) {
    const hits = new Set();
    if (z.multipoint && z.line.length === 1) { const s = U.nearestSample(corridor, z.line[0][0], z.line[0][1], 60); return s ? { point: s } : null; }
    const interstate = /\bI-?\s?\d/.test(z.road), want = DIRS[z.dir];
    for (let k = 1; k < z.line.length; k++) {
      const [a0, o0] = z.line[k - 1], [a1, o1] = z.line[k];
      const len = U.metres(a0, o0, a1, o1), steps = Math.max(1, Math.ceil(len / 25)), b = U.bearing(a0, o0, a1, o1);
      for (let s = 0; s <= steps; s++) {
        const la = a0 + (a1 - a0) * s / steps, lo = o0 + (o1 - o0) * s / steps;
        const m = U.nearestSample(corridor, la, lo, 35);
        if (!m) continue;
        const hd = corridor.heading[m.i], off = U.angleOff(hd, b);
        if (len > 5 && Math.min(off, Math.PI - off) > 30 * DEG) continue;
        if (interstate && want !== undefined && U.angleOff(hd, want * DEG) > 60 * DEG) continue;
        hits.add(m.i);
      }
    }
    const list = [...hits].sort((x, y) => x - y).map((i) => ({ i }));
    const r = U.runs(list, 3).filter(([a, b]) => b - a >= 2);
    return r.length ? { runs: r } : null;
  }

  // ---- harvest ----------------------------------------------------------------------------------------------------------
  // Most-active harvest (USDA Ag Handbook 628, 2010), [month, day] from-to, corn then soybeans; the union is the season.
  const HARVEST = {
    OH: [[[10, 5], [11, 10]], [[9, 28], [10, 25]]], IN: [[[9, 28], [11, 5]], [[9, 25], [10, 25]]], KY: [[[9, 5], [10, 25]], [[10, 1], [11, 10]]],
    TN: [[[8, 25], [10, 5]], [[10, 5], [11, 15]]], NC: [[[8, 25], [10, 10]], [[10, 20], [12, 1]]], VA: [[[9, 1], [10, 25]], [[10, 15], [11, 30]]],
    WV: [[[9, 25], [11, 1]], [[10, 1], [11, 5]]],
  };
  const doyOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  /** Typical-year harvest activity 0-1 for a state at a local date: 1 in a most-active window, tapering to 0 over 10 days. */
  function harvestTypical(state, lt) {
    const w = HARVEST[state];
    if (!w) return null;
    let best = 0;
    for (const [[m0, d0], [m1, d1]] of w) {
      const a = doyOf(lt.y, m0, d0), b = doyOf(lt.y, m1, d1);
      const v = lt.doy >= a && lt.doy <= b ? 1 : Math.max(0, 1 - Math.min(Math.abs(lt.doy - a), Math.abs(lt.doy - b)) / 10);
      best = Math.max(best, v);
    }
    return Math.round(best * 100) / 100;
  }
  const nassUrl = (key, state, year, crop) => `https://quickstats.nass.usda.gov/api/api_GET/?key=${encodeURIComponent(key)}&source_desc=SURVEY&sector_desc=CROPS`
    + `&statisticcat_desc=PROGRESS&unit_desc=${encodeURIComponent('PCT HARVESTED')}&commodity_desc=${crop}&agg_level_desc=STATE&state_alpha=${state}&year=${year}&format=JSON`;
  /** NASS answer → [{ weekEndingMs, pct }] sorted (the "Value" is a string like "45"). */
  function parseNass(json) {
    return ((json && json.data) || []).map((r) => ({ weekEndingMs: Date.parse(r.week_ending), pct: parseFloat(String(r.Value).replace(/,/g, '')) }))
      .filter((r) => finite(r.weekEndingMs) && finite(r.pct)).sort((a, b) => a.weekEndingMs - b.weekEndingMs);
  }
  /** Activity from weekly % harvested at ms (latest report ≤ ms + 3 days): 1 between 10 and 90 %, 0.5 at 3-10 / 90-97 %, else 0. */
  function harvestFromProgress(rows, ms) {
    const r = rows.filter((x) => x.weekEndingMs <= ms + 3 * 864e5).pop();
    if (!r || ms - r.weekEndingMs > 14 * 864e5) return null;
    return r.pct >= 10 && r.pct <= 90 ? 1 : (r.pct >= 3 && r.pct < 10) || (r.pct > 90 && r.pct <= 97) ? 0.5 : 0;
  }

  // ---- national parks ---------------------------------------------------------------------------------------------------
  // Monthly recreation visits / average month (NPS IRMA 2023-2024; tools/make_nps_seasonality.py). box [s, w, n, e]; road:
  // a router road name that marks the park road where a box can't (the Parkway and Skyline Drive are long and thin).
  const PARKS = [
    { code: 'GRSM', name: 'Great Smoky Mountains', box: [35.43, -84.02, 35.79, -83.10], m: [0.41, 0.46, 0.82, 0.93, 1.18, 1.38, 1.41, 1.15, 1.09, 1.51, 0.94, 0.72] },
    { code: 'BLRI', name: 'Blue Ridge Parkway', road: /blue ridge (pkwy|parkway)/i, m: [0.39, 0.42, 0.55, 0.95, 1.05, 1.33, 1.41, 1.32, 1.47, 1.6, 0.96, 0.54] },
    { code: 'SHEN', name: 'Shenandoah', road: /skyline (dr|drive)/i, box: [38.03, -78.87, 38.93, -78.13], boxNeedsRoad: true, m: [0.21, 0.29, 0.53, 0.94, 1.2, 1.27, 1.32, 1.28, 1.1, 2.44, 1.12, 0.28] },
    { code: 'NERI', name: 'New River Gorge', box: [37.75, -81.15, 38.10, -80.85], m: [0.27, 0.28, 0.58, 0.89, 1.37, 1.59, 1.98, 1.64, 1.26, 1.22, 0.64, 0.29] },
    { code: 'CUVA', name: 'Cuyahoga Valley', box: [41.13, -81.66, 41.43, -81.49], m: [0.36, 0.42, 0.8, 1.05, 1.36, 1.49, 1.67, 1.39, 1.13, 1.2, 0.62, 0.5] },
    { code: 'MACA', name: 'Mammoth Cave', box: [37.10, -86.32, 37.25, -85.95], m: [0.3, 0.42, 1.2, 1.11, 1.13, 1.47, 1.69, 1.27, 0.95, 1.27, 0.68, 0.5] },
  ];
  const inBox = (b, lat, lon) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  /** Edge names per sample (corridor.edges [{ fromM, toM, name }] if the engine passes them). */
  function namesAt(corridor) {
    const n = corridor.lat.length, out = new Array(n).fill('');
    const d = corridor.distM;
    for (const e of corridor.edges || []) {
      if (!e || !e.name || !finite(e.fromM)) continue;
      let lo = 0, hi = n;                                                     // first sample at or after fromM
      while (lo < hi) { const mid = (lo + hi) >> 1; if (d[mid] < e.fromM) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < n && d[i] <= e.toM; i++) out[i] = String(e.name);
    }
    return out;
  }

  // ---- fall colour ------------------------------------------------------------------------------------------------------
  /** Typical peak-colour day of year at a latitude and height (see header). */
  const peakDoy = (lat, elevM) => 293 + 2.5 * (40 - lat) - (finite(elevM) ? (elevM - 250) / 83 : 0);
  /** 0-1 seasonal colour: 1 within 5 days of the peak, falling to 0 at 16 days. */
  function foliageSeason(lat, elevM, doy) {
    const off = Math.abs(doy - peakDoy(lat, elevM));
    return off <= 5 ? 1 : off >= 16 ? 0 : Math.round((1 - (off - 5) / 11) * 100) / 100;
  }

  // ---- evaluation (pure) ------------------------------------------------------------------------------------------------
  /**
   * data: { gauges: [nwps...] | null, usgs: [...] | null, zones: { [state]: zone[] | null }, harvest: { [state]: rows | null },
   * now } → channels, spans and points for one corridor.
   */
  function evaluate(corridor, data, opts = {}) {
    const n = corridor.lat.length, ch = {}, d = corridor.distM, spans = [], points = [];
    for (const c of CHANNELS) ch[c] = U.nanArray(n);
    const now = finite(data.now) ? data.now : Date.now();
    const lts = new Array(n), states = new Array(n);
    for (let i = 0; i < n; i++) if (finite(corridor.etaAt[i])) { lts[i] = U.localTime(corridor.etaAt[i], corridor.lat[i], corridor.lon[i]); states[i] = U.stateAt(corridor.lat[i], corridor.lon[i]); }

    // Flooding: gauges set the risk around them; a gauge within 15 km that reads normal makes the rest 0.
    const gauges = data.gauges || [], usgs = data.usgs || [];
    if (data.gauges || data.usgs) {
      for (const g of [...gauges, ...usgs]) for (const { i } of U.samplesWithin(corridor, g.lat, g.lon, 15000)) if (!finite(ch.flood_risk[i])) ch.flood_risk[i] = 0;
      for (const g of gauges) {
        const near = U.samplesWithin(corridor, g.lat, g.lon, 1500);
        let worst = 0;
        for (const { i } of near) { const c = catAt(g, corridor.etaAt[i], now); if (c >= 1) { ch.flood_risk[i] = Math.max(ch.flood_risk[i] || 0, RISK_OF_CAT[c]); worst = Math.max(worst, c); } }
        if (worst >= 1) {
          const c0 = near.reduce((x, y) => (y.dM < x.dM ? y : x));
          points.push({ atM: d[c0.i], kind: 'gauge', value: worst, label: `${g.name}: ${['', 'action stage', 'minor flooding', 'moderate flooding', 'major flooding'][worst]}` });
        }
      }
      for (const g of usgs) if (g.riseFt >= 0.5) {
        const c0 = U.nearestSample(corridor, g.lat, g.lon, 1500);
        if (c0) points.push({ atM: c0.atM, kind: 'gauge', value: g.riseFt, label: `${g.name}: up ${g.riseFt.toFixed(1)} ft in 24 h` });
      }
    }
    const rain48 = U.chan(corridor, opts, ['precip_48h_mm']);
    for (const f of (opts.places && opts.places.ford) || []) {
      const s = U.nearestSample(corridor, f.lat, f.lon, 30);
      if (!s) continue;
      const rise = usgs.filter((g) => U.metres(f.lat, f.lon, g.lat, g.lon) <= 15000).reduce((m, g) => Math.max(m, g.riseFt), -Infinity);
      const wet = rain48 && finite(rain48[s.i]) ? rain48[s.i] : null;
      if (!finite(rise) && wet === null) continue;
      const risk = Math.max(finite(rise) && rise >= 0.5 ? Math.min(1, 0.6 + rise * 0.2) : 0, wet !== null && wet >= 25 ? Math.min(1, 0.6 + (wet - 25) / 50) : 0);
      for (const { i } of U.samplesWithin(corridor, f.lat, f.lon, 60)) ch.flood_risk[i] = Math.max(finite(ch.flood_risk[i]) ? ch.flood_risk[i] : 0, risk);
      if (risk > 0) spans.push({ fromM: Math.max(0, s.atM - 50), toM: s.atM + 50, kind: 'low-water', value: Math.round(risk * 100) / 100, label: 'Low-water crossing after rain' });
    }
    spans.push(...U.spansWhere(d, (i) => ch.flood_risk[i] >= 0.5 && !spans.some((s) => s.kind === 'low-water' && d[i] >= s.fromM && d[i] <= s.toM), 'flood', { valueAt: (i) => ch.flood_risk[i], label: 'Flooding near the road', joinM: 200 }));

    // Work zones.
    const zones = data.zones || {};
    for (let i = 0; i < n; i++) if (states[i] && zones[states[i]]) ch.works[i] = 0;
    for (const st of Object.keys(zones)) for (const z of zones[st] || []) {
      const m = matchZone(corridor, z);
      if (!m) continue;
      if (m.point) { if (activeAt(z, corridor.etaAt[m.point.i])) points.push({ atM: m.point.atM, kind: z.closed ? 'closure' : 'works', label: z.desc || z.road }); continue; }
      for (const [a, b] of m.runs) {
        const act = []; for (let i = a; i <= b; i++) if (activeAt(z, corridor.etaAt[i])) { act.push(i); ch.works[i] = Math.max(finite(ch.works[i]) ? ch.works[i] : 0, z.closed ? 2 : 1); }
        if (!act.length) continue;
        const kind = z.closed ? 'closure' : z.paving ? 'paving' : 'works';
        spans.push({ fromM: d[act[0]], toM: d[act[act.length - 1]], kind, value: z.closed ? 2 : 1, label: `${z.road ? z.road + ': ' : ''}${z.desc}`.slice(0, 120) });
      }
    }

    // Harvest.
    const farm = U.chan(corridor, opts, ['farmland_frac']);
    const harvest = data.harvest || {};
    for (let i = 0; i < n; i++) {
      const lt = lts[i], st = states[i];
      if (!lt || !st) continue;
      const rows = harvest[st];
      let h = rows ? harvestFromProgress(rows, corridor.etaAt[i]) : null;
      if (h === null) h = harvestTypical(st, lt);
      if (h === null) continue;
      if (SUN) { const alt = SUN.sunPosition(new Date(corridor.etaAt[i]), corridor.lat[i], corridor.lon[i]).altitude; if (alt < -12 * DEG) h = 0; }
      ch.harvest_season[i] = h;
      if (farm && finite(farm[i])) ch.harvest_traffic[i] = Math.round(h * farm[i] * 100) / 100;
    }
    spans.push(...U.spansWhere(d, (i) => ch.harvest_traffic[i] >= 0.4, 'farm-traffic', { valueAt: (i) => ch.harvest_traffic[i], label: 'Harvest: farm machinery on the road', joinM: 300, minM: 200 }));

    // Parks.
    const parkCh = U.chan(corridor, opts, ['park']), names = namesAt(corridor);
    for (let i = 0; i < n; i++) {
      if (!lts[i]) continue;
      let v = null;
      for (const p of PARKS) {
        const byRoad = p.road && p.road.test(names[i]), byBox = p.box && inBox(p.box, corridor.lat[i], corridor.lon[i]) && !(p.boxNeedsRoad && !byRoad);
        if (byRoad || (byBox && !(parkCh && parkCh[i] === 0))) { v = p.m[lts[i].m - 1]; break; }
      }
      ch.park_busy[i] = v !== null ? v : 0;
    }
    spans.push(...U.spansWhere(d, (i) => ch.park_busy[i] >= 1.3, 'park-season', { valueAt: (i) => ch.park_busy[i], label: 'Busy park season', joinM: 300 }));

    // Fall colour.
    const canopy = U.chan(corridor, opts, ['canopy_frac', 'forest_frac']), elev = U.chan(corridor, opts, ['elev_m']);
    if (canopy) for (let i = 0; i < n; i++) {
      if (!lts[i] || !finite(canopy[i])) continue;
      ch.foliage[i] = Math.round(foliageSeason(corridor.lat[i], elev ? elev[i] : null, lts[i].doy) * canopy[i] * 100) / 100;
    }
    spans.push(...U.spansWhere(d, (i) => ch.foliage[i] >= 0.5, 'fall-colour', { valueAt: (i) => ch.foliage[i], label: 'Fall colour (typical peak)', joinM: 300, minM: 300 }));

    const notes = [];
    if (!data.gauges && !data.usgs) notes.push('no river gauges');
    const missingStates = [...new Set(states.filter((s) => s && !zones[s]))];
    if (missingStates.length) notes.push('no work-zone feed for ' + missingStates.join(', ') + (missingStates.includes('OH') ? ' (Ohio needs an OHGO key)' : ''));
    if (!canopy) notes.push('no canopy: foliage unknown');
    if (!farm) notes.push('no land use: harvest_traffic unknown');
    if (!elev && canopy) notes.push('fall colour without elevation');
    notes.push('no snowplough feed (OHGO publishes none)');
    return { status: notes.length > 1 ? 'partial' : 'ok', note: notes.join('; '), channels: ch, spans: spans.sort((a, b) => a.fromM - b.fromM), points };
  }

  // ---- fetching ---------------------------------------------------------------------------------------------------------
  async function gather(corridors, opts) {
    const e = U.env(opts), box = U.unionBox(corridors, 0.15), now = e.now;
    const states = new Set();
    for (const c of corridors) for (let i = 0; i < c.lat.length; i += 40) { const s = U.stateAt(c.lat[i], c.lon[i]); if (s) states.add(s); }
    const cached = async (key, ttl, get) => {
      const c = U.cacheGet(e.storage, key, ttl, now);
      if (c !== undefined) return c;
      const v = await get();
      if (v !== null) U.cachePut(e.storage, key, v, now);
      return v;
    };
    const bkey = box.map((v) => v.toFixed(1)).join(',');
    const tm = { timeoutMs: BUDGET_MS - 500, signal: e.signal };
    const gaugesJob = cached('nwps.' + bkey, 15 * 60e3, async () => { const j = await U.getJSON(e.fetchFn, nwpsUrl(box), tm); return j ? parseNwps(j) : null; });
    const usgsJob = cached('usgs.' + bkey, 15 * 60e3, async () => { const j = await U.getJSON(e.fetchFn, usgsUrl(box), tm); return j ? parseUsgs(j) : null; });
    const zones = {};
    const zoneJobs = FEEDS.filter((f) => states.has(f.state)).map(async (f) => {
      if (f.relay) {
        const base = opts.apiBase !== undefined ? opts.apiBase : root.ApexSync ? root.ApexSync.apiBase : null;
        if (base === null || base === undefined) return;
        const tiles = U.cellsAlong(corridors, 0.5, 0.02, 8).join(',');
        const v = await cached('wz.' + f.state + '.' + tiles, f.ttl, async () => {
          const j = await U.getJSON(e.fetchFn, `${base}/api/ctx/workzones?state=${f.state}&tiles=${tiles}`, { ...tm, headers: { 'x-apexnav': '1' } });
          return j && Array.isArray(j.features) ? parseWzdx(j) : null;
        });
        if (v) zones[f.state] = v;
        return;
      }
      const k = f.key ? U.keyFor(opts, f.key) : null;
      if (f.key && !k) return;
      // A statewide feed (INDOT is ~4 MB): cache only the zones inside the plan's box, under the box key.
      const v = await cached('wz.' + f.state + '.' + bkey, f.ttl, async () => {
        const j = await U.getJSON(e.fetchFn, f.url(k), tm);
        return j ? zonesInBox(parseWzdx(j), box) : null;
      });
      if (v) zones[f.state] = v;
    });
    const harvest = {};
    const nassKey = U.keyFor(opts, 'nassApiKey');
    const year = new Date(now).getUTCFullYear();
    const harvestJobs = nassKey ? [...states].filter((s) => HARVEST[s]).map(async (st) => {
      const rows = await cached(`nass.${st}.${year}`, 12 * 3600e3, async () => {
        const [corn, soy] = await Promise.all(['CORN', 'SOYBEANS'].map((crop) => U.getJSON(e.fetchFn, nassUrl(nassKey, st, year, crop), tm)));
        if (!corn && !soy) return null;
        // the season is the union: per week, the crop whose harvest is most in progress
        const byWeek = new Map();
        for (const r of [...parseNass(corn), ...parseNass(soy)]) {
          const act = r.pct >= 10 && r.pct <= 90 ? 2 : r.pct > 3 && r.pct < 97 ? 1 : 0, prev = byWeek.get(r.weekEndingMs);
          if (!prev || act > prev.act) byWeek.set(r.weekEndingMs, { ...r, act });
        }
        return [...byWeek.values()].sort((a, b) => a.weekEndingMs - b.weekEndingMs).map(({ weekEndingMs, pct }) => ({ weekEndingMs, pct }));
      });
      if (rows && rows.length) harvest[st] = rows;
    }) : [];
    const [gauges, usgs] = await Promise.all([gaugesJob, usgsJob, ...zoneJobs, ...harvestJobs]);
    return { gauges, usgs, zones, harvest, now };
  }

  async function fetch(corridors, opts = {}) {
    const empty = { gauges: null, usgs: null, zones: {}, harvest: {}, now: U.env(opts).now };
    const ctrl = U.linked(opts.signal);
    const data = await U.within(gather(corridors, { ...opts, signal: ctrl ? ctrl.signal : opts.signal }).catch(() => empty), opts.budgetMs || BUDGET_MS, empty, ctrl);
    const out = {};
    for (const c of corridors) out[c.id] = evaluate(c, data, opts);
    return out;
  }

  const provider = { id: ID, version: VERSION, channels: CHANNELS, needs: { network: true, key: 'ohgoApiKey' }, budgetMs: BUDGET_MS, fetch };
  U.register(provider);
  const api = { provider, CHANNELS, CAT, FEEDS, HARVEST, PARKS, nwpsUrl, usgsUrl, parseNwps, parseUsgs, catAt, parseWzdx, zonesInBox, activeAt, matchZone,
    harvestTypical, nassUrl, parseNass, harvestFromProgress, peakDoy, foliageSeason, evaluate, fetch };
  if (NODE) module.exports = api; else root.ApexCtxHazardsLive = api;
})(typeof window !== 'undefined' ? window : globalThis);
