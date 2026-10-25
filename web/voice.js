// ApexVoice — plays pace notes from a pre-rendered voice bank (tools/voicebank.py).
// Notes are turned into token sequences from their structured fields, never parsed from
// text, then stitched with WebAudio. Jarvis runs through a cartoon-robot effect chain.
(function (root) {
  'use strict';
  let ctx = null, bank = null, bankId = null;
  const buffers = new Map();

  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function load(id) {
    if (bankId === id && bank) return bank;
    const res = await fetch(`voices/${id}/manifest.json`);
    if (!res.ok) throw new Error(`voice ${id} missing`);
    bank = await res.json();
    bankId = id;
    buffers.clear();
    return bank;
  }

  async function buffer(token) {
    if (buffers.has(token)) return buffers.get(token);
    const info = bank && bank.tokens[token];
    if (!info) return null;
    const p = fetch(`voices/${bankId}/${info.file}`).then(r => r.arrayBuffer()).then(b => audio().decodeAudioData(b));
    buffers.set(token, p);
    return p;
  }

  // ---- notes -> tokens ------------------------------------------------------
  const NUM = (n) => String(n).split('').map(d => `num:${d}`);
  function codriverTokens(e) {
    if (e.type === 'corner') {
      const t = [];
      if (e.severity === 'HP' || e.shape === 'hairpin') t.push(`head:${e.dir}HP`);
      else if (e.shape === 'square') t.push(`head:${e.dir}SQ`);
      else if (e.shape === 'acute') t.push(`head:${e.dir}AC`);
      else t.push(`head:${e.dir}${e.severity}${e.grade || ''}`);
      for (const m of e.mods || []) t.push(`mod:${m}`);
      if (e.caution) t.push(`caution:${e.caution}`);
      return t;
    }
    return [`hazard:${e.type}`];
  }
  function jarvisTokens(e) {
    if (e.type !== 'corner') return ['w:hazard', `w:${e.type}`];
    const t = ['w:corner', e.dir === 'L' ? 'w:left' : 'w:right'];
    const shape = e.severity === 'HP' ? 'hairpin' : e.shape;
    if (shape) t.push('w:classification', `w:${shape}`);
    else {
      t.push('w:severity', `num:${e.severity}`);
      if (e.grade === '-') t.push('w:minus');
      if (e.grade === '+') t.push('w:plus');
    }
    if ((e.mods || []).length) { t.push('w:modifiers'); for (const m of e.mods) t.push(`mod:${m}`); }
    if (e.caution) t.push('w:warning', `caution:${e.caution}`);
    return t;
  }
  // chain: [note, next, ...] where each but the last links with "into"/"and"; last may carry a distance.
  function tokensFor(chain, style) {
    const note = style === 'jarvis' ? jarvisTokens : codriverTokens;
    const out = [];
    chain.forEach((e, i) => {
      if (i > 0) out.push(style === 'jarvis' ? `w:seq_${chain[i - 1].link}` : `link:${chain[i - 1].link}`);
      out.push(...note(e));
    });
    const last = chain[chain.length - 1];
    if (last.link && last.link !== 'into' && last.link !== 'and') {
      if (style === 'jarvis') out.push('w:distance', ...NUM(last.link), 'w:meters');
      else out.push(`dist:${last.link}`);
    }
    return out;
  }

  // Whole-phrase clips ("head+mod", a full call) are keyed by their tokens joined with '+'.
  // Cover the sequence with the longest clips the bank has; single words only fill the gaps.
  const MAX_RUN = 10;
  function cover(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length;) {
      let hit = 0;
      for (let len = Math.min(MAX_RUN, tokens.length - i); len >= 2 && !hit; len--) {
        if (bank.tokens[tokens.slice(i, i + len).join('+')]) hit = len;
      }
      out.push(hit ? tokens.slice(i, i + hit).join('+') : tokens[i]);
      i += hit || 1;
    }
    return out;
  }

  // ---- playback ---------------------------------------------------------------
  function robotChain(c) {
    // Ring modulator (metallic), short comb (tin can), hard clip (crunch).
    const input = c.createGain();
    const ring = c.createGain(); ring.gain.value = 0;
    const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = 58;
    const depth = c.createGain(); depth.gain.value = 0.9;
    osc.connect(depth); depth.connect(ring.gain); osc.start();
    const delay = c.createDelay(); delay.delayTime.value = 0.009;
    const fb = c.createGain(); fb.gain.value = 0.55;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.max(-0.6, Math.min(0.6, x * 1.8)); }
    shaper.curve = curve;
    const out = c.createGain(); out.gain.value = 1.4;
    input.connect(ring); ring.connect(delay); delay.connect(fb); fb.connect(delay);
    ring.connect(shaper); delay.connect(shaper); shaper.connect(out); out.connect(c.destination);
    return { input, stop: () => { try { osc.stop(); } catch (_) {} } };
  }

  function chirp(c, t0) {
    [[880, 0], [1320, 0.07], [990, 0.14]].forEach(([f, dt]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.05, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.06);
      o.connect(g); g.connect(c.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.07);
    });
    return 0.24;
  }

  const GAP = (token) => (token.startsWith('link:') || token.startsWith('w:seq') ? 0.03 : token.startsWith('dist:') ? 0.11 : 0.06);

  // Plays tokens; resolves true when finished, false if the bank can't voice them (caller falls back).
  async function play(tokens) {
    if (!bank) return false;
    tokens = cover(tokens);
    if (tokens.some(t => !bank.tokens[t])) return false;
    const bufs = await Promise.all(tokens.map(buffer));
    if (bufs.some(b => !b)) return false;
    const c = audio();
    const jarvis = bank.style === 'jarvis';
    const fx = jarvis ? robotChain(c) : null;
    let t = c.currentTime + 0.03;
    if (jarvis) t += chirp(c, t);
    bufs.forEach((b, i) => {
      if (i > 0) t += GAP(tokens[i]);
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(fx ? fx.input : c.destination);
      src.start(t);
      t += b.duration;
    });
    const ms = (t - c.currentTime) * 1000 + 60;
    await new Promise(r => setTimeout(r, ms));
    if (fx) setTimeout(fx.stop, 400);
    return true;
  }

  // ---- live synthesis for dynamic phrases (drive names, routes) ------------
  // Same open model as the banks (Kokoro-82M via kokoro-js, ONNX/WASM), loaded lazily the
  // first time a phrase isn't in the bank; until it's ready the caller falls back.
  const KOKORO_JS = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
  const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  let tts = null, ttsLoading = null, ttsError = null;
  const phraseCache = new Map();
  function liveState() { return tts ? 'ready' : ttsLoading ? 'loading' : ttsError ? 'error' : 'idle'; }
  function warmLive() {
    if (tts || ttsLoading) return ttsLoading;
    // Quantised WASM (~90 MB, cached by the browser). The WebGPU build needs the ~320 MB fp32
    // model, too heavy for a phone; phrases are pre-rendered instead so speed rarely matters.
    ttsLoading = import(KOKORO_JS)
      .then(m => m.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'wasm' }))
      .then(t => { tts = t; ttsLoading = null; return t; })
      .catch(e => { ttsError = e; ttsLoading = null; return null; });
    return ttsLoading;
  }
  async function playBuffer(buf) {
    const c = audio();
    const jarvis = bank && bank.style === 'jarvis';
    const fx = jarvis ? robotChain(c) : null;
    let t = c.currentTime + 0.03;
    if (jarvis) t += chirp(c, t);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(fx ? fx.input : c.destination);
    src.start(t);
    await new Promise(r => setTimeout(r, (t + buf.duration - c.currentTime) * 1000 + 60));
    if (fx) setTimeout(fx.stop, 400);
  }
  // Render (or reuse) a phrase in the active bank's voice; one render at a time.
  let renderChain = Promise.resolve();
  function render(text) {
    const key = `${bankId}|${text}`;
    if (phraseCache.has(key)) return phraseCache.get(key);
    const voice = bank.kokoro_voice, speed = bank.speed || 1;
    const p = renderChain = renderChain.then(async () => {
      const out = await tts.generate(text, { voice, speed });
      const buf = audio().createBuffer(1, out.audio.length, out.sampling_rate);
      buf.copyToChannel(out.audio, 0);
      return buf;
    });
    phraseCache.set(key, p);
    p.catch(() => phraseCache.delete(key));
    return p;
  }
  // Pre-render phrases we know are coming (route names) so they're instant when needed.
  async function prefetch(texts) {
    if (!bank || !bank.kokoro_voice) return;
    if (!tts && !(await warmLive())) return;
    for (const t of texts) render(t);
  }
  // Speak arbitrary text live. Resolves false if the model isn't ready, or the phrase isn't
  // rendered yet and waiting would make it stale (the caller then falls back).
  async function speakLive(text, { maxWaitMs = 1500 } = {}) {
    if (!bank || !bank.kokoro_voice) return false;
    if (!tts) { warmLive(); return false; }
    const pending = render(text);
    const buf = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), maxWaitMs))]);
    if (!buf) return false;
    await playBuffer(buf);
    return true;
  }

  async function voices() {
    try { return (await (await fetch('voices/index.json')).json()).voices; } catch (_) { return []; }
  }

  root.ApexVoice = { load, play, tokensFor, cover, voices, speakLive, prefetch, warmLive, liveState, unlock: audio, get bank() { return bank; } };
})(window);
