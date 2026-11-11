// ApexSoundtrack: music made by the road (docs/ARCHITECTURE.md section 5; the owner's mission, 2026-11-10).
// A generated score in four stems (pad, pulse, bass, lead), synthesised with WebAudio (no files, nothing licensed, works
// with no signal). ApexAudioBus says how much of it plays: the stems cross in as the road gets busier, a riser builds
// into each corner and lets go at its entry, the filter opens with the road, everything steps under the co-driver's
// voice, and over Sight it thins to the pad.
//
// Laws (tests/test_soundtrack.py):
//   * The tempo is fixed. Nothing here reads speed; the music can't be made quicker by driving quicker.
//   * compose() is pure: the same seed and bar give the same notes, on any phone.
//   * A frame with unknowns (null) plays the pad only: the music never acts out a road nobody measured.
// compose()/mix() are pure; create() needs an AudioContext (or an OfflineAudioContext: render() is how it is tested).
(function (root) {
  'use strict';
  const TEMPO = 92, BEATS = 4, BAR_S = BEATS * 60 / TEMPO, LOOP = 8;       // 8 bars: four chords, two bars each
  const MODES = { dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
  const PROGRESSIONS = [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 3], [0, 2, 3, 5]];   // chord roots as scale degrees
  const ROOTS = [45, 47, 48, 50, 52];                                              // A2 .. E3
  const LEVEL = { pad: 0.07, pulse: 0.16, bass: 0.3, lead: 0.13 }, RISER = 0.05, MASTER = 0.85;
  const LAYER_NAMES = ['pad', 'pulse', 'bass', 'lead'];

  // mulberry32: small, fast, the same on every engine
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

  /** The piece a seed makes: its key, mode, chords and the pulse's figure. Pure. */
  function piece(seed) {
    const r = rng((seed >>> 0) || 1);
    const mode = pick(r, Object.keys(MODES)), root = pick(r, ROOTS), chords = pick(r, PROGRESSIONS);
    const figure = Array.from({ length: 8 }, (_, i) => (i === 0 ? 0 : Math.floor(r() * 4)));   // which chord tone each eighth plays
    return { seed: seed >>> 0, mode, root, chords, figure, tempo: TEMPO };
  }
  const degree = (p, d, octave = 0) => { const s = MODES[p.mode], n = s.length; return p.root + 12 * (octave + Math.floor(d / n)) + s[((d % n) + n) % n]; };

  /**
   * The notes of bar `n` (0, 1, 2, ...) of a piece: [{ layer, beat (0..4), beats, midi, vel (0..1) }], in beat order.
   * Every stem is always written; how loud each plays is the bus's (mix()). Pure: no clock and no frame.
   */
  function compose(p, n) {
    const out = [], at = ((n % LOOP) + LOOP) % LOOP, chord = p.chords[at >> 1], phrase = Math.floor(n / LOOP);
    const tones = [0, 2, 4, 7].map((k) => chord + k);                       // root, third, fifth, octave (scale steps)
    if (at % 2 === 0) for (const d of [tones[0], tones[1], tones[2]]) out.push({ layer: 'pad', beat: 0, beats: 2 * BEATS, midi: degree(p, d, 1), vel: 0.8 });
    for (let i = 0; i < 8; i++) out.push({ layer: 'pulse', beat: i / 2, beats: 0.5, midi: degree(p, tones[p.figure[i]], 2), vel: i % 2 ? 0.55 : i % 4 ? 0.75 : 1 });
    out.push({ layer: 'bass', beat: 0, beats: 1.5, midi: degree(p, chord, -1), vel: 1 }, { layer: 'bass', beat: 2.5, beats: 0.5, midi: degree(p, chord, -1), vel: 0.6 },
      { layer: 'bass', beat: 3, beats: 1, midi: degree(p, chord + 4, -1), vel: 0.8 });
    // the lead: a sparse line that moves by step over a five-note cut of the mode, a new one each time round
    const r = rng(((p.seed ^ 0x9E3779B9) + phrase * 7919 + at * 104729) >>> 0), penta = [0, 2, 3, 4, 6];
    let step = Math.floor(r() * penta.length);
    for (let i = 0; i < 8; i++) {
      const play = r() < (i % 2 ? 0.22 : 0.45), move = Math.floor(r() * 3) - 1, long = r() < 0.3;
      if (!play) continue;
      step = Math.max(0, Math.min(penta.length + 2, step + move));
      const d = penta[step % penta.length] + 7 * Math.floor(step / penta.length);
      out.push({ layer: 'lead', beat: i / 2, beats: long ? 1.5 : 0.75, midi: degree(p, d, 2), vel: 0.7 + 0.3 * r() });
    }
    return out.sort((a, b) => a.beat - b.beat || LAYER_NAMES.indexOf(a.layer) - LAYER_NAMES.indexOf(b.layer));
  }

  /** What the engine sets from a bus frame (schemas AudioBusFrame): stem gains, the filter, the riser, the master. Pure. */
  function mix(frame, volume = 1) {
    const f = frame || {}, L = f.layers || {}, known = typeof f.intensity === 'number' || typeof f.anticipation === 'number';
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
    const gains = {};
    for (const k of LAYER_NAMES) gains[k] = LEVEL[k] * (known ? num(L[k], k === 'pad' ? 1 : 0) : k === 'pad' ? 1 : 0);
    return { gains, cutoff_hz: known && Number.isFinite(f.cutoff_hz) ? Math.max(200, Math.min(12000, f.cutoff_hz)) : 380,
      riser: RISER * (known ? num(f.swell, 0) : 0), master: MASTER * num(f.master, 1) * num(volume, 1) };
  }

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  /**
   * The engine on an audio context. start(seed) fades in; set(frame) follows the bus; stop() fades out.
   * `ctx` may be an OfflineAudioContext: schedule(from, to) writes those bars and the caller renders (the e2e test).
   */
  function create(ctx, { volume = 1 } = {}) {
    const out = ctx.createGain(), fade = ctx.createGain(), filter = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor();   // out: the bus's master; fade: start and stop
    filter.type = 'lowpass'; filter.Q.value = 0.7; filter.frequency.value = 380; out.gain.value = MASTER * volume; fade.gain.value = 0;
    filter.connect(out); out.connect(fade); fade.connect(comp); comp.connect(ctx.destination);
    const stems = {};
    for (const k of LAYER_NAMES) { const g = ctx.createGain(); g.gain.value = 0; g.connect(filter); stems[k] = g; }
    // a little space for the pulse and the lead: one dotted-eighth echo, quiet
    const echo = ctx.createDelay(1.5), fb = ctx.createGain(), send = ctx.createGain();
    echo.delayTime.value = 0.75 * 60 / TEMPO; fb.gain.value = 0.3; send.gain.value = 0.35;
    stems.pulse.connect(send); stems.lead.connect(send); send.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(filter);
    // the riser: filtered noise that climbs into a corner
    const riserGain = ctx.createGain(), riserBand = ctx.createBiquadFilter(); riserGain.gain.value = 0; riserBand.type = 'bandpass'; riserBand.Q.value = 1.4; riserBand.frequency.value = 600;
    let noise = null;
    function riserOn() {
      if (noise) return;
      const len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), r = rng(20261110);
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
      noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true; noise.connect(riserBand); riserBand.connect(riserGain); riserGain.connect(out); noise.start();
    }

    function voice(layer, t, dur, midi, vel) {
      const g = ctx.createGain(), f = hz(midi), end = t + dur;
      const osc = (type, freq, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; o.connect(g); o.start(t); return o; };
      let oscs, tail;
      if (layer === 'pad') { oscs = [osc('triangle', f, -6), osc('triangle', f, 7), osc('sine', f / 2)]; tail = 1.6;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.33 * vel, t + 0.9); g.gain.setValueAtTime(0.33 * vel, end); g.gain.linearRampToValueAtTime(0, end + tail);
      } else if (layer === 'bass') { oscs = [osc('sine', f), osc('triangle', f, 3)]; tail = 0.12;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.015); g.gain.setTargetAtTime(0.32 * vel, t + 0.015, 0.2); g.gain.setTargetAtTime(0, end, tail / 3);
      } else if (layer === 'pulse') { oscs = [osc('triangle', f)]; tail = 0.3;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6 * vel, t + 0.006); g.gain.setTargetAtTime(0, t + 0.006, 0.11);
      } else { oscs = [osc('sine', f), osc('triangle', f * 2, 4)]; tail = 0.5;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.03); g.gain.setTargetAtTime(0.3 * vel, t + 0.03, 0.25); g.gain.setTargetAtTime(0, end, tail / 3);
      }
      g.connect(stems[layer]);
      for (const o of oscs) { o.stop(end + tail + 0.05); }
      oscs[0].onended = () => { try { g.disconnect(); } catch (_) {} };
    }

    let p = null, t0 = 0, next = 0, timer = 0, on = false;
    /** Writes bars [from, to) of the piece onto the context's clock. */
    function schedule(from, to) { for (let n = from; n < to; n++) for (const e of compose(p, n)) voice(e.layer, t0 + (n + e.beat / BEATS) * BAR_S, e.beats / BEATS * BAR_S, e.midi, e.vel); }
    function tick() { if (!on) return; const ahead = ctx.currentTime + 0.5; while (t0 + next * BAR_S < ahead) { schedule(next, next + 1); next++; } }
    function set(frame, vol = volume, tau = 0.12) {
      const m = mix(frame, vol), now = ctx.currentTime;
      for (const k of LAYER_NAMES) stems[k].gain.setTargetAtTime(m.gains[k], now, tau * 2);
      filter.frequency.setTargetAtTime(m.cutoff_hz, now, tau * 2);
      riserGain.gain.setTargetAtTime(m.riser, now, tau); riserBand.frequency.setTargetAtTime(500 + 5000 * (m.riser / RISER) ** 2, now, tau);
      out.gain.setTargetAtTime(m.master, now, tau);
      return m;
    }
    function start(seed, { at = ctx.currentTime + 0.08, live = true } = {}) {
      p = piece(seed); t0 = at; next = 0; on = true; riserOn();
      fade.gain.cancelScheduledValues(0); fade.gain.setValueAtTime(0, at); fade.gain.linearRampToValueAtTime(1, at + 2);
      set(null);
      if (live) { tick(); timer = setInterval(tick, 150); }
      return p;
    }
    function stop() {
      if (!on) return; on = false; clearInterval(timer); timer = 0;
      const now = ctx.currentTime; fade.gain.cancelScheduledValues(now); fade.gain.setTargetAtTime(0, now, 0.4);
    }
    return { start, stop, set, schedule, playing: () => on, piece: () => p };
  }

  const api = { piece, compose, mix, create, TEMPO, BAR_S, LOOP, LEVEL, LAYER_NAMES, MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSoundtrack = api;
})(typeof window !== 'undefined' ? window : globalThis);
