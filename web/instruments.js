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
      html('span', len > 18 ? 'xlong' : len > 11 ? 'long' : '', c, lk.head);
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
        svg('text', { x: tx, y: ty + 5, 'text-anchor': 'middle', class: 'dial-num' }, s).textContent = v;
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
      needle.setAttribute('transform', `rotate(${ang(live ? d.speedMph : 0) + 90} 100 100)`);
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
    const limit = cell('Limit', 'ro-limit');
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

  // The theme contract's three renderers (theme_contract.js): a theme names its dial, meter and strip; Pro themes register
  // theirs here (register(slot, id, fn)). Everything around them, and the hazard plate, stays the page's.
  const RENDER = { dial: { printed: (el) => speedDial(el, true) }, meter: { gball: (el) => gDial(el, true) }, strip: { roadbook: null } };
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
    // Keep the road type below Trip; a route without sector data has no known type.
    const roadType = html('div', 'dna-arch', center, 'Road: --');
    u.push(d => {
      const type = d.sector && d.sector.archetype;
      // labelled (REVIEW.md 1.2, Replay): "Road: Fast & open", "Road: --" when the sector is unknown
      roadType.textContent = `Road: ${type === 'Flowing sweepers' ? 'Sweepers' : type === 'Fast open' ? 'Fast & open' : (type || '--')}`;
    });
    return { update: (d) => u.forEach(f => f(d)) };
  }

  function mountCluster(el, theme) {
    return mountDials(el, theme);
  }

  const api = { mountCluster, renderNotes, tulipSVG, lockup, register, SPEED_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexInstruments = api;
})(typeof window !== 'undefined' ? window : globalThis);
