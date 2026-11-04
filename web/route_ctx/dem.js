// Route context provider: terrain from the Terrarium DEM the map already uses for hillshade (z12, ~30 m pixels), the
// same tiles web/stages.js reads (and the offline tile cache keeps). docs/ROUTE_ENGINE.md.
//
// Channels (per 25 m sample; NaN = unknown):
//   elev_m        m        ground elevation at the sample
//   grade_pct     %        signed grade along the direction of travel over 100 m (+ climbing)
//   relief_m      m        local relief: highest minus lowest ground within 800 m (hill country vs flat plain)
//   tpi_m         m        topographic position: elevation minus the mean of the ground 300–800 m around (+ ridge, − valley)
//   aspect_rad    rad      the way the ground falls at the sample (0 north, clockwise; downslope bearing)
//   west_descent  0/1      descending (grade ≤ −2 %) while heading within 45° of west: the golden-hour view at sunset
// Spans: { kind: 'climb' | 'descent', value: metres up or down } for runs of 5 %+ over 200 m or more.
// Source: Mapzen/Linux Foundation Terrarium tiles on AWS Open Data (SRTM, NED and others; public domain / open, attribution
// "Elevation: Mapzen Terrain Tiles" in About > Sources). Static: no update cadence.
(function (root) {
  'use strict';
  // the registry itself (a provider shim, ctx_util.js / osm_common.js, has only register): in node, require it
  const Ctx = root.ApexRouteCtx && root.ApexRouteCtx.corridor ? root.ApexRouteCtx : typeof require === 'function' ? require('./registry.js') : root.ApexRouteCtx || null;
  const Z = 12, MAX_TILES = 64, RING_NEAR_M = 300, RING_FAR_M = 800, PROBE_EVERY = 4;   // probes every 4th sample (100 m)

  const tileOf = (lat, lon, z = Z) => {
    const n = 2 ** z, r = lat * Math.PI / 180;
    return { fx: (lon + 180) / 360 * n, fy: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n };
  };
  const offset = (lat, lon, bearingRad, m) => ({ lat: lat + m * Math.cos(bearingRad) / 110540, lon: lon + m * Math.sin(bearingRad) / (111320 * Math.cos(lat * Math.PI / 180)) });
  /** The DEM tiles ("x/y" at z12) a corridor needs, probes included. */
  function tilesFor(c) {
    const out = new Set(), pad = RING_FAR_M + 50;
    for (let i = 0; i < c.lat.length; i += PROBE_EVERY) {
      for (const b of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
        const p = offset(c.lat[i], c.lon[i], b, pad), t = tileOf(p.lat, p.lon);
        out.add(`${Math.floor(t.fx)}/${Math.floor(t.fy)}`);
      }
    }
    return [...out];
  }
  /** A synchronous elevation sampler over decoded tiles (Map "x/y" → RGBA bytes, 256 x 256): metres, or null. */
  function sampler(tiles) {
    const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
    return (lat, lon) => {
      const t = tileOf(lat, lon), px = tiles.get(`${Math.floor(t.fx)}/${Math.floor(t.fy)}`);
      if (!px) return null;
      const i = (Math.min(255, Math.floor((t.fy % 1) * 256)) * 256 + Math.min(255, Math.floor((t.fx % 1) * 256))) * 4;
      const e = terrarium(px[i], px[i + 1], px[i + 2]);
      return e > -500 && e < 9000 ? e : null;                     // a no-data pixel is unknown, not the sea floor
    };
  }
  /**
   * The terrain channels for one corridor from a sampler (lat, lon) → metres | null. Pure: tests/test_route_ctx_dem.py
   * runs it on a made-up ridge and on the real DEM along the fixture roads.
   */
  function channelsFrom(c, elevAt) {
    const n = c.distM.length, nan = () => new Float32Array(n).fill(NaN);
    const raw = nan(), elev = nan(), grade = nan(), relief = nan(), tpi = nan(), aspect = nan(), west = nan();
    let known = 0;
    for (let i = 0; i < n; i++) { const e = elevAt(c.lat[i], c.lon[i]); if (Number.isFinite(e)) { raw[i] = e; known++; } }
    if (known < 0.5 * n) return { status: 'unavailable', note: 'DEM not readable here', channels: {}, spans: [], points: [] };
    for (let i = 0; i < n; i++) {                                 // 75 m running mean: pixel steps are not grades
      let s = 0, k = 0;
      for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) if (Number.isFinite(raw[j])) { s += raw[j]; k++; }
      if (k) elev[i] = s / k;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), run = c.distM[b] - c.distM[a];
      if (run > 30 && Number.isFinite(elev[a]) && Number.isFinite(elev[b])) grade[i] = Math.max(-25, Math.min(25, (elev[b] - elev[a]) / run * 100));
    }
    const dirs = Array.from({ length: 8 }, (_, k) => k * Math.PI / 4);
    for (let i = 0; i < n; i += PROBE_EVERY) {
      const lat = c.lat[i], lon = c.lon[i], e0 = elev[i];
      if (!Number.isFinite(e0)) continue;
      const near = dirs.map((d) => { const p = offset(lat, lon, d, RING_NEAR_M); return elevAt(p.lat, p.lon); });
      const far = dirs.map((d) => { const p = offset(lat, lon, d, RING_FAR_M); return elevAt(p.lat, p.lon); });
      const ring = [...near, ...far].filter(Number.isFinite);
      if (ring.length < 12) continue;
      const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
      const r = Math.max(e0, ...ring) - Math.min(e0, ...ring), t = e0 - mean;
      let asp = NaN;
      if ([0, 2, 4, 6].every((k) => Number.isFinite(near[k]))) {
        const dzdx = (near[2] - near[6]) / (2 * RING_NEAR_M), dzdy = (near[0] - near[4]) / (2 * RING_NEAR_M);
        if (Math.hypot(dzdx, dzdy) > 0.01) { asp = Math.atan2(-dzdx, -dzdy); if (asp < 0) asp += 2 * Math.PI; }   // flatter than 1 %: no aspect
      }
      for (let j = i; j < Math.min(n, i + PROBE_EVERY); j++) { relief[j] = r; tpi[j] = t; aspect[j] = asp; }
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(grade[i])) continue;
      const off = Math.abs(Math.atan2(Math.sin(c.heading[i] - 1.5 * Math.PI), Math.cos(c.heading[i] - 1.5 * Math.PI)));
      west[i] = grade[i] <= -2 && off <= Math.PI / 4 ? 1 : 0;
    }
    const spans = [];
    for (const sign of [1, -1]) {
      let s = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && Number.isFinite(grade[i]) && sign * grade[i] >= 5;
        if (on && s < 0) s = i;
        if (!on && s >= 0) {
          const e = i - 1;
          if (c.distM[e] - c.distM[s] >= 200 && Number.isFinite(elev[s]) && Number.isFinite(elev[e])) spans.push({ fromM: c.distM[s], toM: c.distM[e], kind: sign > 0 ? 'climb' : 'descent', value: Math.round(Math.abs(elev[e] - elev[s])) });
          s = -1;
        }
      }
    }
    spans.sort((a, b) => a.fromM - b.fromM);
    return { status: known === n ? 'ok' : 'partial', channels: { elev_m: elev, grade_pct: grade, relief_m: relief, tpi_m: tpi, aspect_rad: aspect, west_descent: west }, spans, points: [] };
  }

  async function fetchAll(corridors, opts = {}) {
    const S = root.ApexStages, out = {};
    if (!S || typeof S.demTile !== 'function') { for (const c of corridors) out[c.id] = { status: 'unavailable', note: 'no DEM reader' }; return out; }
    const need = new Map();
    for (const c of corridors) need.set(c.id, tilesFor(c));
    const tiles = new Map();
    // the corridors that fit the tile budget, shortest first, so one huge trip doesn't cost every other candidate its terrain
    const order = corridors.slice().sort((a, b) => need.get(a.id).length - need.get(b.id).length), allowed = new Set();
    for (const c of order) { const t = need.get(c.id); if (new Set([...allowed, ...t]).size <= MAX_TILES) t.forEach((k) => allowed.add(k)); }
    const aborted = new Promise((resolve) => { if (opts.signal) opts.signal.addEventListener('abort', resolve, { once: true }); });
    await Promise.race([Promise.all([...allowed].map(async (k) => { const px = await S.demTile(k); if (px) tiles.set(k, px); })), aborted]);
    const at = sampler(tiles);
    for (const c of corridors) {
      if (!need.get(c.id).every((k) => allowed.has(k))) { out[c.id] = { status: 'unavailable', note: 'too long a trip for the DEM' }; continue; }
      out[c.id] = channelsFrom(c, at);
    }
    return out;
  }

  const provider = { id: 'dem', version: 1, priority: 20, stageOk: true, budgetMs: 2000, needs: { network: true },
    channels: ['elev_m', 'grade_pct', 'relief_m', 'tpi_m', 'aspect_rad', 'west_descent'], fetch: fetchAll };
  const api = { ...provider, tilesFor, sampler, channelsFrom, offset, Z };
  if (Ctx) Ctx.register(provider);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexRouteCtxDem = api;
})(typeof window !== 'undefined' ? window : globalThis);
