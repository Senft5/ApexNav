// Fair meeting points for crew drives (builder E). Crew members may share, per crew and off by default (the crew page's
// "Share my rough area" switch), the 0.1-degree cell they drive from (about 11 km, VI-1), taken from Home in their pinned
// places and coarsened on the phone before it is sent (PUT /api/crews/:id/home; the server coarsens again). The server
// answers the crew's cells without names, and only once two share (GET /api/crews/:id/meet, backend/src/crew_meet.ts).
// Here: candidate meeting points (each cell, their centroid, their geometric median, and any places the caller adds, such
// as the start of the crew's stage), one Valhalla matrix from every cell to every candidate (the public server already
// routes; it gets cell centres, never homes), and the fairest pick: least of (the longest drive + MEAN_WEIGHT x the mean).
// Crow-fly x DETOUR at FALLBACK_KMH when the matrix fails, marked estimated.
// Provider ('crew_meet'): with opts.crewCells, each candidate route's start gets a point { atM: 0, kind: 'crew_start',
// value: the longest crew-mate drive to it in minutes }, so a crew loop can start where it is fair. No channels.
// Pure parts exported for tests (tests/test_route_ctx_crew_meet.py).
(function (root) {
  'use strict';
  const U = typeof module !== 'undefined' && module.exports ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const CELL_DEG = 0.1, MEAN_WEIGHT = 0.25, MAX_CANDIDATES = 10, DETOUR = 1.35, FALLBACK_KMH = 60, MIN_CELLS = 2;
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const finite = U.finite;

  /** A position coarsened to its 0.1-degree cell centre, as the server keeps it: { lat, lon } or null. */
  function cellOf(lat, lon) {
    if (!finite(lat) || !finite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
    const c = (x) => +(Math.floor(x / CELL_DEG) * CELL_DEG + CELL_DEG / 2).toFixed(2);
    return { lat: c(lat), lon: c(lon) };
  }
  /** The area to share from pinned places: Home's cell, or null with no Home pinned. */
  function homeCell(pinned) {
    const h = (pinned || []).find((p) => p && /^home$/i.test(p.name));
    return h ? cellOf(h.lat, h.lon) : null;
  }

  /** Geometric median of points (Weiszfeld, a few rounds): the point least total distance from all. */
  function median(pts) {
    let x = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
    for (let it = 0; it < 30; it++) {
      let wl = 0, wo = 0, w = 0;
      for (const p of pts) { const d = Math.max(1, U.metres(x, p)), k = 1 / d; wl += p.lat * k; wo += p.lon * k; w += k; }
      x = { lat: wl / w, lon: wo / w };
    }
    return x;
  }
  /** Candidate meeting points: extra places first, then the median, the centroid and each cell; near-duplicates (1 km) dropped. */
  function candidates(cells, extra = []) {
    const pts = (cells || []).map(([lat, lon]) => ({ lat, lon }));
    if (!pts.length) return [];
    const centroid = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
    const all = [...(extra || []).filter((p) => p && finite(p.lat) && finite(p.lon)).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name || null })),
      { ...median(pts), name: null }, { ...centroid, name: null }, ...pts.map((p) => ({ ...p, name: null }))];
    const out = [];
    for (const p of all) if (!out.some((q) => U.metres(p, q) < 1000)) out.push(p);
    return out.slice(0, MAX_CANDIDATES);
  }

  /**
   * The fairest candidate from times[member][candidate] (seconds; null = no road): the least (max + MEAN_WEIGHT x mean) over
   * candidates every member can reach. { index, maxS, meanS, perMemberS } or null when none is reachable by all.
   */
  function fairPick(times) {
    if (!Array.isArray(times) || !times.length) return null;
    let best = null;
    for (let c = 0; c < times[0].length; c++) {
      const col = times.map((row) => row[c]);
      if (col.some((v) => !finite(v))) continue;
      const maxS = Math.max(...col), meanS = col.reduce((a, b) => a + b, 0) / col.length, score = maxS + MEAN_WEIGHT * meanS;
      if (!best || score < best.score) best = { index: c, maxS, meanS, perMemberS: col, score };
    }
    if (!best) return null;
    const { score, ...rest } = best;
    return rest;
  }
  /** Crow-fly estimate of the times (DETOUR x distance at FALLBACK_KMH). */
  const estimate = (from, to) => from.map((a) => to.map((b) => (U.metres(a, b) * DETOUR) / (FALLBACK_KMH / 3.6)));

  async function matrix(from, to, fetchFn) {
    try {
      const r = await fetchFn(`${VALHALLA}/sources_to_targets`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: from.map((p) => ({ lat: p.lat, lon: p.lon })), targets: to.map((p) => ({ lat: p.lat, lon: p.lon })), costing: 'auto' }) });
      const j = r && r.ok ? await r.json() : null;
      if (!j || !Array.isArray(j.sources_to_targets)) return null;
      return j.sources_to_targets.map((row) => row.map((c) => (c && finite(c.time) ? c.time : null)));
    } catch (_) { return null; }
  }

  /**
   * The fair meeting point for a crew's cells ([[lat, lon]], from /api/crews/:id/meet). opts: { extra (places to consider),
   * fetch }. { lat, lon, name, maxMin, meanMin, estimated } or null (fewer than MIN_CELLS, or nowhere all can reach).
   */
  async function fairMeet(cells, opts = {}) {
    if (!Array.isArray(cells) || cells.length < MIN_CELLS) return null;
    const from = cells.map(([lat, lon]) => ({ lat, lon })), cands = candidates(cells, opts.extra);
    const fetchFn = opts.fetch || (root.fetch && root.fetch.bind(root));
    let times = fetchFn ? await matrix(from, cands, fetchFn) : null, estimated = false;
    if (!times) { times = estimate(from, cands); estimated = true; }
    const pick = fairPick(times);
    if (!pick) return null;
    const c = cands[pick.index];
    return { lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), name: c.name, maxMin: Math.round(pick.maxS / 60), meanMin: Math.round(pick.meanS / 60), estimated };
  }

  /** Provider: how fair each candidate route's start is for the crew (opts.crewCells). */
  async function fetchCtx(corridors, opts = {}) {
    const out = {}, cells = opts.crewCells;
    const blank = (c, why) => ({ status: 'unavailable', note: why, channels: {}, spans: [], points: [] });
    if (!Array.isArray(cells) || cells.length < MIN_CELLS) { for (const c of corridors) out[c.id] = blank(c, 'No crew areas shared'); return out; }
    const from = cells.map(([lat, lon]) => ({ lat, lon })), starts = corridors.map((c) => ({ lat: c.lat[0], lon: c.lon[0] }));
    const fetchFn = opts.fetch || (root.fetch && root.fetch.bind(root));
    let times = fetchFn ? await U.within(matrix(from, starts, fetchFn), (opts.budgetMs || provider.budgetMs) - 200, opts.signal, null) : null, estimated = false;
    if (!times) { times = estimate(from, starts); estimated = true; }
    corridors.forEach((c, k) => {
      const col = times.map((row) => row[k]);
      if (col.some((v) => !finite(v))) { out[c.id] = blank(c, 'A crew-mate can’t reach the start'); return; }
      const maxMin = Math.round(Math.max(...col) / 60);
      out[c.id] = { status: estimated ? 'partial' : 'ok', ...(estimated ? { note: 'Crow-fly estimate' } : {}), channels: {}, spans: [],
        points: [{ atM: 0, kind: 'crew_start', value: maxMin, label: `The furthest crew-mate is ${estimated ? 'about ' : ''}${maxMin} min from the start` }] };
    });
    return out;
  }

  const provider = { id: 'crew_meet', version: 1, channels: [], needs: { network: true }, budgetMs: 6000, fetch: fetchCtx };
  U.registry().register(provider);

  const api = { provider, cellOf, homeCell, median, candidates, fairPick, estimate, fairMeet, MEAN_WEIGHT, MIN_CELLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewMeet = api;
})(typeof window !== 'undefined' ? window : globalThis);
