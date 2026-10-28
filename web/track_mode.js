// Track day mode (IDEAS D-15): lap timing on a closed circuit, and only there. It unlocks when the map says you are on a
// raceway (OSM highway=raceway, the tiles' `raceway` class): on public roads times are never kept (guardrails). Set the
// start/finish line where you are; each crossing in the same direction ends a lap (the crossing moment interpolated
// between fixes), the first lap places two more lines at a third and two thirds of its length for sectors, and the
// live delta is against your best lap at the same distance. Pure (tests/test_track_mode.py); index.html draws the bar.
(function (root) {
  'use strict';
  const HALF_WIDTH_M = 25, MIN_LAP_S = 20;
  const xy = (o, p) => { const c = Math.cos(o.lat * Math.PI / 180); return [(p.lon - o.lon) * 111320 * c, (p.lat - o.lat) * 110540]; };

  /** Is (lat, lon) within maxM of a raceway line? features: decoded `transportation` features ({ props, lines: [[lon, lat]...] }). */
  function onRaceway(features, lat, lon, maxM = 40) {
    const o = { lat, lon };
    for (const f of features || []) {
      if (!f || !f.props || f.props.class !== 'raceway') continue;
      for (const line of f.lines || []) for (let i = 1; i < line.length; i++) {
        const [ax, ay] = xy(o, { lon: line[i - 1][0], lat: line[i - 1][1] }), [bx, by] = xy(o, { lon: line[i][0], lat: line[i][1] });
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
        if (Math.hypot(ax + t * dx, ay + t * dy) <= maxM) return true;
      }
    }
    return false;
  }

  /** A gate: a line HALF_WIDTH_M either side of a point, across the direction of travel (heading in degrees from north). */
  const gate = (lat, lon, headingDeg) => ({ lat, lon, h: headingDeg * Math.PI / 180 });
  /** Fraction along p0→p1 where it crosses gate g going the gate's way, or null. */
  function crossing(g, p0, p1) {
    const [x0, y0] = xy(g, p0), [x1, y1] = xy(g, p1);
    const fx = Math.sin(g.h), fy = Math.cos(g.h);                 // forward unit vector (x east, y north)
    const s0 = x0 * fx + y0 * fy, s1 = x1 * fx + y1 * fy;         // signed distance along the direction of travel
    if (!(s0 < 0 && s1 >= 0)) return null;
    const f = -s0 / (s1 - s0), lx = x0 + f * (x1 - x0), ly = y0 + f * (y1 - y0);
    return Math.abs(lx * fy - ly * fx) <= HALF_WIDTH_M ? f : null;   // within the gate's width
  }

  function createLapTimer(start) {
    const sf = gate(start.lat, start.lon, start.headingDeg);
    let prev = null, lapStart = null, lapDist = 0, path = [], sectors = null, sectorMarks = [], best = null;
    const laps = [];
    const at = (p, q, f) => ({ lat: p.lat + f * (q.lat - p.lat), lon: p.lon + f * (q.lon - p.lon), t: p.t + f * (q.t - p.t) });
    const metres = (p, q) => Math.hypot(...xy(p, q));
    /** The live delta: this lap's time at this distance minus your best lap's (s, + = slower); null without a best. */
    function deltaNow(t) {
      if (!best || lapStart == null) return null;
      const d = lapDist, bp = best.path;
      if (d > bp[bp.length - 1].d) return null;
      let k = 1; while (k < bp.length && bp[k].d < d) k++;
      const a = bp[k - 1], b = bp[Math.min(k, bp.length - 1)], f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
      return Math.round(((t - lapStart) / 1000 - (a.s + f * (b.s - a.s))) * 100) / 100;
    }
    return {
      /** One fix { lat, lon, t (ms) }; returns { lap } when a lap ends, else null. */
      feed(fr) {
        if (!fr || !Number.isFinite(fr.lat) || !Number.isFinite(fr.lon) || !Number.isFinite(fr.t)) return null;
        const p = { lat: fr.lat, lon: fr.lon, t: fr.t };
        let out = null;
        if (prev) {
          const f = crossing(sf, prev, p);
          if (f != null) {
            const x = at(prev, p, f);
            if (lapStart != null && (x.t - lapStart) / 1000 >= MIN_LAP_S) {
              lapDist += metres(prev, x);
              path.push({ d: lapDist, s: (x.t - lapStart) / 1000, lat: x.lat, lon: x.lon });
              const lap = { n: laps.length + 1, timeS: Math.round((x.t - lapStart) / 10) / 100, sectors: null };
              if (sectors && sectorMarks.length === 2) {
                const s1 = sectorMarks[0], s2 = sectorMarks[1] - sectorMarks[0], s3 = lap.timeS - sectorMarks[1];
                lap.sectors = [s1, s2, s3].map((v) => Math.round(v * 100) / 100);
              }
              laps.push(lap); out = { lap };
              if (!best || lap.timeS < best.timeS) best = { timeS: lap.timeS, path: path.slice() };
              if (!sectors) {   // the first full lap places the sector lines at a third and two thirds of its length
                sectors = [1 / 3, 2 / 3].map((share) => {
                  const d = share * lapDist; let k = 1; while (k < path.length && path[k].d < d) k++;
                  const a = path[k - 1], b = path[Math.min(k, path.length - 1)];
                  const [dx, dy] = xy(a, b);
                  return gate(a.lat, a.lon, Math.atan2(dx, dy) * 180 / Math.PI);
                });
              }
            } else if (lapStart != null) { prev = p; return null; }   // a wobble over the line, not a lap
            lapStart = x.t; lapDist = metres(x, p); path = [{ d: 0, s: 0, lat: x.lat, lon: x.lon }]; sectorMarks = [];
            path.push({ d: lapDist, s: (p.t - lapStart) / 1000, lat: p.lat, lon: p.lon });
            prev = p;
            return out;
          }
          if (lapStart != null) {
            if (sectors && sectorMarks.length < 2) {
              const g = sectors[sectorMarks.length], fs = crossing(g, prev, p);
              if (fs != null) sectorMarks.push(Math.round((at(prev, p, fs).t - lapStart) / 10) / 100);
            }
            lapDist += metres(prev, p);
            path.push({ d: lapDist, s: (p.t - lapStart) / 1000, lat: p.lat, lon: p.lon });
          }
        }
        prev = p;
        return out;
      },
      state(t) {
        const bestLap = laps.reduce((m, l) => (!m || l.timeS < m.timeS ? l : m), null);
        return { laps: laps.slice(), last: laps[laps.length - 1] || null, best: bestLap, running: lapStart != null,
                 elapsedS: lapStart != null && Number.isFinite(t) ? Math.round((t - lapStart) / 100) / 10 : null, delta: Number.isFinite(t) ? deltaNow(t) : null };
      },
    };
  }

  /** "1:34.27" */
  const lapText = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}` : '--');

  const api = { onRaceway, createLapTimer, lapText, crossing, gate, MIN_LAP_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTrackMode = api;
})(typeof window !== 'undefined' ? window : globalThis);
