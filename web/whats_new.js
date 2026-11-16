// "What's new" after an update (IDEAS O-10): one screen, at most four lines, once per release, never on a first install
// (onboarding is the first screen) and never over a drive or a link that opened the app for something else.
// NEWS is edited with each release that adds something a driver would notice; `id` changes when it does.
// pending() and moment() are pure (tests/test_whats_new.py); show() draws the sheet.
(function (root) {
  'use strict';
  const KEY = 'apex.newsSeen';
  const NEWS = {
    id: '2026-11-14',
    items: [
      // a line each, as on a phone's update notes (walkthrough 2026-11-12: four three-line paragraphs were a wall of text)
      ['Drive posts', 'Post a drive: its road, Score and clips. Kudos in the Feed.'],
      ['Places on the map', 'Tap a café or fuel stop: photo, hours, how far.'],
      ['Turn by turn', 'An arrow at each turn, on the phone and in CarPlay.'],
      ['Traffic', 'DOT closures and crashes on the map, routed round.'],
    ],
  };

  /**
   * The news to show now, or null. `seen` is the stored id; `onboarded` whether this phone finished onboarding before
   * this launch; `busy` true while a drive runs or the page was opened to do something specific.
   */
  function pending(seen, onboarded, busy, news = NEWS) {
    if (!news || !Array.isArray(news.items) || !news.items.length || seen === news.id || !onboarded || busy) return null;
    return news;
  }

  /**
   * Is this the moment for it (2026-11-10: it came up over Options, 1.2 s into a launch, on someone already choosing
   * roads)? 'show' on a still, empty map; 'wait' while the splash is up (it lifts by itself); 'skip' this launch once
   * the person has touched the app, opened anything, or is driving: news never interrupts, it is there next launch.
   */
  function moment({ touched = false, driving = false, splash = false, open = false } = {}) {
    if (touched || driving || open) return 'skip';
    return splash ? 'wait' : 'show';
  }

  /** Stores the id so it isn't shown again; a first install calls it too, so the next release is the first news it sees. */
  function markSeen(storage, news = NEWS) { try { storage.setItem(KEY, news.id); } catch (_) {} }
  function seen(storage) { try { return storage.getItem(KEY); } catch (_) { return null; } }

  // each line's mark, by its title (2026-11-16: four bold-led sentences read as a block; a mark per line, its title over
  // its words, reads as a phone's own update notes). A title with no mark here gets a plain dot.
  const MARKS = {
    'Drive posts': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15l4.5-4.5 4 4 2.5-2.5L20 17"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    'Places on the map': '<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
    'Turn by turn': '<path d="M7 20v-7a4 4 0 0 1 4-4h7"/><path d="M14.5 5.5L18 9l-3.5 3.5"/>',
    'Traffic': '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  };
  const DOT = '<circle cx="12" cy="12" r="3.5"/>';
  function show(el, news, onClose) {
    const overlay = el('div', { className: 'overlay dim show', id: 'newsSheet' });
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'What\'s new');
    const ok = el('button', { className: 'ink-btn solid', textContent: 'Got it' });
    const card = el('div', { className: 'card-sheet' }, el('h2', { textContent: 'What\'s new' }),
      ...news.items.slice(0, 4).map(([title, text]) => {
        const mark = el('i', { className: 'news-mark' }); mark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MARKS[title] || DOT}</svg>`;
        return el('p', { className: 'news-row' }, mark, el('b', { textContent: title + '. ' }), el('span', { textContent: text }));
      }), ok);
    overlay.append(card);
    const close = () => { overlay.remove(); if (onClose) onClose(); };
    ok.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);
    ok.focus();
  }

  const api = { pending, moment, markSeen, seen, show, NEWS, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexWhatsNew = api;
})(typeof window !== 'undefined' ? window : globalThis);
