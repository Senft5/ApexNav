// Pinned places (IDEAS U-20): Home, Work and places you name, first in Where to?, one tap to route there. Kept on this
// phone only (apex.pinnedPlaces): a home address is the most sensitive thing a navigation app holds, so it is never sent to
// the server. Erase everything clears it. Pure (tests/test_pinned_places.py).
(function (root) {
  'use strict';
  const KEY = 'apex.pinnedPlaces', MAX = 12, MAX_NAME = 30;
  const ok = (p) => p && typeof p.name === 'string' && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  const rank = (n) => (/^home$/i.test(n) ? 0 : /^work$/i.test(n) ? 1 : 2);

  /** Pinned places, Home first, then Work, then the rest as pinned (newest first). */
  function list(storage) {
    let v = [];
    try { v = JSON.parse(storage.getItem(KEY) || '[]'); } catch (_) {}
    return (Array.isArray(v) ? v.filter(ok) : []).map((p, i) => ({ ...p, i })).sort((a, b) => rank(a.name) - rank(b.name) || a.i - b.i)
      .map(({ i, ...p }) => p);
  }
  /** Pin `place` ({ label, lat, lon }) as `name`; the same name (any case) is replaced. Returns the list, or null when refused. */
  function pin(storage, name, place) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    const p = { name: n, label: String((place && place.label) || n).slice(0, 120), lat: place && place.lat, lon: place && place.lon };
    if (!ok(p)) return null;
    const rest = list(storage).filter((q) => q.name.toLowerCase() !== n.toLowerCase());
    const all = [p, ...rest].slice(0, MAX);
    try { storage.setItem(KEY, JSON.stringify(all)); } catch (_) { return null; }
    return list(storage);
  }
  function unpin(storage, name) {
    const rest = list(storage).filter((q) => q.name.toLowerCase() !== String(name).toLowerCase());
    try { if (rest.length) storage.setItem(KEY, JSON.stringify(rest)); else storage.removeItem(KEY); } catch (_) {}
    return rest;
  }

  const api = { KEY, MAX, list, pin, unpin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPinnedPlaces = api;
})(typeof window !== 'undefined' ? window : globalThis);
