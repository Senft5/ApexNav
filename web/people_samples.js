// What arrives on People, shown before it does (REVIEW5 U-121): under the first-use sentence and its key, a dimmed sample of
// a friend's row and of a crew's tile, each captioned as an example. Static words, never real data and never anyone's
// account: no handle that could be a member's, no number that reads as measured. Not a control (no taps, hidden from the
// tab order); a screen reader hears it as one example figure. Lazy (social group): drawn by cockpit.js renderAccount.
(function (root) {
  'use strict';
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/></svg>';

  function figure(el, caption, body, label) {
    const f = el('figure', { className: 'people-sample' });
    f.setAttribute('role', 'img');
    f.setAttribute('aria-label', label);
    const inner = el('div', { className: 'people-sample-body' }, ...body);
    inner.setAttribute('aria-hidden', 'true');
    f.append(el('figcaption', { textContent: caption }), inner);
    return f;
  }

  /** A friend's row as it will look: a face, a handle, live on a road. */
  function friend(el) {
    const face = el('span', { className: 'avatar sample-face' }, el('b', { textContent: 'A' }));
    face.style.setProperty('--av', '40px');
    const row = el('div', { className: 'friend-head' }, face,
      el('span', { className: 'friend-who' }, el('b', { textContent: '@a_friend' }),
        el('small', { className: 'live', textContent: 'Driving · Dry Ridge Rd · 10 min ago' })));
    row.style.gridTemplateColumns = 'auto minmax(0, 1fr)';             // no chevron: an example, not a row to open
    return figure(el, 'Example: what a friend looks like here', [row],
      'Example of a friend on People: their face and handle, driving on Dry Ridge Road 10 minutes ago. Not a real person.');
  }

  /** A crew's tile as it will look: the crest, the name, its next drive and its board. */
  function crew(el) {
    const crest = el('span', { className: 'sample-crest' });
    crest.innerHTML = SHIELD;
    const tile = el('div', { className: 'card sample-crew' }, el('div', { className: 'sample-crew-head' }, crest, el('b', { textContent: 'Your crew' })),
      el('span', { textContent: 'Next drive: Sunday morning · Dry Ridge Rd' }),
      el('span', { textContent: 'Board: the week’s smoothest drivers, faces first' }));
    return figure(el, 'Example: what a crew looks like here', [tile],
      'Example of a crew on People: its crest and name, its next drive on a Sunday morning, and its board. Not a real crew.');
  }

  const api = { friend, crew };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPeopleSamples = api;
})(typeof window !== 'undefined' ? window : globalThis);
