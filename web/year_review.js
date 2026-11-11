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
      areas: areasOf(mine, miles),
      year, drives: mine.length,
      // RA-3: the total to a tenth, and in metres for the one distance format (format.js distance): rounded to a whole mile
      // here, 1.3 mi read "1 mi" one line above a week of 1.3 mi
      miles: Math.round(mine.reduce((s, d) => s + miles(d), 0) * 10) / 10,
      m: mine.reduce((s, d) => s + miles(d), 0) * MI,
      corners: mine.reduce((s, d) => s + (Array.isArray(d.corners) ? d.corners.length : 0), 0),
      months: [...new Set(mine.map((d) => d.date.slice(5, 7)))].length,
      topRoads: [...roads.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
        .map(([name, times]) => ({ name, times })),
      best: best ? { name: best.name, score: best.ds.score, date: best.date.slice(0, 10) } : null,
      longest: longest && miles(longest) > 0 ? { name: longest.name, miles: Math.round(miles(longest) * 10) / 10 } : null,
    };
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** One best corner as words: "a tight right on Dry Ridge Rd (Aug 12), 99". */
  function cornerText(b) {
    const way = b.dir === 'L' ? 'left' : b.dir === 'R' ? 'right' : 'corner';
    const what = `a ${b.size ? `${b.size} ` : ''}${way}`;
    const day = typeof b.at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.at) ? `${MONTHS[+b.at.slice(5, 7) - 1]} ${+b.at.slice(8, 10)}` : null;
    return `${what}${b.name ? ` on ${b.name}` : ''}${day ? ` (${day})` : ''}, ${b.level}`;
  }
  // Where you drove: drives whose boxes' middles lie within AREA_KM of an area's first drive (oldest first) are one area,
  // named after the road you drove most there (a named drive; "Drive 3" names nothing). No place lookup: the phone's own
  // drives only. Areas with no named drive count but go unnamed.
  const AREA_KM = 40;
  function areasOf(mine, miles) {
    const mid = (d) => (Array.isArray(d.bbox) && d.bbox.length === 4 && d.bbox.every(finite) ? [(d.bbox[0] + d.bbox[1]) / 2, (d.bbox[2] + d.bbox[3]) / 2] : null);
    const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180));
    const areas = [];
    for (const d of [...mine].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0))) {
      const at = mid(d);
      if (!at) continue;
      let a = areas.find((x) => km(x.at, at) <= AREA_KM);
      if (!a) { a = { at, drives: 0, miles: 0, roads: new Map() }; areas.push(a); }
      a.drives++; a.miles += miles(d);
      if (d.name && !/^Drive \d/.test(d.name)) a.roads.set(d.name, (a.roads.get(d.name) || 0) + 1);
    }
    return areas.map((a) => ({ name: [...a.roads.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0]?.[0] || null, drives: a.drives, miles: Math.round(a.miles * 10) / 10 }))
      .sort((p, q) => q.drives - p.drives || q.miles - p.miles || String(p.name).localeCompare(String(q.name)));
  }
  /** The crew drives you came to that year, from the phone's own list (crew_events.js noteCame, key 'apex.crewCame'):
   *  [{ crew, drives }], most first. [] without storage or any. */
  function crewYear(storage, year) {
    let list = [];
    try { list = JSON.parse((storage && storage.getItem('apex.crewCame')) || '[]'); } catch (_) { list = []; }
    if (!Array.isArray(list)) return [];
    const by = new Map();
    for (const x of list) if (x && typeof x.at === 'string' && x.at.startsWith(`${year}-`)) { const c = x.crew || 'a crew'; by.set(c, (by.get(c) || 0) + 1); }
    return [...by.entries()].map(([crew, drives]) => ({ crew, drives })).sort((p, q) => q.drives - p.drives || p.crew.localeCompare(q.crew));
  }
  /** The year as a few lines of text, for the panel and for sharing. */
  function lines(s) {
    // RA-3: every distance through the one format (format.js distance: a tenth under 10, whole from 10), as Your week
    const F = root.ApexFormat, U = root.ApexUnits;
    const dist = (mi) => (F ? F.distance(mi * MI) : U ? U.long(mi * MI, 1, true) : `${mi >= 10 ? Math.round(mi).toLocaleString('en-US') : mi.toFixed(1)} mi`);
    const out = [`${dist(Number.isFinite(s.m) ? s.m / MI : s.miles)} in ${s.drives} drive${s.drives === 1 ? '' : 's'} · ${s.corners.toLocaleString('en-US')} corners · ${s.months} month${s.months === 1 ? '' : 's'} on the road`];
    if (s.best) out.push(`Best Vetta Score: ${s.best.score} on ${s.best.name}`);
    if (s.longest) out.push(`Longest drive: ${s.longest.name}, ${dist(s.longest.miles)}`);
    const named = (s.areas || []).filter((a) => a.name);
    if ((s.areas || []).length >= 2 && named.length) {
      const top = named.slice(0, 3).map((a) => `around ${a.name} (${a.drives} drive${a.drives === 1 ? '' : 's'})`);
      out.push(`Where you drove: ${s.areas.length} areas, most ${top[0]}${top.length > 1 ? `, then ${top.slice(1).join(', ')}` : ''}`);
    }
    if (Array.isArray(s.crews) && s.crews.length) out.push(`Crew drives: ${s.crews.slice(0, 3).map((c) => `${c.drives} with ${c.crew}`).join(', ')}`);
    if (s.topRoads.length) out.push(`Roads you came back to: ${s.topRoads.map((r) => `${r.name} (${r.times}×)`).join(', ')}`);
    // the year's cleanest corners (driver_profile.js bestCorners): technique, 0 to 100, never a speed or a time
    if (Array.isArray(s.bestCorners) && s.bestCorners.length) out.push(`Cleanest corners: ${s.bestCorners.map(cornerText).join('; ')}`);
    return out;
  }

  const api = { summary, lines, cornerText, crewYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexYearReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
