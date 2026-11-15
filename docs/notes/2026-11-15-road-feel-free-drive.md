# STATE

## Members' bumps and crests on a free drive's road ahead (Q-02, free driving, 2026-11-15)
- `route_ctx/osm_overpass.js`: when asked with `opts.ways` (the road ahead only), the result gets `osm_way` spans for the
  way under each stretch: `label` is the way id as a string (OSM ids are bigger than a Float32 holds), `cls` is the
  highway tag, `geom` is the full line.
- `contributor.js` `feelFromWays(track, spans, roads, lines)`: no Valhalla map match is needed, because the spans say
  which way each sample is on. `locate` and `seriesFrom` place the members' bins along the line the server binned on
  (the cells answer's `lines`, else the span's). It returns `{ crowdBumps, crowdCrests }`, as `measuredAlong` does.
- `cockpit.js` `horizonFeel(t, c)`, run after the horizon's road marks:
  - Asks members' data by the 0.1° cells the road ahead crosses (`routeCtxOpts().lookupCells`, VI-1, the crowd
    provider's own ask, kept cells when offline), never by way ids. Each cell is kept 30 min, so one ask per cell.
  - Hands the result to `applyCrowdBumps`, which now accepts a horizon. A bump or crest said on an earlier road ahead
    is not said again (`free.feelSaid`, 25 m).
  - Signed out, or not a member: the server says no and the cell is kept as none.
- Tests:
  - `tests/test_contributor.py`: spans only when asked, residential never, bins on the server's line.
  - e2e "members' road feel on the road ahead": one cell asked, the bump said once, not again on the overlap.
- Next: check on a real free drive over a road with crowd bumps. A road edited in OSM since the members' passes can
  shift the bins; that risk is the same as on planned routes.
