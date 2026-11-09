// Road data that waited for signal (IDEAS Q-06, F-05). Matching a drive to the map needs the network, and the roads worth
// measuring are where there is none: until this, a trip that ended without signal (or an app closed while it was retrying)
// lost every section it had not sent. Now the unsent part of a trip is kept on the phone and sent when signal is back.
//
// What is kept is what contributor.js createLive would still have sent (leftover()): the 5 m rows between the trip's private
// ends, never the ends themselves, and the built chunks that were waiting. It stays on the phone (IndexedDB) for at most
// MAX_AGE_DAYS (the server takes a drive for 14), goes only with Road data still switched on, and is removed by "Erase
// everything on this phone": the index lives in localStorage under an apex.* key, which Erase clears, and a missing index
// empties the store when the page next loads.
// Pure over an injected store, storage and resume (tests/test_road_carry.py); the browser part at the bottom wires it up.
(function (root) {
  'use strict';
  const KEY = 'apex.roadCarry', MAX_AGE_DAYS = 13, MAX_ROWS = 40000, BIN_M = 5, DAY = 86400_000;
  const COLS = ['lat', 'lon', 'rough', 'camber', 'crest', 'speed', 'lon_g'];
  const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

  /** The metres of road waiting, from the index alone (my_data.js shows it; no IndexedDB read). */
  function waitingM(storage) {
    try { const ix = JSON.parse(storage.getItem(KEY) || '{}'); return Object.values(ix).reduce((s, e) => s + (e && e.n > 0 ? e.n : 0), 0) * BIN_M; } catch (_) { return 0; }
  }

  /**
   * Sends one kept item through contributor.js: the same rows and chunks, no private ends to cut (they were never kept).
   * Resolves { km, stopped, left }: left is what still has not gone (null when all of it has).
   */
  async function resumeItem(item, { Contributor, Core, post, fetch: fetchFn }) {
    const live = Contributor.createLive({ Core, post, fetch: fetchFn, driveId: item.driveId, drivenOn: item.drivenOn, deliberate: !!item.deliberate,
      hourBucket: () => (Number.isInteger(item.hr) ? item.hr : null), skip: 0, lag: 0, rows: item.rows, pending0: item.pending, carry: null });
    const s = await live.finish();
    return { km: s.km, stopped: !!s.stopped, left: live.leftover() };
  }

  /**
   * store: async { keys(), get(id), put(id, item), del(id), clear() }. storage: localStorage-like (the index).
   * resume(item) -> { km, stopped, left } (resumeItem). ready(): may we send now (online, signed in, Road data on)?
   * Returns { hold, drop, attach, checkpoint, flush, size, waitingM, clear, idle }.
   */
  function createCarry({ store, storage, resume, ready = async () => true, now = Date.now, maxAgeDays = MAX_AGE_DAYS, maxRows = MAX_ROWS, onSent = null }) {
    const live = new Map();                                              // trips still being driven in this page: theirs to send, not flush's
    let chain = Promise.resolve(), busy = null;
    const q = (fn) => { chain = chain.then(fn).catch(() => {}); return chain; };
    const index = () => { try { const v = JSON.parse(storage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
    const saveIndex = (ix) => { try { if (Object.keys(ix).length) storage.setItem(KEY, JSON.stringify(ix)); else storage.removeItem(KEY); } catch (_) {} };
    const expired = (e) => !e || !(now() - Date.parse(e.day + 'T00:00:00Z') <= maxAgeDays * DAY);
    const rowsOf = (item) => (item.rows && Array.isArray(item.rows.lat) ? item.rows.lat.length : 0);

    // Erase everything (or a browser that dropped localStorage) removed the index: nothing may stay behind it. Items the
    // index doesn't know (a write that half happened) go too.
    q(async () => {
      const ix = index(), known = Object.keys(ix);
      if (!known.length) { await store.clear(); return; }
      for (const id of await store.keys()) if (!ix[id]) await store.del(id);
    });

    async function remove(id) { const ix = index(); delete ix[id]; saveIndex(ix); await store.del(id); }
    async function write(item, at) {
      let n = rowsOf(item);
      if (n > maxRows) { const rows = {}; for (const k of COLS) rows[k] = Array.isArray(item.rows[k]) ? item.rows[k].slice(0, maxRows) : []; item = { ...item, rows }; n = maxRows; }
      await store.put(item.driveId, item);
      const ix = index();
      ix[item.driveId] = { at: ix[item.driveId] ? ix[item.driveId].at : at, n, day: item.drivenOn };
      // over the cap: the oldest trips that are not being driven now make room
      const ids = Object.keys(ix).sort((a, b) => ix[a].at - ix[b].at);
      let total = ids.reduce((s, id) => s + ix[id].n, 0);
      for (const id of ids) { if (total <= maxRows) break; if (id === item.driveId || live.has(id)) continue; total -= ix[id].n; delete ix[id]; await store.del(id); }
      saveIndex(ix);
    }

    /** Keeps (or replaces) what a trip has not sent. final: the trip is over. */
    function hold(item, final = false) {
      if (!item || !okId(item.driveId) || typeof item.drivenOn !== 'string' || !item.rows) return;
      const copy = { driveId: item.driveId, drivenOn: item.drivenOn, deliberate: !!item.deliberate, hr: Number.isInteger(item.hr) ? item.hr : null,
        rows: item.rows, pending: Array.isArray(item.pending) ? item.pending : [] }, at = now();
      if (final) live.delete(item.driveId);
      q(() => write(copy, at));
    }
    /** The trip sent everything after all (or was refused): nothing of it stays. */
    function drop(driveId) { q(() => remove(driveId)); }
    /** A trip being driven now: `checkpoint()` makes it hold what it has not sent. Returns the detach. */
    function attach(driveId, checkpoint) { live.set(driveId, checkpoint); return () => { live.delete(driveId); }; }
    /** The page is going to the background and may never come back: every trip under way holds what it has not sent. */
    function checkpoint() { for (const cp of [...live.values()]) { try { cp(); } catch (_) {} } }

    /** Sends what waits, oldest first. Resolves the km sent. One at a time; a trip still being driven is left to itself. */
    function flush() {
      if (busy) return busy;
      busy = (async () => {
        await chain;
        let km = 0, ix = index();
        for (const id of Object.keys(ix)) if (expired(ix[id]) && !live.has(id)) await q(() => remove(id));
        ix = index();
        const ids = Object.keys(ix).filter((id) => !live.has(id)).sort((a, b) => ix[a].at - ix[b].at);
        if (!ids.length || !(await ready())) return 0;
        for (const id of ids) {
          const item = await store.get(id);
          if (!item || !item.rows) { await q(() => remove(id)); continue; }
          let r;
          try { r = await resume(item); } catch (_) { break; }
          km += r.km || 0;
          if (r.stopped || !r.left) { await q(() => remove(id)); if (r.stopped) break; continue; }
          await q(() => write({ ...r.left, driveId: id, drivenOn: item.drivenOn }, ix[id].at));
          break;                                                          // something is still in the way (no signal, a busy server): the rest waits its turn
        }
        if (km > 0 && onSent) { try { onSent(km); } catch (_) {} }
        return km;
      })().finally(() => { busy = null; });
      return busy;
    }

    return { hold, drop, attach, checkpoint, flush, size: () => Object.keys(index()).length, waitingM: () => waitingM(storage),
      clear: () => q(async () => { saveIndex({}); await store.clear(); }), idle: () => chain };
  }

  /** The IndexedDB store behind it in the browser. Every call resolves (null / [] when the database can't be had). */
  function idbStore(idb, name = 'vetta-road-carry') {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((ok, no) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('items');
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); r.onblocked = () => no(new Error('blocked'));
    }).catch((e) => { dbp = null; throw e; }));
    const tx = (mode, fn) => open().then((db) => new Promise((ok, no) => {
      const t = db.transaction('items', mode), rq = fn(t.objectStore('items'));
      t.oncomplete = () => ok(rq ? rq.result : undefined); t.onerror = t.onabort = () => no(t.error);
    }));
    return { keys: () => tx('readonly', (s) => s.getAllKeys()).then((k) => k || []), get: (id) => tx('readonly', (s) => s.get(id)),
      put: (id, item) => tx('readwrite', (s) => s.put(item, id)), del: (id) => tx('readwrite', (s) => s.delete(id)), clear: () => tx('readwrite', (s) => s.clear()) };
  }

  const api = { KEY, MAX_AGE_DAYS, MAX_ROWS, createCarry, resumeItem, idbStore, waitingM };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---- browser -----------------------------------------------------------------------------------------------------------
  // contributor.js createLive finds this as root.ApexRoadCarry (hold / drop / attach). Nothing here asks the network while
  // nothing waits. A replayed or review session (APEX_REVIEW) never sends.
  let carry = null;
  try {
    if (root.indexedDB && root.localStorage) {
      const sync = () => root.ApexSync, contributor = () => root.ApexContributor, core = () => root.ApexCore;
      carry = createCarry({
        store: idbStore(root.indexedDB), storage: root.localStorage,
        ready: async () => {
          if (root.navigator.onLine === false || root.APEX_REVIEW || !sync() || !contributor() || !core()) return false;
          return !!(await sync().member()) && !!(await sync().contributionEnabled());      // Road data switched off since: nothing is matched or sent
        },
        resume: (item) => resumeItem(item, { Contributor: contributor(), Core: core(), post: (c) => sync().contribute(c), fetch: root.fetch.bind(root) }),
      });
      let last = 0;
      const flush = () => { if (!carry.size()) return; last = Date.now(); carry.flush().catch(() => {}); };
      root.addEventListener('online', flush);
      root.addEventListener('pagehide', () => carry.checkpoint());
      root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') carry.checkpoint(); else flush(); });
      root.setTimeout(flush, 8000);                                       // after the first paint and the first plan, never in their way
      root.setInterval(() => { if (Date.now() - last > 300000) flush(); }, 60000);
    }
  } catch (_) { carry = null; }
  root.ApexRoadCarry = Object.assign(carry || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
