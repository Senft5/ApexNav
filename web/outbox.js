// Sends that waited for signal (IDEAS F-05): a hazard report or a "still there?" answer made with no connection is kept on
// the phone and sent when the connection is back, with how long ago it was made so the server can age it. The road
// doesn't wait for coverage: mountain stages are exactly where reports are made with none.
// Pure over an injected storage and send(); the page calls flush() when it comes online, when it's shown again and now
// and then while driving. tests/test_outbox.py.
(function (root) {
  'use strict';
  const KEY = 'apex.outbox', MAX_ITEMS = 20, MAX_AGE_MS = 24 * 3600_000;

  /**
   * storage: a localStorage-like object. send(path, body) resolves to an HTTP status, or rejects / resolves null when
   * there is no connection. Returns { add, flush, size }.
   */
  function createOutbox(storage, send, now = () => Date.now()) {
    const load = () => { try { const v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
    const save = (list) => { try { if (list.length) storage.setItem(KEY, JSON.stringify(list)); else storage.removeItem(KEY); } catch (_) {} };
    const fresh = (list) => list.filter((x) => x && typeof x.path === 'string' && now() - x.at < MAX_AGE_MS);
    let busy = null;

    /** Keeps a send for later. `aged` adds age_s (seconds since it was made) to the body when it goes. */
    function add(path, body, aged = false) {
      const list = fresh(load());
      list.push({ path, body, at: now(), aged });
      save(list.slice(-MAX_ITEMS));     // the oldest go first when it fills
    }

    /**
     * Sends what's waiting, oldest first. Kept when the connection fails or the server can't take it now (5xx, 408, 429);
     * dropped once sent or refused for good (other 4xx, like a hazard that has since gone). Resolves how many were sent.
     */
    function flush() {
      if (busy) return busy;
      busy = (async () => {
        let list = fresh(load()), sent = 0;
        save(list);
        for (const item of list.slice()) {
          const body = item.aged ? { ...item.body, age_s: Math.max(0, Math.round((now() - item.at) / 1000)) } : item.body;
          let status = null;
          try { status = await send(item.path, body); } catch (_) { status = null; }
          if (status == null) break;                                         // still no connection: try again later
          if (status >= 500 || status === 408 || status === 429) break;     // the server is busy: keep the rest in order
          list = list.filter((x) => x !== item);
          if (status < 300) sent++;
          save(list);
        }
        return sent;
      })().finally(() => { busy = null; });
      return busy;
    }

    return { add, flush, size: () => fresh(load()).length };
  }

  const api = { createOutbox, KEY, MAX_ITEMS, MAX_AGE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexOutbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
