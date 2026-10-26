// ApexInstruments — theme-driven renderers for the binnacle and the pace-note strip.
// Flat vector only: precision comes from linework and type, never from fake materials.
//
//   mountCluster(el, theme) -> { update(d) }   d = { speedMph, paceMph, sightMph, limitMph,
//                                                   latG, lonG, camberDeg, tripMi, totalMi, sector }
//   renderNotes(el, theme, notes)               notes = [{ type, code, call, sub, dist, unit,
//                                                          dir, severity, turnRad, mods }]
//   tulipSVG(note, ink, accent)                 roadbook tulip diagram (string)
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
    el.innerHTML = '';
    el.className = `notes notes-${theme.notes}`;
    const ink = css('--panel-ink'), accent = css('--accent'), signal = css('--signal');
    if (!notes.length) {
      const q = html('div', 'note-quiet', el);
      html('b', '', q, 'Clear');
      html('span', '', q, notes.quietText || '');
      return;
    }
    if (theme.notes === 'roadbook') {
      // Roadbook page: up to three boxes, distance | tulip | note, like the printed book.
      notes.slice(0, 3).forEach((n, i) => {
        const box = html('div', 'rb-box' + (i === 0 ? ' now' : ''), el);
        const d = html('div', 'rb-dist', box);
        html('b', '', d, n.dist);
        html('small', '', d, n.unit);
        const t = html('div', 'rb-tulip', box);
        t.innerHTML = tulipSVG(n, ink, n.type === 'corner' ? accent : signal);
        const c = html('div', 'rb-call', box);
        if (n.type !== 'corner' && n.code.toLowerCase() !== n.call.toLowerCase()) html('b', '', c, n.code);
        html('span', '', c, n.call);
      });
      return;
    }
    // 'tulip' (stage)
    const n = notes[0];
    const row = html('div', 'pn' + (n.type !== 'corner' ? ' hazard' : ''), el);
    const t = html('div', 'pn-tulip', row);
    t.innerHTML = tulipSVG(n, ink, n.type === 'corner' ? accent : signal);
    const txt = html('div', 'pn-text', row);
    html('div', 'pn-call', txt, n.call);
    html('div', 'pn-sub', txt, n.sub);
    const d = html('div', 'pn-dist', row);
    html('b', '', d, n.dist);
    html('small', '', d, n.unit);
    if (notes[1]) {
      const nx = html('div', 'pn-next', row);
      nx.innerHTML = tulipSVG(notes[1], css('--panel-dim'), css('--panel-dim'));
    }
  }

  // -------------------------------------------------------------------------
  // Dial cluster (stage / roadbook)
  // -------------------------------------------------------------------------
  const ang = (mph) => 135 + 270 * Math.max(0, Math.min(SPEED_MAX, mph)) / SPEED_MAX;
  const polar = (r, deg) => [100 + r * Math.cos(deg * Math.PI / 180), 100 + r * Math.sin(deg * Math.PI / 180)];

  function speedDial(parent, printed) {
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'dial-svg' }, parent);
    svg('circle', { cx: 100, cy: 100, r: 97, fill: 'var(--face)', stroke: printed ? 'var(--face-ink)' : 'var(--rule)', 'stroke-width': printed ? 2.5 : 1.5 }, s);
    // scale arc
    const [ax, ay] = polar(90, 135), [bx, by] = polar(90, 405);
    svg('path', { d: `M${ax} ${ay} A90 90 0 1 1 ${bx} ${by}`, fill: 'none', stroke: 'var(--face-ink)', 'stroke-width': printed ? 1.8 : 0.8 }, s);
    for (let v = 0; v <= SPEED_MAX; v += 5) {
      const major = v % 20 === 0, mid = v % 10 === 0;
      const a = ang(v), [x1, y1] = polar(90, a), [x2, y2] = polar(major ? 76 : mid ? 81 : 85, a);
      svg('line', { x1, y1, x2, y2, stroke: 'var(--face-ink)', 'stroke-width': major ? 2.4 : mid ? 1.3 : 0.8 }, s);
      if (major) {
        const [tx, ty] = polar(63, a);
        svg('text', { x: tx, y: ty + 5, 'text-anchor': 'middle', class: 'dial-num' }, s).textContent = v;
      }
    }
    svg('text', { x: 100, y: 142, 'text-anchor': 'middle', class: 'dial-label' }, s).textContent = 'MPH';
    const limit = svg('g', {}, s);
    svg('rect', { x: 94, y: 4, width: 12, height: 14, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, limit);
    const sight = svg('path', { d: 'M100 18 L95 8 L105 8 Z', fill: 'none', stroke: 'var(--amber)', 'stroke-width': 2 }, s);
    const pace = svg('path', { d: 'M100 20 L94 8 L106 8 Z', fill: 'var(--accent)' }, s);
    const needle = svg('g', {}, s);
    const np = svg('path', { d: printed ? 'M98.6 112 L100 24 L101.4 112 Z' : 'M97.5 108 L100 22 L102.5 108 Z', fill: printed ? 'var(--signal)' : 'var(--face-ink)' }, needle);
    svg('circle', { cx: 100, cy: 100, r: printed ? 5 : 7, fill: 'var(--face)', stroke: 'var(--face-ink)', 'stroke-width': 1.6 }, s);
    const digital = svg('text', { x: 100, y: 168, 'text-anchor': 'middle', class: 'dial-digital' }, s);
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
    const bankTxt = svg('text', { x: 100, y: 160, 'text-anchor': 'middle', class: 'dial-digital small' }, s);
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
      return { value, v };
    };
    const limit = cell('Limit', 'ro-limit');
    const road = cell('Road', 'ro-pace');
    const eye = svg('svg', { viewBox: '0 0 24 24', width: 12, height: 12, class: 'ro-eye', 'aria-hidden': 'true' }, road.value);
    svg('path', { d: 'M2 12 Q12 2 22 12 Q12 22 2 12 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, eye);
    svg('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor' }, eye);
    eye.style.display = 'none';
    return (d) => {
      limit.v.textContent = fmt(d.limitMph);
      const both = [d.paceMph, d.sightMph].filter(v => Number.isFinite(v));
      road.v.textContent = fmt(both.length ? Math.min(...both) : null);
      eye.style.display = both.length === 2 && d.sightMph < d.paceMph ? '' : 'none';
    };
  }

  function odometer(parent, boxed) {
    const o = html('div', 'odo' + (boxed ? ' boxed' : ''), parent);
    const digits = html('div', 'odo-digits', o);
    const meta = html('div', 'odo-meta', o);
    html('span', '', meta, 'Trip mi');
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

  function mountDials(el, theme) {
    const printed = theme.gauge === 'printed';
    el.innerHTML = '';
    el.className = `cluster cluster-dials gauge-${theme.gauge}`;
    const sp = html('div', 'dial dial-speed', el);
    const center = html('div', 'cluster-center', el);
    const gg = html('div', 'dial dial-g', el);
    const u = [speedDial(sp, printed), readouts(center), odometer(center, printed), gDial(gg, printed)];
    // Keep the road type below Trip; a route without sector data has no known type.
    const roadType = html('div', 'dna-arch', center, '--');
    u.push(d => {
      const type = d.sector && d.sector.archetype;
      roadType.textContent = type === 'Flowing sweepers' ? 'Sweepers' : type === 'Fast open' ? 'Fast & open' : (type || '--');
    });
    return { update: (d) => u.forEach(f => f(d)) };
  }

  function mountCluster(el, theme) {
    return mountDials(el, theme);
  }

  root.ApexInstruments = { mountCluster, renderNotes, tulipSVG, SPEED_MAX };
})(window);
