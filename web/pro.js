// ApexNav Pro: which tools are Pro, and when the app may mention it (docs/MONETIZATION.md §2, §1 rule 6). One table, so the
// free/Pro split is decided here and nowhere else; index.html asks `has` or `limit` at each gate. While the `pro` flag is
// off (until the owner approves the price) everything is open, exactly as before. Safety, road data and your own data are
// never in the table, and a test fails if one is added (tests/test_pro.py). Pure, no storage.
(function (root) {
  'use strict';
  /** Pro tools. `free`: how many a free account gets of a counted thing (offline areas, cars); absent = Pro only. */
  const FEATURES = {
    track_mode: { label: 'Lap timing on raceways' },
    stage_delta: { label: 'Compare runs of a road with your best' },
    review_full: { label: 'Your week and year in full' },
    road_compare_history: { label: 'Which road was better, over time' },
    clean_video: { label: 'Videos without the ApexNav mark' },
    offline_areas: { label: 'Offline map areas', free: 1 },
    garage_cars: { label: 'Cars in your Garage', free: 1 },
    extra_voices: { label: 'Extra co-driver voices' },
  };
  /** Never sold (MONETIZATION §1). Listed so the test can hold the line, not consulted by `has`. */
  const NEVER_GATED = ['pace_notes', 'directions', 'hazards', 'closures', 'crash_check', 'convoy', 'convoy_hazards', 'typing_lock',
    'road_data', 'measured_roads', 'gpx_export', 'my_data', 'erase', 'carplay', 'fun_routes', 'loops', 'log', 'driver_score',
    'crews', 'spots', 'drive_card', 'gpx_import', 'saved_routes', 'planning'];
  const ASK_EVERY_MS = 7 * 86400_000, PARKED_MPS = 2;

  /**
   * Combined Pro state. `flagOn`: the `pro` flag; `server`: /api/me `pro`; `device`: what StoreKit on this phone says
   * ({active, source, until}). Either source being active is enough; the phone's own entitlement works with no signal.
   */
  function state(flagOn, server, device, nowMs = Date.now()) {
    const live = (s) => !!(s && s.active && (!s.until || Date.parse(s.until) > nowMs));
    const src = live(device) ? device : live(server) ? server : null;
    return { flagOn: !!flagOn, active: !!src, source: src ? src.source || null : null, until: src ? src.until || null : null,
             trialUsed: !!((server && server.trial_used) || (device && device.trial_used)) };
  }
  /** May this person use a Pro tool? Unknown feature names are open: a typo never locks anything. */
  function has(s, feature) {
    if (!s || !s.flagOn || s.active) return true;
    return !(feature in FEATURES) || FEATURES[feature].free !== undefined;
  }
  /** How many of a counted thing this person may have (Infinity when unlimited). */
  function limit(s, feature) {
    const f = FEATURES[feature];
    if (!f || f.free === undefined || !s || !s.flagOn || s.active) return Infinity;
    return f.free;
  }
  /** Whether a gate may show its one line about Pro now: parked, not mid-drive, at most once a week per feature. */
  function canAsk(ctx) {
    if (!ctx || ctx.driving) return false;
    if (typeof ctx.speedMps === 'number' && ctx.speedMps > PARKED_MPS) return false;
    const last = ctx.lastAskedMs || 0, now = ctx.nowMs || Date.now();
    return now - last >= ASK_EVERY_MS;
  }
  const api = { FEATURES, NEVER_GATED, state, has, limit, canAsk, ASK_EVERY_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPro = api;
})(typeof window !== 'undefined' ? window : globalThis);
