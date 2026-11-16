# STATE
## Session 2026-11-16 (joke route): no more side-street Fun routes when Quick is the way (claude/project-thread-39xbx9)
- The owner drove a Fun route from the Blue Ash office park home to Colerain (31 mi) and asked "was that route meant to be a joke". It used about 20 mi of suburban arterials, made a dead-end U-turn on Devonian Dr, looped round a neighbourhood off Monastery Dr, and kept zigzagging back to Dimmick Rd. What went wrong, from his dev drive and the router run in node:
  - No highway-free way took a sensible time. I-275 is 19 min, and the quickest way without highways took 44. The card still offered Fun as a side-street route.
  - The reroute at the start ("Rerouting" at 0 m) was routed at Fun. When our own router missed its 3 s, it fell back to Valhalla through the plan's shaping points. Those points could sit on residential streets and dead ends.
- Done:
  - web/fun_route.js applyHighways: when no highway-free way takes a sensible time (HWY.ABSURD, 2x the quickest), the pick for Fun and Long way is now the quickest route. The card says "No highway-free way in a sensible time; Quick is the way", and all three levels pick the same route.
  - web/cockpit.js: a track's rerouteLevel is 'quick' for that pick, and every reroute keeps the level it was planned at. Before, trackAhead dropped funLevel, so the second reroute of a Fun route ran at Quick.
  - web/cockpit.js routePoints: Fun and Long way are ours only, with 8 s for our router (OWN_THROUGH_FUN_MS). If our router fails, there is no Valhalla or OSRM fallback. The reroute then says "Off route · no Fun way from here" and offers a "Quick way" button (or the car's key) once per track.
  - web/graph_router.js through: at Fun and Long way, a shaping point lands only on a through road within 60 m (SHAPE_SNAP_M, shapingEdge). A residential or service street, a neighbourhood street, a ramp, a private road or a dead end never gets one. A shaping point with no such road nearby is passed by. web/own_routing.js now passes the shaping flag to the router.
- Tests:
  - test_a_fun_reroutes_shaping_points_stay_off_side_streets_and_dead_ends is new.
  - test_no_highway_free_way_in_a_sensible_time now expects the motorway for the Fun pick.
- Next: when poorKm dominates a highway-free Fun route that is still under 2x, it may deserve the same "Quick is the way" answer. Measure it on the owner's drives first.

# CALL SHEET
## 2026-11-16 (joke route): an absurd highway-free way gives the quickest at Fun, and a Fun reroute never asks Valhalla
- An absurd highway-free way at twice the time is no Fun route. The owner's rule is that Valhalla is for Quick only, which the reroute path broke. Undo the pick: remove the `h.absurd` block in web/fun_route.js applyHighways.
- Undo the reroute change: restore the Valhalla fallback in cockpit.js routePoints, which was valhallaRoutes with levelCosting.
- Shaping points are hints, not stops, so dropping one beats a detour into a cul-de-sac. Undo: in web/graph_router.js through, snap every via with the plain snap again (drop the shapingEdge branch).
