// Spoken coaching on roads you have driven before: what the corner coach found the last time you drove each corner,
// said once as you approach it on a live drive. Pure; the cockpit (index.html) decides when it may speak.
//
// Only the coach's judgement of a pass on its own is spoken (still braking past the apex, coasting between brake and
// throttle, an early apex). Anything measured against a faster pass ("carry more speed", "brake later", "throttle
// sooner", "less coasting than your best") stays on the analysis page: a voice urging more speed on a public road is
// not coaching. The most recent drive of a corner decides: if you fixed it last time, nothing is said.
(function (root) {
  const SAME_CORNER_M = 30;      // two drives' apexes this close, in the same direction, are the same corner
  const AHEAD_COS = 0.75;        // the corner must be within ~40 degrees of the course to count as ahead
  const SAME_WAY_COS = 0.7;      // and driven the way you are going
  const SPOKEN = {
    brake_after_apex: 'Last time, braking past the apex. Brake earlier.',
    coast: 'Last time, coasting here. Brake, then throttle.',
    early_apex: 'Last time, an early apex. Turn in later.',
  };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const xy = (lat0, lon0, lat, lon) => [(lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * 110540];
  const unit = ([x, y]) => { const n = Math.hypot(x, y); return n > 0 ? [x / n, y / n] : null; };
  const heading = (d, i) => { const a = Math.max(0, i - 2), b = Math.min(d.lat.length - 1, i + 2); return unit(xy(d.lat[a], d.lon[a], d.lat[b], d.lon[b])); };
  const box = (d) => { let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity; for (let i = 0; i < d.lat.length; i++) { s = Math.min(s, d.lat[i]); n = Math.max(n, d.lat[i]); w = Math.min(w, d.lon[i]); e = Math.max(e, d.lon[i]); } return [s, n, w, e]; };

  /**
   * Coaching notes from your recordings (ApexRecording records, any order): [{ id, lat, lon, hx, hy, kind, text, date }].
   * cornersOf(d) gives a record's corners in Core.coach's shape. max bounds the work to your newest drives.
   */
  function build(Core, records, cornersOf, { max = 12 } = {}) {
    const recs = records.filter((d) => d && d.lat && d.lat.length > 4 && d.speed_mps && d.lon_g && d.lat_g)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, max)
      .map((d) => ({ ...d, corners: cornersOf(d) }));
    const boxes = new Map(recs.map((d) => [d, box(d)]));
    const claimed = [], notes = [];
    for (const d of recs) {                                                   // newest first: the latest pass of a corner decides
      if (!d.corners.length) continue;
      const b = boxes.get(d);
      const others = recs.filter((o) => { if (o === d) return false; const c = boxes.get(o); return c[0] <= b[1] && c[1] >= b[0] && c[2] <= b[3] && c[3] >= b[2]; });
      const res = Core.coach(d, others);
      res.corners.forEach((c) => {
        if (!c.m) return;                                                     // unmeasured here: says nothing, and claims nothing
        const i = c.apex, h = heading(d, i);
        if (!h) return;
        if (claimed.some((p) => Math.hypot(...xy(p.lat, p.lon, d.lat[i], d.lon[i])) < SAME_CORNER_M && p.h[0] * h[0] + p.h[1] * h[1] > 0)) return;
        claimed.push({ lat: d.lat[i], lon: d.lon[i], h });
        const text = c.tip && c.tip.vs_best === false && SPOKEN[c.tip.kind];
        if (text) notes.push({ id: `${d.id}:${i}`, lat: d.lat[i], lon: d.lon[i], hx: h[0], hy: h[1], kind: c.tip.kind, text, date: d.date || null });
      });
    }
    return notes;
  }

  /**
   * Bumps your own drives confirmed (ApexRecording.corroborate: found on two or more of your passes, same direction),
   * as notes for `upcoming` on any road, route or not (IDEAS Q-22). One per spot and direction, keeping the hardest hit
   * your drives measured there (severity_g, the spike in g) so quiet mode can skip the mild ones as it does on a route.
   */
  function hazards(records) {
    const out = [];
    for (const d of records) {
      for (const e of d.events || []) {
        if (e.type !== 'bump' || !e.seen || e.seen.hits < 2 || !finite(e.lat) || !finite(e.lon)) continue;
        const h = heading(d, e.index);
        if (!h) continue;
        const dup = out.find((n) => Math.hypot(...xy(n.lat, n.lon, e.lat, e.lon)) < SAME_CORNER_M && n.hx * h[0] + n.hy * h[1] > 0);
        if (dup) { if (finite(e.severity_g) && !(dup.severity_g >= e.severity_g)) dup.severity_g = e.severity_g; continue; }
        out.push({ id: `hz:${d.id}:${e.index}`, lat: e.lat, lon: e.lon, hx: h[0], hy: h[1], kind: 'bump', text: 'Bump ahead', seen: e.seen,
                   severity_g: finite(e.severity_g) ? e.severity_g : null });
      }
    }
    return out;
  }

  /**
   * The note to say now, or null: the nearest one between minM and maxM straight ahead (within ~40 degrees of the
   * course), driven the same way, and not in `said`. frame: { lat, lon, course_deg } (compass degrees).
   */
  function upcoming(notes, frame, minM, maxM, said) {
    if (!notes.length || !frame || !finite(frame.lat) || !finite(frame.lon) || !finite(frame.course_deg)) return null;
    const c = frame.course_deg * Math.PI / 180, fwd = [Math.sin(c), Math.cos(c)];
    let best = null, bestD = Infinity;
    for (const n of notes) {
      if (said && said.has(n.id)) continue;
      const v = xy(frame.lat, frame.lon, n.lat, n.lon), d = Math.hypot(...v);
      if (d < minM || d > maxM || d >= bestD) continue;
      if (v[0] * fwd[0] + v[1] * fwd[1] < AHEAD_COS * d) continue;
      if (n.hx * fwd[0] + n.hy * fwd[1] < SAME_WAY_COS) continue;
      best = n; bestD = d;
    }
    return best;
  }

  // A break, suggested on a long live drive (IDEAS D-16). The clock is wall time since the drive started or since the last
  // stop of STOP_RESETS_S or more (a fuel stop is shorter and does not count). After an hour, every BREAK_CHECK_S, the driving
  // since then is read with Core.fatigue; a fade in steering or braking is the cue, else two hours on the road. At most every
  // 45 min, and each kind is spoken once per stretch (shown each time).
  const STOP_RESETS_S = 15 * 60, BREAK_MIN_S = 3600, BREAK_CHECK_S = 10 * 60, BREAK_AFTER_S = 2 * 3600, BREAK_REPEAT_S = 45 * 60;
  const HOURS = ['', 'an hour', 'two hours', 'three hours', 'four hours', 'five hours'];
  /**
   * The rest clock, per live frame. w: the previous state (null at the start of a drive); rows: the recorder's row count.
   * Returns [w, due]: due when the driving since the stop should be read now.
   */
  function restTick(w, nowMs, moving, rows) {
    w = w || { since: nowMs, lastMove: nowMs, row0: 0, checked: 0, said: null, spoken: [] };
    if (!moving) return [w, false];
    if (nowMs - w.lastMove >= STOP_RESETS_S * 1000) { w.since = nowMs; w.row0 = rows; w.checked = 0; w.said = null; w.spoken = []; }
    w.lastMove = nowMs;
    const due = nowMs - w.since >= BREAK_MIN_S * 1000 && nowMs - w.checked >= BREAK_CHECK_S * 1000;
    if (due) w.checked = nowMs;
    return [w, due];
  }
  /** Recorder rows since the stop with distances from 0, so the profiler's corner indexes point into the slice. */
  const rebase = (rows) => rows.map((x, i) => ({ ...x, distance_m: i * 5 }));
  /**
   * { kind, text } to suggest now, or null. fa: Core.fatigue over the stretch since the stop (null when too short to judge);
   * sinceStopS: wall time since the stop or the start; sinceSaidS: since the last cue, null if none this stretch.
   */
  function breakCue(fa, sinceStopS, sinceSaidS) {
    if (finite(sinceSaidS) && sinceSaidS < BREAK_REPEAT_S) return null;
    const cues = (fa && fa.cues) || [];
    if (cues.includes('steering')) return { kind: 'steering', text: 'Your steering is getting busier than earlier. Time for a break?' };
    if (cues.includes('braking')) return { kind: 'braking', text: 'More braking past the apex than earlier. Time for a break?' };
    if (finite(sinceStopS) && sinceStopS >= BREAK_AFTER_S) {
      const h = Math.floor(sinceStopS / 3600);
      return { kind: 'time', text: `You've been on the road ${HOURS[h] || `${h} hours`}. Time for a break?` };
    }
    return null;
  }

  const api = { build, upcoming, hazards, breakCue, restTick, rebase, SPOKEN, STOP_RESETS_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadMemory = api;
})(typeof window !== 'undefined' ? window : globalThis);
