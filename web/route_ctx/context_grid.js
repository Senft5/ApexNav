// Route context: the context grid. National public datasets that can't be asked per route from a phone (rasters of the
// whole country, state road inventories, ten years of crash files), preprocessed by tools/ctx_etl into small bundles the
// phone reads locally: one gzipped file per z8 tile (about 156 x 122 km), loaded only for the tiles a corridor touches,
// kept in Cache Storage (and in the offline areas' store when an area is saved). Nothing about the route leaves the phone
// except which ~150 km tiles it needs. Bundles: web/data/ctx/v1/ (Cincinnati; shipped in the app and the site) and the
// Worker's /api/ctx/v1/ (the launch region, from KV); each has an index.json. Format: tools/ctx_etl/vcg.py.
//
// Channels (per 25 m sample; NaN = unknown: outside the bundles' coverage, or the source has no value there):
//   night_lights        0-1     Relative night brightness, 0 dark .. 1 brightest, ~470 m. Built with the owner's Earthdata
//                               token: NASA Black Marble VNP46A4, the newest annual radiance r (nW/cm2/sr), as
//                               min(1, (r / 20) ** 0.7); without it, the Black Marble 2016 tone-mapped image via NASA
//                               GIBS. Either way lit suburbs and city cores both read near 1; the useful split is dark
//                               (< 0.15) vs lit. Public domain; VNP46A4 yearly, the 2016 image static.
//   impervious_pct      %       Impervious surface in the ~240 m cell. NLCD 2021 (USGS/MRLC), 30 m averaged. Public domain;
//                               NLCD updates every 2-3 years.
//   canopy_pct          %       Tree canopy cover in the ~240 m cell. NLCD/USFS Tree Canopy Cover 2021. Public domain.
//   noise_db            dB      Loudest modelled road-noise class within ~120 m, as the class floor (LAeq 24 h): 45, 50, 55,
//                               60, 70, 80, 90; 40 = below the map's 45 dB floor. BTS National Transportation Noise Map 2020
//                               (roads; modelled from traffic, not measured). Public domain; every 2-4 years.
//   housing_density     /km2    Housing units per km2. 2020 Census blocks (TIGER/Line HOUSING20). Public domain; decennial.
//   population_density  /km2    Residents per km2. 2020 Census blocks (POP20). Public domain; decennial.
//   address_density     /km2    Address points per km2 (3 x 3-cell smoothed, ~240 m cells). OpenAddresses (county/state
//                               sources; per-source licences, counts only kept). Unknown where no source covers the county.
//   median_year_built   year    Median year the homes were built, block group. ACS 5-year B25035 (Census). 1939 = 1939 or
//                               earlier. Public domain; yearly. (Parcel year built is not available: Hamilton County's
//                               open parcel service has no year-built field, so this is the per-block-group stand-in.)
//   flood_zone          class   Highest FEMA flood class within ~120 m: 0 minimal (X), 1 0.2%/yr, 2 1%/yr (A, AE, AH, AO),
//                               3 regulatory floodway, 4 coastal (V, VE). FEMA NFHL. Public domain; panels update anytime.
//   cropland_class      code    Most common USDA Cropland Data Layer class in ~240 m (cropGroup() names them). USDA NASS
//                               (via Planetary Computer). Public domain; yearly.
//   park_visits         /yr     Recreation visits a year to the NPS unit the sample is in; 0 = not in an NPS unit (known).
//                               NPS boundaries + NPS Visitor Use Statistics. Public domain; yearly.
//   mobile_coverage     count   Mobile providers in the cell. No source (the FCC download was dropped, 2026-11-08), so
//                               never built: always NaN, so it never counts for or against a route.
//   aadt                veh/day Annual average daily traffic of the road under the sample (HPMS, FHWA + state DOTs),
//                               matched to the route within 20 m and 35 degrees of heading; a divided road's count is read
//                               from its other carriageway (up to 90 m away) when this one has none. Public domain; yearly.
//   iri                 in/mi   International Roughness Index of that road section (HPMS; reported on main roads only).
//   hpms_speed_limit    mph     Posted speed limit HPMS holds for that section (not all sections report it).
//   hpms_lanes          lanes   Through lanes (both directions, as HPMS counts them).
//   hpms_fclass         1-7     FHWA functional system: 1 interstate, 2 freeway/expressway, 3 principal arterial, 4 minor
//                               arterial, 5 major collector, 6 minor collector, 7 local.
//   crash_density       /km/yr  Fatal crashes per km per year: FARS (NHTSA) crashes within 40 m of the route, counted over
//                               a 2 km window centred on the sample, divided by the window's length and the years (2020-
//                               2024). Fatal only: rare, so a 0 says "none in five years", not "safe". Public domain; yearly.
// Spans: { kind: 'nps_unit', label: unit name, value: annual visits, monthly: [12] }.
// Points: { kind: 'fatal_crash', atM, value: fatalities, label: year, hour }.
// Pure helpers are exported for tests (tests/test_route_ctx_context_grid.py).
(function (root) {
  'use strict';
  const VERSION = 1, BUNDLE_Z = 8, TILE_Z = 12, PER = 16;              // a bundle holds 16 x 16 z12 tiles
  const BASE = 'data/ctx/v1/';
  const CACHE = 'vetta-ctx-v1', MEM_MAX = 12, INDEX_TTL = 864e5, MISS_TTL = 6e5;
  const R = 6378137, WORLD = 2 * Math.PI * R;
  const MATCH_M = 20, FILL_M = 90, STICK_M = 8, MATCH_DEG = 35, CRASH_M = 40, CRASH_WIN_M = 2000;
  // channel -> [cells per z12 tile edge, sampling]; mirrors tools/ctx_etl/grid.py CHANNELS (a test checks)
  const RASTERS = {
    night_lights: [16, 'bilinear'], impervious_pct: [32, 'bilinear'], canopy_pct: [32, 'bilinear'], noise_db: [64, 'nearest'],
    housing_density: [32, 'bilinear'], population_density: [32, 'bilinear'], address_density: [32, 'bilinear'],
    median_year_built: [32, 'nearest'], flood_zone: [64, 'nearest'], cropland_class: [32, 'nearest'], park_unit: [64, 'nearest'],
    mobile_coverage: [32, 'nearest'],
  };
  const LINE_CHANNELS = { aadt: 'aadt', iri: 'iri', hpms_speed_limit: 'speed_limit', hpms_lanes: 'lanes', hpms_fclass: 'fclass' };
  const CHANNELS = ['night_lights', 'impervious_pct', 'canopy_pct', 'noise_db', 'housing_density', 'population_density',
    'address_density', 'median_year_built', 'flood_zone', 'cropland_class', 'park_visits', 'mobile_coverage',
    ...Object.keys(LINE_CHANNELS), 'crash_density'];
  const finite = Number.isFinite;

  // ---------------------------------------------------------------------------------------------------- the grid
  /** Degrees -> global fractional coordinates at zoom z (tile units; y grows south). */
  function project(lat, lon, z) {
    const n = 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n];
  }
  const keyOf = (bx, by) => `${bx}/${by}`;
  /** The bundle keys ('x/y' at z8) within padM metres of any point. */
  function bundlesFor(lat, lon, padM = 300) {
    const out = new Set();
    for (let k = 0; k < lat.length; k++) {
      if (!finite(lat[k]) || !finite(lon[k])) continue;
      const dLat = padM / 111320, dLon = padM / (111320 * Math.cos(lat[k] * Math.PI / 180));
      for (const a of [lat[k] - dLat, lat[k] + dLat]) for (const o of [lon[k] - dLon, lon[k] + dLon]) {
        const [x, y] = project(a, o, BUNDLE_Z); out.add(keyOf(Math.floor(x), Math.floor(y)));
      }
    }
    return [...out].sort();
  }
  /** The bundle keys covering a circle (for offline areas). */
  function bundlesNear(lat, lon, radiusKm) {
    const d = radiusKm * 1000, dLat = d / 111320, dLon = d / (111320 * Math.cos(lat * Math.PI / 180));
    const [x0, y0] = project(lat + dLat, lon - dLon, BUNDLE_Z), [x1, y1] = project(lat - dLat, lon + dLon, BUNDLE_Z);
    const out = [];
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) out.push(keyOf(x, y));
    return out;
  }
  const urlOf = (key, base = BASE) => `${base}${BUNDLE_Z}/${key}.vcg`;

  // ---------------------------------------------------------------------------------------------------- the file
  const TYPED = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array };
  async function gunzip(buf) {
    const u = new Uint8Array(buf);
    if (!(u[0] === 0x1f && u[1] === 0x8b)) return u;
    if (typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function') {
      return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    if (typeof require === 'function') return new Uint8Array(require('zlib').gunzipSync(u));
    throw new Error('no gzip');
  }
  /** Decompressed bytes -> { header, arrays, tileIndex }: arrays are typed views (copied when unaligned). */
  function parse(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'VCG1') throw new Error('not a VCG1 bundle');
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), hl = dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + hl)));
    const body = 8 + hl + ((4 - ((8 + hl) % 4)) % 4), arrays = {};
    for (const [name, [dt, off, count]] of Object.entries(header.arrays || {})) {
      const T = TYPED[dt], start = u.byteOffset + body + off;
      arrays[name] = start % T.BYTES_PER_ELEMENT === 0 ? new T(u.buffer, start, count) : new T(u.slice(body + off, body + off + count * T.BYTES_PER_ELEMENT).buffer);
    }
    const tileIndex = {};
    for (const [name, ch] of Object.entries(header.channels || {})) {
      const m = new Map(); ch.tiles.forEach(([i, j], k) => m.set(j * PER + i, k)); tileIndex[name] = m;
    }
    const covered = new Set((header.coverage || []).map(([i, j]) => j * PER + i));
    const b = { header, arrays, tileIndex, covered, x: header.x, y: header.y };
    if (header.lines) Object.assign(b, undeltaLines(header.lines, arrays));
    b.lineIndex = buildLineIndex(b);
    return b;
  }

  /** The road spans' vertices back to absolute bundle units: { lineStart (Uint32, count + 1), lineXY (Uint16 x, y) }
   * from per-line counts, first vertices and zigzag steps (tools/ctx_etl/transforms.delta_lines). */
  function undeltaLines(L, arrays) {
    const n = arrays[L.n], x0 = arrays[L.x0], y0 = arrays[L.y0], dx = arrays[L.dx], dy = arrays[L.dy];
    const lineStart = new Uint32Array(L.count + 1);
    for (let s = 0; s < L.count; s++) lineStart[s + 1] = lineStart[s] + n[s];
    const lineXY = new Uint16Array(2 * lineStart[L.count]), unz = (u) => (u >>> 1) ^ -(u & 1);
    let k = 0;
    for (let s = 0; s < L.count; s++) {
      let x = x0[s], y = y0[s], v = lineStart[s];
      lineXY[2 * v] = x; lineXY[2 * v + 1] = y;
      for (v++; v < lineStart[s + 1]; v++, k++) { x += unz(dx[k]); y += unz(dy[k]); lineXY[2 * v] = x; lineXY[2 * v + 1] = y; }
    }
    return { lineStart, lineXY };
  }
  /** A stored raw value -> its value (offset 'log1p': the densities' log scale). */
  const decode = (ch, raw) => (raw === ch.nodata ? NaN : ch.offset === 'log1p' ? Math.expm1(raw * ch.scale) : raw * ch.scale + ch.offset);

  // ---------------------------------------------------------------------------------------------------- rasters
  /** One cell's value (NaN unknown) at global cell coordinates (gx, gy) of channel `name`. */
  function cell(bundles, name, gx, gy) {
    const n = RASTERS[name][0], tx = Math.floor(gx / n), ty = Math.floor(gy / n);
    const b = bundles.get(keyOf(Math.floor(tx / PER), Math.floor(ty / PER)));
    if (!b) return NaN;
    const ch = b.header.channels[name];
    if (!ch) return NaN;
    const k = b.tileIndex[name].get((ty % PER) * PER + (tx % PER));
    if (k === undefined) return NaN;
    const raw = b.arrays[ch.array][k * n * n + (gy - ty * n) * n + (gx - tx * n)];
    return decode(ch, raw);
  }
  /** A channel at a point: bilinear between cell centres where all four are known, else the cell under the point. */
  function sample(bundles, name, lat, lon) {
    const [n, how] = RASTERS[name], z = TILE_Z + Math.log2(n), [X, Y] = project(lat, lon, z);
    const near = cell(bundles, name, Math.floor(X), Math.floor(Y));
    if (how !== 'bilinear') return near;
    const fx = X - 0.5, fy = Y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const v00 = cell(bundles, name, x0, y0), v10 = cell(bundles, name, x0 + 1, y0), v01 = cell(bundles, name, x0, y0 + 1), v11 = cell(bundles, name, x0 + 1, y0 + 1);
    if (![v00, v10, v01, v11].every(finite)) return near;
    return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
  }
  /** Is this point inside a covered z12 tile of a loaded bundle? */
  function isCovered(bundles, lat, lon) {
    const [X, Y] = project(lat, lon, TILE_Z), tx = Math.floor(X), ty = Math.floor(Y);
    const b = bundles.get(keyOf(Math.floor(tx / PER), Math.floor(ty / PER)));
    return !!b && b.covered.has((ty % PER) * PER + (tx % PER));
  }

  // ---------------------------------------------------------------------------------------------------- road spans (HPMS)
  const CELL_U = 256;                                                   // line-index cell: 256 units (~610 m of mercator)
  function buildLineIndex(b) {
    const L = b.header.lines;
    if (!L) return null;
    const st = b.lineStart, xy = b.lineXY, idx = new Map();
    for (let s = 0; s < L.count; s++) for (let v = st[s]; v < st[s + 1] - 1; v++) {
      const x0 = xy[2 * v], y0 = xy[2 * v + 1], x1 = xy[2 * v + 2], y1 = xy[2 * v + 3];
      for (let cy = Math.floor(Math.min(y0, y1) / CELL_U); cy <= Math.floor(Math.max(y0, y1) / CELL_U); cy++)
        for (let cx = Math.floor(Math.min(x0, x1) / CELL_U); cx <= Math.floor(Math.max(x0, x1) / CELL_U); cx++) {
          const k = cy * 256 + cx; let a = idx.get(k); if (!a) idx.set(k, (a = [])); a.push(v, s);
        }
    }
    return idx;
  }
  /** The road span under a point: { s, d (m), bundle, alts } for the nearest span within MATCH_M whose direction is within
   * MATCH_DEG of headingRad (radians from north, clockwise; either way along the span), or null. `alts` are the other
   * parallel spans of the same class and lanes within FILL_M, nearest first: HPMS often inventories a divided road
   * twice (one carriageway with the counts, the other with almost nothing), so a missing item is read from its twin. */
  function matchLine(bundles, lat, lon, headingRad, prev = null) {
    const [X, Y] = project(lat, lon, BUNDLE_Z), b = bundles.get(keyOf(Math.floor(X), Math.floor(Y)));
    if (!b || !b.lineIndex) return null;
    const ux = (X - b.x) * 65535, uy = (Y - b.y) * 65535;
    const mPerU = WORLD / 2 ** BUNDLE_Z / 65535 * Math.cos(lat * Math.PI / 180), rU = FILL_M / mPerU;
    const xy = b.lineXY, near = new Map();                               // span -> its nearest distance (units)
    const cx0 = Math.floor((ux - rU) / CELL_U), cx1 = Math.floor((ux + rU) / CELL_U), cy0 = Math.floor((uy - rU) / CELL_U), cy1 = Math.floor((uy + rU) / CELL_U);
    const seen = new Set();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const a = b.lineIndex.get(cy * 256 + cx); if (!a) continue;
      for (let k = 0; k < a.length; k += 2) {
        const v = a[k]; if (seen.has(v)) continue; seen.add(v);
        const x0 = xy[2 * v], y0 = xy[2 * v + 1], dx = xy[2 * v + 2] - x0, dy = xy[2 * v + 3] - y0, L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((ux - x0) * dx + (uy - y0) * dy) / L2)) : 0;
        const d = Math.hypot(ux - (x0 + t * dx), uy - (y0 + t * dy)), s = a[k + 1];
        if (d > rU || (near.has(s) && near.get(s) <= d)) continue;
        if (finite(headingRad) && L2 > 0) {
          const segH = Math.atan2(dx, -dy);                                  // units: x east, y south -> radians from north
          let diff = Math.abs(((segH - headingRad) % Math.PI + Math.PI) % Math.PI);
          diff = Math.min(diff, Math.PI - diff);
          if (diff > MATCH_DEG * Math.PI / 180) continue;
        }
        near.set(s, d);
      }
    }
    const order = [...near.entries()].sort((p, q) => p[1] - q[1]);
    if (!order.length || order[0][1] * mPerU > MATCH_M) return null;
    // stay on the span the previous sample was on while it is nearly as close (a ramp beside the main line, a gore)
    const keep = prev && prev.bundle === b && near.has(prev.s) && near.get(prev.s) * mPerU <= Math.min(MATCH_M, order[0][1] * mPerU + STICK_M);
    if (keep) order.unshift([prev.s, near.get(prev.s)]);
    const [s, dU] = order[0], fc = rawLine(b, 'fclass', s), ln = rawLine(b, 'lanes', s);
    const twin = (t) => { const l = rawLine(b, 'lanes', t); return rawLine(b, 'fclass', t) === fc && (!finite(ln) || !finite(l) || Math.abs(l - ln) <= Math.max(1, ln / 4)); };
    const alts = order.slice(1).filter(([t]) => t !== s && twin(t)).map(([t]) => t);       // not a 1-lane ramp beside it
    return { s, d: dU * mPerU, bundle: b, alts };
  }
  function rawLine(b, attr, s) {
    const A = b.header.lines.attrs[attr];
    if (!A) return NaN;
    const raw = b.arrays[A.array][s];
    return raw === A.nodata ? NaN : raw;
  }
  /** An HPMS item of the matched span, or of its parallel twin when the span doesn't report it; NaN when neither does. */
  function lineValue(m, attr) {
    if (!m) return NaN;
    for (const s of [m.s, ...(m.alts || [])]) { const v = rawLine(m.bundle, attr, s); if (finite(v)) return v; }
    return NaN;
  }

  // ---------------------------------------------------------------------------------------------------- crashes (FARS)
  /** Fatal crashes per km per year along the samples, and the crashes themselves (attributed to their nearest sample). */
  function crashes(bundles, lat, lon, distM) {
    const n = lat.length, out = new Float32Array(n).fill(NaN), pts = [];
    if (!n) return { density: out, points: pts };
    let s = Infinity, w = Infinity, no = -Infinity, e = -Infinity;
    for (let k = 0; k < n; k++) { s = Math.min(s, lat[k]); no = Math.max(no, lat[k]); w = Math.min(w, lon[k]); e = Math.max(e, lon[k]); }
    const pad = 0.001, kx = Math.cos((s + no) / 2 * Math.PI / 180) * 111320, ky = 111320;
    const hit = new Float64Array(n);
    let years = null;
    for (const b of bundles.values()) {
      const P = b.header.points; if (!P || !P.count) { if (P && !years) years = P.years; continue; }
      years = P.years;
      const px = b.arrays[P.x], py = b.arrays[P.y], yr = b.arrays[P.year], ft = b.arrays[P.fatals], hr = b.arrays[P.hour];
      for (let c = 0; c < P.count; c++) {
        const gx = b.x + px[c] / 65535, gy = b.y + py[c] / 65535, cl = gx / 2 ** BUNDLE_Z * 360 - 180;
        const ca = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / 2 ** BUNDLE_Z))) * 180 / Math.PI;
        if (ca < s - pad || ca > no + pad || cl < w - pad || cl > e + pad) continue;
        let bestK = -1, bestD = CRASH_M;
        for (let k = 0; k < n; k++) {                                     // nearest sample, then the segment either side
          const d = Math.hypot((lon[k] - cl) * kx, (lat[k] - ca) * ky);
          if (d < bestD + 25) { const dd = segDist(lat, lon, k, ca, cl, kx, ky); if (dd < bestD) { bestD = dd; bestK = k; } }
        }
        if (bestK < 0) continue;
        hit[bestK] += 1;
        pts.push({ atM: distM[bestK], kind: 'fatal_crash', value: ft[c], label: String(yr[c]), hour: hr[c] === 255 ? null : hr[c] });
      }
    }
    if (!years) return { density: out, points: pts };
    const nYears = years[1] - years[0] + 1, cum = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + hit[k];
    let a = 0, z = 0;
    for (let k = 0; k < n; k++) {
      if (!isCovered(bundles, lat[k], lon[k])) continue;
      while (distM[k] - distM[a] > CRASH_WIN_M / 2 + 0.01) a++;                      // +1 cm: float sums of 25 m steps
      while (z + 1 < n && distM[z + 1] - distM[k] <= CRASH_WIN_M / 2 + 0.01) z++;
      const lenKm = Math.max(0.025, (distM[z] - distM[a]) / 1000 + 0.025);
      out[k] = (cum[z + 1] - cum[a]) / lenKm / nYears;
    }
    pts.sort((p, q) => p.atM - q.atM);
    return { density: out, points: pts };
  }
  function segDist(lat, lon, k, ca, cl, kx, ky) {
    let best = Math.hypot((lon[k] - cl) * kx, (lat[k] - ca) * ky);
    for (const j of [k - 1, k + 1]) {
      if (j < 0 || j >= lat.length) continue;
      const ax = lon[k] * kx, ay = lat[k] * ky, dx = lon[j] * kx - ax, dy = lat[j] * ky - ay, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(0.5, ((cl * kx - ax) * dx + (ca * ky - ay) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(cl * kx - (ax + t * dx), ca * ky - (ay + t * dy)));
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------------- crops
  /** A CDL code -> a plain group. */
  function cropGroup(code) {
    if (!finite(code)) return null;
    if ([1, 5, 2, 4, 6, 21, 22, 23, 24, 25, 26, 27, 28, 29, 225, 226, 228, 236, 237, 238, 239, 240, 241, 254, 10, 11, 12, 13, 14, 31, 32, 33, 34, 35, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].includes(code)) return 'crops';
    if ([36, 37].includes(code)) return 'hay';
    if (code === 61) return 'fallow';
    if ([66, 67, 68, 69, 70, 71, 72, 74, 75, 76, 77, 204, 210, 211, 212, 217, 218, 220, 223].includes(code)) return 'orchard';
    if ([62, 176].includes(code)) return 'pasture';
    if ([63, 141, 142, 143].includes(code)) return 'forest';
    if ([64, 152].includes(code)) return 'shrub';
    if ([121, 122, 123, 124, 82].includes(code)) return 'developed';
    if ([83, 111, 112].includes(code)) return 'water';
    if ([87, 190, 195].includes(code)) return 'wetland';
    if ([65, 131].includes(code)) return 'barren';
    return 'other';
  }

  // ---------------------------------------------------------------------------------------------------- the corridor
  /** Headings (radians from north, clockwise) from the geometry, for corridors that don't carry one. */
  function headings(lat, lon) {
    const n = lat.length, h = new Float32Array(n).fill(NaN);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      if (a === b) continue;
      h[k] = Math.atan2((lon[b] - lon[a]) * Math.cos(lat[k] * Math.PI / 180), lat[b] - lat[a]);
    }
    return h;
  }
  /** Every channel, span and point for one corridor from the loaded bundles (Map key -> parsed bundle). */
  function sampleCorridor(bundles, c) {
    const n = c.lat.length, ch = {};
    for (const name of CHANNELS) ch[name] = new Float32Array(n).fill(NaN);
    const head = headings(c.lat, c.lon);                                // radians, from the samples themselves
    let covered = 0, prev = null;
    const parkAt = new Array(n).fill(null);
    for (let k = 0; k < n; k++) {
      const la = c.lat[k], lo = c.lon[k];
      if (!finite(la) || !finite(lo)) continue;
      if (isCovered(bundles, la, lo)) covered++;
      for (const name of Object.keys(RASTERS)) {
        if (name === 'park_unit') continue;
        ch[name][k] = sample(bundles, name, la, lo);
      }
      const pu = sample(bundles, 'park_unit', la, lo);
      if (finite(pu)) {
        if (pu === 0) ch.park_visits[k] = 0;
        else {
          const b = bundles.get(keyOf(...project(la, lo, BUNDLE_Z).map(Math.floor))), unit = b && b.header.parks && b.header.parks[pu - 1];
          if (unit) { parkAt[k] = unit; ch.park_visits[k] = finite(unit.visits) ? unit.visits : NaN; }
        }
      }
      const m = matchLine(bundles, la, lo, head[k], prev);
      prev = m;
      for (const [cname, attr] of Object.entries(LINE_CHANNELS)) ch[cname][k] = lineValue(m, attr);
    }
    const cr = crashes(bundles, c.lat, c.lon, c.distM);
    ch.crash_density = cr.density;
    const spans = [];
    for (let k = 0; k < n; k++) {
      const u = parkAt[k]; if (!u) continue;
      const last = spans[spans.length - 1];
      if (last && last.code === u.code && last._k === k - 1) { last.toM = c.distM[k]; last._k = k; continue; }
      spans.push({ fromM: c.distM[k], toM: c.distM[k], kind: 'nps_unit', code: u.code, label: u.name, value: finite(u.visits) ? u.visits : undefined, monthly: u.monthly || undefined, year: u.year, _k: k });
    }
    spans.forEach((s) => delete s._k);
    return { covered, channels: ch, spans, points: cr.points };
  }

  // ---------------------------------------------------------------------------------------------------- loading
  const mem = new Map();                                                // key -> parsed bundle (most recent last)
  const remember = (k, b) => { mem.delete(k); mem.set(k, b); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };
  async function cacheGet(url) {
    try { if (root.caches) { const c = await root.caches.open(CACHE), r = await c.match(url); if (r) return new Uint8Array(await r.arrayBuffer()); } } catch (_) {}
    try { if (root.ApexOfflineTiles) { const d = await root.ApexOfflineTiles.get(url); if (d) return new Uint8Array(d); } } catch (_) {}
    return null;
  }
  async function cachePut(url, bytes) {
    try { if (root.caches) { const c = await root.caches.open(CACHE); await c.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } } catch (_) {}
  }
  const indexes = new Map();                                            // base -> { at, p: Promise<index | null> }
  /** Where bundles come from, in order: the ones shipped with the app and the site (web/data/ctx/v1: Cincinnati), then the
   * Worker's (/api/ctx/v1: the wider launch region, kept in KV by .github/workflows/context-grid.yml). */
  function basesOf(opts = {}) {
    const api = opts.apiBase !== undefined ? opts.apiBase : (root.ApexSync && root.ApexSync.apiBase) || '';
    return [BASE, `${api}/api/ctx/v1/`];
  }
  /** A base's index.json (which bundles it holds), fetched once a day, else the cached copy; null when there is none. */
  function loadIndex(base, fetchFn, signal) {
    const had = indexes.get(base);
    if (had && Date.now() - had.at < had.ttl) return had.p;
    const p = (async () => {
      const url = base + 'index.json';
      try {
        const r = await fetchFn(url, { signal });
        if (r.ok) { const j = await r.json(); if (j && j.bundles) { cachePut(url, new TextEncoder().encode(JSON.stringify(j))); return j; } }
      } catch (_) {}
      const c = await cacheGet(url);
      try { return c ? JSON.parse(new TextDecoder().decode(c)) : null; } catch (_) { return null; }
    })();
    indexes.set(base, { at: Date.now(), p, ttl: INDEX_TTL });
    // none there (or an empty index: the Worker's region isn't uploaded yet): ask again in 10 min
    p.then((v) => { if (!v || !v.bundles || !Object.keys(v.bundles).length) indexes.set(base, { at: Date.now(), p, ttl: MISS_TTL }); });
    return p;
  }
  /** key -> the URL to load it from, or null where no base has it. With no index at all (first run offline) the shipped
   * copy is tried. */
  async function resolver(fetchFn, signal, opts) {
    const bases = basesOf(opts), idx = await Promise.all(bases.map((b) => loadIndex(b, fetchFn, signal)));
    return (key) => {
      for (let k = 0; k < bases.length; k++) if (idx[k] && idx[k].bundles && idx[k].bundles[key]) return urlOf(key, bases[k]);
      return idx.some(Boolean) ? null : urlOf(key);
    };
  }
  /** The bundle URLs an offline area round (lat, lon) should keep (web/offline_tiles.js saves them with the map). */
  async function urlsNear(lat, lon, radiusKm, opts = {}) {
    const fetchFn = opts.fetchFn || (root.fetch && root.fetch.bind(root));
    if (!fetchFn) return [];
    const at = await resolver(fetchFn, opts.signal, opts);
    return bundlesNear(lat, lon, radiusKm).map(at).filter(Boolean);
  }
  /** The parsed bundle: memory, then the network (shipped copy or the Worker), then the caches (Cache Storage, offline areas). */
  async function loadBundle(key, url, fetchFn, signal) {
    if (mem.has(key)) { const b = mem.get(key); remember(key, b); return b; }
    let bytes = null;
    try {
      const r = await fetchFn(url, { signal });
      if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); cachePut(url, bytes); }
    } catch (_) {}
    if (!bytes) bytes = await cacheGet(url);
    if (!bytes) return null;
    try { const b = parse(await gunzip(bytes)); remember(key, b); return b; } catch (_) { return null; }
  }

  /** The provider: every corridor's channels from the bundles their samples touch (one load for the union). */
  async function fetchCorridors(corridors, opts = {}) {
    const fetchFn = opts.fetchFn || (root.fetch && root.fetch.bind(root)), signal = opts.signal, out = {};
    const budget = finite(opts.budgetMs) ? opts.budgetMs : provider.budgetMs;
    const list = corridors || [];
    const empty = (status, note) => { for (const c of list) out[c.id] = { status, note, channels: {}, spans: [], points: [] }; return out; };
    if (!fetchFn) return empty('unavailable', 'no fetch');
    const keys = new Set();
    for (const c of list) for (const k of bundlesFor(c.lat, c.lon)) keys.add(k);
    const bundles = new Map();
    let timer = null, wanted = [];
    const deadline = new Promise((ok) => { timer = setTimeout(ok, budget); });
    const work = (async () => {
      const at = await resolver(fetchFn, signal, opts);
      wanted = [...keys].filter((k) => mem.has(k) || at(k));
      await Promise.all(wanted.map(async (k) => { const b = await loadBundle(k, at(k), fetchFn, signal); if (b) bundles.set(k, b); }));
    })();
    await Promise.race([work, deadline]);
    clearTimeout(timer);
    if (!bundles.size) return empty('unavailable', wanted.length ? 'context bundles could not be loaded' : 'outside the context grid (the launch region)');
    for (const c of list) {
      const r = sampleCorridor(bundles, c), n = c.lat.length;
      const missing = CHANNELS.filter((name) => !r.channels[name].some(finite));
      const status = r.covered === n && wanted.every((k) => bundles.has(k)) ? 'ok' : r.covered ? 'partial' : 'unavailable';
      const note = status === 'ok' ? (missing.length ? `no data on this route for ${missing.join(', ')}` : undefined)
        : `${Math.round(100 * r.covered / Math.max(1, n))}% of the route inside the context grid`;
      out[c.id] = { status, note, channels: r.channels, spans: r.spans, points: r.points };
    }
    return out;
  }

  const provider = { id: 'context_grid', version: VERSION, channels: CHANNELS, needs: { network: false }, budgetMs: 4000, stageOk: true, fetch: fetchCorridors };
  const api = { VERSION, BASE, basesOf, RASTERS, CHANNELS, LINE_CHANNELS, project, bundlesFor, bundlesNear, urlsNear, urlOf, gunzip, parse, cell,
    sample, isCovered, undeltaLines, decode, matchLine, lineValue, crashes, cropGroup, headings, sampleCorridor, fetch: fetchCorridors, provider, _mem: mem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexContextGrid = api;
  // the route engine's registry (web/route_ctx/registry.js); until it loads, providers queue on `pending` (in node too, so
  // tests/test_route_ctx_registry.py can load every provider in any order)
  const reg = root.ApexRouteCtx || (root.ApexRouteCtx = { pending: [], register(p) { (this.pending || (this.pending = [])).push(p); return p; } });
  if (typeof reg.register === 'function') reg.register(provider);
})(typeof window !== 'undefined' ? window : globalThis);
