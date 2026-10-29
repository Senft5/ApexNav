// The route card as instruments (docs/design/REVIEW.md roadmap 5, mockup 04-route-card.html): three stamped numbers, the
// elevation profile with a tick for every corner, small half-dials that show "--" honestly, and the route options as tiles.
// Pure: returns markup strings and numbers (tests/test_route_card.py); the page fills them in. Unknown stays "--".
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Seconds as "2:48" (hours:minutes) from an hour up, "48 min" under it; null when unknown. */
  function duration(s) {
    if (!finite(s) || s < 0) return null;
    const m = Math.round(s / 60);
    return m < 60 ? { value: String(m), unit: 'min' } : { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, unit: 'h' };
  }

  /**
   * The three stamped numbers: distance, time, corners. `long(m)` formats a distance as "70.1 mi". Each is
   * { value, unit, label }, value '--' when unknown.
   */
  function stats(t, long) {
    const total = t && Array.isArray(t.dist) && t.dist.length ? t.dist[t.dist.length - 1] : null;
    const d = finite(total) && long ? String(long(total)).split(' ') : null;
    const time = duration(t && t.timeS);
    const extra = t && finite(t.extraS) && t.extraS >= 60 ? `+${Math.round(t.extraS / 60)} min for fun` : 'time';
    const corners = t && Array.isArray(t.events) ? t.events.filter((e) => e && e.type === 'corner').length : null;
    return [
      { value: d ? d[0] : '--', unit: d ? d.slice(1).join(' ') : '', label: 'distance' },
      { value: time ? time.value : '--', unit: time ? time.unit : '', label: time ? extra : 'time' },
      { value: corners == null ? '--' : String(corners), unit: '', label: 'corners' },
    ];
  }

  /**
   * The elevation profile as an SVG string: the ground filled, a hair line on top, and a red tick under it for every corner
   * (taller for a tighter one). `height(m)` formats the highest point ("5,387 ft"). Null without enough elevation.
   */
  function profile(t, w = 340, h = 92, height = null) {
    if (!t || !Array.isArray(t.dist) || !Array.isArray(t.elev) || t.dist.length < 2) return null;
    const pts = [];
    for (let i = 0; i < t.dist.length; i++) if (finite(t.dist[i]) && finite(t.elev[i])) pts.push([t.dist[i], t.elev[i]]);
    if (pts.length < 2) return null;
    const d0 = pts[0][0], d1 = pts[pts.length - 1][0];
    if (!(d1 > d0)) return null;
    let lo = Infinity, hi = -Infinity, hiAt = d0;
    for (const [d, e] of pts) { if (e < lo) lo = e; if (e > hi) { hi = e; hiAt = d; } }
    const top = 16, base = h - 22, span = Math.max(30, hi - lo);   // a flat road stays flat, not stretched to fill
    const x = (d) => ((d - d0) / (d1 - d0)) * w, y = (e) => base - ((e - lo) / span) * (base - top);
    const step = Math.max(1, Math.floor(pts.length / 240));        // about one point per 1.5 px
    const line = [];
    for (let i = 0; i < pts.length; i += step) line.push(`${x(pts[i][0]).toFixed(1)},${y(pts[i][1]).toFixed(1)}`);
    line.push(`${w.toFixed(1)},${y(pts[pts.length - 1][1]).toFixed(1)}`);
    const ticks = (t.events || []).filter((e) => e && e.type === 'corner' && finite(e.dist_m) && e.dist_m >= d0 && e.dist_m <= d1).map((e) => {
      const sev = e.severity === 'HP' ? 1 : finite(+e.severity) ? 1 - (+e.severity - 1) / 6 : 0.4;
      const len = 3 + 9 * Math.max(0, Math.min(1, sev)) ** 2;          // the tight ones stand out from the rest
      const tx = x(e.dist_m).toFixed(1);
      return `<path d="M${tx} ${h - 8} V${(h - 8 - len).toFixed(1)}"/>`;
    }).join('');
    const label = height ? `<text x="${Math.min(w - 40, Math.max(40, x(hiAt))).toFixed(1)}" y="11" text-anchor="middle">${esc(height(hi))}</text>` : '';
    return `<svg class="rc-profile" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Elevation profile with corners">`
      + `<path class="rc-ground" d="M0,${base} L${line.join(' L')} L${w},${base} Z"/>`
      + `<polyline class="rc-line" points="${line.join(' ')}"/>`
      + `<path class="rc-base" d="M0 ${h - 8} H${w}"/><g class="rc-ticks">${ticks}</g>${label}</svg>`;
  }

  /** A half-dial for a 0-100 value: the arc filled to the value, a needle, the number under it; dashed and "--" when unknown. */
  function dial(label, v) {
    const known = finite(v), f = known ? Math.max(0, Math.min(100, v)) / 100 : 0;
    const a = Math.PI * (1 - f), nx = (30 + 22 * Math.cos(a)).toFixed(1), ny = (32 - 22 * Math.sin(a)).toFixed(1);
    const ex = (30 + 26 * Math.cos(a)).toFixed(1), ey = (32 - 26 * Math.sin(a)).toFixed(1);
    const arc = known && f > 0 ? `<path class="rc-arc" d="M4 32 A26 26 0 0 1 ${ex} ${ey}"/>` : '';
    return `<div class="rc-dial${known ? '' : ' unknown'}"><svg viewBox="0 0 60 36" aria-hidden="true">`
      + `<path class="rc-track" d="M4 32 A26 26 0 0 1 56 32"/>${arc}`
      + (known ? `<path class="rc-needle" d="M30 32 L${nx} ${ny}"/><circle cx="30" cy="32" r="2.6"/>` : '')
      + `</svg><b>${known ? Math.round(v) : '--'}</b><span>${esc(label)}</span></div>`;
  }

  /** The cameras readout: a count once the check has run, "--" before (it is not a 0-100 scale, so no arc). */
  function count(label, n) {
    return `<div class="rc-dial count${finite(n) ? '' : ' unknown'}"><svg viewBox="0 0 60 36" aria-hidden="true"><path class="rc-track" d="M4 32 A26 26 0 0 1 56 32"/></svg>`
      + `<b>${finite(n) ? n : '--'}</b><span>${esc(label)}</span></div>`;
  }

  /**
   * Route options as tiles: { title: "Fun 98 · 2:48", sub } with sub relative to the picked one ("this one",
   * "12 min quicker", "+43 min").
   */
  function tiles(list, picked) {
    const p = list && list[picked];
    return (list || []).map((c, i) => {
      const t = duration(c && c.timeS), title = `Fun ${c && c.fun && finite(c.fun.fun) ? c.fun.fun : '--'} · ${t ? (t.unit === 'h' ? t.value : `${t.value} min`) : '--'}`;
      let sub = 'this one';
      if (i !== picked) {
        const dm = p && finite(p.timeS) && finite(c && c.timeS) ? Math.round((c.timeS - p.timeS) / 60) : null;
        sub = dm == null ? '--' : dm < 0 ? `${-dm} min quicker` : dm > 0 ? `+${dm} min` : 'same time';
      }
      return { title, sub };
    });
  }

  const api = { duration, stats, profile, dial, count, tiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
