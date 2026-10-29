// The end of a drive (docs/design/REVIEW.md 4.4): each voice pack says its own closing line around the Vetta Score, and
// "your best on this road" when it is. The score is spoken from the pack's own clips (tools/voicebank.py renders the
// numbers), never in a second voice. bestOnRoad compares with your earlier drives named after the same road. Pure
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
  const WORDS = {
    marguerite: { 'sys:end': "That's the drive.", 'end:score': 'Score', 'end:best': 'your best on this road.' },
    kit: { 'sys:end': "That's a wrap.", 'end:score': '', 'end:best': 'Best yet on this road.' },
    hale: { 'sys:end': 'Complete.', 'end:score': 'Score,', 'end:best': 'Best on this road.' },
  };
  /** The closing line for a pack: { tokens, text }. No score: just the pack's close. */
  function endLine(pack, score, best) {
    const p = ORDER[pack] ? pack : 'marguerite', s = scoreTokens(score);
    const tokens = [], text = [];
    for (const k of ORDER[p]) {
      if (k === '#') { if (s) { tokens.push(...s.tokens); text.push(s.words + '.'); } continue; }
      if ((k === 'end:score' && !s) || (k === 'end:best' && !(s && best)) || !WORDS[p][k]) continue;
      tokens.push(k); text.push(WORDS[p][k]);
    }
    // a piece that starts in lower case carries on the sentence before it: "Score seven hundred two, your best on this road."
    const t = text.reduce((out, piece) => (out && /^[a-z]/.test(piece) ? `${out.replace(/\.$/, ',')} ${piece}` : out ? `${out} ${piece}` : piece), '');
    return { tokens, text: t.charAt(0).toUpperCase() + t.slice(1) };
  }
  /** Is this the best score among your drives on the same road (named the same, at least one earlier with a score)? */
  function bestOnRoad(drive, others) {
    if (!drive || !Number.isFinite(drive.score) || !drive.name) return false;
    const same = (others || []).filter((o) => o && o.id !== drive.id && o.name === drive.name && Number.isFinite(o.score));
    return same.length > 0 && same.every((o) => drive.score > o.score);
  }

  const api = { scoreTokens, endLine, bestOnRoad, under100, WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEndLine = api;
})(typeof window !== 'undefined' ? window : globalThis);
