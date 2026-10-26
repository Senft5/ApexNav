// ApexThemes — cockpit themes as first-class components.
//
// A theme owns: colour tokens (day + night), typography, the basemap palette, which
// cluster renders the binnacle, and how pace notes are drawn. The app never
// hardcodes a colour; it asks the active theme.
//
//   roadbook   (A) FIA rally roadbook: ink on paper, tulip pace notes, printed gauges
//   stage      (AB) instrument cluster + roadbook tulips over the topo stage map
(function (root) {
  'use strict';

  const FONT = { ui: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', num: '"Barlow Condensed", "Arial Narrow", sans-serif' };

  const THEMES = {
    stage: {
      id: 'stage', label: 'Instruments', tag: 'AB', blurb: 'Dark dash over the map.',
      fonts: FONT, cluster: 'dials', notes: 'tulip', gauge: 'engraved',
      day: {
        stage: '#F4EFE6', ink: '#1E1D1A', dim: '#7A7266', route: '#B5532B', routeCasing: '#F4EFE6',
        panel: '#141413', panelInk: '#ECE6DA', panelDim: '#8D867A', rule: '#2E2C28', accent: '#E8743B',
        signal: '#D9411E', amber: '#E89B3C', calm: '#FFF8EA',
        face: '#0F0F0E', faceInk: '#ECE6DA', faceDim: '#5E5A52', hair: '#2E2C28', gain: '#6FBF7F'
      },
      night: {
        stage: '#111210', ink: '#EAE3D2', dim: '#8E8676', route: '#E89B3C', routeCasing: '#111210',
        panel: '#0C0C0B', panelInk: '#EAE3D2', panelDim: '#7F796D', rule: '#24231F', accent: '#E89B3C',
        signal: '#D9411E', amber: '#E89B3C', calm: '#EAE3D2',
        face: '#0A0A09', faceInk: '#EAE3D2', faceDim: '#4E4A43', hair: '#24231F', gain: '#6FBF7F'
      },
      map: {
        day: { bg: '#F4EFE6', water: '#C9D2CC', waterLine: '#9FB0AA', land: '#E9E2D2', wood: '#DCD8BF', road: '#FFFDF8', roadMinor: '#FFFFFF', casing: '#B9AE98', label: '#3B3833', halo: '#F4EFE6', boundary: '#C8BEA9', contour: '#3B3833', shadow: '#6B6B3A', highlight: '#FBF8F0', accentShade: '#8A8455' },
        night: { bg: '#111210', water: '#0B0E10', waterLine: '#1A2228', land: '#141512', wood: '#151712', road: '#EAE3D2', roadMinor: '#4A463E', casing: '#111210', label: '#CFC6B2', halo: '#111210', boundary: '#2F2C27', contour: '#3A372F', shadow: '#050504', highlight: '#1E1D19', accentShade: '#0B0B0A' }
      }
    },

    roadbook: {
      id: 'roadbook', label: 'Road book', tag: 'A', blurb: 'Paper and red ink.',
      fonts: FONT, cluster: 'dials', notes: 'roadbook', gauge: 'printed',
      day: {
        stage: '#F2EBDD', ink: '#1C1A17', dim: '#6F675A', route: '#C8102E', routeCasing: '#F2EBDD',
        panel: '#EDE4D3', panelInk: '#1C1A17', panelDim: '#6F675A', rule: '#1C1A17', accent: '#C8102E',
        signal: '#C8102E', amber: '#B8741A', calm: '#1C1A17',
        face: '#F6F0E4', faceInk: '#1C1A17', faceDim: '#9A9080', hair: '#CFC4AE', gain: '#2E6B3F'
      },
      night: {
        stage: '#1A1814', ink: '#EDE4D3', dim: '#9A9080', route: '#E24A4A', routeCasing: '#1A1814',
        panel: '#151310', panelInk: '#EDE4D3', panelDim: '#8C8373', rule: '#EDE4D3', accent: '#E24A4A',
        signal: '#E24A4A', amber: '#D9A24A', calm: '#EDE4D3',
        face: '#1A1814', faceInk: '#EDE4D3', faceDim: '#6A6255', hair: '#2E2A23', gain: '#6FBF7F'
      },
      map: {
        day: { bg: '#F2EBDD', water: '#CFD8D3', waterLine: '#7F9A9A', land: '#EFE7D8', wood: '#E3DCC5', road: '#FFFFFF', roadMinor: '#FFFFFF', casing: '#1C1A17', label: '#1C1A17', halo: '#F2EBDD', boundary: '#8C8373', contour: '#8B6B4A', shadow: '#A08F6E', highlight: '#FFFFFF', accentShade: '#B59E78' },
        night: { bg: '#1A1814', water: '#10161A', waterLine: '#2A3A40', land: '#1C1A16', wood: '#1E1D17', road: '#3A362E', roadMinor: '#2E2B25', casing: '#EDE4D3', label: '#D8CFBE', halo: '#1A1814', boundary: '#3A362E', contour: '#4E4230', shadow: '#080706', highlight: '#2A2620', accentShade: '#14120E' }
      }
    }
  };
  const ORDER = ['roadbook', 'stage'];

  // Saved prefs from before the Instrument and Telemetry themes were removed land on Stage.
  const RETIRED = { instrument: 'stage', telemetry: 'stage' };

  function get(id) { return THEMES[RETIRED[id] || id] || THEMES.roadbook; }

  function apply(id, night) {
    const t = get(id);
    const c = night ? t.night : t.day;
    const r = document.documentElement;
    for (const [k, v] of Object.entries(c)) r.style.setProperty(`--${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, v);
    r.style.setProperty('--font-ui', t.fonts.ui);
    r.style.setProperty('--font-num', t.fonts.num);
    r.dataset.theme = t.id;
    r.dataset.mode = night ? 'night' : 'day';
    return { theme: t, colors: c, map: night ? t.map.night : t.map.day };
  }

  root.ApexThemes = { THEMES, ORDER, get, apply };
})(window);
