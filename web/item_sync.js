// Saved routes and pinned places on your account (big bet #11; backend/src/member_items.ts). Signed in, what you save or pin
// on one phone is on the next one, and after a reinstall: the phone asks what changed since it last asked, takes each item
// whose change is newer than its own, then sends its own changes. The newest change wins per item: a route by its savedAt,
// a place by its `at` (pinned_places.js stamps it; a place pinned before that counts as 2020, so any real change wins).
// A removal here is sent as a removal (an item the account had that this phone no longer has), so the other phone drops it.
// Per phone, per account: the state (apex.itemSync) names the account it was for and starts over for another one.
// Switch off: the account's copy is deleted and this phone stops syncing; what is on the phone stays. Pure but for the
// storage and the fetch passed in (tests/test_item_sync.py).
(function (root) {
  'use strict';
  const KEY = 'apex.itemSync', OLD_AT = 1_577_836_800_000, PUT_ITEMS = 25, PUT_CHARS = 900_000, PAGES = 20;

  function load(storage, uid) {
    let s = null;
    try { s = JSON.parse(storage.getItem(KEY) || 'null'); } catch (_) {}
    if (!s || typeof s !== 'object' || s.uid !== uid) s = { uid, since: 0, sent: {}, off: !!(s && s.off) };
    if (!s.sent || typeof s.sent !== 'object') s.sent = {};
    return s;
  }
  function store(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }
  const isOff = (storage) => { try { return !!(JSON.parse(storage.getItem(KEY) || 'null') || {}).off; } catch (_) { return false; } };

  const routeAt = (p) => (Number.isFinite(p.savedAt) && p.savedAt > OLD_AT ? Math.round(p.savedAt) : OLD_AT);
  const placeAt = (p) => (Number.isFinite(p.at) && p.at > OLD_AT ? Math.round(p.at) : OLD_AT);

  /** What this phone has now: key ('route:<id>' / 'place:<name in lower case>') -> { kind, id, at, body }. */
  function local(storage, R, P) {
    const out = {};
    for (const p of R.list(storage)) out['route:' + p.id] = { kind: 'route', id: p.id, at: routeAt(p), body: p };
    for (const p of P.list(storage)) { const id = p.name.toLowerCase(); out['place:' + id] = { kind: 'place', id, at: placeAt(p), body: p }; }
    return out;
  }

  /** Puts the account's newer items on the phone. Routes newest first (at most R.MAX), places as pinned_places keeps them.
   *  Returns the ids of the routes it put there (their map is fetched for no signal), or null when nothing changed. */
  function apply(storage, R, P, items) {
    if (!items.length) return null;
    const got = [];
    const have = local(storage, R, P);
    let routes = R.list(storage), places = null, changed = false;
    const placesNow = () => (places = places || JSON.parse(storage.getItem(P.KEY) || '[]').filter((p) => p && typeof p.name === 'string'));
    for (const it of items) {
      const key = it.kind + ':' + it.id, mine = have[key];
      if (mine && mine.at >= it.at) continue;                                  // ours is as new or newer: ours stays (and is sent)
      if (it.kind === 'route') {
        if (!it.body && !mine) continue;
        routes = routes.filter((p) => p.id !== it.id);
        if (it.body && typeof it.body.id === 'string' && Array.isArray(it.body.coords)) { routes.push(it.body); got.push(it.id); }
      } else if (it.kind === 'place') {
        if (!it.body && !mine) continue;
        placesNow(); places = places.filter((p) => p.name.toLowerCase() !== it.id);
        if (it.body && typeof it.body.name === 'string') places.unshift(it.body);
      } else continue;
      changed = true;
    }
    if (!changed) return null;
    routes.sort((a, b) => routeAt(b) - routeAt(a));
    routes = routes.slice(0, R.MAX);
    try {
      if (routes.length) storage.setItem(R.KEY, JSON.stringify(routes)); else storage.removeItem(R.KEY);
      if (places) { places = places.slice(0, P.MAX); if (places.length) storage.setItem(P.KEY, JSON.stringify(places)); else storage.removeItem(P.KEY); }
    } catch (_) { return null; }
    const kept = new Set(routes.map((p) => p.id));
    return got.filter((id) => kept.has(id));
  }

  /** What to send: every item whose change the account hasn't had, and a removal for each it had that the phone dropped. */
  function changes(s, have, now) {
    const out = [];
    for (const [key, it] of Object.entries(have)) {
      const sent = s.sent[key];
      if (!sent || sent.at !== it.at || !sent.live) out.push({ kind: it.kind, id: it.id, at: it.at, body: it.body });
    }
    for (const [key, sent] of Object.entries(s.sent)) {
      if (sent.live && !have[key]) { const i = key.indexOf(':'); out.push({ kind: key.slice(0, i), id: key.slice(i + 1), at: Math.max(now, sent.at + 1), body: null }); }
    }
    return out;
  }
  /** Splits what to send into calls of at most PUT_ITEMS items and about PUT_CHARS characters (a route can be big). */
  function batches(items) {
    const out = []; let cur = [], size = 0;
    for (const it of items) {
      const n = JSON.stringify(it).length;
      if (cur.length && (cur.length >= PUT_ITEMS || size + n > PUT_CHARS)) { out.push(cur); cur = []; size = 0; }
      cur.push(it); size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /**
   * One sync for account `uid`. `call(method, path, body)` -> Promise<{ ok, status, json() }>. Returns
   * { pulled: bool (the phone's lists changed), routes: [ids of routes that arrived], sent: n } or { off: true }. Never throws on a network error: the next sync goes on.
   */
  async function sync(storage, R, P, uid, call, now = Date.now()) {
    const s = load(storage, uid);
    if (s.off) return { off: true };
    let pulled = false; const routes = [];
    for (let page = 0; page < PAGES; page++) {
      const r = await call('GET', `/api/me/items?since=${s.since}`);
      if (!r || !r.ok) return { pulled, routes, sent: 0, error: r ? r.status : 0 };
      const got = await r.json();
      const items = Array.isArray(got && got.items) ? got.items : [];
      const came = apply(storage, R, P, items);
      if (came) { pulled = true; routes.push(...came); }
      const now2 = items.length ? local(storage, R, P) : {};
      for (const it of items) {
        const key = it.kind + ':' + it.id, mine = now2[key];
        // the account and the phone agree on this item now, unless the phone's own change is newer (then it is sent below)
        if (!mine || mine.at <= it.at) s.sent[key] = { at: mine ? mine.at : it.at, live: !!mine };
      }
      if (Number.isFinite(got.now)) s.since = got.now;
      store(storage, s);
      if (!got.more) break;
    }
    const have = local(storage, R, P);
    let sent = 0;
    for (const b of batches(changes(s, have, now))) {
      const r = await call('PUT', '/api/me/items', { items: b });
      if (!r || !r.ok) break;                                                  // too many (409) or no signal: what is left goes next time
      for (const it of b) s.sent[it.kind + ':' + it.id] = { at: it.at, live: !!it.body };
      sent += b.length;
      store(storage, s);
    }
    for (const [key, v] of Object.entries(s.sent)) if (!v.live && !have[key]) delete s.sent[key];   // removals the account has had
    store(storage, s);
    return { pulled, routes, sent };
  }

  /** The switch: off deletes the account's copy (both kinds) and stops this phone; on starts over from the account. */
  async function setOn(storage, uid, on, call) {
    const s = load(storage, uid);
    if (!on) { const r = await call('DELETE', '/api/me/items'); if (!r || !r.ok) return false; }
    store(storage, { uid, since: 0, sent: {}, off: !on });
    return true;
  }

  const api = { KEY, OLD_AT, local, apply, changes, batches, sync, setOn, isOff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexItemSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
