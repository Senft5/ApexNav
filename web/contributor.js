// Phone-side road-data contributor (docs/BACKEND.md sections 3-4). Turns a profiled drive into per-road bin summaries.
// What leaves the phone: OSM way id, direction, bin index, and four road numbers per 5 m bin. Never coordinates, speeds or times.
// The pure part (buildContributions) is deterministic and unit-tested; matchDrive/fetchWays/contributeDrive are the thin network shell.
(function (root) {
  const BIN_M = 5, MIN_BINS = 20, MAX_BINS = 2000, MAX_OFF_ROAD_M = 25, MAX_AGE_DAYS = 13;
  const SKIP_CLASSES = new Set(['residential', 'service_other', 'unclassified_service', 'service']);   // private-feeling roads are never contributed
  const M_LAT = 110540;

  /** Arc-length offset (m) of a point along a polyline [[lat,lon],...], plus its distance off the line. Local flat-earth projection. */
  function project(poly, lat, lon, cum) {
    const mLon = 111320 * Math.cos(lat * Math.PI / 180);
    let best = { off: 0, d: Infinity };
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = (poly[i][1] - lon) * mLon, ay = (poly[i][0] - lat) * M_LAT, bx = (poly[i + 1][1] - lon) * mLon, by = (poly[i + 1][0] - lat) * M_LAT;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { d, off: cum[i] + t * Math.sqrt(L2) };
    }
    return best;
  }
  function cumulative(poly) {
    const cum = [0];
    for (let i = 1; i < poly.length; i++) {
      const mLon = 111320 * Math.cos(poly[i][0] * Math.PI / 180);
      cum.push(cum[i - 1] + Math.hypot((poly[i][1] - poly[i - 1][1]) * mLon, (poly[i][0] - poly[i - 1][0]) * M_LAT));
    }
    return cum;
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * drive: { lat[], lon[], camber[] (deg or null), rough[], crest[], kappa[] } at 5 m spacing
   * match: per-sample { way: number|null, cls: string|null } (null = unmatched)
   * ways:  { [wayId]: [[lat, lon], ...] } OSM geometry, bins count from the way's first node
   * Returns contributions in the /api/contribute shape. Samples within trimM of either end are dropped (hides where a trip starts and ends).
   */
  function buildContributions({ drive, match, ways, drivenOn, trimM = 1000 }) {
    const n = drive.lat.length, trim = Math.round(trimM / BIN_M), out = [];
    const runs = [];                                                   // consecutive samples on one way
    for (let i = trim; i < n - trim; i++) {
      const m = match[i];
      if (!m || m.way == null || SKIP_CLASSES.has(m.cls)) continue;
      const last = runs[runs.length - 1];
      if (last && last.way === m.way && last.end === i - 1) { last.end = i; last.idx.push(i); } else runs.push({ way: m.way, end: i, idx: [i] });
    }
    const best = new Map();                                            // keep the longest run per (way, direction)
    for (const run of runs) {
      const poly = ways[run.way];
      if (!poly || poly.length < 2 || run.idx.length < MIN_BINS) continue;
      const cum = cumulative(poly);
      const pts = run.idx.map((i) => ({ i, ...project(poly, drive.lat[i], drive.lon[i], cum) }));
      if (pts.filter((p) => p.d > MAX_OFF_ROAD_M).length > pts.length * 0.1) continue;          // match did not really follow this way
      const fwd = pts[pts.length - 1].off - pts[0].off;
      if (Math.abs(fwd) < MIN_BINS * BIN_M * 0.5) continue;
      const dir = fwd > 0 ? 0 : 1;
      const byBin = new Map();
      for (const p of pts) {
        if (p.d > MAX_OFF_ROAD_M) continue;
        const b = Math.floor(p.off / BIN_M);
        (byBin.get(b) ?? byBin.set(b, []).get(b)).push(p.i);
      }
      const bins = [];
      for (const [b, ids] of [...byBin].sort((x, y) => x[0] - y[0])) {
        const rough = ids.map((i) => drive.rough[i]).filter(finite);
        if (!rough.length) continue;                                   // roughness unknown: leave the bin out rather than invent it
        const cam = ids.map((i) => drive.camber && drive.camber[i]).filter((v) => finite(v) && Math.abs(v) <= 15);
        const crest = ids.map((i) => drive.crest && drive.crest[i]).filter(finite);
        const k = ids.map((i) => drive.kappa[i]).filter((v) => finite(v) && Math.abs(v) <= 0.2);
        bins.push({ i: b, cam: cam.length ? +mean(cam).toFixed(2) : null, rough: +Math.min(1.5, mean(rough)).toFixed(3),
                    crest: +Math.min(3, crest.length ? Math.max(...crest) : 0).toFixed(3), k: +(k.length ? mean(k) : 0).toFixed(5) });
      }
      if (bins.length < MIN_BINS) continue;
      const span = bins[bins.length - 1].i - bins[0].i + 1;
      if (bins.length / span < 0.8) continue;                          // would be rejected as scattered
      const key = `${run.way}|${dir}`;
      if (!best.has(key) || best.get(key).bins.length < bins.length) best.set(key, { way_id: run.way, dir, driven_on: drivenOn, bins: bins.slice(0, MAX_BINS) });
    }
    return [...best.values()];
  }

  // ---- network shell -------------------------------------------------------------------------------------------------------
  const VALHALLA = 'https://valhalla1.openstreetmap.de', OVERPASS = 'https://overpass-api.de/api/interpreter';

  /** Snaps the drive to the road graph with Valhalla trace_attributes (chunks of 2,500 points). Returns the per-sample match array. */
  async function matchDrive(drive, fetchFn = fetch) {
    const n = drive.lat.length, out = new Array(n).fill(null), CH = 2500;
    for (let s = 0; s < n; s += CH) {
      const e = Math.min(n, s + CH + 20);                              // small overlap so edges continue across chunks
      const shape = []; for (let i = s; i < e; i++) shape.push({ lat: drive.lat[i], lon: drive.lon[i] });
      if (shape.length < 2) continue;
      const r = await fetchFn(`${VALHALLA}/trace_attributes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        shape, costing: 'auto', shape_match: 'map_snap', filters: { attributes: ['edge.way_id', 'edge.road_class', 'matched.edge_index', 'matched.type'], action: 'include' } }) });
      if (!r.ok) throw new Error(`map matching failed (${r.status})`);
      const j = await r.json();
      (j.matched_points || []).forEach((m, k) => {
        if (s + k >= Math.min(n, s + CH) || m.type === 'unmatched' || m.edge_index == null) return;
        const ed = j.edges[m.edge_index];
        if (ed && ed.way_id != null) out[s + k] = { way: ed.way_id, cls: ed.road_class || null };
      });
    }
    return out;
  }

  /** OSM geometry for the given way ids, in node order (Overpass). */
  async function fetchWays(ids, fetchFn = fetch) {
    const ways = {};
    for (let s = 0; s < ids.length; s += 40) {
      const q = `[out:json][timeout:25];way(id:${ids.slice(s, s + 40).join(',')});out geom;`;
      const r = await fetchFn(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error(`way lookup failed (${r.status})`);
      for (const el of (await r.json()).elements || []) if (el.type === 'way' && el.geometry) ways[el.id] = el.geometry.map((g) => [g.lat, g.lon]);
    }
    return ways;
  }

  const ageDays = (iso, now) => (now - Date.parse(iso)) / 86400_000;
  /** True when a drive is recent enough for the server's 14-day window and has the columns we need. */
  const eligible = (d, now = Date.now()) => !!(d && d.rough && d.kappa && d.date && ageDays(d.date, now) <= MAX_AGE_DAYS && ageDays(d.date, now) >= -1);

  /** Full pipeline for one drive. `post(contribution)` returns a Response-like or null. Returns { built, sent, skipped }. */
  async function contributeDrive(drive, post, opts = {}) {
    if (!eligible(drive, opts.now)) return { built: 0, sent: 0, skipped: 'drive is too old or lacks roughness data' };
    const match = await matchDrive(drive, opts.fetch);
    const ids = [...new Set(match.filter((m) => m && m.way != null).map((m) => m.way))];
    const ways = await fetchWays(ids, opts.fetch);
    const list = buildContributions({ drive, match, ways, drivenOn: drive.date.slice(0, 10), trimM: opts.trimM });
    let sent = 0;
    for (const c of list) {
      const r = await post(c);
      if (r === 'stop') break;
      if (r) sent++;
    }
    return { built: list.length, sent };
  }

  const api = { buildContributions, matchDrive, fetchWays, contributeDrive, eligible, project, cumulative, SKIP_CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexContributor = api;
})(typeof window !== 'undefined' ? window : globalThis);
