// Feature flags (IDEAS Y-06): which features the server has on for this build (backend/src/flags.ts), so one can be
// switched off or rolled out to a share of installs without a release. Cached on the phone; offline or before the first
// answer every feature keeps its shipped default (on). The install id is random and only buckets rollouts.
(function (root) {
  'use strict';
  const KEY = 'apex.flags', ID = 'apex.installId', TTL_MS = 6 * 3600 * 1000;
  const store = () => { try { return root.localStorage; } catch (_) { return null; } };
  function installId(s = store()) {
    try {
      let id = s && s.getItem(ID);
      if (!id) {
        const b = new Uint8Array(12); (root.crypto || globalThis.crypto).getRandomValues(b);
        id = 'i' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        if (s) s.setItem(ID, id);
      }
      return id;
    } catch (_) { return null; }
  }
  let flags = null;
  try { const c = JSON.parse((store() && store().getItem(KEY)) || 'null'); if (c && c.flags && typeof c.flags === 'object') flags = c; } catch (_) {}
  /** Fetches the flags when the cache is older than TTL_MS; `fetchFn(path)` resolves a Response (ApexSync.apiFetch). */
  async function load(fetchFn, now = Date.now()) {
    if (flags && now - flags.at < TTL_MS) return flags.flags;
    try {
      const r = await fetchFn(`/api/flags?install=${encodeURIComponent(installId() || '')}`);
      const j = r && r.ok ? await r.json() : null;
      if (j && j.flags && typeof j.flags === 'object') {
        flags = { at: now, flags: j.flags };
        try { const s = store(); if (s) s.setItem(KEY, JSON.stringify(flags)); } catch (_) {}
      }
    } catch (_) { /* offline: the last answer, or the defaults */ }
    return flags ? flags.flags : {};
  }
  /** Is `name` on? Unknown (offline, never asked, not listed) is the shipped default. */
  const on = (name, dflt = true) => (flags && typeof flags.flags[name] === 'boolean' ? flags.flags[name] : dflt);

  const api = { load, on, installId, TTL_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFlags = api;
})(typeof window !== 'undefined' ? window : globalThis);
