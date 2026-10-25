// ApexThemes — cockpit themes as first-class components.
//
// A theme owns: colour tokens (day + night), typography, the basemap palette, which
// instrument cluster renders the binnacle, and how pace notes are drawn. The app never
// hardcodes a colour; it asks the active theme.
//
//   roadbook   (A) FIA rally roadbook: ink on paper, tulip pace notes, printed gauges
//   instrument (B) instrument-maker precision: flat graphite, engraved linework, one accent
//   telemetry  (C) race telemetry: dense, colour-coded, numeric, built for glance reading
//   stage      (AB, default) instrument cluster + roadbook tulips over the topo stage map
(function (root) {
  'use strict';

  const FONTS = {
    roadbook: { ui: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', num: '"Barlow Condensed", "Arial Narrow", sans-serif' },
    instrument: { ui: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', num: '"Barlow Condensed", "Arial Narrow", sans-serif' },
    telemetry: { ui: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif', num: '"IBM Plex Mono", ui-monospace, monospace' }
  };

  const THEMES = {
    stage: {
      id: 'stage', label: 'Instruments', tag: 'AB', blurb: 'Dark dash over the map.',
      fonts: FONTS.instrument, cluster: 'dials', notes: 'tulip', gauge: 'engraved',
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
      fonts: FONTS.roadbook, cluster: 'dials', notes: 'roadbook', gauge: 'printed',
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
    },

    instrument: {
      id: 'instrument', label: 'Instrument', tag: 'B', blurb: 'Flat graphite, engraved-line precision and a single signal accent.',
      fonts: FONTS.instrument, cluster: 'dials', notes: 'type', gauge: 'engraved',
      day: {
        stage: '#ECEAE6', ink: '#161616', dim: '#77736C', route: '#FF5A1F', routeCasing: '#ECEAE6',
        panel: '#161616', panelInk: '#F2F0EC', panelDim: '#8A8780', rule: '#2C2C2C', accent: '#FF5A1F',
        signal: '#FF5A1F', amber: '#F2B33D', calm: '#FFFFFF',
        face: '#101010', faceInk: '#F2F0EC', faceDim: '#55534F', hair: '#2C2C2C', gain: '#6FBF7F'
      },
      night: {
        stage: '#141414', ink: '#F2F0EC', dim: '#8A8780', route: '#FF5A1F', routeCasing: '#141414',
        panel: '#0D0D0D', panelInk: '#F2F0EC', panelDim: '#7A7772', rule: '#232323', accent: '#FF5A1F',
        signal: '#FF5A1F', amber: '#F2B33D', calm: '#F2F0EC',
        face: '#0A0A0A', faceInk: '#F2F0EC', faceDim: '#45433F', hair: '#232323', gain: '#6FBF7F'
      },
      map: {
        day: { bg: '#ECEAE6', water: '#CFD6DA', waterLine: '#A9B4BA', land: '#E4E1DC', wood: '#DADBD0', road: '#FFFFFF', roadMinor: '#FBFBFA', casing: '#C2BEB6', label: '#3A3936', halo: '#ECEAE6', boundary: '#C9C5BD', contour: '#9A968F', shadow: '#8E8A82', highlight: '#FFFFFF', accentShade: '#B4B0A8' },
        night: { bg: '#141414', water: '#0E1114', waterLine: '#1E2328', land: '#171717', wood: '#181917', road: '#3B3B3B', roadMinor: '#2A2A2A', casing: '#0D0D0D', label: '#A9A6A0', halo: '#141414', boundary: '#2A2A2A', contour: '#2E2E2E', shadow: '#050505', highlight: '#222222', accentShade: '#0B0B0B' }
      }
    },

    telemetry: {
      id: 'telemetry', label: 'Telemetry', tag: 'C', blurb: 'Race-dash density: numbers first, colour-coded bars, pace lights.',
      fonts: FONTS.telemetry, cluster: 'telemetry', notes: 'telemetry', gauge: 'bars',
      day: {
        stage: '#0B0D0F', ink: '#E8ECEF', dim: '#7D868F', route: '#E8ECEF', routeCasing: '#0B0D0F',
        panel: '#07090A', panelInk: '#E8ECEF', panelDim: '#6B747C', rule: '#1C2126', accent: '#F2B33D',
        signal: '#F85149', amber: '#F2B33D', calm: '#3FB950',
        face: '#0B0D0F', faceInk: '#E8ECEF', faceDim: '#3A424A', hair: '#1C2126', gain: '#3FB950'
      },
      map: {
        day: { bg: '#0B0D0F', water: '#0D1A22', waterLine: '#1B2C36', land: '#0E1114', wood: '#0F1311', road: '#2A2F35', roadMinor: '#1D2126', casing: '#07090A', label: '#8A939B', halo: '#0B0D0F', boundary: '#1C2126', contour: '#1E252C', shadow: '#000000', highlight: '#1A2026', accentShade: '#05070A' }
      }
    }
  };
  THEMES.telemetry.night = THEMES.telemetry.day;      // a race dash is already a night display
  THEMES.telemetry.map.night = THEMES.telemetry.map.day;

  const ORDER = ['roadbook', 'stage'];          // the picker offers two looks; instrument/telemetry remain loadable from saved prefs

  function get(id) { return THEMES[id] || THEMES.roadbook; }

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
