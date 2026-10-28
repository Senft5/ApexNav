// Live break cue (IDEAS D-16) off the main thread: profiles the driving since the last stop and reads Core.fatigue from it,
// so the map and the pace-note timing never stall. In: { id, rows } (Recorder rows, rebased to start at 0 m). Out: { id, fa }.
importScripts('apex_core.js', 'sensors.js', 'recording.js');
self.onmessage = (e) => {
  const { id, rows } = e.data || {};
  let fa = null;
  try {
    const d = ApexRecording.parse(ApexCore, ApexSensors.Recorder.prototype.toCsv.call({ rows }), 'live.csv', {});
    fa = ApexCore.fatigue(d.speed_mps, d.lon_g, d.lat_g, ApexRecording.cornersOf(d), d.g_known);
  } catch (_) { fa = null; }                                           // unknown stays unknown: the time-based cue still works
  self.postMessage({ id, fa });
};
