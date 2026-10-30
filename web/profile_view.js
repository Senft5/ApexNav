// A friend's profile (IDEAS S-15, GET /api/friends/:id/profile): what they already show you, as text. Cars they show friends,
// crews you share, the stages they publish to you with their best Vetta Score and days this month. Never times.
// REVIEW_PEOPLE P-04: the profile is the person, so it opens on what you can do with them (On the map, Share a route,
// Invite to a drive) and keeps Unfriend, Report and Block at its foot. lines() is pure (tests/test_profile_view.py);
// show() draws it in the Friends pop-up.
(function (root) {
  'use strict';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** P-24: a car by what it is, its make and model, or its nickname, and only then the bare year ("A 2023 car"). */
  const car = (c) => {
    const what = [c.make, c.model, c.trim].filter(Boolean).join(' ');
    if (what) return [c.year, what].filter(Boolean).join(' ') + (c.nickname ? ` "${c.nickname}"` : '');
    if (c.nickname) return `"${c.nickname}"${c.year ? ` · ${c.year}` : ''}`;
    return c.year ? `A ${c.year} car` : 'A car';
  };
  /** P-24: "friends since August" this year, "since August 2025" before it; a date that can't be read says nothing. */
  function since(iso, now = Date.now()) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return `friends since ${MONTHS[+m[2] - 1]}${+m[1] === new Date(now).getFullYear() ? '' : ` ${m[1]}`}`;
  }

  /** { title, sub, sections: [{ head, rows: [string] }] } */
  function lines(p, now = Date.now()) {
    const sections = [];
    const t = p.totals || {};
    sections.push({ head: 'This month', rows: [t.stages ? `${t.stages} stage${t.stages === 1 ? '' : 's'} shared with you · ${t.days_month} day${t.days_month === 1 ? '' : 's'} on them this month${t.best != null ? ` · best Vetta Score ${t.best}` : ''}`
      : 'No scores shared with you yet.'] });
    if ((p.stages || []).length) sections.push({ head: 'Favourite roads', rows: p.stages.map((s) => `${s.stage} · best ${s.best}${s.days_month ? ` · ${s.days_month} day${s.days_month === 1 ? '' : 's'} this month` : ''}`) });
    if ((p.cars || []).length) sections.push({ head: 'Garage', rows: p.cars.map((c) => car(c) + (c.is_primary ? ' · daily' : '')) });
    if ((p.crews || []).length) sections.push({ head: 'Crews you share', rows: p.crews.slice() });
    return { title: `@${p.handle || '?'}`, sub: [p.name, since(p.friends_since, now)].filter(Boolean).join(' · '), sections };
  }

  /** Draws the profile into `box` (replacing what's there); `back` returns to the list. `keys` ([label, run] pairs) are
   *  the things to do with them, first; `foot` ([label, run, className] triples) the ways to end it, last. */
  function show(box, p, { el, btn, back, keys = [], foot = [] }) {
    const v = lines(p);
    box.replaceChildren(el('div', { className: 'side-pop-head' }, el('h3', { textContent: v.title }), btn('‹ Friends', back, 'linkbtn')),
      ...(v.sub ? [el('p', { className: 'note', textContent: v.sub })] : []),
      ...(keys.length ? [el('div', { className: 'row profile-keys' }, ...keys.map(([label, run], i) => btn(label, run, i ? 'ink-btn' : 'ink-btn solid')))] : []),
      ...v.sections.map((s) => el('div', { className: 'stack-8' }, el('b', { textContent: s.head }), ...s.rows.map((r) => el('p', { className: 'note', textContent: r })))),
      el('p', { className: 'note', textContent: 'Only what they share with you. Times are never shown here.' }),
      ...(foot.length ? [el('div', { className: 'row profile-foot' }, ...foot.map(([label, run, cls]) => btn(label, run, cls || 'linkbtn')))] : []));
  }

  const api = { lines, show, since, car };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexProfileView = api;
})(typeof window !== 'undefined' ? window : globalThis);
