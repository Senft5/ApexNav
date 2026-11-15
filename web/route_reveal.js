// The route reveal (design pass, 2026-11-10, "Vetta Line" rule 3: things arrive by being drawn). When a route is found
// its line is drawn onto the map from start to finish like a pen stroke, the card's profile is drawn with it and the
// card's three numbers count up. The card and Start are up first; this runs beside them, never in front. Swapping
// between the routes of one plan (a level card, a loop's way, the ranked route replacing the first) redraws quickly;
// reduced motion gets the finished line and the final numbers at once.
// Pure helpers (tests/test_route_reveal.py) and one small DOM helper; the map's side is cockpit.js penDraw.
(function (root) {
  'use strict';
  const FULL_MS = 800, SWAP_MS = 300, COUNT_MS = 500;

  /** The arrive curve, cubic-bezier(0.2, 0.8, 0.2, 1) near enough: fast out of the start, settling into the end. 0..1. */
  function ease(f) {
    const x = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 1));
    return 1 - Math.pow(1 - x, 3);
  }

  /**
   * How a route that has just come up is revealed. `prev` and `next` are the route that was planned and the one now
   * ({ id, name }); the same plan's other route (same id and name, or one loop for another) is a swap. `still`: reduced
   * motion, or nothing to watch (the app is starting, a drive is on). { lineMs, countMs, swap }: 0 = a cut.
   */
  function plan(prev, next, still) {
    if (still || !next) return { lineMs: 0, countMs: 0, swap: false };
    const loop = (t) => !!t && typeof t.id === 'string' && t.id.indexOf('loop_') === 0;
    const swap = !!prev && prev !== next && ((prev.id === next.id && prev.name === next.name) || (loop(prev) && loop(next)));
    return swap ? { lineMs: SWAP_MS, countMs: 0, swap: true } : { lineMs: FULL_MS, countMs: COUNT_MS, swap: false };
  }

  /**
   * A stat's text part way through its count: "94" from 0, "22.8" in tenths, "1:23" in minutes; f = 0..1 (eased by the
   * caller). Anything else ("--", words) is itself all the way: unknown is never counted towards.
   */
  function countText(text, f) {
    const s = String(text == null ? '' : text), x = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 1));
    if (x >= 1) return s;
    let m;
    if ((m = /^(\d+)$/.exec(s))) return String(Math.round(+m[1] * x));
    if ((m = /^(\d+)\.(\d)$/.exec(s))) return (Math.round(+s * 10 * x) / 10).toFixed(1);
    if ((m = /^(\d+):(\d\d)$/.exec(s))) { const min = Math.round((+m[1] * 60 + +m[2]) * x); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }
    return s;
  }

  /** The route line's gradient at `p` (0..1 of its length drawn): `color` up to p, nothing after. A MapLibre expression. */
  function gradient(color, p) {
    const at = Math.max(0.0001, Math.min(1, Number.isFinite(p) ? p : 1));
    return ['step', ['line-progress'], color, at, 'rgba(0,0,0,0)'];
  }

  /**
   * In a drive, the route behind you faded (as Apple and Google Maps draw it): `color` from `p` (0..1 of the line driven) on,
   * the same colour at `alpha` before it. A `#rgb`/`#rrggbb` colour; null for anything else or a `p` that isn't a number.
   */
  function behind(color, p, alpha = 0.3) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ''));
    if (!m || !Number.isFinite(p)) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1], n = parseInt(h, 16);
    const faded = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
    const at = Math.max(0.0001, Math.min(0.9999, p));
    return ['step', ['line-progress'], faded, at, color];
  }

  /**
   * Count the numbers in `nodes` (each a text-only element, or one whose first child is its number's text node) up to what
   * they say, over `ms`. The final text is put back whatever happens (a timer backs the frames up), and a node redrawn
   * meanwhile is left alone. Returns a stop function.
   */
  function countUp(nodes, ms) {
    const list = [];
    for (const n of nodes || []) {
      const tn = n && n.firstChild && n.firstChild.nodeType === 3 ? n.firstChild : null;
      if (tn && countText(tn.textContent, 0) !== tn.textContent) list.push({ tn, to: tn.textContent });
    }
    if (!list.length || !(ms > 0) || typeof requestAnimationFrame !== 'function') return () => {};
    let raf = 0, done = false;
    const t0 = performance.now();
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(timer); for (const k of list) if (k.tn.isConnected) k.tn.textContent = k.to; };
    const timer = setTimeout(finish, ms + 150);
    const frame = (now) => {
      if (done) return;
      const f = (now - t0) / ms;
      if (f >= 1) { finish(); return; }
      for (const k of list) k.tn.textContent = countText(k.to, ease(f));
      raf = requestAnimationFrame(frame);
    };
    for (const k of list) k.tn.textContent = countText(k.to, 0);
    raf = requestAnimationFrame(frame);
    return finish;
  }

  const api = { FULL_MS, SWAP_MS, COUNT_MS, ease, plan, countText, gradient, behind, countUp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexReveal = api;
})(typeof window !== 'undefined' ? window : globalThis);
