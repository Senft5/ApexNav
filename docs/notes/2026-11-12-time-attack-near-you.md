# STATE

## Session 2026-11-12 (time attack near you): the weekly loop is near you and never through a neighbourhood (claude/project-thread-uwmi4e)

- [x] The owner's TestFlight note (2026-11-12, build 772.1): "generated time attack loops is literally like an hour away
  from me and goes only through a neighborhood" (this week's Clyo Road loop, Colerain Township, mostly subdivision
  streets). Two causes, both fixed:
  - **An hour away**: an area was a 1-degree square (about 110 by 90 km) and the loop started at a random road tile in
    it. An area is now a quarter-degree square, the router's own road tile (`AREA_DEG` 0.25 in backend/src/time_attack.ts
    and web/time_attack.js; cells like "39.25,-84.75"; `SLACK_DEG` 0.15). The starts are six points drawn from the seed in
    the middle half of the area.
  - **Through a neighbourhood**: the start snapped to whatever road was nearest, and nothing measured streets. Now
    graph_router.js loop takes `through` (the start goes on the nearest primary to unclassified road within 3 km, never a
    neighbourhood street), and loopRoute gives each loop `streetM` and `streetShare` (`neighbourhoodEdge`: streetEdge, or a
    residential or service road where that isn't known). time_attack.js `streety` refuses a loop with more than 500 m or
    5 % of it, or one that wasn't measured.
- Checked with real tiles (a scratch e2e, not committed) at Colerain, Northgate, Harrison and Cincinnati, three seeds each:
  11 of 12 loops have no neighbourhood street, and the other has 346 m (2.4 %).
- Old 1-degree cells in ta_weeks are left alone: no other area asks for them. One catch: a 1-degree corner such as "39,-85"
  is also a quarter-degree corner, so this week's only row on prod (Clyo Road loop, "39,-85", one entry) was taken down by
  hand (removed = 1). Its quarter builds a new loop from the next seed, and the owner's own area ("39.25,-84.75") builds
  its first.
- Tests: tests/test_time_attack.py (hubs, areaPoint, streety, choose), backend/test/time_attack.test.ts (cells, bad_cell),
  e2e "time attack, a new week" (starts in your quarter-degree area, little or no neighbourhood street).
- Exact next task: watch the next TestFlight notes on the week's loop; if a loop still lands on streets somewhere, lower
  `STREET_MAX_M`.

# CALL SHEET

## 2026-11-12 (time attack near you): smaller areas and no neighbourhood streets (claude/project-thread-uwmi4e)

Calls I made: the area is a quarter-degree square (about 28 by 22 km), not one loop per member, so friends nearby still
share a board; that's the router's own tile, so the phone that builds the loop always has its roads. A loop may carry
500 m or 5 % of neighbourhood street at most (a start's turn out of a side road), and one the router didn't measure is
refused, since unknown isn't clean. This week's one old loop (Clyo Road) was taken down; the one entry on it goes with it. Undo: `AREA_DEG` back to 1 in
both files, and drop `streety` from `choose`.
