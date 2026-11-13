// Corner clips (big bet 5, docs/notes/2026-11-13-big-bets.md): one corner of a drive cut from its lined-up video into a
// vertical clip for Reels, Stories or a message, with the corner's call, the speed and a live g trace burned in. The video
// is lined up by the Dashcam panel (dashcam.js); this cuts and draws. Pure parts tested (tests/test_corner_clip.py).
(function (root) {
  'use strict';
  const LEAD_S = 4, TAIL_S = 2.5, W = 720, H = 1280;                  // seconds before the corner's start and after its end
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * Where corner c (d.corners[k]: start, end in 5 m samples) sits in the video: { t0, t1 } in drive seconds (T: elapsed
   * time per sample), { vt0, vt1 } in video seconds, with the video starting offsetS into the drive and lasting dur s.
   * The lead and tail are cut short where the video starts or ends (the app's own film starts as the drive does); null
   * when the corner itself is not all in the video (a clip never shows a frame the video does not have).
   */
  function clipWindow(T, c, offsetS, dur) {
    if (!c || !T || !T.length || !(dur > 0)) return null;
    const last = T[T.length - 1], s = T[Math.max(0, c.start)], e = T[Math.min(T.length - 1, c.end)];
    if (!finite(s) || !finite(e)) return null;
    if (s < offsetS || e > offsetS + dur) return null;
    const t0 = Math.max(0, s - LEAD_S, offsetS), t1 = Math.min(last, e + TAIL_S, offsetS + dur), vt0 = t0 - offsetS, vt1 = t1 - offsetS;
    return vt1 > vt0 ? { t0, t1, vt0, vt1 } : null;
  }
  /** The drive's corner calls as stretches of 5 m samples, in road order: [{ start, end, call }] (from d.events). */
  function cornersOf(d) {
    const n = (d.speed_mps || []).length;
    return (d.events || []).filter((e) => e.type === 'corner' && finite(e.start_m) && finite(e.end_m) && e.end_m >= e.start_m)
      .sort((a, b) => a.start_m - b.start_m)
      .map((e) => ({ start: Math.max(0, Math.round(e.start_m / 5)), end: Math.min(n - 1, Math.round(e.end_m / 5)), call: e.call || e.code || '' }));
  }
  /** The corners a clip can be cut for: [{ k, label, w }] in road order, label "Corner 3 \u00b7 Left 4". */
  function clippable(d, T, offsetS, dur) {
    return cornersOf(d).map((c, k) => ({ k, label: [`Corner ${k + 1}`, c.call].filter(Boolean).join(' \u00b7 '), w: clipWindow(T, c, offsetS, dur) }))
      .filter((x) => x.w);
  }
  /** The window's g, sample by sample: { lat: [...], lon: [...], t: [...] } (null where the phone did not measure it). */
  function traceOf(d, T, w) {
    const out = { lat: [], lon: [], t: [] }, gk = d.g_known;
    for (let i = 0; i < T.length; i++) {
      if (T[i] < w.t0) continue;
      if (T[i] > w.t1) break;
      const ok = !gk || gk[i];
      out.t.push(T[i]);
      out.lat.push(ok && d.lat_g && finite(d.lat_g[i]) ? d.lat_g[i] : null);
      out.lon.push(ok && d.lon_g && finite(d.lon_g[i]) ? d.lon_g[i] : null);
    }
    return out;
  }
  /** What a frame at video time vt shows: { speed (text), latG, lonG, at (0..1 through the clip) }; fields null if unknown. */
  function frameAt(d, T, w, vt, offsetS, fmtSpeed) {
    const t = vt + offsetS;
    let i = 0;
    while (i < T.length - 1 && T[i] < t) i++;
    const v = d.speed_mps && d.speed_mps[i], ok = !d.g_known || d.g_known[i];
    return { speed: finite(v) ? fmtSpeed(v) : null, latG: ok && d.lat_g && finite(d.lat_g[i]) ? d.lat_g[i] : null,
             lonG: ok && d.lon_g && finite(d.lon_g[i]) ? d.lon_g[i] : null, at: Math.max(0, Math.min(1, (t - w.t0) / Math.max(0.1, w.t1 - w.t0))) };
  }

  /**
   * Draws one frame of the clip on a 2D context w×h (portrait): the video cropped to fill it, the corner's call on top, the
   * speed, a g trace with a cursor and the friction-circle dot at the foot. meta: { title, label, trace }.
   */
  function drawClip(g, w, h, video, f, meta) {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (video && video.videoWidth) {                                  // cover: the middle of a landscape frame
      const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(w / vw, h / vh), sw = w / k, sh = h / k;
      g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
    }
    const fs = Math.round(w * 0.06), pad = Math.round(w * 0.05);
    let grad = g.createLinearGradient(0, 0, 0, h * 0.22); grad.addColorStop(0, 'rgba(0,0,0,0.7)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h * 0.22);
    grad = g.createLinearGradient(0, h * 0.62, 0, h); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    g.fillStyle = grad; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.font = `600 ${Math.round(fs * 0.55)}px system-ui, sans-serif`; g.fillText((meta.title || '').toUpperCase(), pad, pad + fs * 0.6);
    g.font = `800 ${fs}px system-ui, sans-serif`; g.fillText(meta.label || '', pad, pad + fs * 1.7);
    if (!f) return;
    // the g trace over the clip: lateral above the line is a left, braking below; the cursor is now
    const tr = meta.trace, tx0 = pad, tx1 = w - pad, ty = h - fs * 4.6, th = fs * 1.6;   // above the speed and the circle
    if (tr && tr.t.length > 1) {
      const X = (q) => tx0 + q / (tr.t.length - 1) * (tx1 - tx0), Y = (gv) => ty - Math.max(-1, Math.min(1, gv)) * th / 2;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tx0, ty); g.lineTo(tx1, ty); g.stroke();
      const line = (ys, col) => { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); let up = false; ys.forEach((y, q) => { if (y == null) { up = false; return; } if (up) g.lineTo(X(q), Y(y)); else g.moveTo(X(q), Y(y)); up = true; }); g.stroke(); };
      line(tr.lon, 'rgba(255,90,60,0.9)'); line(tr.lat, 'rgba(255,204,51,0.95)');
      const cx = tx0 + f.at * (tx1 - tx0);
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, ty - th / 2 - 6); g.lineTo(cx, ty + th / 2 + 6); g.stroke();
      g.font = `600 ${Math.round(fs * 0.4)}px system-ui, sans-serif`; g.fillStyle = 'rgba(255,204,51,0.95)'; g.fillText('CORNERING G', tx0, ty - th / 2 - 12);
      g.fillStyle = 'rgba(255,90,60,0.95)'; g.textAlign = 'right'; g.fillText('BRAKE / THROTTLE G', tx1, ty - th / 2 - 12); g.textAlign = 'left';
    }
    g.fillStyle = '#fff'; g.font = `800 ${Math.round(fs * 1.5)}px system-ui, sans-serif`;
    g.fillText(f.speed || '--', pad, h - pad);
    if (f.latG != null && f.lonG != null) {                          // the friction circle: 1 g at the edge
      const r = fs * 1.1, cx = w - pad - r, cy = h - pad - r;
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(cx - Math.max(-1, Math.min(1, f.latG)) * r, cy - Math.max(-1, Math.min(1, f.lonG)) * r, fs * 0.25, 0, 2 * Math.PI); g.fill();
    }
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `800 ${Math.round(fs * 0.55)}px system-ui, sans-serif`;
    g.fillText('VETTA', w - pad, pad + fs * 0.6); g.textAlign = 'left';
  }

  /**
   * Makes the clip: plays the video from vt0 to vt1 into a portrait canvas and records it. opts: { video, d, T, w, offsetS,
   * fmtSpeed, meta, canvas }. Resolves { blob, mime }. The sound is not kept.
   */
  async function record(opts) {
    const { video, d, T, w, offsetS, fmtSpeed, meta, canvas } = opts;
    const MR = root.MediaRecorder, mime = root.ApexFlyoverVideo && root.ApexFlyoverVideo.mimeFor(MR);
    if (!mime || !canvas.captureStream) throw new Error('no recorder');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d'), m = { ...meta, trace: traceOf(d, T, w) };
    const paint = () => drawClip(g, W, H, video, frameAt(d, T, w, video.currentTime, offsetS, fmtSpeed), m);
    await new Promise((ok) => { const done = () => { video.removeEventListener('seeked', done); ok(); }; video.addEventListener('seeked', done); video.currentTime = w.vt0; setTimeout(done, 3000); });
    paint();
    const rec = new MR(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((ok) => { rec.onstop = ok; });
    let raf = 0;
    const end = new Promise((ok) => {
      const loop = () => { paint(); if (video.currentTime >= w.vt1 || video.ended) { ok(); return; } raf = root.requestAnimationFrame(loop); };
      raf = root.requestAnimationFrame(loop);
    });
    await video.play(); rec.start(500);
    await end;
    root.cancelAnimationFrame(raf); video.pause(); rec.stop(); await stopped;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (!blob.size) throw new Error('empty');
    return { blob, mime };
  }

  const api = { clipWindow, cornersOf, clippable, traceOf, frameAt, drawClip, record, LEAD_S, TAIL_S, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCornerClip = api;
})(typeof window !== 'undefined' ? window : globalThis);
