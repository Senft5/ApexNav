// Messages (2026-11-14, backend/src/messages.ts): one friend to another, as in any social app. People → Friends has a
// Messages row (its count is what you haven't read) that opens your conversations, newest first; a friend's profile has
// Message; a push's tap opens the conversation (?chat=). A conversation is bubbles, yours on the right, with a field and
// Send under them; it looks again every 10 s while it is open. A tap on a bubble: Unsend yours, Report theirs.
// lastLine() and stamp() are pure (tests/test_messages.py).
(function (root) {
  'use strict';
  const POLL_MS = 10000, MAX = 1000;
  const tsOf = (at) => { const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : NaN; };

  /** A conversation's row: its last message, "You: " before yours, on one line. */
  function lastLine(t) {
    if (!t || typeof t.last !== 'string') return '';
    const one = t.last.replace(/\s+/g, ' ').trim();
    return (t.mine ? 'You: ' : '') + (one.length > 60 ? `${one.slice(0, 59)}…` : one);
  }
  /** When, short: "now", "5m", "3h", "Tue", "Nov 2". */
  function stamp(at, now = Date.now()) {
    const t = tsOf(at);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    const d = new Date(t);
    if (s < 6 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  const STYLE = `
    .dm-list { display: grid; gap: 2px; }
    .dm-row { display: flex; align-items: center; gap: 12px; min-height: 60px; width: 100%; padding: 6px 0; background: none; border: 0; text-align: left; color: inherit; font: inherit; cursor: pointer; }
    .dm-row .dm-who { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .dm-row .dm-who b { font-size: 16px; }
    .dm-row .dm-who small { color: var(--panel-dim); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dm-row.unread .dm-who small { color: inherit; font-weight: 600; }
    .dm-row .dm-at { color: var(--panel-dim); font-size: 13px; }
    .dm-row .dm-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent, #c8102e); flex: none; }
    .dm-pop { display: flex; flex-direction: column; }
    .dm-pop .dm-head-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .dm-thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 0 12px; min-height: 120px; }
    .dm-msg { max-width: 78%; padding: 8px 12px; border-radius: 18px; background: var(--face, var(--panel)); box-shadow: var(--lift-0); font-size: 16px; line-height: 1.35;
      overflow-wrap: anywhere; white-space: pre-wrap; align-self: flex-start; position: relative; }
    .dm-msg.mine { align-self: flex-end; background: var(--ink, #111); color: var(--paper, #fff); }
    .dm-msg button.dm-more { position: absolute; inset: 0; background: none; border: 0; cursor: pointer; border-radius: inherit; }
    .dm-seen { align-self: flex-end; font-size: 12px; color: var(--panel-dim); margin-top: -2px; }
    .dm-say { display: flex; gap: 8px; align-items: flex-end; padding-top: 8px; border-top: 1px solid var(--rule, rgba(0,0,0,.12)); }
    .dm-say textarea { flex: 1; min-height: 44px; max-height: 140px; resize: none; font: inherit; font-size: 16px; line-height: 1.35; padding: 10px 14px; border-radius: 22px; box-sizing: border-box; }
    .dm-say .ink-btn { min-height: 44px; }
  `;

  /**
   * page: el, btn, toast, apiCall, jsonOf, avatar(photo_id, handle, px), report({kind,target,label,who}) (safety_ui.js),
   * badge(n) (the People tab's count of unread messages), openFriend(handle).
   */
  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const doc = root.document;
    if (doc && !doc.getElementById('dmStyle')) doc.head.append(el('style', { id: 'dmStyle', textContent: STYLE }));
    const face = (t, px) => (page.avatar ? page.avatar(t.photo_id || null, t.handle, px) : el('span'));
    let unread = 0;
    const setUnread = (n) => { unread = Math.max(0, n | 0); if (page.badge) page.badge(unread); rows.forEach((r) => { if (r.isConnected) r._count.textContent = unread ? String(unread) : ''; }); };
    const rows = new Set();

    /** Asks how many are unread (the People badge); quiet with no signal. */
    function refresh() { return apiCall('GET', '/api/me/messages/unread').then(jsonOf).then((j) => { if (j && Number.isFinite(j.unread)) setUnread(j.unread); }).catch(() => {}); }

    /** Your conversations, newest first; a tap opens one. Asks again each time it is drawn. */
    function list() {
      const box = el('div', { className: 'stack-8 dm-sec' });
      const ul = el('div', { className: 'dm-list', role: 'list' });
      box.append(ul);
      const draw = () => apiCall('GET', '/api/messages').then(jsonOf).then((ts) => {
        if (!Array.isArray(ts)) return;
        ul.replaceChildren(...ts.map((t) => {
          const r = el('button', { type: 'button', className: `dm-row${t.unread ? ' unread' : ''}`, role: 'listitem',
            'aria-label': `@${t.handle}${t.unread ? `, ${t.unread} unread` : ''}: ${lastLine(t)}` },
          face(t, 44), el('span', { className: 'dm-who' }, el('b', { textContent: `@${t.handle}` }), el('small', { textContent: lastLine(t) })),
          el('span', { className: 'dm-at', textContent: stamp(t.at) }), ...(t.unread ? [el('span', { className: 'dm-dot', 'aria-hidden': 'true' })] : []));
          r.addEventListener('click', () => open(t.handle, draw));
          return r;
        }));
        if (!ts.length) ul.append(el('p', { className: 'note', textContent: 'No messages yet. Message a friend from their profile.' }));
        setUnread(ts.reduce((a, t) => a + (t.unread | 0), 0));
      }).catch(() => { if (!ul.childElementCount) ul.append(el('p', { className: 'note', textContent: 'Couldn’t load your messages. Check signal.' })); });
      box._draw = draw;
      draw();
      return box;
    }

    /** People's Messages row: its count is what you haven't read. `openList` opens the list's sheet. */
    function row(openList) {
      const count = el('small'), b = el('button', { className: 'nav-row dm-nav', type: 'button' }, el('span', { textContent: 'Messages' }), count, el('i', { 'aria-hidden': 'true' }));
      b._count = count; rows.add(b);
      count.textContent = unread ? String(unread) : '';
      b.addEventListener('click', openList);
      return b;
    }

    // one conversation open at a time, over People
    let pop = null, timer = null;
    function close() { if (timer) { clearInterval(timer); timer = null; } if (pop) { pop.remove(); pop = null; } }

    /** The conversation with @handle. `after`: redraw a list once it closes. */
    function open(handleRaw, after) {
      const handle = String(handleRaw || '').replace(/^@/, '').toLowerCase();
      if (!/^[a-z0-9_]{1,20}$/.test(handle)) return;
      close();
      // not people-pop: a People redraw removes those
      pop = el('aside', { className: 'side-pop dm-pop open' }); pop.setAttribute('aria-label', `Messages with @${handle}`);
      const who = el('div', { className: 'dm-head-who' }, el('h3', { textContent: `@${handle}` }));
      const done = btn('Done', () => { close(); if (after) after(); }, 'linkbtn');
      const thread = el('div', { className: 'dm-thread', role: 'log', 'aria-live': 'polite' });
      const field = el('textarea', { maxLength: MAX, rows: 1, placeholder: 'Message', 'aria-label': `Message @${handle}` });
      const send = btn('Send', () => say(), 'ink-btn solid');
      const sayBox = el('div', { className: 'dm-say' }, field, send);
      pop.append(el('div', { className: 'side-pop-head' }, who, done), thread, sayBox);
      doc.body.append(pop);
      let last = '', sending = false, first = true;
      const bubble = (m) => {
        const b = el('div', { className: `dm-msg${m.mine ? ' mine' : ''}` }, root.document.createTextNode(m.body));
        const more = el('button', { type: 'button', className: 'dm-more', 'aria-label': `${m.mine ? 'You' : `@${handle}`}: ${m.body}. More` });
        more.addEventListener('click', () => menu(m));
        b.append(more);
        return b;
      };
      const menu = (m) => {
        const keys = m.mine
          ? [['Unsend', async () => { const r = await apiCall('DELETE', `/api/messages/m/${encodeURIComponent(m.id)}`).catch(() => null); if (r && r.ok) { last = ''; load(); } else toast('Couldn’t unsend it. Check signal.'); }]]
          : (page.report ? [['Report', () => page.report({ kind: 'dm', target: m.id, label: `a message from @${handle}`, who: handle, done: () => { last = ''; load(); } })]] : []);
        if (!keys.length) return;
        const ov = el('div', { className: 'overlay dim show dm-menu' });
        ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'This message');
        const shut = () => ov.remove(), box = el('div', { className: 'card-sheet' });
        box.append(el('p', { className: 'note', textContent: m.body.length > 80 ? `${m.body.slice(0, 79)}…` : m.body }),
          el('div', { className: 'row', style: 'flex-wrap:wrap' }, ...keys.map(([l, f]) => btn(l, () => { shut(); f(); }, 'ink-btn')), btn('Cancel', shut, 'linkbtn')));
        ov.append(box); ov.addEventListener('click', (e) => { if (e.target === ov) shut(); });
        doc.body.append(ov);
      };
      const load = () => apiCall('GET', `/api/messages/${encodeURIComponent(handle)}`).then(async (r) => {
        if (!pop) return;
        if (r.status === 404) { thread.replaceChildren(el('p', { className: 'note', textContent: 'You can’t message this person.' })); sayBox.hidden = true; return; }
        const j = await jsonOf(r);
        if (!j || !Array.isArray(j.messages)) return;
        if (first && j.with) { who.prepend(face(j.with, 32)); first = false; }
        const key = j.messages.map((m) => `${m.id}${m.seen ? '+' : ''}`).join();
        if (key !== last) {
          last = key;
          const mineLast = j.messages.length && j.messages[j.messages.length - 1].mine ? j.messages[j.messages.length - 1] : null;
          thread.replaceChildren(...j.messages.map(bubble), ...(mineLast && mineLast.seen ? [el('small', { className: 'dm-seen', textContent: 'Seen' })] : []));
          if (!j.messages.length) thread.append(el('p', { className: 'note', textContent: `Say hi to @${handle}.` }));
          thread.scrollTop = thread.scrollHeight;
        }
        if (j.with && !j.with.friend) { sayBox.hidden = true; if (!thread.querySelector('.dm-gone')) thread.append(el('p', { className: 'note dm-gone', textContent: 'You can message friends only.' })); }
        refresh();
      }).catch(() => {});
      async function say() {
        const text = field.value.trim();
        if (!text || sending) return;
        sending = true; send.disabled = true;
        const r = await apiCall('POST', `/api/messages/${encodeURIComponent(handle)}`, { body: text }).catch(() => null);
        sending = false; send.disabled = false;
        if (r && r.ok) { field.value = ''; field.style.height = ''; load(); }
        else toast(r && r.status === 429 ? 'That’s a lot of messages. Wait a little.' : r && r.status === 403 ? 'You can message friends only.' : 'Couldn’t send it. Check signal.');
      }
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(); } });
      field.addEventListener('input', () => { field.style.height = 'auto'; field.style.height = `${Math.min(140, field.scrollHeight)}px`; });
      load();
      // looks again while it is open; another tab (which closes every sheet) ends it
      timer = setInterval(() => { if (pop && !pop.classList.contains('open')) close(); else if (pop && doc.visibilityState === 'visible') load(); }, POLL_MS);
      setTimeout(() => { try { field.focus({ preventScroll: true }); } catch (_) {} }, 50);
    }

    refresh();
    return { list, row, open, close, refresh, get unread() { return unread; } };
  }

  const api = { lastLine, stamp, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMessages = api;
})(typeof window !== 'undefined' ? window : globalThis);
