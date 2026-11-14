// People you may know (docs/SOCIAL.md 2.14; backend/src/social.ts friendSuggestions): on People → Friends, a short row of
// crew-mates and friends of your friends you aren't friends with yet, each with why and one Add key, as on any social app.
// × hides one on this phone (`apex.suggestHidden`). reason() and shown() are pure (tests/test_people_suggest.py).
(function (root) {
  'use strict';
  const HIDE_KEY = 'apex.suggestHidden';

  /** Why this person: the crew you share (a crew-mate), or how many friends you have in common. */
  function reason(s) {
    if (s && s.crew) return `In ${s.crew}`;
    const n = s && s.mutual | 0;
    return n === 1 ? '1 friend in common' : `${n} friends in common`;
  }
  /** The suggestions not hidden on this phone, at most `max`. */
  function shown(list, hidden, max = 8) {
    const h = new Set(Array.isArray(hidden) ? hidden : []);
    return (Array.isArray(list) ? list : []).filter((s) => s && s.handle && !h.has(s.handle)).slice(0, max);
  }

  const STYLE = `
    .suggest-sec h3 { margin-bottom: 8px; }
    .suggest-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
    .suggest-card { position: relative; flex: 0 0 136px; scroll-snap-align: start; display: grid; justify-items: center; gap: 4px; padding: 14px 8px 10px;
      text-align: center; }
    .suggest-card .suggest-h { font-size: 14px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .suggest-card small { font-size: 12px; color: var(--panel-dim); min-height: 2.4em; line-height: 1.2; }
    .suggest-card .ink-btn { min-height: 36px; width: 100%; }
    .suggest-card .suggest-x { position: absolute; top: 0; right: 0; width: 36px; height: 36px; display: grid; place-items: center; background: none; border: 0;
      color: var(--panel-dim); font-size: 18px; cursor: pointer; }
  `;

  /** page: el, btn, apiCall, jsonOf, toast, avatar(photoId, handle, px), sent(handle) (keep it as a request you sent). */
  function mount(page) {
    const { el, btn, apiCall, jsonOf } = page;
    if (root.document && !root.document.getElementById('suggestStyle')) root.document.head.append(el('style', { id: 'suggestStyle', textContent: STYLE }));
    const hiddenGet = () => { try { const v = JSON.parse(root.localStorage.getItem(HIDE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
    const hide = (h) => { try { root.localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenGet().filter((x) => x !== h), h].slice(-100))); } catch (_) {} };

    /** Asks, and appends the section to `parent` only when there is someone to suggest (a page with no one keeps its parts). */
    function into(parent) {
      const box = el('section', { className: 'stack-8 suggest-sec' });
      const row = el('div', { className: 'suggest-row', role: 'list' });
      box.append(el('h3', { textContent: 'People you may know' }), row);
      apiCall('GET', '/api/friends/suggested').then(jsonOf).then((list) => {
        const people = shown(list, hiddenGet());
        row.replaceChildren(...people.map((s) => {
          const card = el('div', { className: 'suggest-card', role: 'listitem' });
          const x = el('button', { type: 'button', className: 'suggest-x', textContent: '×', 'aria-label': `Hide @${s.handle}` });
          x.addEventListener('click', () => { hide(s.handle); card.remove(); if (!row.childElementCount) box.remove(); });
          const add = btn('Add', async () => {
            add.disabled = true;
            const r = await apiCall('POST', '/api/friends/request', { handle: s.handle }).catch(() => null);
            if (!r || !r.ok) { add.disabled = false; if (page.toast) page.toast('Couldn’t send that. Try again.'); return; }
            if (page.sent) page.sent(s.handle);
            add.textContent = 'Sent';
          }, 'ink-btn solid');
          card.append(x, page.avatar ? page.avatar(s.photo_id || null, s.handle, 56) : el('span'), el('b', { className: 'suggest-h', textContent: `@${s.handle}` }), el('small', { textContent: reason(s) }), add);
          return card;
        }));
        if (people.length && parent) parent.append(box);
      }).catch(() => {});
      return box;
    }
    return { into };
  }

  const api = { reason, shown, mount, HIDE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPeopleSuggest = api;
})(typeof window !== 'undefined' ? window : globalThis);
