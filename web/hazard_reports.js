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
      const r = local(me, h);
      if (r.m > lead || r.m < 15 || angle(r.bearing, me.heading) > AHEAD_DEG) continue;
      if (finite(h.heading) && angle(h.heading, me.heading) > SAME_WAY_DEG) continue;   // the other side of the road
      if (!best || r.m < best.m) best = { h, m: r.m };
    }
    return best && { ...best.h, m: Math.round(best.m), text: `${LABEL[best.h.kind] || 'Hazard'} reported ahead` };
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
          if (asked.has(h.id) || (mine && mine.has(h.id))) continue;
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

  const api = { nextAhead, createPassWatch, LABEL, KINDS: Object.keys(LABEL) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexHazardReports = api;
})(typeof window !== 'undefined' ? window : globalThis);
