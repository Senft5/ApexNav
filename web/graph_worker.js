// Our own routing off the main thread (docs/OWN_ROUTING.md §5): the graph tiles for the trip's corridor are loaded and
// kept here, and web/graph_router.js finds the routes, so the map never stutters while a plan is searched. The protocol
// is graph_router.js host(): { id, type: 'covers' | 'quick' | 'plan' | 'loop' | 'preload' | 'keep' | ..., ... } -> { id, covers | result } or { id, error }.
/* global importScripts, ApexGraphTiles, ApexGraphRouter */
// (apex_core.js: each planned route's light geometry is made here, off the page: graph_router.js host 'plan')
importScripts('apex_core.js', 'fun_route.js', 'graph_tiles.js', 'graph_router.js');
const host = ApexGraphRouter.host({
  load: (i, j) => ApexGraphTiles.load(i, j),
  keep: (bbox) => (ApexGraphTiles.keepArea ? ApexGraphTiles.keepArea(bbox) : null),
  index: () => (ApexGraphTiles.index ? ApexGraphTiles.index() : fetch('data/graph/v1/index.json').then((r) => (r.ok ? r.json() : null))),
});
self.onmessage = (e) => host.onmessage(e, (m) => self.postMessage(m));
