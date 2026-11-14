// Official traffic events (closures, lane closures, roadwork, slow traffic, crashes) from the state DOTs' own feeds, as the
// Worker compacts them (backend/src/traffic.ts, GET /api/traffic/v1/events.json: the whole region, never where you are).
// Pure (tests/test_road_events.py): the cockpit fetches, then hands what is near you to the same pins, plates, voice and car
// hazards as drivers' reports (hazard_reports.js), marked `official` so nobody is asked "still there?" about a DOT's word.
(function (root) {
  'use strict';
  const KINDS = new Set(['closure', 'closed_way', 'lane', 'roadwork', 'slow', 'crash', 'traffic', 'ice', 'wet', 'sign']);
  // ice / wet: an Ohio road weather sensor's surface (backend/src/traffic.ts parseOhgoWeather); sign: a message sign's words,
  // on the plate only (`silent`: never read aloud)
  // long-lived and everywhere (a city has dozens): shown only as you come near, so the map isn't a wall of cones
  const QUIET = new Set(['roadwork', 'lane', 'wet', 'sign']);
  const NEAR_KM = 20, QUIET_KM = 3, MAX = 60;
  const REFRESH_MS = 5 * 60000, REMERGE_M = 1000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const metres = (aLat, aLon, bLat, bLon) => Math.hypot((bLat - aLat) * 110540, (bLon - aLon) * 111320 * Math.cos(aLat * Math.PI / 180));
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

  /** The Worker's answer as clean rows ({ ..., official: true }); anything malformed is left out. */
  function rows(json) {
    const list = json && Array.isArray(json.events) ? json.events : [];
    const out = [];
    for (const e of list) {
      if (!e || typeof e.id !== 'string' || !KINDS.has(e.kind) || !finite(e.lat) || !finite(e.lon) || Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180) continue;
      const r = { id: e.id.slice(0, 60), kind: e.kind, label: str(e.label, 30) || 'Traffic alert', lat: e.lat, lon: e.lon,
        road: str(e.road, 40), until: finite(e.until) ? e.until : null, src: str(e.src, 16), official: true };
      if (str(e.text, 90)) r.words = str(e.text, 90);              // (not `text`: nextAhead's spoken line)
      if (r.kind === 'sign') r.silent = true;
      if (finite(e.heading)) r.heading = ((e.heading % 360) + 360) % 360;
      out.push(r);
    }
    return out;
  }

  /**
   * The events to show and call round `lat, lon`: not ended at `nowMs`, closures, slow traffic and crashes within NEAR_KM,
   * roadwork and lane closures within QUIET_KM, nearest first, at most MAX, each with `m` (metres from you).
   */
  function near(list, lat, lon, nowMs = Date.now()) {
    if (!finite(lat) || !finite(lon)) return [];
    return (Array.isArray(list) ? list : []).filter((h) => h && finite(h.lat) && finite(h.lon) && !(finite(h.until) && h.until <= nowMs))
      .map((h) => ({ ...h, m: Math.round(metres(lat, lon, h.lat, h.lon)) }))
      .filter((h) => h.m <= (QUIET.has(h.kind) ? QUIET_KM : NEAR_KM) * 1000)
      .sort((a, b) => a.m - b.m).slice(0, MAX);
  }

  /** Full closures (both ways) only: what the router keeps off. One-way and lane closures are shown, never routed round. */
  const closures = (list) => (Array.isArray(list) ? list : []).filter((h) => h && h.official && h.kind === 'closure');

  // Early word on the route ahead (2026-11-14): a crash, a one-way closure, slow traffic or an icy road the planned route drives through,
  // your way, 1 to 25 km on, so there is time to go round (a voice call 600 m out is too late on a highway).
  const AHEAD_KINDS = new Set(['crash', 'closed_way', 'slow', 'ice']);
  const ON_ROUTE_M = 40, SAME_WAY_DEG = 70, M_LAT = 110540;
  const turn = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  /**
   * The nearest event (AHEAD_KINDS) within ON_ROUTE_M of track `t` ({ lat[], lon[], dist[] }) between `atM + minM` and
   * `atM + maxM` along it, and, when it says which way it applies (`heading`), only where the route goes that way:
   * { ...event, aheadM }, or null.
   */
  function onRouteAhead(t, atM, list, { minM = 1000, maxM = 25000, m = ON_ROUTE_M } = {}) {
    if (!t || !Array.isArray(t.lat) || !Array.isArray(t.dist) || t.lat.length < 2 || !finite(atM)) return null;
    const n = t.lat.length, a = atM + minM, b = atM + maxM;
    let best = null;
    for (const h of Array.isArray(list) ? list : []) {
      if (!h || !AHEAD_KINDS.has(h.kind) || !finite(h.lat) || !finite(h.lon)) continue;
      const kx = 111320 * Math.cos(h.lat * Math.PI / 180);
      let pass = null;                                                   // the route's first pass by it: its nearest point
      for (let i = 1; i < n; i++) {
        if (t.dist[i] < a) continue;
        if (t.dist[i - 1] > b) break;
        const ax = (t.lon[i - 1] - h.lon) * kx, ay = (t.lat[i - 1] - h.lat) * M_LAT, bx = (t.lon[i] - h.lon) * kx, by = (t.lat[i] - h.lat) * M_LAT;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
        const d = Math.hypot(ax + u * dx, ay + u * dy);
        if (d > m) { if (pass) break; continue; }
        if (!pass || d < pass.d) pass = { d, at: t.dist[i - 1] + u * (t.dist[i] - t.dist[i - 1]), bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
      }
      if (!pass || pass.at < a || pass.at > b) continue;
      if (finite(h.heading) && turn(pass.bearing, h.heading) > SAME_WAY_DEG) continue;   // the other carriageway's
      if (!best || pass.at - atM < best.aheadM) best = { ...h, aheadM: Math.round(pass.at - atM) };
    }
    return best;
  }

  /** Ask again? Once REFRESH_MS has passed since the last answer (or try). */
  const due = (lastMs, nowMs) => !finite(lastMs) || nowMs - lastMs >= REFRESH_MS;
  /** Merge again round a new position? Once you're REMERGE_M from where it was last done. */
  const moved = (last, p) => !last || !p || metres(last.lat, last.lon, p.lat, p.lon) >= REMERGE_M;

  const api = { rows, near, closures, onRouteAhead, due, moved, KINDS: [...KINDS], QUIET: [...QUIET], NEAR_KM, QUIET_KM, REFRESH_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexRoadEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
