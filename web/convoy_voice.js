// Convoy voice (docs/CONVOY_VOICE.md): an open channel for everyone in a convoy, hands-free. No button to hold: the phone's
// own voice processing (echo cancelling, noise suppression, gain) keeps road and wind out, and Opus with DTX sends almost
// nothing while nobody talks. The co-driver's calls turn the voices down while they play. The only control is one big
// key: Talk (join), then Mute / Unmute. Cloudflare Realtime carries the audio; the Worker makes every SFU call
// (backend/src/convoy_voice.ts), so the phone never holds a token. Nothing is recorded.
// Pure helpers are exported for tests (tests/test_convoy_voice.py); ConvoyVoice owns the microphone and the connection.
(function (root) {
  'use strict';
  const DUCK = 0.22;              // the voices under a co-driver call: still there, never over it
  const DUCK_DOWN_S = 0.06, DUCK_UP_S = 0.35;
  const MAX_BITRATE = 24000;      // speech in Opus: clear at 24 kb/s, and the SFU's egress stays small
  const TALK_RMS = 0.02;          // a remote voice this loud is someone talking (the line says who)
  const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

  /** Members on the channel we are not yet listening to: never ourselves, never someone we already hear. */
  function toPull(voice, you, have) {
    const out = [];
    for (const k of voice.keys()) if (k !== you && !have.has(k)) out.push(k);
    return out.slice(0, 15);
  }
  /** The level the voices play at. */
  const duckLevel = (speaking) => (speaking ? DUCK : 1);
  /** Opus for speech: mono, DTX (silence costs almost nothing), and a bitrate cap, written into the SFU's answer. */
  function speechOpus(sdp) {
    const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
    if (!m) return sdp;
    const pt = m[1], re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    const want = { usedtx: '1', stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: String(MAX_BITRATE) };
    if (!re.test(sdp)) return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}`);
    return sdp.replace(re, (_, params) => {
      const kv = new Map(params.split(';').filter(Boolean).map((p) => { const [k, v = ''] = p.trim().split('='); return [k, v]; }));
      for (const [k, v] of Object.entries(want)) kv.set(k, v);
      return `a=fmtp:${pt} ${[...kv].map(([k, v]) => `${k}=${v}`).join(';')}`;
    });
  }
  /** The voice key's word, and whether it shows as "on air". */
  function keyText(state, muted) {
    if (state === 'off' || state === 'failed') return { text: 'Talk', on: false, label: 'Join the convoy voice channel' };
    if (state === 'starting') return { text: 'Joining…', on: false, label: 'Joining the voice channel' };
    return muted ? { text: 'Unmute', on: false, label: 'Your microphone is muted. Unmute' } : { text: 'Mute', on: true, label: 'You are on the voice channel. Mute' };
  }
  /** Who is talking, for the convoy line: "@ana talking", "@ana, @ben talking", or ''. */
  function talkingText(keys, members) {
    const names = keys.map((k) => { const m = members.get(k); return m && m.handle ? `@${m.handle}` : 'Someone'; });
    if (!names.length) return '';
    return `${names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')} talking`;
  }
  const ERRORS = {
    no_mic: 'Voice needs the microphone. Allow it in Settings.', unsupported: 'Voice isn\'t available here.',
    voice_not_set_up: 'Voice isn\'t switched on for convoys yet.', connect_first: 'Voice: waiting for the convoy to connect.',
    failed: 'Voice dropped. Tap Talk to try again.',
  };

  class ConvoyVoice {
    /**
     * `client` is the ConvoyClient (its id, ctx.you, members, voice map and send()). `speaking()` says the co-driver is
     * talking. `native(on)` tells the iOS shell to open the audio session for a call (speaker, Bluetooth, AirPods).
     */
    constructor({ client, apiFetch, speaking = () => false, native = () => {}, onChange = () => {}, media, RTC, AudioCtx, AudioEl, setTimer, clearTimer }) {
      const w = root;
      Object.assign(this, {
        client, apiFetch, speaking, native, onChange,
        media: media !== undefined ? media : (w.navigator && w.navigator.mediaDevices) || null,
        RTC: RTC !== undefined ? RTC : w.RTCPeerConnection || null,
        AudioCtx: AudioCtx !== undefined ? AudioCtx : w.AudioContext || w.webkitAudioContext || null,
        AudioEl: AudioEl !== undefined ? AudioEl : w.Audio || null,
        setTimer: setTimer || ((f, ms) => setInterval(f, ms)), clearTimer: clearTimer || ((t) => clearInterval(t)),
      });
      this.state = 'off'; this.muted = false; this.error = null; this.convoyId = null;
      this.pc = null; this.mic = null; this.ctx = null; this.master = null; this.timer = null;
      this.remotes = new Map();   // member key -> { mid, el, src, analyser, buf }
      this.mids = new Map();      // mid -> member key (the SFU's media section for each member we hear)
      this.talking = [];
      this.chain = Promise.resolve();
    }
    get supported() { return !!(this.media && this.media.getUserMedia && this.RTC); }
    changed() { try { this.onChange(this); } catch (_) { /* UI */ } }
    /** Every SFU change on our session runs one at a time (Realtime: serialize mutations per session). */
    serial(fn) { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }
    async call(method, path, body) {
      const r = await this.apiFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch (_) { /* empty */ }
      if (!r.ok) { const e = new Error((j && j.error) || `http_${r.status}`); e.code = (j && j.error) || 'failed'; throw e; }
      return j;
    }

    /** Join the channel (a tap on Talk, or the convoy reconnecting with voice on). */
    start() {
      if (this.state === 'on' || this.state === 'starting') return Promise.resolve(true);
      if (!this.supported) { this.fail('unsupported'); return Promise.resolve(false); }
      const id = this.client.id;
      if (!id) return Promise.resolve(false);
      this.state = 'starting'; this.error = null; this.convoyId = id; this.changed();
      this.audioUp();                                         // inside the tap: WebKit lets the audio start now
      return this.serial(async () => {
        try {
          this.native(true);                                  // the shell opens a call-style audio session first
          try {
            this.mic = await this.media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
          } catch (_) { throw Object.assign(new Error('no_mic'), { code: 'no_mic' }); }
          const track = this.mic.getAudioTracks()[0];
          track.enabled = !this.muted;
          const pc = this.pc = new this.RTC({ iceServers: ICE, bundlePolicy: 'max-bundle' });
          pc.ontrack = (e) => this.onTrack(e);
          pc.onconnectionstatechange = () => { if (pc === this.pc && pc.connectionState === 'failed') this.fail('failed'); };
          const tr = pc.addTransceiver(track, { direction: 'sendonly' });
          try {
            const p = tr.sender.getParameters();
            p.encodings = (p.encodings && p.encodings.length ? p.encodings : [{}]).map((x) => ({ ...x, maxBitrate: MAX_BITRATE }));
            await tr.sender.setParameters(p);
          } catch (_) { /* the fmtp cap still holds */ }
          await pc.setLocalDescription(await pc.createOffer());
          const r = await this.call('POST', `/api/convoy/${encodeURIComponent(id)}/voice`, { sdp: { type: 'offer', sdp: pc.localDescription.sdp }, mid: tr.mid });
          if (pc !== this.pc) return false;                   // stopped while we waited
          await pc.setRemoteDescription({ type: 'answer', sdp: speechOpus(r.sdp.sdp) });
          this.state = 'on'; this.changed();
          this.client.send({ type: 'voice', muted: this.muted });
          if (!this.timer) this.timer = this.setTimer(() => this.tick(), 100);
          await this.pullNow();
          return true;
        } catch (e) {
          this.fail(e && e.code ? e.code : 'failed');
          return false;
        }
      });
    }
    /** Listen to whoever is on the channel that we don't hear yet. */
    pull() { return this.serial(() => this.pullNow()); }
    async pullNow() {
      if (this.state !== 'on' || !this.pc) return;
      const keys = toPull(this.client.voice || new Map(), this.client.ctx && this.client.ctx.you, this.remotes);
      if (!keys.length) return;
      const pc = this.pc;
      const r = await this.call('POST', `/api/convoy/${encodeURIComponent(this.convoyId)}/voice/pull`, { keys }).catch(() => null);
      if (!r || pc !== this.pc) return;
      for (const t of r.tracks || []) { this.mids.set(t.mid, t.key); if (!this.remotes.has(t.key)) this.remotes.set(t.key, { mid: t.mid }); }
      if (!r.sdp) return;
      await pc.setRemoteDescription(r.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.call('PUT', `/api/convoy/${encodeURIComponent(this.convoyId)}/voice/answer`, { sdp: { type: 'answer', sdp: pc.localDescription.sdp } }).catch(() => {});
    }
    onTrack(e) {
      const mid = e.transceiver && e.transceiver.mid, key = this.mids.get(mid);
      if (!key) return;
      const stream = (e.streams && e.streams[0]) || new root.MediaStream([e.track]);
      const r = this.remotes.get(key) || { mid };
      this.unplug(r);
      // An <audio> element keeps WebKit pulling the stream; with Web Audio up it is muted and the graph plays it (so it
      // can be turned down under a co-driver call: iOS ignores an element's volume).
      if (this.AudioEl) {
        const el = new this.AudioEl();
        el.autoplay = true; el.playsInline = true; el.srcObject = stream; el.muted = !!this.master;
        const p = el.play && el.play(); if (p && p.catch) p.catch(() => {});
        r.el = el;
      }
      if (this.master) {
        try {
          r.src = this.ctx.createMediaStreamSource(stream);
          r.analyser = this.ctx.createAnalyser(); r.analyser.fftSize = 512; r.buf = new Float32Array(r.analyser.fftSize);
          r.src.connect(r.analyser); r.analyser.connect(this.master);
        } catch (_) { if (r.el) r.el.muted = false; }
      }
      this.remotes.set(key, r);
    }
    unplug(r) {
      if (!r) return;
      try { if (r.src) r.src.disconnect(); if (r.analyser) r.analyser.disconnect(); } catch (_) { /* gone */ }
      if (r.el) { try { r.el.pause(); r.el.srcObject = null; } catch (_) { /* gone */ } }
      r.el = r.src = r.analyser = null;
    }
    /** The convoy said someone came on, went off or muted. */
    onVoice(m) {
      if (this.state === 'off' || this.state === 'failed') return;
      if (m.type === 'ready') {
        // The convoy link came back: the server took us off when it dropped, so join again with a new session.
        if (this.client.voice && !this.client.voice.has(this.client.ctx && this.client.ctx.you)) this.rejoin();
        return;
      }
      if (!m.on || m.joined) {                                 // off, or on with a new session: what we heard of them is dead
        const r = this.remotes.get(m.key);
        if (r) { this.unplug(r); this.mids.delete(r.mid); this.remotes.delete(m.key); }
      }
      if (m.on && m.key !== (this.client.ctx && this.client.ctx.you)) this.pull();
      this.changed();
    }
    rejoin() { const muted = this.muted; this.teardown(); this.state = 'off'; this.muted = muted; this.start(); }

    setMuted(muted) {
      this.muted = !!muted;
      const t = this.mic && this.mic.getAudioTracks()[0];
      if (t) t.enabled = !this.muted;
      if (this.state === 'on') this.client.send({ type: 'voice', muted: this.muted });
      this.changed();
    }
    /** The one key: Talk joins; then it mutes and unmutes. */
    press() {
      if (this.state === 'off' || this.state === 'failed') return this.start();
      if (this.state === 'on') this.setMuted(!this.muted);
      return Promise.resolve(true);
    }
    /** Off the channel (Leave voice, the convoy ended, or we left it). */
    stop() {
      const id = this.convoyId, was = this.state;
      this.teardown();
      this.state = 'off'; this.error = null; this.convoyId = null; this.changed();
      if (id && (was === 'on' || was === 'starting')) this.call('DELETE', `/api/convoy/${encodeURIComponent(id)}/voice`).catch(() => {});
    }
    fail(code) {
      this.teardown();
      this.state = 'failed'; this.error = code; this.changed();
    }
    teardown() {
      if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
      for (const r of this.remotes.values()) this.unplug(r);
      this.remotes.clear(); this.mids.clear(); this.talking = [];
      if (this.pc) { try { this.pc.close(); } catch (_) { /* closed */ } this.pc = null; }
      if (this.mic) { for (const t of this.mic.getTracks()) { try { t.stop(); } catch (_) { /* stopped */ } } this.mic = null; }
      this.native(false);
    }
    errorText() { return this.error ? ERRORS[this.error] || ERRORS.failed : ''; }

    audioUp() {
      if (!this.AudioCtx) return;
      try {
        if (!this.ctx) { this.ctx = new this.AudioCtx(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); }
        if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
      } catch (_) { this.ctx = null; this.master = null; }
    }
    /** Ten times a second: duck under the co-driver, and work out who is talking. */
    tick() {
      if (this.master && this.ctx) {
        const speaking = !!this.speaking(), g = this.master.gain;
        try { g.setTargetAtTime(duckLevel(speaking), this.ctx.currentTime, speaking ? DUCK_DOWN_S : DUCK_UP_S); } catch (_) { g.value = duckLevel(speaking); }
      }
      const now = [];
      for (const [key, r] of this.remotes) {
        if (!r.analyser) continue;
        r.analyser.getFloatTimeDomainData(r.buf);
        let s = 0; for (let i = 0; i < r.buf.length; i++) s += r.buf[i] * r.buf[i];
        if (Math.sqrt(s / r.buf.length) >= TALK_RMS) now.push(key);
      }
      if (now.join() !== this.talking.join()) { this.talking = now; this.changed(); }
    }
  }

  const api = { ConvoyVoice, toPull, duckLevel, speechOpus, keyText, talkingText, DUCK, MAX_BITRATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexConvoyVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
