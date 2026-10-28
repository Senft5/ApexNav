// Your year on the road (IDEAS D-24): from the drives on this phone with a known date in one calendar year, how far, how
// many drives and corners, the months you drove, the roads you came back to, your best Driver Score and your longest
// drive. Technique and roads only: never top speeds or times (the guardrails). Unknown stays unknown: a year without a
// scored drive has no best score. Pure (tests/test_year_review.py); the Log draws it and shares it as text.
(function (root) {
  'use strict';
  const MI = 1609.344;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * drives: Log drives ({ name, date, dateKnown, dist[], ds: { score }, corners[] }); year: 2026. Null when there are none.
   */
  function summary(drives, year) {
    const mine = (drives || []).filter((d) => d && d.dateKnown !== false && typeof d.date === 'string' && d.date.startsWith(`${year}-`));
    if (!mine.length) return null;
    const miles = (d) => (Array.isArray(d.dist) && d.dist.length ? d.dist[d.dist.length - 1] / MI : 0);
    const roads = new Map();
    for (const d of mine) if (d.name && !/^Drive \d/.test(d.name)) roads.set(d.name, (roads.get(d.name) || 0) + 1);
    const scored = mine.filter((d) => d.ds && finite(d.ds.score));
    const best = scored.reduce((b, d) => (!b || d.ds.score > b.ds.score ? d : b), null);
    const longest = mine.reduce((b, d) => (!b || miles(d) > miles(b) ? d : b), null);
    return {
      year, drives: mine.length,
      miles: Math.round(mine.reduce((s, d) => s + miles(d), 0)),
      corners: mine.reduce((s, d) => s + (Array.isArray(d.corners) ? d.corners.length : 0), 0),
      months: [...new Set(mine.map((d) => d.date.slice(5, 7)))].length,
      topRoads: [...roads.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
        .map(([name, times]) => ({ name, times })),
      best: best ? { name: best.name, score: best.ds.score, date: best.date.slice(0, 10) } : null,
      longest: longest && miles(longest) > 0 ? { name: longest.name, miles: Math.round(miles(longest) * 10) / 10 } : null,
    };
  }

  /** The year as a few lines of text, for the panel and for sharing. */
  function lines(s) {
    const out = [`${s.miles.toLocaleString('en-US')} mi in ${s.drives} drive${s.drives === 1 ? '' : 's'} · ${s.corners.toLocaleString('en-US')} corners · ${s.months} month${s.months === 1 ? '' : 's'} on the road`];
    if (s.best) out.push(`Best Driver Score: ${s.best.score} on ${s.best.name}`);
    if (s.longest) out.push(`Longest drive: ${s.longest.name}, ${s.longest.miles} mi`);
    if (s.topRoads.length) out.push(`Roads you came back to: ${s.topRoads.map((r) => `${r.name} (${r.times}×)`).join(', ')}`);
    return out;
  }

  const api = { summary, lines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexYearReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
