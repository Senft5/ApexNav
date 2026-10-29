// A friend's profile (IDEAS S-15, GET /api/friends/:id/profile): what they already show you, as text. Cars they show friends,
// crews you share, the stages they publish to you with their best Vetta Score and days this month. Never times.
// lines() is pure (tests/test_profile_view.py); show() draws it in the Friends pop-up.
(function (root) {
  'use strict';
  const car = (c) => [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') + (c.nickname ? ` "${c.nickname}"` : '');

  /** { title, sub, sections: [{ head, rows: [string] }] } */
  function lines(p) {
    const sections = [];
    const t = p.totals || {};
    sections.push({ head: 'This month', rows: [t.stages ? `${t.stages} stage${t.stages === 1 ? '' : 's'} shared with you · ${t.days_month} day${t.days_month === 1 ? '' : 's'} on them this month${t.best != null ? ` · best Vetta Score ${t.best}` : ''}`
      : 'No scores shared with you yet.'] });
    if ((p.stages || []).length) sections.push({ head: 'Favourite roads', rows: p.stages.map((s) => `${s.stage} · best ${s.best}${s.days_month ? ` · ${s.days_month} day${s.days_month === 1 ? '' : 's'} this month` : ''}`) });
    if ((p.cars || []).length) sections.push({ head: 'Garage', rows: p.cars.map((c) => car(c) + (c.is_primary ? ' · daily' : '')) });
    if ((p.crews || []).length) sections.push({ head: 'Crews you share', rows: p.crews.slice() });
    return { title: `@${p.handle || '?'}`, sub: [p.name, p.friends_since ? `friends since ${p.friends_since}` : null].filter(Boolean).join(' · '), sections };
  }

  /** Draws the profile into `box` (replacing what's there); `back` returns to the list. */
  function show(box, p, { el, btn, back }) {
    const v = lines(p);
    box.replaceChildren(el('div', { className: 'side-pop-head' }, el('h3', { textContent: v.title }), btn('‹ Friends', back, 'linkbtn')),
      ...(v.sub ? [el('p', { className: 'note', textContent: v.sub })] : []),
      ...v.sections.map((s) => el('div', { className: 'stack-8' }, el('b', { textContent: s.head }), ...s.rows.map((r) => el('p', { className: 'note', textContent: r })))),
      el('p', { className: 'note', textContent: 'Only what they share with you. Times are never shown here.' }));
  }

  const api = { lines, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexProfileView = api;
})(typeof window !== 'undefined' ? window : globalThis);
