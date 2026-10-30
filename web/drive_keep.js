// A drive is kept as it goes (Round 3, the owner's drive to work, 2026-10-30: "I drove to work today with the map running
// started on carplay and the drive isn't in my log"). A recording lived only in the page's memory until End, so a drive
// never ended (the car switched off, the phone in a pocket) or a page the phone closed in the background left nothing.
// Now:
//   - the recording is checkpointed to IndexedDB every CHECK_S seconds or CHECK_M metres (recording.js keep*), only the
//     rows that are new each time, and the app's shell keeps every fix since the last checkpoint in a journal on disk
//     (ApexKit DriveJournal), so a drive is never more than the shell's journal away from whole;
//   - a drive ends and saves itself when the car disconnects and does not drive on (CAR_GONE_MS), or after a long stop
//     with no car screen (PARK_MS without driving speed), cut back to the last moment it was driven: the walk from the
//     car is not road;
//   - a drive the page never ended (the app or the page was closed) is rebuilt on the next launch from its checkpoint
//     and the journal, and saved to the Log with a note that it was recovered.
// Nothing is filled in: a gap in the fixes stays a gap (CLAUDE.md rule 3); frames are only ever the ones measured.
// Pure (no storage, no DOM): tests/test_drive_keep.py runs it in node.
(function (root) {
  const Sensors = root.ApexSensors || (typeof require === 'function' ? require('./sensors.js') : null);
  const CHECK_S = 15, CHECK_M = 250;          // a checkpoint at most this old, or this far back down the road
  const DRIVING_MPS = 2.5;                    // 9 km/h: faster than a walk, so a phone carried from the car is not driving
  const PARK_MS = 10 * 60_000;                // stopped this long after driving, with no car screen: parked, the drive is over
  const CAR_GONE_MS = 20_000;                 // the car's screen went and the car has not driven on: switched off
  const MIN_KM = 0.3, MIN_SAMPLES = 60;       // what End keeps (leaveDrive): shorter is a test of the button, not a drive
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Where the last checkpoint left off: when, how many samples were in it, how far, how many chunks. */
  const fresh = (now) => ({ at: now, rows: 0, dist: 0, n: 0 });

  /** Is a checkpoint due? Only when there is something new to keep. */
  function due(k, rec, now) {
    if (!rec || rec.samples <= k.rows) return false;
    return now - k.at >= CHECK_S * 1000 || rec.dist - k.dist >= CHECK_M;
  }

  /**
   * The next checkpoint: a head (the recorder's state, the last frame it took, what the drive is) and a chunk of the rows
   * since the last one. The chunk starts one row back: the next fix can still place a spike on the last row written.
   */
  function checkpoint(id, rec, k, meta, seq, now) {
    const from = Math.max(0, k.rows - 1), snap = rec.snapshot(from);
    const { rows, ...state } = snap;
    const head = { id, savedAt: now, startedAt: rec.startedAt, seq: finite(seq) ? seq : null, chunks: k.n + 1, state, meta: meta || {} };
    const chunk = { id, n: k.n, from, rows };
    return { head, chunk, next: { at: now, rows: rec.samples, dist: rec.dist, n: k.n + 1 } };
  }

  /** The rows a head's chunks hold, each placed at its own index (a later chunk rewrites the row it overlaps). */
  function assemble(head, chunks) {
    const rows = [];
    (chunks || []).slice().sort((a, b) => a.n - b.n).forEach((c) => { (c.rows || []).forEach((r, i) => { rows[c.from + i] = r; }); });
    const n = head && head.state && Number.isInteger(head.state.n) ? head.state.n : rows.length;
    rows.length = Math.min(rows.length, n);
    for (let i = 0; i < rows.length; i++) if (!rows[i]) { rows.length = i; break; }   // a missing chunk: keep what is whole
    return rows;
  }

  /**
   * A drive rebuilt from what was kept: the checkpoint (or none: the page closed before the first) and then the shell's
   * journal frames it had not yet taken (seq after the checkpoint's), watched as the page watches them: a drive that was
   * over while nobody was looking (parked and walked away from, the page asleep) ends where the car last drove.
   * Returns { rec, watch, end } (end as EndWatch.feed's, or null).
   */
  function rebuild(head, chunks, frames) {
    const rec = head && head.state ? Sensors.Recorder.restore(head.state, assemble(head, chunks)) : new Sensors.Recorder();
    if (head && head.state && rec.samples < head.state.n) rec.prev = null;   // rows lost: what follows starts a new stretch
    const watch = EndWatch.restore(head && head.meta ? head.meta.watch : null);
    const after = head && finite(head.seq) ? head.seq : -Infinity;
    const later = (frames || []).filter((f) => f && f.has_fix && (!finite(f.seq) || f.seq > after));
    if (!rec.startedAt && later.length && finite(later[0].at)) rec.startedAt = later[0].at;
    let end = null;
    for (const f of later) {
      rec.add(f);
      end = watch.feed(f, rec.samples, f.at);
      if (end) { rec.truncate(end.rows); break; }
    }
    if (head && finite(head.startedAt)) rec.startedAt = head.startedAt;
    return { rec, watch, end };
  }

  /** Long enough to be a drive (the same bar End sets). */
  const keepable = (rec) => !!rec && rec.km >= MIN_KM && rec.samples >= MIN_SAMPLES;

  /**
   * When a drive is over without End. Fed each recorded frame (its time `at`, ms, and the samples recorded so far):
   * returns null, or { why: 'car' | 'parked', rows } where rows is the samples as they stood when the car last drove.
   * While the car's screen is connected the car is on, so a stop is a queue, never parking: the drive ends when the car
   * disconnects and does not drive on (CAR_GONE_MS). Without a car screen, after PARK_MS stopped. A drive that never
   * moved is never ended here (waiting for a passenger is not parking).
   */
  class EndWatch {
    constructor() { this.movedAt = null; this.movedRows = 0; this.car = false; this.carGoneAt = null; this.lastAt = null; }
    /** What a checkpoint keeps of it (the car's screen is not kept: after a relaunch nobody knows it is there). */
    state() { return { movedAt: this.movedAt, movedRows: this.movedRows, carGoneAt: this.carGoneAt }; }
    static restore(s) {
      const w = new EndWatch();
      if (s && typeof s === 'object') { w.movedAt = finite(s.movedAt) ? s.movedAt : null; w.movedRows = finite(s.movedRows) ? s.movedRows : 0; w.carGoneAt = finite(s.carGoneAt) ? s.carGoneAt : null; }
      return w;
    }
    /** The car's screen connected (true) or went (false) at `at` (ms). */
    carScreen(on, at) {
      this.car = !!on;
      this.carGoneAt = on ? null : finite(at) ? at : this.lastAt;
    }
    feed(fr, samples, at) {
      if (!finite(at)) return null;
      this.lastAt = at;
      if (fr && finite(fr.speed_mps) && fr.speed_mps >= DRIVING_MPS) { this.movedAt = at; this.movedRows = samples; return null; }
      if (this.movedAt == null || this.car) return null;
      // the car went and has not driven since (a CarPlay drop at speed reconnects, or the drive carries on on the phone)
      if (this.carGoneAt != null && this.movedAt <= this.carGoneAt && at - this.carGoneAt >= CAR_GONE_MS) return { why: 'car', rows: this.movedRows };
      if (at - this.movedAt >= PARK_MS) return { why: 'parked', rows: this.movedRows };
      return null;
    }
  }

  /** The Log's honest line for a drive that was not ended with End (null for one that was). */
  function endNote(d) {
    if (!d || !d.ended) return null;
    if (d.ended === 'recovered') return 'Recovered: the app closed before the drive was ended';
    if (d.ended === 'car') return 'Ended when the car disconnected';
    if (d.ended === 'parked') return 'Ended when the car was parked';
    return null;
  }

  const api = { CHECK_S, CHECK_M, DRIVING_MPS, PARK_MS, CAR_GONE_MS, MIN_KM, MIN_SAMPLES, fresh, due, checkpoint, assemble, rebuild, keepable, EndWatch, endNote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveKeep = api;
})(typeof window !== 'undefined' ? window : globalThis);
