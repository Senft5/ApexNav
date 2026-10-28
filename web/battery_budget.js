// What an hour of driving costs the battery (IDEAS P-01): each drive keeps the battery level at its start and end (the
// iOS shell sends it in every frame; a browser that has navigator.getBattery too), and the Log and Settings say the
// percent per hour. A drive that charged, ran under 10 minutes or never knew the level says nothing. Pure (tests/test_battery_budget.py).
(function (root) {
  'use strict';
  const MIN_MIN = 10;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  /** Feeds one reading { level (0-1), charging } at time t (ms) into the drive's record s (or a fresh one). */
  function feed(s, level, charging, t) {
    const st = s || { first: null, last: null, charged: false };
    if (charging) st.charged = true;
    if (!finite(level) || level < 0 || level > 1) return st;
    if (!st.first) st.first = { level, t };
    st.last = { level, t };
    return st;
  }
  /** { usedPct, minutes, perHour } for a finished drive, or null when it can't be said. */
  function summary(s) {
    if (!s || s.charged || !s.first || !s.last) return null;
    const minutes = (s.last.t - s.first.t) / 60000;
    if (minutes < MIN_MIN) return null;
    const usedPct = Math.max(0, Math.round((s.first.level - s.last.level) * 1000) / 10);
    return { usedPct, minutes: Math.round(minutes), perHour: Math.round(usedPct / minutes * 60 * 10) / 10 };
  }
  /** Across drives: the time-weighted percent per hour and how many drives it's from; null with none. */
  function overall(drives) {
    const known = (drives || []).map((d) => d && d.battery).filter((b) => b && finite(b.perHour) && finite(b.minutes) && b.minutes > 0);
    if (!known.length) return null;
    const mins = known.reduce((s, b) => s + b.minutes, 0), used = known.reduce((s, b) => s + b.usedPct, 0);
    return { perHour: Math.round(used / mins * 60 * 10) / 10, drives: known.length, minutes: mins };
  }
  const api = { feed, summary, overall, MIN_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBattery = api;
})(typeof window !== 'undefined' ? window : globalThis);
