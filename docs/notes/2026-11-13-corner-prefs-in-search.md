# STATE

## 2026-11-13 Hairpins and Sweepers more/fewer steer our router's search (claude/project-thread-39xbx9)
- IDEAS R-19: the Plan sheet's corner prefs only weighed the ranking of routes already found (fun_route.js
  cornerWeight) and, in the search, scaled fun as a whole by 1 + 0.25 x (tight + fast), so "more hairpins, fewer
  sweepers" changed nothing there at all.
- `graph_router.js` `cornerMix`: per edge, the share of its turning (at each inner vertex of the tiles' geometry) that is
  tight (local radius under 40 m: hairpins, 1s, 2s) or fast (100 to 260 m: 5s, 6s). Only edges with corner points, only
  when a pref is set, once per view (about 50 ms on the 400k-edge Cincinnati area in node).
- `objectiveOf`: each edge's fun counts up to 60 % more or less by those shares (`PREF_STEP`, as fun_route.js), after
  the full-fun cap so a road already at full fun still gains; goodness held to 1.
- On the bundled tiles: Yellowstone Drive to Wesselman Road at Fun takes Blue Rock Road with "more hairpins, fewer
  sweepers"; the three test trips are otherwise unchanged, and plan times are the same.
- Tests: `test_graph_router.py` cornerPrefs (two roads alike but for their corners).
- Next: the Long way search itself (about 12 to 15 A* searches a plan, each settling most of the corridor).

# CALL SHEET

## 2026-11-13 The corner prefs per edge, from the map's geometry (claude/project-thread-39xbx9)

The tiles carry one fun number per edge, so the split into tight and fast is read from the line's own vertices
(radius = segment length over turn angle). It is rough on sparse lines, but a farm road's square corners and a
mountain road's hairpins both read as tight, which is what the pace notes call them too. Undo: `PREF_STEP` 0 in
`graph_router.js` (the search then ignores the prefs; the ranking still uses them).
