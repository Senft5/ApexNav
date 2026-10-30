// Route analysis off the main thread (IDEAS P-05): curvature, sight distance, braking envelope and corners for a resampled
// route, the same apex_core.js calls trackFromPolyline made inline. Messages: { id, lat, lon, offsets } → { id, ...result }.
// REVIEW_FEEL F-04 / F-06: and the drive jobs of analysis_client.js (save at End, the Log's summaries, coach, compare,
// stages, steadiness, the cockpit's road memory): { id, job, args } → { id, ...result }. They read and write IndexedDB
// here, so a drive's rows never cross to the page.
/* global importScripts, ApexCore, ApexAnalysis */
importScripts('apex_core.js', 'format.js', 'sensors.js', 'recording.js', 'road_memory.js', 'drive_card.js', 'stage_delta.js', 'prefer.js', 'analysis_client.js');
self.onmessage = async (e) => {
  const { id, job, args, lat, lon, offsets, side } = e.data || {};
  try {
    if (job) self.postMessage({ ...(await ApexAnalysis.jobs[job](args || {})), id });   // the message's id last: it always wins
    else self.postMessage({ id, ...ApexAnalysis_run(ApexCore, lat, lon, offsets, side || null) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
// Kept in step with analysis_client.js runInline (tests/test_analysis_worker.py checks they give the same answer).
function ApexAnalysis_run(Core, lat, lon, offsets, side) {
  const { kappa, ds } = Core.computeCurvature(lat, lon);
  const sight = Core.sightDistanceM(lat, lon, null, offsets || undefined, side);
  const env = Core.brakingEnvelopeMps(kappa, ds, null, null, undefined, sight);
  const corners = Core.annotateCautions(Core.detectCorners(kappa, ds), env, sight);
  return { kappa, ds, sight, env, corners };
}
