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
      id: 'roadbook', label: 'Roadbook', tag: 'A', blurb: 'Paper and red ink.', pro: false,
      about: 'Paper, ink and one red pen. Reads in direct sun; night turns the page over after sunset.',
      // the theme's co-driver (REVIEW.md 4.4): who reads the notes comes with the look
      voice: { id: 'marguerite', name: 'Marguerite', who: 'Calm, exact, a step ahead.', sample: 'Left four, tightens. Long. Care.' },
      fonts: FONT, cluster: 'dials', notes: 'roadbook', gauge: 'printed',
      renderers: { dial: 'printed', meter: 'gball', strip: 'roadbook' },   // the theme contract's three renderers (theme_contract.js)
      day: {
        stage: '#F2EBDD', ink: '#1C1A17', dim: '#6A6255', route: '#C8102E', routeCasing: '#F2EBDD',
        panel: '#EDE4D3', panelInk: '#1C1A17', panelDim: '#6A6255', rule: '#1C1A17', accent: '#C8102E',
        signal: '#C8102E', amber: '#8A5810', calm: '#1C1A17',
        face: '#F6F0E4', faceInk: '#1C1A17', faceDim: '#736A5A', hair: '#CFC4AE', gain: '#2E6B3F'
      },
      night: {
        stage: '#1A1814', ink: '#EDE4D3', dim: '#9A9080', route: '#E65252', routeCasing: '#1A1814',
        panel: '#151310', panelInk: '#EDE4D3', panelDim: '#8C8373', rule: '#EDE4D3', accent: '#E65252',
        signal: '#E65252', amber: '#D9A24A', calm: '#EDE4D3',
        face: '#1A1814', faceInk: '#EDE4D3', faceDim: '#968C7B', hair: '#2E2A23', gain: '#6FBF7F'
      },
      map: {
        day: { bg: '#F2EBDD', water: '#CFD8D3', waterLine: '#7F9A9A', land: '#EFE7D8', wood: '#E3DCC5', road: '#FFFFFF', roadMinor: '#FFFFFF', casing: '#1C1A17', label: '#1C1A17', halo: '#F2EBDD', boundary: '#8C8373', contour: '#8B6B4A', shadow: '#A08F6E', highlight: '#FFFFFF', accentShade: '#B59E78' },
        night: { bg: '#1B1712', water: '#10161A', waterLine: '#26343A', land: '#1D1914', wood: '#1F1C15', road: '#36312A', roadMinor: '#2B2721', casing: '#A99F8C', label: '#A89E8C', halo: '#1B1712', boundary: '#332F28', contour: '#3A3126', shadow: '#080706', highlight: '#28231C', accentShade: '#14120E' }
      }
    },
    // Tapedeck (Pro, REVIEW.md 4.1): a late-90s head unit. Near-black glass, blue-green VFD glow, amber for what changes
    // what you do, seven-segment speed, bar meters that are instruments (live surface; brake and turn), and Kit, a
    // dot-matrix fox who leans into the corner being called. The panel is always dark: day and night are the same glass.
    tapedeck: {
      id: 'tapedeck', label: 'Tapedeck', tag: 'B', blurb: 'A late-90s head unit.', pro: true,
      about: 'A late-90s head unit: blue-green VFD, seven-segment speed, spectrum bars that show the road surface, and Kit, who leans into every corner.',
      voice: { id: 'kit', name: 'Kit', who: 'Quick, dry, a little cheeky, never silly.', sample: 'Left four, tightens. Easy in, late out.' },
      fonts: { ui: '"SF Mono", "Menlo", "Roboto Mono", "Consolas", monospace', num: '"SF Mono", "Menlo", "Roboto Mono", "Consolas", monospace' },
      cluster: 'dials', notes: 'roadbook', gauge: 'vfd', mascot: 'kit',
      renderers: { dial: 'sevenseg', meter: 'bars', strip: 'vfd' },
      day: {
        stage: '#0B0E0D', ink: '#7DF5DE', dim: '#5FB3A5', route: '#FFB347', routeCasing: '#0B0E0D',
        panel: '#0A0C0B', panelInk: '#7DF5DE', panelDim: '#5FB3A5', rule: '#2A5A52', accent: '#FFB347',
        signal: '#FF8A4D', amber: '#FFB347', calm: '#7DF5DE',
        face: '#0A0C0B', faceInk: '#7DF5DE', faceDim: '#5FB3A5', hair: '#16302B', gain: '#7DF5DE'
      },
      night: {
        stage: '#080A09', ink: '#6FE3CD', dim: '#55A396', route: '#F5A63C', routeCasing: '#080A09',
        panel: '#070908', panelInk: '#6FE3CD', panelDim: '#55A396', rule: '#24504A', accent: '#F5A63C',
        signal: '#FF8A4D', amber: '#F5A63C', calm: '#6FE3CD',
        face: '#070908', faceInk: '#6FE3CD', faceDim: '#55A396', hair: '#132925', gain: '#6FE3CD'
      },
      map: {
        day: { bg: '#0B0E0D', water: '#0E1A1C', waterLine: '#1F4A48', land: '#0C100F', wood: '#0D1211', road: '#0F1615', roadMinor: '#0D1312', casing: '#3FA595', label: '#5FB3A5', halo: '#0B0E0D', boundary: '#1D3B36', contour: '#16302B', shadow: '#050606', highlight: '#13201E', accentShade: '#0A0D0C' },
        night: { bg: '#080A09', water: '#0B1517', waterLine: '#1A3E3C', land: '#090C0B', wood: '#0A0F0E', road: '#0D1312', roadMinor: '#0B100F', casing: '#2E8577', label: '#4C9387', halo: '#080A09', boundary: '#18322E', contour: '#122824', shadow: '#040505', highlight: '#101A18', accentShade: '#080B0A' }
      }
    }
  };
  function get(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : THEMES.roadbook; }   // unknown or retired: the road book

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
