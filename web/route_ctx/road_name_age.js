// Old road or new subdivision street, from the road's name (provider 'road_name_age', ROUTE_ENGINE_CONTRACT.md).
// Roads laid down before the car follow ridges, creeks and mills and kept the names: Old ..., ... Pike, ... Hollow,
// ... Ridge, ... Creek, ... Run, ... Mill, ... Ferry, Church ..., School House .... Post-war subdivisions name their
// streets Court, Circle, Way, Lane, Trail, Estates, Pointe, Chase, Commons. A WEAK PRIOR: validated on real Cincinnati
// roads (tests/fixtures/route_ctx/road_names_cincinnati.json, the numbers in VALIDATION below and in the test), it is
// right more often than not where it speaks, and silent on most names. Weight it well below measured features.
//
// Source and licence: road names from the router's edges when the corridor carries them, otherwise from the OpenFreeMap
// tiles (osm_tiles.js roadNames): OpenStreetMap contributors, ODbL 1.0. Update cadence: as the tiles. No network of its
// own beyond the shared tile cache.
//
// Channels:
//   name_age   -1..1  +1 old-road name cues, -1 subdivision cues, 0 a name with neither; NaN where no name is known.
//                     Cues and weights: CUES below. Where the map calls the road tertiary or bigger, subdivision cues
//                     count half (an arterial called "... Way" is rarely a cul-de-sac street).
// Spans: 'old_road_name' / 'subdivision_name' (label = the name, value = the score) for named stretches with |score| >= 0.4.
// Confidence: CONFIDENCE.weight is the suggested weight relative to a measured feature (1.0); see VALIDATION.
(function (root) {
  'use strict';
  const G = root.ApexOsmCommon || (typeof require === 'function' ? require('./osm_common.js') : null);
  const Ctx = root.ApexRouteCtx;

  // word (lowercase, after expanding abbreviations) -> weight; prefix cues only count as the first word
  const CUES = {
    prefix: { old: 1.0, olde: -0.6 },
    word: {
      pike: 0.9, turnpike: 0.9, plank: 0.7, ferry: 0.8, mill: 0.6, mills: 0.5, hollow: 0.6, holler: 0.6, ridge: 0.5, creek: 0.5,
      run: 0.3, fork: 0.4, branch: 0.4, lick: 0.5, bottom: 0.4, bottoms: 0.4, gap: 0.4, knob: 0.4, ford: 0.5, furnace: 0.6,
      forge: 0.5, tavern: 0.6, church: 0.5, chapel: 0.5, meetinghouse: 0.6, cemetery: 0.5, schoolhouse: 0.7, station: 0.3,
      valley: 0.3, stage: 0.4, county: 0.3, township: 0.4, state: 0.2, road: 0.15, street: 0.1, highway: 0.2,
      court: -0.9, circle: -0.8, cove: -0.8, place: -0.5, way: -0.5, lane: -0.4, trail: -0.5, terrace: -0.5, loop: -0.6,
      estates: -0.9, estate: -0.8, pointe: -0.9, chase: -0.7, commons: -0.7, crossing: -0.6, landing: -0.5, meadows: -0.5,
      glen: -0.4, woods: -0.4, preserve: -0.6, reserve: -0.5, village: -0.3, square: -0.4, row: -0.3, drive: -0.3, parkway: -0.2,
      trace: -0.3, path: -0.4, walk: -0.4, crest: -0.3, view: -0.3, vista: -0.4, heights: -0.2,
    },
  };
  const SUFFIX = new Set(['road', 'street', 'highway', 'drive', 'lane', 'court', 'circle', 'cove', 'place', 'way', 'trail', 'terrace',
    'loop', 'parkway', 'path', 'walk', 'row', 'square', 'trace', 'run', 'crossing', 'landing', 'view', 'chase']);
  const SUBDIV_WORDS = new Set(Object.entries(CUES.word).filter(([, v]) => v < 0).map(([k]) => k));
  const ABBR = { rd: 'road', st: 'street', ct: 'court', crt: 'court', cir: 'circle', ln: 'lane', dr: 'drive', tr: 'trail', trl: 'trail', pk: 'pike',
    pke: 'pike', tpke: 'turnpike', hwy: 'highway', pl: 'place', cv: 'cove', ter: 'terrace', terr: 'terrace', pt: 'pointe', pte: 'pointe',
    xing: 'crossing', blvd: 'boulevard', pkwy: 'parkway', sq: 'square', est: 'estates', ests: 'estates', holw: 'hollow', hl: 'hill',
    br: 'branch', frk: 'fork', mdws: 'meadows', lndg: 'landing', trce: 'trace', vw: 'view', cr: 'creek', crk: 'creek', twp: 'township', co: 'county' };
  // measured on tests/fixtures/route_ctx/road_names_cincinnati.json (tools/route_ctx_fixtures.js names), re-checked by
  // tests/test_route_ctx_road_name_age.py. 1449 names; 57 labelled old, 929 new (most short streets there are cul-de-sacs).
  const VALIDATION = {
    sample: 'named public roads on 49 z14 tiles over Colerain, Green and Springfield townships, Hamilton County OH (OSM via OpenFreeMap, 2026-11-01)',
    truth: 'a proxy, not age records: OLD = 2 km or more of the name (a through road of the township network); NEW = a residential street under 1 km that dead-ends (a cul-de-sac subdivision street)',
    auc: 0.937,                       // P(an old road scores above a new street)
    meanOld: 0.146, meanNew: -0.464,
    oldAt015: { predicted: 77, precision: 0.57, recall: 0.77 },   // base rate of old among labelled: 0.058
    oldAt040: { predicted: 10, precision: 0.60, recall: 0.11 },
    newAt040: { predicted: 489, precision: 0.998, recall: 0.53 }, // base rate of new among labelled: 0.942
    caveat: 'old-name false positives are mostly "Old X Road" stubs, which ARE old but short dead ends, so the proxy calls them new; the true old precision is likely higher, and nothing here is checked against dated maps',
  };
  const CONFIDENCE = { weight: 0.15, note: 'weak prior: strong for spotting subdivision streets, about 10x the base rate but only ~60% precise for old roads; use at 0.15 of a measured feature' };

  /** A name's words, lowercase, abbreviations expanded, "School House" / "Meeting House" joined. */
  function words(name) {
    const w = String(name || '').toLowerCase().replace(/[.,'’]/g, '').split(/[\s\-/]+/).filter(Boolean).map((x) => ABBR[x] || x);
    const out = [];
    for (let i = 0; i < w.length; i++) {
      if ((w[i] === 'school' || w[i] === 'meeting') && w[i + 1] === 'house') { out.push(w[i] === 'school' ? 'schoolhouse' : 'meetinghouse'); i++; } else out.push(w[i]);
    }
    return out;
  }
  /**
   * A name's score: { score (-1..1), cues: [word, ...] }, or null for no name. `cls` (optional): the map's road class
   * ('motorway'..'minor'); tertiary or bigger halves subdivision cues.
   */
  function score(name, cls) {
    const w = words(name);
    if (!w.length) return null;
    const big = cls && /^(motorway|trunk|primary|secondary|tertiary)$/.test(cls);
    let s = 0;
    const cues = [];
    if (w[0] in CUES.prefix) { s += CUES.prefix[w[0]]; cues.push(w[0]); }
    w.forEach((x, i) => {
      if (i === 0 && x in CUES.prefix) return;
      if (!(x in CUES.word)) return;
      if (SUFFIX.has(x) && i !== w.length - 1) return;   // "Court Street": a street type counts only as the last word
      let v = CUES.word[x];
      if (SUBDIV_WORDS.has(x) && big) v /= 2;
      cues.push(x); s += v;
    });
    return { score: Math.max(-1, Math.min(1, +s.toFixed(3))), cues };
  }

  const NAME_CLASS = { 1: 'motorway', 2: 'trunk', 3: 'primary', 4: 'secondary', 5: 'tertiary', 6: 'minor', 7: 'service' };
  /** Names per sample from router edges [{ fromM, toM, name | names }] when they carry names; null when none do. */
  function namesFromEdges(c) {
    if (!Array.isArray(c.edges) || !c.edges.length) return null;
    const out = new Array(c.lat.length).fill(null);
    let any = false;
    for (const e of c.edges) {
      const nm = e && (e.name || (Array.isArray(e.names) && e.names[0]));
      if (!nm || !G.finite(e.fromM) || !G.finite(e.toM)) continue;
      for (let i = 0; i < c.lat.length; i++) if (c.distM[i] >= e.fromM && c.distM[i] <= e.toM) { out[i] = nm; any = true; }
    }
    return any ? out : null;
  }
  /** The contract's result for one corridor from per-sample names (null = unknown) and optional road class codes. */
  function aggregate(c, names, classes) {
    const n = c.lat.length, res = G.emptyResult(n, ['name_age'], 'unavailable');
    if (!names) { res.note = 'no names'; return res; }
    let k = 0;
    const memo = new Map();
    for (let i = 0; i < n; i++) {
      if (!names[i]) continue;
      const cls = classes && NAME_CLASS[classes[i]];
      const key = names[i] + '|' + (cls || '');
      if (!memo.has(key)) memo.set(key, score(names[i], cls));
      const s = memo.get(key);
      if (s) { res.channels.name_age[i] = s.score; k++; }
    }
    res.status = !k ? 'unavailable' : k === n ? 'ok' : 'partial';
    // named stretches with a clear cue, split where the name changes
    for (let i = 0; i < n;) {
      const v = res.channels.name_age[i];
      if (!names[i] || !(Math.abs(v) >= 0.4)) { i++; continue; }
      let j = i;
      while (j + 1 < n && names[j + 1] === names[i]) j++;
      res.spans.push({ fromM: Math.round(c.distM[i]), toM: Math.round(c.distM[j]), kind: v > 0 ? 'old_road_name' : 'subdivision_name', value: v, label: names[i] });
      i = j + 1;
    }
    return res;
  }

  async function fetchCtx(corridors, opts = {}) {
    const out = {};
    let tileNames = null;
    const need = corridors.filter((c) => !namesFromEdges(c));
    const T = root.ApexOsmTiles;
    if (need.length && T) { try { tileNames = await T.roadNames(need, opts); } catch (_) { tileNames = null; } }
    for (const c of corridors) {
      try {
        const names = namesFromEdges(c) || (tileNames && tileNames[c.id]) || null;
        out[c.id] = aggregate(c, names, null);
      } catch (e) { out[c.id] = G.emptyResult(c.lat.length, ['name_age'], 'unavailable', String(e && e.message || e)); }
    }
    return out;
  }

  const provider = { id: 'road_name_age', version: 1, channels: ['name_age'], needs: { network: true }, budgetMs: 8000, fetch: fetchCtx };
  const api = { provider, CUES, CONFIDENCE, VALIDATION, words, score, aggregate, namesFromEdges };
  root.ApexRoadNameAge = api;
  if (Ctx && Ctx.register) Ctx.register(provider);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
