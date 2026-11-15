# STATE

## "Rough road" where members measured broken pavement (Q-01 data, V-13, 2026-11-15)
- `contributor.js`:
  - `roughFrom(rough, n, dist)`: runs where two or more passes measured mean roughness of 0.30 g rms or more (the same
    `ROUGH_G` behind the route card's "rough" km). A run must be 100 m or longer, and runs less than 300 m apart count
    as one.
  - `roughMarks(track, runs, marks)`: "Rough road" marks (kind `rough`, `crowd: true`). None at the very start, and none
    within 40 m of the map's own smoothness mark.
  - `measuredAlong` and `feelFromWays` return `crowdRough`.
- `cockpit.js` `applyCrowdBumps` adds them to `t.marks` on planned routes and on a free drive's road ahead. A mark said
  on an earlier road ahead is not said again (`free.marksSaid`).
- `route_feel.js`: saved routes keep them as `rough: [[from m, to m]]`.
- Tests:
  - `tests/test_contributor.py`
  - `tests/test_route_feel.py`
  - e2e "members' road feel on the road ahead" now also checks "Rough road", said once.
- Next: hear it on a real road the crowd has measured as broken. If 0.30 g calls too often on chip seal, raise it in
  one place (`ROUGH_G`); the route card's rough km moves with it.
