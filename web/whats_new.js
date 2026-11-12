// "What's new" after an update (IDEAS O-10): one screen, at most four lines, once per release, never on a first install
// (onboarding is the first screen) and never over a drive or a link that opened the app for something else.
// NEWS is edited with each release that adds something a driver would notice; `id` changes when it does.
// pending() and moment() are pure (tests/test_whats_new.py); show() draws the sheet.
(function (root) {
  'use strict';
  const KEY = 'apex.newsSeen';
  const NEWS = {
    id: '2026-11-10',
    items: [
      // a line each, as on a phone's update notes (walkthrough 2026-11-12: four three-line paragraphs were a wall of text)
      ['Three ways there', 'Quick, Fun or Long way. Fun and Long skip the highway.'],
      ['What it is like', 'The route card sums up the drive and its best stretch.'],
      ['Loops your way', 'Pick a distance or a time on the dial, then a direction.'],
      ['Tune your routes', 'Garage › Settings › Route tuning.'],
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

  function show(el, news, onClose) {
    const overlay = el('div', { className: 'overlay dim show', id: 'newsSheet' });
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'What\'s new');
    const ok = el('button', { className: 'ink-btn solid', textContent: 'Got it' });
    const card = el('div', { className: 'card-sheet' }, el('h2', { textContent: 'What\'s new' }),
      ...news.items.slice(0, 4).map(([title, text]) => el('p', {}, el('b', { textContent: title + '. ' }), text)), ok);
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
