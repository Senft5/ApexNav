// What the car's screen is told (CarPlay/ApexCarPlay.swift, docs/CARPLAY.md). The page plans and guides; these build the
// `{cmd:'car', kind}` messages from its state. Pure (tests/test_carplay.py): the page posts what they return.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const MAX_POINTS = 400;

  /** The route line for the base map: at most MAX_POINTS [lat, lon], both ends kept. */
  function line(t) {
    if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return [];
    const n = t.lat.length, step = Math.max(1, Math.ceil(n / MAX_POINTS)), out = [];
    for (let i = 0; i < n; i += step) out.push([+t.lat[i].toFixed(6), +t.lon[i].toFixed(6)]);
    if ((n - 1) % step) out.push([+t.lat[n - 1].toFixed(6), +t.lon[n - 1].toFixed(6)]);
    return out;
  }

  /**
   * A planned route for the trip preview: its line, where it ends and up to three choices ("Fun 99 · 77 min").
   * `options` is the card's list ({ fun, timeS, route: { coords } }); a route without options is one choice.
   */
  function routeMessage(t, options, picked, fmtDist) {
    const pts = line(t);
    if (pts.length < 2) return null;
    const total = t.dist[t.dist.length - 1];
    const one = (fun, timeS, distM) => ({
      summary: [fun != null ? `Fun ${fun}` : null, finite(timeS) ? `${Math.round(timeS / 60)} min` : null].filter(Boolean).join(' · ') || 'Route',
      detail: finite(distM) && fmtDist ? fmtDist(distM) : '', timeS: finite(timeS) ? timeS : null, distM: finite(distM) ? distM : null,
    });
    const list = Array.isArray(options) && options.length > 1
      ? options.slice(0, 3).map((c) => one(c.fun ? c.fun.fun : null, c.timeS, finite(c.distM) ? c.distM : null))
      : [one(t.fun ? t.fun.fun : null, t.timeS, total)];
    if (Array.isArray(options) && options.length > 1 && list[picked]) list[picked].distM = total;   // the picked one is built: its length is known
    return { kind: 'route', name: t.name || 'Route', coords: pts, dest: pts[pts.length - 1], options: list,
             picked: Number.isInteger(picked) && picked >= 0 && picked < list.length ? picked : 0 };
  }

  /**
   * The next maneuver ahead of `cursorM`: { kind:'guide', key, instruction, street, type, distM, remainM, remainS }, or null
   * with none ahead. `phrase` is ApexDirections.phrase; `leftS` the live time left (eta.js), null when unknown.
   */
  function guideMessage(t, cursorM, leftS, phrase) {
    if (!t || !Array.isArray(t.steps) || !finite(cursorM)) return null;
    const total = Array.isArray(t.dist) && t.dist.length ? t.dist[t.dist.length - 1] : null;
    const st = t.steps.find((s) => s.m > cursorM - 5 && phrase(s));
    if (!st) return null;
    return { kind: 'guide', key: `${t.id || ''}:${Math.round(st.m)}`, instruction: phrase(st), street: st.street || '', type: st.type,
             distM: Math.max(0, Math.round(st.m - cursorM)), remainM: finite(total) ? Math.max(0, Math.round(total - cursorM)) : null,
             remainS: finite(leftS) ? Math.round(leftS) : null };
  }

  /** Recent places for the car's Places list: [{ name, at: [lat, lon] }], newest first. */
  function placesMessage(recent) {
    const list = (Array.isArray(recent) ? recent : []).filter((p) => p && p.label && finite(p.lat) && finite(p.lon))
      .slice(0, 12).map((p) => ({ name: p.label, at: [p.lat, p.lon] }));
    return { kind: 'places', list };
  }

  const api = { line, routeMessage, guideMessage, placesMessage, MAX_POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarPlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
