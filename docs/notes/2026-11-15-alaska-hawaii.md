# STATE
## 2026-11-15 (Alaska and Hawaii): Fun routing in all 50 states
- The graph build (tools/graph_etl/us_plan.py) now plans Alaska and Hawaii beside the lower 48, on boxes where their roads are (EXTRA): Alaska from Unalaska and Nome to Prudhoe Bay plus the panhandle, Hawaii's main islands. Until now Fun, Long way, loops and Best roads nearby had no road there at all.
- graph-us.yml `bands_from` takes several run ids (comma separated), so a pilot's Alaska and Hawaii bands publish beside the lower 48's without a 13 h rebuild. The monthly build includes them from now on.
- Going live: a pilot run of graph-us (only=alaska,hawaii, live=false); then dispatch graph-us on main with bands_from=<lower 48's band run>,<the pilot's run>. Both must be in ISO week 2026-46 for their build ids to merge (merge_index same_build); a later week means a whole rebuild instead.
- Next: check famous roads there (Seward Highway, Road to Hana) once live; then a turn-burden term for Long way (OH 78: 64 turns in 110 km).

# CALL SHEET
## 2026-11-15 (Alaska and Hawaii): road boxes, not Geofabrik outlines
Alaska's outline runs across the date line (west -180 to east 180) and Hawaii's out to Midway: their bounding boxes would plan thousands of empty blocks and a matrix past GitHub's 256 jobs. Hand-set boxes keep them to about 600 blocks and 50 jobs, and leave out the Aleutians past Unalaska and the Northwestern Hawaiian Islands (almost no road). Undo: drop EXTRA from us_plan.py (and its AREAS), and the states fall back to the lower 48.
