// A Factory crew's regroup line (docs/design/REVIEW.md 5.1) in each voice pack's own voice. The packs are prerendered
// clips, so a crew's own words are rendered once, on the website, by the same Kokoro voices (voice.js renderLine; the app
// never downloads a voice model, App Store 2.5.2) and uploaded as WAV; the app only plays the audio. In a convoy that
// belongs to the crew (its name starts with the crew's call sign or name), a regroup call plays it. Pure
// (tests/test_crew_voice.py).
(function (root) {
  'use strict';
  /** 16-bit mono WAV from float samples in -1..1. */
  function wav(samples, rate = 24000) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i] || 0)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  /** The crew a convoy belongs to: its name starts with the crew's call sign or its name (crew_events.js names it so). */
  function crewOf(convoyName, crews) {
    const n = String(convoyName || '').toLowerCase();
    if (!n) return null;
    return (crews || []).find((c) => [c.call_sign, c.name].some((k) => k && n.startsWith(String(k).toLowerCase()))) || null;
  }
  /** What every convoy member hears when the leader calls a regroup (when no crew line applies). */
  function regroupText(rg) { return rg && rg.note ? `Regroup at ${rg.note}.` : 'Regroup point set.'; }

  const api = { wav, crewOf, regroupText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
