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
      ['Three ways there', 'Every route comes as Quick, Fun and Long way. Tap a card to compare them. Fun and Long way never take the highway.'],
      ['What it is like', 'The route card says in plain words what the drive is like: its character, its best stretch and what slows it down.'],
      ['Loops your way', 'Set a loop by distance or by time on the dial, then pick which way to head. It is built from the best roads nearby.'],
      ['Tune your routes', 'In Garage, Settings, Route tuning: sliders for how much corners, scenery, towns and smooth road count in your routes.'],
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
