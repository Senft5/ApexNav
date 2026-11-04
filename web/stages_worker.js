// Stage discovery off the main thread (web/stages.js discoverAsync): decoding the map's vector tiles and scoring every
// road stroke took 2-4 s of the page's main thread on a plan (live, 2026-11-04), while the first route was being drawn
// and the route context was decoding its own tiles. Messages: { id, c, radiusKm, opts } -> { id, stages } or { id, error }.
// No saved offline tiles here (offline_tiles.js lives in the page): with no network the page discovers itself.
/* global importScripts, ApexStages */
importScripts('apex_core.js', 'route_loading.js', 'stages.js');
self.onmessage = async (e) => {
  const { id, c, radiusKm, opts } = e.data || {};
  try {
    self.postMessage({ id, stages: await ApexStages.discover(c, radiusKm, null, opts || {}) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
