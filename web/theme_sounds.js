// Theme sounds (docs/design/REVIEW.md 4.2 Sound, 4.3 #1): a key sound and a pre-call sound per theme, synthesised with
// WebAudio (no files), and the pre-hazard two-tone, which is the same in every theme and always plays before the voice.
//   Roadbook  key: a soft paper click     pre-call: a wood-block tick
//   Tapedeck  key: a tape-deck clunk      pre-call: a VFD bip
//   Billet    key: a machined click       pre-call: a low tone
// recipe() is pure (tests/test_theme_sounds.py); play() needs an AudioContext.
(function (root) {
  'use strict';
  // a recipe is a list of voices: { type: 'sine' | 'square' | 'triangle' | 'noise', f (Hz), at (s), dur (s), gain, q? }
  const RECIPES = {
    roadbook: { key: [{ type: 'noise', f: 4200, at: 0, dur: 0.018, gain: 0.05, q: 1.2 }],
                pre: [{ type: 'sine', f: 920, at: 0, dur: 0.05, gain: 0.12 }, { type: 'sine', f: 1840, at: 0, dur: 0.025, gain: 0.04 }] },
    tapedeck: { key: [{ type: 'sine', f: 120, at: 0, dur: 0.06, gain: 0.14 }, { type: 'noise', f: 2400, at: 0.004, dur: 0.02, gain: 0.05, q: 2 }],
                pre: [{ type: 'square', f: 2000, at: 0, dur: 0.05, gain: 0.04 }] },
    billet: { key: [{ type: 'noise', f: 6000, at: 0, dur: 0.008, gain: 0.07, q: 4 }, { type: 'triangle', f: 3100, at: 0, dur: 0.012, gain: 0.03 }],
              pre: [{ type: 'sine', f: 220, at: 0, dur: 0.12, gain: 0.14 }] },
  };
  // the same in every theme: what a hazard sounds like is not a theme's to change
  const HAZARD = [{ type: 'square', f: 660, at: 0, dur: 0.09, gain: 0.07 }, { type: 'square', f: 880, at: 0.11, dur: 0.09, gain: 0.07 }];

  /** The voices for a sound: kind 'key' | 'pre' | 'hazard'. An unknown theme uses the road book's. */
  function recipe(themeId, kind) {
    if (kind === 'hazard') return HAZARD;
    const r = Object.prototype.hasOwnProperty.call(RECIPES, themeId) ? RECIPES[themeId] : RECIPES.roadbook;
    return r[kind] || [];
  }
  /** How long a recipe lasts, s (the voice waits this long after a pre-call or hazard sound). */
  const length = (voices) => voices.reduce((m, v) => Math.max(m, v.at + v.dur), 0);

  let noiseBuf = null;
  function play(ctx, voices) {
    if (!ctx || !voices.length) return 0;
    const t0 = ctx.currentTime + 0.005;
    for (const v of voices) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + v.at);
      g.gain.exponentialRampToValueAtTime(v.gain, t0 + v.at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.at + v.dur);
      g.connect(ctx.destination);
      let src;
      if (v.type === 'noise') {
        if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
        src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = v.f; bp.Q.value = v.q || 1;
        src.connect(bp); bp.connect(g);
      } else {
        src = ctx.createOscillator(); src.type = v.type; src.frequency.value = v.f; src.connect(g);
      }
      src.start(t0 + v.at); src.stop(t0 + v.at + v.dur + 0.01);
    }
    return length(voices);
  }

  const api = { RECIPES, HAZARD, recipe, length, play };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexThemeSounds = api;
})(typeof window !== 'undefined' ? window : globalThis);
