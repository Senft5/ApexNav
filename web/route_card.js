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

  /**
   * U-115: Twist and Flow are the route's geometry, so any track with corners has them: a searched route's own fun score
   * (`t.fun`), else `score(t)` (FunRoute.score) over the track's corners, as for a GPX or a loop. { twist, flow }, each null
   * when the track has no corners to read (unknown stays "--").
   */
  function shape(t, score) {
    let f = t && t.fun && (finite(t.fun.twist) || finite(t.fun.flow)) ? t.fun : null;
    if (!f && t && Array.isArray(t.events) && Array.isArray(t.dist) && typeof score === 'function') { try { f = score(t); } catch (_) { f = null; } }
    return { twist: f && finite(f.twist) ? f.twist : null, flow: f && finite(f.flow) ? f.flow : null };
  }

  /**
   * U-134: a fact line set so no unit is left alone on a line: a number and its unit are held together ("8.5 mi"), and a
   * "·" keeps to the phrase before it, so the line breaks after a "·", never inside a distance.
   */
  function factText(s) {
    return String(s == null ? '' : s)
      .replace(/(\d) (mi|km|ft|m|min|h)\b/g, '$1 $2')
      .replace(/ · /g, ' · ');
  }

  /** U-134: the Along fact's glyph follows what it leads with: a viewpoint the hills, a café a cup, fuel alone a pump. */
  function alongGlyph(line) {
    const s = String(line || '').toLowerCase();
    return /viewpoint/.test(s) ? 'view' : /café/.test(s) ? 'cafe' : /fuel/.test(s) ? 'fuel' : 'view';
  }

  /** The cameras readout: a count once the check has run, "--" before (it is not a 0-100 scale, so no arc). */
  function count(label, n) {
    return `<div class="rc-dial count${finite(n) ? '' : ' unknown'}"><svg viewBox="0 0 60 36" aria-hidden="true"><path class="rc-track" d="M4 32 A26 26 0 0 1 56 32"/></svg>`
      + `<b>${finite(n) ? n : '--'}</b><span>${esc(label)}</span></div>`;
  }

  /** Every corner on a candidate's track (its `t.events`), the count the card's CORNERS number shows; null when unknown. */
  function cornersOf(c) {
    if (c && c.t && Array.isArray(c.t.events)) return c.t.events.filter((e) => e && e.type === 'corner').length;
    if (c && Array.isArray(c.events)) return c.events.filter((e) => e && e.type === 'corner').length;
    return c && finite(c.corners) ? c.corners : null;
  }
  const cornerWord = (n) => `${n} corner${n === 1 ? '' : 's'}`;

  /**
   * Route options as tiles (panel round 2, SO-1): the time big, and under it how it differs in time from the picked one
   * and its own corners ("8 min quicker · 27 corners"). No "Fun 45": Fun is the route style (Quick / Fun / Long way), never
   * a number (web/vocabulary.js). The plan flow (finding 9): a tile counts its corners as the card's CORNERS number does,
   * never a difference in good corners ("53 fewer good corners" beside a card of 80 corners, for a route with 20).
   */
  function tiles(list, picked) {
    const p = list && list[picked];
    return (list || []).map((c, i) => {
      const t = duration(c && c.timeS), title = t ? (t.unit === 'h' ? t.value : `${t.value} min`) : '--';
      const n = cornersOf(c), corners = n == null ? null : cornerWord(n);
      if (i === picked) return { title, sub: ['this one', corners].filter(Boolean).join(' · ') };
      const dm = p && finite(p.timeS) && finite(c && c.timeS) ? Math.round((c.timeS - p.timeS) / 60) : null;
      const time = dm == null ? null : dm < 0 ? `${-dm} min quicker` : dm > 0 ? `+${dm} min` : 'same time';
      return { title, sub: [time, corners].filter(Boolean).join(' · ') || '--' };
    });
  }

  /**
   * The plan flow (finding 1): the card says so when the ranked route replaces the first one, and why, in the card's own
   * numbers: "Better route found: +8 min, 52 more corners". `now` and `was` are the two routes on the card ({ timeS, events }
   * or a candidate); `why` the engine's why line for the new one, said when time and corners don't tell the difference.
   */
  function swapNote(now, was, why = null, head = 'Better route found') {
    const dm = finite(now && now.timeS) && finite(was && was.timeS) ? Math.round((now.timeS - was.timeS) / 60) : null;
    const a = cornersOf(now), b = cornersOf(was), dc = a != null && b != null ? a - b : null;
    const bits = [dm ? (dm > 0 ? `+${dm} min` : `${-dm} min quicker`) : null,
      dc ? `${Math.abs(dc)} ${dc > 0 ? 'more' : 'fewer'} corner${Math.abs(dc) === 1 ? '' : 's'}` : null].filter(Boolean);
    if (!bits.length && why) bits.push(String(why).charAt(0).toLowerCase() + String(why).slice(1));
    return `${head}${bits.length ? `: ${bits.join(', ')}` : ''}`;
  }

  const api = { duration, stats, profile, dial, count, tiles, cornersOf, swapNote, shape, factText, alongGlyph };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
