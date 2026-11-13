// Side by side (big bet 5, after the corner clips): one corner, two passes, two videos. This drive's pass on top and your
// best filmed pass below, each from the same point on the road (its own lead before the corner), played together in one
// portrait clip, with the time gap between them counting as the car goes through: where you lose it, you see it.
// The gap is the corner overlay's (corner_trace.js gap_s), matched by position, never by clock. Pure parts tested
// (tests/test_ghost_clip.py); record() plays the two videos.
(function (root) {
  'use strict';
  const LEAD_S = 3, TAIL_S = 2, W = 720, H = 1280;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * Where each pass sits in its video. a, b: { T (drive seconds per 5 m sample), start, end (the corner, in samples),
   * offsetS (the video starts this far into the drive), dur (video seconds) }. Both start LEAD_S before their corner and
   * run as long as the slower one needs (len), so they finish together or the quicker one holds its last frame.
   * { a: { t0, vt0, vt1 }, b: { t0, vt0, vt1 }, len } or null when either corner is not all in its video.
   */
  function windows(a, b) {
    const one = (p) => {
      if (!p || !p.T || !p.T.length || !(p.dur > 0)) return null;
      const n = p.T.length, s = p.T[Math.max(0, p.start)], e = p.T[Math.min(n - 1, p.end)];
      if (!finite(s) || !finite(e) || s < p.offsetS || e > p.offsetS + p.dur) return null;
      const t0 = Math.max(s - LEAD_S, p.offsetS, 0);
      return { t0, need: e + TAIL_S - t0, room: p.offsetS + p.dur - t0 };
    };
    const A = one(a), B = one(b);
    if (!A || !B) return null;
    const len = Math.min(Math.max(A.need, B.need), A.room, B.room);
    if (!(len > 0)) return null;
    const v = (P, p) => ({ t0: P.t0, vt0: P.t0 - p.offsetS, vt1: P.t0 - p.offsetS + Math.min(len, P.room) });
    return { a: v(A, a), b: v(B, b), len };
  }

  /** The 5 m sample at drive time t (T ascending): the last one at or before it. */
  function sampleAt(T, t) {
    let lo = 0, hi = T.length - 1;
    if (!(t >= T[0])) return 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; }
    return lo;
  }

  /**
   * The gap when this pass is at drive time t: the overlay trace's gap (above 0, this pass is behind) at this pass's
   * sample, less its gap where the clip starts, so the clip opens at 0.0. null where either pass's speed is unknown.
   * trace: corner_trace.js trace (gap_s per sample from i0); Ta: this drive's T; t0: the clip's start on this drive.
   */
  function gapAt(trace, Ta, t0, t) {
    if (!trace || !Array.isArray(trace.gap_s)) return null;
    const at = (tt) => { const q = sampleAt(Ta, tt) - (trace.i0 || 0); return q >= 0 && q < trace.gap_s.length ? trace.gap_s[q] : null; };
    const g0 = at(t0), g = at(t);
    if (!finite(g)) return null;
    return g - (finite(g0) ? g0 : 0);
  }
  /** "+0.4 s" (this pass behind), "−0.2 s" (ahead), "0.0 s"; "--" when unknown. */
  function gapText(g) {
    if (!finite(g)) return '--';
    const r = Math.round(g * 10) / 10;
    return r === 0 ? '0.0 s' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} s`;
  }

  function cover(g, video, x, y, w, h) {
    g.fillStyle = '#000'; g.fillRect(x, y, w, h);
    if (!video || !video.videoWidth) return;
    const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(w / vw, h / vh), sw = w / k, sh = h / k;
    g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
  }
  /**
   * One frame: this pass's video on top, the best pass's below, the road and call at the top, each pass's speed in its
   * half, and the gap on the seam. f: { gap, speedA, speedB }; meta: { title, label, whenB }.
   */
  function drawGhost(g, w, h, va, vb, f, meta) {
    const half = Math.round(h / 2), fs = Math.round(w * 0.06), pad = Math.round(w * 0.05);
    cover(g, va, 0, 0, w, half); cover(g, vb, 0, half, w, h - half);
    let grad = g.createLinearGradient(0, 0, 0, h * 0.16); grad.addColorStop(0, 'rgba(0,0,0,0.7)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, half - fs * 0.9, w, fs * 1.8);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#fff';
    g.font = `600 ${Math.round(fs * 0.55)}px system-ui, sans-serif`; g.fillText((meta.title || '').toUpperCase(), pad, pad + fs * 0.6);
    g.font = `800 ${fs}px system-ui, sans-serif`; g.fillText(meta.label || '', pad, pad + fs * 1.7);
    g.textAlign = 'right'; g.font = `800 ${Math.round(fs * 0.55)}px system-ui, sans-serif`; g.fillText('VETTA', w - pad, pad + fs * 0.6);
    // each half: who it is and its speed
    g.textAlign = 'left'; g.font = `700 ${Math.round(fs * 0.5)}px system-ui, sans-serif`;
    g.fillText('THIS DRIVE', pad, half - fs * 1.4);
    g.fillText(`BEST PASS${meta.whenB ? ` · ${String(meta.whenB).toUpperCase()}` : ''}`, pad, h - pad - fs * 1.6);
    g.font = `800 ${Math.round(fs * 1.1)}px system-ui, sans-serif`;
    g.textAlign = 'right'; g.fillText(f.speedA || '--', w - pad, half - fs * 1.3); g.fillText(f.speedB || '--', w - pad, h - pad);
    // the gap on the seam: amber while behind, green while ahead
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${Math.round(fs * 1.2)}px system-ui, sans-serif`;
    g.fillStyle = !finite(f.gap) || Math.abs(f.gap) < 0.05 ? '#fff' : f.gap > 0 ? '#ffb020' : '#4cd964';
    g.fillText(gapText(f.gap), w / 2, half);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  }

  /** The two passes' speeds at their videos' moments: { speedA, speedB } (text, null where unknown). */
  function speedsAt(a, b, fmtSpeed, vtA, vtB) {
    const v = (p, vt) => { const i = sampleAt(p.T, vt + p.offsetS), x = p.d.speed_mps && p.d.speed_mps[i]; return finite(x) ? fmtSpeed(x) : null; };
    return { speedA: v(a, vtA), speedB: v(b, vtB) };
  }

  /**
   * Makes the clip. opts: { va, vb (video elements, opened), a, b (as windows() takes, plus d: the drive), w (windows()),
   * trace, fmtSpeed, meta, canvas }. Both play from their start together; one that reaches its end holds its frame.
   * Resolves { blob, mime }. The sound is not kept.
   */
  async function record(opts) {
    const { va, vb, a, b, w, trace, fmtSpeed, meta, canvas } = opts;
    const MR = root.MediaRecorder, mime = root.ApexFlyoverVideo && root.ApexFlyoverVideo.mimeFor(MR);
    if (!mime || !canvas.captureStream) throw new Error('no recorder');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const seek = (v, t) => new Promise((ok) => { const done = () => { v.removeEventListener('seeked', done); ok(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 3000); });
    await Promise.all([seek(va, w.a.vt0), seek(vb, w.b.vt0)]);
    const paint = () => {
      const tA = Math.min(va.currentTime, w.a.vt1), tB = Math.min(vb.currentTime, w.b.vt1);
      drawGhost(g, W, H, va, vb, { gap: gapAt(trace, a.T, w.a.t0, tA + a.offsetS), ...speedsAt(a, b, fmtSpeed, tA, tB) }, meta);
    };
    paint();
    const rec = new MR(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((ok) => { rec.onstop = ok; });
    let raf = 0;
    await Promise.all([va.play(), vb.play()]); rec.start(500);       // (before the loop: it ends when both are paused)
    const end = new Promise((ok) => {
      const loop = () => {
        if (!va.paused && (va.currentTime >= w.a.vt1 || va.ended)) va.pause();          // the quicker pass holds its frame
        if (!vb.paused && (vb.currentTime >= w.b.vt1 || vb.ended)) vb.pause();
        paint();
        if (va.paused && vb.paused) { ok(); return; }
        raf = root.requestAnimationFrame(loop);
      };
      raf = root.requestAnimationFrame(loop);
    });
    await end;
    root.cancelAnimationFrame(raf);
    await new Promise((ok) => setTimeout(ok, 600));                     // the end held a moment, the gap readable
    paint(); rec.stop(); await stopped;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (!blob.size) throw new Error('empty');
    return { blob, mime };
  }

  const api = { windows, sampleAt, gapAt, gapText, drawGhost, speedsAt, record, LEAD_S, TAIL_S, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexGhostClip = api;
})(typeof window !== 'undefined' ? window : globalThis);
