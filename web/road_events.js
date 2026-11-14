// Official traffic events (closures, lane closures, roadwork, slow traffic, crashes) from the state DOTs' own feeds, as the
// Worker compacts them (backend/src/traffic.ts, GET /api/traffic/v1/events.json: the whole region, never where you are).
// Pure (tests/test_road_events.py): the cockpit fetches, then hands what is near you to the same pins, plates, voice and car
// hazards as drivers' reports (hazard_reports.js), marked `official` so nobody is asked "still there?" about a DOT's word.
(function (root) {
  'use strict';
  const KINDS = new Set(['closure', 'closed_way', 'lane', 'roadwork', 'slow', 'crash', 'traffic']);
  // long-lived and everywhere (a city has dozens): shown only as you come near, so the map isn't a wall of cones
  const QUIET = new Set(['roadwork', 'lane']);
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
        road: str(e.road, 40), until: finite(e.until) ? e.until : null, src: str(e.src, 12), official: true };
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

  /** Ask again? Once REFRESH_MS has passed since the last answer (or try). */
  const due = (lastMs, nowMs) => !finite(lastMs) || nowMs - lastMs >= REFRESH_MS;
  /** Merge again round a new position? Once you're REMERGE_M from where it was last done. */
  const moved = (last, p) => !last || !p || metres(last.lat, last.lon, p.lat, p.lon) >= REMERGE_M;

  const api = { rows, near, closures, due, moved, KINDS: [...KINDS], QUIET: [...QUIET], NEAR_KM, QUIET_KM, REFRESH_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexRoadEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
