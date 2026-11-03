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
  // (faceDim on panel: the dial's labels are read over the binnacle's paper too; Roadbook day's MPH was 4.22:1 there, IN-3)
  const TEXT_PAIRS = [['panelInk', 'panel', 7], ['panelDim', 'panel', 4.5], ['ink', 'stage', 4.5], ['faceInk', 'face', 7], ['faceDim', 'face', 4.5],
    ['faceDim', 'panel', 4.5], ['accent', 'panel', 4.5]];
  // Panel round 2 (IN-3, PR-2): one colour means act now. The signal is a warning's colour: at least 3:1 on the panel (a
  // non-text floor, WCAG 1.4.11), and nothing that is only a reading may wear it, so the route and the calm ribbon must stand
  // clearly apart from it (RGB distance). A warning state also changes shape and says a word (instruments.js sightShort,
  // index.html .ro-sight.short); colour alone is never the message.
  const SIGNAL_FLOOR = 3;
  const APART = 90;
  const ALARM = { token: 'signal', channels: ['colour', 'shape', 'word'] };
  const RENDERERS = { dial: ['printed', 'sevenseg', 'bezel', 'car'], meter: ['gball', 'bars', 'bezelg', 'car'], strip: ['roadbook', 'vfd'] };   // grows as themes add theirs (car: a private theme's own cluster, drawn from its data)
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

  /** Distance between two #rrggbb colours in RGB, or null: how far apart a reading's colour stands from the warning's. */
  function apart(a, b) {
    const x = rgb(a), y = rgb(b);
    return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : null;
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
      const sig = contrast(t.signal, t.panel);
      if (sig != null && sig < SIGNAL_FLOOR) out.push(`${mode}: signal on panel is ${sig.toFixed(2)}:1, under ${SIGNAL_FLOOR}:1`);
      for (const k of ['route', 'calm']) {
        const d = apart(t[k], t.signal);
        if (d != null && d < APART) out.push(`${mode}: ${k} is the warning's colour (${Math.round(d)} from signal, under ${APART})`);
      }
      // a car's own cluster (theme.car, the private themes): its needles are readings, so they stand apart from the warning's
      // red as the route does, and read on the face; its arrow on the map is outlined in the panel's ink, 3:1 on the map
      const car = theme.car;
      if (car) {
        const nd = car.needle && car.needle[mode];
        if (nd) {
          const d = apart(nd, t.signal), c = contrast(nd, t.face);
          if (d != null && d < APART) out.push(`${mode}: the needle is the warning's colour (${Math.round(d)} from signal, under ${APART})`);
          if (c != null && c < SIGNAL_FLOOR) out.push(`${mode}: the needle on the face is ${c.toFixed(2)}:1, under ${SIGNAL_FLOOR}:1`);
        }
        const bg = theme.map && theme.map[mode] && theme.map[mode].bg, edge = contrast(t.panelInk, bg);
        if (car.silhouette && edge != null && edge < SIGNAL_FLOOR) out.push(`${mode}: the car's outline on the map is ${edge.toFixed(2)}:1, under ${SIGNAL_FLOOR}:1`);
      }
    }
    for (const slot of ['dial', 'meter']) {
      const r = theme.renderers && theme.renderers[slot];
      if (r === 'car' && !(theme.car && theme.car[slot] && Array.isArray(theme.car[slot].parts) && theme.car[slot].parts.length)) out.push(`renderer ${slot}: car without the car's ${slot}`);
    }
    if (theme.renderers && theme.renderers.dial === 'car') {          // the dial carries the speed numeral, whatever the car
      const parts = (theme.car && theme.car.dial && theme.car.dial.parts) || [];
      if (!parts.some((p) => p && p.k === 'digital')) out.push('renderer dial: car without the speed numeral');
    }
    if (theme.renderers && theme.renderers.meter === 'car') {         // and the meter the Bank readout (HE-1: -- until measured)
      const parts = (theme.car && theme.car.meter && theme.car.meter.parts) || [];
      if (!parts.some((p) => p && p.k === 'bank')) out.push('renderer meter: car without the Bank readout');
    }
    const hz = contrast(HAZARD.ink, HAZARD.bg);
    if (hz < 7) out.push('hazard plate contrast');                                 // a guard on the constants themselves
    return out;
  }

  const api = { HAZARD, FLOORS, TEXT_PAIRS, RENDERERS, SIGNAL_FLOOR, APART, ALARM, contrast, apart, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexThemeContract = api;
})(typeof window !== 'undefined' ? window : globalThis);
