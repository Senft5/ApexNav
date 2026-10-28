// Local legends without speed (IDEAS S-08): on a stage's board, the person who drove it on the most different days this
// month (from 3 days), never the fastest. For that count the Log publishes each day's best on a stage (the last 35 days,
// not already sent), as well as the all-time best it always sent. Pure (tests/test_legends.py).
(function (root) {
  'use strict';
  const LEGEND_DAYS = 3, RECENT_DAYS = 35;

  /** passes: [{ d: { date }, p: { score, time_s } }] → each day's best [{ day, score, time_s }], newest first, last RECENT_DAYS. */
  function dayBests(passes, now = Date.now()) {
    const from = new Date(now - RECENT_DAYS * 864e5).toISOString().slice(0, 10), best = new Map();
    for (const x of passes || []) {
      const day = x && x.d && typeof x.d.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x.d.date) ? x.d.date.slice(0, 10) : null;
      if (!day || day < from || !x.p || !Number.isFinite(x.p.score)) continue;
      const had = best.get(day);
      if (!had || x.p.score > had.score) best.set(day, { day, score: x.p.score, time_s: x.p.time_s ?? null });
    }
    return [...best.values()].sort((a, b) => b.day.localeCompare(a.day));
  }

  /** The day bests not yet sent (`sent`: { 'seg|day': score }), at most `max`. */
  const toPublish = (segId, bests, sent, max = 10) => bests.filter((b) => (sent || {})[`${segId}|${b.day}`] !== b.score).slice(0, max);

  /** The board's local legend: most days this month (LEGEND_DAYS+), ties to the higher score; null when nobody qualifies. */
  function legend(rows) {
    let top = null;
    for (const r of rows || []) {
      const n = Number(r && r.days_month);
      if (!Number.isFinite(n) || n < LEGEND_DAYS) continue;
      if (!top || n > top.days || (n === top.days && r.driver_score > top.score)) top = { handle: r.handle || null, mine: !!r.mine, days: n, score: r.driver_score };
    }
    return top;
  }
  const legendText = (l) => (!l ? '' : `Local legend this month: ${l.mine ? 'you' : '@' + (l.handle || '?')}, on ${l.days} different days`);

  const api = { dayBests, toPublish, legend, legendText, LEGEND_DAYS, RECENT_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexLegends = api;
})(typeof window !== 'undefined' ? window : globalThis);
