// Hazards people reported by hand (IDEAS Q-15) on the cockpit: which are ahead of you and worth a call, and when to ask
// "still there?" (Q-16) after you pass one. Pure (tests/test_hazard_reports.py); the page fetches, draws and speaks.
(function (root) {
  'use strict';
  const LABEL = { pothole: 'Pothole', gravel: 'Gravel', debris: 'Debris', animal: 'Animal', police: 'Police', closure: 'Road closed' };
  const AHEAD_DEG = 35, SAME_WAY_DEG = 70, PASSED_NEAR_M = 60, PASSED_BEHIND_M = 80;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const M_LAT = 110540;

  function local(from, to) {
    const x = (to.lon - from.lon) * 111320 * Math.cos(from.lat * Math.PI / 180), y = (to.lat - from.lat) * M_LAT;
    return { m: Math.hypot(x, y), bearing: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 };
  }
  const angle = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

  /**
   * The hazard to call next, or null: in front of you (within AHEAD_DEG of your heading), within `lead` metres, reported
   * by someone travelling your way (or with no heading), not one you already heard (`said` has its id).
   */
  function nextAhead(list, me, lead, said) {
    if (!me || !finite(me.lat) || !finite(me.lon) || !finite(me.heading)) return null;
    let best = null;
    for (const h of list || []) {
      if (said && said.has(h.id)) continue;
      if (said && h.silent) continue;                                  // a message sign's words: on the plate, never aloud
      const r = local(me, h);
      if (r.m > lead || r.m < 15 || angle(r.bearing, me.heading) > AHEAD_DEG) continue;
      if (finite(h.heading) && angle(h.heading, me.heading) > SAME_WAY_DEG) continue;   // the other side of the road
      if (!best || r.m < best.m) best = { h, m: r.m };
    }
    // a Factory crew's own word when it has one; a DOT's event (road_events.js, `official`) is the agency's, not "reported"
    return best && { ...best.h, m: Math.round(best.m), text: `${best.h.label || LABEL[best.h.kind] || 'Hazard'}${best.h.official ? '' : ' reported'} ahead` };
  }

  /**
   * Tracks hazards you came within PASSED_NEAR_M of; once one is PASSED_BEHIND_M behind you, returns it once so the page
   * can ask "still there?". Your own reports (`mine`) and ones on the other side of the road are never asked about.
   */
  function createPassWatch() {
    const near = new Map(), asked = new Set();
    return {
      update(list, me, mine) {
        if (!me || !finite(me.lat) || !finite(me.lon)) return null;
        for (const h of list || []) {
          if (!h || h.official || asked.has(h.id) || (mine && mine.has(h.id))) continue;   // a DOT's word isn't ours to vote on
          if (finite(h.heading) && finite(me.heading) && angle(h.heading, me.heading) > SAME_WAY_DEG) continue;   // the other side: not yours to judge
          const r = local(me, h);
          if (r.m <= PASSED_NEAR_M) { near.set(h.id, h); continue; }
          if (near.has(h.id) && r.m >= PASSED_BEHIND_M && (!finite(me.heading) || angle(r.bearing, me.heading) > 90)) {
            near.delete(h.id); asked.add(h.id);
            return h;
          }
        }
        return null;
      },
    };
  }

  /**
   * Road closures to route around (IDEAS Q-17): reported closures inside the trip's box (its points, widened by `padKm`),
   * as Valhalla exclude_locations ({lat, lon}), nearest the trip's middle first, at most `max` (the router's limit is 50).
   */
  function closuresFor(list, points, padKm = 15, max = 30) {
    const pts = (points || []).filter((p) => p && finite(p.lat) && finite(p.lon));
    if (!pts.length) return [];
    const lat0 = Math.min(...pts.map((p) => p.lat)), lat1 = Math.max(...pts.map((p) => p.lat));
    const lon0 = Math.min(...pts.map((p) => p.lon)), lon1 = Math.max(...pts.map((p) => p.lon));
    const dLat = padKm / 110.54, dLon = padKm / (111.32 * Math.max(0.2, Math.cos(((lat0 + lat1) / 2) * Math.PI / 180)));
    const mid = { lat: (lat0 + lat1) / 2, lon: (lon0 + lon1) / 2 };
    return (list || []).filter((h) => h && h.kind === 'closure' && finite(h.lat) && finite(h.lon)
        && h.lat >= lat0 - dLat && h.lat <= lat1 + dLat && h.lon >= lon0 - dLon && h.lon <= lon1 + dLon)
      .sort((a, b) => local(mid, a).m - local(mid, b).m).slice(0, max).map((h) => ({ lat: h.lat, lon: h.lon }));
  }

  /**
   * What the hazard plate says (docs/design/REVIEW.md 4.3): { title, detail }. `dist(m)` formats a distance in the driver's
   * units; `nowMs` is the clock. The detail says how far and how old, and how many drivers confirmed it; never who reported
   * it (reports are anonymous). A part that is unknown is left out, never guessed.
   */
  function plate(h, dist, nowMs) {
    if (!h) return null;
    const parts = [];
    if (finite(h.m) && dist) parts.push(`in ${dist(h.m)}`);
    if (h.official) {                                                   // a DOT's event: its road and the agency, never an age
      // a sign's own words ("Main st closed 3 miles ahead"); else the road and the agency
      for (const w of (typeof h.words === 'string' && h.words.trim() ? [h.words] : [h.road, h.src])) if (typeof w === 'string' && w.trim()) parts.push(w.trim());
      return { title: h.label || LABEL[h.kind] || 'Hazard', detail: parts.join(' · ') };
    }
    const at = typeof h.created_at === 'string' ? Date.parse(h.created_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(h.created_at) ? '' : 'Z')) : NaN;
    if (Number.isFinite(at) && finite(nowMs) && nowMs >= at) {
      const min = Math.round((nowMs - at) / 60000);
      parts.push(min < 1 ? 'reported just now' : min < 60 ? `reported ${min} min ago` : min < 48 * 60 ? `reported ${Math.round(min / 60)} h ago` : `reported ${Math.round(min / 1440)} days ago`);
    }
    if (finite(h.confirms) && h.confirms > 0) parts.push(`${h.confirms} confirmed`);
    return { title: h.label || LABEL[h.kind] || 'Hazard', detail: parts.join(' · ') };
  }

  /**
   * Road hazards for our router's search (IDEAS R-04): potholes, gravel and debris inside the trip's box (widened by
   * `padKm`) that another driver confirmed (confirms >= 1) and that weren't cleared by more drivers than confirmed them,
   * nearest the trip's middle first, at most `max`, as { lat, lon }. One driver's word alone, animals (gone in minutes),
   * police and closures (their own lists) are not in it.
   */
  const ROAD_KINDS = new Set(['pothole', 'gravel', 'debris']);
  function roadHazardsFor(list, points, padKm = 15, max = 40) {
    const pts = (points || []).filter((p) => p && finite(p.lat) && finite(p.lon));
    if (!pts.length) return [];
    const lat0 = Math.min(...pts.map((p) => p.lat)), lat1 = Math.max(...pts.map((p) => p.lat));
    const lon0 = Math.min(...pts.map((p) => p.lon)), lon1 = Math.max(...pts.map((p) => p.lon));
    const dLat = padKm / 110.54, dLon = padKm / (111.32 * Math.max(0.2, Math.cos(((lat0 + lat1) / 2) * Math.PI / 180)));
    const mid = { lat: (lat0 + lat1) / 2, lon: (lon0 + lon1) / 2 };
    return (list || []).filter((h) => h && ROAD_KINDS.has(h.kind) && finite(h.lat) && finite(h.lon)
        && (Number(h.confirms) || 0) >= 1 && !((Number(h.clears) || 0) > (Number(h.confirms) || 0))
        && h.lat >= lat0 - dLat && h.lat <= lat1 + dLat && h.lon >= lon0 - dLon && h.lon <= lon1 + dLon)
      .sort((a, b) => local(mid, a).m - local(mid, b).m).slice(0, max).map((h) => ({ lat: h.lat, lon: h.lon }));
  }

  // ---- Avoid police reports (IDEAS R-35, the owner 2026-11-11) -------------------------------------------------------
  // Only what drivers reported in the last hour as "Police" (the server keeps a police report 60 min from its last
  // confirmation, hazards.ts LIFE_MIN) and a convoy leader's live "Police" call. There is no checkpoint kind, and none is
  // ever made from these: App Store 1.4.3 allows DUI checkpoints only as published by the police (docs/APP_REVIEW.md).
  const POLICE_M = 150, POLICE_MAX = 20;
  const ms = (v) => (typeof v === 'string' ? Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z') : NaN);
  /**
   * Police reports to keep away from on a trip: live ones (not expired at `nowMs`, not cleared by more drivers than
   * confirmed them) inside the trip's box widened by `padKm`, nearest its middle first, at most `max`, as { lat, lon }.
   * `calls`: a convoy's live police calls ({ lat, lon }), kept first.
   */
  function policeFor(list, points, nowMs = Date.now(), calls = [], padKm = 15, max = POLICE_MAX) {
    const pts = (points || []).filter((p) => p && finite(p.lat) && finite(p.lon));
    if (!pts.length) return [];
    const lat0 = Math.min(...pts.map((p) => p.lat)), lat1 = Math.max(...pts.map((p) => p.lat));
    const lon0 = Math.min(...pts.map((p) => p.lon)), lon1 = Math.max(...pts.map((p) => p.lon));
    const dLat = padKm / 110.54, dLon = padKm / (111.32 * Math.max(0.2, Math.cos(((lat0 + lat1) / 2) * Math.PI / 180)));
    const inBox = (h) => h && finite(h.lat) && finite(h.lon) && h.lat >= lat0 - dLat && h.lat <= lat1 + dLat && h.lon >= lon0 - dLon && h.lon <= lon1 + dLon;
    const mid = { lat: (lat0 + lat1) / 2, lon: (lon0 + lon1) / 2 };
    const live = (h) => { const x = ms(h.expires_at); return !finite(x) || x > nowMs; };
    const kept = (h) => !((Number(h.clears) || 0) > (Number(h.confirms) || 0));
    const reps = (list || []).filter((h) => h && h.kind === 'police' && inBox(h) && live(h) && kept(h)).sort((a, b) => local(mid, a).m - local(mid, b).m);
    const out = [];
    for (const h of [...(calls || []).filter(inBox), ...reps]) if (out.length < max && !out.some((o) => local(o, h).m < 50)) out.push({ lat: h.lat, lon: h.lon });
    return out;
  }
  /** Reports kept from earlier (asked ahead of a dead zone) that are still live: none past its `expires_at`. */
  function stillLive(list, nowMs = Date.now()) {
    return (Array.isArray(list) ? list : []).filter((h) => { const x = h ? ms(h.expires_at) : NaN; return h && (!finite(x) || x > nowMs); });
  }
  /** Does a line ([[lon, lat], ...]) pass within `m` metres of any of `pts` ({ lat, lon })? */
  function passesNear(coords, pts, m = POLICE_M) {
    if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(pts) || !pts.length) return false;
    for (const p of pts) {
      const kx = 111320 * Math.cos(p.lat * Math.PI / 180);
      for (let i = 1; i < coords.length; i++) {
        const ax = (coords[i - 1][0] - p.lon) * kx, ay = (coords[i - 1][1] - p.lat) * M_LAT, bx = (coords[i][0] - p.lon) * kx, by = (coords[i][1] - p.lat) * M_LAT;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
        if (Math.hypot(ax + t * dx, ay + t * dy) <= m) return true;
      }
    }
    return false;
  }

  /**
   * The nearest police report on the route ahead of you (the drive's offer to go round one, docs/ROUTING.md): a point of
   * `pts` within `m` of the route's line between `atM + minM` and `atM + maxM` along it. Nearer than minM there's no time to
   * go round; further than maxM it may be gone by then. t: { lat[], lon[], dist[] } (metres along). { lat, lon, aheadM } or null.
   */
  function onRouteAhead(t, atM, pts, { m = POLICE_M, minM = 800, maxM = 25000 } = {}) {
    if (!t || !Array.isArray(t.lat) || !Array.isArray(t.dist) || t.lat.length < 2 || !finite(atM) || !Array.isArray(pts) || !pts.length) return null;
    const n = t.lat.length, a = atM + minM, b = atM + maxM;
    let best = null;
    for (const p of pts) {
      if (!p || !finite(p.lat) || !finite(p.lon)) continue;
      const kx = 111320 * Math.cos(p.lat * Math.PI / 180);
      let pass = null;                                                   // the route's first pass by it: its nearest point
      for (let i = 1; i < n; i++) {
        if (t.dist[i] < a) continue;
        if (t.dist[i - 1] > b) break;
        const ax = (t.lon[i - 1] - p.lon) * kx, ay = (t.lat[i - 1] - p.lat) * M_LAT, bx = (t.lon[i] - p.lon) * kx, by = (t.lat[i] - p.lat) * M_LAT;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
        const d = Math.hypot(ax + u * dx, ay + u * dy);
        if (d > m) { if (pass) break; continue; }
        const at = t.dist[i - 1] + u * (t.dist[i] - t.dist[i - 1]);
        if (!pass || d < pass.d) pass = { d, at };
      }
      if (pass && pass.at >= a && pass.at <= b && (!best || pass.at - atM < best.aheadM)) best = { lat: p.lat, lon: p.lon, aheadM: Math.round(pass.at - atM) };
    }
    return best;
  }

  const api = { nextAhead, createPassWatch, stillLive, closuresFor, roadHazardsFor, policeFor, passesNear, onRouteAhead, POLICE_M, plate, LABEL, KINDS: Object.keys(LABEL) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexHazardReports = api;
})(typeof window !== 'undefined' ? window : globalThis);
