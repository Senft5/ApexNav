// The plan sheet's Prefer stamps (docs/design/REVIEW.md 3.3, mockup 03-plan-more.html): Measured roads, New to me, Crew
// favourites. The router can't take these, so they rank the candidates it gave, the way taste does: a few fun points
// toward the share of a route that is measured by members, that you haven't driven, or that your crews shared. Your
// drives never leave the phone for this. Pure (tests/test_prefer.py).
(function (root) {
  'use strict';
  const CELL_M = 80, POINTS = 6, STEP = 4;
  const KEYS = ['measured', 'novel', 'crew'];
  const LABELS = { measured: 'Measured roads', novel: 'New to me', crew: 'Crew favourites' };

  const cell = (lat, lon) => {
    const y = Math.round((lat * 110540) / CELL_M), x = Math.round((lon * 111320 * Math.cos((lat * Math.PI) / 180)) / CELL_M);
    return [y, x];
  };
  /** A set of ~80 m cells covered by some lines: [{ lat: [], lon: [] }] or [[lon, lat], ...] lists. */
  function grid(lines) {
    const s = new Set();
    for (const ln of lines || []) {
      const lat = Array.isArray(ln && ln.lat) ? ln.lat : Array.isArray(ln) ? ln.map((p) => p[1]) : [];
      const lon = Array.isArray(ln && ln.lon) ? ln.lon : Array.isArray(ln) ? ln.map((p) => p[0]) : [];
      for (let i = 0; i < lat.length; i += 2) if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) { const [y, x] = cell(lat[i], lon[i]); s.add(`${y}:${x}`); }
    }
    return s;
  }
  /** The share (0..1) of a route's samples within a cell of the set or next to one; null for an empty route or set. */
  function share(t, set) {
    if (!t || !Array.isArray(t.lat) || !t.lat.length || !set || !set.size) return null;
    let hit = 0, n = 0;
    for (let i = 0; i < t.lat.length; i += STEP) {
      const [y, x] = cell(t.lat[i], t.lon[i]); n++;
      search: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (set.has(`${y + dy}:${x + dx}`)) { hit++; break search; }
    }
    return n ? hit / n : null;
  }
  /** Fun points for the stamped preferences: up to POINTS each, for the share measured, new to you, crew-shared. Unknown counts nothing. */
  function bonus(prefer, f) {
    if (!prefer || !f) return 0;
    let b = 0;
    if (prefer.measured && Number.isFinite(f.measured)) b += POINTS * f.measured;
    if (prefer.novel && Number.isFinite(f.driven)) b += POINTS * (1 - f.driven);
    if (prefer.crew && Number.isFinite(f.crew)) b += POINTS * f.crew;
    return Math.round(b * 10) / 10;
  }
  /** Only the three known keys, as booleans. */
  function clean(p) { const o = {}; for (const k of KEYS) o[k] = !!(p && p[k]); return o; }

  const api = { grid, share, bonus, clean, KEYS, LABELS, POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPrefer = api;
})(typeof window !== 'undefined' ? window : globalThis);
