// Pace notes in plain words (IDEAS V-02): the same corners, said the way someone without rally training understands them.
// "Left 4 minus tightens, caution" becomes "Medium left, tightens, slow down". Built from the note's fields (direction,
// severity, shape, mods, caution), never by rewriting the rally text. Pure (tests/test_plain_notes.py).
(function (root) {
  'use strict';
  // McRae 1 (tightest) to 6 (nearly straight)
  const SEVERITY = { 1: 'Very tight', 2: 'Tight', 3: 'Medium', 4: 'Open', 5: 'Easy', 6: 'Slight' };
  const MODS = { tightens: 'tightens', opens: 'opens up', long: 'long', 'off-camber': 'slopes away', 'over crest': 'over a crest' };
  const CAUTION = ['', 'careful', 'slow down', 'slow right down', 'very slow'];

  /** One corner (or hazard) in plain words. Hazards keep their own call ("Bump", "Camera"). */
  function plainCall(e) {
    if (!e || e.type !== 'corner') return e ? e.call : '';
    const side = e.dir === 'L' ? 'left' : 'right';
    let core;
    if (e.severity === 'HP' || e.shape === 'hairpin') core = `Hairpin ${side}`;
    else if (e.shape === 'acute') core = `Very sharp ${side}, almost back on itself`;
    else if (e.shape === 'square') core = `Sharp ${side}, like a junction`;
    else core = `${SEVERITY[e.severity] || 'Bend'} ${side}`;
    const parts = [core, ...(e.mods || []).map((m) => MODS[m] || m)];
    if (e.caution && CAUTION[e.caution]) parts.push(CAUTION[e.caution]);
    return parts.join(', ');
  }

  /** The link to the next note: "then" straight after, else "in N metres". */
  function plainLink(link) {
    if (!link) return '';
    if (link === 'into' || link === 'and') return 'then';
    const m = Number(link);
    return Number.isFinite(m) ? `then ${m} metres` : '';
  }

  /** A chain as the page reads it: each note in plain words, joined by plain links. */
  function plainChain(chain) {
    let text = '';
    chain.forEach((n, i) => {
      text += (i ? ` ${plainLink(chain[i - 1].link)} ` : '') + plainCall(n);
    });
    const last = chain[chain.length - 1];
    if (last && last.link && last.link !== 'into' && last.link !== 'and') text += `, ${plainLink(last.link)}`;
    return text.replace(/\s+/g, ' ').trim();
  }

  const api = { plainCall, plainLink, plainChain, SEVERITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlainNotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
