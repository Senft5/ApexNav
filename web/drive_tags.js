// Drive tags and notes (IDEAS D-23): what the drive was like (wet, night, a passenger, an off day) and which car, as tags
// you pick or type, plus a short note, kept on the drive in IndexedDB; the Log filters by them. Phone only, never sent.
// Pure (tests/test_drive_tags.py); analysis.html draws the chips.
(function (root) {
  'use strict';
  const PRESETS = ['Dry', 'Wet', 'Night', 'Solo', 'Passenger', 'Felt good', 'Off day'];
  const MAX_TAGS = 8, MAX_TAG = 24, MAX_NOTE = 280;

  /** A typed tag cleaned: trimmed, single spaces, at most MAX_TAG characters; '' when nothing is left. */
  const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  /** Tags as kept: cleaned, no repeats (any case, the first spelling wins), at most MAX_TAGS. */
  function normalize(tags) {
    const out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
      const c = clean(t);
      if (c && !out.some((o) => same(o, c)) && out.length < MAX_TAGS) out.push(c);
    }
    return out;
  }

  /** Tags with `tag` added, or removed when it is already there. */
  function toggle(tags, tag) {
    const now = normalize(tags), c = clean(tag);
    if (!c) return now;
    return now.some((t) => same(t, c)) ? now.filter((t) => !same(t, c)) : normalize([...now, c]);
  }

  const note = (s) => String(s == null ? '' : s).trim().slice(0, MAX_NOTE);

  /** Every tag used across `drives`, most used first (then A–Z): the Log's filter chips. */
  function used(drives) {
    const n = new Map();
    for (const d of drives || []) for (const t of normalize(d && d.tags)) {
      const k = [...n.keys()].find((x) => same(x, t)) || t;
      n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  }

  /** Does the drive carry every tag in `filter`? An empty filter matches all. */
  const matches = (d, filter) => (filter || []).every((f) => normalize(d && d.tags).some((t) => same(t, f)));

  /** The chips to offer on a drive: the presets, then your own tags from other drives, then any on this one not yet listed. */
  function offered(drives, current) {
    const out = [...PRESETS];
    for (const { tag } of used(drives)) if (!out.some((o) => same(o, tag))) out.push(tag);
    for (const t of normalize(current)) if (!out.some((o) => same(o, t))) out.push(t);
    return out;
  }

  const api = { PRESETS, MAX_TAGS, MAX_NOTE, normalize, toggle, note, used, matches, offered };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveTags = api;
})(typeof window !== 'undefined' ? window : globalThis);
