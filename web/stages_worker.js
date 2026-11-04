// Stage discovery off the main thread (web/stages.js discoverAsync): decoding the map's vector tiles and scoring every
// road stroke took 2-4 s of the page's main thread on a plan (live, 2026-11-04), while the first route was being drawn
// and the route context was decoding its own tiles. Messages: { id, c, radiusKm, opts } -> { id, stages } or { id, error }.
// No saved offline tiles here (offline_tiles.js lives in the page): with no network the page discovers itself.
/* global importScripts, ApexStages */
importScripts('apex_core.js', 'route_loading.js', 'stages.js');
// answers kept here DISCOVER_KEEP_MS per area and highlights, for re-plans (each answer is posted, so the page gets its own copy)
const kept = new Map();
self.onmessage = async (e) => {
  const { id, c, radiusKm, opts } = e.data || {};
  try {
    const key = ApexStages.discoverKey(c, radiusKm, opts || {}), had = kept.get(key);
    let stages;
    if (had && Date.now() - had.at < ApexStages.DISCOVER_KEEP_MS) stages = await had.p;
    else {
      const p = ApexStages.discover(c, radiusKm, null, opts || {});
      kept.set(key, { at: Date.now(), p });
      p.catch(() => kept.delete(key));
      stages = await p;
    }
    self.postMessage({ id, stages });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
