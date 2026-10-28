// Route analysis off the main thread (IDEAS P-05): curvature, sight distance, braking envelope and corners for a resampled
// route, the same apex_core.js calls trackFromPolyline made inline. Messages: { id, lat, lon, offsets } → { id, ...result }.
/* global importScripts, ApexCore */
importScripts('apex_core.js');
self.onmessage = (e) => {
  const { id, lat, lon, offsets } = e.data || {};
  try {
    self.postMessage({ id, ...ApexAnalysis_run(ApexCore, lat, lon, offsets) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
// Kept in step with analysis_client.js runInline (tests/test_analysis_worker.py checks they give the same answer).
function ApexAnalysis_run(Core, lat, lon, offsets) {
  const { kappa, ds } = Core.computeCurvature(lat, lon);
  const sight = Core.sightDistanceM(lat, lon, null, offsets || undefined);
  const env = Core.brakingEnvelopeMps(kappa, ds, null, null, undefined, sight);
  const corners = Core.annotateCautions(Core.detectCorners(kappa, ds), env, sight);
  return { kappa, ds, sight, env, corners };
}
