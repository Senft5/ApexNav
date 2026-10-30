// Units (IDEAS U-22): miles and feet, or kilometres and metres, everywhere a distance or a speed is shown or spoken. The
// physics stays SI (CLAUDE.md); this only formats. Default from the phone's language: miles for the US and UK, kilometres
// elsewhere; Settings → Units overrides it (apex.units). Pure apart from reading that setting (tests/test_units.py).
(function (root) {
  'use strict';
  const KEY = 'apex.units', MI = 1609.344, FT = 0.3048;
  const MILES_LANGS = /^en-(US|GB|LR)$|^my(-|$)/i;

  /** 'imperial' | 'metric' from a saved choice, else the language. */
  function choose(saved, lang) {
    if (saved === 'imperial' || saved === 'metric') return saved;
    return MILES_LANGS.test(String(lang || 'en-US')) ? 'imperial' : 'metric';
  }
  let current = null;
  function system() {
    if (current) return current;
    let saved = null;
    try { saved = root.localStorage && root.localStorage.getItem(KEY); } catch (_) {}
    current = choose(saved, root.navigator && root.navigator.language);
    return current;
  }
  function set(s) { current = s === 'metric' ? 'metric' : 'imperial'; try { root.localStorage.setItem(KEY, current); } catch (_) {} return current; }
  const metric = () => system() === 'metric';

  /** Long distances: miles or km as a number. */
  const longN = (m) => (metric() ? m / 1000 : m / MI);
  const longU = () => (metric() ? 'km' : 'mi');
  /** "12.3 mi" / "19.8 km"; `digits` decimals (default 1; under 10 keeps one, `smart` drops it from 10 up). */
  function long(m, digits = 1, smart = false) {
    if (!Number.isFinite(m)) return '--';
    const v = longN(m);
    return `${smart && v >= 10 ? Math.round(v) : v.toFixed(digits)} ${longU()}`;
  }
  /** Short distances for notes and turns: feet in 50s up to 1000 ft, then miles; metres in 10s up to 1000 m, then km. */
  function short(m) {
    if (!Number.isFinite(m)) return { n: '--', u: metric() ? 'M' : 'FT' };
    if (metric()) return m >= 1000 ? { n: (m / 1000).toFixed(1), u: 'KM' } : { n: String(Math.max(0, Math.round(m / 10) * 10)), u: 'M' };
    const ft = m / FT;
    return ft >= 1000 ? { n: (m / MI).toFixed(1), u: 'MI' } : { n: String(Math.max(0, Math.round(ft / 50) * 50)), u: 'FT' };
  }
  /**
   * A short distance as a co-driver says it (REVIEW4 U-93: "then 120 metres" to a driver in miles): "400 feet" (in 50s
   * under 1000 ft), "a quarter mile", "half a mile", "1.5 miles"; "120 metres" (in 10s), "1.2 kilometres".
   */
  function spokenShort(m) {
    if (!Number.isFinite(m) || m < 0) return '';
    if (metric()) return m >= 1000 ? `${(m / 1000).toFixed(1)} kilometres` : `${Math.max(10, Math.round(m / 10) * 10)} metres`;
    const ft = m / FT, mi = m / MI;
    if (ft < 975) return `${Math.max(50, Math.round(ft / 50) * 50)} feet`;
    if (mi < 0.375) return 'a quarter mile';
    if (mi < 0.625) return 'half a mile';
    if (mi < 0.875) return 'three quarters of a mile';
    return mi < 1.05 ? 'a mile' : `${mi.toFixed(1)} miles`;
  }
  /** Speeds: m/s to mph or km/h (a number), and the unit. */
  const speed = (mps) => (mps == null || !Number.isFinite(mps) ? null : mps * (metric() ? 3.6 : 2.2369362921));
  const speedU = () => (metric() ? 'km/h' : 'mph');
  /** The speed dial's top: 140 mph or 220 km/h. */
  const speedMax = () => (metric() ? 220 : 140);

  const api = { KEY, choose, system, set, metric, long, longN, longU, short, spokenShort, speed, speedU, speedMax, _reset: () => { current = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexUnits = api;
})(typeof window !== 'undefined' ? window : globalThis);
