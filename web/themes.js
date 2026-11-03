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
      // the theme's co-driver (REVIEW.md 4.4): who reads the notes comes with the look. What the voice says, and the line its
      // card quotes, are the pack's (web/voice_lines.js PACKS, U-113), so a card never quotes a line the voice doesn't say.
      voice: { id: 'marguerite', name: 'Marguerite', who: 'Calm, exact, a step ahead.' },
      fonts: FONT, cluster: 'dials', notes: 'roadbook', gauge: 'printed',
      renderers: { dial: 'printed', meter: 'gball', strip: 'roadbook' },   // the theme contract's three renderers (theme_contract.js)
      day: {
        // panel round 2 (IN-3, PR-2): the route is drawn in ink; the one red pen marks only what needs acting on (signal)
        stage: '#F2EBDD', ink: '#1C1A17', dim: '#6A6255', route: '#1C1A17', routeCasing: '#F2EBDD',
        panel: '#EDE4D3', panelInk: '#1C1A17', panelDim: '#6A6255', rule: '#1C1A17', accent: '#C8102E',
        signal: '#C8102E', amber: '#8A5810', calm: '#1C1A17',
        face: '#F6F0E4', faceInk: '#1C1A17', faceDim: '#665E51', hair: '#CFC4AE', gain: '#2E6B3F'   // faceDim: 5.1:1 on the paper (contrast.md had 4.22)
      },
      night: {
        stage: '#1A1814', ink: '#EDE4D3', dim: '#9A9080', route: '#EDE4D3', routeCasing: '#1A1814',
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
      voice: { id: 'kit', name: 'Kit', who: 'Quick, dry, a little cheeky, never silly.' },
      fonts: { ui: '"SF Mono", "Menlo", "Roboto Mono", "Consolas", monospace', num: '"SF Mono", "Menlo", "Roboto Mono", "Consolas", monospace' },
      cluster: 'dials', notes: 'roadbook', gauge: 'vfd', mascot: 'kit',
      renderers: { dial: 'sevenseg', meter: 'bars', strip: 'vfd' },
      day: {
        stage: '#0B0E0D', ink: '#7DF5DE', dim: '#5FB3A5', route: '#FFB347', routeCasing: '#0B0E0D',
        panel: '#0A0C0B', panelInk: '#7DF5DE', panelDim: '#5FB3A5', rule: '#2A5A52', accent: '#FFB347',
        signal: '#FF4D63', amber: '#FFB347', calm: '#7DF5DE',   // panel round 2: act now is red, apart from the route's amber
        face: '#0A0C0B', faceInk: '#7DF5DE', faceDim: '#5FB3A5', hair: '#16302B', gain: '#7DF5DE'
      },
      night: {
        stage: '#080A09', ink: '#6FE3CD', dim: '#55A396', route: '#F5A63C', routeCasing: '#080A09',
        panel: '#070908', panelInk: '#6FE3CD', panelDim: '#55A396', rule: '#24504A', accent: '#F5A63C',
        signal: '#F2475E', amber: '#F5A63C', calm: '#6FE3CD',
        face: '#070908', faceInk: '#6FE3CD', faceDim: '#55A396', hair: '#132925', gain: '#6FE3CD'
      },
      map: {
        day: { bg: '#0B0E0D', water: '#0E1A1C', waterLine: '#1F4A48', land: '#0C100F', wood: '#0D1211', road: '#0F1615', roadMinor: '#0D1312', casing: '#3FA595', label: '#5FB3A5', halo: '#0B0E0D', boundary: '#1D3B36', contour: '#16302B', shadow: '#050606', highlight: '#13201E', accentShade: '#0A0D0C' },
        night: { bg: '#080A09', water: '#0B1517', waterLine: '#1A3E3C', land: '#090C0B', wood: '#0A0F0E', road: '#0D1312', roadMinor: '#0B100F', casing: '#2E8577', label: '#4C9387', halo: '#080A09', boundary: '#18322E', contour: '#122824', shadow: '#040505', highlight: '#101A18', accentShade: '#080B0A' }
      }
    },
    // Billet (Pro, REVIEW.md 4.1): machined aluminium. A brushed graphite panel, knurled bezels, black gauge faces, red
    // glow on the needles and the speed, a white Limit sign exactly as on the road. The energy is the glow against the
    // metal; the layout is still three things. Its needle overshoots a touch and settles, like a real one.
    billet: {
      id: 'billet', label: 'Billet', tag: 'C', blurb: 'Machined metal, backlit gauges.', pro: true,
      about: 'Machined aluminium, knurled bezels and backlit black gauge faces; red only when it means slow down. Quiet, precise, all business.',
      voice: { id: 'hale', name: 'Hale', who: 'Low, even, zero drama. A test driver reading a card.' },
      fonts: FONT, cluster: 'dials', notes: 'roadbook', gauge: 'printed', finish: 'metal',
      renderers: { dial: 'bezel', meter: 'bezelg', strip: 'roadbook' },
      day: {
        stage: '#1C1D1F', ink: '#ECE6DA', dim: '#A39E93', route: '#ECE6DA', routeCasing: '#1C1D1F',   // panel round 2: red is the warning's alone
        panel: '#1C1D1F', panelInk: '#ECE6DA', panelDim: '#A39E93', rule: '#55575C', accent: '#FF5A4C',
        signal: '#FF5A4C', amber: '#E8A33A', calm: '#ECE6DA',
        face: '#0D0D0E', faceInk: '#ECE6DA', faceDim: '#9A958B', hair: '#2C2D30', gain: '#8FD18F'
      },
      night: {
        stage: '#151618', ink: '#E2DCD0', dim: '#9A958B', route: '#E2DCD0', routeCasing: '#151618',
        panel: '#151618', panelInk: '#E2DCD0', panelDim: '#9A958B', rule: '#4A4C51', accent: '#FF5A4C',
        signal: '#FF5A4C', amber: '#E0A040', calm: '#E2DCD0',
        face: '#0A0A0B', faceInk: '#E2DCD0', faceDim: '#96918A', hair: '#26272A', gain: '#8FD18F'
      },
      map: {
        day: { bg: '#1E1F21', water: '#16191C', waterLine: '#3A4048', land: '#202123', wood: '#222326', road: '#2B2C2F', roadMinor: '#262729', casing: '#CFC9BD', label: '#B8B2A6', halo: '#1E1F21', boundary: '#3A3B3F', contour: '#303135', shadow: '#0B0B0C', highlight: '#2E2F33', accentShade: '#151617' },
        night: { bg: '#161719', water: '#121417', waterLine: '#30353C', land: '#18191B', wood: '#1A1B1D', road: '#232426', roadMinor: '#1F2022', casing: '#A9A398', label: '#9C968B', halo: '#161719', boundary: '#323336', contour: '#28292C', shadow: '#080809', highlight: '#252629', accentShade: '#111213' }
      }
    }
  };
  function get(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : THEMES.roadbook; }   // unknown or retired: the road book

  // Private themes (migration 0044 theme_grants): a theme granted to an account by hand is not in this file. The server
  // sends its definition in GET /api/me only to an account it is granted to (backend/src/private_themes.json); grant()
  // takes that list, keeps only well-formed entries that pass the theme contract, and puts them in THEMES marked
  // `granted`. The list is kept on the phone so the look survives an offline start; signed out, or a grant gone, and the
  // next /api/me empties it (cockpit.js applyThemeGrants), and the page falls back to the road book.
  const BUILT_IN = new Set(Object.keys(THEMES));
  const GRANT_KEY = 'apex.themeGrants';
  const HEX = /^#[0-9a-f]{6}$/i;
  const TOKENS = ['stage', 'ink', 'dim', 'route', 'routeCasing', 'panel', 'panelInk', 'panelDim', 'rule', 'accent', 'signal', 'amber', 'calm', 'face', 'faceInk', 'faceDim', 'hair', 'gain'];
  const MAP_KEYS = ['bg', 'water', 'waterLine', 'land', 'wood', 'road', 'roadMinor', 'casing', 'label', 'halo', 'boundary', 'contour', 'shadow', 'highlight', 'accentShade'];
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const colours = (o, keys) => { if (!o || typeof o !== 'object') return null; const out = {}; for (const k of keys) { if (!HEX.test(o[k] || '')) return null; out[k] = o[k]; } return out; };
  // The renderers this build can draw (theme_contract.js RENDERERS lists the same; tests/test_themes.py keeps them equal).
  // A server can be newer than the app on the phone (it deploys at once; a TestFlight build follows): a renderer this build
  // doesn't know, or the car's cluster without its data, falls back to the printed dial, the g-ball and the road book, so a
  // granted theme is drawn plainly instead of vanishing (2026-11-03: the car themes disappeared on 572.1 for exactly this).
  const KNOWN_RENDERERS = { dial: ['printed', 'sevenseg', 'bezel', 'car'], meter: ['gball', 'bars', 'bezelg', 'car'], strip: ['roadbook', 'vfd'] };
  const FALLBACK_RENDERER = { dial: 'printed', meter: 'gball', strip: 'roadbook' };
  function renderersFor(r, car) {
    const out = {};
    for (const slot of Object.keys(FALLBACK_RENDERER)) {
      const want = str(r && r[slot], 20);
      out[slot] = want && KNOWN_RENDERERS[slot].includes(want) && (want !== 'car' || car) ? want : FALLBACK_RENDERER[slot];
    }
    return out;
  }
  /** A server's theme definition as a theme of this file's shape, or null: only known keys, colours as #rrggbb. Pure. */
  function fromGrant(d) {
    if (!d || typeof d !== 'object' || !/^[a-z]{1,20}$/.test(d.id || '') || BUILT_IN.has(d.id)) return null;
    const day = colours(d.day, TOKENS), night = colours(d.night, TOKENS), mday = colours(d.map && d.map.day, MAP_KEYS), mnight = colours(d.map && d.map.night, MAP_KEYS);
    const r = d.renderers || {}, v = d.voice || {}, label = str(d.label, 24);
    if (!day || !night || !mday || !mnight || !label) return null;
    const car = carFrom(d.car);
    return { id: d.id, label, tag: str(d.tag, 2) || '', blurb: str(d.blurb, 80) || '', about: str(d.about, 400) || '', pro: false, granted: true,
      voice: str(v.id, 20) ? { id: str(v.id, 20), name: str(v.name, 24) || '', who: str(v.who, 120) || '' } : null,
      fonts: car && NUMERALS[car.numerals] ? { ...FONT, dial: NUMERALS[car.numerals] } : FONT, cluster: 'dials', notes: 'roadbook', gauge: d.gauge === 'vfd' ? 'vfd' : 'printed',
      renderers: renderersFor(r, car), day, night, map: { day: mday, night: mnight },
      ...(car ? { car, sounds: car.sounds } : {}) };
  }

  // A car's own look (theme.car, the private themes): its cluster as data for instruments.js carGauge, its top-down outline for
  // the arrow on the map, the Garage card and the share card, its paint, needles, chrome and finish, and its key and pre-call
  // sounds. Only known keys pass, numbers in range, words from short lists: the server's file is data, never code or markup.
  const NUMERALS = {   // the dial's numerals: a style the car's has, from the phone's own faces, else the bundled condensed
    rounded: '"Arial Rounded MT Bold", "Varela Round", "Barlow Condensed", sans-serif',
    din: '"DIN Alternate", "DIN 2014", "Bahnschrift", "Barlow Condensed", sans-serif',
    condensed: '"Barlow Condensed", "Arial Narrow", sans-serif',
    sans: '"Helvetica Neue", Arial, "Inter Tight", sans-serif',
  };
  const FINISHES = ['metalgrain', 'carbon', 'cloth'];
  const PART_KINDS = ['face', 'ring', 'pod', 'disc', 'box', 'text', 'scale', 'marks', 'digital', 'bank', 'lamp', 'mid'];
  const READS = ['speed', 'speedAlt', 'latG', 'brakeG', 'bank', 'grip', 'rpm', 'fuel', 'temp', 'torque', 'volts', 'mpg'];   // instruments.js CAR_READS
  const PART_NUM = ['cx', 'cy', 'r', 'w', 'h', 'x', 'y', 'rx', 'a0', 'a1', 'min', 'max', 'major', 'minor', 'label', 'labelR', 'labelSize', 'labelDiv',
    'majorLen', 'minorLen', 'majorW', 'minorW', 'arc', 'redW', 'pegs', 'peg0', 'rest', 'lines', 'fit', 'labelMin', 'labelMax'];
  const n = (v, lo = -1000, hi = 1000) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const nums = (o, keys) => { const out = {}; if (o && typeof o === 'object') for (const k of keys) { const x = n(o[k]); if (x != null) out[k] = x; } return out; };
  const pair = (o) => (o && HEX.test(o.day || '') && HEX.test(o.night || '') ? { day: o.day, night: o.night } : null);
  const WORD = /^[A-Za-z0-9 .+\-\/°{}]{1,16}$/;
  function partFrom(p) {
    if (!p || typeof p !== 'object' || !PART_KINDS.includes(p.k)) return null;
    const out = { k: p.k, ...nums(p, PART_NUM) };
    if (p.reads !== undefined) { if (!READS.includes(p.reads)) return null; out.reads = p.reads; }
    for (const b of ['deep', 'small', 'invert', 'lcd']) if (p[b] === true) out[b] = true;
    if (typeof p.t === 'string' && WORD.test(p.t)) out.t = p.t; else if (out.k === 'text') return null;   // a word, or no part
    if (p.cls === 'tiny') out.cls = 'tiny';
    if (['start', 'middle', 'end'].includes(p.anchor)) out.anchor = p.anchor;
    if (Array.isArray(p.red) && p.red.length === 2 && p.red.every((x) => n(x) != null)) out.red = p.red.slice();
    if (Array.isArray(p.ends)) out.ends = p.ends.slice(0, 4).map((e) => (e && n(e.v) != null && typeof e.t === 'string' && WORD.test(e.t) ? { v: e.v, t: e.t, ...nums(e, ['r']) } : null)).filter(Boolean);
    if (p.needle && typeof p.needle === 'object') out.needle = { ...nums(p.needle, ['len', 'tail', 'w', 'hub']), ...(p.needle.style === 'taper' ? { style: 'taper' } : {}), ...(p.needle.spring === true ? { spring: true } : {}) };
    for (const u of ['mph', 'kmh']) if (p[u] && typeof p[u] === 'object') out[u] = nums(p[u], PART_NUM);
    if (out.k === 'scale' && !(out.reads && out.max > out.min && (out.major > 0) && out.a1 !== out.a0)) {
      const m = { ...out, ...(out.mph || {}) };                      // a speed scale may carry its numbers per unit only
      if (!(out.reads && m.max > m.min && m.major > 0)) return null;
    }
    return out;
  }
  const gaugeFrom = (g) => { const parts = g && Array.isArray(g.parts) ? g.parts.slice(0, 48).map(partFrom).filter(Boolean) : []; return parts.length ? { parts, ...(['tach', 'grip'].includes(g.explain) ? { explain: g.explain } : {}), ...(n(g.vb, 80, 200) != null ? { vb: g.vb } : {}), ...(n(g.vw, 80, 400) != null ? { vw: g.vw } : {}) } : null; };
  const poly = (a) => (Array.isArray(a) && a.length >= 3 && a.length <= 120 && a.every((q) => Array.isArray(q) && q.length === 2 && n(q[0], 0, 200) != null && n(q[1], 0, 200) != null) ? a.map((q) => [q[0], q[1]]) : null);
  const VOICE_TYPES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
  const voices = (a) => (Array.isArray(a) ? a.slice(0, 4).map((v) => (v && VOICE_TYPES.includes(v.type) && n(v.f, 20, 12000) != null && n(v.at, 0, 1) != null && n(v.dur, 0.003, 0.5) != null && n(v.gain, 0.0005, 0.2) != null
    ? { type: v.type, f: v.f, at: v.at, dur: v.dur, gain: v.gain, ...(n(v.q, 0.1, 20) != null ? { q: v.q } : {}) } : null)).filter(Boolean) : []);
  /** The car part of a server's theme, cleaned, or null. Pure. */
  function carFrom(c) {
    if (!c || typeof c !== 'object') return null;
    const s = c.silhouette || {}, body = poly(s.body), w = n(s.w, 1, 200), h = n(s.h, 1, 200);
    const out = {
      model: str(c.model, 60) || '', paint: c.paint && HEX.test(c.paint.hex || '') ? { name: str(c.paint.name, 40) || '', hex: c.paint.hex } : null,
      finish: FINISHES.includes(c.finish) ? c.finish : null, numerals: NUMERALS[c.numerals] ? c.numerals : null,
      needle: pair(c.needle), ring: pair(c.ring), disc: pair(c.disc), lamp: pair(c.lamp), lcd: pair(c.lcd), lcdInk: pair(c.lcdInk), hub: pair(c.hub),
      dial: gaugeFrom(c.dial), meter: gaugeFrom(c.meter),
      silhouette: body && w && h ? { w, h, body, glass: poly(s.glass), roof: poly(s.roof), lamps: Array.isArray(s.lamps) ? s.lamps.slice(0, 6).map(poly).filter(Boolean) : [] } : null,
      sounds: c.sounds && typeof c.sounds === 'object' ? { key: voices(c.sounds.key), pre: voices(c.sounds.pre) } : null,
    };
    return out;
  }

  /** The car's top-down outline, nose up, as SVG markup in a w x h box (the arrow on the map, the Garage card). Its paint,
   *  the glass darker, the outline in `edge` (the panel's ink, so it reads on the map). '' without a car. Pure. */
  function carSVG(theme, edge, w, h, opts = {}) {
    const car = theme && theme.car, s = car && car.silhouette;
    if (!s || !car.paint) return '';
    const W = opts.rotate ? h : w, H = opts.rotate ? w : h;           // rotate: lying nose right, in a w x h box
    const k = Math.min(W / s.w, H / s.h), ox = (W - s.w * k) / 2, oy = (H - s.h * k) / 2;
    const pts = (a) => a.map(([x, y]) => `${(ox + x * k).toFixed(1)},${(oy + y * k).toFixed(1)}`).join(' ');
    const ink = HEX.test(edge || '') ? edge : '#111111', glass = opts.glass && HEX.test(opts.glass) ? opts.glass : '#1A1D22';
    const sw = (opts.stroke || 1.4).toFixed(2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`
      + (opts.rotate ? `<g transform="translate(${w} 0) rotate(90)">` : '')
      + `<polygon points="${pts(s.body)}" fill="${car.paint.hex}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`
      + (s.glass ? `<polygon points="${pts(s.glass)}" fill="${glass}"/>` : '')
      + (s.roof ? `<polygon points="${pts(s.roof)}" fill="${car.paint.hex}"/>` : '')
      + s.lamps.map((l) => `<polygon points="${pts(l)}" fill="#F2F4F6" opacity="0.9"/>`).join('')
      + (opts.rotate ? '</g>' : '') + '</svg>';
  }
  /** The granted themes, from /api/me: replaces the last list. contract: web/theme_contract.js, when loaded (a theme that
   *  breaks it is never shown). True when the set of granted themes changed. */
  function grant(defs, contract) {
    const list = (Array.isArray(defs) ? defs : []).map(fromGrant).filter((t) => t && (!contract || contract.check(t).length === 0));
    const before = Object.keys(THEMES).filter((k) => THEMES[k].granted).sort().join();
    for (const k of Object.keys(THEMES)) if (THEMES[k].granted) delete THEMES[k];
    for (const t of list) THEMES[t.id] = t;
    try { if (list.length) root.localStorage.setItem(GRANT_KEY, JSON.stringify(defs.filter((d) => list.some((t) => t.id === (d && d.id))))); else root.localStorage.removeItem(GRANT_KEY); } catch (_) {}
    return list.map((t) => t.id).sort().join() !== before;
  }
  /** The ids granted now. */
  const granted = () => Object.keys(THEMES).filter((k) => THEMES[k].granted);
  try { const g = JSON.parse(root.localStorage.getItem(GRANT_KEY) || 'null'); if (Array.isArray(g)) for (const t of g.map(fromGrant)) if (t) THEMES[t.id] = t; } catch (_) {}

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
    // a car's own look (theme.car): its needles, chrome, inner dial, lamp and paint as tokens, its finish on the binnacle
    const car = t.car, m = night ? 'night' : 'day';
    for (const [k, v] of [['--car-needle', car && car.needle && car.needle[m]], ['--car-ring', car && car.ring && car.ring[m]], ['--car-disc', car && car.disc && car.disc[m]],
      ['--car-lamp', car && car.lamp && car.lamp[m]], ['--car-lcd', car && car.lcd && car.lcd[m]], ['--car-hub', car && car.hub && car.hub[m]], ['--car-lcd-ink', car && car.lcdInk && car.lcdInk[m]], ['--car-paint', car && car.paint && car.paint.hex], ['--font-dial', t.fonts.dial]]) { if (v) r.style.setProperty(k, v); else if (r.style.removeProperty) r.style.removeProperty(k); }
    if (car && car.finish) r.dataset.finish = car.finish; else delete r.dataset.finish;
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

  root.ApexThemes = { THEMES, ACCENTS, get, apply, accent, setAccent, last, grant, granted, fromGrant, carFrom, carSVG, GRANT_KEY, KNOWN_RENDERERS, renderersFor };
})(window);
