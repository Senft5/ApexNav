// Traffic as a fun penalty (iOS only: Apple's MKDirections is the only traffic source; web and Android have none and say
// nothing). Pure: no timers, no I/O; the page asks the shell and routes, this file decides. docs/ARCHITECTURE.md section 8.
//   - The route ahead (next 20 km) is cut into ~4 km chunks. For each, Apple routes the chunk's ends twice: leaving now
//     (with traffic) and leaving at 3 am (Apple's own quiet-road time). A chunk counts only when both of Apple's paths
//     follow ours (80 % of each within 50 m of the other); otherwise it is unknown, never clear.
//   - ratio = now / 3 am. Slow at >= 1.2, jam at >= 1.5 and >= 60 s lost. Slow or jammed, it costs fun even with no delay:
//     a road at 1/r of its speed gives about 1/r^2 of its cornering load, for r times as long. So each 500 m piece of
//     a route scores fun / r^2 with time weight r, and route fun is the time-weighted mean.
//   - Piece fun is the loop builder's: good corners (severity 2..5, not hairpins) per km x 10.
//   - A jam ahead looks for a detour: the best alternative that never crosses a jam and is more fun than the current
//     route with its traffic, costing at most max(10 min, 25 %) more time. None: "Traffic ahead" and stay.
(function (root) {
  const AHEAD_M = 20000, CHUNK_M = 4000, MIN_CHUNK_M = 1000;
  const FOLLOW_TOL_M = 50, FOLLOW_MIN = 0.8;
  const SLOW_RATIO = 1.2, JAM_RATIO = 1.5, JAM_MIN_S = 60, MAX_RATIO = 6;
  const PIECE_M = 500, PIECE_MATCH_M = 40;
  const FUN_MARGIN = 0.5, EXTRA_MIN_S = 600, EXTRA_SHARE = 0.25;
  const PROBE_EVERY_MS = 120000, THROTTLE_BACKOFF_MS = [240000, 480000, 960000], QUIET_MS = 600000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Chunks of the route ahead of fromM: [{ i0, i1, startM, endM }] (sample indices into dist). */
  function chunksAhead(dist, fromM, { aheadM = AHEAD_M, chunkM = CHUNK_M, minM = MIN_CHUNK_M } = {}) {
    const n = dist ? dist.length : 0;
    if (n < 2 || !finite(fromM)) return [];
    const endM = Math.min(dist[n - 1], fromM + aheadM);
    const at = (m) => { let i = 0; while (i < n - 1 && dist[i] < m) i++; return i; };
    const out = [];
    for (let s = fromM; endM - s >= minM; s += chunkM) {
      const e = endM - (s + chunkM) < minM ? endM : s + chunkM;   // a short tail joins the last chunk
      const i0 = at(s), i1 = at(e);
      if (i1 > i0) out.push({ i0, i1, startM: dist[i0], endM: dist[i1] });
      if (e === endM) break;
    }
    return out;
  }

  // Equirectangular metres around a reference latitude: fine over a few km.
  const proj = (lat0) => { const c = Math.cos(lat0 * Math.PI / 180); return (la, lo) => [lo * 111320 * c, la * 110540]; };
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
  }
  function distToLine(p, line) {
    if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, segDist(p, line[i - 1], line[i]));
    return best;
  }
  /** Share of polyline a's points within tolM of polyline b (both as lat[] / lon[]). */
  function followShare(aLat, aLon, bLat, bLon, tolM = FOLLOW_TOL_M) {
    if (!aLat || !bLat || !aLat.length || !bLat.length) return 0;
    const P = proj(aLat[0]);
    const line = bLat.map((la, i) => P(la, bLon[i]));
    let near = 0;
    for (let i = 0; i < aLat.length; i++) if (distToLine(P(aLat[i], aLon[i]), line) <= tolM) near++;
    return near / aLat.length;
  }
  const follows = (ours, apple) => !!apple && finite(apple.s) && Array.isArray(apple.lat) && apple.lat.length > 1 &&
    followShare(ours.lat, ours.lon, apple.lat, apple.lon) >= FOLLOW_MIN && followShare(apple.lat, apple.lon, ours.lat, ours.lon) >= FOLLOW_MIN;

  /**
   * One chunk: ours = { lat[], lon[] }, now / night = Apple's answers { s, lat[], lon[] } or null.
   * Returns { level: 'jam' | 'slow' | 'clear' | 'unknown', ratio, delayS } (ratio and delayS null when unknown).
   */
  function classifyChunk(ours, now, night) {
    if (!follows(ours, now) || !follows(ours, night) || !(night.s > 0)) return { level: 'unknown', ratio: null, delayS: null };
    const ratio = Math.min(MAX_RATIO, Math.max(1, now.s / night.s)), delayS = Math.max(0, now.s - night.s);
    const level = ratio >= JAM_RATIO && delayS >= JAM_MIN_S ? 'jam' : ratio >= SLOW_RATIO ? 'slow' : 'clear';
    return { level, ratio, delayS };
  }

  /** 500 m pieces of a track from sample fromIdx: [{ i0, i1, lenM, fun }]. Fun = good corners per km x 10. */
  function funPieces(t, fromIdx = 0) {
    const n = t.dist.length, out = [];
    if (n < 2) return out;
    const goodApex = (t.events || []).filter(e => e.type === 'corner' && e.severity !== 'HP' && e.severity >= 2 && e.severity <= 5).map(e => e.index);
    for (let i0 = Math.max(0, fromIdx); i0 < n - 1;) {
      let i1 = i0;
      while (i1 < n - 1 && t.dist[i1] - t.dist[i0] < PIECE_M) i1++;
      const lenM = t.dist[i1] - t.dist[i0];
      const good = goodApex.filter(a => a >= i0 && a < i1).length;
      out.push({ i0, i1, lenM, fun: lenM > 0 ? good / (lenM / 1000) * 10 : 0 });
      i0 = i1;
    }
    return out;
  }

  /**
   * Which probed chunk (if any) a piece of track t lies on: the piece's middle within 40 m of the chunk's path.
   * probes: [{ lat[], lon[], level, ratio, delayS }]. Returns the probe or null.
   */
  function probeFor(t, piece, probes) {
    const m = Math.floor((piece.i0 + piece.i1) / 2), la = t.lat[m], lo = t.lon[m];
    for (const p of probes) {
      if (!p || !Array.isArray(p.lat) || !p.lat.length) continue;
      const P = proj(la), line = p.lat.map((a, i) => P(a, p.lon[i]));
      if (distToLine(P(la, lo), line) <= PIECE_MATCH_M) return p;
    }
    return null;
  }

  /**
   * Route fun with traffic: { fun, rawFun, jamM, slowM, crossesJam }. Unknown traffic counts as none (ratio 1).
   */
  function routeFun(t, probes = [], fromIdx = 0) {
    let num = 0, den = 0, rawNum = 0, rawDen = 0, jamM = 0, slowM = 0;
    for (const piece of funPieces(t, fromIdx)) {
      const p = probes.length ? probeFor(t, piece, probes) : null;
      const r = p && finite(p.ratio) && p.level !== 'unknown' ? p.ratio : 1;
      if (p && p.level === 'jam') jamM += piece.lenM;
      else if (p && p.level === 'slow') slowM += piece.lenM;
      num += piece.fun / (r * r) * piece.lenM * r; den += piece.lenM * r;
      rawNum += piece.fun * piece.lenM; rawDen += piece.lenM;
    }
    return { fun: den > 0 ? num / den : 0, rawFun: rawDen > 0 ? rawNum / rawDen : 0, jamM, slowM, crossesJam: jamM > 0 };
  }

  /**
   * current: { fun, timeS, delayS }; candidates: [{ fun, timeS, crossesJam }].
   * Returns { index, extraS } of the detour to take, or null to stay.
   */
  function pickDetour(current, candidates) {
    let best = null;
    candidates.forEach((c, index) => {
      if (!c || c.crossesJam || !finite(c.fun) || !finite(c.timeS) || tooSlow(current, c.timeS)) return;
      const extraS = c.timeS - current.timeS - (finite(current.delayS) ? current.delayS : 0);
      if (c.fun < current.fun + FUN_MARGIN) return;
      if (!best || c.fun > best.fun) best = { index, extraS, fun: c.fun };
    });
    return best && { index: best.index, extraS: best.extraS };
  }

  /** A candidate taking timeS is too slow: more than max(10 min, 25 %) over the current route with its delay. */
  function tooSlow(current, timeS) {
    const withTraffic = current.timeS + (finite(current.delayS) ? current.delayS : 0);
    return !(timeS - withTraffic <= Math.max(EXTRA_MIN_S, EXTRA_SHARE * current.timeS));
  }

  /** Exclusion boxes (Valhalla exclude_polygons rings, [lon, lat]) at 1/4, 1/2, 3/4 of each jam chunk; at most 12. */
  function jamPolygons(probes, halfM = 100) {
    const rings = [];
    for (const p of probes) {
      if (!p || p.level !== 'jam' || !Array.isArray(p.lat) || p.lat.length < 2) continue;
      for (const f of [0.25, 0.5, 0.75]) {
        const k = Math.round(f * (p.lat.length - 1)), la = p.lat[k], lo = p.lon[k];
        const dLa = halfM / 110540, dLo = halfM / (111320 * Math.cos(la * Math.PI / 180));
        rings.push([[lo - dLo, la - dLa], [lo + dLo, la - dLa], [lo + dLo, la + dLa], [lo - dLo, la + dLa], [lo - dLo, la - dLa]]);
      }
    }
    return rings.slice(0, 12);
  }

  /** When to ask Apple: every 2 min while driving a route; throttled by MapKit -> 4 / 8 / 16 min; one in flight. */
  class TrafficMonitor {
    constructor() { this.throttles = 0; this.routeChanged(null); }
    /** A new route is on screen: wait a full interval before probing it (t in ms, null = probe at once). */
    routeChanged(t) { this.nextAt = t == null ? 0 : t + PROBE_EVERY_MS; this.busy = false; this.said = []; }
    due(t) { return !this.busy && finite(t) && t >= this.nextAt; }
    started() { this.busy = true; }
    done(t, { throttled = false } = {}) {
      this.busy = false;
      if (throttled) { this.throttles += 1; this.nextAt = t + THROTTLE_BACKOFF_MS[Math.min(this.throttles, THROTTLE_BACKOFF_MS.length) - 1]; }
      else { this.throttles = 0; this.nextAt = t + PROBE_EVERY_MS; }
    }
    /**
     * "Traffic ahead" (or a detour offer) for the same jam at most once per 10 min on this route. A jam is its stretch of
     * route distance [startM, endM]; chunks are cut from wherever the car is, so a jam probed again overlaps, not equals.
     */
    shouldSay(ranges, t) {
      this.said = this.said.filter(s => t - s.t < QUIET_MS);
      if (ranges.some(([a, b]) => this.said.some(s => a <= s.b && b >= s.a))) return false;
      for (const [a, b] of ranges) this.said.push({ a, b, t });
      return true;
    }
  }

  const api = { chunksAhead, followShare, classifyChunk, funPieces, probeFor, routeFun, pickDetour, tooSlow, jamPolygons, TrafficMonitor,
                AHEAD_M, CHUNK_M, SLOW_RATIO, JAM_RATIO, JAM_MIN_S, PROBE_EVERY_MS, THROTTLE_BACKOFF_MS, QUIET_MS, EXTRA_MIN_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTraffic = api;
})(typeof window !== 'undefined' ? window : globalThis);
