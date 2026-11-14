# STATE

## Road marks on a free drive with no route (V-13, 2026-11-14)
- `cockpit.js attachHorizonMarks(t)`: the road ahead (horizon.js, free driving) asks the map (osm_overpass only) for its
  own corridor, so stop signs, rail crossings, one-lane bridges, fords, deer crossings, gravel and rough road are called
  without a planned route. osm_overpass keeps its 5 km tiles a week, so a road you follow asks once a tile. Asked again
  twice (4 s, 8 s) while the map's late answer lands.
- A mark said on one horizon is not said again on the next, which overlaps it (`free.marksSaid`, same code within 40 m;
  every horizon's id is 'horizon', so the spoken keys alone can't tell).
- `apexDebug.horizonFrom(coords)` builds a road ahead for e2e.
- Tests: `tests/test_road_marks.py` (wiring); e2e "road marks on the road ahead…" (3/3, and it fails without the
  carry-over).
- Next: keep roaming.
