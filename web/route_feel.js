// Members' road feel kept with a saved route (IDEAS F-03): what the crowd measured along it (contributor.js measuredAlong:
// the coverage line's numbers, the driven corners that replace the map's, the bumps several members felt, the crests they went light over,
// the broken pavement they measured) is kept on the
// phone when the route is saved or its card asks with signal, so a saved route opened with no signal still gets the
// members' corners and bump calls and says how old they are. Only what the route uses is kept: the curvature runs that
// blendCurvature would take (2+ passes, 30 m), by metres along the route so a rebuilt track lines up. Nothing is invented;
// a route nobody measured keeps nothing. Members' data: it leaves the phone with sign-out and Delete offline data.
(function (root) {
  'use strict';
  const KEY = 'apex.routeFeel', MAX_ROUTES = 20, MAX_CHARS = 400_000, MIN_PASSES = 2, MIN_RUN = 6, K_SCALE = 1e6;
  const SUM = ['km', 'coveredKm', 'coverage', 'located', 'roughness', 'bankedKm', 'offCamberKm', 'roughCoverage', 'camberCoverage',
    'avgPasses', 'smoothKm', 'roughKm', 'disputedKm', 'repavedKm'];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;

  function all(storage) {
    try { const v = JSON.parse(storage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; }
  }
  function write(storage, v) { try { storage.setItem(KEY, JSON.stringify(v)); return true; } catch (_) { return false; } }

  /** The compact copy of measured `m` along a track with distances `dist`, or null (nothing measured). */
  function pack(m, dist, nowMs = Date.now()) {
    if (!m || typeof m !== 'object' || !Array.isArray(dist) || !dist.length) return null;
    const sum = {};
    for (const k of SUM) sum[k] = finite(m[k]) ? r4(m[k]) : null;
    if (typeof m.repavedOn === 'string') sum.repavedOn = m.repavedOn;
    const k = [], K = Array.isArray(m.crowdK) ? m.crowdK : [], N = Array.isArray(m.crowdKn) ? m.crowdKn : [];
    const ok = (i) => finite(K[i]) && finite(N[i]) && N[i] >= MIN_PASSES && finite(dist[i]);
    for (let i = 0; i < Math.min(K.length, dist.length);) {
      if (!ok(i)) { i++; continue; }
      let j = i;
      while (j < Math.min(K.length, dist.length) && ok(j)) j++;
      if (j - i >= MIN_RUN) k.push([Math.round(dist[i]), K.slice(i, j).map((v) => Math.round(v * K_SCALE))]);
      i = j;
    }
    // the camber members agree on (contributor.js camFrom): runs [metres, tenths of a degree...], only when there is any
    const cam = [], C = Array.isArray(m.crowdCam) ? m.crowdCam : [];
    for (let i = 0; i < Math.min(C.length, dist.length);) {
      if (!finite(C[i]) || !finite(dist[i])) { i++; continue; }
      let j = i;
      while (j < Math.min(C.length, dist.length) && finite(C[j])) j++;
      cam.push([Math.round(dist[i]), C.slice(i, j).map((v) => Math.round(v * 10))]);
      i = j;
    }
    const bumps = (Array.isArray(m.crowdBumps) ? m.crowdBumps : [])
      .filter((b) => b && Number.isInteger(b.index) && finite(dist[b.index]))
      .map((b) => [Math.round(dist[b.index]), finite(b.p) ? r4(b.p) : null]);
    // and the crests members felt (contributor.js crestsFrom): [metres, g], kept only when there are any
    const crests = (Array.isArray(m.crowdCrests) ? m.crowdCrests : [])
      .filter((c) => c && Number.isInteger(c.index) && finite(dist[c.index]))
      .map((c) => [Math.round(dist[c.index]), finite(c.g) ? r4(c.g) : null]);
    // and the broken pavement members measured (contributor.js roughFrom): [from metres, to metres], only when there is any
    const rough = (Array.isArray(m.crowdRough) ? m.crowdRough : [])
      .filter((r) => r && Number.isInteger(r.index) && Number.isInteger(r.endIndex) && finite(dist[r.index]) && finite(dist[r.endIndex]))
      .map((r) => [Math.round(dist[r.index]), Math.round(dist[r.endIndex])]);
    return { at: nowMs, sum, k, bumps, ...(crests.length ? { crests } : {}), ...(rough.length ? { rough } : {}), ...(cam.length ? { cam } : {}) };
  }
  const indexAt = (dist, m) => {
    let lo = 0, hi = dist.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dist[mid] < m) lo = mid + 1; else hi = mid; }
    return lo;
  };
  /** Back to measuredAlong's shape on a (rebuilt) track's distances, with `keptAt`; null when the copy doesn't fit it. */
  function unpack(p, dist) {
    if (!p || !p.sum || !Array.isArray(dist) || !dist.length || !finite(p.at)) return null;
    const n = dist.length, end = dist[n - 1], out = { keptAt: p.at };
    for (const k of SUM) out[k] = finite(p.sum[k]) ? p.sum[k] : null;
    out.coverage = out.coverage ?? 0;
    if (typeof p.sum.repavedOn === 'string') out.repavedOn = p.sum.repavedOn;
    const K = new Array(n).fill(null), N = new Array(n).fill(null);
    for (const run of Array.isArray(p.k) ? p.k : []) {
      if (!Array.isArray(run) || !finite(run[0]) || !Array.isArray(run[1]) || run[0] > end + 1) continue;
      const i0 = indexAt(dist, run[0]);
      run[1].forEach((v, q) => { if (i0 + q < n && finite(v)) { K[i0 + q] = v / K_SCALE; N[i0 + q] = MIN_PASSES; } });
    }
    out.crowdK = K; out.crowdKn = N;
    if (Array.isArray(p.cam)) {
      const A = new Array(n).fill(null);
      for (const run of p.cam) {
        if (!Array.isArray(run) || !finite(run[0]) || !Array.isArray(run[1]) || run[0] > end + 1) continue;
        const i0 = indexAt(dist, run[0]);
        run[1].forEach((v, q) => { if (i0 + q < n && finite(v)) A[i0 + q] = v / 10; });
      }
      out.crowdCam = A;
    }
    out.crowdBumps = (Array.isArray(p.bumps) ? p.bumps : []).filter((b) => Array.isArray(b) && finite(b[0]) && b[0] <= end + 1)
      .map((b) => ({ index: indexAt(dist, b[0]), p: finite(b[1]) ? b[1] : null }));
    out.crowdCrests = (Array.isArray(p.crests) ? p.crests : []).filter((c) => Array.isArray(c) && finite(c[0]) && c[0] <= end + 1)
      .map((c) => ({ index: indexAt(dist, c[0]), g: finite(c[1]) ? c[1] : null }));
    out.crowdRough = (Array.isArray(p.rough) ? p.rough : []).filter((r) => Array.isArray(r) && finite(r[0]) && finite(r[1]) && r[0] <= end + 1)
      .map((r) => ({ index: indexAt(dist, r[0]), endIndex: indexAt(dist, Math.min(r[1], end)) }));
    return out;
  }
  /** Keeps measured `m` for route `id`; the oldest routes go past MAX_ROUTES or MAX_CHARS. False when nothing was kept. */
  function save(storage, id, m, dist, nowMs = Date.now()) {
    const p = id ? pack(m, dist, nowMs) : null;
    if (!p || JSON.stringify(p).length > MAX_CHARS) return false;   // one route alone too big: nothing new kept
    const v = all(storage);
    v[id] = p;
    let ids = Object.keys(v).sort((a, b) => (v[b].at || 0) - (v[a].at || 0));
    for (const old of ids.slice(MAX_ROUTES)) delete v[old];
    ids = ids.slice(0, MAX_ROUTES);
    while (ids.length > 1 && JSON.stringify(v).length > MAX_CHARS) delete v[ids.pop()];
    return write(storage, v);
  }
  function load(storage, id, dist) { return id ? unpack(all(storage)[id], dist) : null; }
  function remove(storage, id) { const v = all(storage); if (!(id in v)) return false; delete v[id]; return write(storage, v); }

  const api = { KEY, MAX_ROUTES, MAX_CHARS, pack, unpack, save, load, remove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteFeel = api;
})(typeof window !== 'undefined' ? window : globalThis);
