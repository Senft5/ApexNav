// Developers' drives (the owner, 2026-11-15: "just automatically send all of my and my codevs drives for internal use";
// backend/src/dev_drives.ts). Loaded lazily (lazy.js 'devdrives') and only while /api/me says this account is a developer
// (the owner and the co-developer): every drive on the phone, the ones from before too, goes up whole and gzipped, one at a
// time, once each. Nobody else's phone ever loads this file, and the server refuses anyone else's upload.
(function (root) {
  'use strict';
  const SENT_KEY = 'apex.devDrives.sent';             // ids already uploaded, on this phone
  const read = (store) => { try { const v = JSON.parse(store.getItem(SENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  const write = (store, ids) => { try { store.setItem(SENT_KEY, JSON.stringify(ids.slice(-2000))); } catch (_) {} };

  /** The drive's record as JSON text, gzipped (CompressionStream: iOS 16.4+), or null where it can't be. */
  async function gzip(text) {
    if (typeof root.CompressionStream !== 'function' || typeof root.Response !== 'function') return null;
    const s = new root.Blob([text]).stream().pipeThrough(new root.CompressionStream('gzip'));
    return new Uint8Array(await new root.Response(s).arrayBuffer());
  }

  let running = null;
  /**
   * Uploads every drive not yet sent. deps: { ids(), get(id), apiFetch(path, init), store (localStorage), allowed() }.
   * Stops at the first failure (offline, a rate limit) and tries again at the next sync. → { sent, pending }.
   */
  function sync(deps) {
    if (running) return running;
    running = (async () => {
      let sent = 0;
      const done = new Set(read(deps.store));
      const ids = (await deps.ids()).filter((id) => typeof id === 'string' && !done.has(id));
      for (const id of ids) {
        if (!deps.allowed()) break;
        const d = await deps.get(id);
        if (!d) { done.add(id); continue; }
        const bytes = await gzip(JSON.stringify(d));
        if (!bytes) break;
        let r;
        try { r = await deps.apiFetch(`/api/dev/drives/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: bytes }); }
        catch (_) { break; }
        if (!r || !r.ok) break;
        done.add(id); sent++;
        write(deps.store, [...done]);
      }
      const all = await deps.ids();
      return { sent, total: all.length, pending: all.filter((id) => !done.has(id)).length };
    })().finally(() => { running = null; });
    return running;
  }
  /** How many of the phone's drives have gone up. */
  const sentCount = (store) => read(store).length;

  const api = { sync, sentCount, gzip, SENT_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDevDrives = api;
})(typeof window !== 'undefined' ? window : globalThis);
