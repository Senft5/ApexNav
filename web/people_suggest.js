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

  /** What you typed, as a handle to look for: lower case, no @, 2 to 20 of a-z 0-9 _; else null (nothing is asked). */
  function searchQ(text) {
    const q = String(text == null ? '' : text).trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{2,20}$/.test(q) ? q : null;
  }
  /** The key on a found person's row: Add, or where you already stand. */
  function stand(you) { return you === 'friend' ? 'Friends' : you === 'sent' ? 'Sent' : you === 'asked' ? 'Accept' : 'Add'; }

  const STYLE = `
    .find-list { display: grid; gap: 2px; }
    .find-row { display: flex; align-items: center; gap: 10px; min-height: 48px; }
    .find-row .find-h { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
    .find-row .ink-btn { min-height: 36px; min-width: 76px; }
    .find-row small { color: var(--panel-dim); font-size: 13px; padding: 0 8px; }
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
    /** Find people as you type their handle (Invite sheet): `input` is the handle field; rows go in the box this returns.
     *  add(handle) sends the request (the sheet's own Send request); a friend shows Friends, a request either way its state. */
    function finder(input, add) {
      const list = el('div', { className: 'find-list', role: 'list', 'aria-label': 'People found' });
      let timer = null, asked = '';
      const paint = (rows) => list.replaceChildren(...rows.map((r) => {
        const row = el('div', { className: 'find-row', role: 'listitem' },
          page.avatar ? page.avatar(r.photo_id || null, r.handle, 36) : el('span'), el('b', { className: 'find-h', textContent: `@${r.handle}` }));
        if (r.you === 'friend' || r.you === 'sent') row.append(el('small', { textContent: stand(r.you) }));
        else {
          const k = btn(stand(r.you), async () => { k.disabled = true; const okd = await add(r.handle); if (okd === false) k.disabled = false; else k.replaceWith(el('small', { textContent: r.you === 'asked' ? 'Friends' : 'Sent' })); }, 'ink-btn solid');
          k.setAttribute('aria-label', `${stand(r.you)} @${r.handle}`);
          row.append(k);
        }
        return row;
      }));
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = searchQ(input.value);
        if (!q) { asked = ''; list.replaceChildren(); return; }
        timer = setTimeout(() => {
          asked = q;
          apiCall('GET', `/api/users/search?q=${encodeURIComponent(q)}`).then(jsonOf).then((rows) => { if (asked === q && Array.isArray(rows)) paint(rows); }).catch(() => {});
        }, 250);
      });
      return list;
    }
    return { into, finder };
  }

  const api = { reason, shown, searchQ, stand, mount, HIDE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPeopleSuggest = api;
})(typeof window !== 'undefined' ? window : globalThis);
