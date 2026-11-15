// ApexRoadLine — a stored drive put on the map's road, so its line can be measured against the road's own shape (Nate,
// 2026-11-15: "shouldn't it be drive geometry compared to road geometry?"). Each bin near a corner is projected onto the
// nearest road of Vetta's own graph tiles (graph_tiles.js, graph_router.js), keeping to the road it was on; the projected
// points are the road under the drive, bin for bin. Core.roadTurnOffsetM then compares where you turned with where the
// road turns. Pure but for forDrive's tile loading. Unknown stays unknown: a bin with no road within MAX_M is null, and a
// corner with any null bin has no road (no claim about its line).
(function (root) {
  'use strict';
  const MAX_M = 20;        // a bin further than this from every road is off the map (a car park, a missing road)
  const KEEP_M = 6;        // stay on the road you were on unless another is this much nearer (a side road at a junction)
  const PAD = 12;          // bins either side of a corner (Core's ROAD_PAD)

  /** The bins to put on the road: each corner's start - PAD .. end + PAD, merged. */
  function windows(n, corners) {
    const out = [];
    for (const c of corners || []) {
      if (!c || !Number.isInteger(c.start) || !Number.isInteger(c.end)) continue;
      const a = Math.max(0, c.start - PAD), b = Math.min(n - 1, c.end + PAD);
      if (out.length && a <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
      else out.push([a, b]);
    }
    return out;
  }

  /** { road_lat, road_lon }: d's bins in the corners' windows on the road (graph view v), null elsewhere and off the map. */
  function along(GR, v, d, corners) {
    const n = d.lat.length, rl = new Array(n).fill(null), ro = new Array(n).fill(null);
    for (const [a, b] of windows(n, corners)) {
      let prev = -1;
      for (let q = a; q <= b; q++) {
        const la = d.lat[q], lo = d.lon[q];
        if (!Number.isFinite(la) || !Number.isFinite(lo)) { prev = -1; continue; }
        let best = null, keep = null;
        for (const e of GR.edgesNear(v, la, lo, MAX_M)) {
          const p = GR.project(v, e, la, lo);
          if (!best || p.d < best.p.d) best = { e, p };
          if (prev >= 0 && (e === prev || (v.name[e] >= 0 && v.name[e] === v.name[prev] && v.eTile[e] === v.eTile[prev])) && (!keep || p.d < keep.p.d)) keep = { e, p };
        }
        const pick = keep && best && keep.p.d <= best.p.d + KEEP_M ? keep : best;
        if (!pick) { prev = -1; continue; }
        prev = pick.e;
        rl[q] = pick.p.lat; ro[q] = pick.p.lon;
      }
    }
    return { road_lat: rl, road_lon: ro };
  }

  /** The graph tiles (i, j) the corners' windows touch. */
  function tilesFor(GT, d, corners) {
    const seen = new Map();
    for (const [a, b] of windows(d.lat.length, corners)) for (let q = a; q <= b; q += 4) {
      if (!Number.isFinite(d.lat[q]) || !Number.isFinite(d.lon[q])) continue;
      // a road can run in from the next tile: the tiles within MAX_M of the bin, by a small box
      const dl = MAX_M / 110540, dn = MAX_M / (111320 * Math.cos(d.lat[q] * Math.PI / 180));
      for (const t of GT.tilesIn(d.lat[q] - dl, d.lon[q] - dn, d.lat[q] + dl, d.lon[q] + dn)) seen.set(`${t.i}_${t.j}`, t);
    }
    return [...seen.values()];
  }

  /** d with road_lat / road_lon (corners: Core's, start / end bins), or d itself when no tile can be had (unknown road). */
  async function forDrive(d, corners, deps = {}) {
    if (!deps.GT && !root.ApexGraphRouter && typeof importScripts === 'function') {   // the analysis worker: only when a drive asks
      try { importScripts('graph_tiles.js', 'graph_router.js'); } catch (_) { return d; }
    }
    const GT = deps.GT || root.ApexGraphTiles, GR = deps.GR || root.ApexGraphRouter;
    if (!GT || !GR || !d || !Array.isArray(d.lat) || !corners || !corners.length) return d;
    try {
      const want = tilesFor(GT, d, corners);
      if (!want.length || want.length > 24) return d;                 // more than a long drive's worth: not a drive's corners
      const tiles = (await Promise.all(want.map((t) => GT.load(t.i, t.j, deps.load || {}).catch(() => null)))).filter(Boolean);
      if (!tiles.length) return d;
      return { ...d, ...along(GR, GR.view(tiles), d, corners) };
    } catch (_) {
      return d;
    }
  }

  const api = { MAX_M, KEEP_M, PAD, windows, along, tilesFor, forDrive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApexRoadLine = api;
})(typeof window !== 'undefined' ? window : globalThis);
