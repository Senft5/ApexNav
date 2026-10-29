// Vetta Pro, the web side (docs/MONETIZATION.md 8, docs/design/REVIEW.md 4.5): what Pro unlocks, whether you have it, and
// the one line said when something is Pro. Pro is cosmetic and supporter-only: whole themes (with their voice packs) and
// crew liveries. Nothing that keeps you safe, nothing you made (drives, exports, road data) and no privacy control is ever
// here, and tests/test_pro.py fails if one is added. Pro isn't on sale yet (StoreKit and the App Store products wait on
// the owner's Paid Applications Agreement), so has() is false for everyone and the sheet says so plainly. Pure.
(function (root) {
  'use strict';
  const ITEMS = {
    theme_tapedeck: { label: 'Tapedeck', kind: 'theme' },
    theme_billet: { label: 'Billet', kind: 'theme' },
    livery_club: { label: 'Club livery', kind: 'livery' },
    livery_works: { label: 'Works livery', kind: 'livery' },
    livery_factory: { label: 'Factory livery', kind: 'livery' },
  };
  const KINDS = new Set(['theme', 'livery']);                       // the only things Pro may ever be
  const ENT_KEY = 'apex.pro';                                       // set by the shell's StoreKit bridge once Pro ships

  /** On sale: products exist and the shell can sell them. False until StoreKit ships. */
  function onSale(flags) { return !!(flags && flags.pro === true && flags.proOnSale === true); }

  /** You have Pro: the shell verified an entitlement (never a page-only claim) and the flag is on. */
  function has(store, flags) {
    if (!(flags && flags.pro === true)) return false;
    try { const e = JSON.parse(store.getItem(ENT_KEY) || 'null'); return !!(e && e.verified === true && (!e.expiresMs || e.expiresMs > Date.now())); } catch (_) { return false; }
  }

  /** May you use this item: free things always; a Pro item with Pro. */
  function allowed(item, store, flags) { return !ITEMS[item] || has(store, flags); }

  /** The one line when a Pro item is tapped (REVIEW.md 4.5): what it is, and either See Pro or that Pro isn't on sale. */
  function line(item, flags) {
    const it = ITEMS[item];
    if (!it) return null;
    return onSale(flags) ? `${it.label} comes with Vetta Pro.` : `${it.label} will come with Vetta Pro, which isn't on sale yet. Everything you use today stays free.`;
  }

  const api = { ITEMS, KINDS, ENT_KEY, onSale, has, allowed, line };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPro = api;
})(typeof window !== 'undefined' ? window : globalThis);
