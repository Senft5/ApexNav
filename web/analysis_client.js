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

  function getWorker() {
    if (broken || typeof root.Worker !== 'function') return null;
    if (worker) return worker;
    try {
      worker = new root.Worker('analysis_worker.js');
      worker.onmessage = (e) => { const w = waiting.get(e.data && e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
      worker.onerror = () => { broken = true; for (const w of waiting.values()) w({ error: 'worker failed' }); waiting.clear(); try { worker.terminate(); } catch (_) {} worker = null; };
    } catch (_) { broken = true; worker = null; }
    return worker;
  }

  /**
   * { kappa, ds, sight, env, corners } for a resampled route (arrays of lat/lon at 5 m); offsets: per-sample sight offsets or
   * null; opts.side: 'right' | 'left' driving side for sight distance (IDEAS U-22), or null.
   */
  async function analyse(lat, lon, offsets, opts = {}) {
    const Core = opts.Core || root.ApexCore;
    const w = opts.inline ? null : getWorker();
    if (!w) { stats.inline++; return runInline(Core, lat, lon, offsets, opts.side || null); }
    const id = ++seq;
    const answer = await new Promise((done) => {
      waiting.set(id, done);
      setTimeout(() => { if (waiting.delete(id)) done({ error: 'timeout' }); }, opts.timeoutMs || 15000);
      try { w.postMessage({ id, lat: Float64Array.from(lat), lon: Float64Array.from(lon), offsets: offsets ? Float64Array.from(offsets) : null, side: opts.side || null }); }
      catch (e) { waiting.delete(id); done({ error: String(e) }); }
    });
    if (answer.error) { stats.inline++; return runInline(Core, lat, lon, offsets, opts.side || null); }
    stats.worker++;
    const { id: _, ...out } = answer;
    return out;
  }

  const api = { analyse, runInline, stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
