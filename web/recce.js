// Recce (IDEAS V-09): drive a road once, keep the co-driver's notes from that drive as your own, change any call ("Left 4"
// → "Left 3 tightens, care"), and the next time a route or drive passes those corners in the same direction your calls are
// read instead of the map's. Like a rally crew's recce, kept on this phone (apex.recce). Pure (tests/test_recce.py).
(function (root) {
  'use strict';
  const KEY = 'apex.recce', MAX = 3000, NEAR_M = 30, SAME_DIR = Math.cos(60 * Math.PI / 180), MAX_CALL = 60;
  const metres = (a, b) => Math.hypot((b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180), (b.lat - a.lat) * 110540);
  /** Unit direction of travel at i: [east, north]. */
  function dir(t, i) {
    const n = t.lat.length, a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), c = Math.cos(t.lat[i] * Math.PI / 180);
    const x = (t.lon[b] - t.lon[a]) * 111320 * c, y = (t.lat[b] - t.lat[a]) * 110540, l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  function load(storage) {
    try { const v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((n) => n && Number.isFinite(n.lat) && typeof n.call === 'string') : []; } catch (_) { return []; }
  }
  function save(storage, notes) { try { storage.setItem(KEY, JSON.stringify(notes.slice(-MAX))); return true; } catch (_) { return false; } }

  const match = (notes, p, d) => notes.find((n) => metres(n, p) <= NEAR_M && (n.hx * d[0] + n.hy * d[1]) >= SAME_DIR);

  /**
   * Keep a drive's corner notes (`events` with type 'corner', `index`, `call`, `code`) as yours: each replaces any of yours
   * at the same corner and direction. Returns the new list.
   */
  function keep(notes, t) {
    const out = (notes || []).slice();
    for (const e of (t.events || []).filter((x) => x.type === 'corner' && Number.isInteger(x.index) && x.index < t.lat.length)) {
      const p = { lat: t.lat[e.index], lon: t.lon[e.index] }, d = dir(t, e.index);
      const had = match(out, p, d);
      const note = { lat: p.lat, lon: p.lon, hx: d[0], hy: d[1], call: had && had.edited ? had.call : e.call, code: e.code, edited: !!(had && had.edited) };
      if (had) out.splice(out.indexOf(had), 1, note); else out.push(note);
    }
    return out;
  }

  /** Your notes on `t`'s corners: [{ note, e }] for each corner event that has one of yours. */
  const onTrack = (notes, t) => (t.events || []).filter((e) => e.type === 'corner' && Number.isInteger(e.index) && e.index < t.lat.length)
    .map((e) => ({ e, note: match(notes, { lat: t.lat[e.index], lon: t.lon[e.index] }, dir(t, e.index)) })).filter((x) => x.note);

  /** Reads your calls into `t`'s corner events (their map call kept as `mapCall`). Returns how many were yours. */
  function apply(notes, t) {
    if (!notes || !notes.length || !t || !Array.isArray(t.lat)) return 0;
    let n = 0;
    for (const { e, note } of onTrack(notes, t)) {
      if (e.mapCall === undefined) e.mapCall = e.call;
      e.call = note.call; e.recce = true; n++;
    }
    return n;
  }

  /** Change one call (an empty one leaves it as it was: a note is never blank). Returns the new list. */
  function edit(notes, note, call) {
    const c = String(call || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CALL);
    return notes.map((n) => (n === note || (n.lat === note.lat && n.lon === note.lon && n.hx === note.hx) ? { ...n, call: c || n.call, edited: !!c } : n));
  }
  /** Forget your notes on this track's corners. */
  const forget = (notes, t) => { const mine = new Set(onTrack(notes, t).map((x) => x.note)); return notes.filter((n) => !mine.has(n)); };

  const api = { KEY, load, save, keep, apply, onTrack, edit, forget, NEAR_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRecce = api;
})(typeof window !== 'undefined' ? window : globalThis);
