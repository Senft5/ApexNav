// Route analysis in a Web Worker (IDEAS P-05): scoring a long route (sight distance alone is ~0.1 s per 100 km on a laptop,
// several times that on a phone) no longer freezes the map or the voice. No worker, an error or a slow answer (15 s): the
// same calls run here instead, so the result never depends on where it ran.
(function (root) {
  'use strict';
  let worker = null, broken = false, seq = 0;
  const stats = { worker: 0, inline: 0 };                // where analyses ran (e2e checks the worker is used)
  const waiting = new Map();

  function runInline(Core, lat, lon, offsets, side = null) {
    const { kappa, ds } = Core.computeCurvature(lat, lon);
    const sight = Core.sightDistanceM(lat, lon, null, offsets || undefined, side);
    const env = Core.brakingEnvelopeMps(kappa, ds, null, null, undefined, sight);
    const corners = Core.annotateCautions(Core.detectCorners(kappa, ds), env, sight);
    return { kappa, ds, sight, env, corners };
  }

  // what each worker has in hand (its answers outstanding), and which worker each waiting id was sent to
  const load = new Map(), sentTo = new Map();
  const answered = (e) => { const id = e.data && e.data.id, w = waiting.get(id); const to = sentTo.get(id); if (to) { load.set(to, Math.max(0, (load.get(to) || 1) - 1)); sentTo.delete(id); } if (w) { waiting.delete(id); w(e.data); } };
  const failAll = (wk) => { for (const [id, to] of [...sentTo]) if (to === wk) { sentTo.delete(id); const w = waiting.get(id); if (w) { waiting.delete(id); w({ error: 'worker failed' }); } } load.delete(wk); };
  function getWorker() {
    if (broken || typeof root.Worker !== 'function') return null;
    if (worker) return worker;
    try {
      worker = new root.Worker('analysis_worker.js');
      worker.onmessage = answered;
      worker.onerror = () => { broken = true; const w0 = worker; for (const w of waiting.values()) w({ error: 'worker failed' }); waiting.clear(); sentTo.clear(); load.clear(); try { w0.terminate(); } catch (_) {} worker = null; };
    } catch (_) { broken = true; worker = null; }
    return worker;
  }
  // A second worker for routes only, when the first already has work in hand (a route built ahead that the ranking then
  // didn't pick, or a drive job at start): the plan's pick isn't queued behind it (live 2026-11-07: 0.1-0.25 s)
  let spare = null, spareBroken = false;
  function routeWorker() {
    const w = getWorker();
    if (!w || !(load.get(w) > 0)) return w;
    if (!spare && !spareBroken) {
      try {
        spare = new root.Worker('analysis_worker.js');
        spare.onmessage = answered;
        spare.onerror = () => { spareBroken = true; const s0 = spare; spare = null; failAll(s0); try { s0.terminate(); } catch (_) {} };
      } catch (_) { spareBroken = true; spare = null; }
    }
    return spare && (load.get(spare) || 0) < (load.get(w) || 0) ? spare : w;
  }
  /** Both workers started ahead of the first plan (a worker's start is its scripts: 0.2-0.3 s, live 2026-11-07). */
  function prewarm() {
    const w = getWorker();
    if (!w || spare || spareBroken || !((root.navigator && root.navigator.hardwareConcurrency) >= 4)) return !!w;
    try {
      spare = new root.Worker('analysis_worker.js');
      spare.onmessage = answered;
      spare.onerror = () => { spareBroken = true; const s0 = spare; spare = null; failAll(s0); try { s0.terminate(); } catch (_) {} };
    } catch (_) { spareBroken = true; spare = null; }
    return true;
  }
  function post(w, id, msg) { sentTo.set(id, w); load.set(w, (load.get(w) || 0) + 1); w.postMessage(msg); }

  /**
   * { kappa, ds, sight, env, corners } for a resampled route (arrays of lat/lon at 5 m); offsets: per-sample sight offsets or
   * null; opts.side: 'right' | 'left' driving side for sight distance (IDEAS U-22), or null.
   */
  async function analyse(lat, lon, offsets, opts = {}) {
    const Core = opts.Core || root.ApexCore;
    const w = opts.inline ? null : routeWorker();
    if (!w) { stats.inline++; return runInline(Core, lat, lon, offsets, opts.side || null); }
    const id = ++seq;
    const answer = await new Promise((done) => {
      waiting.set(id, done);
      setTimeout(() => { if (waiting.delete(id)) done({ error: 'timeout' }); }, opts.timeoutMs || 15000);
      try { post(w, id, { id, lat: Float64Array.from(lat), lon: Float64Array.from(lon), offsets: offsets ? Float64Array.from(offsets) : null, side: opts.side || null }); }
      catch (e) { waiting.delete(id); sentTo.delete(id); done({ error: String(e) }); }
    });
    if (answer.error) { stats.inline++; return runInline(Core, lat, lon, offsets, opts.side || null); }
    stats.worker++;
    const { id: _, ...out } = answer;
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // REVIEW_FEEL F-04 / F-06: the end card's and the Log's heavy work as jobs. A 57 km drive is 11,000 rows; parsing and
  // scoring it took 1.1 s of the page's thread at End, and the Log matched every drive against every other (nearestIndexWin)
  // before it showed a list. The same functions run in the worker (analysis_worker.js imports this file and reads
  // IndexedDB itself, so no drive's rows cross to the page) and here when there is no worker: a result never depends on
  // where it ran. Everything a job sends back is small: summaries, scores, the coach's corners, the compare's curve.
  // ---------------------------------------------------------------------------------------------------------------
  const Rec = () => root.ApexRecording, CoreOf = () => root.ApexCore;
  // A date is unknown when parse said so, or on an import stored before it could: those got the import time, the only
  // dates written with toISOString (seconds and a Z); a stamp in the file name or a drive recorded here has neither.
  const monthOf = (o) => (o.date_known === false || (o.date_known === undefined && o.source === 'imported' && /Z$/.test(o.date || ''))
    || !/^\d{4}-\d{2}/.test(o.date || '') ? null : o.date.slice(0, 7));
  const label = (d) => (root.ApexFormat ? root.ApexFormat.dateTime(d.date) : String(d.date || '--'));
  const nameOf = (n) => (root.ApexFormat ? root.ApexFormat.driveName(n) : n);
  const overlaps = (a, b) => !!(a && b && a[0] <= b[1] && a[1] >= b[0] && a[2] <= b[3] && a[3] >= b[2]);
  const lite = (d) => ({ id: d.id, name: d.name, date: d.date, date_known: d.date_known, source: d.source });

  // The drives a job works on, finished the way the Log finishes them (repaired, named, scored, corners for its car), kept
  // while jobs keep asking (a Log open asks several in a row) and let go of after IDLE_MS so the rows do not stay in memory.
  const IDLE_MS = 30000;
  const cache = { full: new Map(), timer: 0 };
  function release() { clearTimeout(cache.timer); cache.timer = setTimeout(() => cache.full.clear(), IDLE_MS); }
  function finish(Core, raw) {
    const d = Rec().repair(Core, raw), scored = Rec().scoreOf(Core, d);
    return { ...d, name: nameOf(d.name), corners: scored.corners, km: d.dist[d.dist.length - 1] / 1000, ds: scored.ds };
  }
  const stamp = (s) => (s ? `${s.n}|${s.date}|${s.len_m}` : null);
  async function full(id, sum) {
    const hit = cache.full.get(id);
    if (hit && (!sum || hit.sum === stamp(sum))) return hit.d;
    const raw = await Rec().get(id);
    const d = raw ? finish(CoreOf(), raw) : null;
    cache.full.set(id, { d, sum: stamp(sum) });
    return d;
  }
  const memo = { key: null, out: null };                         // the cockpit's road memory, until the library changes
  const fullAll = async (sums) => (await Promise.all(sums.map((s) => full(s.id, s)))).filter(Boolean);

  // the corner coach for d against every other drive whose box overlaps it (Core.coach decides what is the same corner)
  async function coachOf(Core, d, sums) {
    const me = sums.find((s) => s.id === d.id), nearS = sums.filter((s) => s.id !== d.id && overlaps(s.bbox, me && me.bbox));
    const near = await fullAll(nearS);
    return { co: { ...Core.coach(d, near), others: near.map((o) => ({ name: o.name, date: label(o) })), near: near.map(lite) }, near };
  }
  // U-111: the one coaching sentence a drive gets, the Log's (drive_view.js plainCoach over this drive's score and the coach's
  // corners against your other drives, as the drive job gives the Log), so the end card says the same words. null when the
  // drive is not stored, drive_view.js is not loaded here, or there is no score to coach from.
  async function coachLineOf(Core, id, sums) {
    const me = sums.find((s) => s.id === id), d = me ? await full(id, me) : null;
    if (!d || !root.ApexDriveView) return null;
    const { co } = await coachOf(Core, d, sums);
    return root.ApexDriveView.plainCoach(d.ds, co) || null;
  }

  const jobs = {
    /** Every drive's summary (missing ones built from the drive's rows first). */
    async summaries() { return { list: await Rec().summaries(CoreOf()) }; },

    /**
     * End (F-04): the recording as the recorder holds it, parsed, scored and stored here, with its summary; and your
     * earlier drives with the same name, by their summaries, for "your best on this road".
     */
    async save({ state, rows, fileName, meta, extra }) {
      const Core = CoreOf(), rec = root.ApexSensors.Recorder.restore(state, rows);
      const d = Object.assign(Rec().parse(Core, rec.toCsv(), fileName, meta), extra || {});
      const summary = (await Rec().store(d)) || Rec().summarize(Core, d);
      let card = null;                                                 // Share card's picture of it (drive_card.js), drawn on a tap
      try { const s = Rec().scoreOf(Core, d); card = root.ApexDriveCard ? root.ApexDriveCard.cardModel({ ...d, corners: s.corners, ds: s.ds }) : null; } catch (_) { card = null; }
      const sums = await Rec().summaries(Core);
      const others = sums.filter((o) => o.id !== d.id && o.name === d.name)
        .map((o) => ({ id: o.id, name: o.name, score: o.ds && o.ds.score != null ? Math.round(o.ds.score) : null }));
      let coach = null;                                                // U-111: the Log's sentence, written once, here
      try { coach = await coachLineOf(Core, d.id, sums); } catch (_) { coach = null; }
      release();
      return { driveId: d.id, summary, others, card, coach };   // (never `id`: the message's own)
    },

    /** U-111: a stored drive's coaching sentence, the Log's (coachLineOf); { coach: null } when there is none. */
    async coachLine({ id }) {
      const Core = CoreOf(), sums = await Rec().summaries(Core);
      let coach = null;
      try { coach = await coachLineOf(Core, id, sums); } catch (_) { coach = null; }
      release();
      return { coach };
    },

    /** A few fields of a stored drive (tags, a note, shared), its summary kept in step. */
    async patch({ id, fields }) { return { summary: await Rec().patch(id, fields) }; },

    /**
     * A drive's page: the reference (the best-scoring other drive sharing 30 % of the road and 3 corners), the corner
     * coach, and every scored drive sharing 30 % of the road, for its history on this road.
     */
    async drive({ id }) {
      const Core = CoreOf(), sums = await Rec().summaries(Core), me = sums.find((s) => s.id === id);
      const d = me ? await full(id, me) : null;
      if (!d) return { missing: true };
      const { co, near } = await coachOf(Core, d, sums);
      const len = d.dist[d.dist.length - 1], cmp = new Map();
      const compare = (o) => { if (!cmp.has(o.id)) cmp.set(o.id, Core.compareDrives(d, o)); return cmp.get(o.id); };
      let reference = null;
      for (const o of near.filter((x) => x.ds.score != null).sort((p, q) => q.ds.score - p.ds.score)) {
        const r = compare(o);
        if (r.overlap_m >= 0.3 * len && r.matched_corners >= 3) { reference = { id: o.id, name: o.name, score: o.ds.score, corners: r.corners }; break; }
      }
      const road = [d, ...near.filter((o) => o.ds.score != null && compare(o).overlap_m >= 0.3 * len)].sort((p, q) => (p.date < q.date ? -1 : 1))
        .map((o) => { const r = o === d ? null : compare(o);
          return { id: o.id, name: o.name, date: o.date, dateLabel: label(o), score: o.ds.score, corners: Array.isArray(o.corners) ? o.corners.length : null, self: o === d,   // RA-3: every corner, as the Log row counts
                   matched: r ? r.matched_corners : 0, delta_s: r ? r.corner_delta_s : null }; });
      release();
      return { reference, coach: co, road, bestOther: reference ? reference.id : (sums.find((s) => s.id !== id) || {}).id || null };
    },

    /** Corner by corner between two drives (Core.compareDrives). */
    async compare({ a, b }) {
      const sums = await Rec().summaries(CoreOf()), A = await full(a, sums.find((s) => s.id === a)), B = await full(b, sums.find((s) => s.id === b));
      release();
      return { r: A && B ? CoreOf().compareDrives(A, B) : null };
    },

    /** Every drive's pass over each stage ({ [seg id]: [{ id, p }] }); a drive whose box cannot hold both ends is skipped. */
    async passes({ segs }) {
      const Core = CoreOf(), sums = await Rec().summaries(Core), out = {}, PAD = 0.001;   // ~110 m: wider than the match radius
      const holds = (b, la, lo) => !!b && la >= b[0] - PAD && la <= b[1] + PAD && lo >= b[2] - PAD && lo <= b[3] + PAD;
      for (const seg of segs || []) {
        out[seg.id] = [];
        for (const s of sums) {
          if (!holds(s.bbox, seg.lat0, seg.lon0) || !holds(s.bbox, seg.lat1, seg.lon1)) continue;
          const d = await full(s.id, s), p = d && Core.segmentPass(seg, d);
          if (p) out[seg.id].push({ id: s.id, p });
        }
      }
      release();
      return { passes: out };
    },

    /**
     * Braking consistency by month (IDEAS D-07 trend): on corners driven five or more times in a month, how widely the
     * braking point spread inside that month (Core.spreadBy), the median over the month's corners. Every drive is a
     * reference in turn, newest first; a corner already counted for a month (from a newer reference, within 20 m, the same
     * way) is not counted again, so overlapping roads do not double it. Drives whose date is unknown are left out (monthOf).
     */
    async steadiness({ minCorners = 3 } = {}) {
      const Core = CoreOf(), sums = await Rec().summaries(Core), seen = [], sds = new Map();
      const queue = sums.filter((s) => s.corners && s.corners.length).sort((p, q) => (q.date || '').localeCompare(p.date || ''));
      for (const s of queue) {
        const d = await full(s.id, s);
        if (!d) continue;
        const { co } = await coachOf(Core, d, sums), by = Core.spreadBy(co, [monthOf(d), ...co.near.map(monthOf)]);
        for (const [k, xs] of Object.entries(by)) for (const [apex, sd] of xs) {
          const lat = d.lat[apex], lon = d.lon[apex], c = Math.cos(lat * Math.PI / 180);
          const a0 = Math.max(0, apex - 2), a1 = Math.min(d.lat.length - 1, apex + 2);
          const hx = (d.lon[a1] - d.lon[a0]) * c, hy = d.lat[a1] - d.lat[a0], hn = Math.hypot(hx, hy) || 1;
          // the same corner, the same way: apex within 20 m and heading within ~45 degrees (not the next bend of an S)
          if (seen.some((x) => x.k === k && Math.hypot((x.lon - lon) * 111320 * c, (x.lat - lat) * 110540) < 20 && (x.hx * hx + x.hy * hy) / hn > 0.7)) continue;
          seen.push({ k, lat, lon, hx: hx / hn, hy: hy / hn });
          sds.set(k, (sds.get(k) || []).concat([sd]));
        }
      }
      const med = (xs) => { const v = xs.slice().sort((p, q) => p - q), k = v.length >> 1; return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2; };
      release();
      return { key: sums.map((s) => s.id).join(','), months: [...sds.entries()].filter(([, xs]) => xs.length >= minCorners).sort((p, q) => p[0].localeCompare(q[0]))
        .map(([month, xs]) => ({ month, sd_m: med(xs), corners: xs.length })) };
    },

    /**
     * A drive's start (IDEAS D-05): the reference pass for each stage, your best-scoring pass over it among the drives
     * whose box holds both its ends (ApexStageDelta.reference), for the live delta. Read here, not at Start on the page.
     */
    async stageRefs({ segs }) {
      const Core = CoreOf(), SD = root.ApexStageDelta, sums = await Rec().summaries(Core), refs = [], PAD = 0.001;
      if (!SD) return { refs };
      const holds = (b, la, lo) => !!b && la >= b[0] - PAD && la <= b[1] + PAD && lo >= b[2] - PAD && lo <= b[3] + PAD;
      for (const seg of segs || []) {
        const ds = [];
        for (const s of sums) if (holds(s.bbox, seg.lat0, seg.lon0) && holds(s.bbox, seg.lat1, seg.lon1)) { const raw = await Rec().get(s.id); if (raw) ds.push(Rec().repair(Core, raw)); }
        const best = SD.best(ds.filter((d) => Array.isArray(d.events)).map((d) => SD.reference(Core, seg, d, Rec().scorableCorners(d, Rec().cornersOf(d)))));
        if (best) refs.push(best);
      }
      return { refs };
    },

    /** The map cells your own drives cover (ApexPrefer.grid, for routes that prefer roads you have not driven). */
    async drivenGrid() {
      const sums = await Rec().summaries(CoreOf()), lines = [];
      for (const s of sums) { const d = await Rec().get(s.id); if (d) lines.push({ lat: d.lat, lon: d.lon }); }
      return { cells: root.ApexPrefer ? [...root.ApexPrefer.grid(lines)] : [] };
    },

    /**
     * The cockpit's memory of your roads: the bumps your drives confirmed (spoken on any road) and what the coach found
     * the last time on each corner (ApexRoadMemory), from every saved drive; and one saved drive as a replay track when
     * asked (its hazards counted against the others, as the Log counts them).
     */
    async memory({ track: want } = {}) {
      const Core = CoreOf(), sums = await Rec().summaries(Core), key = sums.map(stamp).join(',') + '|' + sums.map((s) => s.id).join(',');
      if (memo.key === key && (!want || !sums.some((s) => s.id === want))) return { ...memo.out, track: null };   // nothing new
      const mine = Rec().corroborate((await Promise.all(sums.map((s) => Rec().get(s.id)))).filter(Boolean).map((d) => Rec().repair(Core, d)));
      const out = { ids: sums.map((s) => s.id), hazards: root.ApexRoadMemory ? root.ApexRoadMemory.hazards(mine) : [], roadMemory: [] };
      try { out.roadMemory = root.ApexRoadMemory ? root.ApexRoadMemory.build(Core, mine, Rec().cornersOf) : []; } catch (_) { out.roadMemory = []; }
      memo.key = key; memo.out = out;
      const t = want ? mine.find((d) => d.id === want) : null;
      // its Vetta Score as the Log has it (the summary's), for the finished replay's plate (U-110); null when unscored
      const sc = t ? ((sums.find((s) => s.id === t.id) || {}).ds || {}).score : null;
      return { ...out, track: t ? { ...Rec().toTrack(t), score: Number.isFinite(sc) ? Math.round(sc) : null } : null };
    },
  };

  // The page side of the jobs: in the worker when there is one; here when there is none, or it fails or is too slow.
  async function job(name, args = {}, opts = {}) {
    if (!jobs[name]) throw new Error('no job ' + name);
    const w = opts.inline || root.APEX_INLINE_JOBS ? null : getWorker();
    if (w) {
      const id = ++seq;
      const answer = await new Promise((done) => {
        waiting.set(id, done);
        setTimeout(() => { if (waiting.delete(id)) done({ error: 'timeout' }); }, opts.timeoutMs || 60000);
        try { post(w, id, { id, job: name, args }); } catch (e) { waiting.delete(id); sentTo.delete(id); done({ error: String(e) }); }
      });
      if (!answer.error) { stats.jobs[name] = (stats.jobs[name] || 0) + 1; const { id: _, ...out } = answer; return out; }
    }
    stats.inlineJobs[name] = (stats.inlineJobs[name] || 0) + 1;
    return jobs[name](args);
  }
  stats.jobs = {}; stats.inlineJobs = {};

  const api = { analyse, prewarm, runInline, stats, job, jobs, monthOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
