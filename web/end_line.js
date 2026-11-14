// The end of a drive (docs/design/REVIEW.md 4.4): each voice pack says its own closing line around the Vetta Score, and
// "your best on this road" when it is. The score is spoken from the pack's own clips (tools/voicebank.py renders the
// numbers), never in a second voice. bestOnRoad compares with your earlier drives named after the same road; usual sets the score against your last few. Pure
// (tests/test_end_line.py).
(function (root) {
  'use strict';
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  /** 0-99 in words: "eighty-two". */
  function under100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''); }
  /** A score (0-1000) as clip tokens and words: 702 -> ['n:h7', 'n:2'], "seven hundred two". Null for anything else. */
  function scoreTokens(score) {
    if (!Number.isInteger(score) || score < 0 || score > 1000) return null;
    if (score === 1000) return { tokens: ['n:k1'], words: 'one thousand' };
    const h = Math.floor(score / 100), r = score % 100, tokens = [], words = [];
    if (h) { tokens.push(`n:h${h}`); words.push(`${ONES[h]} hundred`); }
    if (r || !h) { tokens.push(`n:${r}`); words.push(under100(r)); }
    return { tokens, words: words.join(' ') };
  }
  // Each pack's order (REVIEW.md 4.4): Marguerite and Hale close then give the score; Kit gives the number first.
  const ORDER = {
    marguerite: ['sys:end', 'end:score', '#', 'end:best'],
    kit: ['#', 'end:best', 'sys:end'],
    hale: ['sys:end', 'end:score', '#', 'end:best'],
  };
  // The words are the packs' own (web/voice_lines.js PACKS), the ones their clips hold. Kit has no "Score" word.
  const VL = typeof module !== 'undefined' && module.exports ? require('./voice_lines.js') : root.ApexVoiceLines;
  const WORDS = {};
  for (const p of Object.keys(ORDER)) WORDS[p] = { 'end:score': '', ...((VL && VL.PACKS[p] && VL.PACKS[p].lines) || {}) };
  /**
   * The closing line for a pack: { tokens, text }. No score: just the pack's close. `signOff` is the pack's closing clip
   * for this drive (sys:end, sys:end2...; see pickSignOff); anything else is sys:end.
   */
  function endLine(pack, score, best, signOff = 'sys:end') {
    const p = ORDER[pack] ? pack : 'marguerite', s = scoreTokens(score);
    const end = /^sys:end\d*$/.test(signOff) && WORDS[p][signOff] ? signOff : 'sys:end';
    const tokens = [], text = [];
    for (const k0 of ORDER[p]) {
      const k = k0 === 'sys:end' ? end : k0;
      if (k === '#') { if (s) { tokens.push(...s.tokens); text.push(s.words + '.'); } continue; }
      if ((k === 'end:score' && !s) || (k === 'end:best' && !(s && best)) || !WORDS[p][k]) continue;
      tokens.push(k); text.push(WORDS[p][k]);
    }
    // a piece that starts in lower case carries on the sentence before it: "Score seven hundred two, your best on this road."
    const t = text.reduce((out, piece) => (out && /^[a-z]/.test(piece) ? `${out.replace(/\.$/, ',')} ${piece}` : out ? `${out} ${piece}` : piece), '');
    return { tokens, text: t.charAt(0).toUpperCase() + t.slice(1) };
  }
  /**
   * Which sign-off a drive gets (REVIEW5 U-113: each pack has four): the same one every time for the same drive (its id), so
   * a replay or a second look at the end card says what the drive said. `has(token)`: the loaded bank holds the clip; a
   * bank rendered before the extra sign-offs keeps its first one.
   */
  function pickSignOff(pack, driveId, has = () => true) {
    const p = ORDER[pack] ? pack : 'marguerite';
    const all = Object.keys(WORDS[p]).filter((k) => /^sys:end\d*$/.test(k) && has(k));
    if (!all.length) return 'sys:end';
    let h = 0;
    for (const ch of String(driveId == null ? '' : driveId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return all[h % all.length];
  }
  /** Is this the best score among your drives on the same road (named the same, at least one earlier with a score)? */
  function bestOnRoad(drive, others) {
    if (!drive || !Number.isFinite(drive.score) || !drive.name) return false;
    const same = (others || []).filter((o) => o && o.id !== drive.id && o.name === drive.name && Number.isFinite(o.score));
    return same.length > 0 && same.every((o) => drive.score > o.score);
  }

  /**
   * The score against your usual: the median of your last USUAL_N scored drives before this one (`earlier`: their scores,
   * oldest first; anything not a number is skipped). { usual, diff, text } or null with fewer than USUAL_MIN of them: a
   * usual needs a few drives, and until then the card says nothing. Within USUAL_NEAR points is "About your usual".
   */
  const USUAL_N = 10, USUAL_MIN = 3, USUAL_NEAR = 5;
  function usual(score, earlier) {
    if (!Number.isFinite(score)) return null;
    const last = (earlier || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(-USUAL_N);
    if (last.length < USUAL_MIN) return null;
    const sorted = last.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
    const med = Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2), diff = Math.round(score) - med;
    return { usual: med, diff, text: Math.abs(diff) <= USUAL_NEAR ? 'About your usual' : `${Math.abs(diff)} ${diff > 0 ? 'over' : 'under'} your usual` };
  }

  /**
   * IDEAS D-30, part three: this drive's best run (flow.js, kept in its summary as run: { corners, len_m }) when it beats every
   * other drive this month whose run is known. `all`: the Log's summaries, this drive among them; monthOf(o): "YYYY-MM", or
   * null for a date that isn't known. Nothing is said for the first drive of a month (no record to beat), for a drive with
   * no run, or for one whose date or month is unknown; a drive whose run was never judged (no run field) neither counts nor
   * beats. A tie is not a new best. The words or null.
   */
  const RUN_MIN = 5;
  function bestRunMonth(me, all, monthOf) {
    const n = (d) => (d && d.run && Number.isFinite(d.run.corners) ? d.run.corners : 0);
    if (!me || typeof monthOf !== 'function' || n(me) < RUN_MIN) return null;
    const month = monthOf(me);
    if (!month) return null;
    const others = (all || []).filter((o) => o && o.id !== me.id && 'run' in o && monthOf(o) === month);
    if (!others.length || !others.every((o) => n(me) > n(o))) return null;
    return `Your best run this month: ${n(me)} corners in a row, smooth and settled.`;
  }

  /**
   * Ask for an App Store rating on this end card? Only in the app, after a good drive (your best on this road, or 700 and
   * up), from your third stored drive on, with the phone known to be parked (under 1.5 m/s), and once per app version
   * (Apple shows it at most three times a year anyway; guideline 5.6.1, docs/APP_REVIEW.md). Unknown speed: no.
   * o: { app, score, best, drives, speedMps, version, askedFor }
   */
  const REVIEW_SCORE = 700, REVIEW_DRIVES = 3, PARKED_MPS = 1.5;
  function askReview(o) {
    if (!o || !o.app || !Number.isFinite(o.score) || !o.version || o.askedFor === o.version) return false;
    if (!(Number.isFinite(o.speedMps) && o.speedMps >= 0 && o.speedMps < PARKED_MPS)) return false;
    if (!(Number.isFinite(o.drives) && o.drives >= REVIEW_DRIVES)) return false;
    return !!o.best || o.score >= REVIEW_SCORE;
  }
  const api = { scoreTokens, endLine, pickSignOff, bestOnRoad, usual, bestRunMonth, under100, askReview, WORDS, USUAL_N, USUAL_MIN, USUAL_NEAR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEndLine = api;
})(typeof window !== 'undefined' ? window : globalThis);
