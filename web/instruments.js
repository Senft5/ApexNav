// ApexInstruments — Road book renderers for the binnacle and pace-note strip.
// Flat vector only: precision comes from linework and type, never from fake materials.
//
//   mountCluster(el, theme) -> { update(d) }   d = { speedMph, paceMph, sightMph, limitMph,
//                                                   latG, lonG, camberDeg, tripMi, totalMi, sector }
//   renderNotes(el, theme, notes)               notes = [{ type, code, call, sub, dist, unit,   notes.words: 'plain' | 'rally'
//                                                          dir, severity, turnRad, mods }]
//   tulipSVG(note, ink, accent)                 roadbook tulip diagram (string)
//   lockup(call, mods)                          the call split for the strip: { head, tail: [{ text, warn }] } (pure)
//   stripCode(note, words)                      the short code the strip's next cells print ("R3", "TIGHT R", "KEEP L") (pure)
(function (root) {
  'use strict';
  // The road's type as the binnacle says it (U-55): the reference lap's archetype in the words a driver uses, or null for a
  // connector (a ramp or a link road, nothing to read: the row steps aside) and for none.
  const roadKind = (type) => (type === 'Flowing sweepers' ? 'Sweepers' : type === 'Fast open' ? 'Fast & open' : type === 'Connector' ? null : (type || null));
  const NS = 'http://www.w3.org/2000/svg';
  const SPEED_MAX = 140;

  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function html(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Perf (2026-10-30): the strip's colours, read once per theme instead of on every rebuild. The root's custom properties
  // come only from the stylesheet and the theme's inline style on <html> (themes.js apply), so that style is the key; each
  // getComputedStyle here forced a style recalculation in the middle of a drive frame.
  const cssMemo = { key: null, vals: null };
  function themeVar(name) {
    const r = document.documentElement, key = `${r.getAttribute('style')}|${r.className}`;
    if (cssMemo.key !== key) { cssMemo.key = key; cssMemo.vals = Object.create(null); }
    if (!(name in cssMemo.vals)) cssMemo.vals[name] = css(name);
    return cssMemo.vals[name];
  }
  const fmt = (v) => (v == null || !isFinite(v) ? '--' : String(Math.round(v)));
  // Perf (2026-10-30): the cluster is updated with every fix; only what changed is written (each write, even of the same
  // value, dirtied the style of the whole cluster for the next frame).
  const setA = (n, k, v) => { v = String(v); if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
  const setT = (n, t) => { t = t == null ? '' : String(t); if (n.textContent !== t) n.textContent = t; };
  const setS = (n, k, v) => { v = String(v); if (n.style[k] !== v) n.style[k] = v; };

  // -------------------------------------------------------------------------
  // Tulip diagrams (FIA roadbook convention: entry dot at the bottom, the road as
  // the driver meets it, arrow on the exit). Radius encodes severity.
  // -------------------------------------------------------------------------
  // The call lockup (docs/design/REVIEW.md roadmap 3): the call itself big ("Left 4 minus"), its modifiers and caution one
  // size down ("tightens · long · care") so a long call never wraps to four lines. The modifiers that change what you do
  // (tightens, off-camber, over crest) are marked to be drawn in the accent. Plain-words calls carry no modifiers: whole.
  const WARN_MODS = new Set(['tightens', 'off-camber', 'over crest']);
  // Panel round 1, M-1: a plain-words call says its warning first ("Careful, hairpin left, long"); the head stays the
  // corner and the caution leads the row under it, in the warning colour.
  const CALM_WORDS = new Set(['long', 'opens']);
  const LEAD_CAUTION = /^(careful|slow down|slow right down|very slow), (.+)$/i;
  function lockup(call, mods) {
    const lead = LEAD_CAUTION.exec(String(call || ''));
    if (lead) { const r = lockup(lead[2], mods); return { head: r.head.charAt(0).toUpperCase() + r.head.slice(1), tail: [{ text: lead[1].toLowerCase(), warn: true }, ...r.tail] }; }
    const text = String(call || ''), low = text.toLowerCase();
    let cut = text.indexOf(', ');
    for (const m of mods || []) { const i = low.indexOf(' ' + String(m).toLowerCase()); if (i > 0 && (cut < 0 || i < cut)) cut = i; }
    if (cut <= 0) return { head: text, tail: [] };
    const [modPart, ...caution] = text.slice(cut).split(', ');
    let rest = modPart.trim().toLowerCase();
    const tail = [];
    for (const m of mods || []) {                                          // in the order the call says them
      const w = String(m).toLowerCase();
      if (rest.startsWith(w)) { tail.push({ text: w, warn: WARN_MODS.has(w) }); rest = rest.slice(w.length).trim(); }
    }
    if (rest) tail.push({ text: rest, warn: false });                      // anything the list didn't name, kept as said
    // after a comma: a caution or a modifier in plain words; only the ones that change nothing you do (long, opens) are calm
    for (const c of caution) if (c.trim()) tail.push({ text: c.trim().toLowerCase(), warn: !CALM_WORDS.has(c.trim().toLowerCase()) });
    return { head: text.slice(0, cut).trim(), tail };
  }
  // REVIEW5 U-107: the strip's grammar. Words belong to the head; every other cell prints the note's code under its
  // distance ("R3", "LHP", "CREST", "KEEP L"), short enough that it is never a cut word ("EASY …", "MEDIU…", "CR…").
  const TURN_CODES = [
    [/^roundabout · exit (\S+)/i, (m) => `RBT ${m[1]}`], [/^roundabout/i, () => 'RBT'],
    [/^(exit|ramp|keep|bear|merge|sharp) (left|right)$/i, (m) => `${m[1]} ${m[2][0]}`], [/^exit (\S{1,4})$/i, (m) => `EXIT ${m[1]}`],
    [/^(left|right)$/i, (m) => `TURN ${m[1][0]}`], [/^u-turn/i, () => 'U-TURN'], [/^(ramp|merge|exit)/i, (m) => m[1]],
  ];
  // Panel round 1, M-3 / P-2: a corner's code is the driver's notation (plain_notes.js noteCode): "TIGHT R", "HAIRPIN L"
  // with plain words on, real rally codes ("L4-", "LHP", "SQ L") with rally words, never "LAC" / "LSQ" / "RSQ". `words`
  // is the strip's notes.words; your own recce note keeps its code.
  const plainNotes = () => root.ApexPlainNotes || (typeof module !== 'undefined' && typeof require === 'function' ? require('./plain_notes.js') : null);
  function stripCode(n, words = 'rally') {
    const P = n && n.type === 'corner' && !n.recce ? plainNotes() : null, own = P ? P.noteCode(n, words) : null;
    if (own) return own;
    const code = String((n && n.code) || '').trim();
    if (n && n.type === 'turn') {
      if (n.dir === 'A') return 'ARRIVE';
      for (const [re, f] of TURN_CODES) { const m = code.match(re); if (m) return f(m).toUpperCase(); }
      return n.dir === 'L' || n.dir === 'R' ? `TURN ${n.dir}` : 'TURN';
    }
    if (code && code.length <= 6 && !/\s/.test(code)) return code.toUpperCase();
    // a long code or none: its first word, whole (a hazard without a code by its kind: "BUMP")
    return (code || (n && n.type && n.type !== 'corner' ? n.type : String((n && n.call) || ''))).split(/[\s,·]+/)[0].toUpperCase().slice(0, 7) || '--';
  }
  const HAZARD_TYPES = new Set(['bump', 'crest', 'dip']);   // measured hazards: the hazard plate's colours when they are the call
  const TULIP_R = { HP: 8, 1: 10, 2: 14, 3: 19, 4: 25, 5: 32, 6: 40 };

  function tulipSVG(note, ink, accent) {
    const w = 3.2;
    let body = '';
    if (note.type === 'corner') {
      const left = note.dir === 'L';
      const turn = Math.min(Math.PI, Math.max(25 * Math.PI / 180, Math.abs(note.turnRad || Math.PI / 3)));
      const r = TULIP_R[note.severity] || 20;
      let x = 50, y = 90 - 0;
      const entryLen = note.severity === 'HP' ? 34 : 26;
      const p0 = [x, y], p1 = [x, y - entryLen];
      let h = -Math.PI / 2;
      const nrm = (hh) => (left ? [Math.sin(hh), -Math.cos(hh)] : [-Math.sin(hh), Math.cos(hh)]);
      const n0 = nrm(h);
      const c = [p1[0] + r * n0[0], p1[1] + r * n0[1]];
      h = left ? h - turn : h + turn;
      const n1 = nrm(h);
      const p2 = [c[0] - r * n1[0], c[1] - r * n1[1]];
      const exitLen = 16;
      const p3 = [p2[0] + exitLen * Math.cos(h), p2[1] + exitLen * Math.sin(h)];
      const a = 7, hx = Math.cos(h), hy = Math.sin(h);
      const head = `${p3[0] + hx * a},${p3[1] + hy * a} ${p3[0] - hy * a * 0.6},${p3[1] + hx * a * 0.6} ${p3[0] + hy * a * 0.6},${p3[1] - hx * a * 0.6}`;
      body += `<path class="pen" pathLength="1" d="M${p0} L${p1} A${r} ${r} 0 0 ${left ? 0 : 1} ${p2} L${p3}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
      body += `<polygon points="${head}" fill="${ink}"/>`;
      body += `<circle cx="${p0[0]}" cy="${p0[1]}" r="4.2" fill="${ink}"/>`;
      if ((note.mods || []).includes('over crest')) body += `<path d="M10 22 Q20 10 30 22" fill="none" stroke="${accent}" stroke-width="2.6"/>`;
      if ((note.mods || []).includes('tightens')) body += `<path d="M76 12 l8 0 M80 8 l0 8" stroke="${accent}" stroke-width="2.6"/>`;
      if ((note.mods || []).includes('opens')) body += `<path d="M76 12 l8 0" stroke="${accent}" stroke-width="2.6"/>`;
    } else if (note.type === 'turn') {
      // A junction from the route's directions (IDEAS V-04): the road you're on to the junction, the way straight on as a
      // thin stub, and the exit at its angle; a roundabout as a ring, arrival as a flag.
      body += `<path d="M50 92 L50 52" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/><circle cx="50" cy="92" r="4.2" fill="${ink}"/>`;
      if (note.dir === 'A') {
        body += `<path d="M50 52 L50 14" stroke="${ink}" stroke-width="${w}"/><path d="M50 14 L76 22 L50 30 Z" fill="${accent}"/>`;
      } else if (note.dir === 'O') {
        body += `<circle cx="50" cy="38" r="14" fill="none" stroke="${ink}" stroke-width="${w}"/><path d="M60 28 L78 10" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/><polygon points="82,6 70,10 78,18" fill="${ink}"/>`;
      } else if (note.dir === 'U') {
        body += `<path d="M50 52 L50 34 A12 12 0 0 0 26 34 L26 62" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/><polygon points="26,70 20,58 32,58" fill="${ink}"/>`;
      } else {
        const deg = note.dir === 'L' ? -(note.angle || 0) : (note.angle || 0), rad = (deg - 90) * Math.PI / 180;
        const ex = 50 + 38 * Math.cos(rad), ey = 52 + 38 * Math.sin(rad), hx = Math.cos(rad), hy = Math.sin(rad), a = 8;
        if (note.dir !== 'S') body += `<path d="M50 52 L50 16" stroke="${ink}" stroke-width="1.4" opacity="0.55"/>`;
        body += `<path d="M50 52 L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`;
        body += `<polygon points="${(ex + hx * a).toFixed(1)},${(ey + hy * a).toFixed(1)} ${(ex - hy * a * 0.6).toFixed(1)},${(ey + hx * a * 0.6).toFixed(1)} ${(ex + hy * a * 0.6).toFixed(1)},${(ey - hx * a * 0.6).toFixed(1)}" fill="${ink}"/>`;
      }
    } else {
      // Hazard glyphs on a straight
      body += `<path d="M50 92 L50 14" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/><circle cx="50" cy="92" r="4.2" fill="${ink}"/>`;
      if (note.type === 'bump') body += `<path d="M30 54 Q50 30 70 54" fill="none" stroke="${accent}" stroke-width="4"/>`;
      if (note.type === 'crest') body += `<path d="M28 58 Q50 26 72 58" fill="none" stroke="${accent}" stroke-width="3"/><path d="M38 42 L50 30 L62 42" fill="none" stroke="${accent}" stroke-width="2"/>`;
      if (note.type === 'dip') body += `<path d="M28 40 Q50 72 72 40" fill="none" stroke="${accent}" stroke-width="3"/>`;
      // road marks from the map (road_marks.js), by code: a stop octagon, a railway crossbuck, a bridge's narrowing rails, a hump
      if (note.type === 'mark' && note.code === 'STOP') body += `<polygon points="64,30 74,30 81,37 81,47 74,54 64,54 57,47 57,37" fill="none" stroke="${accent}" stroke-width="3"/>`;
      if (note.type === 'mark' && note.code === 'RAIL') body += `<path d="M58 32 L80 54 M80 32 L58 54" stroke="${accent}" stroke-width="3.4" stroke-linecap="round"/>`;
      if (note.type === 'mark' && note.code === 'BRIDGE') body += `<path d="M36 30 L44 42 L44 62 L36 74 M64 30 L56 42 L56 62 L64 74" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>`;
      if (note.type === 'mark' && note.code === 'HUMP') body += `<path d="M30 56 Q50 34 70 56" fill="none" stroke="${accent}" stroke-width="4"/><path d="M30 64 L70 64" stroke="${accent}" stroke-width="2"/>`;
      if (note.type === 'mark' && note.code === 'ANIMAL') body += `<path d="M69 23 L60 33 L57 49 L69 58 L81 49 L78 33 Z" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/><path d="M63 27 L60 20 M75 27 L78 20" stroke="${accent}" stroke-width="2.6" stroke-linecap="round"/>`;
      if (note.type === 'mark' && note.code === 'BUGGY') body += `<path d="M58 30 L80 30 L80 46 L58 46 Z" fill="none" stroke="${accent}" stroke-width="3"/><circle cx="62" cy="52" r="5" fill="none" stroke="${accent}" stroke-width="2.6"/><circle cx="76" cy="52" r="5" fill="none" stroke="${accent}" stroke-width="2.6"/>`;
      if (note.type === 'mark' && note.code === 'COVERED') body += `<path d="M30 40 L50 24 L70 40 M36 40 L36 72 M64 40 L64 72" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>`;
      if (note.type === 'mark' && note.code === 'GRAVEL') body += `<g fill="${accent}"><circle cx="34" cy="62" r="3.2"/><circle cx="46" cy="56" r="2.6"/><circle cx="56" cy="64" r="3.4"/><circle cx="66" cy="57" r="2.4"/><circle cx="42" cy="68" r="2.4"/><circle cx="62" cy="70" r="2.8"/></g>`;
      if (note.type === 'mark' && note.code === 'ROUGH') body += `<path d="M28 62 L36 54 L44 64 L52 52 L60 64 L68 55 L74 62" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linejoin="round"/>`;
      if (note.type === 'alpr') body += `<rect x="62" y="38" width="22" height="14" fill="none" stroke="${accent}" stroke-width="2.6"/><circle cx="73" cy="45" r="3.5" fill="${accent}"/><path d="M62 45 L54 45" stroke="${accent}" stroke-width="2.6"/>`;
    }
    return `<svg viewBox="0 0 100 100" class="tulip">${body}</svg>`;
  }

  // -------------------------------------------------------------------------
  // Pace-note strip renderers
  // -------------------------------------------------------------------------
  // a new screen size can change which quiet line fits (U-100), so a resize builds the strip anew
  let stripEpoch = 0;
  if (typeof addEventListener === 'function') addEventListener('resize', () => { stripEpoch++; });
  // and so can the web fonts arriving (the page renders again on document.fonts.ready)
  if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { stripEpoch++; });
  const ADVANCE_MS = 420;
  function renderNotes(el, theme, notes) {
    const custom = theme && theme.renderers && RENDER.strip[theme.renderers.strip];   // a Pro theme's strip (the contract's third)
    if (custom) return custom(el, theme, notes, { lockup, tulipSVG, hazard: (n) => HAZARD_TYPES.has(n.type) });
    const ink = themeVar('--panel-ink'), accent = themeVar('--accent'), signal = themeVar('--signal');
    // Perf (2026-10-30): the page calls this several times a second in a drive, mostly with the same notes. The same page is
    // left as it is (a slide in progress runs on); a page whose only change is a distance has those numbers rewritten in
    // place; anything else is built anew, as before.
    const shape = JSON.stringify([theme.notes, stripEpoch, ink, accent, signal, notes.quietText, notes.quietShort, notes.words,
      notes.slice(0, 3).map((n) => [n.key, n.type, n.code, n.call, n.sub, n.dir, n.severity, n.turnRad, n.angle, n.mods, n.recce, n.lanes])]);
    const dists = notes.slice(0, 3).map((n) => [n.dist == null ? '' : String(n.dist), n.unit == null ? '' : String(n.unit)]);
    if (el._shape === shape && el._built === el.firstChild && el.firstChild) {
      if (JSON.stringify(dists) !== el._dists) {
        el._dists = JSON.stringify(dists);
        el.querySelectorAll(':scope > .rb-box > .rb-dist').forEach((d, i) => {
          const b = d.firstChild, u = d.lastChild;
          if (b && b.textContent !== dists[i][0]) b.textContent = dists[i][0];
          if (u && u.textContent !== dists[i][1]) u.textContent = dists[i][1];
        });
      }
      return;
    }
    el.innerHTML = '';
    el.className = `notes notes-${theme.notes}`;
    if (!notes.length) {
      const q = html('div', 'note-quiet', el);
      html('b', '', q, 'Clear').dataset.explain = 'clear';
      const line = html('span', '', q, notes.quietText || '');
      // U-100: a line that needs a third row (Tapedeck's wide dot font, a long road name) takes its compact form instead
      if (notes.quietShort && notes.quietShort !== notes.quietText && typeof getComputedStyle === 'function') {
        const fs = parseFloat(getComputedStyle(line).fontSize) || 15;
        if (line.scrollHeight > 2.6 * fs) line.textContent = notes.quietShort;
      }
      el._shape = shape; el._dists = JSON.stringify(dists); el._built = el.firstChild;
      return;
    }
    // When the lead note changes (the old one was passed), the new call arrives in ADVANCE_MS: its words settle and its
    // tulip is drawn on by the pen (index.html .rb-box.advance). A rebuild inside that time resumes the move where it
    // was (negative delay, --adv for the tulip's line) instead of restarting it.
    const lead = notes[0].key, t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (lead !== undefined && el._lead !== undefined && lead !== el._lead) el._advanceAt = t0;
    el._lead = lead;
    const since = el._advanceAt === undefined ? Infinity : t0 - el._advanceAt;
    // Road book page: up to three boxes, distance | tulip | note.
    notes.slice(0, 3).forEach((n, i) => {
      // a measured hazard that becomes the call takes the hazard plate's colours (docs/design/REVIEW.md 4.3)
      const hz = HAZARD_TYPES.has(n.type);
      const box = html('div', 'rb-box' + (i === 0 ? ' now' : '') + (hz && i === 0 ? ' hz' : ''), el);
      if (since < ADVANCE_MS) { box.classList.add('advance'); box.style.animationDelay = `-${Math.round(since)}ms`; box.style.setProperty('--adv', `-${Math.round(since)}ms`); }
      const d = html('div', 'rb-dist', box);
      html('b', '', d, n.dist);
      html('small', '', d, n.unit);
      const t = html('div', 'rb-tulip', box);
      t.innerHTML = hz && i === 0 ? tulipSVG(n, themeVar('--hz-ink') || '#fff', themeVar('--hz-edge') || '#FF7A1A') : tulipSVG(n, ink, n.type === 'corner' ? accent : hz ? (themeVar('--hz-edge') || signal) : signal);
      if (i > 0) {                                                          // U-107: the next cells say the code, never words
        html('b', 'rb-code', box, stripCode(n, notes.words));
        return;
      }
      const c = html('div', 'rb-call', box);
      if (n.type !== 'corner' && n.code.toLowerCase() !== n.call.toLowerCase()) html('b', '', c, n.code);
      // a long call ("Square left off-camber") steps down a size so it reads whole instead of ending in "..."
      const lk = n.type === 'corner' && !n.recce ? lockup(n.call, n.mods) : { head: String(n.call || ''), tail: [] };   // your own recce call stays as you wrote it
      const len = lk.head.length;
      // U-92: a head of three words ("Very sharp left", "Very tight right") takes three lines at the lead's size: the
      // two-line clamp cut the direction off ("VERY SHARP…" for a mile). The word that says which way is never the one lost.
      const tall = lk.head.trim().split(/\s+/).length >= 3;
      html('span', (len > 18 ? 'xlong' : len > 11 ? 'long' : '') + (tall ? ' tall' : ''), c, lk.head);
      if (lk.tail.length) {
        const m = html('span', 'rb-mods', box);                           // U-133: its own row, the box's full width
        m.append(' ');                                                     // read as one call, not "plustightens"
        lk.tail.forEach((t, k) => { if (k) m.append(' · '); html('i', t.warn ? 'warn' : '', m, t.text); });
      }
      // the lanes for the next junction (IDEAS R-29): one arrow per lane, left to right; the ones to use are lit
      if (i === 0 && Array.isArray(n.lanes) && n.lanes.length > 1) {
        const row = html('div', 'rb-lanes', box);
        row.setAttribute('aria-label', `Lanes: ${n.lanes.map(l => (l.use ? 'use' : l.ok ? 'also' : 'not')).join(', ')}`);
        for (const l of n.lanes) {
          const a = svg('svg', { viewBox: '-12 -12 24 24', width: 22, height: 22, class: 'lane' + (l.use ? ' use' : l.ok ? ' ok' : '') }, row);
          const g = svg('g', { transform: Math.abs(l.angle) >= 170 ? '' : `rotate(${l.angle})` }, a);   // the U-turn is drawn as one
          svg('path', { d: Math.abs(l.angle) >= 170 ? 'M4 10 V-2 A4 4 0 0 0 -4 -2 V4 M-7 1 L-4 4 L-1 1' : 'M0 10 V-8 M-5 -3 L0 -8 L5 -3', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        }
      }
    });
    fitHead(el);
    el._shape = shape; el._dists = JSON.stringify(dists); el._built = el.firstChild;
  }
  // Panel round 1 M-3: a plain-words code ("MEDIUM R") is wider than "R3", and on the narrowest phones the head could then
  // break mid-word ("SQUA / RE"). The head's words stay whole: the next cell's code steps down a size, and if that is not
  // enough the next cell gives way, because the head is the call. Measured once per rebuild, never on a distance update.
  function headBroken(h) {
    const t = h && h.firstChild;
    if (!t || t.nodeType !== 3 || typeof document.createRange !== 'function') return false;
    if (h.scrollWidth > h.clientWidth + 1) return true;                  // a word that will not break runs out of its box
    let i = 0;
    for (const w of t.textContent.split(' ')) {
      const r = document.createRange();
      r.setStart(t, i); r.setEnd(t, i + w.length);
      if (w && r.getClientRects().length > 1) return true;
      i += w.length + 1;
    }
    return false;
  }
  function fitHead(el) {
    const h = el.querySelector(':scope > .rb-box.now .rb-call span');
    if (!headBroken(h)) return;
    const next = el.querySelectorAll(':scope > .rb-box:not(.now)');
    next.forEach((b) => { const c = b.querySelector('.rb-code'); if (c) c.style.fontSize = '12px'; });
    if (headBroken(h)) next.forEach((b) => { b.style.display = 'none'; });
  }

  // -------------------------------------------------------------------------
  // Dial cluster
  // -------------------------------------------------------------------------
  const U = () => root.ApexUnits;                          // mph or km/h (units.js, U-22); mph without it
  const top = () => (U() ? U().speedMax() : SPEED_MAX);
  const ang = (v) => 135 + 270 * Math.max(0, Math.min(top(), v)) / top();
  const polar = (r, deg) => [100 + r * Math.cos(deg * Math.PI / 180), 100 + r * Math.sin(deg * Math.PI / 180)];

  function speedDial(parent, printed) {
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'dial-svg' }, parent);
    svg('circle', { cx: 100, cy: 100, r: 97, fill: 'var(--face)', stroke: printed ? 'var(--face-ink)' : 'var(--rule)', 'stroke-width': printed ? 2.5 : 1.5 }, s);
    // scale arc
    const [ax, ay] = polar(90, 135), [bx, by] = polar(90, 405);
    svg('path', { d: `M${ax} ${ay} A90 90 0 1 1 ${bx} ${by}`, fill: 'none', stroke: 'var(--face-ink)', 'stroke-width': printed ? 1.8 : 0.8 }, s);
    const step = top() > 160 ? 10 : 5, majorEvery = top() > 160 ? 40 : 20;
    for (let v = 0; v <= top(); v += step) {
      const major = v % majorEvery === 0, mid = v % (2 * step) === 0;
      const a = ang(v), [x1, y1] = polar(90, a), [x2, y2] = polar(major ? 76 : mid ? 81 : 85, a);
      svg('line', { x1, y1, x2, y2, stroke: 'var(--face-ink)', 'stroke-width': major ? 2.4 : mid ? 1.3 : 0.8 }, s);
      if (major) {
        const [tx, ty] = polar(63, a);
        svg('text', { x: tx, y: ty + 5, 'text-anchor': 'middle', class: ty > 130 ? 'dial-num low' : 'dial-num' }, s).textContent = v;   // low: beside the numeral
      }
    }
    svg('text', { x: 100, y: 122, 'text-anchor': 'middle', class: 'dial-label' }, s).textContent = U() ? U().speedU().toUpperCase() : 'MPH';
    const limit = svg('g', {}, s);
    svg('rect', { x: 94, y: 4, width: 12, height: 14, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, limit);
    const sight = svg('path', { d: 'M100 18 L95 8 L105 8 Z', fill: 'none', stroke: 'var(--amber)', 'stroke-width': 2 }, s);
    // panel round 2 (PR-2): readings are ink; the needle takes the signal only when you are over the corner's pace
    const pace = svg('path', { d: 'M100 20 L94 8 L106 8 Z', fill: 'var(--face-ink)' }, s);
    const needle = svg('g', {}, s);
    const np = svg('path', { d: printed ? 'M98.6 112 L100 24 L101.4 112 Z' : 'M97.5 108 L100 22 L102.5 108 Z', fill: 'var(--face-ink)' }, needle);
    svg('circle', { cx: 100, cy: 100, r: printed ? 5 : 7, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, s);
    const digital = svg('text', { x: 100, y: 182, 'text-anchor': 'middle', class: 'dial-digital' }, s);
    return (d) => {
      const live = d.speedMph != null;
      setA(needle, 'transform', `rotate(${ang(live ? (d.needleMph != null ? d.needleMph : d.speedMph) : 0) + 90} 100 100)`);
      setS(needle, 'opacity', live ? 1 : 0.25);
      setA(np, 'fill', live && d.paceMph != null && d.speedMph > d.paceMph + 1 ? 'var(--signal)' : 'var(--face-ink)');
      setT(digital, live ? Math.round(d.speedMph) : '--');
      const place = (node, mph) => {
        if (mph == null || !isFinite(mph)) { setS(node, 'display', 'none'); return; }
        setS(node, 'display', '');
        setA(node, 'transform', `rotate(${ang(mph) + 90} 100 100)`);
      };
      place(pace, d.paceMph); place(sight, d.sightMph); place(limit, d.limitMph);
    };
  }

  // line: the Vetta Line cluster's meter (mountLine). The same ball, trail and Bank, printed straight on the panel's paper:
  // no face, hairline rings the pen draws on once (index.html .g-ring), Brake named over the ring and Bank read under it, not across the ball.
  function gDial(parent, printed, line) {
    const s = svg('svg', { viewBox: line ? '0 -40 200 284' : '0 0 200 200', class: line ? 'dial-svg g-line' : 'dial-svg' }, parent);
    const ring = (r, attrs) => { const c = svg('circle', { cx: 100, cy: 100, r, ...attrs }, s); if (line) { c.setAttribute('class', 'g-ring'); c.style.setProperty('--len', (2 * Math.PI * r).toFixed(1)); } return c; };
    ring(97, { fill: line ? 'none' : 'var(--face)', stroke: printed ? 'var(--face-ink)' : 'var(--rule)', 'stroke-width': line ? 2 : printed ? 2.5 : 1.5 });
    const G = 72 / 0.8;
    [0.25, 0.5, 0.75].forEach(g => ring(g * G, { fill: 'none', stroke: g === 0.5 ? 'var(--face-ink)' : 'var(--face-dim)', 'stroke-width': line ? (g === 0.5 ? 1.6 : 1.1) : g === 0.5 ? 1 : 0.7 }));
    svg('line', { x1: 28, y1: 100, x2: 172, y2: 100, stroke: 'var(--face-dim)', 'stroke-width': line ? 1.1 : 0.7 }, s);
    svg('line', { x1: 100, y1: 28, x2: 100, y2: 172, stroke: 'var(--face-dim)', 'stroke-width': line ? 1.1 : 0.7 }, s);
    svg('text', { x: 100, y: line ? -12 : 48, 'text-anchor': 'middle', class: 'dial-label' }, s).textContent = 'BRAKE';   // line: over the ring, where braking rolls the ball
    if (!line) svg('text', { x: 100 + 0.5 * G + 3, y: 96, class: 'dial-tiny' }, s).textContent = '.5';
    for (let d = -10; d <= 10; d += 2.5) {
      const a = 90 - d * 3, [x1, y1] = polar(92, a), [x2, y2] = polar(d % 5 === 0 ? 84 : 88, a);
      svg('line', { x1, y1, x2, y2, stroke: d === 0 ? 'var(--face-ink)' : 'var(--face-dim)', 'stroke-width': d === 0 ? 1.8 : 1 }, s);
    }
    // panel round 2 (PR-2): the ball, its trail and Bank are readings, in the face's ink; none of them is ever the alarm red
    const bank = svg('path', { d: 'M100 182 L96 172 L104 172 Z', fill: 'var(--face-ink)' }, s);
    const bankTxt = svg('text', { x: 100, y: line ? 236 : 158, 'text-anchor': 'middle', class: 'dial-digital small' }, s);
    const trail = svg('polyline', { points: '', fill: 'none', stroke: 'var(--face-ink)', 'stroke-opacity': 0.4, 'stroke-width': line ? 3 : 2 }, s);
    const ball = svg('circle', { cx: 100, cy: 100, r: line ? 10 : 7, fill: 'var(--face-ink)' }, s);
    const pts = [];
    return (d) => {
      const known = d.latG != null && d.lonG != null;
      let x = 100, y = 100;
      if (known) {
        // Spirit-level ball: felt force. +lat (left turn) rolls right; braking rolls forward.
        const k = Math.min(1, 0.9 / Math.max(1e-6, Math.hypot(d.latG, d.lonG)));
        x = 100 + d.latG * G * k; y = 100 + d.lonG * G * k;
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        if (pts.length > 24) pts.shift();
      } else pts.length = 0;
      setA(ball, 'cx', x); setA(ball, 'cy', y);
      setA(ball, 'fill', known ? 'var(--face-ink)' : 'var(--face-dim)');
      setA(trail, 'points', pts.join(' '));
      // HE-1 / LA-3: Bank is "--" until it is measured (a calibrated mount, or a recorded drive's own column), never a
      // +0.0° that reads as measured; the same slot and size either way
      const banked = Number.isFinite(d.camberDeg);
      setS(bank, 'display', banked ? '' : 'none');
      if (banked) setA(bank, 'transform', `rotate(${-Math.max(-10, Math.min(10, d.camberDeg)) * 3} 100 100)`);
      setT(bankTxt, bankText(d.camberDeg));
      bankTxt.classList.toggle('unk', !banked);
    };
  }

  /**
   * The binnacle's Sight cell from the cluster's frame (panel round 2, SO-1): the same held sight-line speed as the plate
   * under the arrow, never the corner's pace under the same word (recording 7: the plate said 50 and the cell 48, the
   * pace; the pace keeps its own mark on the speed dial). U-130: under 5 mph the plate hides (sightQuiet) and the cell
   * reads --, never a number at a standstill; "Open" when nothing limits you. Red only when the plate is red
   * (d.sightShort, its 3 s rule), else, without that flag, when the speed is over it. { text, eye, short }.
   */
  function sightCell(d) {
    const v = !d || d.sightQuiet || !Number.isFinite(d.sightMph) ? null : d.sightMph;
    if (d && d.sightOpen && !d.sightQuiet) return { text: 'Open', eye: false, short: false };
    const short = v != null && (typeof d.sightShort === 'boolean' ? d.sightShort : Number.isFinite(d.speedMph) && d.speedMph > v + 1);
    return { text: fmt(v), eye: v != null, short };
  }

  // ---- Panel round 2: one red that means act now (IN-3, PR-2, TH-2, GR-1) -----------------------------------------------
  // The drive screen's alarm grammar: the signal colour means "act now" and nothing else. Readings (speed, Sight under your
  // speed, Bank, the g-ball, Score, the trip) are ink. A warning is never hue alone: it also changes shape and says a word.
  /** The Sight value the cell shows: the held sight line only (SO-1: the pace has its own mark on the dial), or null. */
  function sightValue(d) { const c = sightCell(d); return c.text === 'Open' || c.text === '--' ? null : (Number.isFinite(d.sightMph) ? d.sightMph : null); }
  /** True when you are faster than Sight: the one alarm on the binnacle. Pure. */
  function sightShort(d) { return sightCell(d).short; }
  /** GR-1: the warning's plain sentence, said in words when it fires: "Slow to 45 for what you can see." Pure. */
  function slowLine(v) { return Number.isFinite(v) ? `Slow to ${Math.round(v)} for what you can see.` : ''; }
  /** HE-1 / LA-3: the Bank readout; "BANK --" until measured, never a false +0.0°. Whole degrees (red team TE-03,
   *  2026-11-10): one phone on a sprung body, with no body-roll model, is good to a degree or two, never to a tenth. Pure. */
  function bankText(deg) {
    if (!Number.isFinite(deg)) return 'BANK --';
    const r = Math.round(deg);
    return `BANK ${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r)}°`;
  }
  // said under every Bank explanation: how sure a phone's banking is (docs/PHILOSOPHY.md §4)
  const BANK_SURE = ' Bank is approximate, to a degree or two: the car\'s body roll is not modelled.';

  // ---- Panel round 2: explain behind a tap (PR-1, SO-4) -----------------------------------------------------------------
  // What each instrument means and how it is measured, one short sheet each. Shown only parked or in a replay
  // (explainAllowed): while you drive, a tap on an instrument does nothing. now(d, unit): the reading as the cell shows it.
  const nf = (v, unit) => (Number.isFinite(v) ? `${Math.round(v)} ${unit}` : '--');
  const EXPLAIN = {
    speed: { title: 'Speed', what: 'How fast you are going. The filled mark on the dial is the pace the next corner allows; the open one is Sight.',
      how: 'From GPS, smoothed. -- with no fix.', now: (d, u) => nf(d.speedMph, u) },
    limit: { title: 'Speed limit', what: 'The posted limit for the road you are on, drawn as the sign.',
      how: 'From OpenStreetMap. -- where the map does not know it; Vetta never guesses one.', now: (d, u) => nf(d.limitMph, u) },
    sight: { title: 'Sight', what: 'The fastest you could still stop from within the road you can see ahead, and no faster than the next corner allows. A braking range, never a target.',
      how: 'Worked out from the shape of the road ahead: its bends, its crests and what stands at its edge. When you are faster than it, it turns red and says SLOW. Open: nothing ahead limits you.',
      now: (d, u) => (d.sightOpen ? 'Open' : nf(sightValue(d), u)) },
    gball: { title: 'Grip ball and Bank', what: 'The ball shows the force you feel: it rolls forward under braking and outward in a turn. Bank is how much the road leans in the corner: + leans into the turn and helps, - is off-camber.',
      how: 'From the phone\'s motion sensors. Bank reads -- until the phone is calibrated in its mount; nothing is shown that was not measured.' + BANK_SURE,
      now: (d) => bankText(d.camberDeg) },
    meters: { title: 'Surface and Brake / Turn', what: 'Surface: how rough the road is under you. Brake / Turn: how hard you braked or turned, the last few seconds.',
      how: 'From the phone\'s motion sensors. Dark bars are readings not taken yet.', now: () => '' },
    pod: { title: 'Turn, Brake and Bank', what: 'The car\'s small gauges, reading what Vetta measures. Turn: how hard you are turning. Brake: how hard you are braking. Bank: how much the road leans in the corner.',
      how: 'From the phone\'s motion sensors. A needle lies dim at rest until it is measured; Bank reads -- until the phone is calibrated in its mount.' + BANK_SURE,
      now: (d) => bankText(d.camberDeg) },
    grip: { title: 'Grip, Turn, Brake and Bank', what: 'The big dial reads grip: turning and braking together, in tenths of g (8 is 0.8 g). The two small gauges: Turn and Brake. Bank: how much the road leans.',
      how: 'From the phone\'s motion sensors. A needle lies dim at rest until it is measured; Bank reads -- until the phone is calibrated.' + BANK_SURE, now: (d) => bankText(d.camberDeg) },
    tach: { title: 'Speed', what: 'How fast you are going, in the window. The big dial is the car\'s rev counter: Vetta can\'t read the engine, so its needle rests, dimmed. PACE is what the next corner allows; the lamp lights over it.',
      how: 'From GPS, smoothed. -- with no fix.', now: (d, u) => nf(d.speedMph, u) },
    score: { title: 'Vetta Score', what: 'How cleanly you drove the corners: your pace against what each one allows, smoothness, braking and rhythm. Out of 1000.',
      how: 'Worked out from this drive every 30 seconds while you record. -- until there are enough clean corners.',
      now: (d) => (Number.isFinite(d.score) ? String(Math.round(d.score)) : '--') },
    trip: { title: 'Trip', what: 'How far you have come on this drive, and the route\'s whole length beside it.', how: 'From GPS, along the road.',
      now: (d) => (Number.isFinite(d.tripMi) ? d.tripMi.toFixed(1) : '--') },
    road: { title: 'Road', what: 'The road under you, by the map\'s name; on a route with no name for it, its kind of road.', how: 'From the map.',
      now: (d) => (typeof d.roadName === 'string' && d.roadName.trim() ? d.roadName.trim() : '--') },
    clear: { title: 'Clear', what: 'No corner or hazard to call yet. The line beside it says what comes next.', how: 'From the route\'s corners and the hazards reported on it.', now: () => '' },
  };
  /** PR-1 / SO-4: an instrument explains itself only parked (under 3 mph) or in a replay; never while you drive. Pure.
   *  s: { live, speedMps }. A live drive with no speed known is treated as moving. */
  const EXPLAIN_MAX_MPS = 3 / 2.23694;
  function explainAllowed(s) {
    if (!s || !s.live) return true;                                   // a replay, a preview, the idle map
    return Number.isFinite(s.speedMps) && s.speedMps < EXPLAIN_MAX_MPS;
  }

  function readouts(parent) {
    const box = html('div', 'readouts', parent);
    const cell = (label, cls) => {
      const c = html('div', 'ro ' + (cls || ''), box);
      const value = html('div', 'ro-value', c);
      const v = html('b', '', value, '--');
      html('span', '', c, label);
      return { c, value, v };
    };
    const limit = cell('Speed limit', 'ro-limit');   // drawn as the US sign: SPEED LIMIT over the number (index.html .ro-limit)
    // Sight (owner, 2026-10-29): the speed you could stop from within what you can see ahead, and no faster than the
    // corner allows (the pace envelope). A braking range in speed units, not a target: it turns to the signal colour when
    // you're above it, and the eye shows when it's the sight line, not the corner, that sets it.
    const sight = cell('Sight', 'ro-sight');
    const eye = svg('svg', { viewBox: '0 0 24 24', width: 12, height: 12, class: 'ro-eye', 'aria-hidden': 'true' }, sight.value);
    svg('path', { d: 'M2 12 Q12 2 22 12 Q12 22 2 12 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, eye);
    svg('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor' }, eye);
    svg('path', { d: 'M4 21 L20 3', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', class: 'ro-eye-bar' }, eye);   // the bar: over it
    eye.style.display = 'none';
    const sightLabel = sight.c.lastChild;
    limit.c.dataset.explain = 'limit'; sight.c.dataset.explain = 'sight';   // PR-1: what a tap explains
    return (d) => {
      setT(limit.v, fmt(d.limitMph));
      limit.c.classList.toggle('unknown', !Number.isFinite(d.limitMph));   // a sign only when there is a limit to show
      const s = sightCell(d);
      setT(sight.v, s.text);
      // panel round 2 (IN-3, PR-2, GR-1): Sight is a reading in ink; over it, it is the one alarm, on two channels: the signal
      // colour, and a shape and a word (the hatched edge, the barred eye, SLOW in place of "Sight")
      setS(eye, 'display', s.eye ? '' : 'none');
      sight.c.classList.toggle('short', s.short);
      setT(sightLabel, s.short ? 'SLOW' : 'Sight');
    };
  }

  function odometer(parent, boxed) {
    const o = html('div', 'odo' + (boxed ? ' boxed' : ''), parent);
    const digits = html('div', 'odo-digits', o);
    const meta = html('div', 'odo-meta', o);
    html('span', '', meta, `Trip ${U() ? U().longU() : 'mi'}`);
    const total = html('span', '', meta, '');
    return (d) => {
      const s = Math.max(0, d.tripMi || 0).toFixed(1).padStart(5, '0');
      if (digits.dataset.v !== s) {
        digits.dataset.v = s;
        digits.innerHTML = '';
        const lead = s.search(/[1-9]|0\./);                          // the zeros before the number: pencil on the printed line
        [...s].forEach((ch, k) => html('span', ch === '.' ? 'dot' : k < lead ? 'dg lead' : 'dg', digits, ch));
      }
      setT(total, d.totalMi != null ? `of ${d.totalMi.toFixed(1)}` : '');
    };
  }

  function dnaBars(parent) {
    const wrap = html('div', 'dna', parent);
    const arch = html('div', 'dna-arch', wrap, '');
    const grid = html('div', 'dna-grid', wrap);
    const cells = {};
    for (const k of ['tech', 'flow', 'surf', 'clear']) {
      const c = html('div', 'dna-cell', grid);
      const v = html('b', '', c, '--');
      const bar = html('i', 'dna-bar', c);
      const f = html('u', '', bar);
      html('span', '', c, k.toUpperCase());
      cells[k] = { v, f };
    }
    return (d) => {
      const s = d.sector;
      arch.textContent = s && s.archetype ? s.archetype : (d.routeOnly ? 'Map only' : '');
      for (const k in cells) {
        const val = s ? s[k] : null;
        cells[k].v.textContent = val == null ? '--' : val;
        cells[k].f.style.width = val == null ? '0' : `${val}%`;
      }
    };
  }

  // ---- Tapedeck (Pro, REVIEW.md 4.1): seven-segment speed, bar meters, Kit --------------------------------------------
  // Seven-segment digits drawn as SVG polygons: lit segments in the VFD ink, the rest ghosted, the way the glass shows them.
  const SEG = { a: 'M12 4 H44 L40 10 H16 Z', b: 'M46 6 V46 L40 42 V12 Z', c: 'M46 54 V94 L40 88 V58 Z', d: 'M12 96 H44 L40 90 H16 Z',
    e: 'M10 54 V94 L16 88 V58 Z', f: 'M10 6 V46 L16 42 V12 Z', g: 'M13 50 L18 46 H38 L43 50 L38 54 H18 Z' };
  const DIGIT = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
  function sevenSeg(parent) {
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'dial-svg vfd-seg' }, parent);
    const digits = [0, 1, 2].map((k) => {
      const g = svg('g', { transform: `translate(${14 + k * 60} 30) skewX(-6)` }, s), segs = {};
      for (const [n, d] of Object.entries(SEG)) segs[n] = svg('path', { d, class: 'seg' }, g);
      return segs;
    });
    svg('text', { x: 18, y: 160, class: 'dial-label vfd-label' }, s).textContent = U() ? U().speedU().toUpperCase() : 'MPH';
    // REVIEW5 U-129: no "LIMIT 70" caption here; the Limit sign beside the speed is the limit, printed once
    const digital = svg('text', { x: 100, y: 150, 'text-anchor': 'middle', class: 'dial-digital vfd-shadow' }, s);   // read by the contract and screen readers
    s.setAttribute('role', 'img');
    return (d) => {
      const v = d.speedMph != null && isFinite(d.speedMph) ? String(Math.min(999, Math.round(d.speedMph))) : '--';
      const text = v.padStart(3, ' ');
      digits.forEach((segs, k) => {
        const on = DIGIT[text[k]] || '';
        segs.a.parentNode.classList.toggle('blank', text[k] === ' ');   // an unused leading digit shows nothing, not a ghost 8
        for (const [n, p] of Object.entries(segs)) p.classList.toggle('lit', on.includes(n));
      });
      setT(digital, v); setA(s, 'aria-label', `${v} ${U() ? U().speedU() : 'mph'}`);
    };
  }
  // Bar meters that are instruments, not decoration: SURFACE (roughness, the last 10 readings) and BRAKE / TURN (how hard
  // you braked or turned, the last 10 readings; amber when braking). Unknown readings stay dark.
  function barMeters(parent) {
    const box = html('div', 'vfd-meters', parent);
    const meter = (label) => {
      const m = html('div', 'vfd-meter', box); html('span', 'vfd-cap', m, label);
      const grid = html('div', 'vfd-bars', m), cols = [];
      for (let c = 0; c < 10; c++) { const col = html('i', '', grid); const cells = []; for (let r = 0; r < 8; r++) cells.push(html('b', '', col)); cols.push(cells); }
      return cols;
    };
    const surf = meter('SURFACE'), load = meter('BRAKE / TURN');
    const hs = [], hl = [];
    let last = 0;
    const paint = (cols, hist, amber) => cols.forEach((cells, c) => {
      const v = hist[hist.length - 10 + c];
      const n = v == null ? 0 : Math.max(1, Math.min(8, Math.round(v.h * 8)));
      cells.forEach((cell, r) => { const c = r < n ? (amber && v && v.amber ? 'on amber' : 'on') : ''; if (cell.className !== c) cell.className = c; });
    });
    return (d) => {
      const now = Date.now();
      if (now - last < 400) return;
      last = now;
      hs.push(d.rough != null && isFinite(d.rough) ? { h: Math.min(1, d.rough / 0.6) } : null);
      const g = d.latG != null && d.lonG != null ? Math.hypot(d.latG, d.lonG) : null;
      hl.push(g == null ? null : { h: Math.min(1, g / 0.8), amber: d.lonG < -0.1 });
      if (hs.length > 10) hs.shift(); if (hl.length > 10) hl.shift();
      while (hs.length < 10) hs.unshift(null); while (hl.length < 10) hl.unshift(null);
      paint(surf, hs, false); paint(load, hl, true);
    };
  }
  // Kit (REVIEW.md 4.1, REVIEW2.md U-38): a dot-matrix fox on a 16 x 14 grid who belongs to the display, drawn at 80 px.
  // X a lit outline dot, b his body (lit, lighter), w the muzzle (lit), o an amber eye, . dark (the nose too). Two idle frames
  // (the second flicks an ear), and four lean frames wired to the corner: he leans into it, further in a hard one. He sits
  // up for a crest, curls up when you stop, and blinks when a hazard is confirmed.
  const KIT_W = 16, KIT_H = 14;
  const KIT = {
    up: ['..XX........XX..', '..XbX......XbX..', '..XbbX....XbbX..', '..XbbbXXXXbbbX..', '.XbbbbbbbbbbbbX.', '.XbobbbbbbbbobX.',
         '.XbbbbbbbbbbbbX.', '..XbbbwwwwbbbX..', '...XbwwwwwwbX...', '....XwwwwwwX....', '.....Xw..wX.....', '......XwwX......',
         '.......XX.......', '................'],
    curl: ['................', '................', '................', '.....XXXXXX.....', '...XXbbbbbbXX...', '..XbbbbbbbbbbX..',
           '.XbbXXbbbbbbbbX.', '.XbbbbbbbbbbbbX.', '.XbbbbbbbbbbbXX.', '..XbbbbbbbbbXwwX', '...XXbbbbbbXwwwX', '.....XXXXXXwwwX.',
           '...........XXX..', '................'],
  };
  KIT.idle = ['............XX..', '.XXbX......XbX..', ...KIT.up.slice(2)];          // the left ear flicks
  // lean: the head shears toward the corner about the chin, by `k` dots at the ear tips
  const shear = (rows, k) => rows.map((r, i) => { const d = Math.round((KIT_H - 1 - i) * k / (KIT_H - 1));
    return d > 0 ? (r.slice(d) + '.'.repeat(d)) : d < 0 ? ('.'.repeat(-d) + r).slice(0, KIT_W) : r; });
  KIT.left = shear(KIT.up, 1); KIT.right = shear(KIT.up, -1);       // the head goes the way the corner does
  KIT.hardLeft = shear(KIT.up, 2); KIT.hardRight = shear(KIT.up, -2);
  KIT.blink = KIT.up.map((r) => r.replace(/o/g, 'X'));
  KIT.crest = ['..XX........XX..', ...KIT.up.slice(0, KIT_H - 1)];   // sits up: taller ears
  function kitPose(d, now) {
    if (d.blink) return 'blink';
    if (d.speedMph != null && d.speedMph < 2) return 'curl';
    if (d.crestAhead) return 'crest';
    if (d.latG != null && d.latG > 0.45) return 'hardLeft';
    if (d.latG != null && d.latG > 0.15) return 'left';
    if (d.latG != null && d.latG < -0.45) return 'hardRight';
    if (d.latG != null && d.latG < -0.15) return 'right';
    return now != null && now % 5000 < 260 ? 'idle' : 'up';        // an ear flick every five seconds
  }
  const KIT_CLASS = { X: 'on', w: 'on', b: 'body', o: 'eye' };
  function kitRow(parent) {
    const row = html('div', 'kit-row', parent);
    const s = svg('svg', { viewBox: `0 0 ${KIT_W * 10} ${KIT_H * 10}`, class: 'kit', 'aria-hidden': 'true' }, row);
    const dots = [];
    for (let y = 0; y < KIT_H; y++) for (let x = 0; x < KIT_W; x++) dots.push(svg('circle', { cx: 5 + x * 10, cy: 5 + y * 10, r: 3.8 }, s));
    const says = html('div', 'kit-says', row); html('span', 'vfd-cap', says, 'KIT SAYS'); const line = html('b', '', says, ''); says.classList.add('quiet');
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pose = null;
    return (d) => {
      const p = kitPose(d, still ? null : (typeof performance !== 'undefined' ? performance.now() : Date.now()));
      if (p !== pose) {
        pose = p;
        const rows = KIT[p];
        dots.forEach((c, i) => { c.setAttribute('class', KIT_CLASS[rows[Math.floor(i / KIT_W)][i % KIT_W]] || ''); });
      }
      // U-113: Kit's aside, from the pre-call until the strip moves on; with none the box is empty, label and all (never "--")
      if (d.kitLine !== undefined && line.textContent !== (d.kitLine || '')) { line.textContent = d.kitLine || ''; says.classList.toggle('quiet', !d.kitLine); }
    };
  }

  // ---- Billet (Pro, REVIEW.md 4.1): the printed dial and g-ball in a knurled bezel; the needle on a spring --------------
  function bezel(parent, inner) {
    parent.classList.add('bezelled');
    const ring = svg('svg', { viewBox: '0 0 200 200', class: 'bezel-ring', 'aria-hidden': 'true' }, parent);
    svg('circle', { cx: 100, cy: 100, r: 98, class: 'knurl' }, ring);
    for (const a of [45, 135, 225, 315]) { const [x, y] = polar(93, a); svg('circle', { cx: x, cy: y, r: 2.6, class: 'screw' }, ring); }
    return inner;
  }
  // a needle with mass: it overshoots a little on a change and settles (critically under-damped spring, ~0.4 s)
  function springNeedle() {
    let x = null, v = 0, t0 = 0;
    return (target, now) => {
      if (target == null || !isFinite(target)) { x = null; return null; }
      if (x == null) { x = target; t0 = now; return x; }
      const dt = Math.min(0.1, Math.max(0, (now - t0) / 1000)); t0 = now;
      const k = 120, c = 13;                                        // stiffness, damping: ~6 % overshoot
      v += (k * (target - x) - c * v) * dt; x += v * dt;
      return x;
    };
  }
  function bezelDial(parent) {
    const up = bezel(parent, speedDial(parent, true)), spring = springNeedle();
    return (d) => up({ ...d, needleMph: spring(d.speedMph, typeof performance !== 'undefined' ? performance.now() : Date.now()) });
  }
  const bezelG = (parent) => bezel(parent, gDial(parent, true));

  // ---- A car's own cluster (the private themes: themes.js grant(), migration 0044) -------------------------------------
  // The look of a real car's gauges is data the server sends only to an account granted it (backend/src/private_themes.json
  // car.dial / car.meter): faces, chrome rings, scales with their ranges and red zones, needles, windows and lamps, in the
  // 200 x 200 box every dial here uses. This code knows no car. What a scale reads is one of CAR_READS: the four Vetta
  // measures move a needle; anything else (engine speed, fuel, coolant, torque, volts) is drawn as the car has it and its
  // needle lies at rest, dimmed, because Vetta cannot read the engine (CLAUDE.md: unknown stays unknown).
  const CAR_READS = ['speed', 'speedAlt', 'latG', 'brakeG', 'bank', 'grip', 'rpm', 'fuel', 'temp', 'torque', 'volts', 'mpg'];
  const KMH = 1.609344;
  const metricNow = () => !!(U() && U().metric && U().metric());
  /** A scale's reading from the cluster's frame, in the scale's units, or null when Vetta doesn't measure it. Pure. */
  function carReading(reads, d, metric) {
    const g = d && d.latG != null && d.lonG != null;
    switch (reads) {
      case 'speed': return d && Number.isFinite(d.speedMph) ? (d.needleMph != null && Number.isFinite(d.needleMph) ? d.needleMph : d.speedMph) : null;
      case 'latG': return g ? d.latG : null;                         // + is a left turn (ISO 8855)
      case 'brakeG': return g ? Math.max(0, -d.lonG) : null;          // braking is -X
      case 'bank': return d && Number.isFinite(d.camberDeg) ? d.camberDeg : null;
      case 'grip': return g ? Math.hypot(d.latG, d.lonG) : null;    // turning and braking together, g
      default: return null;                                          // speedAlt has no needle; the engine's are never read
    }
  }
  // a scale's numbers in the driver's units: a speed scale carries { mph: {...}, kmh: {...} } over its own
  const scaleIn = (p, metric) => {
    const u = (p.reads === 'speed' && (metric ? p.kmh : p.mph)) || (p.reads === 'speedAlt' && (metric ? p.mph : p.kmh)) || null;
    return u ? { ...p, ...u } : p;
  };
  const deg = (a) => a * Math.PI / 180;
  const at = (cx, cy, r, a) => [cx + r * Math.sin(deg(a)), cy - r * Math.cos(deg(a))];   // a: degrees clockwise from up
  const fmtTick = (v, div) => { const x = v / (div || 1); return Math.abs(x) < 1 && x !== 0 ? String(Math.round(x * 10) / 10).replace(/^(-?)0\./, '$1.') : String(Math.round(x * 10) / 10); };
  function arcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = at(cx, cy, r, a0), [x1, y1] = at(cx, cy, r, a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  /** Draws one scale: ticks, numerals, a red zone and the needle; returns (d) => void, or null with no needle. */
  function carScale(s, p0, metric) {
    const p = scaleIn(p0, metric), span = p.max - p.min, a = (v) => p.a0 + (p.a1 - p.a0) * (Math.max(p.min, Math.min(p.max, v)) - p.min) / span;
    const g = svg('g', { class: `car-scale car-${p.reads}` }, s);
    if (p.arc) svg('path', { d: arcPath(p.cx, p.cy, p.r, p.a0, p.a1), fill: 'none', stroke: 'var(--face-ink)', 'stroke-width': p.arc }, g);
    if (p.red) {                                                     // the car's red zone: printed, a limit, in the one red
      const w = p.redW || 6;
      svg('path', { d: arcPath(p.cx, p.cy, p.r - w / 2, a(p.red[0]), a(p.red[1])), fill: 'none', stroke: 'var(--signal)', 'stroke-width': w, class: 'car-red' }, g);
    }
    const step = p.minor || p.major, n = Math.round(span / step);
    for (let i = 0; i <= n; i++) {
      const v = p.min + i * step, major = Math.abs(((v - p.min) / p.major) - Math.round((v - p.min) / p.major)) < 1e-6;
      const [x1, y1] = at(p.cx, p.cy, p.r, a(v)), [x2, y2] = at(p.cx, p.cy, p.r - (major ? (p.majorLen || 10) : (p.minorLen || 5)), a(v));
      svg('line', { x1, y1, x2, y2, stroke: 'var(--face-ink)', 'stroke-width': major ? (p.majorW || 2.4) : (p.minorW || 1) }, g);
    }
    if (p.label) {
      const top = p.labelMax != null ? p.labelMax : p.max;           // labelMin/labelMax: a numeral the print around it would cover is left off
      for (let v = p.labelMin != null ? p.labelMin : p.min; v <= top + 1e-9; v += p.label) {
        const [tx, ty] = at(p.cx, p.cy, p.labelR || p.r - 22, a(v));
        const t = svg('text', { x: tx.toFixed(1), y: (ty + (p.labelSize || 15) * 0.34).toFixed(1), 'text-anchor': 'middle', class: `${p.small ? 'dial-tiny' : 'dial-num car-num'}${ty > 130 && p.reads === 'speed' ? ' low' : ''}` }, g);
        if (p.labelSize) t.style.fontSize = `${p.labelSize}px`;
        t.textContent = fmtTick(v, p.labelDiv);
      }
    }
    for (const e of p.ends || []) {                                  // words at a scale's ends, as a fuel gauge's E and F
      const [tx, ty] = at(p.cx, p.cy, e.r || p.r - 16, a(e.v));
      svg('text', { x: tx.toFixed(1), y: (ty + 5).toFixed(1), 'text-anchor': 'middle', class: 'dial-label car-end' }, g).textContent = e.t;
    }
    if (!p.needle) return null;
    const nd = p.needle, live = CAR_READS.slice(0, 6).includes(p.reads) && p.reads !== 'speedAlt';
    const ng = svg('g', { class: 'car-needle' }, s);
    const w = nd.w || 3, len = nd.len || p.r - 6, tail = nd.tail || 0;
    const shape = nd.style === 'taper' ? `M${p.cx - w / 2} ${p.cy + tail} L${p.cx - 0.6} ${p.cy - len} L${p.cx + 0.6} ${p.cy - len} L${p.cx + w / 2} ${p.cy + tail} Z`
      : `M${p.cx - w / 2} ${p.cy + tail} L${p.cx - w / 2} ${p.cy - len + w} L${p.cx} ${p.cy - len} L${p.cx + w / 2} ${p.cy - len + w} L${p.cx + w / 2} ${p.cy + tail} Z`;
    const np = svg('path', { d: shape, fill: 'var(--car-needle, var(--face-ink))' }, ng);
    if (nd.hub) svg('circle', { cx: p.cx, cy: p.cy, r: nd.hub, class: 'car-hub' }, s);
    const spring = p.reads === 'speed' && nd.spring ? springNeedle() : null;
    return (d) => {
      let v = live ? carReading(p.reads, d, metric) : null;
      if (p.invert && v != null) v = -v;
      if (spring && v != null) v = spring(v, typeof performance !== 'undefined' ? performance.now() : Date.now());
      const known = v != null && Number.isFinite(v), rest = p.rest != null ? p.rest : (p.min <= 0 && p.max >= 0 ? 0 : p.min);
      // at rest a needle lies on its stop, which may sit just under the scale's start, clear of its first numeral, as a real one
      const restA = p.a0 + (p.a1 - p.a0) * (rest - p.min) / span;
      setA(ng, 'transform', `rotate(${(known ? a(v) : restA).toFixed(2)} ${p.cx} ${p.cy})`);
      setS(ng, 'opacity', known ? 1 : 0.25);                         // not measured: at rest, dim
      // panel round 2 (PR-2): a reading is never the alarm red, except the speed needle when you are over the corner's pace
      if (p.reads === 'speed') setA(np, 'fill', known && d.paceMph != null && d.speedMph > d.paceMph + 1 ? 'var(--signal)' : 'var(--car-needle, var(--face-ink))');
    };
  }
  /** A car's dial or meter from its data (theme.car.dial / theme.car.meter). Speed parts put the pace, Sight and Limit
   *  marks where the printed dial has them; `digital` is the speed numeral (the contract's 40 px floor), `bank` the Bank
   *  readout, `lamp` lights in the signal over the corner's pace, `mid` reads the pace in words. */
  function carGauge(parent, spec, slot) {
    const metric = metricNow();
    const vh = spec && Number.isFinite(spec.vb) && spec.vb >= 80 && spec.vb <= 200 ? spec.vb : 200;   // a meter may be wider than tall (a pod)
    const vw = spec && Number.isFinite(spec.vw) && spec.vw >= 80 && spec.vw <= 400 ? spec.vw : 200;   // or two dials wide
    const s = svg('svg', { viewBox: `0 0 ${vw} ${vh}`, class: `dial-svg car-gauge car-${slot}` }, parent);
    const ups = [];
    for (const p of (spec && spec.parts) || []) {
      switch (p.k) {
        case 'face': svg('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: p.deep ? 'var(--car-disc, var(--face))' : 'var(--face)', class: 'car-face' }, s); break;
        case 'ring': {
          svg('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: 'none', stroke: 'var(--car-ring, var(--face-ink))', 'stroke-width': p.w || 3, class: 'car-ring' }, s);
          for (let i = 0; i < (p.pegs || 0); i++) { const [x, y] = at(p.cx, p.cy, p.r - (p.w || 3) / 2 - 1.5, (p.peg0 || 0) + i * 360 / p.pegs); svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.2, class: 'car-peg' }, s); }
          break;
        }
        case 'pod': svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.rx || 0, class: 'car-pod' }, s); break;
        case 'disc': svg('circle', { cx: p.cx, cy: p.cy, r: p.r, class: 'car-disc' }, s); break;
        case 'box': svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.rx || 4, class: p.lcd ? 'car-box car-lcd' : 'car-box' }, s); break;
        case 'text': {
          const t = svg('text', { x: p.x, y: p.y, 'text-anchor': p.anchor || 'middle', class: p.cls === 'tiny' ? 'dial-tiny' : 'dial-label car-cap' }, s);
          t.textContent = p.t === '{unit}' ? (U() ? U().speedU().toUpperCase() : 'MPH') : p.t === '{alt}' ? (metric ? 'MPH' : 'km/h') : p.t;
          break;
        }
        case 'scale': { const u = carScale(s, p, metric); if (u) ups.push(u); break; }
        case 'marks': {                                              // pace, Sight and Limit on a speed scale, as the printed dial
          const q = scaleIn({ ...p, reads: 'speed' }, metric), a = (v) => q.a0 + (q.a1 - q.a0) * (Math.max(q.min, Math.min(q.max, v)) - q.min) / (q.max - q.min);
          const r = q.r, limit = svg('g', {}, s);
          svg('rect', { x: q.cx - 6, y: q.cy - r - 6, width: 12, height: 14, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, limit);
          const sight = svg('path', { d: `M${q.cx} ${q.cy - r + 8} L${q.cx - 5} ${q.cy - r - 2} L${q.cx + 5} ${q.cy - r - 2} Z`, fill: 'none', stroke: 'var(--amber)', 'stroke-width': 2 }, s);
          const pace = svg('path', { d: `M${q.cx} ${q.cy - r + 10} L${q.cx - 6} ${q.cy - r - 2} L${q.cx + 6} ${q.cy - r - 2} Z`, fill: 'var(--face-ink)' }, s);
          ups.push((d) => {
            const place = (node, v) => {
              if (v == null || !isFinite(v)) { setS(node, 'display', 'none'); return; }
              setS(node, 'display', ''); setA(node, 'transform', `rotate(${a(v).toFixed(2)} ${q.cx} ${q.cy})`);
            };
            place(pace, d.paceMph); place(sight, d.sightMph); place(limit, d.limitMph);
          });
          break;
        }
        case 'digital': {
          const t = svg('text', { x: p.x, y: p.y, 'text-anchor': 'middle', class: 'dial-digital' }, s);
          ups.push((d) => {
            const v = d.speedMph != null && Number.isFinite(d.speedMph) ? String(Math.round(d.speedMph)) : '--';
            setT(t, v);
            if (p.fit && v.length > 2) { setA(t, 'textLength', p.fit); setA(t, 'lengthAdjust', 'spacingAndGlyphs'); } else if (t.hasAttribute('textLength')) t.removeAttribute('textLength');
          });
          break;
        }
        case 'bank': {
          const t = svg('text', { x: p.x, y: p.y, 'text-anchor': 'middle', class: p.lcd ? 'dial-digital small car-on-lcd' : 'dial-digital small' }, s);
          let a = null, b = null;
          if (p.lines) { a = svg('tspan', { x: p.x }, t); b = svg('tspan', { x: p.x, dy: p.lines }, t); }
          ups.push((d) => {
            const txt = bankText(d.camberDeg);                       // "BANK --" until measured
            if (a) { setT(a, 'BANK '); setT(b, txt.slice(5)); } else setT(t, txt);
            t.classList.toggle('unk', !Number.isFinite(d.camberDeg));
          });
          break;
        }
        case 'lamp': {
          const l = svg('circle', { cx: p.x, cy: p.y, r: p.r || 5, class: 'car-lamp' }, s);
          ups.push((d) => { const on = Number.isFinite(d.speedMph) && d.paceMph != null && d.speedMph > d.paceMph + 1; l.classList.toggle('on', on); });
          break;
        }
        case 'mid': {
          const t = svg('text', { x: p.x, y: p.y, 'text-anchor': 'middle', class: 'dial-num car-mid' }, s);
          ups.push((d) => setT(t, `PACE ${fmt(d.paceMph)}`));
          break;
        }
        default: break;
      }
    }
    return (d) => ups.forEach((f) => f(d));
  }
  const carDial = (parent, theme) => carGauge(parent, theme && theme.car && theme.car.dial, 'dial');
  const carMeter = (parent, theme) => carGauge(parent, theme && theme.car && theme.car.meter, 'meter');

  // The theme contract's three renderers (theme_contract.js): a theme names its dial, meter and strip; Pro themes register
  // theirs here (register(slot, id, fn)). Everything around them, and the hazard plate, stays the page's.
  // (line: the Vetta Line numeral and ruler; mountLine draws it, since it owns the ruler's place. In the three-dial
  // layout the name is the printed dial.)
  const RENDER = { dial: { printed: (el) => speedDial(el, true), line: (el) => speedDial(el, true), sevenseg: sevenSeg, bezel: bezelDial, car: carDial }, meter: { gball: (el) => gDial(el, true), bars: barMeters, bezelg: bezelG, car: carMeter },
    strip: { roadbook: null, vfd: null } };                          // the VFD strip is the road book's, in the VFD skin
  function register(slot, id, fn) { if (RENDER[slot]) RENDER[slot][id] = fn; }
  const pick = (theme, slot, fallback) => (theme.renderers && RENDER[slot][theme.renderers[slot]]) || RENDER[slot][fallback];

  function mountDials(el, theme) {
    const printed = theme.gauge === 'printed';
    el.innerHTML = '';
    el.className = `cluster cluster-dials gauge-${theme.gauge}`;
    const sp = html('div', 'dial dial-speed', el);
    const center = html('div', 'cluster-center', el);
    const gg = html('div', 'dial dial-g', el);
    const u = [pick(theme, 'dial', 'printed')(sp, theme), readouts(center), odometer(center, printed), pick(theme, 'meter', 'gball')(gg, theme)];
    // PR-1: what a tap on each part explains (cockpit.js openExplain)
    const meterKind = theme.renderers && theme.renderers.meter;
    const car = theme.car || {};   // a car's own cluster says what its parts are (theme.car.dial.explain: 'tach' when the speed is in a window)
    sp.dataset.explain = 'speed';
    if (theme.renderers && theme.renderers.dial === 'car' && car.dial && car.dial.explain === 'tach') sp.dataset.explain = 'tach';
    gg.dataset.explain = meterKind === 'bars' ? 'meters' : meterKind === 'car' ? 'pod' : 'gball';
    if (meterKind === 'car' && car.meter && car.meter.explain === 'grip') gg.dataset.explain = 'grip';
    const odoEl = center.querySelector('.odo'); if (odoEl) odoEl.dataset.explain = 'trip';
    // Night (REVIEW2.md U-36): the trip readout steps aside for a quiet Trip key; a tap shows it for ten seconds
    const peek = html('button', 'trip-peek', center, 'Trip'); peek.type = 'button'; let peekT = 0;
    peek.addEventListener('click', () => { el.classList.add('show-trip'); clearTimeout(peekT); peekT = setTimeout(() => el.classList.remove('show-trip'), 10000); });
    // the live Vetta Score under the meter, in every theme (REVIEW.md 4.3: speed left, Limit centre, Score right); "--" until known
    const sc = html('div', 'g-score', gg), scV = html('b', '', sc, '--');
    sc.dataset.explain = 'score';
    html('span', '', sc, 'SCORE');
    u.push(d => { const t = Number.isFinite(d.score) ? String(Math.round(d.score)) : '--'; if (scV.textContent !== t) scV.textContent = t; });
    u.push(named(el));                                                // AM-3: each instrument said, value first
    if (theme.mascot === 'kit') u.push(kitRow(el));                  // Tapedeck's fox, a row of its own under the gauges
    // Keep the road type below Trip; a route without sector data has no known type.
    const roadType = html('div', 'dna-arch', center, 'Road: --');
    roadType.dataset.explain = 'road';
    u.push(d => {
      const type = d.sector && d.sector.archetype;
      // REVIEW4 U-67: in a drive, the road under the car by the map's name ("Road: I-275"), the same name the strip's quiet
      // line uses; otherwise the road's type, labelled (REVIEW.md 1.2, Replay): "Road: Fast & open", "Road: --" when unknown
      const name = typeof d.roadName === 'string' && d.roadName.trim() ? d.roadName.trim() : null;
      const text = `Road: ${name || roadKind(type) || '--'}`;
      if (roadType.textContent !== text) roadType.textContent = text;
      // with no route and no named road under the car there is nothing to know: the row steps aside instead of a lone "Road: --"
      roadType.hidden = !(d.routeOnly || d.sector || name) || (!name && type === 'Connector');   // U-55: a link road is nothing to read
    });
    return { update: (d) => u.forEach(f => f(d)) };
  }

  // Panel round 2 AM-3: VoiceOver names every instrument value first, unit spelled out, "unknown" for a dash
  // ("48 miles per hour, Speed"; say.js instruments). Each is one image with that name, so its drawn parts aren't read one
  // by one; the names change at most once a second. Sight carries a one-line description of what it means.
  function named(el) {
    const Say = root.ApexSay;
    if (!Say) return () => {};
    const parts = {
      speed: el.querySelector('.dial-speed'), limit: el.querySelector('.ro-limit'), sight: el.querySelector('.ro-sight'),
      grip: el.querySelector('.dial-g > svg'), score: el.querySelector('.g-score'), trip: el.querySelector('.odo'),
    };
    for (const k in parts) if (parts[k]) parts[k].setAttribute('role', 'img');
    if (parts.sight) {
      const id = `sightMeans${Math.random().toString(36).slice(2, 7)}`;
      html('span', 'sr-only', el, Say.SIGHT_MEANS).id = id;
      parts.sight.setAttribute('aria-describedby', id);
    }
    let at = -Infinity;
    return (d) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - at < 1000) return;
      at = now;
      const names = Say.instruments(d, U() ? U().speedU() : 'mph', U() ? U().longU() : 'mi');
      for (const k in parts) if (parts[k] && parts[k].getAttribute('aria-label') !== names[k]) parts[k].setAttribute('aria-label', names[k]);
    };
  }

  // ---- The Vetta Line cluster (Roadbook; theme.cluster 'line') ----------------------------------------------------------
  // One hero readout and a ruled line, printed on the panel's paper: the speed as a numeral you read at arm's length, and
  // under the whole row a ruler the speed is drawn along in ink, with the limit (the small sign), the corner's pace (the
  // ink mark) and the sight line (the amber mark) standing on it where they fall. Limit, Sight and the meter sit beside
  // the numeral, clearly second; the trip, the road and the Score are one quiet ledger line under the ruler.
  // The start: when the speed first reads (a drive or a replay begins) the numeral counts up and the line is drawn to it
  // once, COUNT_IN_MS, then both are the reading and nothing else moves. Reduced motion: no count, the reading at once.
  const COUNT_IN_MS = 700;
  const calm = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  /** How much of the reading shows `ms` after it first read: 0..1, easing out; 1 once the count is over or when `still`. */
  function countIn(ms, still) {
    if (still || !(ms >= 0) || ms >= COUNT_IN_MS) return 1;
    const t = ms / COUNT_IN_MS;
    return 1 - Math.pow(1 - t, 3);
  }
  function lineSpeed(parent, rule) {
    const s = svg('svg', { viewBox: '0 0 150 100', class: 'dial-svg line-svg', preserveAspectRatio: 'xMinYMax meet' }, parent);
    svg('text', { x: 1, y: 14, class: 'dial-label' }, s).textContent = U() ? U().speedU().toUpperCase() : 'MPH';
    const digital = svg('text', { x: -2, y: 97, class: 'dial-digital' }, s);
    // the ruler: its own drawing the width of the panel (percent positions, so it is never stretched)
    const r = svg('svg', { class: 'speed-line-svg', width: '100%', height: 34, 'aria-hidden': 'true' }, rule);
    const pct = (v) => `${(100 * Math.max(0, Math.min(top(), v)) / top()).toFixed(2)}%`;
    const step = top() > 160 ? 20 : 10, majorEvery = top() > 160 ? 40 : 20;
    const inner = r; r.style.overflow = 'visible';                  // the end marks and numerals may run into the line's side padding
    svg('line', { x1: 0, x2: '100%', y1: 13, y2: 13, class: 'sl-base' }, inner);
    for (let v = 0; v <= top(); v += step) {
      const major = v % majorEvery === 0;
      svg('line', { x1: pct(v), x2: pct(v), y1: 13, y2: major ? 20 : 17, class: major ? 'sl-tick major' : 'sl-tick' }, inner);
      if (major) svg('text', { x: pct(v), y: 33, 'text-anchor': 'middle', class: 'sl-num' }, inner).textContent = v;
    }
    const fill = svg('line', { x1: 0, x2: 0, y1: 13, y2: 13, class: 'sl-fill' }, inner);
    const mark = (cls, draw) => { const g = svg('svg', { x: 0, y: 0, class: 'sl-mark ' + cls }, inner); g.style.overflow = 'visible'; draw(g); return g; };
    const limit = mark('sl-limit', (g) => svg('rect', { x: -4.5, y: 0.75, width: 9, height: 11 }, g));
    const sight = mark('sl-sight', (g) => svg('path', { d: 'M0 11.5 L-5 2 L5 2 Z' }, g));
    const pace = mark('sl-pace', (g) => svg('path', { d: 'M0 12.5 L-5.5 2 L5.5 2 Z' }, g));
    const tip = mark('sl-tip', (g) => svg('circle', { cx: 0, cy: 13, r: 5 }, g));
    let since = null;
    return (d) => {
      const live = d.speedMph != null;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!live) since = null; else if (since == null) since = now;
      const k = live ? countIn(now - since, calm()) : 1, shown = live ? d.speedMph * k : 0;
      setT(digital, live ? Math.round(shown) : '--');
      digital.classList.toggle('unk', !live);
      setA(fill, 'x2', pct(shown)); setA(tip, 'x', pct(shown));
      setS(tip, 'display', live ? '' : 'none');
      // panel round 2 (PR-2): readings are ink; the line's end takes the signal only when you are over the corner's pace
      tip.classList.toggle('over', live && d.paceMph != null && d.speedMph > d.paceMph + 1);
      const place = (node, mph) => {
        if (mph == null || !isFinite(mph)) { setS(node, 'display', 'none'); return; }
        setS(node, 'display', ''); setA(node, 'x', pct(mph));
      };
      place(pace, d.paceMph); place(sight, d.sightMph); place(limit, d.limitMph);
    };
  }

  function mountLine(el, theme) {
    el.innerHTML = '';
    el.className = `cluster cluster-line gauge-${theme.gauge}`;
    const sp = html('div', 'dial dial-speed', el);
    const ro = html('div', 'cluster-center', el);
    const gg = html('div', 'dial dial-g', el);
    const rule = html('div', 'speed-line', el);
    const ledger = html('div', 'ledger', el);
    const u = [lineSpeed(sp, rule), readouts(ro), odometer(ledger, false), gDial(gg, true, true)];
    sp.dataset.explain = 'speed'; gg.dataset.explain = 'gball'; rule.dataset.explain = 'speed';
    ledger.querySelector('.odo').dataset.explain = 'trip';
    // Night (REVIEW2.md U-36): the trip readout steps aside for a quiet Trip key; a tap shows it for ten seconds
    const peek = html('button', 'trip-peek', ledger, 'Trip'); peek.type = 'button'; let peekT = 0;
    peek.addEventListener('click', () => { el.classList.add('show-trip'); clearTimeout(peekT); peekT = setTimeout(() => el.classList.remove('show-trip'), 10000); });
    const roadType = html('div', 'dna-arch', ledger, 'Road: --');
    roadType.dataset.explain = 'road';
    // the live Vetta Score closes the ledger; "--" until known
    const sc = html('div', 'g-score', ledger), scV = html('b', '', sc, '--');
    sc.dataset.explain = 'score';
    html('span', '', sc, 'SCORE');
    u.push(d => { const t = Number.isFinite(d.score) ? String(Math.round(d.score)) : '--'; if (scV.textContent !== t) scV.textContent = t; sc.classList.toggle('unk', t === '--'); });
    u.push(named(el));                                                // AM-3: each instrument said, value first
    u.push(d => {
      const type = d.sector && d.sector.archetype;
      // REVIEW4 U-67: in a drive, the road under the car by the map's name; otherwise the road's type, labelled
      const name = typeof d.roadName === 'string' && d.roadName.trim() ? d.roadName.trim() : null;
      const text = `Road: ${name || roadKind(type) || '--'}`;
      if (roadType.textContent !== text) roadType.textContent = text;
      roadType.hidden = !(d.routeOnly || d.sector || name) || (!name && type === 'Connector');   // U-55: a link road is nothing to read
    });
    return { update: (d) => u.forEach(f => f(d)) };
  }

  function mountCluster(el, theme) {
    return theme && theme.cluster === 'line' ? mountLine(el, theme) : mountDials(el, theme);
  }

  const api = { mountCluster, renderNotes, tulipSVG, lockup, stripCode, register, kitPose, KIT, springNeedle, SPEED_MAX, carGauge, carReading, CAR_READS,
    sightCell, sightValue, sightShort, slowLine, bankText, roadKind, EXPLAIN, explainAllowed, countIn, COUNT_IN_MS, ADVANCE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexInstruments = api;
})(typeof window !== 'undefined' ? window : globalThis);
