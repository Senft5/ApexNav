// Dashcam overlay (IDEAS D-11): a video you filmed on the drive (phone or GoPro), lined up with the drive by an offset you
// set, with the speed, lateral and braking g and the next corner call drawn over it, saved as a new video. All on the
// phone. Pure parts tested (tests/test_dashcam.py); mount() draws the Log panel.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  /** The first sample at or after drive time t (s), by binary search over elapsed times T; -1 outside the drive. */
  function indexAt(T, t) {
    if (!T || !T.length || !(t >= 0) || t > T[T.length - 1]) return -1;
    let lo = 0, hi = T.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }
  /**
   * What to draw at video time `vt` with the video starting `offsetS` seconds into the drive: { speed, latG, lonG, note }
   * (null fields unknown), or null outside the drive. fmtSpeed(mps) → text.
   */
  function overlayAt(d, T, vt, offsetS, fmtSpeed = (v) => `${Math.round(v * 2.2369)} mph`) {
    const i = indexAt(T, vt + offsetS);
    if (i < 0) return null;
    const v = d.speed_mps && d.speed_mps[i], lat = d.lat_g && d.lat_g[i], lon = d.lon_g && d.lon_g[i];
    const here = i * 5;
    const next = (d.events || []).filter((e) => e.type === 'corner' && e.dist_m >= here - 10 && e.dist_m - here <= 200).sort((a, b) => a.dist_m - b.dist_m)[0];
    return { speed: finite(v) ? fmtSpeed(v) : null, latG: finite(lat) ? lat : null, lonG: finite(lon) ? lon : null,
             note: next ? `${next.call}${next.dist_m - here > 15 ? ` · ${Math.round(next.dist_m - here)} m` : ''}` : null };
  }
  /** Draws the overlay on a 2D context over a w×h frame: a strip at the bottom and a small g dot. */
  function drawOverlay(g, w, h, o, title = '') {
    if (!o) return;
    const fs = Math.round(h * 0.05), pad = Math.round(w * 0.025);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, h - fs * 2.6, w, fs * 2.6);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `700 ${fs}px system-ui, sans-serif`; g.fillText(o.note || '', pad, h - fs * 1.6);
    g.font = `500 ${Math.round(fs * 0.6)}px system-ui, sans-serif`; g.fillText([title, o.speed].filter(Boolean).join(' · '), pad, h - fs * 0.6);
    if (o.latG != null && o.lonG != null) {              // the friction circle: 1 g at the edge
      const r = fs * 1.1, cx = w - pad - r, cy = h - fs * 2.6 - r - pad;
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(cx - Math.max(-1, Math.min(1, o.latG)) * r, cy - Math.max(-1, Math.min(1, o.lonG)) * r, fs * 0.22, 0, 2 * Math.PI); g.fill();
    }
    g.textAlign = 'right'; g.font = `800 ${Math.round(fs * 0.6)}px system-ui, sans-serif`; g.fillText('APEX NAV', w - pad, h - fs * 0.6); g.textAlign = 'left';
  }

  /**
   * Whether this browser can make the video at all: a recorder with a type it can write and a canvas it can stream. The
   * iOS web view has had no MediaRecorder or no canvas captureStream in some versions; there the panel isn't shown.
   */
  function supported(R = root) {
    const C = R.HTMLCanvasElement;
    return !!(R.ApexFlyoverVideo && R.ApexFlyoverVideo.mimeFor(R.MediaRecorder) && C && C.prototype && typeof C.prototype.captureStream === 'function');
  }

  /** page: el, Core, drive d, fmtSpeed, save(blob, name, type) → Promise. Returns the panel element. */
  function mount(page) {
    const { el, Core, d } = page, T = Core.elapsedS(d.speed_mps), total = T[T.length - 1] || 0;
    // a rule-separated section, not a box; the picker is an ink key, the offset the balance slider (REVIEW2.md U-18)
    const box = el('section', { className: 'dc-section' }, el('h2', { textContent: 'Dashcam overlay' }));
    const input = el('input', { type: 'file', accept: 'video/*', hidden: true }); input.setAttribute('aria-label', 'A video from this drive');
    const pick = el('label', { className: 'btn' }, 'Pick a video', input);
    // iOS (the owner's "make video doesn't work"): a video with display:none, or one not yet played, never loads its data,
    // so 'loadeddata' never came and Make the video stayed off. It stays in the page, 1 px and see-through, preloading.
    const video = el('video', { muted: true, playsInline: true, preload: 'auto' });
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    const canvas = el('canvas'), g = canvas.getContext('2d');
    canvas.style.cssText = 'width:100%;max-width:640px;display:none;background:#000';
    const offset = el('input', { type: 'range', min: '-600', max: String(Math.max(600, Math.ceil(total))), step: '1', value: '0' }); offset.setAttribute('aria-label', 'When the video starts in the drive (s)');
    const balance = el('label', { className: 'balance' }, el('span', { textContent: 'Earlier' }), offset, el('span', { textContent: 'Later' }));
    const offsetNote = el('p', { className: 'note', textContent: 'Video starts 0 s into the drive' });
    const exportBtn = el('button', { className: 'btn', textContent: 'Make the video', disabled: true });
    const note = el('p', { className: 'note', textContent: 'Pick a video you filmed on this drive, slide until the corner calls line up, then make the video. It stays on this phone.' });
    const paint = () => {
      if (!video.videoWidth) return;
      canvas.width = Math.min(1280, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawOverlay(g, canvas.width, canvas.height, overlayAt(d, T, video.currentTime, Number(offset.value), page.fmtSpeed), d.name || '');
    };
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      pick.firstChild.textContent = 'Pick another video';
      video.src = URL.createObjectURL(f);
      video.addEventListener('loadedmetadata', () => {
        canvas.style.display = 'block'; exportBtn.disabled = false;
        // a muted play and pause makes iOS decode a frame; then the preview seeks to it
        Promise.resolve(video.play()).catch(() => {}).then(() => { video.pause(); video.currentTime = Math.min(5, (video.duration || 0) / 2 || 0); });
      }, { once: true });
      video.load();
    });
    video.addEventListener('seeked', paint); video.addEventListener('timeupdate', paint);
    offset.addEventListener('input', () => { offsetNote.textContent = `Video starts ${offset.value} s into the drive`; paint(); });
    exportBtn.addEventListener('click', async () => {
      const MR = root.MediaRecorder, mime = root.ApexFlyoverVideo && root.ApexFlyoverVideo.mimeFor(MR);
      if (!mime || !canvas.captureStream) { note.textContent = 'This browser can’t make videos.'; return; }
      exportBtn.disabled = true; note.textContent = 'Making the video: it plays through once.';
      let raf = 0;
      try {
        paint();                                                       // a frame on the canvas before the stream starts
        const rec = new MR(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 }), chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise((ok) => { rec.onstop = ok; });
        const loop = () => { paint(); raf = root.requestAnimationFrame(loop); };
        video.currentTime = 0;
        const ended = new Promise((ok) => video.addEventListener('ended', ok, { once: true }));
        await video.play(); rec.start(1000); loop();
        await ended;
        root.cancelAnimationFrame(raf); raf = 0; rec.stop(); await done;
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) throw new Error('empty');
        await page.save(blob, root.ApexFlyoverVideo.fileName(`${d.name || 'drive'}-dashcam`, mime), mime.split(';')[0]);
        note.textContent = 'Done. The sound isn’t kept.';
      } catch (_) {
        if (raf) root.cancelAnimationFrame(raf);
        note.textContent = 'Couldn’t make the video on this phone.';
      }
      exportBtn.disabled = false;
    });
    box.append(note, pick, video, canvas, balance, offsetNote, exportBtn);
    return box;
  }

  const api = { indexAt, overlayAt, drawOverlay, mount, supported };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDashcam = api;
})(typeof window !== 'undefined' ? window : globalThis);
