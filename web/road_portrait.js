// The road's portrait on the drive-ended card (panel round 2, KE-1 / JA-1 / HE-4). The card's map used to be the only
// picture of the drive, and on a phone it was often still blank when the card came up: the trail is a map layer, drawn only
// once the map has fetched and parsed the tiles of the place it has just flown to, while the drive is still being scored
// (r7 guided-drive/phone/286, tabs/phone/015). The portrait is the same line drawn at once, as an SVG over the map, in
// exactly the place the map's fit puts the trail (Web Mercator, MapLibre's fitBounds framing, the same zoom cap), so when
// the map has drawn the trail the portrait can step back without the line moving. Under it, the drive's climbs as a thin
// band, when the recording measured its height. Pure: returns SVG strings (tests/test_road_portrait.py).
(function (root) {
  'use strict';
  const fin = Number.isFinite;
  const TILE = 512;                                                     // MapLibre's world is 512 px wide at zoom 0
  const mx = (lon) => (lon + 180) / 360 * TILE;
  const my = (lat) => { const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE; };

  /**
   * Where fitBounds puts each point. runs: [[[lon, lat], …], …]. box: { w, h, top, bottom, left, right, maxZoom }.
   * Returns { runs: [[[x, y], …], …], zoom } in the box's pixels, or null with nothing to draw or no room.
   */
  function frame(runs, box) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const list = (Array.isArray(runs) ? runs : []).map((r) => (Array.isArray(r) ? r.filter((p) => p && fin(p[0]) && fin(p[1])) : [])).filter((r) => r.length >= 2);
    for (const r of list) for (const [lo, la] of r) { const x = mx(lo), y = my(la); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!list.length) return null;
    const w = box.w, h = box.h, t = box.top || 0, b = box.bottom || 0, l = box.left || 0, rt = box.right || 0;
    const aw = w - l - rt, ah = h - t - b;
    if (!(aw > 0 && ah > 0)) return null;
    const cap = Math.pow(2, fin(box.maxZoom) ? box.maxZoom : 22);
    const s = Math.min(cap, (x1 - x0) > 0 ? aw / (x1 - x0) : cap, (y1 - y0) > 0 ? ah / (y1 - y0) : cap);
    const cx = l + aw / 2, cy = t + ah / 2, ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
    return { zoom: Math.log2(s), runs: list.map((r) => r.map(([lo, la]) => [cx + (mx(lo) - ox) * s, cy + (my(la) - oy) * s])) };
  }

  const d = (pts) => {
    const step = Math.max(1, Math.floor(pts.length / 600));
    return pts.filter((_, k) => k % step === 0 || k === pts.length - 1).map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  };

  /** The trail as the map would draw it: a casing and the line, at the map's widths for that zoom. o: { line, casing }. */
  function svg(runs, box, o = {}) {
    const f = frame(runs, box);
    if (!f) return null;
    // the map's widths (cockpit.js showEndTrail): line 3 px at zoom 10 to 7 px at 16, casing 6 to 13
    const k = Math.max(0, Math.min(1, (f.zoom - 10) / 6)), lw = 3 + 4 * k, cw = 6 + 7 * k;
    const paths = f.runs.map(d);
    const line = o.line || '#E65252', casing = o.casing || '#1A1814';
    return `<svg class="rp-road" viewBox="0 0 ${box.w} ${box.h}" width="${box.w}" height="${box.h}" aria-hidden="true">`
      + paths.map((p) => `<path d="${p}" fill="none" stroke="${casing}" stroke-width="${cw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
      + paths.map((p) => `<path d="${p}" fill="none" stroke="${line}" stroke-width="${lw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
      + '</svg>';
  }

  /** The climbs: an area under the drive's height along its distance, w x h. null unless at least 10 heights were measured and
   *  they span 3 m or more (a flat road has no profile worth drawing; an unmeasured one has none at all). */
  function profile(elev, dist, w, h, o = {}) {
    const n = Math.min(Array.isArray(elev) ? elev.length : 0, Array.isArray(dist) ? dist.length : 0);
    const pts = [];
    for (let i = 0; i < n; i++) if (fin(elev[i]) && fin(dist[i])) pts.push([dist[i], elev[i]]);
    if (pts.length < 10 || !(w > 0 && h > 0)) return null;
    let e0 = Infinity, e1 = -Infinity;
    for (const [, e] of pts) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); }
    const d0 = pts[0][0], span = pts[pts.length - 1][0] - d0;
    if (!(e1 - e0 >= 3) || !(span > 0)) return null;
    const step = Math.max(1, Math.floor(pts.length / 300));
    const xy = pts.filter((_, k) => k % step === 0 || k === pts.length - 1).map(([m, e]) => [(m - d0) / span * w, h - 1 - (e - e0) / (e1 - e0) * (h - 2)]);
    const top = xy.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const ink = o.ink || '#EDE4D3';
    return `<svg class="rp-climb" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">`
      + `<path d="${top}L${w} ${h}L0 ${h}Z" fill="${ink}" fill-opacity="0.18"/><path d="${top}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  const api = { frame, svg, profile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadPortrait = api;
})(typeof window !== 'undefined' ? window : globalThis);
