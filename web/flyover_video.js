// A drive's flyover as a video (IDEAS D-10): the replay played over the 3D map, with the pace note and speed drawn on top,
// recorded to a file you can keep or share (MediaRecorder; mp4 where the browser makes it, else webm). Frames are copied
// inside the map's own render event, while its WebGL buffer still holds the picture. Pure helpers are tested
// (tests/test_flyover_video.py); start() needs a real canvas.
(function (root) {
  'use strict';
  const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  /** The first type the recorder can make, or null when it can make none (an old phone: no Video button). */
  function mimeFor(MR) {
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;
    return TYPES.find((t) => { try { return MR.isTypeSupported(t); } catch (_) { return false; } }) || null;
  }
  const extFor = (mime) => (/mp4/.test(mime || '') ? 'mp4' : 'webm');
  const fileName = (name, mime, when = new Date()) =>
    `${String(name || 'drive').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'drive'}-${when.toISOString().slice(0, 10)}.${extFor(mime)}`;
  /** Output size: the map's aspect, at most 1280 px wide (even numbers, as encoders want). */
  function sizeFor(w, h, max = 1280) {
    const k = Math.min(1, max / Math.max(1, w));
    const even = (x) => Math.max(2, Math.round(x * k / 2) * 2);
    return { w: even(w), h: even(h) };
  }

  /**
   * opts: map (MapLibre), overlay() → { title, note, speed } (strings or ''), fps (30), onStop(blob, mime).
   * Returns { stop() } or null when recording isn't possible here.
   */
  function start(opts) {
    const MR = root.MediaRecorder, mime = mimeFor(MR), src = opts.map && opts.map.getCanvas && opts.map.getCanvas();
    if (!mime || !src || typeof src.captureStream !== 'function' && !root.HTMLCanvasElement) return null;
    const { w, h } = sizeFor(src.width, src.height), out = root.document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    if (!g || typeof out.captureStream !== 'function') return null;
    const draw = () => {
      try { g.drawImage(src, 0, 0, w, h); } catch (_) { return; }
      const o = (opts.overlay && opts.overlay()) || {}, pad = Math.round(w * 0.025), fs = Math.round(h * 0.05);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, h - fs * 2.6, w, fs * 2.6);
      g.fillStyle = '#fff'; g.textBaseline = 'middle';
      g.font = `700 ${fs}px system-ui, sans-serif`; g.fillText(o.note || '', pad, h - fs * 1.6);
      g.font = `500 ${Math.round(fs * 0.6)}px system-ui, sans-serif`; g.fillText([o.title, o.speed].filter(Boolean).join(' · '), pad, h - fs * 0.6);
      g.textAlign = 'right'; g.font = `800 ${Math.round(fs * 0.6)}px system-ui, sans-serif`; g.fillText('APEX NAV', w - pad, h - fs * 0.6); g.textAlign = 'left';
    };
    opts.map.on('render', draw);
    const stream = out.captureStream(opts.fps || 30), rec = new MR(stream, { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => { opts.map.off('render', draw); stream.getTracks().forEach((t) => t.stop()); opts.onStop && opts.onStop(new Blob(chunks, { type: mime.split(';')[0] }), mime); };
    rec.start(1000);
    opts.map.triggerRepaint && opts.map.triggerRepaint();
    return { stop() { if (rec.state !== 'inactive') rec.stop(); }, mime };
  }

  const api = { mimeFor, extFor, fileName, sizeFor, start, TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFlyoverVideo = api;
})(typeof window !== 'undefined' ? window : globalThis);
