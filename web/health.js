// App health counts (IDEAS Y-03): how often a few named things happen on this phone (a route asked for and found, a road
// upload that failed, the mount calibrating), counted per day here and sent once, the next day, as totals with no session,
// no phone id and no place (backend/src/health.ts). Off with Settings → Share app health. A day with nothing is not sent.
// Pure over an injected storage, send() and clock (tests/test_health.py).
(function (root) {
  'use strict';
  const KEY = 'apex.health', MAX_DAYS = 7;
  const METRICS = ['drives', 'route_ok', 'route_fail', 'route_fallback', 'road_upload_ok', 'road_upload_fail',
    'hazard_queued', 'hazard_sent_late', 'calib_locked', 'calib_lock_s', 'directions_said', 'crash_asked'];
  const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /** storage: localStorage-like; send(body) resolves an HTTP status (or throws offline); enabled() says whether to send. */
  function createHealth(storage, send, enabled, now = () => Date.now()) {
    const load = () => { try { const v = JSON.parse(storage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
    const save = (v) => { try { if (Object.keys(v).length) storage.setItem(KEY, JSON.stringify(v)); else storage.removeItem(KEY); } catch (_) {} };
    let busy = null;
    return {
      /** Adds `by` (default 1) to today's count of a known metric. */
      bump(metric, by = 1) {
        if (!METRICS.includes(metric) || !Number.isFinite(by) || by <= 0 || !enabled()) return;
        const all = load(), day = localDay(now());
        const c = (all[day] = all[day] || {});
        c[metric] = Math.min(100000, (c[metric] || 0) + Math.round(by));
        save(all);
      },
      /** Sends each finished day (oldest first) and forgets it once taken or refused; days older than MAX_DAYS are dropped
       *  unsent. With the switch off nothing is sent and the counts are cleared. Resolves how many days went. */
      flush(app) {
        if (busy) return busy;
        busy = (async () => {
          const all = load(), today = localDay(now());
          if (!enabled()) { save({}); return 0; }
          let sent = 0;
          for (const day of Object.keys(all).sort()) {
            if (day >= today) continue;
            if ((Date.parse(today) - Date.parse(day)) / 86400000 > MAX_DAYS) { delete all[day]; continue; }
            let status = null;
            try { status = await send({ day, app, counts: all[day] }); } catch (_) { status = null; }
            if (status == null || status >= 500 || status === 429) break;      // offline or busy: next time
            delete all[day];
            if (status < 300) sent++;
          }
          save(all);
          return sent;
        })().finally(() => { busy = null; });
        return busy;
      },
      peek: () => load(),
    };
  }

  const api = { createHealth, METRICS, KEY, localDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexHealth = api;
})(typeof window !== 'undefined' ? window : globalThis);
