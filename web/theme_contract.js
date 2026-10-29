// The theme contract (docs/design/REVIEW.md 4.3): what a theme may never change, as data and a check, so a Pro theme
// can't drift into an unsafe layout. A theme is tokens (day and night), three renderers (dial, meter, strip) and a map
// palette; it cannot touch the hazard plate's colours or the legibility floors below. Pure (tests/test_theme_contract.py);
// e2e/smoke.js checks the same floors on the rendered page.
(function (root) {
  'use strict';
  // the hazard plate: identical in every theme, day and night (web/index.html --hz-*)
  const HAZARD = { bg: '#111111', edge: '#FF7A1A', ink: '#FFFFFF' };
  // legibility floors, CSS px on a 390 px wide phone
  const FLOORS = { speedPx: 40, callPx: 21, binnaclePx: 13 };
  // contrast floors: every text token against its surface 4.5:1, the call (panel ink) and the hazard 7:1
  const TEXT_PAIRS = [['panelInk', 'panel', 7], ['panelDim', 'panel', 4.5], ['ink', 'stage', 4.5], ['faceInk', 'face', 7], ['faceDim', 'face', 4.5],
    ['accent', 'panel', 4.5]];
  const RENDERERS = { dial: ['printed', 'sevenseg', 'bezel'], meter: ['gball', 'bars', 'bezelg'], strip: ['roadbook', 'vfd'] };   // grows as Pro themes add theirs
  const REQUIRED = ['stage', 'ink', 'dim', 'route', 'panel', 'panelInk', 'panelDim', 'rule', 'accent', 'signal', 'face', 'faceInk', 'faceDim'];
  const FORBIDDEN = ['hzBg', 'hzEdge', 'hzInk'];                                     // a theme can't set the plate

  function rgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    const c = rgb(hex);
    if (!c) return null;
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** WCAG contrast ratio of two #rrggbb colours, or null. */
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Every way a theme breaks the contract, as short strings; [] when it holds. */
  function check(theme) {
    const out = [];
    if (!theme || typeof theme !== 'object') return ['no theme'];
    for (const [slot, allowed] of Object.entries(RENDERERS)) {
      const r = theme.renderers && theme.renderers[slot];
      if (!allowed.includes(r)) out.push(`renderer ${slot}: ${r === undefined ? 'missing' : r} is not one of ${allowed.join(', ')}`);
    }
    for (const mode of ['day', 'night']) {
      const t = theme[mode];
      if (!t) { out.push(`${mode}: no tokens`); continue; }
      for (const k of REQUIRED) if (!rgb(t[k])) out.push(`${mode}: ${k} missing or not #rrggbb`);
      for (const k of FORBIDDEN) if (k in t) out.push(`${mode}: sets ${k} (the hazard plate is not a theme's)`);
      for (const [fg, bg, min] of TEXT_PAIRS) {
        const c = contrast(t[fg], t[bg]);
        if (c != null && c < min) out.push(`${mode}: ${fg} on ${bg} is ${c.toFixed(2)}:1, under ${min}:1`);
      }
    }
    const hz = contrast(HAZARD.ink, HAZARD.bg);
    if (hz < 7) out.push('hazard plate contrast');                                 // a guard on the constants themselves
    return out;
  }

  const api = { HAZARD, FLOORS, TEXT_PAIRS, RENDERERS, contrast, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexThemeContract = api;
})(typeof window !== 'undefined' ? window : globalThis);
