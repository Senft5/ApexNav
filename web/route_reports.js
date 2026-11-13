// Reported hazards kept with a saved route (IDEAS F-03): when a route is saved for offline, the members' reports in the
// cells it runs through (privacy_zones.js routeCells: coarse cells, never the ends' or a privacy zone's) are kept on the
// phone with the time they were asked, so the route card and a drive in a dead zone still have them. Expired reports drop
// out as they are read; nothing is invented, and the card says how old the reports are.
(function (root) {
  'use strict';
  const KEY = 'apex.routeReports', MAX_ROUTES = 10, MAX_ROWS = 50;
  const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
  const live = (rows, nowMs) => (Array.isArray(rows) ? rows : []).filter((h) => { const x = h ? ms(h.expires_at) : NaN; return h && (!Number.isFinite(x) || x > nowMs); });

  function all(storage) {
    try { const v = JSON.parse(storage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; }
  }
  function write(storage, v) { try { storage.setItem(KEY, JSON.stringify(v)); return true; } catch (_) { return false; } }

  /** Keeps `cells` ({ key: rows }) for route `id`, asked at `nowMs`; the oldest routes go past MAX_ROUTES. */
  function save(storage, id, cells, nowMs = Date.now()) {
    if (!id || !cells || typeof cells !== 'object') return false;
    const kept = {};
    for (const [k, rows] of Object.entries(cells)) if (Array.isArray(rows)) kept[k] = live(rows, nowMs).slice(0, MAX_ROWS);
    const v = all(storage);
    v[id] = { at: nowMs, cells: kept };
    const ids = Object.keys(v).sort((a, b) => (v[b].at || 0) - (v[a].at || 0));
    for (const old of ids.slice(MAX_ROUTES)) delete v[old];
    return write(storage, v);
  }
  /** The route's kept reports still live at `nowMs`: { at, cells: { key: rows }, rows: every row once }, or null. */
  function load(storage, id, nowMs = Date.now()) {
    const e = all(storage)[id];
    if (!e || !Number.isFinite(e.at) || !e.cells || typeof e.cells !== 'object') return null;
    const cells = {}, seen = new Set(), rows = [];
    for (const [k, list] of Object.entries(e.cells)) {
      cells[k] = live(list, nowMs);
      for (const h of cells[k]) { const key = h.id != null ? `id:${h.id}` : JSON.stringify(h); if (!seen.has(key)) { seen.add(key); rows.push(h); } }
    }
    return { at: e.at, cells, rows };
  }
  function remove(storage, id) { const v = all(storage); if (!(id in v)) return false; delete v[id]; return write(storage, v); }

  const api = { KEY, MAX_ROUTES, MAX_ROWS, save, load, remove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteReports = api;
})(typeof window !== 'undefined' ? window : globalThis);
