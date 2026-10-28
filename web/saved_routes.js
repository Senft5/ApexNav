// Routes saved for offline (IDEAS F-03). A saved route keeps what driving it needs with no signal: its shape (the pace
// notes are worked out from it on the phone), the junction directions (V-04), the router's times for the ETA, and the
// posted limits along it. The map itself still needs signal (offline regions are F-02); the page says so.
// pack/unpack are also used for the route kept across an app restart. Pure (tests/test_saved_routes.py).
(function (root) {
  'use strict';
  const KEY = 'apex.savedRoutes', MAX = 20, MAX_CHARS = 1_500_000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  /** Per-point limits as change points by distance ([[fromM, value|null], ...]): a road keeps one limit for long stretches. */
  function changes(a, dist) {
    const out = [];
    (a || []).forEach((v, i) => {
      const x = finite(v) ? Math.round(v * 100) / 100 : null, last = out[out.length - 1];
      if (!last || last[1] !== x) out.push([Math.round(dist[i]), x]);
    });
    return out;
  }
  /** Back to per-point values on a (rebuilt) track's distances. */
  function fill(ch, dist) {
    if (!Array.isArray(ch) || !ch.length || !Array.isArray(dist)) return null;
    const out = new Array(dist.length); let k = 0;
    for (let i = 0; i < dist.length; i++) {
      while (k + 1 < ch.length && ch[k + 1][0] <= dist[i]) k++;
      out[i] = dist[i] >= ch[0][0] && finite(ch[k][1]) ? ch[k][1] : null;
    }
    return out;
  }

  /** What to keep of a built route `t` (lat/lon arrays plus what the router gave). */
  function pack(t, now = Date.now()) {
    return {
      v: 1, id: t.id, name: t.name, savedAt: now, request: t.request || null,
      coords: t.lat.map((la, i) => [r6(t.lon[i]), r6(la)]),
      steps: Array.isArray(t.steps) ? t.steps : [], timeMarks: Array.isArray(t.timeMarks) ? t.timeMarks : [],
      limits: Array.isArray(t.limitMps) && Array.isArray(t.dist) && t.limitMps.length === t.dist.length ? changes(t.limitMps, t.dist) : null,
      fun: t.fun || null, timeS: finite(t.timeS) ? t.timeS : null, why: typeof t.why === 'string' ? t.why : null,
      unavoided: Array.isArray(t.unavoided) ? t.unavoided : [], townKm: finite(t.townKm) || t.townKm === null ? t.townKm : undefined,
      miles: Array.isArray(t.dist) && t.dist.length ? Math.round(t.dist[t.dist.length - 1] / 160.9344) / 10 : null,
    };
  }

  /** The fields to put back on a track rebuilt from `p.coords` (its `dist`, metres along it). */
  function unpack(p, dist) {
    const limits = fill(p.limits, dist);
    return {
      request: p.request || null, steps: Array.isArray(p.steps) ? p.steps : [], timeMarks: Array.isArray(p.timeMarks) ? p.timeMarks : [],
      limitMps: limits || undefined, fun: p.fun || null, timeS: finite(p.timeS) ? p.timeS : null,
      why: typeof p.why === 'string' ? p.why : null, unavoided: Array.isArray(p.unavoided) ? p.unavoided : [], townKm: p.townKm,
    };
  }

  const valid = (p) => p && typeof p.id === 'string' && Array.isArray(p.coords) && p.coords.length >= 2;
  function list(storage) {
    try { const v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(valid) : []; } catch (_) { return []; }
  }
  /**
   * Saves (or re-saves) a packed route, newest first, at most MAX and MAX_CHARS (the oldest go). Returns 'saved' or
   * 'full' when the phone refused even after dropping old ones.
   */
  function save(storage, packed) {
    let all = [packed, ...list(storage).filter((p) => p.id !== packed.id)].slice(0, MAX);
    while (all.length > 1 && JSON.stringify(all).length > MAX_CHARS) all = all.slice(0, -1);
    try { storage.setItem(KEY, JSON.stringify(all)); return 'saved'; } catch (_) { return 'full'; }
  }
  function remove(storage, id) {
    const all = list(storage).filter((p) => p.id !== id);
    try { if (all.length) storage.setItem(KEY, JSON.stringify(all)); else storage.removeItem(KEY); } catch (_) {}
  }
  const has = (storage, id) => list(storage).some((p) => p.id === id);

  const api = { pack, unpack, changes, fill, list, save, remove, has, KEY, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSavedRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
