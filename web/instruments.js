// ApexInstruments — Road book renderers for the binnacle and pace-note strip.
// Flat vector only: precision comes from linework and type, never from fake materials.
//
//   mountCluster(el, theme) -> { update(d) }   d = { speedMph, paceMph, sightMph, limitMph,
//                                                   latG, lonG, camberDeg, tripMi, totalMi, sector }
//   renderNotes(el, theme, notes)               notes = [{ type, code, call, sub, dist, unit,
//                                                          dir, severity, turnRad, mods }]
//   tulipSVG(note, ink, accent)                 roadbook tulip diagram (string)
//   lockup(call, mods)                          the call split for the strip: { head, tail: [{ text, warn }] } (pure)
(function (root) {
  'use strict';
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
  const fmt = (v) => (v == null || !isFinite(v) ? '--' : String(Math.round(v)));

  // -------------------------------------------------------------------------
  // Tulip diagrams (FIA roadbook convention: entry dot at the bottom, the road as
  // the driver meets it, arrow on the exit). Radius encodes severity.
  // -------------------------------------------------------------------------
  // The call lockup (docs/design/REVIEW.md roadmap 3): the call itself big ("Left 4 minus"), its modifiers and caution one
  // size down ("tightens · long · care") so a long call never wraps to four lines. The modifiers that change what you do
  // (tightens, off-camber, over crest) are marked to be drawn in the accent. Plain-words calls carry no modifiers: whole.
  const WARN_MODS = new Set(['tightens', 'off-camber', 'over crest']);
  function lockup(call, mods) {
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
    for (const c of caution) if (c.trim()) tail.push({ text: c.trim().toLowerCase(), warn: true });
    return { head: text.slice(0, cut).trim(), tail };
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
      body += `<path d="M${p0} L${p1} A${r} ${r} 0 0 ${left ? 0 : 1} ${p2} L${p3}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
      if (note.type === 'alpr') body += `<rect x="62" y="38" width="22" height="14" fill="none" stroke="${accent}" stroke-width="2.6"/><circle cx="73" cy="45" r="3.5" fill="${accent}"/><path d="M62 45 L54 45" stroke="${accent}" stroke-width="2.6"/>`;
    }
    return `<svg viewBox="0 0 100 100" class="tulip">${body}</svg>`;
  }

  // -------------------------------------------------------------------------
  // Pace-note strip renderers
  // -------------------------------------------------------------------------
  function renderNotes(el, theme, notes) {
    const custom = theme && theme.renderers && RENDER.strip[theme.renderers.strip];   // a Pro theme's strip (the contract's third)
    if (custom) return custom(el, theme, notes, { lockup, tulipSVG, hazard: (n) => HAZARD_TYPES.has(n.type) });
    el.innerHTML = '';
    el.className = `notes notes-${theme.notes}`;
    const ink = css('--panel-ink'), accent = css('--accent'), signal = css('--signal');
    if (!notes.length) {
      const q = html('div', 'note-quiet', el);
      html('b', '', q, 'Clear');
      html('span', '', q, notes.quietText || '');
      return;
    }
    // When the lead note changes (the old one was passed), the page slides on for 160 ms. The strip is rebuilt every
    // frame, so each rebuild resumes the slide where it was (negative delay) instead of restarting it.
    const lead = notes[0].key, t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (lead !== undefined && el._lead !== undefined && lead !== el._lead) el._advanceAt = t0;
    el._lead = lead;
    const since = el._advanceAt === undefined ? Infinity : t0 - el._advanceAt;
    // Road book page: up to three boxes, distance | tulip | note.
    notes.slice(0, 3).forEach((n, i) => {
      // a measured hazard that becomes the call takes the hazard plate's colours (docs/design/REVIEW.md 4.3)
      const hz = HAZARD_TYPES.has(n.type);
      const box = html('div', 'rb-box' + (i === 0 ? ' now' : '') + (hz && i === 0 ? ' hz' : ''), el);
      if (since < 160) { box.classList.add('advance'); box.style.animationDelay = `-${Math.round(since)}ms`; }
      const d = html('div', 'rb-dist', box);
      html('b', '', d, n.dist);
      html('small', '', d, n.unit);
      const t = html('div', 'rb-tulip', box);
      t.innerHTML = hz && i === 0 ? tulipSVG(n, css('--hz-ink') || '#fff', css('--hz-edge') || '#FF7A1A') : tulipSVG(n, ink, n.type === 'corner' ? accent : hz ? (css('--hz-edge') || signal) : signal);
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
        const m = html('span', 'rb-mods', c);
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
    const pace = svg('path', { d: 'M100 20 L94 8 L106 8 Z', fill: 'var(--accent)' }, s);
    const needle = svg('g', {}, s);
    const np = svg('path', { d: printed ? 'M98.6 112 L100 24 L101.4 112 Z' : 'M97.5 108 L100 22 L102.5 108 Z', fill: printed ? 'var(--signal)' : 'var(--face-ink)' }, needle);
    svg('circle', { cx: 100, cy: 100, r: printed ? 5 : 7, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, s);
    const digital = svg('text', { x: 100, y: 182, 'text-anchor': 'middle', class: 'dial-digital' }, s);
    return (d) => {
      const live = d.speedMph != null;
      needle.setAttribute('transform', `rotate(${ang(live ? (d.needleMph != null ? d.needleMph : d.speedMph) : 0) + 90} 100 100)`);
      needle.style.opacity = live ? 1 : 0.25;
      np.setAttribute('fill', live && d.paceMph != null && d.speedMph > d.paceMph + 1 ? 'var(--signal)' : (printed ? 'var(--signal)' : 'var(--face-ink)'));
      digital.textContent = live ? Math.round(d.speedMph) : '--';
      const place = (node, mph) => {
        if (mph == null || !isFinite(mph)) { node.style.display = 'none'; return; }
        node.style.display = '';
        node.setAttribute('transform', `rotate(${ang(mph) + 90} 100 100)`);
      };
      place(pace, d.paceMph); place(sight, d.sightMph); place(limit, d.limitMph);
    };
  }

  function gDial(parent, printed) {
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'dial-svg' }, parent);
    svg('circle', { cx: 100, cy: 100, r: 97, fill: 'var(--face)', stroke: printed ? 'var(--face-ink)' : 'var(--rule)', 'stroke-width': printed ? 2.5 : 1.5 }, s);
    const G = 72 / 0.8;
    [0.25, 0.5, 0.75].forEach(g => svg('circle', { cx: 100, cy: 100, r: g * G, fill: 'none', stroke: g === 0.5 ? 'var(--face-ink)' : 'var(--face-dim)', 'stroke-width': g === 0.5 ? 1 : 0.7 }, s));
    svg('line', { x1: 28, y1: 100, x2: 172, y2: 100, stroke: 'var(--face-dim)', 'stroke-width': 0.7 }, s);
    svg('line', { x1: 100, y1: 28, x2: 100, y2: 172, stroke: 'var(--face-dim)', 'stroke-width': 0.7 }, s);
    svg('text', { x: 100, y: 48, 'text-anchor': 'middle', class: 'dial-label' }, s).textContent = 'BRAKE';
    svg('text', { x: 100 + 0.5 * G + 3, y: 96, class: 'dial-tiny' }, s).textContent = '.5';
    for (let d = -10; d <= 10; d += 2.5) {
      const a = 90 - d * 3, [x1, y1] = polar(92, a), [x2, y2] = polar(d % 5 === 0 ? 84 : 88, a);
      svg('line', { x1, y1, x2, y2, stroke: d === 0 ? 'var(--face-ink)' : 'var(--face-dim)', 'stroke-width': d === 0 ? 1.8 : 1 }, s);
    }
    const bank = svg('path', { d: 'M100 182 L96 172 L104 172 Z', fill: 'var(--accent)' }, s);
    const bankTxt = svg('text', { x: 100, y: 158, 'text-anchor': 'middle', class: 'dial-digital small' }, s);
    const trail = svg('polyline', { points: '', fill: 'none', stroke: 'var(--accent)', 'stroke-opacity': 0.4, 'stroke-width': 2 }, s);
    const ball = svg('circle', { cx: 100, cy: 100, r: 7, fill: 'var(--accent)' }, s);
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
      ball.setAttribute('cx', x); ball.setAttribute('cy', y);
      ball.setAttribute('fill', !known ? 'var(--face-dim)' : (Math.hypot(d.latG, d.lonG) > 0.45 ? 'var(--signal)' : 'var(--accent)'));
      trail.setAttribute('points', pts.join(' '));
      if (d.camberDeg != null) {
        bank.style.display = '';
        bank.setAttribute('transform', `rotate(${-Math.max(-10, Math.min(10, d.camberDeg)) * 3} 100 100)`);
        bankTxt.textContent = `BANK ${d.camberDeg >= 0 ? '+' : ''}${d.camberDeg.toFixed(1)}°`;
      } else { bank.style.display = 'none'; bankTxt.textContent = ''; }
    };
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
    eye.style.display = 'none';
    return (d) => {
      limit.v.textContent = fmt(d.limitMph);
      limit.c.classList.toggle('unknown', !Number.isFinite(d.limitMph));   // a sign only when there is a limit to show
      const both = [d.paceMph, d.sightMph].filter(v => Number.isFinite(v));
      const v = both.length ? Math.min(...both) : null;
      // "Open" when nothing limits you (the sight line at its cap, no corner asking for less): the number there would only
      // be the cap's own speed (125 mph), not something the road says
      sight.v.textContent = d.sightOpen ? 'Open' : fmt(v);
      eye.style.display = !d.sightOpen && both.length === 2 && d.sightMph < d.paceMph ? '' : 'none';
      sight.c.classList.toggle('short', !d.sightOpen && v != null && Number.isFinite(d.speedMph) && d.speedMph > v + 1);
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
        for (const ch of s) html('span', ch === '.' ? 'dot' : 'dg', digits, ch);
      }
      total.textContent = d.totalMi != null ? `of ${d.totalMi.toFixed(1)}` : '';
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
    const sub = svg('text', { x: 186, y: 160, 'text-anchor': 'end', class: 'dial-label vfd-label' }, s);
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
      digital.textContent = v; s.setAttribute('aria-label', `${v} ${U() ? U().speedU() : 'mph'}`);
      sub.textContent = d.limitMph != null ? `LIMIT ${Math.round(d.limitMph)}` : '';
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
      cells.forEach((cell, r) => { cell.className = r < n ? (amber && v && v.amber ? 'on amber' : 'on') : ''; });
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
    const says = html('div', 'kit-says', row); html('span', 'vfd-cap', says, 'KIT SAYS'); const line = html('b', '', says, '--');
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pose = null;
    return (d) => {
      const p = kitPose(d, still ? null : (typeof performance !== 'undefined' ? performance.now() : Date.now()));
      if (p !== pose) {
        pose = p;
        const rows = KIT[p];
        dots.forEach((c, i) => { c.setAttribute('class', KIT_CLASS[rows[Math.floor(i / KIT_W)][i % KIT_W]] || ''); });
      }
      if (d.kitLine !== undefined && line.textContent !== (d.kitLine || '--')) line.textContent = d.kitLine || '--';
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

  // The theme contract's three renderers (theme_contract.js): a theme names its dial, meter and strip; Pro themes register
  // theirs here (register(slot, id, fn)). Everything around them, and the hazard plate, stays the page's.
  const RENDER = { dial: { printed: (el) => speedDial(el, true), sevenseg: sevenSeg, bezel: bezelDial }, meter: { gball: (el) => gDial(el, true), bars: barMeters, bezelg: bezelG },
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
    const u = [pick(theme, 'dial', 'printed')(sp), readouts(center), odometer(center, printed), pick(theme, 'meter', 'gball')(gg)];
    // Night (REVIEW2.md U-36): the trip readout steps aside for a quiet Trip key; a tap shows it for ten seconds
    const peek = html('button', 'trip-peek', center, 'Trip'); peek.type = 'button'; let peekT = 0;
    peek.addEventListener('click', () => { el.classList.add('show-trip'); clearTimeout(peekT); peekT = setTimeout(() => el.classList.remove('show-trip'), 10000); });
    // the live Vetta Score under the meter, in every theme (REVIEW.md 4.3: speed left, Limit centre, Score right); "--" until known
    const sc = html('div', 'g-score', gg), scV = html('b', '', sc, '--');
    html('span', '', sc, 'SCORE');
    u.push(d => { const t = Number.isFinite(d.score) ? String(Math.round(d.score)) : '--'; if (scV.textContent !== t) scV.textContent = t; });
    if (theme.mascot === 'kit') u.push(kitRow(el));                  // Tapedeck's fox, a row of its own under the gauges
    // Keep the road type below Trip; a route without sector data has no known type.
    const roadType = html('div', 'dna-arch', center, 'Road: --');
    u.push(d => {
      const type = d.sector && d.sector.archetype;
      // REVIEW4 U-67: in a drive, the road under the car by the map's name ("Road: I-275"), the same name the strip's quiet
      // line uses; otherwise the road's type, labelled (REVIEW.md 1.2, Replay): "Road: Fast & open", "Road: --" when unknown
      const name = typeof d.roadName === 'string' && d.roadName.trim() ? d.roadName.trim() : null;
      const text = `Road: ${name || (type === 'Flowing sweepers' ? 'Sweepers' : type === 'Fast open' ? 'Fast & open' : (type || '--'))}`;
      if (roadType.textContent !== text) roadType.textContent = text;
      // with no route and no named road under the car there is nothing to know: the row steps aside instead of a lone "Road: --"
      roadType.hidden = !(d.routeOnly || d.sector || name);
    });
    return { update: (d) => u.forEach(f => f(d)) };
  }

  function mountCluster(el, theme) {
    return mountDials(el, theme);
  }

  const api = { mountCluster, renderNotes, tulipSVG, lockup, register, kitPose, KIT, springNeedle, SPEED_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexInstruments = api;
})(typeof window !== 'undefined' ? window : globalThis);
