// A day out with stops (IDEAS R-17): the stops you added to a planned route (a pin's Add via, a dragged route, a viewpoint or
// café tapped on the map) listed on the route card in order, to move up, down or take out; the route is rebuilt through
// them. Shaping points the planner added are not stops: reordering keeps only your stops (the planner's shape was for the
// old order). Pure (tests/test_trip_stops.py).
(function (root) {
  'use strict';
  /** Your stops in route order: [{ i (index in request.via), label, lat, lon }]. */
  function stops(request) {
    const via = (request && request.via) || [];
    let n = 0;
    return via.map((v, i) => ({ v, i })).filter(({ v }) => !v.shaping && Number.isFinite(v.lat) && Number.isFinite(v.lon))
      .map(({ v, i }) => ({ i, label: v.label || `Stop ${++n}`, lat: v.lat, lon: v.lon }));
  }
  const clean = (v) => ({ lat: v.lat, lon: v.lon, ...(v.label ? { label: v.label } : {}) });
  /** The new via list (your stops only) with stop `k` (its position among your stops) moved by `d` (-1 up, +1 down). */
  function move(request, k, d) {
    const s = stops(request).map((x) => clean(request.via[x.i]));
    const j = k + d;
    if (k < 0 || k >= s.length || j < 0 || j >= s.length) return s;
    [s[k], s[j]] = [s[j], s[k]];
    return s;
  }
  /** The new via list without stop `k`. */
  const remove = (request, k) => stops(request).map((x) => clean(request.via[x.i])).filter((_, n) => n !== k);

  const api = { stops, move, remove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexTripStops = api;
})(typeof window !== 'undefined' ? window : globalThis);
