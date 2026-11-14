// A drive card worth sharing (IDEAS D-09; panel round 2 KE-1 / JA-1 / HE-4): the road's portrait (its line, the corners
// ticked on it, the climbs under it), the road's name, the date and distance, the Vetta Score and the Log's own four parts
// in the Log's own words, Pace / Smooth / Brakes / Rhythm, in the Log's order. 9:16, the shape a story or a status takes
// without cropping. Never a speed, a time or a duration (the guardrails: no speed brag; distance and time together are an
// average speed). The first and last TRIM_M of the drive are not on it. cardModel() is pure (tested); drawCard() paints it
// on a canvas in the app's look; shareCard() hands the image to the share sheet, or saves it where sharing files isn't offered.
(function (root) {
  'use strict';
  const W = 1080, H = 1920;   // 9:16 (JA-1)
  const SITE = 'vettadrive.com';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Normalised outline of the drive in a unit box (y down), equal scale on both axes, at most `max` points. */
  function silhouette(lat, lon, max = 400) {
    const f = framer(lat, lon);
    if (!f) return [];
    const n = Math.min(lat.length, lon.length), step = Math.max(1, Math.floor(n / max)), out = [];
    for (let i = 0; i < n; i += step) if (finite(lat[i]) && finite(lon[i])) out.push(f(lat[i], lon[i]));
    return out.length >= 2 ? out : [];
  }
  // The unit-box projection of a drive's points (equal scale, centred), or null with fewer than two known points.
  function framer(lat, lon) {
    const n = Math.min(lat.length, lon.length), pts = [];
    for (let i = 0; i < n; i++) if (finite(lat[i]) && finite(lon[i])) pts.push([lat[i], lon[i]]);
    if (pts.length < 2) return null;
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length, kx = Math.cos(lat0 * Math.PI / 180);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [la, lo] of pts) { const x = lo * kx, y = -la; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const offX = (1 - (maxX - minX) / span) / 2, offY = (1 - (maxY - minY) / span) / 2;
    return (la, lo) => [offX + (lo * kx - minX) / span, offY + (-la - minY) / span];
  }

  // The outline leaves out the first and last TRIM_M of the drive: a shape can be matched to a map, and its ends are
  // usually home and work (the same rule as shared road data). Too short a drive to trim leaves no outline.
  const TRIM_M = 800;
  function keptIdx(dist, n) {
    if (!n) return [];
    const end = dist[n - 1], keep = [];
    for (let i = 0; i < n; i++) if (dist[i] >= TRIM_M && dist[i] <= end - TRIM_M) keep.push(i);
    return keep;
  }
  function trimEnds(lat, lon, dist) {
    const keep = keptIdx(dist, Math.min(lat.length, lon.length, dist.length));
    return [keep.map((i) => lat[i]), keep.map((i) => lon[i])];
  }

  /** Corner mix: tight (hairpins, 1-2), medium (3-4), fast (5-6), from the drive's scored corners. */
  function cornerMix(corners) {
    const mix = { tight: 0, medium: 0, fast: 0 };
    for (const c of corners || []) {
      const s = c.severity;
      if (s === 'HP' || c.shape === 'hairpin' || s === 1 || s === 2) mix.tight++;
      else if (s === 3 || s === 4) mix.medium++;
      else if (s === 5 || s === 6) mix.fast++;
    }
    return mix;
  }

  // The Log's four parts (drive_view.js bars), its words and its order. Pace is a 0-100 part of the score, not a speed.
  const PARTS = [['pace', 'Pace'], ['smoothness', 'Smooth'], ['braking', 'Brakes'], ['consistency', 'Rhythm']];

  /** Everything the card shows, from a Log drive. Unknown stays null (drawn as --). */
  function cardModel(d) {
    const dist = d.dist || [], ds = d.ds || {}, comp = ds.components || null;
    const pct = (v) => (finite(v) ? Math.round(v * 100) : null);
    const lat = d.lat || [], lon = d.lon || [], n = Math.min(lat.length, lon.length, dist.length);
    const keep = keptIdx(dist, n), kl = keep.map((i) => lat[i]), ko = keep.map((i) => lon[i]);
    const f = framer(kl, ko);
    // the corners on the kept stretch, ticked where their apex is (a corner with no known apex, or on a trimmed end, is not)
    const k0 = keep.length ? keep[0] : 0, k1 = keep.length ? keep[keep.length - 1] : -1;
    const ticks = f ? (d.corners || []).map((c) => (Number.isInteger(c.apex) ? c.apex : null))
      .filter((i) => i != null && i >= k0 && i <= k1 && finite(lat[i]) && finite(lon[i])).map((i) => f(lat[i], lon[i])) : [];
    // the climbs along the kept stretch, when its height was measured (10 heights or more spanning 3 m or more)
    const el = Array.isArray(d.elev) ? keep.map((i) => d.elev[i]).filter(finite) : [];
    const climb = el.length >= 10 && Math.max(...el) - Math.min(...el) >= 3 ? downsample(el, 120) : [];
    const date = typeof d.date === 'string' ? d.date : null;
    return {
      name: d.name || 'Drive', title: cardTitle(d.name, date), date,
      miles: dist.length ? dist[dist.length - 1] / 1609.344 : null,
      score: finite(ds.score) ? ds.score : null,
      parts: comp ? PARTS.map(([k, label]) => [label, pct(comp[k])]) : [],
      mix: cornerMix(d.corners), shape: silhouette(kl, ko), ticks, climb,
    };
  }
  /** The picture's title (2026-11-12, free roamer B): a road's or route's name as it is; the date name a drive gets when no road
   *  carried it ("Drive 11/13/2026 7:20 PM", which put the date twice over the date line) reads as the part of the day it was
   *  driven in, as sports apps name a workout: "Evening drive". No date: "Drive". */
  function cardTitle(name, date) {
    if (typeof name === 'string' && name.trim() && !/^Drive \d/.test(name.trim())) return name.trim();
    const t = date ? new Date(date) : null, h = t && !Number.isNaN(t.getTime()) ? t.getHours() : null;
    if (h == null) return 'Drive';
    return `${h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night'} drive`;
  }
  /** The corner line under the score: only the kinds the drive had ("8 fast corners", not "0 tight · 0 medium · 8 fast"). */
  function mixLine(mix) {
    const m = mix || {}, kinds = [['tight', m.tight], ['medium', m.medium], ['fast', m.fast]].filter(([, n]) => n > 0);
    const total = kinds.reduce((a, [, n]) => a + n, 0);
    return total ? `${kinds.map(([k, n]) => `${n} ${k}`).join(' · ')} corner${total === 1 ? '' : 's'}` : '';
  }
  function downsample(a, max) { const step = Math.max(1, Math.ceil(a.length / max)), out = []; for (let i = 0; i < a.length; i += step) out.push(a[i]); return out; }

  function drawCard(canvas, m, C, opts = {}) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const font = (w, px, fam = C.fontUi || 'system-ui, sans-serif') => `${w} ${px}px ${fam}`;
    const ink = C.panelInk || '#fff', dim = C.panelDim || '#999', accent = C.accent || '#f60';
    g.fillStyle = C.panel || '#111'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'top';
    // title block: the road's name, the date and the distance
    g.fillStyle = ink; g.font = font(800, 84, C.fontNum);
    const name = m.title || m.name, title = name.length > 24 ? name.slice(0, 23) + '…' : name;
    g.fillText(title.toUpperCase(), 90, 120);
    g.fillStyle = dim; g.font = font(500, 40);
    const when = m.date ? new Date(m.date).toLocaleDateString(opts.locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    g.fillText([when, finite(m.miles) ? (root.ApexFormat ? root.ApexFormat.distance(m.miles * 1609.344) : root.ApexUnits ? root.ApexUnits.long(m.miles * 1609.344, 1, true) : `${m.miles.toFixed(1)} mi`) : ''].filter(Boolean).join(' · '), 90, 224);
    // the road's portrait: its line in a square, the corners ticked on it, the climbs under it
    const box = { x: 110, y: 330, s: 860 };
    const at = ([x, y]) => [box.x + x * box.s, box.y + y * box.s];
    if (m.shape.length > 1) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = accent; g.lineWidth = 16;
      g.beginPath();
      m.shape.forEach((p, i) => { const [px, py] = at(p); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
      g.fillStyle = ink;
      for (const p of m.ticks || []) { const [px, py] = at(p); g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fill(); }
    }
    const climb = m.climb || [];
    if (climb.length > 1) {
      const y0 = 1240, h = 110, lo = Math.min(...climb), hi = Math.max(...climb), xs = (i) => 90 + i / (climb.length - 1) * (W - 180);
      const ys = (e) => y0 + h - (e - lo) / (hi - lo) * h;
      g.beginPath(); g.moveTo(90, y0 + h); climb.forEach((e, i) => g.lineTo(xs(i), ys(e))); g.lineTo(W - 90, y0 + h); g.closePath();
      g.globalAlpha = 0.2; g.fillStyle = ink; g.fill(); g.globalAlpha = 1;
      g.beginPath(); climb.forEach((e, i) => (i ? g.lineTo(xs(i), ys(e)) : g.moveTo(xs(i), ys(e)))); g.strokeStyle = ink; g.lineWidth = 3; g.stroke();
    }
    // the score and the Log's four parts, in a row under it
    const y1 = 1420;
    g.fillStyle = ink; g.fillRect(90, y1, W - 180, 4);
    g.font = font(800, 150, C.fontNum); g.fillStyle = ink;
    g.fillText(m.score == null ? '--' : String(m.score), 90, y1 + 36);
    g.fillStyle = dim; g.font = font(600, 30);
    g.fillText('VETTA SCORE / 1000', 96, y1 + 200);
    m.parts.forEach(([label, v], i) => {
      const x = 520 + (i % 2) * 250, y = y1 + 44 + Math.floor(i / 2) * 96;
      g.fillStyle = dim; g.font = font(600, 30); g.fillText(label, x, y);
      g.fillStyle = ink; g.font = font(800, 52, C.fontNum); g.fillText(v == null ? '--' : String(v), x, y + 36);
    });
    const mixText = mixLine(m.mix);
    g.fillStyle = dim; g.font = font(500, 34); g.fillText(mixText, 90, H - 170);
    g.fillStyle = accent; g.font = font(800, 40, C.fontNum); g.textAlign = 'right'; g.fillText('VETTA', W - 90, H - 172);
    g.fillStyle = dim; g.font = font(600, 26); g.fillText(SITE, W - 90, H - 132); g.textAlign = 'left';   // where a shared card leads (the owner's domain, 2026-11-14)
    if (opts.car) drawCar(g, opts.car, ink, W - 90, H - 212);
    return canvas;
  }
  /** A car's own theme (themes.js carFrom): the car from above, lying nose right, in its paint, outlined in ink, its right
   *  end at (x, y). No logo or badge: the outline and the paint. */
  function drawCar(g, car, ink, x, y) {
    const s = car.silhouette;
    if (!s || !Array.isArray(s.body) || !/^#[0-9A-Fa-f]{6}$/.test(car.paint || '')) return;
    const len = 190, k = len / s.h, wd = s.w * k;
    const pt = ([px, py]) => [x - py * k, y - wd / 2 + px * k];       // nose (py = 0) at the right, lying across
    const poly = (a, fill) => { if (!a || a.length < 3) return; g.beginPath(); a.forEach((p, i) => { const [qx, qy] = pt(p); if (i) g.lineTo(qx, qy); else g.moveTo(qx, qy); }); g.closePath(); g.fillStyle = fill; g.fill(); return true; };
    if (poly(s.body, car.paint)) { g.strokeStyle = ink; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke(); }
    poly(s.glass, '#1A1D22'); poly(s.roof, car.paint);
  }

  /** The share sheet with the image when the browser can share files; otherwise the image is saved. 'shared' | 'saved' | 'cancelled'. */
  async function shareCard(canvas, fileName) {
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) return 'failed';
    return shareFile(blob, fileName, 'image/png');
  }
  /** Any file the same way (the end card's best corner clip too). */
  async function shareFile(blob, fileName, mime) {
    // the shell's share sheet in the app (save_file.js), where a download link does nothing (feedback 07)
    if (root.ApexSaveFile && typeof location !== 'undefined' && location.protocol === 'apexnav:') return root.ApexSaveFile.saveFile(blob, fileName, mime, { share: true });
    const file = typeof File === 'function' ? new File([blob], fileName, { type: mime }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'saved';
  }

  const api = { cardModel, cardTitle, mixLine, silhouette, trimEnds, TRIM_M, cornerMix, drawCard, shareCard, shareFile, SITE, PARTS, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
