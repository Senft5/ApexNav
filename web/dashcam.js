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
    g.textAlign = 'right'; g.font = `800 ${Math.round(fs * 0.6)}px system-ui, sans-serif`; g.fillText('VETTA', w - pad, h - fs * 0.6); g.textAlign = 'left';
  }

  /**
   * Whether this browser can make the video at all: a recorder with a type it can write and a canvas it can stream. The
   * iOS web view has had no MediaRecorder or no canvas captureStream in some versions; there the panel isn't shown.
   */
  function supported(R = root) {
    const C = R.HTMLCanvasElement;
    return !!(R.ApexFlyoverVideo && R.ApexFlyoverVideo.mimeFor(R.MediaRecorder) && C && C.prototype && typeof C.prototype.captureStream === 'function');
  }


  // ---- lining it up (TestFlight 13: "how do i slide to align when video doesn't preview?") ------------------------------
  /** The drive's corner calls in road order: [{ i, call, dist_m }], i the 5 m sample the corner is at. */
  function cornerCalls(d) {
    const n = (d.speed_mps || []).length;
    return (d.events || []).filter((e) => e.type === 'corner' && finite(e.dist_m) && e.call)
      .sort((a, b) => a.dist_m - b.dist_m)
      .map((e) => ({ i: Math.max(0, Math.min(n - 1, Math.round(e.dist_m / 5))), call: e.call, dist_m: e.dist_m }));
  }
  /** The video time at which drive time tDrive shows, with the video starting offsetS seconds into the drive. */
  const videoTimeFor = (tDrive, offsetS) => tDrive - offsetS;
  /** The call after (dir 1) or before (dir -1) drive time tDrive: its index in calls, or -1. */
  function stepCall(calls, T, tDrive, dir) {
    if (dir > 0) { for (let k = 0; k < calls.length; k++) if (T[calls[k].i] > tDrive + 0.05) return k; return -1; }
    for (let k = calls.length - 1; k >= 0; k--) if (T[calls[k].i] < tDrive - 0.05) return k;
    return -1;
  }
  const secs = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(Math.abs(v))) : Math.abs(v).toFixed(1));
  /** The offset in words: "Video starts 163 s into the drive", or "… 12 s before the drive". */
  const offsetText = (v) => (v < 0 ? `Video starts ${secs(v)} s before the drive` : `Video starts ${secs(v)} s into the drive`);
  const clock = (t) => { const s = Math.max(0, t); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
  /** Whether a drawn frame has anything in it (RGBA bytes): WebKit leaves a frame it could not decode transparent. */
  function frameDrawn(rgba) {
    for (let k = 3; k < rgba.length; k += 4) if (rgba[k] > 0) return true;
    return false;
  }

  /**
   * Big bet 5: the app's own videos of this drive (DriveCam.swift index.json: [{ name, start_ms, dur_s }]) that overlap it,
   * from t0 (the drive's start, Unix ms) for totalS seconds, in order: [{ name, offsetS, durS, label }]. offsetS is where
   * the video starts in the drive, so it lines up by itself. A file without a length is not offered (it can't be placed).
   */
  function ownVideos(list, t0, totalS) {
    if (!Array.isArray(list) || !finite(t0) || !(totalS > 0)) return [];
    const mins = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
    const out = list.filter((v) => v && typeof v.name === 'string' && finite(v.start_ms) && finite(v.dur_s) && v.dur_s > 0)
      .map((v) => ({ name: v.name, offsetS: (v.start_ms - t0) / 1000, durS: v.dur_s }))
      .filter((v) => v.offsetS < totalS && v.offsetS + v.durS > 0)
      .sort((a, b) => a.offsetS - b.offsetS);
    return out.map((v, k) => ({ ...v, label: out.length === 1 ? `This drive's video \u00b7 ${mins(v.durS)}` : `Video ${k + 1} \u00b7 ${mins(v.durS)}` }));
  }

  /**
   * page: el, Core, drive d, fmtSpeed, save(blob, name, type) → Promise, and ownVideos() → Promise of the app's video list
   * (optional; videoUrl(name) is where one plays). Returns the panel element.
   */
  function mount(page) {
    const { el, Core, d } = page, R = root.ApexRecording, T = R && R.timesOf ? R.timesOf(Core, d) : Core.elapsedS(d.speed_mps), total = T[T.length - 1] || 0, calls = cornerCalls(d);
    // a rule-separated section, not a box; the picker is an ink key, the offset the balance slider (REVIEW2.md U-18)
    const box = el('section', { className: 'dc-section' }, el('h2', { textContent: 'Dashcam overlay' }));
    const input = el('input', { type: 'file', accept: 'video/*', hidden: true }); input.setAttribute('aria-label', 'A video from this drive');
    const pick = el('label', { className: 'btn' }, 'Pick a video', input);
    // The preview is the video itself, shown (WebKit loads and decodes a video it shows; one display:none or 1 px may never
    // load), with the overlay drawn over it by the same drawOverlay the made video uses, at the same proportions.
    const video = el('video', { muted: true, playsInline: true, preload: 'auto' });
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-label', 'Preview of the video');
    video.style.cssText = 'display:block;width:100%;height:auto';
    const ov = el('canvas', { className: 'dc-ov' }), og = ov.getContext('2d');
    ov.setAttribute('aria-hidden', 'true');
    const stage = el('div', { className: 'dc-stage', hidden: true }, video, ov);
    // the made video's own canvas: in the page (WebKit streams a canvas as it renders it), shown only while it is made
    const canvas = el('canvas'), g = canvas.getContext('2d');
    canvas.style.cssText = 'width:100%;max-width:640px;display:none;background:#000';
    const step = '0.1';                                           // (0.1: the app's own video lines up to a tenth)
    const offset = el('input', { type: 'range', min: '-600', max: String(Math.max(600, Math.ceil(total))), step, value: '0' }); offset.setAttribute('aria-label', 'When the video starts in the drive (s)');
    const balance = el('label', { className: 'balance' }, el('span', { textContent: 'Earlier' }), offset, el('span', { textContent: 'Later' }));
    const offsetNote = el('p', { className: 'note', textContent: offsetText(0) });
    const nudge = (label, dv, aria) => { const b = el('button', { className: 'btn', textContent: label, type: 'button' }); b.setAttribute('aria-label', aria); b.addEventListener('click', () => setOffset(Number(offset.value) + dv)); return b; };
    const fine = el('div', { className: 'dc-row' }, nudge('− 0.5 s', -0.5, 'Video starts half a second earlier in the drive'), nudge('+ 0.5 s', 0.5, 'Video starts half a second later in the drive'));
    // where the preview is: a free scrub through the video, or the previous / next corner call, which then stays put while
    // the offset slides, so the frame moves until the car is at that corner
    const scrub = el('input', { type: 'range', min: '0', max: '1', step: '0.1', value: '0' }); scrub.setAttribute('aria-label', 'Preview point in the video (s)');
    const scrubRow = el('label', { className: 'balance' }, el('span', { textContent: 'Start' }), scrub, el('span', { textContent: 'End' }));
    const prevB = el('button', { className: 'btn', textContent: '‹ Previous call', type: 'button' }), nextB = el('button', { className: 'btn', textContent: 'Next call ›', type: 'button' });
    const callRow = el('div', { className: 'dc-row' }, prevB, nextB);
    const where = el('p', { className: 'note dc-where' }); where.setAttribute('aria-live', 'polite');
    const tools = el('div', { className: 'dc-tools', hidden: true }, scrubRow, callRow, where);
    const exportBtn = el('button', { className: 'btn', textContent: 'Make the video', disabled: true });
    // before a video: a line and the key (walkthrough 2026-11-13: the slider, the nudges and Make the video sat under a
    // paragraph with nothing to act on); the lining up shows with the video, its line under the picture saying what to do
    const note = el('p', { className: 'note', textContent: 'Your speed, g and calls on a video you filmed on this drive. It stays on this phone.' });
    const lineup = el('div', { className: 'dc-lineup', hidden: true });
    const status = el('p', { className: 'note dc-status', hidden: true }); status.setAttribute('role', 'status');
    const say = (t) => { status.textContent = t || ''; status.hidden = !t; };

    // Corner clips (corner_clip.js, big bet 5): once the video is lined up, any corner it holds as a portrait clip to share
    const CC = root.ApexCornerClip;
    const clipPick = el('select', { className: 'dc-clip-pick' }); clipPick.setAttribute('aria-label', 'Corner for the clip');
    const clipBtn = el('button', { className: 'btn solid', textContent: 'Make a clip', type: 'button' });
    const clipCanvas = el('canvas', { className: 'dc-clip-canvas' });
    clipCanvas.style.cssText = 'width:min(100%,270px);display:none;background:#000;margin:8px 0';
    const clipNote = el('p', { className: 'note dc-clip-note' }); clipNote.setAttribute('role', 'status');
    // a reel: the drive's best corners the video holds (their own Driver Score), one after another in one portrait video
    const reelBtn = el('button', { className: 'btn', type: 'button', hidden: true });
    // the clip just made, to your friends or a crew (drive_posts.js compose, through the map page: page.post), for a member
    const postBtn = el('button', { className: 'btn solid dc-post', textContent: 'Post this clip', type: 'button', hidden: true });
    // Show speed: on this phone, for every clip made here (corner_clip.js speedShown); off for a Reel of a public road
    const speedBox = el('input', { type: 'checkbox', className: 'dc-speed' });
    speedBox.checked = !CC || !CC.speedShown || CC.speedShown();
    speedBox.addEventListener('change', () => { if (CC && CC.setSpeedShown) CC.setSpeedShown(speedBox.checked); if (!clipSaid) listClips(); });
    const speedRow = el('label', { className: 'dc-row dc-speed-row' }, speedBox, el('span', { textContent: 'Show speed on clips' }));
    const clips = el('div', { className: 'dc-clips', hidden: true }, el('h3', { textContent: 'Corner clips' }), el('div', { className: 'dc-row' }, clipPick, clipBtn), el('div', { className: 'dc-row' }, reelBtn), speedRow, clipCanvas, el('div', { className: 'dc-row' }, postBtn), clipNote);
    let clipList = [], clipBusy = false, clipSaid = '', reel = [];   // clipSaid: how the last clip went, kept until the video moves
    let made = null;                                                 // the last clip made: { blob, mime, label, call }
    const canPost = () => typeof page.post === 'function' && (typeof page.canPost !== 'function' || !!page.canPost());
    const keep = (blob, mime, label, call) => {
      made = { blob, mime: String(mime || blob.type || 'video/mp4').split(';')[0], label: String(label || '').slice(0, 60), call: call || '' };
      postBtn.textContent = 'Post this clip'; postBtn.disabled = false; postBtn.hidden = !canPost();
    };
    /** Posts the last clip made; { posted, said } (said: what the Post sheet said, for the key that asked). */
    async function postMade() {
      if (!made || clipBusy || !canPost()) return { posted: false, said: '' };
      const it = made;
      postBtn.disabled = true;
      let r = null;
      try { r = await page.post(it.blob, { driveId: d.id, cornerLabel: it.label, call: it.call, mime: it.mime }); } catch (_) { r = null; }
      const posted = r === true || !!(r && r.posted), said = (r && r.said) || '';
      if (said) { clipSaid = said; clipNote.textContent = clipSaid; }
      if (made === it) { if (posted) postBtn.textContent = 'Posted'; else postBtn.disabled = false; }
      return { posted, said };
    }
    postBtn.addEventListener('click', () => { postMade(); });
    const labelOf = (c) => { const all = CC.cornersOf(d), k = all.findIndex((x) => x.start === c.start && x.end === c.end);
      return { k: Math.max(0, k), call: k >= 0 ? all[k].call || '' : c.call || '', label: k >= 0 ? [`Corner ${k + 1}`, all[k].call].filter(Boolean).join(' \u00b7 ') : (c.call || '') }; };
    function listReel() {
      const R = root.ApexRecording, scored = R && R.cornersOf ? (() => { try { return R.cornersOf(d); } catch (_) { return []; } })() : [];
      const best = CC.bestOf(Core, d, scored, (c) => !!CC.clipWindow(T, c, off(), duration()), 3);
      reel = best.map((b) => { const c = scored[b.k]; return { ...labelOf(c), w: CC.clipWindow(T, c, off(), duration()) }; });
      reelBtn.hidden = reel.length < 2;
      reelBtn.textContent = `Your best ${reel.length} corners in one clip`;
      reelBtn.disabled = clipBusy || frameOk !== true;
    }
    function listClips() {
      if (!CC || clipBusy) return;
      const keep = clipPick.value;
      clipList = opened && frameOk !== false ? CC.clippable(d, T, off(), duration()) : [];
      clipPick.replaceChildren(...clipList.map((x) => { const o = el('option', { textContent: x.label }); o.value = String(x.k); return o; }));
      if (clipList.some((x) => String(x.k) === keep)) clipPick.value = keep;
      clips.hidden = !opened;
      clipBtn.disabled = !clipList.length || frameOk !== true;
      listReel();
      clipNote.textContent = clipList.length ? clipSaid || `A portrait clip of the corner, with its call${speedBox.checked ? ', speed' : ''} and g, ready for Reels or a message.`
        : 'No corner falls inside the video at this setting.';
    }

    let anchor = -1, opened = false, frameOk = null, busy = false, pending = null, openTimer = 0, dur = 0;
    const off = () => Number(offset.value);
    const duration = () => (finite(video.duration) && video.duration > 0 ? video.duration : dur);
    function drawPreview() {                                          // the overlay over the shown video, at its shown size
      const w = stage.clientWidth || 0, h = stage.clientHeight || 0, k = Math.min(2, root.devicePixelRatio || 1);
      if (!w || !h) return;
      if (ov.width !== Math.round(w * k) || ov.height !== Math.round(h * k)) { ov.width = Math.round(w * k); ov.height = Math.round(h * k); }
      og.clearRect(0, 0, ov.width, ov.height);
      drawOverlay(og, ov.width, ov.height, overlayAt(d, T, video.currentTime, off(), page.fmtSpeed), d.name || '');
    }
    // can this phone copy the video's frame? (the made video needs it). A frame not decoded yet draws nothing too, so it
    // is asked a few times over two seconds before the panel says it can't
    let tries = 0, retry = 0;
    function probe() {
      if (frameOk) return;
      let ok = false;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          const p = el('canvas'); p.width = 8; p.height = 8;
          const pg = p.getContext('2d'); pg.drawImage(video, 0, 0, 8, 8);
          ok = frameDrawn(pg.getImageData(0, 0, 8, 8).data);
        } catch (_) { ok = false; }
      }
      if (ok) { frameOk = true; clearTimeout(retry); exportBtn.disabled = false; say(''); listClips(); return; }
      exportBtn.disabled = true;
      if (++tries < 8) { clearTimeout(retry); retry = setTimeout(probe, 250); return; }
      frameOk = false;
      say('This phone shows the video but won’t let the app copy its frames, so it can’t make the video here. You can still line it up.');
    }
    function describe() {
      const vt = video.currentTime, at = `Preview at ${clock(vt)} in the video`;
      if (anchor < 0) { where.textContent = `${at}.`; return; }
      const c = calls[anchor], cvt = videoTimeFor(T[c.i], off()), D = duration();
      where.textContent = cvt < 0 || (D && cvt > D)
        ? `Corner call ${anchor + 1} of ${calls.length}, ${c.call}, is ${cvt < 0 ? 'before the video starts' : 'after the video ends'} at this setting: slide ${cvt < 0 ? 'Earlier' : 'Later'}.`
        : `${at}: corner call ${anchor + 1} of ${calls.length}, ${c.call}. Slide until the car is at this corner.`;
    }
    function seek(vt) {
      const D = duration();
      const t = Math.max(0, D ? Math.min(D - 0.05, vt) : vt);
      if (busy) { pending = t; return; }
      if (Math.abs(video.currentTime - t) < 0.02) { refresh(); return; }
      busy = true; video.currentTime = t;
    }
    function refresh() { drawPreview(); probe(); describe(); scrub.value = String(video.currentTime); listClips(); }
    function follow() {                                                // an anchored call stays put as the offset moves
      if (anchor < 0) { refresh(); return; }
      seek(videoTimeFor(T[calls[anchor].i], off()));
      describe();
    }
    function setOffset(v) {
      const lo = Number(offset.min), hi = Number(offset.max);
      offset.value = String(Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)));
      offsetNote.textContent = offsetText(off());
      clipSaid = ''; follow(); listClips();
    }
    function toCall(dir) {
      if (!calls.length) { where.textContent = 'This drive has no corner calls to line up with: use the slider under the picture.'; return; }
      const k = anchor >= 0 ? anchor + dir : stepCall(calls, T, video.currentTime + off(), dir);
      if (k < 0 || k >= calls.length) { where.textContent = dir > 0 ? 'That was the last corner call.' : 'That was the first corner call.'; return; }
      anchor = k; follow();
    }
    function ready() {                                                 // the video opened: show it and pick where to look first
      if (opened) return;
      opened = true; clearTimeout(openTimer); openTimer = 0;
      stage.hidden = false; tools.hidden = false; lineup.hidden = false; say('');
      dur = duration();
      scrub.max = String(Math.max(0.1, dur || 0));
      anchor = calls.findIndex((c) => { const v = videoTimeFor(T[c.i], off()); return v >= 0 && (!dur || v <= dur); });
      if (anchor >= 0) follow(); else seek(Math.min(5, dur / 2 || 0));
    }
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      pick.firstChild.textContent = 'Pick another video'; shownOwn = '';
      openSrc(URL.createObjectURL(f), null);
    });
    /** Opens a video (a picked file, or the app's own film of the drive with where it starts in the drive). */
    function openSrc(src, startS) {
      if (startS != null) setOffset(startS);
      opened = false; frameOk = null; tries = 0; clearTimeout(retry); anchor = -1; busy = false; pending = null; dur = 0; clipSaid = '';
      stage.hidden = true; tools.hidden = true; lineup.hidden = true; exportBtn.disabled = true;
      say('Opening the video…');
      video.src = src;
      video.load();
      // a muted play and pause makes iOS fetch and decode it (preload alone may not); then the preview seeks
      Promise.resolve(video.play()).catch(() => {}).then(() => { video.pause(); });
      clearTimeout(openTimer);
      openTimer = setTimeout(() => { if (!opened) say('No preview: this phone hasn’t opened the video in the app. Try picking it again, or a video from the Camera app.'); }, 10000);
    }
    // the app's own film of this drive (DriveCam.swift): one key per video, lined up by itself
    const own = el('div', { className: 'dc-row dc-own', hidden: true });
    let vids = [], shownOwn = '', ownList = [];
    if (typeof page.ownVideos === 'function') {
      Promise.resolve().then(() => page.ownVideos()).then((list) => {
        ownList = Array.isArray(list) ? list : []; vids = ownVideos(ownList, d.t0, total);
        own.replaceChildren(...vids.map((v) => {
          const b = el('button', { className: 'btn solid', type: 'button', textContent: v.label });
          b.addEventListener('click', () => { shownOwn = v.name; pick.firstChild.textContent = 'Pick another video'; openSrc(page.videoUrl(v.name), Math.max(-600, v.offsetS)); });
          return b;
        }));
        own.hidden = !vids.length;
        if (vids.length) note.textContent = 'Vetta filmed this drive: open the video and it is lined up already. Corner clips are under it.';
      }).catch(() => {});
    }
    video.addEventListener('loadedmetadata', () => {
      if (finite(video.duration)) { ready(); return; }
      // a recorded WebM can say its length is unknown until a seek far past its end finds it
      const found = () => { if (finite(video.duration)) { video.removeEventListener('durationchange', found); video.currentTime = 0; ready(); } };
      video.addEventListener('durationchange', found);
      video.currentTime = 1e7;
      setTimeout(() => { video.removeEventListener('durationchange', found); if (!opened) { video.currentTime = 0; ready(); } }, 3000);
    });
    video.addEventListener('error', () => {
      clearTimeout(openTimer); stage.hidden = true; tools.hidden = true; lineup.hidden = true; exportBtn.disabled = true;
      say('This phone couldn’t open that video, so there’s nothing to preview. A video from the Camera app (MP4 or MOV) works best.');
    });
    video.addEventListener('seeked', () => {
      busy = false;
      if (pending != null) { const t = pending; pending = null; seek(t); return; }
      if (opened) refresh();
    });
    video.addEventListener('timeupdate', () => { if (opened && !video.paused) drawPreview(); });
    offset.addEventListener('input', () => setOffset(off()));
    scrub.addEventListener('input', () => { anchor = -1; seek(Number(scrub.value)); });
    prevB.addEventListener('click', () => toCall(-1)); nextB.addEventListener('click', () => toCall(1));
    if (root.ResizeObserver) new root.ResizeObserver(() => { if (opened) drawPreview(); }).observe(stage);

    const paint = () => {                                              // a frame of the made video
      if (!video.videoWidth) return;
      canvas.width = Math.min(1280, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawOverlay(g, canvas.width, canvas.height, overlayAt(d, T, video.currentTime, off(), page.fmtSpeed), d.name || '');
    };
    exportBtn.addEventListener('click', async () => {
      const MR = root.MediaRecorder, mime = root.ApexFlyoverVideo && root.ApexFlyoverVideo.mimeFor(MR);
      if (!mime || !canvas.captureStream) { note.textContent = 'This browser can’t make videos.'; return; }
      exportBtn.disabled = true; note.textContent = 'Making the video: it plays through once.';
      stage.hidden = true; tools.hidden = true; canvas.style.display = 'block';
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
      canvas.style.display = 'none'; stage.hidden = false; tools.hidden = false;
      exportBtn.disabled = frameOk === false;
      follow();
    });
    /** Makes and shares the clip of x ({ k, label, w }); true when it was handed to the share sheet. */
    async function makeClip(x, parts = null) {
      if (!x || clipBusy) return false;
      let ok = false;
      clipBusy = true; clipBtn.disabled = true; clipNote.textContent = 'Making the clip: it plays through once.';
      clipCanvas.style.display = 'block';
      try {
        const { blob, mime } = await CC.record({ video, d, T, w: x.w, offsetS: off(), fmtSpeed: page.fmtSpeed, canvas: clipCanvas,
          meta: { title: d.name || '', label: x.label }, ...(parts ? { parts } : {}) });
        keep(blob, mime, parts ? `Best ${parts.length} corners` : x.label, parts ? '' : x.call);   // kept before the share sheet: a Cancel there keeps it to post
        let copied = false;
        await page.save(blob, root.ApexFlyoverVideo.fileName(`${d.name || 'drive'}-${parts ? 'best-corners' : `corner-${x.k + 1}`}`, mime), mime.split(';')[0],
          { caption: CC.caption ? CC.caption(d, parts ? '' : x.call) : '', copied: () => { copied = true; } });
        clipSaid = copied ? 'Done. Its caption is copied, ready to paste. The sound isn\u2019t kept.' : 'Done. The sound isn\u2019t kept.'; ok = true;
      } catch (_) { clipSaid = 'Couldn\u2019t make the clip on this phone.'; }
      clipNote.textContent = clipSaid;
      clipCanvas.style.display = 'none'; clipBusy = false; clipBtn.disabled = !clipList.length || frameOk !== true; reelBtn.disabled = frameOk !== true;
      follow();
      return ok;
    }
    clipBtn.addEventListener('click', () => makeClip(clipList.find((c) => String(c.k) === clipPick.value)));
    reelBtn.addEventListener('click', () => { if (reel.length >= 2) { reelBtn.disabled = true; makeClip(reel[0], reel.map((r) => ({ w: r.w, label: r.label }))); } });

    // One tap from a corner on the drive's page (drive_view.js): the app's own video that holds the corner (start, end in
    // 5 m samples), opened lined up if it isn't yet, and the clip made from it
    const ownFor = (start, end) => (CC ? vids.find((v) => CC.clipWindow(T, { start, end }, v.offsetS, v.durS)) : null);
    box.canClip = (start, end) => !!ownFor(start, end);
    box.canPost = () => !!made && canPost();                         // the clip just made can go to friends or a crew
    box.post = postMade;
    // Side by side (ghost_clip.js): this pass and the best pass, when the app filmed both drives. other: { d (that drive),
    // bWin: [start, end] of the corner on it, trace (corner_trace.js), when }
    function ghostPlan(start, end, other) {
      const GC = root.ApexGhostClip, R = root.ApexRecording;
      if (!GC || !R || !other || !other.d || !Array.isArray(other.bWin) || !Array.isArray(other.d.speed_mps)) return null;
      const va = ownFor(start, end);
      if (!va) return null;
      const Tb = R.timesOf(Core, other.d), [bs, be] = other.bWin;
      for (const vb of ownVideos(ownList, other.d.t0, Tb[Tb.length - 1] || 0)) {
        const a = { T, start, end, offsetS: va.offsetS, dur: va.durS, d }, b = { T: Tb, start: bs, end: be, offsetS: vb.offsetS, dur: vb.durS, d: other.d };
        const w = GC.windows(a, b);
        if (w) return { va, vb, a, b, w };
      }
      return null;
    }
    box.canGhost = (start, end, other) => !!ghostPlan(start, end, other);
    box.ghost = async (start, end, other) => {
      const p = ghostPlan(start, end, other);
      if (!p || clipBusy) return false;
      clipBusy = true; clipBtn.disabled = true; reelBtn.disabled = true; clipNote.textContent = 'Making the side-by-side clip: both play through once.';
      // the two videos shown small while they play (WebKit decodes a video it shows), the clip's canvas beside them
      const mkv = (name) => { const v = el('video', { muted: true, playsInline: true, preload: 'auto' }); v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
        v.style.cssText = 'width:72px;height:auto;margin-right:6px'; v.src = page.videoUrl(name); return v; };
      const va = mkv(p.va.name), vb = mkv(p.vb.name), row = el('div', { className: 'dc-row dc-ghost-src' }, va, vb);
      clips.insertBefore(row, clipCanvas); clipCanvas.style.display = 'block';
      const opened = (v) => new Promise((ok, no) => { if (v.readyState >= 1) { ok(); return; } v.addEventListener('loadedmetadata', ok, { once: true }); v.addEventListener('error', no, { once: true }); setTimeout(no, 12000); });
      let ok = false;
      try {
        va.load(); vb.load();
        await Promise.all([opened(va), opened(vb)]);
        const lab = labelOf({ start, end });
        const { blob, mime } = await root.ApexGhostClip.record({ va, vb, a: p.a, b: p.b, w: p.w, trace: other.trace, fmtSpeed: page.fmtSpeed, canvas: clipCanvas,
          meta: { title: d.name || '', label: lab.label, whenB: other.when || '' } });
        keep(blob, mime, `${lab.label} · side by side`, '');
        let copied = false;
        await page.save(blob, root.ApexFlyoverVideo.fileName(`${d.name || 'drive'}-side-by-side-${lab.k + 1}`, mime), mime.split(';')[0],
          { caption: CC && CC.caption ? CC.caption(d, lab.call) : '', copied: () => { copied = true; } });
        clipSaid = copied ? 'Done. Its caption is copied, ready to paste. The sound isn\u2019t kept.' : 'Done. The sound isn\u2019t kept.'; ok = true;
      } catch (_) { clipSaid = 'Couldn\u2019t make the side-by-side clip on this phone.'; }
      for (const v of [va, vb]) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {} }
      row.remove(); clipCanvas.style.display = 'none'; clipNote.textContent = clipSaid;
      clipBusy = false; clipBtn.disabled = !clipList.length || frameOk !== true; reelBtn.disabled = frameOk !== true;
      return ok;
    };
    box.clip = async (start, end) => {
      const v = ownFor(start, end);
      if (!v || clipBusy) return false;
      if (shownOwn !== v.name) { shownOwn = v.name; pick.firstChild.textContent = 'Pick another video'; openSrc(page.videoUrl(v.name), Math.max(-600, v.offsetS)); }
      for (let n = 0; n < 60 && frameOk !== true; n++) {               // opened and its frames copyable, up to 12 s
        if (frameOk === false) return false;
        await new Promise((ok) => setTimeout(ok, 200));
      }
      const w = frameOk === true && CC.clipWindow(T, { start, end }, off(), duration());
      if (!w) return false;
      return makeClip({ ...labelOf({ start, end }), w });
    };
    lineup.append(balance, fine, offsetNote, exportBtn);
    box.append(note, own, pick, status, stage, tools, canvas, lineup, clips);
    return box;
  }

  const api = { indexAt, overlayAt, drawOverlay, mount, supported, ownVideos, cornerCalls, videoTimeFor, stepCall, offsetText, frameDrawn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDashcam = api;
})(typeof window !== 'undefined' ? window : globalThis);
