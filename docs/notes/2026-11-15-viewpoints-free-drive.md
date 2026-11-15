# STATE

## Viewpoints and waterfalls on a free drive's road ahead (R-24, free driving, 2026-11-15)
- `cockpit.js` `attachHorizonViews(t)`, run from `useHorizon` after the road marks: the map tiles' viewpoints near the
  road ahead (`ApexStages.pois`, cached per tile) and the weekly OSM build's waterfalls (`cellList('falls')`, cached per
  cell set). They are placed with `ApexScenic.along` and kept as the horizon's `t.scenic`. No fuel or cafés: a few km
  ahead says nothing about the next pump.
- The live tick runs `ApexAlongAhead.due` on the horizon as it does on a planned route ("Lookout Rock on the right, in
  a quarter mile."). The same 5 minutes apply between views, and nothing is said in Quiet notes. Keys said are kept per
  horizon (`t.alongSaid`). A place already said goes in `free.viewsSaid` by lat/lon, so the next road ahead, which
  overlaps this one, leaves it out (60 m). The list is cleared at drive start.
- `along_ahead.js` `due` returns `at: {lat, lon}` on a view or waterfall line.
- Tests: `tests/test_along_ahead.py`; e2e "a viewpoint on the road ahead" (said once, on its side, not on the next road
  ahead).
- Next: hear it on a real free drive past a mapped overlook (Blue Ridge Parkway style roads have many; the 5 minute gap
  holds them to one).
