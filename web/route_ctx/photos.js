// Route context: where people stop to take pictures, and what the signs say (ROUTE_ENGINE_CONTRACT provider `photos`).
// (web/photos.js is a different thing: members' own pictures.)
//
// Sources, terms and attribution (checked 2026-11-03):
//  - Wikimedia Commons geosearch (commons.wikimedia.org/w/api.php list=geosearch, files namespace; free, no key, CORS with
//    origin=*). Only file positions are used, never the images; positions are facts, the files' own licences (CC BY-SA etc.)
//    don't attach to a count. API etiquette: an Api-User-Agent naming the app, serial requests (2 at a time), cached 30 days
//    per 0.02° cell. Attribution: "Photo locations: Wikimedia Commons".
//  - Flickr API (flickr.photos.search, free key for non-commercial use, key slot `flickrApiKey`; Flickr API Terms: no more than
//    3,600 queries an hour per key, attribution "This product uses the Flickr API but is not endorsed or certified by
//    SmugMug, Inc."). Owner + rounded position per photo only. Cached 30 days per 0.05° cell.
//  - Mapillary map features (graph.mapillary.com/map_features, free token, key slot `mapillaryToken`; data CC BY-SA 4.0,
//    attribution "Traffic signs © Mapillary, CC BY-SA"): detected speed-limit and curve-warning signs. Cached 30 days per
//    0.05° cell (Mapillary's bbox limit is 0.01 square degrees).
// Each service gets a cell's bbox, never the route or a position.
//
// Channels:
//   photo_spots        count  distinct photo spots within 250 m of the sample (Commons positions rounded to ~11 m, so a
//                             batch upload at one spot counts once, plus Flickr owner+spot pairs); NaN where a cell wasn't had.
//   photo_score        0-1    1 − exp(−spots / 8): a scenic signal that saturates (8 spots ≈ 0.63, 20 ≈ 0.92). Town centres
//                             score high too (people photograph cities): the engine counts it only with rural land use.
//   sign_maxspeed_mps  m/s    the posted limit from the last speed-limit sign passed (Mapillary), carried 2 km or to the next
//                             sign; fills a missing OSM maxspeed; NaN without a sign (or without a token).
//   curve_sign         0/1    within 250 m after a curve-warning sign; NaN without a token.
// Points: speed-sign (value m/s, label "45 mph"), curve-sign (label the sign's kind). Spans: photo-spot (photo_score ≥ 0.6).
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const U = NODE ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const { finite, DEG } = U;
  const ID = 'photos', VERSION = 1, BUDGET_MS = 6000, TTL = 30 * 864e5;
  const CHANNELS = ['photo_spots', 'photo_score', 'sign_maxspeed_mps', 'curve_sign'];
  const C_CELL = 0.02, F_CELL = 0.05, M_CELL = 0.05, MAX_CELLS = 80, NEAR_M = 250, MPH = 0.44704;
  const UA = 'Vetta/1.0 (route scenery; https://github.com/Senft5/ApexNav)';

  // ---- Wikimedia Commons ------------------------------------------------------------------------------------------------
  /** One cell's geosearch: files (namespace 6) in its bbox, up to 500. Commons wants top|left|bottom|right = n|w|s|e. */
  const commonsUrl = (b) => `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsbbox=${b[2].toFixed(4)}|${b[1].toFixed(4)}|${b[0].toFixed(4)}|${b[3].toFixed(4)}&gsnamespace=6&gslimit=500&format=json&origin=*`;
  /** Commons answer → distinct spots [[lat, lon]] (rounded to 1e-4°, ~11 m) and whether the cell hit the 500 cap. */
  function parseCommons(json) {
    const list = (json && json.query && json.query.geosearch) || [];
    const seen = new Set(), spots = [];
    for (const g of list) {
      if (!finite(g.lat) || !finite(g.lon)) continue;
      const k = g.lat.toFixed(4) + ',' + g.lon.toFixed(4);
      if (!seen.has(k)) { seen.add(k); spots.push([+g.lat.toFixed(4), +g.lon.toFixed(4)]); }
    }
    return { spots, capped: list.length >= 500 };
  }

  // ---- Flickr -----------------------------------------------------------------------------------------------------------
  const flickrUrl = (b, key) => `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${encodeURIComponent(key)}&bbox=${b[1].toFixed(4)},${b[0].toFixed(4)},${b[3].toFixed(4)},${b[2].toFixed(4)}`
    + '&has_geo=1&content_types=0&extras=geo&per_page=250&format=json&nojsoncallback=1';
  /** Flickr answer → distinct owner+spot pairs as spots [[lat, lon]] (rounded to 1e-3°, ~110 m, per owner). */
  function parseFlickr(json) {
    if (!json || json.stat !== 'ok') return null;
    const seen = new Set(), spots = [];
    for (const p of (json.photos && json.photo) || (json.photos && json.photos.photo) || []) {
      const lat = parseFloat(p.latitude), lon = parseFloat(p.longitude);
      if (!finite(lat) || !finite(lon) || (lat === 0 && lon === 0)) continue;
      const k = p.owner + '@' + lat.toFixed(3) + ',' + lon.toFixed(3);
      if (!seen.has(k)) { seen.add(k); spots.push([+lat.toFixed(4), +lon.toFixed(4)]); }
    }
    return { spots };
  }

  // ---- Mapillary --------------------------------------------------------------------------------------------------------
  const mapillaryUrl = (b, token) => `https://graph.mapillary.com/map_features?access_token=${encodeURIComponent(token)}&fields=id,object_value,geometry,aligned_direction`
    + `&bbox=${b[1].toFixed(4)},${b[0].toFixed(4)},${b[3].toFixed(4)},${b[2].toFixed(4)}&limit=2000`;
  const SPEED_RE = /^regulatory--maximum-speed-limit-(\d+)--/, CURVE_RE = /^warning--(curve|turn|winding-road|double-curve|double-turn|hairpin|road-bump)?[-\w]*?(curve|turn|winding|hairpin)/;
  /** Mapillary answer → signs [{ lat, lon, kind: 'speed'|'curve', mph?, facing (radians|null), value }]. */
  function parseMapillary(json) {
    const out = [];
    for (const f of (json && json.data) || []) {
      const v = String(f.object_value || ''), g = f.geometry && f.geometry.coordinates;
      if (!g || !finite(g[0]) || !finite(g[1])) continue;
      const facing = finite(f.aligned_direction) ? f.aligned_direction * DEG : null;
      const m = v.match(SPEED_RE);
      if (m) { const mph = +m[1]; if (mph >= 5 && mph <= 85 && mph % 5 === 0) out.push({ lat: g[1], lon: g[0], kind: 'speed', mph, facing, value: v }); continue; }
      if (/^warning--/.test(v) && CURVE_RE.test(v)) out.push({ lat: g[1], lon: g[0], kind: 'curve', facing, value: v });
    }
    return out;
  }
  /** Does a sign apply to traffic on this heading? A sign faces the traffic it is for (aligned_direction ≈ heading + 180°). */
  const appliesTo = (sign, heading) => sign.facing === null || !finite(heading) || U.angleOff(sign.facing, heading + Math.PI) < 50 * DEG;

  // ---- evaluation (pure) ------------------------------------------------------------------------------------------------
  /** data: { spots: [[lat, lon]] | null, cellsHad: Set(keys of Commons cells known), signs: [...] | null } */
  function evaluate(corridor, data) {
    const n = corridor.lat.length, ch = {};
    for (const c of CHANNELS) ch[c] = U.nanArray(n);
    const spans = [], points = [], d = corridor.distM;
    if (data.spots) {
      const had = data.cellsHad || null;
      const counts = new Float32Array(n);
      // spot → samples within 250 m (grid index), counted once per sample
      for (const [la, lo] of data.spots) for (const { i } of U.samplesWithin(corridor, la, lo, NEAR_M)) counts[i]++;
      for (let i = 0; i < n; i++) {
        if (had && !had.has(U.cellOf(corridor.lat[i], corridor.lon[i], C_CELL))) continue;
        ch.photo_spots[i] = counts[i];
        ch.photo_score[i] = Math.round((1 - Math.exp(-counts[i] / 8)) * 100) / 100;
      }
      spans.push(...U.spansWhere(d, (i) => ch.photo_score[i] >= 0.6, 'photo-spot', { valueAt: (i) => ch.photo_score[i], label: 'Where people stop for photos', joinM: 150, minM: 100 }));
    }
    if (data.signs) {
      ch.curve_sign.fill(0);
      const hits = [];
      for (const s of data.signs) {
        const m = U.nearestSample(corridor, s.lat, s.lon, 25);
        if (m && appliesTo(s, corridor.heading[m.i])) hits.push({ ...s, i: m.i, atM: m.atM });
      }
      hits.sort((a, b) => a.i - b.i);
      let lim = null, limAt = -Infinity, h = 0;
      for (let i = 0; i < n; i++) {
        while (h < hits.length && hits[h].i <= i) {
          const s = hits[h++];
          if (s.kind === 'speed') { lim = s.mph * MPH; limAt = d[s.i]; }
          else for (let j = s.i; j < n && d[j] - d[s.i] <= 250; j++) ch.curve_sign[j] = 1;
        }
        if (lim !== null && d[i] - limAt <= 2000) ch.sign_maxspeed_mps[i] = Math.round(lim * 100) / 100;
      }
      for (const s of hits) points.push(s.kind === 'speed'
        ? { atM: s.atM, kind: 'speed-sign', value: Math.round(s.mph * MPH * 100) / 100, label: `${s.mph} mph` }
        : { atM: s.atM, kind: 'curve-sign', label: s.value.replace(/^warning--/, '').replace(/--g\d+$/, '').replace(/-/g, ' ') });
    }
    const notes = [];
    if (!data.spots) notes.push('no photo positions');
    else if (data.partial) notes.push('photo positions for part of the route');
    if (!data.signs) notes.push(data.noToken ? 'traffic signs need a Mapillary token' : 'no traffic signs');
    if (data.noFlickr) notes.push('Flickr not used (no key)');
    const out = { status: !data.spots && !data.signs ? 'unavailable' : notes.length ? 'partial' : 'ok', channels: ch, spans, points };
    if (notes.length) out.note = notes.join('; ');
    return out;
  }

  // ---- fetching ---------------------------------------------------------------------------------------------------------
  async function cells(kind, keys, size, e, get, limit = 2) {
    const have = new Map(), missing = [];
    for (const k of keys) { const c = U.cacheGet(e.storage, kind + '.' + k, TTL, e.now); if (c !== undefined) have.set(k, c); else missing.push(k); }
    await U.pool(missing.slice(0, MAX_CELLS).map((k) => async () => {
      const v = await get(U.cellBox(k, size), k);
      if (v) { have.set(k, v); U.cachePut(e.storage, kind + '.' + k, v, e.now); }
    }), limit);
    return have;
  }
  async function gather(corridors, opts, sink) {
    const e = U.env(opts), tm = { timeoutMs: 5000, signal: e.signal };
    const cKeys = U.cellsAlong(corridors, C_CELL, 0.003, 2);
    const commons = cells('cm', cKeys, C_CELL, e, async (b) => {
      const j = await U.getJSON(e.fetchFn, commonsUrl(b), { ...tm, headers: { 'Api-User-Agent': UA } });
      return j ? parseCommons(j) : null;
    });
    const fk = U.keyFor(opts, 'flickrApiKey');
    const flickr = fk ? cells('fl', U.cellsAlong(corridors, F_CELL, 0.003, 4), F_CELL, e, async (b) => { const j = await U.getJSON(e.fetchFn, flickrUrl(b, fk), tm); return parseFlickr(j); }) : Promise.resolve(null);
    const mt = U.keyFor(opts, 'mapillaryToken');
    const mapillary = mt ? cells('mp', U.cellsAlong(corridors, M_CELL, 0.001, 2), M_CELL, e, async (b) => { const j = await U.getJSON(e.fetchFn, mapillaryUrl(b, mt), tm); return j ? parseMapillary(j) : null; }, 3) : Promise.resolve(null);
    const [cm, fl, mp] = await Promise.all([commons, flickr, mapillary]);
    sink.cKeys = cKeys;
    sink.cm = cm; sink.fl = fl; sink.mp = mp; sink.noToken = !mt; sink.noFlickr = !fk;
    return sink;
  }

  async function fetch(corridors, opts = {}) {
    const sink = {};
    const ctrl = U.linked(opts.signal);
    await U.within(gather(corridors, { ...opts, signal: ctrl ? ctrl.signal : opts.signal }, sink).catch(() => sink), opts.budgetMs || BUDGET_MS, sink, ctrl);
    const cm = sink.cm || new Map();
    const spots = [];
    for (const v of cm.values()) spots.push(...v.spots);
    if (sink.fl) for (const v of sink.fl.values()) spots.push(...v.spots);
    const signs = sink.mp ? [...sink.mp.values()].flat() : null;
    const data = { spots: cm.size ? spots : null, cellsHad: new Set(cm.keys()), partial: !!sink.cKeys && cm.size < sink.cKeys.length, signs, noToken: sink.noToken !== false, noFlickr: sink.noFlickr !== false };
    const out = {};
    for (const c of corridors) out[c.id] = evaluate(c, data);
    return out;
  }

  const provider = { id: ID, version: VERSION, channels: CHANNELS, needs: { network: true, key: 'mapillaryToken' }, budgetMs: BUDGET_MS, fetch };
  U.register(provider);
  const api = { provider, CHANNELS, commonsUrl, parseCommons, flickrUrl, parseFlickr, mapillaryUrl, parseMapillary, appliesTo, evaluate, fetch };
  if (NODE) module.exports = api; else root.ApexCtxPhotos = api;
})(typeof window !== 'undefined' ? window : globalThis);
