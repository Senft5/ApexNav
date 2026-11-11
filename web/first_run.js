// The first run's road (design pass "first and last"). The welcome shows what the app does instead of saying it: a road
// is drawn across the paper (CSS, web/index.html .ob-road), and the red dot, you, drives it while the road book strip
// under it calls each corner before the dot reaches it (cockpit.js runOnboarding steps both together). The road is the
// brand mark at length: an ink dot, a line, an arrowhead, and the red dot it bends round.
// The lockup starts where the launch screen and the opening cover leave it, in the middle of the screen, and moves to
// its place; nothing is redrawn that the driver has already seen. With reduced motion the page is whole and still.
(function (root) {
  'use strict';
  /** Where the dot waits while corner j is the strip's lead call: at the start for the first, else halfway from the corner
   *  before. fracs: each corner's place along the road, 0 to 1, rising. */
  function rests(fracs) { return fracs.map((f, j) => (j === 0 ? 0 : (fracs[j - 1] + f) / 2)); }
  /** The dot's move at step k (the strip's k-th call): { from, to, out }. Step 0 only places it; when the calls come round
   *  again the dot runs out to the road's end (out) and starts over. */
  function leg(k, R) {
    const n = R.length, j = n ? k % n : 0;
    if (!n || k <= 0) return { from: 0, to: 0, out: false };
    return j === 0 ? { from: R[n - 1], to: 1, out: true } : { from: R[j - 1], to: R[j], out: false };
  }
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const MOVE_MS = 1200;

  /** Wire the welcome (#onboard). Returns { step(k), skip() }: step moves the dot for the strip's k-th call. */
  function attach(ob) {
    const doc = root.document, none = { step() {}, skip() {} };
    if (!ob || !doc) return none;
    const still = typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // the lockup from the middle of the screen (where the cover drew it) to its place
    const mark = ob.querySelector('.ob-mark');
    if (mark && !still) {
      const r = mark.getBoundingClientRect();
      if (r.width) { mark.style.setProperty('--ob-dx', `${(root.innerWidth - r.width) / 2 - r.left}px`); mark.style.setProperty('--ob-dy', `${(root.innerHeight - r.height) / 2 - r.top}px`); }
    }
    ob.classList.remove('ob-skip');
    ob.classList.add('ob-go');
    const skip = () => ob.classList.add('ob-skip');                 // a touch anywhere: the page as it ends, at once
    ob.addEventListener('pointerdown', skip, { once: true });
    const road = ob.querySelector('.ob-road'), path = road && road.querySelector('.ob-line'), dot = road && road.querySelector('.ob-you');
    const marks = road ? [...road.querySelectorAll('.ob-apex')] : [];
    if (!path || !dot || typeof path.getTotalLength !== 'function' || !marks.length) return { step() {}, skip };
    let L = 0;
    try { L = path.getTotalLength(); } catch (_) { L = 0; }
    if (!(L > 0)) return { step() {}, skip };
    const N = 240, pts = [];
    for (let i = 0; i <= N; i++) pts.push(path.getPointAtLength(L * i / N));
    const fracs = marks.map((m) => {
      const x = +m.getAttribute('cx'), y = +m.getAttribute('cy');
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = i; } });
      return best / N;
    });
    const R = rests(fracs);
    const put = (f) => { const p = path.getPointAtLength(L * Math.max(0, Math.min(1, f))); dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1)); };
    let run = 0;
    function step(k) {
      const j = k % marks.length, g = leg(k, R), me = ++run;
      marks.forEach((m, i) => m.classList.toggle('on', i === j));
      dot.classList.remove('gone');
      if (still || k <= 0) { put(R[j]); return; }
      const t0 = root.performance.now();
      const frame = (now) => {
        if (me !== run || !ob.classList.contains('show')) return;
        const p = Math.max(0, Math.min(1, (now - t0) / MOVE_MS));
        put(g.from + (g.to - g.from) * ease(p));
        if (p < 1) { root.requestAnimationFrame(frame); return; }
        if (g.out) { dot.classList.add('gone'); root.setTimeout(() => { if (me === run) { put(0); dot.classList.remove('gone'); } }, 260); }
      };
      root.requestAnimationFrame(frame);
    }
    return { step, skip };
  }

  const api = { rests, leg, attach, MOVE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFirstRun = api;
})(typeof window !== 'undefined' ? window : globalThis);
