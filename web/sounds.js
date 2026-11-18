// Practice Loop on the web (Nate 2026-11-18): sounds.vettadrive.app (backend/src/hosts.ts SOUNDS_HOST, web/sounds.html),
// open to anyone. The same sheet as the app (web/practice_loop.js) and the same pictures (web/practice_viz.js), driven
// by this player instead of the native one: it answers the sheet's {cmd: 'practice', action} messages exactly as
// PracticeLoop.swift does, so the sheet can't tell them apart.
//
// The sound is WebAudio, scheduled ahead on the audio clock: every click and note time is computed from its block's start
// on the 16th-note grid (never added up), as ApexKit PracticeRenderer does, so nothing drifts. The callout is the
// browser's speech, spoken over the block's lead. The theory (pool, repetition, tempos, note values, picker, range) is
// ApexKit PracticeLoop.swift / PracticeVoice.swift, ported. A browser stops sound when the phone locks; the app doesn't.
(function (root) {
  'use strict';
  const ITEMS = [
    ['Ionian', 'Ionian', 'mode', [0, 2, 4, 5, 7, 9, 11]], ['Dorian', 'Dorian', 'mode', [0, 2, 3, 5, 7, 9, 10]],
    ['Phrygian', 'Phrygian', 'mode', [0, 1, 3, 5, 7, 8, 10]], ['Lydian', 'Lydian', 'mode', [0, 2, 4, 6, 7, 9, 11]],
    ['Mixolydian', 'Mixolydian', 'mode', [0, 2, 4, 5, 7, 9, 10]], ['Aeolian', 'Aeolian', 'mode', [0, 2, 3, 5, 7, 8, 10]],
    ['Locrian', 'Locrian', 'mode', [0, 1, 3, 5, 6, 8, 10]],
    ['natural minor', 'natural minor', 'scale', [0, 2, 3, 5, 7, 8, 10]], ['harmonic minor', 'harmonic minor', 'scale', [0, 2, 3, 5, 7, 8, 11]],
    ['melodic minor', 'melodic minor', 'scale', [0, 2, 3, 5, 7, 9, 11]], ['major pentatonic', 'major pentatonic', 'scale', [0, 2, 4, 7, 9]],
    ['minor pentatonic', 'minor pentatonic', 'scale', [0, 3, 5, 7, 10]], ['blues', 'blues scale', 'scale', [0, 3, 5, 6, 7, 10]],
    ['whole tone', 'whole tone', 'scale', [0, 2, 4, 6, 8, 10]],
    ['diminished W-H', 'diminished, whole half', 'scale', [0, 2, 3, 5, 6, 8, 9, 11]], ['diminished H-W', 'diminished, half whole', 'scale', [0, 1, 3, 4, 6, 7, 9, 10]],
    ['major arpeggio', 'major arpeggio', 'arpeggio', [0, 4, 7]], ['minor arpeggio', 'minor arpeggio', 'arpeggio', [0, 3, 7]],
    ['7 arpeggio', 'dominant seven arpeggio', 'arpeggio', [0, 4, 7, 10]], ['maj7 arpeggio', 'major seven arpeggio', 'arpeggio', [0, 4, 7, 11]],
    ['m7 arpeggio', 'minor seven arpeggio', 'arpeggio', [0, 3, 7, 10]], ['m7♭5 arpeggio', 'minor seven flat five arpeggio', 'arpeggio', [0, 3, 6, 10]],
    ['dim7 arpeggio', 'diminished seven arpeggio', 'arpeggio', [0, 3, 6, 9]], ['aug arpeggio', 'augmented arpeggio', 'arpeggio', [0, 4, 8]],
  ].map(([name, spoken, kind, intervals]) => ({ name, spoken, kind, intervals }));
  const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SPOKEN = ['C', 'D flat', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat', 'A', 'B flat', 'B'];
  const POOL = [40, 44, 48, 52, 56, 60, 66, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
    126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208];
  const VALUES = { 16: ['whole notes', 'whole'], 8: ['half notes', 'half'], 4: ['quarter notes', 'quarter'], 2: ['eighth notes', '8ths'], 1: ['sixteenth notes', '16ths'] };
  const STEPS = [16, 8, 4, 2, 1];
  const DEFAULTS = { lockRoot: null, focus: 'all', bpmMin: 60, bpmMax: 120, repsMin: 5, repsMax: 10, drone: true, volume: 0.8, sleepMin: 0, values: STEPS.slice() };
  const KEY = 'vetta.sounds.v1';

  const rep = (it) => { const up = [...it.intervals, 12]; return [...up, ...up.slice(0, -1).reverse()]; };
  const barsPerRep = (it, step) => Math.ceil(rep(it).length * step / 16);
  const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pc = (m) => ((m % 12) + 12) % 12;
  const noteName = (m) => `${NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function clamp(s) {
    const c = { ...DEFAULTS, ...s };
    if (c.lockRoot != null && !(c.lockRoot >= 0 && c.lockRoot < 12)) c.lockRoot = null;
    if (!['all', 'modes', 'scales', 'arpeggios'].includes(c.focus)) c.focus = 'all';
    if (c.bpmMin > c.bpmMax) [c.bpmMin, c.bpmMax] = [c.bpmMax, c.bpmMin];
    if (c.repsMin > c.repsMax) [c.repsMin, c.repsMax] = [c.repsMax, c.repsMin];
    c.values = STEPS.filter((x) => (c.values || []).includes(x));
    if (!c.values.length) c.values = STEPS.slice();
    return c;
  }
  function bpms(s) {
    const inside = POOL.filter((b) => b >= s.bpmMin && b <= s.bpmMax);
    if (inside.length) return inside;
    const mid = (s.bpmMin + s.bpmMax) / 2;
    return [POOL.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))];
  }
  function itemsFor(f) {
    return f === 'modes' ? ITEMS.filter((i) => i.kind === 'mode') : f === 'scales' ? ITEMS.filter((i) => i.kind !== 'arpeggio')
      : f === 'arpeggios' ? ITEMS.filter((i) => i.kind === 'arpeggio') : ITEMS;
  }
  /** PracticeRange.bases: where a root may sit so root...root+12 fits inside lo...hi. */
  function bases(lo, hi, root) {
    const fit = []; for (let b = lo; b <= hi - 12; b++) fit.push(b);
    if (root != null) {
      const mine = fit.filter((b) => pc(b) === root);
      if (mine.length) return mine;
      const all = []; for (let b = lo - 12; b <= hi; b++) if (pc(b) === root) all.push(b);
      const over = (b) => Math.max(0, lo - b) + Math.max(0, b + 12 - hi);
      const least = Math.min(...all.map(over));
      return all.filter((b) => over(b) === least);
    }
    return fit.length ? fit : [lo + Math.floor((hi - lo - 12) / 2)];
  }
  function nextPick(s, last, range) {
    let p, tries = 0;
    do {
      let root = s.lockRoot != null ? s.lockRoot : randInt(0, 11), base = 60 + root;
      if (range) { base = pickOf(bases(range.lo, range.hi, s.lockRoot)); root = pc(base); }
      p = { root, base, item: pickOf(itemsFor(s.focus)), bpm: pickOf(bpms(s)), reps: randInt(s.repsMin, s.repsMax), step: pickOf(s.values) };
      tries++;
    } while (tries < 8 && last && last.root === p.root && last.item === p.item);
    p.title = `${NAMES[p.root]} ${p.item.name} · ${p.bpm} · ${VALUES[p.step][1]}`;
    p.callout = `${SPOKEN[p.root]} ${p.item.spoken}, ${p.bpm} BPM, ${VALUES[p.step][0]}`;
    p.drone = p.base - 24 >= 28 ? p.base - 24 : p.base - 12;
    return p;
  }

  // YIN (PracticePitch.detect) and the held-note tracker (PracticeRangeTracker)
  function detect(x, sr, minHz = 60, maxHz = 1400, threshold = 0.15) {
    const maxTau = Math.floor(sr / minHz), minTau = Math.max(2, Math.floor(sr / maxHz));
    const w = x.length - maxTau - 1;
    if (w < maxTau / 2) return null;
    let e = 0; for (let i = 0; i < w; i++) e += x[i] * x[i];
    if (e / w <= 1e-6) return null;
    const d = new Float32Array(maxTau + 2), c = new Float32Array(maxTau + 2).fill(1);
    for (let tau = 1; tau <= maxTau + 1; tau++) { let s = 0; for (let i = 0; i < w; i++) { const v = x[i] - x[i + tau]; s += v * v; } d[tau] = s; }
    let run = 0;
    for (let tau = 1; tau <= maxTau + 1; tau++) { run += d[tau]; c[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let found = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (c[tau] < threshold) { while (tau + 1 <= maxTau && c[tau + 1] < c[tau]) tau++; found = tau; break; }
    }
    if (found < 0) return null;
    const a = c[found - 1], b = c[found], cc = c[found + 1], den = a - 2 * b + cc;
    const shift = den !== 0 ? (a - cc) / (2 * den) : 0;
    const f = sr / (found + Math.max(-1, Math.min(1, shift)));
    return f >= minHz * 0.97 && f <= maxHz * 1.03 ? f : null;
  }
  function tracker(sr) {
    const hop = Math.floor(sr * 0.025), hold = Math.ceil(0.35 * sr / hop);
    let run = [];
    const t = { now: null, lowest: null, highest: null, reset() { run = []; t.now = t.lowest = t.highest = null; } };
    t.analyse = (x) => {
      const f = detect(x, sr);
      if (f == null) { run = []; t.now = null; return; }
      const m = 69 + 12 * Math.log2(f / 440);
      t.now = Math.round(m);
      if (run.length && (Math.abs(m - run[0]) > 0.5 || Math.round(m) !== Math.round(run[0]))) run = [];
      run.push(m);
      if (run.length >= hold) {
        const s = run.slice().sort((p, q) => p - q), n = Math.round(s[s.length >> 1]);
        t.lowest = Math.min(t.lowest ?? n, n); t.highest = Math.max(t.highest ?? n, n);
      }
    };
    return t;
  }

  /** The player. `send(msg)` gets what the native shell would send the page ({type: 'practice' | 'practiceClock' | 'practiceRange'}). */
  function player(send) {
    let settings = DEFAULTS;
    try { settings = clamp(JSON.parse(root.localStorage.getItem(KEY) || '{}')); } catch (_) { settings = clamp({}); }
    let ctx = null, master = null, wave = null, timer = 0, active = false, playing = false, watching = false;
    let block = null, last = null, startedAt = 0, range = null;
    let rangeStep = null, rangeLow = null, rangeError = null, heard = { now: null, low: null, high: null };
    let mic = null, micTimer = 0, micTrack = null, stepTimeout = 0;
    const LEAD = 2.4;                                  // s of drone and callout before the count-in

    function report() {
      send({ type: 'practice', active, playing, title: block ? block.p.title : null, settings, range: rangeMsg() });
    }
    function rangeMsg() {
      const m = { step: rangeStep };
      if (range) { m.lo = range.lo; m.hi = range.hi; m.label = `${noteName(range.lo)} to ${noteName(range.hi)}`; }
      if (heard.now != null) m.now = noteName(heard.now);
      const best = rangeStep === 'high' ? heard.high : heard.low;
      if (best != null) m.best = noteName(best);
      if (rangeLow != null) m.low = noteName(rangeLow);
      if (rangeError) m.error = rangeError;
      return m;
    }
    const sendRange = () => send({ type: 'practiceRange', ...rangeMsg() });

    // iPhone: Web Audio follows the ringer switch unless the page says it is playback, and the first sound and the first
    // speech must start inside the tap. So, on every Play tap: the session type, a looping silent <audio> (older Safari
    // routes Web Audio as media once a media element plays), a resume, and an empty utterance to unlock speech.
    let silent = null;
    function unlock() {
      try { if (root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (_) { /* older Safari */ }
      try {
        if (!silent) {
          silent = root.document.createElement('audio');
          silent.setAttribute('playsinline', ''); silent.loop = true;
          silent.src = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
        }
        const pr = silent.play(); if (pr && pr.catch) pr.catch(() => {});
      } catch (_) { /* no media element */ }
      audio();
      if (ctx.state !== 'running') { const pr = ctx.resume(); if (pr && pr.catch) pr.catch(() => {}); }
      // a one-sample click inside the tap, which some iOS versions need before anything scheduled is heard
      try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); } catch (_) { /* fine */ }
      try { if (root.speechSynthesis && !spoke) { const u = new root.SpeechSynthesisUtterance(' '); u.volume = 0; root.speechSynthesis.speak(u); spoke = true; } } catch (_) { /* no speech */ }
    }
    let spoke = false;

    function audio() {
      if (ctx) return ctx;
      const AC = root.AudioContext || root.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = settings.volume; master.connect(ctx.destination);
      wave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.12]));
      return ctx;
    }

    // a block: lead (drone + callout), a bar of count-in, then reps × repSixteenths 16ths; times from its own start
    function makeBlock(at) {
      const p = nextPick(settings, last, range); last = p;
      const notes = rep(p.item), rs = barsPerRep(p.item, p.step) * 16, six = 15 / p.bpm;
      const b = { p, notes, rs, six, t0: at, c0: at + LEAD, k: 0, reps: p.reps, nodes: [] };
      b.end = () => b.c0 + (16 + b.reps * b.rs) * b.six;
      b.at = (k) => b.c0 + k * b.six;
      return b;
    }
    function droneFor(b) {
      if (!settings.drone) return;
      const g = ctx.createGain(), t = b.t0, end = b.end();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.5);
      g.gain.setValueAtTime(0.12, Math.max(t + 0.5, end - 0.5)); g.gain.linearRampToValueAtTime(0, end);
      g.connect(master);
      for (const [mul, amp] of [[1, 1], [2, 0.5], [3, 0.18]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.value = hz(b.p.drone) * mul; og.gain.value = amp;
        o.connect(og); og.connect(g); o.start(t); o.stop(end + 0.05);
        b.nodes.push(o);
      }
      b.droneGain = g;
    }
    function callout(b) {
      const say = () => {
        if (!root.speechSynthesis || !active) return;
        const u = new root.SpeechSynthesisUtterance(b.p.callout);
        u.lang = 'en-US'; u.rate = 1.05; u.volume = Math.min(1, settings.volume + 0.2);
        root.speechSynthesis.cancel(); root.speechSynthesis.speak(u);
      };
      const ms = Math.max(0, (b.t0 - ctx.currentTime) * 1000);
      b.say = setTimeout(say, ms);
    }
    function click(t, accent) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = accent ? 2000 : 1300;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.55 : 0.36, t + 0.0005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.05);
    }
    function note(t, len, m) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.setPeriodicWave(wave); o.frequency.value = hz(m);
      const peak = 0.3, sus = 0.3 * 0.6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.setTargetAtTime(sus, t + 0.005, 0.08);
      g.gain.setValueAtTime(sus, Math.max(t + 0.01, t + len - 0.02)); g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.02);
    }
    // `sched` is the block being scheduled, `block` the one on air (the sheet's title, the pictures)
    let sched = null;
    function lay(b) { droneFor(b); callout(b); sched = b; }
    function scheduleUpTo(b, horizon) {
      const total = 16 + b.reps * b.rs;
      while (b.k < total && b.at(b.k) < horizon) {
        const k = b.k, t = b.at(k);
        if (k % 4 === 0) click(t, k % 16 === 0);
        const n = k - 16;
        if (n >= 0) { const j = n % b.rs; if (j % b.p.step === 0 && j / b.p.step < b.notes.length) note(t, b.p.step * b.six * 0.9, b.p.base + b.notes[j / b.p.step]); }
        b.k++;
      }
      return b.k >= total;
    }
    // the scheduler: every 25 ms, everything due in the next 150 ms; the next block is picked when this one is fully laid
    function tick() {
      if (!playing || !sched) return;
      const horizon = ctx.currentTime + 0.15;
      while (scheduleUpTo(sched, horizon)) {
        const nb = makeBlock(sched.end());
        droneFor(nb); callout(nb);
        sched = nb;
      }
      if (sched !== block && ctx.currentTime >= sched.t0) { block = sched; report(); }
      if (settings.sleepMin > 0 && ctx.currentTime - startedAt >= settings.sleepMin * 60) { stop(); return; }
      if (watching && active && !root.document.hidden) clock();
    }

    function clock() {
      const b = block; if (!b) return;
      const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      send({ type: 'practiceClock', playing, root: b.p.root, item: b.p.item.name, intervals: b.p.item.intervals, notes: b.notes,
        bpm: b.p.bpm, step: b.p.step, reps: b.reps, repSixteenths: b.rs, posS: ctx.currentTime - lat - b.c0 });
    }

    function start() {
      unlock();
      if (active) { if (!playing) resume(); return; }
      active = true; playing = true; startedAt = ctx.currentTime;
      const b0 = makeBlock(ctx.currentTime + 0.1); lay(b0); block = b0;
      timer = setInterval(tick, 25);
      tick(); report();
    }
    function pause() { if (!active || !playing) return; playing = false; ctx.suspend(); if (root.speechSynthesis) root.speechSynthesis.pause(); report(); }
    function resume() { if (!active || playing) return; playing = true; unlock(); if (root.speechSynthesis) root.speechSynthesis.resume(); report(); }
    function silenceFrom(t) {
      // a skip or a stop: everything scheduled fades out over 80 ms
      const g = master; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.08);
      master = ctx.createGain(); master.gain.value = settings.volume; master.connect(ctx.destination);
      setTimeout(() => { try { g.disconnect(); } catch (_) { /* gone */ } }, 200);
    }
    function next() {
      if (!active) return;
      silenceFrom(ctx.currentTime);
      for (const b of [block, sched]) if (b && b.say) clearTimeout(b.say);
      const nb = makeBlock(ctx.currentTime + 0.1); lay(nb); block = nb; report();
    }
    function stop() {
      if (!active) return;
      active = false; playing = false; clearInterval(timer); timer = 0;
      if (ctx) silenceFrom(ctx.currentTime);
      for (const b of [block, sched]) if (b && b.say) clearTimeout(b.say);
      if (root.speechSynthesis) root.speechSynthesis.cancel();
      block = null; sched = null; report();
    }
    function apply(patch) {
      const old = settings;
      settings = clamp({ ...settings, ...patch });
      try { root.localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ }
      if (master && old.volume !== settings.volume) master.gain.value = settings.volume;
      if (old.drone !== settings.drone && block && block.droneGain && !settings.drone) block.droneGain.gain.cancelScheduledValues(ctx.currentTime), block.droneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }

    // the voice range test: the microphone only while it listens; the samples are read for pitch and dropped
    async function listen() {
      rangeStep = 'low'; rangeLow = null; rangeError = null; heard = { now: null, low: null, high: null };
      if (playing) pause();
      sendRange();
      try {
        const stream = await root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (!rangeStep) { stream.getTracks().forEach((t) => t.stop()); return; }
        audio(); if (ctx.state === 'suspended') await ctx.resume();
        micTrack = stream;
        const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
        an.fftSize = 4096; src.connect(an);
        const f = Math.max(1, Math.floor(ctx.sampleRate / 16000)), sr = ctx.sampleRate / f;
        const win = Math.ceil(sr / 60) * 2 + 64, buf = new Float32Array(an.fftSize);
        mic = { src, an, t: tracker(sr) };
        micTimer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          const x = new Float32Array(win), off = buf.length - win * f;
          for (let i = 0; i < win; i++) { let s = 0; for (let j = 0; j < f; j++) s += buf[off + i * f + j]; x[i] = s / f; }
          mic.t.analyse(x);
          const h = { now: mic.t.now, low: mic.t.lowest, high: mic.t.highest };
          if (h.now !== heard.now || h.low !== heard.low || h.high !== heard.high) { heard = h; sendRange(); }
        }, 25);
        arm();
      } catch (e) {
        endListening("Can't hear the microphone. Allow it for this site and try again.");
      }
    }
    function arm() {
      clearTimeout(stepTimeout);
      const st = rangeStep;
      stepTimeout = setTimeout(() => {
        if (rangeStep !== st) return;
        const best = st === 'low' ? heard.low : heard.high;
        if (best != null) rangeAction('done'); else endListening("Didn't hear a held note. Try again and hold each one for a moment.");
      }, 15000);
    }
    function endListening(err) {
      clearInterval(micTimer); clearTimeout(stepTimeout); micTimer = 0;
      if (mic) { try { mic.src.disconnect(); } catch (_) { /* gone */ } mic = null; }
      if (micTrack) { micTrack.getTracks().forEach((t) => t.stop()); micTrack = null; }
      rangeStep = null; rangeLow = null; rangeError = err; heard = { now: null, low: null, high: null };
      sendRange(); report();
    }
    function rangeAction(step) {
      if (step === 'start') { if (!rangeStep) listen(); return; }
      if (step === 'done' && rangeStep) {
        const best = rangeStep === 'low' ? heard.low : heard.high;
        if (best == null) { rangeError = "Didn't hear a held note yet. Hold one steady for a moment."; sendRange(); return; }
        rangeError = null;
        if (rangeStep === 'low') {
          rangeLow = best; rangeStep = 'high'; heard = { now: null, low: null, high: null };
          if (mic) mic.t.reset();
          arm(); sendRange(); return;
        }
        const lo = Math.min(rangeLow, best), hi = Math.max(rangeLow, best);
        if (hi - lo < 12) { endListening(`${noteName(lo)} to ${noteName(hi)} is under an octave. Try again, as low and as high as you can.`); return; }
        range = { lo, hi };
        endListening(null); return;
      }
      if (step === 'cancel' && rangeStep) { endListening(null); return; }
      if (step === 'clear') { if (rangeStep) endListening(null); range = null; rangeError = null; sendRange(); report(); }
    }

    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden && watching) clock(); });

    /** The sheet's message (web/practice_loop.js post). */
    function handle(msg) {
      if (!msg || msg.cmd !== 'practice') return;
      if (msg.settings) apply(msg.settings);
      switch (msg.action) {
        case 'start': start(); break;
        case 'pause': pause(); break;
        case 'toggle': playing ? pause() : start(); break;
        case 'next': next(); break;
        case 'stop': stop(); break;
        case 'watch': watching = !!msg.on; return;
        case 'range': rangeAction(msg.step || ''); return;
        default: break;
      }
      report();
    }
    return { handle };
  }

  const api = { ITEMS, rep, barsPerRep, bases, nextPick, detect, tracker, clamp, player };
  root.VettaSounds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
