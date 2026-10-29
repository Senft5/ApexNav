// Lane guidance at junctions (IDEAS R-29): which lanes to be in, from the router's lane data (Valhalla `turn_lanes`), drawn
// under the next turn in the road book and said with the early direction ("use the left 2 lanes"). Pure
// (tests/test_lanes.py); unknown stays unknown: no lane data, nothing shown or said.
(function (root) {
  'use strict';
  // Valhalla's lane direction bits, and how each arrow is drawn (degrees from straight up; + is right).
  const DIRS = [[2, 'through', 0], [4, 'sharp_left', -135], [8, 'left', -90], [16, 'slight_left', -45], [32, 'slight_right', 45],
    [64, 'right', 90], [128, 'sharp_right', 135], [256, 'reverse', 180], [512, 'merge_left', -30], [1024, 'merge_right', 30]];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** The router's lanes [{ directions, active?, valid? }] kept small: [[directions, active, valid]], or null with none. */
  function pack(raw) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;   // one lane needs no guidance
    const out = raw.map((l) => [l && finite(l.directions) ? l.directions : 0, l && finite(l.active) ? l.active : 0, l && finite(l.valid) ? l.valid : 0]);
    return out.some((l) => l[1] || l[2]) ? out : null;                                // nothing marked to use: nothing to say
  }

  /** Each lane, left to right: { angle (the arrow to draw), use (the lane to be in), ok (it works too) }. */
  function lanes(packed) {
    if (!Array.isArray(packed)) return [];
    return packed.map(([d, a, v]) => {
      const pick = a || v || d, first = DIRS.find(([bit]) => pick & bit) || DIRS.find(([bit]) => d & bit);
      return { angle: first ? first[2] : 0, use: !!a, ok: !!(a || v) };
    });
  }

  /** "the left lane", "the right 2 lanes", "a middle lane", or null when any lane will do or the lanes aren't contiguous. */
  function hint(packed) {
    const ls = lanes(packed);
    if (ls.length < 2) return null;
    const pick = ls.some((l) => l.use) ? ls.map((l) => l.use) : ls.map((l) => l.ok);
    const idx = pick.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || idx.length === ls.length) return null;
    if (idx[idx.length - 1] - idx[0] + 1 !== idx.length) return null;            // split lanes: the drawing says it better
    const n = idx.length, lanesWord = n === 1 ? 'lane' : `${n} lanes`;
    if (idx[0] === 0) return `the left ${lanesWord}`;
    if (idx[idx.length - 1] === ls.length - 1) return `the right ${lanesWord}`;
    return n === 1 ? 'a middle lane' : `the middle ${n} lanes`;
  }

  const api = { pack, lanes, hint, DIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexLanes = api;
})(typeof window !== 'undefined' ? window : globalThis);
