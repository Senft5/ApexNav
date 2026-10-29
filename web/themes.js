// ApexThemes — Road book cockpit palette.
//
// A theme owns: colour tokens (day + night), typography, the basemap palette, which
// cluster renders the binnacle, and how pace notes are drawn. The app never
// hardcodes a colour; it asks the active theme.
//
//   roadbook   (A) FIA rally roadbook: ink on paper, tulip pace notes, printed gauges
(function (root) {
  'use strict';

  const FONT = { ui: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', num: '"Barlow Condensed", "Arial Narrow", sans-serif' };

  const THEMES = {
    roadbook: {
      id: 'roadbook', label: 'Road book', tag: 'A', blurb: 'Paper and red ink.',
      fonts: FONT, cluster: 'dials', notes: 'roadbook', gauge: 'printed',
      day: {
        stage: '#F2EBDD', ink: '#1C1A17', dim: '#6A6255', route: '#C8102E', routeCasing: '#F2EBDD',
        panel: '#EDE4D3', panelInk: '#1C1A17', panelDim: '#6A6255', rule: '#1C1A17', accent: '#C8102E',
        signal: '#C8102E', amber: '#8A5810', calm: '#1C1A17',
        face: '#F6F0E4', faceInk: '#1C1A17', faceDim: '#9A9080', hair: '#CFC4AE', gain: '#2E6B3F'
      },
      night: {
        stage: '#1A1814', ink: '#EDE4D3', dim: '#9A9080', route: '#E65252', routeCasing: '#1A1814',
        panel: '#151310', panelInk: '#EDE4D3', panelDim: '#8C8373', rule: '#EDE4D3', accent: '#E65252',
        signal: '#E65252', amber: '#D9A24A', calm: '#EDE4D3',
        face: '#1A1814', faceInk: '#EDE4D3', faceDim: '#6A6255', hair: '#2E2A23', gain: '#6FBF7F'
      },
      map: {
        day: { bg: '#F2EBDD', water: '#CFD8D3', waterLine: '#7F9A9A', land: '#EFE7D8', wood: '#E3DCC5', road: '#FFFFFF', roadMinor: '#FFFFFF', casing: '#1C1A17', label: '#1C1A17', halo: '#F2EBDD', boundary: '#8C8373', contour: '#8B6B4A', shadow: '#A08F6E', highlight: '#FFFFFF', accentShade: '#B59E78' },
        night: { bg: '#1B1712', water: '#10161A', waterLine: '#26343A', land: '#1D1914', wood: '#1F1C15', road: '#36312A', roadMinor: '#2B2721', casing: '#A99F8C', label: '#A89E8C', halo: '#1B1712', boundary: '#332F28', contour: '#3A3126', shadow: '#080706', highlight: '#28231C', accentShade: '#14120E' }
      }
    }
  };
  function get() { return THEMES.roadbook; }

  // Accents (IDEAS S-10): cosmetic colours for the route line and the cockpit's accent, unlocked with earned Octane
  // (Settings → Look). Warnings keep their own colour (signal) whatever the accent: nothing here changes what a hazard looks like.
  const ACCENTS = {
    rally_blue: { label: 'Rally blue', day: { route: '#1F4FA8', accent: '#1F4FA8' }, night: { route: '#6E9BEF', accent: '#6E9BEF' } },
    racing_green: { label: 'Racing green', day: { route: '#1E5B3A', accent: '#1E5B3A' }, night: { route: '#5DB585', accent: '#5DB585' } },
    ink: { label: 'Ink', day: { route: '#1C1A17', accent: '#1C1A17' }, night: { route: '#EDE4D3', accent: '#EDE4D3' } },
  };
  const ACCENT_KEY = 'apex.accent';
  function accent() { try { const a = root.localStorage.getItem(ACCENT_KEY); return ACCENTS[a] ? a : null; } catch (_) { return null; } }
  function setAccent(a) { try { if (ACCENTS[a]) root.localStorage.setItem(ACCENT_KEY, a); else root.localStorage.removeItem(ACCENT_KEY); } catch (_) {} }
  function apply(id, night) {
    const t = get(id), a = accent();
    const base = night ? t.night : t.day, c = a ? { ...base, ...ACCENTS[a][night ? 'night' : 'day'] } : base;
    const r = document.documentElement;
    for (const [k, v] of Object.entries(c)) r.style.setProperty(`--${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, v);
    r.style.setProperty('--font-ui', t.fonts.ui);
    r.style.setProperty('--font-num', t.fonts.num);
    r.dataset.theme = t.id;
    r.dataset.mode = night ? 'night' : 'day';
    try { root.localStorage.setItem(LAST_KEY, JSON.stringify([t.id, !!night])); } catch (_) {}
    return { theme: t, colors: c, map: night ? t.map.night : t.map.day };
  }

  // The last look, put back as soon as this file loads (in <head>), so a page change at night doesn't flash the day colours
  // before the page's own script picks the theme (review 2026-10-28).
  const LAST_KEY = 'apex.lastLook';
  function last() { try { const l = JSON.parse(root.localStorage.getItem(LAST_KEY)); return Array.isArray(l) ? { id: l[0], night: !!l[1] } : null; } catch (_) { return null; } }
  { const l = last(); if (l) apply(l.id, l.night); }

  root.ApexThemes = { THEMES, ACCENTS, get, apply, accent, setAccent, last };
})(window);
