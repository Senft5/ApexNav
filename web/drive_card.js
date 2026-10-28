// A drive card worth sharing (IDEAS D-09): the road's silhouette, the drive's name and date, distance, the Driver Score
// with smoothness, braking and consistency, and the mix of corners it had. Never times or speeds (the guardrails: no
// speed brag). cardModel() is pure (tested); drawCard() paints it on a canvas in the app's look; shareCard() hands the
// image to the share sheet, or saves it where sharing files isn't offered.
(function (root) {
  'use strict';
  const W = 1080, H = 1350;   // 4:5, the shape feeds and messages show without cropping
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Normalised outline of the drive in a unit box (y down), equal scale on both axes, at most `max` points. */
  function silhouette(lat, lon, max = 400) {
    const n = Math.min(lat.length, lon.length);
    const pts = [];
    const step = Math.max(1, Math.floor(n / max));
    for (let i = 0; i < n; i += step) if (finite(lat[i]) && finite(lon[i])) pts.push([lat[i], lon[i]]);
    if (pts.length < 2) return [];
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length, kx = Math.cos(lat0 * Math.PI / 180);
    const xy = pts.map(([la, lo]) => [lo * kx, -la]);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
    const offX = (1 - (Math.max(...xs) - minX) / span) / 2, offY = (1 - (Math.max(...ys) - minY) / span) / 2;
    return xy.map(([x, y]) => [offX + (x - minX) / span, offY + (y - minY) / span]);
  }

  // The outline leaves out the first and last TRIM_M of the drive: a shape can be matched to a map, and its ends are
  // usually home and work (the same rule as shared road data). Too short a drive to trim leaves no outline.
  const TRIM_M = 800;
  function trimEnds(lat, lon, dist) {
    const n = Math.min(lat.length, lon.length, dist.length);
    if (!n) return [[], []];
    const end = dist[n - 1], keep = [];
    for (let i = 0; i < n; i++) if (dist[i] >= TRIM_M && dist[i] <= end - TRIM_M) keep.push(i);
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

  /** Everything the card shows, from a Log drive. Unknown stays null (drawn as --). */
  function cardModel(d) {
    const dist = d.dist || [], ds = d.ds || {}, comp = ds.components || null;
    const pct = (v) => (finite(v) ? Math.round(v * 100) : null);
    return {
      name: d.name || 'Drive', date: typeof d.date === 'string' ? d.date : null,
      miles: dist.length ? dist[dist.length - 1] / 1609.344 : null,
      score: finite(ds.score) ? ds.score : null,
      parts: comp ? [['Smoothness', pct(comp.smoothness)], ['Braking', pct(comp.braking)], ['Consistency', pct(comp.consistency)]] : [],
      mix: cornerMix(d.corners), shape: silhouette(...trimEnds(d.lat || [], d.lon || [], dist)),
    };
  }

  function drawCard(canvas, m, C, opts = {}) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const font = (w, px, fam = C.fontUi || 'system-ui, sans-serif') => `${w} ${px}px ${fam}`;
    g.fillStyle = C.panel || '#111'; g.fillRect(0, 0, W, H);
    // the road
    const box = { x: 90, y: 300, s: 900 };
    if (m.shape.length > 1) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = C.accent || '#f60'; g.lineWidth = 14;
      g.beginPath();
      m.shape.forEach(([x, y], i) => { const px = box.x + x * box.s, py = box.y + y * box.s * 0.72; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
    }
    // title block
    g.fillStyle = C.panelInk || '#fff'; g.font = font(800, 72, C.fontNum); g.textBaseline = 'top';
    const title = m.name.length > 28 ? m.name.slice(0, 27) + '…' : m.name;
    g.fillText(title.toUpperCase(), 90, 90);
    g.fillStyle = C.panelDim || '#999'; g.font = font(500, 36);
    const when = m.date ? new Date(m.date).toLocaleDateString(opts.locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    g.fillText([when, finite(m.miles) ? (root.ApexUnits ? root.ApexUnits.long(m.miles * 1609.344) : `${m.miles.toFixed(1)} mi`) : ''].filter(Boolean).join(' · '), 90, 182);
    // score and parts
    const y0 = 990;
    g.fillStyle = C.panelInk || '#fff'; g.font = font(800, 150, C.fontNum);
    g.fillText(m.score == null ? '--' : String(m.score), 90, y0);
    g.fillStyle = C.panelDim || '#999'; g.font = font(600, 30);
    g.fillText('DRIVER SCORE / 1000', 96, y0 + 160);
    g.font = font(600, 32);
    m.parts.forEach(([label, v], i) => {
      const y = y0 + 6 + i * 52;
      g.fillStyle = C.panelDim || '#999'; g.fillText(label, 560, y);
      g.fillStyle = C.panelInk || '#fff'; g.textAlign = 'right'; g.fillText(v == null ? '--' : `${v}%`, 990, y); g.textAlign = 'left';
    });
    const mixText = `${m.mix.tight} tight · ${m.mix.medium} medium · ${m.mix.fast} fast corners`;
    g.fillStyle = C.panelDim || '#999'; g.font = font(500, 32); g.fillText(mixText, 90, H - 110);
    g.fillStyle = C.accent || '#f60'; g.font = font(800, 34, C.fontNum); g.textAlign = 'right'; g.fillText('APEX NAV', W - 90, H - 112); g.textAlign = 'left';
    return canvas;
  }

  /** The share sheet with the image when the browser can share files; otherwise the image is saved. 'shared' | 'saved' | 'cancelled'. */
  async function shareCard(canvas, fileName) {
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) return 'failed';
    const file = typeof File === 'function' ? new File([blob], fileName, { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'saved';
  }

  const api = { cardModel, silhouette, trimEnds, TRIM_M, cornerMix, drawCard, shareCard, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
