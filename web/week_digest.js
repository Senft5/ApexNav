// Your week (IDEAS D-20): the last 7 days of drives on this phone with a known date: how far, how many new roads, the best
// Driver Score, and one thing to work on (the weakest Score part across the week's scored drives, from two of them).
// Technique only, never speed or time. Unknown stays unknown: no scored drive, no best and no tip. Pure
// (tests/test_week_digest.py); the Log draws it.
(function (root) {
  'use strict';
  const MI = 1609.344, DAY = 864e5;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const named = (d) => typeof d.name === 'string' && d.name && !/^Drive \d/.test(d.name);
  const PARTS = {
    braking: { label: 'Brakes', tip: 'finish braking before you turn in, nothing hard after the apex' },
    smoothness: { label: 'Smooth', tip: 'build cornering load gently: squeeze the wheel in, don’t snap it' },
    consistency: { label: 'Rhythm', tip: 'commit evenly from corner to corner rather than in bursts' },
  };

  /** drives: Log drives ({ name, date, dateKnown, dist[], ds: { score, components } }); now: ms. Null when the week is empty. */
  function digest(drives, now = Date.now()) {
    const dated = (drives || []).filter((d) => d && d.dateKnown !== false && typeof d.date === 'string' && finite(Date.parse(d.date)));
    const from = now - 7 * DAY;
    const week = dated.filter((d) => Date.parse(d.date) > from && Date.parse(d.date) <= now);
    if (!week.length) return null;
    const earlier = new Set(dated.filter((d) => Date.parse(d.date) <= from && named(d)).map((d) => d.name.toLowerCase()));
    const newRoads = new Set(week.filter(named).map((d) => d.name.toLowerCase()).filter((n) => !earlier.has(n))).size;
    const miles = week.reduce((s, d) => s + (Array.isArray(d.dist) && d.dist.length ? d.dist[d.dist.length - 1] / MI : 0), 0);
    const scored = week.filter((d) => d.ds && finite(d.ds.score));
    const best = scored.reduce((b, d) => (!b || d.ds.score > b.ds.score ? d : b), null);
    let focus = null;
    const withParts = scored.filter((d) => d.ds.components);
    if (withParts.length >= 2) {
      let low = null;
      for (const k of Object.keys(PARTS)) {
        const xs = withParts.map((d) => d.ds.components[k]).filter(finite);
        if (xs.length < 2) continue;
        const m = xs.reduce((s, x) => s + x, 0) / xs.length;
        if (!low || m < low.m) low = { k, m };
      }
      if (low) focus = { part: low.k, label: PARTS[low.k].label, tip: PARTS[low.k].tip, pct: Math.round(low.m * 100) };
    }
    return { drives: week.length, miles: Math.round(miles * 10) / 10, newRoads,
             best: best ? { name: best.name, score: best.ds.score } : null, focus };
  }

  function lines(w) {
    const U = root.ApexUnits;                                  // km or miles (units.js, U-22)
    const out = [`${U ? U.long(w.miles * MI) : `${w.miles} mi`} in ${w.drives} drive${w.drives === 1 ? '' : 's'}${w.newRoads ? ` · ${w.newRoads} new road${w.newRoads === 1 ? '' : 's'}` : ''}`];
    if (w.best) out.push(`Best Vetta Score: ${w.best.score} on ${w.best.name}`);
    if (w.focus) out.push(`One thing to work on: ${w.focus.label} (${w.focus.pct}%). Try to ${w.focus.tip}.`);
    return out;
  }

  const api = { digest, lines, PARTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexWeekDigest = api;
})(typeof window !== 'undefined' ? window : globalThis);
