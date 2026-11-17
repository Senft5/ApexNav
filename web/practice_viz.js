// Practice Loop pictures (Nate 2026-11-17): above, a ball bouncing between two walls, touching a wall on every click and
// flashing on every note; below, the solfège line (do re mi fa sol la ti do) with its flats and sharps under each
// syllable where one exists (no flat do, no sharp mi, no flat fa, no sharp ti), and a ball hopping to the note you hear.
//
// The shell sends where the block is (PracticeLoop.swift sendClock, type 'practiceClock') four times a second while the
// sheet is on screen; between those the page counts on with performance.now(). Drawing runs on requestAnimationFrame
// only while the canvas is on screen and the page is shown, so a locked phone draws nothing. The math is pure (spell,
// at, ball) and tested in tests/test_practice_loop.py; draw() is the canvas.
(function (root) {
  'use strict';
  // the line: [syllable, semitones above do, flat [syllable, semis] or null, sharp [syllable, semis] or null]
  const COLS = [
    ['do', 0, null, ['di', 1]],
    ['re', 2, ['ra', 1], ['ri', 3]],
    ['mi', 4, ['me', 3], null],
    ['fa', 5, null, ['fi', 6]],
    ['sol', 7, ['se', 6], ['si', 8]],
    ['la', 9, ['le', 8], ['li', 10]],
    ['ti', 11, ['te', 10], null],
    ['do', 12, null, null],
  ];

  /**
   * Where a note sits on the line: { col, row } with row 0 the syllable, 1 its flat, 2 its sharp. The altered notes are
   * spelled from the scale they are in: ♭2 ra, ♭3 me, ♭7 te; the tritone is fi (♯4) in a scale with mi and no fa
   * (Lydian, whole tone) and se (♭5) otherwise (Locrian, blues, m7♭5); the minor sixth is si (♯5) over mi with no sol
   * and no la (whole tone, augmented), le otherwise.
   */
  function spell(semis, intervals) {
    const has = (x) => intervals.includes(x);
    if (semis === 12) return { col: 7, row: 0 };
    const pc = ((semis % 12) + 12) % 12;
    switch (pc) {
      case 0: return { col: 0, row: 0 };
      case 1: return { col: 1, row: 1 };
      case 2: return { col: 1, row: 0 };
      case 3: return { col: 2, row: 1 };
      case 4: return { col: 2, row: 0 };
      case 5: return { col: 3, row: 0 };
      case 6: return has(4) && !has(5) ? { col: 3, row: 2 } : { col: 4, row: 1 };
      case 7: return { col: 4, row: 0 };
      case 8: return has(4) && !has(7) && !has(9) ? { col: 4, row: 2 } : { col: 5, row: 1 };
      case 9: return { col: 5, row: 0 };
      case 10: return { col: 6, row: 1 };
      default: return { col: 6, row: 0 };
    }
  }
  function syllable(cell) { const c = COLS[cell.col]; return cell.row === 0 ? c[0] : (cell.row === 1 ? c[2] : c[3])[0]; }

  /**
   * The block at `posS` seconds after its count-in's first click: { s (16ths), beat, inCountIn, idx (the note sounding,
   * or the last one during a rest; -1 before the first), onset (s of that note's start), next (s of the next note's
   * start), nextIdx }. The grid: 16 count-in 16ths, then reps of `repSixteenths`, a note every `step` 16ths.
   */
  function at(clock, posS) {
    const s = posS * clock.bpm / 15;
    const beat = s / 4;
    const n = clock.notes.length, step = clock.step, rep = clock.repSixteenths;
    const out = { s, beat, inCountIn: s < 16, idx: -1, onset: null, next: 16, nextIdx: 0 };
    if (s < 16) return out;
    const k = s - 16, r = Math.floor(k / rep), j = k - r * rep;
    const i = Math.min(n - 1, Math.floor(j / step));
    out.idx = i;
    out.onset = 16 + r * rep + i * step;
    if (i + 1 < n) { out.nextIdx = i + 1; out.next = out.onset + step; }
    else { out.nextIdx = 0; out.next = 16 + (r + 1) * rep; }   // after the top-and-back, the rest, then the root again
    return out;
  }

  /** The wall ball: 0 at the left wall, 1 at the right; it touches a wall on every beat (click). */
  function wallX(beat) {
    if (beat <= 0) return 0;
    const p = beat % 2;
    return p < 1 ? p : 2 - p;
  }

  /**
   * The line ball between notes: rests on the note sounding, then hops to the next, landing on its onset. The hop takes
   * the last part of the gap (at most 0.3 s, at least the last 40% of a short note). Returns { from, to, t } with t in
   * 0..1 (0: on `from`), from/to note indices (-1: off the line, before the first note).
   */
  function hop(clock, a) {
    const secPer16 = 15 / clock.bpm;
    const gapS = (a.next - (a.onset == null ? a.s : a.onset)) * secPer16;
    const leftS = (a.next - a.s) * secPer16;
    const hopS = Math.min(0.3, Math.max(gapS * 0.4, Math.min(gapS, 0.12)));
    const t = leftS >= hopS ? 0 : 1 - leftS / hopS;
    return { from: a.idx, to: a.nextIdx, t };
  }

  function colors(doc) {
    const cs = root.getComputedStyle ? root.getComputedStyle(doc.documentElement) : null;
    const v = (k, d) => (cs && cs.getPropertyValue(k).trim()) || d;
    return { ink: v('--panel-ink', '#e8e8ea'), dim: v('--panel-dim', '#8a8d93'), rule: v('--rule', '#2a2c30'), accent: v('--accent', '#ff6a2b') };
  }

  /** Mounts the canvas into `box`. Returns { clock(msg), state(msg), stop() }; `watch(on)` tells the shell to send. */
  function mount(box, deps) {
    const doc = deps.document || root.document;
    const cv = doc.createElement('canvas');
    cv.className = 'pl-viz';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'The note playing on the solfège line');
    cv.style.cssText = 'width:100%;height:205px;display:block;border-radius:12px';
    box.append(cv);
    let clock = null, recvAt = 0, playing = false, raf = 0, onScreen = false, lastIdx = -1, flashAt = -1e9, hitAt = -1e9, lastBeat = -1;
    const now = () => root.performance.now();

    function frame() {
      raf = 0;
      if (!onScreen || doc.hidden) return;
      draw();
      if (playing) raf = root.requestAnimationFrame(frame);
    }
    function kick() { if (!raf && onScreen && !doc.hidden) raf = root.requestAnimationFrame(frame); }
    function want() { const on = onScreen && !doc.hidden; deps.watch(on); if (on) kick(); }

    const io = new root.IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); want(); });
    io.observe(cv);
    const vis = () => want();
    doc.addEventListener('visibilitychange', vis);

    function draw() {
      const dpr = root.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const C = colors(doc);
      const t = now();
      const a = clock ? at(clock, clock.posS + (playing ? (t - recvAt) / 1000 : 0)) : null;
      if (a && a.idx !== lastIdx) { if (a.idx >= 0) flashAt = t; lastIdx = a.idx; }
      if (a && Math.floor(a.beat) !== lastBeat) { if (a.beat >= 0) hitAt = t; lastBeat = Math.floor(a.beat); }

      // the wall strip
      const top = 10, sh = 56, wall = 14, r = 9;
      g.strokeStyle = C.rule; g.lineWidth = 3;
      for (const x of [wall, W - wall]) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + sh); g.stroke(); }
      const hitAge = (t - hitAt) / 1000;
      if (a && a.beat >= 0 && hitAge < 0.15) {                       // the wall it just touched lights, brighter on beat 1
        const left = Math.round(a.beat) % 2 === 0;
        g.strokeStyle = C.accent; g.globalAlpha = (1 - hitAge / 0.15) * (Math.round(a.beat) % 4 === 0 ? 1 : 0.55);
        const x = left ? wall : W - wall; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + sh); g.stroke(); g.globalAlpha = 1;
      }
      const bx = wall + r + 2 + wallX(a ? a.beat : 0) * (W - 2 * (wall + r + 2));
      const flash = Math.max(0, 1 - (t - flashAt) / 140);
      g.fillStyle = flash > 0 ? C.accent : C.ink;
      g.beginPath(); g.arc(bx, top + sh / 2, r + flash * 4, 0, Math.PI * 2); g.fill();

      // the solfège line
      const y0 = top + sh + 34, rowH = 30, colW = (W - 24) / COLS.length;
      const cx = (col) => 12 + colW * (col + 0.5), cy = (row) => y0 + row * rowH + (row ? 6 : 0);
      g.strokeStyle = C.rule; g.lineWidth = 1;
      g.beginPath(); g.moveTo(12, y0 + 14); g.lineTo(W - 12, y0 + 14); g.stroke();
      const ints = clock ? clock.intervals : [0, 2, 4, 5, 7, 9, 11];
      const inScale = new Set([...ints, 12].map((x) => { const c = spell(x, ints); return `${c.col}:${c.row}`; }));
      const cur = a && a.idx >= 0 ? spell(clock.notes[a.idx], ints) : null;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      COLS.forEach((c, col) => {
        const cells = [[c[0], 0], ...(c[2] ? [[c[2][0], 1]] : []), ...(c[3] ? [[c[3][0], 2]] : [])];
        for (const [name, row] of cells) {
          const on = inScale.has(`${col}:${row}`), here = cur && cur.col === col && cur.row === row;
          g.font = `${row ? 500 : 650} ${row ? 13 : 17}px system-ui, -apple-system, sans-serif`;
          g.fillStyle = here ? C.accent : on ? C.ink : C.dim;
          g.globalAlpha = here || on ? 1 : 0.45;
          g.fillText(row === 1 ? `♭ ${name}` : row === 2 ? `♯ ${name}` : name, cx(col), cy(row));
          g.globalAlpha = 1;
        }
      });
      // the hopping ball: rests over the note sounding, arcs to the next one, landing on its first sound
      if (a && clock) {
        const h = hop(clock, a);
        const from = h.from >= 0 ? spell(clock.notes[h.from], ints) : { col: 0, row: 0 };
        const to = spell(clock.notes[h.to], ints);
        const ease = h.t * h.t * (3 - 2 * h.t);
        const x = cx(from.col) + (cx(to.col) - cx(from.col)) * ease;
        const yb = (cy(from.row) + (cy(to.row) - cy(from.row)) * ease) - 22;
        const arc = Math.sin(Math.PI * h.t) * 22;
        g.fillStyle = C.accent;
        g.beginPath(); g.arc(x, yb - arc, 6, 0, Math.PI * 2); g.fill();
      }
    }

    return {
      clock(msg) { clock = msg; recvAt = now(); playing = !!msg.playing; kick(); },
      state(msg) { playing = !!msg.playing && !!msg.active; if (!msg.active) clock = null; kick(); if (!playing) draw(); },
      stop() { io.disconnect(); doc.removeEventListener('visibilitychange', vis); if (raf) root.cancelAnimationFrame(raf); deps.watch(false); },
    };
  }

  const api = { COLS, spell, syllable, at, wallX, hop, mount };
  root.ApexPracticeViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
