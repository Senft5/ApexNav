// Drive view: one drive read at a glance. A plan map coloured by speed, three aligned lanes (speed, lateral g, braking/throttle g) with
// the corners marked, and a scrubber that ties them together. Pure DOM/SVG, drawn at the real pixel width so text stays crisp on a phone.
// Colours come from the active theme (ApexThemes), units are converted only here for display (CLAUDE.md section 3).
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const G = 9.80665;
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmtT = (s) => { const t = Math.round(s); return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Summary numbers for the header strip; null where the drive has no such data. */
  function summarize(d, Core) {
    const t = Core.elapsedS(d.speed_mps), n = d.lat.length;
    const mx = (a) => { let m = -Infinity; for (const v of a || []) if (finite(v)) m = Math.max(m, Math.abs(v)); return m === -Infinity ? null : m; };
    let gain = null;
    if (d.elev) { gain = 0; for (let i = 1; i < n; i++) { const dz = d.elev[i] - d.elev[i - 1]; if (dz > 0 && dz < 5) gain += dz; } }
    return { km: d.dist[n - 1] / 1000, duration_s: t[n - 1], top_mps: Math.max(...d.speed_mps), peak_lat_g: mx(d.lat_g), peak_brake_g: d.lon_g ? Math.max(0, -Math.min(...d.lon_g.filter(finite))) : null, climb_m: gain };
  }

  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  /** One line of coaching for a Core.coach corner, or null. Units converted here only (metres, mph). */
  function tipText(x, MPH) {
    const t = x && x.tip;
    if (!t) return null;
    const m = Math.round(t.value);
    switch (t.kind) {
      case 'min_speed': return `Your best pass was ${Math.max(1, Math.round(t.value * MPH))} mph quicker at the slowest point`;
      case 'brake_later': return `Brake ${m} m later, like your best pass`;
      case 'throttle_sooner': return `Back on the throttle ${m} m sooner, like your best pass`;
      case 'coast': return t.vs_best ? `${m} m more coasting than your best pass` : `${m} m coasting between brake and throttle`;
      case 'brake_after_apex': return `Still braking after the apex (${t.value.toFixed(2)} g)`;
      case 'early_apex': return `Slowest ${m} m before the apex: turn in later`;
      default: return null;
    }
  }

  /**
   * Friction circle: every measured 5 m sample as lateral g (left on the left) against longitudinal g (throttle up,
   * braking down), the driver's own envelope (Core.ggEnvelope, ink) and the scrubbed corner's samples on top (accent).
   */
  function ggView(d, Core, C) {
    if (!d.lat_g || !d.lon_g || !Core.ggEnvelope) return null;
    const env = Core.ggEnvelope(d.lat_g, d.lon_g, d.g_known || null);
    if (env.peak_g == null) return null;
    const S = 240, c0 = S / 2, R = Math.max(0.6, env.peak_g, ...env.radius_g.filter((r) => r != null)) * 1.15, k = (c0 - 14) / R;
    const xy = (la, lo) => [c0 - la * k, c0 - lo * k];
    const ok = (i) => (!d.g_known || d.g_known[i]) && finite(d.lat_g[i]) && finite(d.lon_g[i]);
    let dots = '';
    const n = d.lat_g.length, step = Math.max(1, Math.floor(n / 1500));
    for (let i = 0; i < n; i += step) if (ok(i)) { const [x, y] = xy(d.lat_g[i], d.lon_g[i]); dots += `M${x.toFixed(1)} ${y.toFixed(1)}h0`; }
    const N = env.radius_g.length, half = Math.PI / N;
    let hull = '', open = false;
    for (let q = 0; q <= N; q++) {                                   // envelope through each known slice's middle; gaps stay gaps
      const r = env.radius_g[q % N];
      if (r == null) { open = false; continue; }
      const a = (q % N) * 2 * half, [x, y] = xy(r * Math.sin(a), r * Math.cos(a));   // slices are centred on their angle
      hull += `${open ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; open = true;
    }
    const ring = (g) => `<circle cx="${c0}" cy="${c0}" r="${(g * k).toFixed(1)}" fill="none" stroke="${C.rule}" stroke-dasharray="2 4"/><text x="${c0 + 3}" y="${(c0 - g * k - 3).toFixed(1)}" font-size="9" fill="${C.panelDim}">${g.toFixed(1)} g</text>`;
    const txt = (x, y, a, t) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="10" fill="${C.panelDim}">${t}</text>`;
    const box = el('div', 'dv-gg'), pic = el('div', 'dv-gg-pic'), hot = el('div', 'dv-gg-hot'), cap = el('p', 'note');
    cap.setAttribute('aria-live', 'polite');
    pic.innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Friction circle: cornering against braking and throttle g">`
      + ring(0.5) + (R > 1.05 ? ring(1.0) : '')
      + `<line x1="${c0}" x2="${c0}" y1="6" y2="${S - 6}" stroke="${C.rule}"/><line y1="${c0}" y2="${c0}" x1="6" x2="${S - 6}" stroke="${C.rule}"/>`
      + `<path d="${dots}" stroke="${C.panelDim}" stroke-width="3" stroke-linecap="round" opacity="0.35"/>`
      + `<path d="${hull}" fill="none" stroke="${C.panelInk}" stroke-width="1.6" stroke-linejoin="round"/>`
      + txt(c0, 12, 'middle', 'Throttle') + txt(c0, S - 4, 'middle', 'Brake') + txt(4, c0 - 4, 'start', 'Left') + txt(S - 4, c0 - 4, 'end', 'Right') + '</svg>';
    const g2 = (v) => (v == null ? '--' : `${v.toFixed(2)} g`);
    const base = `Your grip on this drive: braking ${g2(env.brake_g)}, cornering left ${g2(env.left_g)} and right ${g2(env.right_g)}, throttle ${g2(env.throttle_g)}.`;
    cap.textContent = base;
    const head = el('h3', null, 'Grip circle');
    box.append(head, pic, cap);
    pic.append(hot);
    let shown = -2;
    function show(c, kc) {
      if (kc === shown) return; shown = kc;
      if (!c) { hot.innerHTML = ''; cap.textContent = base; return; }
      let p = '';
      const lo = Math.max(0, c.start - 20);                          // 100 m before turn-in: the brake zone, not the straight before it
      for (let i = lo; i <= c.end; i++) if (ok(i)) { const [x, y] = xy(d.lat_g[i], d.lon_g[i]); p += `${p ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
      hot.innerHTML = `<svg viewBox="0 0 ${S} ${S}" aria-hidden="true"><path d="${p}" fill="none" stroke="${C.accent}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/></svg>`;
      const use = Core.gripUse(d.lat_g, d.lon_g, lo, c.end, env, d.g_known || null);
      cap.textContent = `Corner ${kc + 1}, from 100 m before turn-in to the exit: ${use == null ? '--' : `${Math.round(Math.min(1, use) * 100)} %`} of your grip on this drive.`;
    }
    return { box, show, env };
  }

  function mount(root_, d, o) {
    const { Core, C, MPH } = o, ref = o.reference || null;        // ref: { name, score, corners[] } from Core.compareDrives(this, best other drive)
    const co = o.coach || null;                                      // Core.coach(this, other drives) + others: [{ name, date }]
    const lost = (k) => { const r = ref && ref.corners[k]; return r && r.delta_s != null && !r.stopped ? -r.delta_s : null; };   // seconds this pass was slower than the reference
    const fmtD = (s) => (s == null ? '--' : `${s > 0.005 ? '+' : s < -0.005 ? '\u2212' : ''}${Math.abs(s).toFixed(2)} s`);
    root_.innerHTML = '';
    const n = d.lat.length, T = Core.elapsedS(d.speed_mps), S = summarize(d, Core);
    const state = { i: 0, v0: 0, v1: n - 1 };
    const head = el('div', 'dv-head'), mapBox = el('div', 'dv-map'), lanes = el('div', 'dv-lanes'), read = el('div', 'dv-read'), list = el('div', 'dv-list');
    read.hidden = true;
    const showRead = () => { read.hidden = false; };
    const ds = d.ds || (Core && Core.driverScore ? Core.driverScore(d.speed_mps, d.lon_g, d.lat_g, d.corners) : null);
    const comp = ds && ds.components;
    const scoreVal = ds && finite(ds.score) ? ds.score : '--';
    const bar = (k, label) => {
      const v = comp && finite(comp[k]) ? Math.round(comp[k] * 100) : null;
      return `<div class="bar">${label} ${v != null ? v : '--'}<i><u style="width:${v != null ? v : 0}%"></u></i></div>`;
    };
    // the ideal drive only means something once another pass of the same corners exists
    const ideal = co && co.clean && co.gain_s > 0 && co.corners.some((x) => x.passes > 1)
      ? { gain: co.gain_s, n: co.clean, drives: new Set(co.corners.filter((x) => x.gain_s != null).map((x) => (x.best ? x.best_from : -1))).size } : null;
    const mi = finite(S.km) ? `${(S.km / 1.609344).toFixed(1)} mi` : '--';
    const dur = finite(S.duration_s) ? fmtT(S.duration_s) : '--';
    head.innerHTML = `<div class="dv-score"><b class="score big">${scoreVal}</b> <small>/1000</small></div>`
      + `<div class="bars">${bar('pace', 'Pace')}${bar('smoothness', 'Smooth')}${bar('braking', 'Brakes')}${bar('consistency', 'Rhythm')}</div>`
      + `<div class="dv-meta">${mi} \u00b7 ${dur} \u00b7 ${d.corners.length} corners</div>`
      + (ideal ? `<div class="dv-meta">Ideal drive <b class="gain">${ideal.gain.toFixed(2)} s</b> quicker: your best pass of each of ${ideal.n} corners, from ${ideal.drives} drive${ideal.drives === 1 ? '' : 's'}</div>` : '');
    root_.append(head, el('div', 'dv-grid'));
    const grid = root_.lastChild; grid.append(mapBox, el('div', 'dv-right'));
    const zoom = el('div', 'dv-zoom'); grid.lastChild.append(zoom, lanes, read);
    const gg = ggView(d, Core, C);                                   // friction circle; null without enough measured g
    if (gg) grid.lastChild.append(gg.box);
    root_.append(list);

    // ---- plan map ------------------------------------------------------------------------------------------------
    const { x, y } = Core.localXY(d.lat, d.lon);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
    const MW = 360, pad = 16, ms = (MW - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1), MH = Math.round((y1 - y0) * ms + 2 * pad);
    const P = (i) => [pad + (x[i] - x0) * ms, MH - pad - (y[i] - y0) * ms];
    const vmax = Math.max(...d.speed_mps) || 1;
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const hex = (h) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
    const asHex = (v, f) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : f);
    const slow = hex(asHex(C.panelDim, '#8A94A6')), fast = hex(asHex(C.accent, '#FF5A1F'));
    const colorAt = (v) => { const t = Math.pow(v / vmax, 1.4); return `rgb(${lerp(slow[0], fast[0], t)},${lerp(slow[1], fast[1], t)},${lerp(slow[2], fast[2], t)})`; };
    let segs = '';
    const stepM = Math.max(1, Math.floor(n / 500));
    for (let i = 0; i + stepM < n + stepM; i += stepM) {
      const j = Math.min(n - 1, i + stepM); if (j === i) break;
      const [ax, ay] = P(i), [bx, by] = P(j);
      segs += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${colorAt(d.speed_mps[i])}" stroke-width="3.5" stroke-linecap="round"/>`;
    }
    let placed = [];
    const marks = d.corners.map((c, k) => { const [px, py] = P(c.apex); if (placed.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < 18)) return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2" fill="${C.signal}"/>`; placed.push([px, py]); return `<g data-k="${k}" style="cursor:pointer"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" fill="${C.panel}" stroke="${C.signal}" stroke-width="1.6"/><text x="${px.toFixed(1)}" y="${(py + 3.2).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${C.panelInk}">${k + 1}</text></g>`; }).join('');
    mapBox.innerHTML = `<svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="Route map coloured by speed, ${d.corners.length} corners">${segs}<polyline id="dvWin" fill="none" stroke="${C.panelInk}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.28"/>${marks}<circle id="dvDot" r="6" fill="${C.accent}" stroke="${C.panel}" stroke-width="2"/></svg>
      <div class="dv-legend"><span>slow</span><i style="background:linear-gradient(90deg,${colorAt(0)},${colorAt(vmax)})"></i><span>${Math.round(vmax * MPH)} mph</span></div>`;
    const dot = mapBox.querySelector('#dvDot');

    // ---- lanes -----------------------------------------------------------------------------------------------------
    let W = 0, geo = null;
    const LANES = [
      { id: 'speed', label: 'Speed', h: 84, get: (i) => d.speed_mps[i] * MPH, lo: 0, hi: Math.ceil(vmax * MPH / 10) * 10, unit: 'mph', fill: true },
      { id: 'lat', label: 'Cornering g', h: 70, get: (i) => (d.lat_g ? d.lat_g[i] : null), sym: true, unit: 'g' },
      { id: 'lon', label: 'Brake and throttle g', h: 70, get: (i) => (d.lon_g ? d.lon_g[i] : null), sym: true, unit: 'g' },
    ];
    for (const L of LANES) {
      if (L.sym) { let m = 0.25; for (let i = 0; i < n; i++) { const v = L.get(i); if (finite(v)) m = Math.max(m, Math.abs(v)); } L.hi = Math.ceil(m * 10) / 10; L.lo = -L.hi; }
    }
    const hasElev = !!d.elev;
    let feel = null;                                                       // member-measured road feel along this drive (setRoadFeel)
    function draw() {
      W = Math.max(280, lanes.clientWidth || 600);
      const LM = 8, RM = 8, LH = 18;                                        // label row above each lane
      const v0 = state.v0, v1 = state.v1, X = (i) => LM + ((i - v0) / (v1 - v0)) * (W - LM - RM);
      let yTop = 0, svg = '';
      geo = { X, LM, RM, lanes: [] };
      const step = Math.max(1, Math.floor((v1 - v0) / (W * 1.2)));
      for (const L of LANES) {
        const top = yTop + LH, h = L.h, Y = (v) => top + h - ((v - L.lo) / (L.hi - L.lo)) * h;
        geo.lanes.push({ top, h });
        svg += `<text x="${LM}" y="${yTop + 12}" font-size="11" fill="${C.panelDim}">${L.label}</text>`;
        svg += `<text x="${W - RM}" y="${yTop + 12}" text-anchor="end" font-size="10" fill="${C.panelDim}">${L.sym ? `\u00b1${L.hi.toFixed(1)} g` : `${L.hi} mph`}</text>`;
        svg += `<line x1="${LM}" x2="${W - RM}" y1="${top + h}" y2="${top + h}" stroke="${C.rule}"/>`;
        if (L.sym) svg += `<line x1="${LM}" x2="${W - RM}" y1="${Y(0)}" y2="${Y(0)}" stroke="${C.rule}" stroke-dasharray="3 4"/>`;
        // corner bands behind the trace
        for (const c of d.corners) if (c.end >= v0 && c.start <= v1) svg += `<rect x="${X(c.start).toFixed(1)}" y="${top}" width="${Math.max(2, X(c.end) - X(c.start)).toFixed(1)}" height="${h}" fill="${C.signal}" opacity="0.09"/>`;
        let p = '', started = false, pts = [];
        for (let i = v0; i <= v1; i += step) { const v = L.get(i); if (!finite(v)) { started = false; continue; } p += `${started ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; started = true; pts.push([i, v]); }
        if (L.fill && pts.length) svg += `<path d="${p} L${X(pts[pts.length - 1][0]).toFixed(1)} ${top + h} L${X(pts[0][0]).toFixed(1)} ${top + h} Z" fill="${C.accent}" opacity="0.14"/>`;
        if (L.sym && pts.length) {
          const base = Y(0), area = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('') + `L${X(pts[pts.length - 1][0]).toFixed(1)} ${base}L${X(pts[0][0]).toFixed(1)} ${base}Z`;
          svg += `<path d="${area}" fill="${C.accent}" opacity="0.16"/>`;
        }
        svg += p ? `<path d="${p}" fill="none" stroke="${L.id === 'speed' ? C.panelInk : C.accent}" stroke-width="1.6" stroke-linejoin="round"/>` : `<text x="${LM}" y="${top + h / 2}" font-size="11" fill="${C.panelDim}">not recorded</text>`;
        yTop = top + h + 10;
      }
      if (feel) {                                                          // what members measured on these roads; gaps are unknown, not zero
        const top = yTop + LH, h = 56, covered = feel.cam.filter((v) => v != null).length;
        svg += `<text x="${LM}" y="${yTop + 12}" font-size="11" fill="${C.panelDim}">Road feel</text><text x="${W - RM}" y="${yTop + 12}" text-anchor="end" font-size="10" fill="${C.panelDim}">${covered ? `banking \u00b18\u00b0 \u00b7 roughness` : 'no member data on this road yet'}</text>`;
        svg += `<line x1="${LM}" x2="${W - RM}" y1="${top + h / 2}" y2="${top + h / 2}" stroke="${C.rule}" stroke-dasharray="3 4"/><line x1="${LM}" x2="${W - RM}" y1="${top + h}" y2="${top + h}" stroke="${C.rule}"/>`;
        const cs = Math.max(1, Math.floor((v1 - v0) / (W * 1.2)));
        let bars = '', rp = '', rs = false;
        for (let i = v0; i <= v1; i += cs) {
          const cm = feel.cam[i], rf = feel.rough[i];
          if (finite(cm)) { const hh = Math.min(1, Math.abs(cm) / 8) * (h / 2); bars += `<rect x="${X(i).toFixed(1)}" y="${(cm >= 0 ? top + h / 2 - hh : top + h / 2).toFixed(1)}" width="${Math.max(1, (W - LM - RM) / ((v1 - v0) / cs)).toFixed(1)}" height="${hh.toFixed(1)}" fill="${C.accent}" opacity="0.55"/>`; }
          if (finite(rf)) { rp += `${rs ? 'L' : 'M'}${X(i).toFixed(1)} ${(top + h - Math.min(1, rf / 0.4) * h).toFixed(1)}`; rs = true; } else rs = false;
        }
        svg += bars + (rp ? `<path d="${rp}" fill="none" stroke="${C.signal}" stroke-width="1.4"/>` : '');
        geo.lanes.push({ top, h }); yTop = top + h + 10;
      }
      if (hasElev) {                                                       // faint elevation profile along the bottom
        let lo = Infinity, hi = -Infinity; for (const v of d.elev) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const top = yTop + LH, h = 40, span = Math.max(10, hi - lo);
        svg += `<text x="${LM}" y="${yTop + 12}" font-size="11" fill="${C.panelDim}">Elevation</text><text x="${W - RM}" y="${yTop + 12}" text-anchor="end" font-size="10" fill="${C.panelDim}">${Math.round(lo * 3.28084)}-${Math.round(hi * 3.28084)} ft</text>`;
        let p = ''; for (let i = v0; i <= v1; i += step) p += `${i > v0 ? 'L' : 'M'}${X(i).toFixed(1)} ${(top + h - ((d.elev[i] - lo) / span) * h).toFixed(1)}`;
        svg += `<path d="${p} L${X(v1).toFixed(1)} ${top + h} L${X(v0).toFixed(1)} ${top + h} Z" fill="${C.rule}"/>`;
        geo.lanes.push({ top, h }); yTop = top + h + 6;
      }
      // numbered corner flags on top of the first lane
      let lastFx = -99;
      d.corners.forEach((c, k) => { if (c.apex < v0 || c.apex > v1) return; const fx = X(c.apex); if (fx - lastFx < 16) { svg += `<line x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="${geo.lanes[0].top}" y2="${geo.lanes[0].top + 5}" stroke="${C.signal}"/>`; return; } lastFx = fx; svg += `<text x="${fx.toFixed(1)}" y="${geo.lanes[0].top + 10}" text-anchor="middle" font-size="9" font-weight="700" fill="${C.signal}">${k + 1}</text>`; });
      svg += `<line id="dvHair" x1="0" x2="0" y1="${LH}" y2="${yTop}" stroke="${C.panelInk}" stroke-width="1.2" opacity="0.85"/>`;
      geo.H = yTop;
      const win = mapBox.querySelector('#dvWin');                          // the zoomed stretch, outlined on the map
      if (win) { let pts = ''; if (v1 - v0 < n - 1) for (let i = v0; i <= v1; i += Math.max(1, Math.floor((v1 - v0) / 120))) pts += P(i).map((q) => q.toFixed(1)).join(',') + ' '; win.setAttribute('points', pts); }
      lanes.innerHTML = `<svg width="${W}" height="${yTop}" viewBox="0 0 ${W} ${yTop}" style="touch-action:none;cursor:crosshair" role="img" aria-label="Speed, lateral and longitudinal g along the drive">${svg}</svg>`;
      move(state.i);
    }
    const cornerAt = (i) => d.corners.findIndex((c) => i >= c.start && i <= c.end);
    function move(i) {
      i = Math.max(0, Math.min(n - 1, Math.round(i))); state.i = i;
      const hair = lanes.querySelector('#dvHair'); if (hair && geo) { const gx = geo.X(i); hair.setAttribute('x1', gx); hair.setAttribute('x2', gx); hair.style.display = i < state.v0 || i > state.v1 ? 'none' : ''; }
      lanes.setAttribute('aria-valuenow', i); lanes.setAttribute('aria-valuetext', `${(d.dist[i] / 1609.344).toFixed(2)} miles, ${Math.round(d.speed_mps[i] * MPH)} miles per hour`);
      const [px, py] = P(i); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      const k = cornerAt(i), c = k >= 0 ? d.corners[k] : null;
      const cell = (label, v) => `<div><b>${v}</b><span>${label}</span></div>`;
      read.innerHTML = cell('Distance', `${(d.dist[i] / 1609.344).toFixed(2)} mi`) + cell('Time', fmtT(T[i])) + cell('Speed', `${Math.round(d.speed_mps[i] * MPH)} mph`)
        + cell('Lateral', d.lat_g && finite(d.lat_g[i]) ? `${d.lat_g[i] >= 0 ? 'L ' : 'R '}${Math.abs(d.lat_g[i]).toFixed(2)} g` : '--')
        + cell('Brake / throttle', d.lon_g && finite(d.lon_g[i]) ? `${d.lon_g[i] < 0 ? 'brake ' : 'accel '}${Math.abs(d.lon_g[i]).toFixed(2)} g` : '--')
        + cell(c ? `Corner ${k + 1}` : 'Corner', c ? `${c.call || c.code}` : '--') + (ref ? cell('vs other drive', c ? fmtD(lost(k)) : '--') : '')
        + (feel ? cell('Banking', finite(feel.cam[i]) ? `${feel.cam[i].toFixed(1)}\u00b0` : '--') + cell('Roughness', finite(feel.rough[i]) ? `${feel.rough[i].toFixed(2)} g` : '--') + cell('Runs', feel.n[i] != null ? feel.n[i] : '--') : '');
      list.querySelectorAll('.dv-corner').forEach((r, q) => r.classList.toggle('on', q === k));
      if (gg) gg.show(c, k);
    }
    // pointer scrubbing on the lanes and taps on map corners
    let drag = false;
    const idxFromEvent = (e) => { const r = lanes.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left - geo.LM) / (W - geo.LM - geo.RM))); return state.v0 + f * (state.v1 - state.v0); };
    lanes.addEventListener('pointerdown', (e) => { drag = true; if (lanes.setPointerCapture && e.pointerId != null) lanes.setPointerCapture(e.pointerId); showRead(); move(idxFromEvent(e)); });
    lanes.addEventListener('pointermove', (e) => { if (drag || e.pointerType === 'mouse') { showRead(); move(idxFromEvent(e)); } });
    lanes.addEventListener('pointerup', () => { drag = false; });
    lanes.addEventListener('keydown', (e) => { const big = e.shiftKey ? 50 : 5; if (e.key === 'ArrowRight') { e.preventDefault(); showRead(); move(state.i + big); } if (e.key === 'ArrowLeft') { e.preventDefault(); showRead(); move(state.i - big); } if (e.key === 'Home') { showRead(); move(state.v0); } if (e.key === 'End') { showRead(); move(state.v1); } });
    lanes.tabIndex = 0; lanes.setAttribute('role', 'slider'); lanes.setAttribute('aria-label', 'Position along the drive'); lanes.setAttribute('aria-valuemin', 0); lanes.setAttribute('aria-valuemax', n - 1);
    mapBox.addEventListener('click', (e) => { const g = e.target.closest('[data-k]'); if (g) move(d.corners[+g.dataset.k].apex); });

    // ---- corner list -----------------------------------------------------------------------------------------------
    let net = null;
    if (ref) { const ks = d.corners.map((_, k) => lost(k)).filter((x) => x != null); net = ks.length ? ks.reduce((s, x) => s + x, 0) : null; }
    list.innerHTML = `<h2>Corners${ref ? ` \u00b7 compared with ${esc(ref.name)} (score ${ref.score}), your best other drive on this road` : ''}</h2>` + (ref ? `<p class="note" style="margin-bottom:8px">${net == null ? 'No clean corners to compare.' : `Over the ${d.corners.map((_, k) => lost(k)).filter((x) => x != null).length} corners both drives took cleanly, this drive was <b class="${net > 0.05 ? 'loss' : net < -0.05 ? 'gain' : ''}">${fmtD(net)}</b> ${net > 0 ? 'slower' : 'faster'}. Stops and traffic are left out.`}</p>` : '');
    if (co && co.top.length) {                                      // where the time is: the biggest gaps to your own best passes
      const ul = el('ol', 'dv-time');
      for (const k of co.top) {
        const x = co.corners[k], c = d.corners[k], from = x.best ? co.others[x.best_from] : null, li = el('li'), b = el('button');
        b.innerHTML = `<b>${k + 1}</b><span>${esc(c.call || c.code || '')}</span><em class="loss">${fmtD(x.gain_s)}</em>`
          + `<span class="note">${esc(tipText(x, MPH) || 'Same technique, quicker all the way through')}${from ? ` \u00b7 best pass ${esc(from.date)}` : ''}</span>`;
        b.onclick = () => { if (zoomM) setZoom(zoomM, c.apex); move(c.apex); lanes.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        li.append(b); ul.append(li);
      }
      list.prepend(el('h2', null, 'Where to find time'), ul);
    }
    const grid2 = el('div', 'dv-corners');
    d.corners.forEach((c, k) => {
      const r = el('button', 'dv-corner'); r.setAttribute('aria-label', `Corner ${k + 1}: ${c.call || c.code}, apex ${Math.round(c.apex_mps * MPH)} miles per hour`);
      r.innerHTML = `<b>${k + 1}</b><span class="dv-call">${esc(c.call || c.code || '')}</span><span class="dv-v">${Math.round(c.apex_mps * MPH)} mph</span><span class="dv-d">${(d.dist[c.apex] / 1609.344).toFixed(2)} mi${ref ? ` \u00b7 <em class="${lost(k) == null ? '' : lost(k) > 0.05 ? 'loss' : lost(k) < -0.05 ? 'gain' : ''}">${fmtD(lost(k))}</em>` : ''}</span>`
        + (co && tipText(co.corners[k], MPH) ? `<span class="dv-tip">${esc(tipText(co.corners[k], MPH))}</span>` : '');
      r.onclick = () => { if (zoomM) setZoom(zoomM, c.apex); move(c.apex); lanes.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
      grid2.append(r);
    });
    if (!d.corners.length) grid2.append(el('p', 'note', 'No corners detected on this drive.'));
    list.append(grid2);

    // Zoom: the lanes show the whole drive, or a window around the cursor (a corner pick recentres it).
    const ZOOMS = [['All', 0], ['2 mi', 2 * 1609.344], ['0.5 mi', 0.5 * 1609.344], ['0.15 mi', 0.15 * 1609.344]];
    let zoomM = 0;
    function setZoom(m, center = state.i) {
      zoomM = m;
      if (!m) { state.v0 = 0; state.v1 = n - 1; }
      else { const half = Math.max(20, Math.round(m / 5 / 2)); state.v0 = Math.max(0, Math.min(n - 1 - 2 * half, center - half)); state.v1 = Math.min(n - 1, state.v0 + 2 * half); }
      zoom.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.m === m));
      draw();
    }
    ZOOMS.forEach(([label, m]) => { const b = el('button', 'dv-z', label); b.dataset.m = m; b.onclick = () => { showRead(); setZoom(m); }; b.setAttribute('aria-label', label === 'All' ? 'Zoom: whole drive' : `Zoom: ${label.toLowerCase()} window`); zoom.append(b); });
    const pan = (dir) => { showRead(); if (zoomM) setZoom(zoomM, Math.round((state.v0 + state.v1) / 2 + dir * (state.v1 - state.v0) * 0.6)); };
    const prev = el('button', 'dv-z', '\u25c0'), next = el('button', 'dv-z', '\u25b6'); prev.setAttribute('aria-label', 'Earlier'); next.setAttribute('aria-label', 'Later');
    prev.onclick = () => pan(-1); next.onclick = () => pan(1); zoom.append(prev, next);
    zoom.firstChild.classList.add('on');
    draw();
    const ro = new ResizeObserver(() => { if (Math.abs((lanes.clientWidth || 0) - W) > 2) draw(); });
    ro.observe(lanes);
    function setRoadFeel(series) { feel = series; draw(); }
    return { move, setRoadFeel, destroy() { ro.disconnect(); }, summary: S };
  }

  const api = { mount, summarize, tipText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveView = api;
})(typeof window !== 'undefined' ? window : globalThis);
