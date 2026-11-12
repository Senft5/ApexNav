// The best run, live (IDEAS D-30, part four): while you drive, the co-driver counts corners driven smooth and settled in a
// row and says it at five, at ten and every ten after ("Five clean in a row."). The same rule as the drive page's best run
// (flow.js, the Driver Score's own cornerTechnique), on the live 5 m rows: each corner is found in a trailing window of the
// road just driven (ApexCore.profileRecording) and judged once, a little after it ends. A miss, a corner that can't be
// judged (no g, a speed gap) or more than GAP_M between apexes starts the count again. Technique, never speed or time.
// Pure over ApexCore and ApexFlow (tests/test_flow_live.py); the cockpit says the words in its quiet slot.
(function (root) {
  'use strict';
  const WINDOW = 240, EDGE = 3, PAST = 6, STEP = 8, MPH = 2.2369362920544;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const words = (n) => (n < 20 ? WORDS[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? `-${WORDS[n % 10]}` : '') : String(n));

  /** Is a run of n worth saying? At 5, 10, 20, 30... (a call every corner would be noise). */
  const milestone = (n) => n === 5 || (n >= 10 && n % 10 === 0);
  /** The words for a run of n: "Five clean in a row." */
  const text = (n) => { const w = words(n); return `${w[0].toUpperCase()}${w.slice(1)} clean in a row.`; };

  /**
   * A watcher over the live rows ({distance_m, lat, lon, speed_mps, lat_g, lon_g}, 5 m apart, as ApexSensors.Recorder keeps
   * them). update(rows) returns { run, say } when a corner was judged ("say": the words when the run reached a milestone,
   * else null) or null when nothing new was judged. opts.mu: the car's grip (ApexCore.carGrip), as the saved drive is scored.
   */
  function createWatch(Core, Flow, opts = {}) {
    let judgedEnd = -1, lastAt = null, run = 0, seen = 0;
    const mu = finite(opts.mu) ? opts.mu : null;
    return {
      get run() { return run; },
      update(rows) {
        const n = rows ? rows.length : 0;
        if (n < 40 || n - seen < STEP) return null;
        seen = n;
        const off = Math.max(0, n - WINDOW), w = rows.slice(off), m = w.length;
        const num = (k) => w.map((r) => (r && finite(r[k]) ? r[k] : NaN));
        const lat = num('lat'), lon = num('lon');
        if (!lat.every(finite) || !lon.every(finite)) return null;     // a row without a fix: no window to read
        const V = num('speed_mps'), LO = num('lon_g'), LA = num('lat_g'), D = num('distance_m');
        let ev;
        try {
          ev = Core.profileRecording({ lat, lon, distance_m: w.map((_, i) => i * 5), speed_mph: V.map((v) => v * MPH), lon_g: LO, lat_g: LA }).events;
        } catch (_) { return null; }
        let corners = ev.filter((e) => e.type === 'corner').map((e) => ({ start: Math.round(e.start_m / 5), end: Math.round(e.end_m / 5), apex: e.index, apex_mps: e.apex_mph / MPH }))
          .filter((c) => c.start >= (off ? EDGE : 0) && c.end <= m - 1 - PAST && off + c.start > judgedEnd && c.start <= c.apex && c.apex <= c.end)
          .sort((a, b) => a.apex - b.apex);
        if (mu != null && Core.cornersForCar) corners = Core.cornersForCar(corners, mu);
        if (!corners.length) return null;
        let say = null;
        for (const c of corners) {
          const at = finite(D[c.apex]) ? D[c.apex] : (off + c.apex) * 5;
          if (lastAt != null && at - lastAt > Flow.GAP_M) run = 0;
          let t = null;
          try { t = Core.cornerTechnique(V, LO, LA, c); } catch (_) { t = null; }
          run = Flow.inFlow(t) ? run + 1 : 0;
          if (run && milestone(run)) say = text(run);
          judgedEnd = off + c.end; lastAt = at;   // the same corner found again a row over in a later window is past this
        }
        return { run, say };
      },
    };
  }

  const api = { createWatch, milestone, text, WINDOW, PAST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFlowLive = api;
})(typeof window !== 'undefined' ? window : globalThis);
