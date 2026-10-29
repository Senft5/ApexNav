// Share your ETA (IDEAS S-19): what the link's page says, from GET /api/eta/:token. Who, how long, when, and how fresh
// that is; never where. Pure (tests/test_eta_share.py); web/eta.html polls and draws it, the cockpit starts and refreshes it.
(function (root) {
  'use strict';
  const STALE_MS = 5 * 60000;

  /** { title, sub, note } for the page. */
  function viewText(v, now = Date.now(), locale) {
    const who = v && v.handle ? `@${v.handle}` : 'Your driver';
    if (!v) return { title: 'This link isn’t working', sub: 'Ask for a new one.', note: '' };
    if (v.ended === 'arrived') return { title: `${who} has arrived`, sub: '', note: '' };
    if (v.ended === 'stopped') return { title: `${who} stopped sharing`, sub: '', note: '' };
    if (v.ended === 'expired') return { title: 'This link has expired', sub: 'Shared arrival times last 4 hours.', note: '' };
    const arrive = Date.parse(v.arrive_at), updated = Date.parse(v.updated_at);
    // no arrival time we can read: say so plainly, never "NaN min" (docs/design/REVIEW2.md, U-43)
    if (!Number.isFinite(arrive)) return { title: `${who}'s arrival time isn't known yet`, sub: '--', note: '' };
    const left = Math.round((arrive - now) / 60000);
    const time = new Date(arrive).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const ago = Math.max(0, Math.floor((now - updated) / 60000));
    return {
      title: left <= 1 ? `${who} should be there about now` : `${who} is about ${left} min away`,
      sub: `Arriving around ${time}`,
      note: !Number.isFinite(updated) ? '' : now - updated > STALE_MS ? `Last update ${ago} min ago. Their phone may have no signal.` : `Updated ${ago < 1 ? 'just now' : `${ago} min ago`}`,
    };
  }

  const api = { viewText, STALE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEtaShare = api;
})(typeof window !== 'undefined' ? window : globalThis);
