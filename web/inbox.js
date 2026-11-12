// For you (docs/SOCIAL.md 2.10; backend/src/inbox.ts): one list of what happened to you socially, newest first: a friend
// topping your best Score on one of your stages, someone passing your time in this week's time attack, kudos, a duel
// accepted or decided, new followers of a roadbook, a crew drive you haven't answered. Each row says it in a sentence and
// has at most one key that takes you there. What you have seen is kept on this phone (`apex.inboxSeen`, the server's own
// clock), so the People tab's badge counts only what is new, plus what waits on you (friend requests, duels asked).
// line(), fresh(), ago() are pure (tests/test_inbox.py); mount() draws the section on People → Friends.
(function (root) {
  'use strict';
  const SEEN_KEY = 'apex.inboxSeen', SHOWN = 8;
  /** Rows People already shows as cards with their own keys: counted in the badge, not repeated in the list. */
  const CARDED = new Set(['request', 'duel_ask']);
  const tsOf = (at) => { const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : NaN; };

  /** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago" from a server time and now (ms). '' when unknown. */
  function ago(at, now) {
    const t = tsOf(at);
    if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
    const m = Math.max(0, Math.round((now - t) / 60000));
    if (m < 2) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d <= 1 ? 'yesterday' : `${d} days ago`;
  }
  const secs = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const nth = (n) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; };
  const when = (iso) => {
    const t = tsOf(iso && iso.length > 19 ? iso.slice(0, 19).replace('T', ' ') : iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  /**
   * What one row says. i: an item of GET /api/inbox. → { kicker, text, key: null | { label, act } } where act is one of
   * 'stage' (plan the stage), 'board' (this week's time attack), 'book' (open the roadbook), 'crews' (Crew drives). null
   * for a kind this build doesn't know (an older phone against a newer server shows nothing rather than something wrong).
   */
  function line(i) {
    const who = `@${i.handle || '?'}`, stage = i.stage || 'your stage';
    switch (i.kind) {
      case 'topped': return { kicker: 'Topped', text: `${who} scored ${i.score} on ${stage}, over your best of ${i.yours}.`, key: { label: 'Drive it', act: 'stage' } };
      case 'passed': return { kicker: 'Time attack', text: `${who} went ${secs(i.gap_s)} quicker than you on ${i.stage || 'this week’s loop'}. You're ${nth(i.place)} now.`, key: { label: 'See the board', act: 'board' } };
      case 'kudos': return { kicker: 'Kudos', text: `${who} gave you kudos for ${i.stage || 'a run'}.`, key: null };
      case 'duel_on': return { kicker: 'Duel on', text: `${who} took your duel on ${stage}.`, key: i.have_stage ? { label: 'Drive it', act: 'stage' } : null };
      case 'duel_over': {
        const r = { won: `You beat ${who} on ${stage}.`, lost: `${who} won your duel on ${stage}.`, draw: `Your duel with ${who} on ${stage} is a draw.`, none: `Your duel with ${who} on ${stage} ended with no runs in.` }[i.result];
        return r ? { kicker: i.result === 'won' ? 'Duel won' : 'Duel over', text: r, key: null } : null;
      }
      case 'follows': return { kicker: 'Roadbook', text: i.n === 1 ? `Someone new follows ${i.book}.` : `${i.n} new people follow ${i.book}.`, key: { label: 'Open', act: 'book' } };
      case 'crew_drive': { const d = when(i.starts_at); return { kicker: 'Crew drive', text: `${i.crew}: ${i.title}${d ? `, ${d}` : ''}. Are you going?`, key: { label: 'Answer', act: 'crews' } }; }
      case 'request': return { kicker: 'Friend request', text: `${who} wants to be your friend.`, key: null };
      case 'duel_ask': return { kicker: 'Duel', text: `${who} challenged you on ${stage}.`, key: null };
      default: return null;
    }
  }

  /** What the badge counts: everything waiting on you, and anything else newer than what you last saw here. */
  function fresh(data, seen) {
    const items = data && Array.isArray(data.items) ? data.items.filter((i) => line(i)) : [];
    const s = typeof seen === 'string' ? seen : '';
    return items.filter((i) => i.waiting || (typeof i.at === 'string' && i.at > s)).length;
  }

  const STYLE = `
    .inbox { display: grid; gap: 0; }
    .inbox-row { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--panel-rule, rgba(0,0,0,0.12)); }
    .inbox-row:first-of-type { border-top: 0; }
    .inbox-row p { margin: 0; } .inbox-text { font-size: 15px; line-height: 1.35; }
    .inbox-kick { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--panel-dim); }
    .inbox-row.new .inbox-kick::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 6px; vertical-align: 1px; }
    .inbox-row .ink-btn { grid-row: span 2; }
    .inbox-row > p { grid-column: 1; }   /* a row with no key: the sentence under its kicker, not squeezed beside it */
  `;

  /**
   * page: el, btn, apiCall, jsonOf, signedIn() (a member is signed in), badge(n, data) (paints the People tab),
   * onScreen() (People → Friends is the open view),
   * openStage(canonId, name), openBoard(), openBook(id), openCrews().
   */
  function mount(page) {
    const { el, btn, apiCall, jsonOf } = page;
    if (root.document && !root.document.getElementById('inboxStyle')) root.document.head.append(el('style', { id: 'inboxStyle', textContent: STYLE }));
    const seenGet = () => { try { return root.localStorage.getItem(SEEN_KEY) || ''; } catch (_) { return ''; } };
    const seenSet = (v) => { try { if (v) root.localStorage.setItem(SEEN_KEY, v); } catch (_) {} };
    let last = null, asking = null;

    /** Asks the server again (at most one ask at a time) and repaints the badge. Signed out: nothing, and no badge. */
    function refresh() {
      if (!page.signedIn()) return Promise.resolve(last);   // not known yet, or signed out: People clears the count itself
      if (asking) return asking;
      asking = (async () => {
        try { const r = await apiCall('GET', '/api/inbox'); last = r.ok ? await jsonOf(r) : last; } catch (_) {}
        asking = null;
        page.badge(fresh(last, seenGet()), last);
        return last;
      })();
      return asking;
    }
    const go = (i, act) => {
      if (act === 'stage') return page.openStage(i.canon_id, i.stage);
      if (act === 'board') return page.openBoard();
      if (act === 'book') return page.openBook(i.book_id);
      if (act === 'crews') return page.openCrews();
      return null;
    };

    /** Seen: what the list holds now (the server's clock) is no longer new; the badge keeps what waits. Called when People
     *  → Friends is on screen with the list drawn (People is also drawn behind other tabs, which isn't seeing it). */
    function markSeen() {
      if (!last || !last.now) return;
      seenSet(last.now);
      page.badge(fresh(last, last.now), last);
    }
    /** The For you section on People → Friends: filled when the list arrives, hidden while there is nothing to say. The
     *  rows newer than last time keep their dot until People is drawn again. */
    function section() {
      const box = el('section', { className: 'inbox-sec' }); box.hidden = true;
      const head = el('h3', { textContent: 'For you' });
      refresh().then((data) => {
        const seen = seenGet(), now = data && data.now ? tsOf(data.now) : Date.now();
        const rows = (data && Array.isArray(data.items) ? data.items : []).filter((i) => !CARDED.has(i.kind)).map((i) => ({ i, l: line(i) })).filter((x) => x.l).slice(0, SHOWN);
        const list = el('div', { className: 'inbox', role: 'list' });
        for (const { i, l } of rows) {
          const isNew = typeof i.at === 'string' && i.at > seen;
          const row = el('div', { className: `inbox-row${isNew ? ' new' : ''}`, role: 'listitem' },
            el('p', { className: 'inbox-kick', textContent: `${l.kicker}${ago(i.at, now) ? ` · ${ago(i.at, now)}` : ''}` }));
          if (isNew) row.setAttribute('aria-label', `New. ${l.kicker}. ${l.text}`);
          if (l.key) row.append(btn(l.key.label, () => go(i, l.key.act), 'ink-btn'));
          row.append(el('p', { className: 'inbox-text', textContent: l.text }));
          list.append(row);
        }
        box.replaceChildren(head, list);
        box.hidden = !rows.length;
        if (page.onScreen()) markSeen();
      });
      return box;
    }

    return { refresh, section, markSeen, get last() { return last; } };
  }

  const api = { line, fresh, ago, mount, SEEN_KEY, CARDED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexInbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
