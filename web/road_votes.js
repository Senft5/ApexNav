// Which road was better? (IDEAS S-17): after a drive, the Log asks you to pick between this road and another you drove
// lately. Each answer moves an Elo rating per road (by name), so your own ranking of roads emerges from easy choices
// instead of star ratings. Kept on this phone (apex.roadVotes); the crowd version needs the server (R-33).
// Pure (tests/test_road_votes.py).
(function (root) {
  'use strict';
  const KEY = 'apex.roadVotes', START = 1500, K = 32, MAX_ROADS = 200;
  const named = (d) => d && typeof d.name === 'string' && d.name && !/^Drive \d/.test(d.name);
  const keyOf = (name) => name.trim().toLowerCase();

  function load(storage) {
    try { const v = JSON.parse(storage.getItem(KEY) || 'null'); if (v && typeof v === 'object' && v.r && v.asked) return v; } catch (_) {}
    return { r: {}, names: {}, asked: {} };
  }
  function save(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

  /** The other road to ask about for drive `d`: the most recent named drive on a different road; null when none or asked. */
  function question(drives, d, state) {
    if (!named(d)) return null;
    const others = (drives || []).filter((o) => named(o) && keyOf(o.name) !== keyOf(d.name) && o.date && o.date <= d.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const o = others[0];
    if (!o) return null;
    const pair = [keyOf(d.name), keyOf(o.name)].sort().join('|');
    return state.asked[`${d.id}|${pair}`] ? null : { a: d.name, b: o.name, id: `${d.id}|${pair}` };
  }

  /** Records that `winner` beat `loser` (Elo, K=32); returns the new state. */
  function vote(state, q, winner) {
    const ka = keyOf(q.a), kb = keyOf(q.b), w = keyOf(winner) === ka ? ka : kb, l = w === ka ? kb : ka;
    const r = { ...state.r }, ra = r[w] ?? START, rb = r[l] ?? START;
    const e = 1 / (1 + 10 ** ((rb - ra) / 400));
    r[w] = Math.round(ra + K * (1 - e)); r[l] = Math.round(rb - K * (1 - e));
    const names = { ...state.names, [ka]: q.a, [kb]: q.b };
    const keep = Object.keys(r).sort((x, y) => r[y] - r[x]).slice(0, MAX_ROADS);
    return { r: Object.fromEntries(keep.map((k) => [k, r[k]])), names: Object.fromEntries(keep.map((k) => [k, names[k]])), asked: { ...state.asked, [q.id]: 1 } };
  }
  const skip = (state, q) => ({ ...state, asked: { ...state.asked, [q.id]: 1 } });

  /** Your roads, best first: [{ name, rating }], only roads you've answered about. */
  const ranking = (state) => Object.keys(state.r).sort((a, b) => state.r[b] - state.r[a]).map((k) => ({ name: state.names[k] || k, rating: state.r[k] }));

  const api = { KEY, load, save, question, vote, skip, ranking, START };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadVotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
