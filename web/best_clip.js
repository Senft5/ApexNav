// A drive's best corner clip, for anywhere outside the Log (big bet 5): the end card's Friends post, a share. The drive's
// corners that the app's own film holds (Film the drive, DriveCam.swift: lined up by the clock, no slider) are ranked by
// their own Driver Score (corner_clip.js bestOf) and the best one is cut, with its lead and tail, as the Log's corner
// clip is. Nothing is guessed: a drive with no film, or no corner inside it, has no clip (null).
//
//   ApexBestClip.find(driveOrId)  → Promise<{ driveId, url, name, start, end, k, label, call, score } | null>
//       url plays the video (apexnav://…/drivecam/<name>); start and end are seconds in that video.
//   ApexBestClip.make(found)      → Promise<{ blob, mime }> the portrait clip (720×1280, call, speed and g burned in, no
//       sound), made on the phone by playing the stretch once (about 10 s). Throws when this phone can't record.
//
// pick() is the pure part (tests/test_best_clip.py). On the map page this file and its helpers load lazily
// (ApexLazy.load('clips')).
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * The best corner the drive's own videos hold, or null. d: the drive record (t0, speed_mps, events…); list: DriveCam's
   * index.json ([{ name, start_ms, dur_s }]); lib: { Core, Rec (ApexRecording), CC (ApexCornerClip), DC (ApexDashcam) }.
   * { name, offsetS (where the video starts in the drive), start, end (video s), k, label, call, score }.
   */
  function pick(d, list, lib) {
    const { Core, Rec, CC, DC } = lib || {};
    if (!d || !Core || !Rec || !CC || !DC || !d.speed_mps || !d.speed_mps.length) return null;
    const T = Rec.timesOf ? Rec.timesOf(Core, d) : Core.elapsedS(d.speed_mps), total = T[T.length - 1] || 0;
    const vids = DC.ownVideos(list, d.t0, total);
    if (!vids.length) return null;
    let corners = [];
    try { corners = Rec.cornersOf(d) || []; } catch (_) { corners = []; }
    const holder = (c) => vids.find((v) => CC.clipWindow(T, c, v.offsetS, v.durS));
    const [best] = CC.bestOf(Core, d, corners, (c) => !!holder(c), 1);
    if (!best) return null;
    const c = corners[best.k], v = holder(c), w = CC.clipWindow(T, c, v.offsetS, v.durS);
    const calls = CC.cornersOf(d), j = calls.findIndex((x) => x.start === c.start && x.end === c.end), call = j >= 0 ? calls[j].call || '' : '';
    return { name: v.name, offsetS: v.offsetS, start: w.vt0, end: w.vt1, k: j >= 0 ? j : best.k,
             label: [`Corner ${(j >= 0 ? j : best.k) + 1}`, call].filter(Boolean).join(' · '), call, score: best.score };
  }

  // ---- the page side ----------------------------------------------------------------------------------------------
  const base = () => root.APEX_DRIVECAM || 'drivecam/';
  const filmed = () => !!(root.location && (root.location.protocol === 'apexnav:' || root.APEX_DRIVECAM));
  const libs = async () => {
    if (!(root.ApexCornerClip && root.ApexDashcam) && root.ApexLazy) await root.ApexLazy.load('clips');
    return { Core: root.ApexCore, Rec: root.ApexRecording, CC: root.ApexCornerClip, DC: root.ApexDashcam };
  };
  const records = new Map();         // drive id -> its record, for make() after find()

  async function find(driveOrId) {
    if (!filmed() || !root.ApexRecording) return null;
    const lib = await libs();
    let d = driveOrId;
    if (typeof d === 'string') d = await lib.Rec.get(d);
    if (!d || !finite(d.t0)) return null;
    if (lib.Rec.repair) d = lib.Rec.repair(lib.Core, d);
    let list = [];
    try { const r = await root.fetch(`${base()}index.json`, { cache: 'no-store' }); list = r.ok ? await r.json() : []; } catch (_) { list = []; }
    const p = pick(d, list, lib);
    if (!p) return null;
    records.set(d.id, d);
    return { driveId: d.id, url: `${base()}${encodeURIComponent(p.name)}`, ...p };
  }

  async function make(found, { fmtSpeed } = {}) {
    if (!found) throw new Error('no clip');
    const lib = await libs(), d = records.get(found.driveId) || await lib.Rec.get(found.driveId);
    if (!d) throw new Error('no drive');
    const T = lib.Rec.timesOf(lib.Core, d);
    const video = root.document.createElement('video'), canvas = root.document.createElement('canvas');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    // shown, small and out of the way (WebKit may never load a video it doesn't show), and gone once made
    const hold = root.document.createElement('div');
    hold.setAttribute('aria-hidden', 'true');
    hold.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none';
    video.style.cssText = canvas.style.cssText = 'width:2px;height:2px';
    hold.append(video, canvas); root.document.body.append(hold);
    try {
      await new Promise((ok, fail) => { video.onloadeddata = ok; video.onerror = () => fail(new Error('video')); video.src = found.url; setTimeout(ok, 8000); });
      const U = root.ApexUnits, fmt = fmtSpeed || ((v) => (U && U.speed && U.speedU ? `${Math.round(U.speed(v))} ${U.speedU()}` : `${Math.round(v * 2.2369362921)} mph`));
      return await lib.CC.record({ video, d, T, w: { vt0: found.start, vt1: found.end, t0: found.start + found.offsetS, t1: found.end + found.offsetS },
        offsetS: found.offsetS, fmtSpeed: fmt, canvas, meta: { title: d.name || '', label: found.label } });
    } finally { hold.remove(); }
  }

  const api = { pick, find, make };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexBestClip = api;
})(typeof window !== 'undefined' ? window : globalThis);
