// A drive's route as a small map (an SVG line, north up), with an optional stretch drawn bold and circled: the stage you
// are marking (the owner's note 09: on the map, not on a timeline) and the two routes of "Which route was better?"
// (note 10). Pure: returns an SVG string (tests/test_road_runs.py).
(function (root) {
  'use strict';
  const fin = Number.isFinite;
  /**
   * lat, lon: arrays. o: { w, h, pad, line, hi, ring, width, range: [a, b], label }. Colours are CSS colours (the theme's).
   * null when there are fewer than two known points.
   */
  function svg(lat, lon, o = {}) {
    const w = o.w || 320, h = o.h || 200, pad = o.pad != null ? o.pad : 14, n = Math.min(lat ? lat.length : 0, lon ? lon.length : 0);
    const idx = [];
    for (let i = 0; i < n; i++) if (fin(lat[i]) && fin(lon[i])) idx.push(i);
    if (idx.length < 2) return null;
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    for (const i of idx) { la0 = Math.min(la0, lat[i]); la1 = Math.max(la1, lat[i]); lo0 = Math.min(lo0, lon[i]); lo1 = Math.max(lo1, lon[i]); }
    const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180), spanX = Math.max((lo1 - lo0) * kx, 1e-6), spanY = Math.max(la1 - la0, 1e-6);
    const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
    const P = (i) => [ox + (lon[i] - lo0) * kx * s, h - oy - (lat[i] - la0) * s];
    const path = (list) => {
      const step = Math.max(1, Math.floor(list.length / 300)), pts = list.filter((_, k) => k % step === 0 || k === list.length - 1);
      return pts.map((i, k) => { const [x, y] = P(i); return `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
    };
    const line = o.line || '#888', hi = o.hi || '#f60', ring = o.ring || hi, sw = o.width || 3;
    let body = `<path d="${path(idx)}" fill="none" stroke="${line}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${o.range ? ' opacity="0.55"' : ''}/>`;
    const [a, b] = o.range ? [Math.min(o.range[0], o.range[1]), Math.max(o.range[0], o.range[1])] : [0, -1];
    const part = idx.filter((i) => i >= a && i <= b);
    if (part.length >= 2) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const i of part) { const [x, y] = P(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(16, (x1 - x0) / 2 * 1.25 + 10), ry = Math.max(16, (y1 - y0) / 2 * 1.25 + 10);
      const [sx, sy] = P(part[0]), [ex, ey] = P(part[part.length - 1]);
      body += `<path d="${path(part)}" fill="none" stroke="${hi}" stroke-width="${sw * 2}" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" stroke="${ring}" stroke-width="2"/>`
        + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sw * 1.6}" fill="${hi}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${sw * 1.6}" fill="none" stroke="${hi}" stroke-width="2"/>`;
    } else {                                                          // start filled, finish open, as on the drive's map
      const [sx, sy] = P(idx[0]), [ex, ey] = P(idx[idx.length - 1]);
      body += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sw * 1.4}" fill="${hi}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${sw * 1.4}" fill="none" stroke="${hi}" stroke-width="2"/>`;
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<svg viewBox="0 0 ${w} ${h}" overflow="visible" role="img" aria-label="${esc(o.label || 'Route map')}">${body}</svg>`;
  }
  const api = { svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteThumb = api;
})(typeof window !== 'undefined' ? window : globalThis);
