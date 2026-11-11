// The drive-ended card's reveal (design pass "first and last"). The card is the last thing a driver sees after every
// drive, so it arrives the way the app draws everything: the driven line is drawn on beside the score's place while the
// drive is being scored, the Vetta Score counts up to its number when (and only when) the number is known, the facts
// follow, the keys are there throughout. Nothing here makes a number: #endScore's text is always the truth (cockpit.js
// endCardOpen / endCardScored write it); the count is a look laid over it (data-n, drawn by CSS) and is gone when it lands.
// Pure parts (glyph, cells, countAt) are tested in tests/test_end_reveal.py.
(function (root) {
  'use strict';
  const fin = Number.isFinite;
  const SIZE = 112, PAD = 10, COUNT_MS = 800;

  /**
   * The drive's line as a small drawing. runs: [[[lon, lat], …], …] (cockpit.js endTrailRuns). Returns
   * { d: [path data per run], from: [x, y], to: [x, y] } in a size x size box, north up, or null with nothing to draw.
   */
  function glyph(runs, size = SIZE, pad = PAD) {
    const list = (Array.isArray(runs) ? runs : []).map((r) => (Array.isArray(r) ? r.filter((p) => p && fin(p[0]) && fin(p[1])) : [])).filter((r) => r.length >= 2);
    if (!list.length) return null;
    let la0 = Infinity, la1 = -Infinity;
    for (const r of list) for (const p of r) { la0 = Math.min(la0, p[1]); la1 = Math.max(la1, p[1]); }
    const k = Math.cos((la0 + la1) / 2 * Math.PI / 180) || 1;
    let x0 = Infinity, x1 = -Infinity;
    for (const r of list) for (const p of r) { x0 = Math.min(x0, p[0] * k); x1 = Math.max(x1, p[0] * k); }
    const room = size - 2 * pad, w = x1 - x0, h = la1 - la0;
    const s = Math.max(w, h) > 0 ? room / Math.max(w, h) : 0;
    const at = (p) => [size / 2 + (p[0] * k - (x0 + x1) / 2) * s, size / 2 - (p[1] - (la0 + la1) / 2) * s];
    const d = list.map((r) => {
      const step = Math.max(1, Math.floor(r.length / 240));
      return r.filter((_, i) => i % step === 0 || i === r.length - 1).map(at).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    });
    const first = list[0], last = list[list.length - 1];
    return { d, from: at(first[0]).map((v) => +v.toFixed(1)), to: at(last[last.length - 1]).map((v) => +v.toFixed(1)) };
  }

  /** "36 mi · 1 h 12 min · 30 corners" as cells of numbers and words: [[{ n: '36' }, { u: ' mi' }], …]. Nothing is added
   *  or dropped: the cells joined with " · " are the line. */
  function cells(line) {
    return String(line || '').split(' · ').filter(Boolean)
      .map((part) => part.split(/(\d[\d.,:]*)/).filter((s) => s !== '').map((s) => (/^\d/.test(s) ? { n: s } : { u: s })));
  }

  /** The count at p (0 to 1) of its way to `to`: whole, eased out, never past it; null for a score that is not a number. */
  function countAt(p, to) {
    if (!fin(to)) return null;
    const t = Math.max(0, Math.min(1, p));
    return Math.min(Math.round(to), Math.round(to * (1 - Math.pow(1 - t, 3))));
  }

  // ---- the page (browser only) ----
  const still = () => typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let token = 0;
  function paintFacts(meta, line, arriving) {
    const doc = root.document, had = arriving ? meta.querySelectorAll('.f').length : Infinity;
    const nodes = [];
    cells(line).forEach((cell, i) => {
      if (i) { const dot = doc.createElement('i'); dot.textContent = ' · '; nodes.push(dot); }
      const f = doc.createElement('span'); f.className = i >= had ? 'f new' : 'f';
      for (const part of cell) { if (part.n != null) { const b = doc.createElement('b'); b.textContent = part.n; f.append(b); } else f.append(part.u); }
      nodes.push(f);
    });
    meta.replaceChildren(...nodes);
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  /** The card opens. el: { card, glyph, meta, score }; o: { runs, facts }. The line starts drawing; no number yet. */
  function open(el, o) {
    token++;
    el.score.classList.remove('counting'); el.score.removeAttribute('data-n');
    el.card.classList.remove('landed');
    const g = glyph(o.runs);
    el.glyph.innerHTML = g ? `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">`
      + g.d.map((d) => `<path class="eg-line" pathLength="1" d="${d}"/>`).join('')
      + `<circle class="eg-from" cx="${g.from[0]}" cy="${g.from[1]}" r="3.5"/><circle class="eg-now" cx="${g.to[0]}" cy="${g.to[1]}" r="5"/></svg>` : '';
    el.card.classList.toggle('no-glyph', !g);
    paintFacts(el.meta, o.facts, false);
    restart(el.card, 'pen');
  }
  /** The score is known. o: { score: a number, or null for a drive with none; facts }. Counts up to a number; words just arrive. */
  function land(el, o) {
    const me = token, count = fin(o.score) && !still() ? COUNT_MS : 0;
    paintFacts(el.meta, o.facts, true);
    el.card.style.setProperty('--land', `${count}ms`);
    restart(el.card, 'landed');
    if (!count) return;
    const to = Math.round(o.score), t0 = root.performance.now();
    const end = () => { if (me !== token) return; el.score.classList.remove('counting'); el.score.removeAttribute('data-n'); };
    el.score.setAttribute('data-n', '0'); el.score.classList.add('counting');
    const frame = (t) => {
      if (me !== token || !el.score.classList.contains('counting')) return;
      const p = (t - t0) / COUNT_MS;
      if (p >= 1) { end(); return; }
      el.score.setAttribute('data-n', String(countAt(p, to)));
      root.requestAnimationFrame(frame);
    };
    root.requestAnimationFrame(frame);
    root.setTimeout(end, COUNT_MS + 250);                               // a throttled page still ends on the number
  }

  const api = { glyph, cells, countAt, open, land, SIZE, COUNT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexEndReveal = api;
})(typeof window !== 'undefined' ? window : globalThis);
