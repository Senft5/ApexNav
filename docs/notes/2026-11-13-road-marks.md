# STATE
## Session 2026-11-13 (road marks): stop signs, rail crossings, one-lane bridges and speed bumps called with the notes (claude/project-thread-h7xxmf)
- Done: `web/road_marks.js` (pure, tests/test_road_marks.py) turns the route context's OSM points and spans (route_ctx/osm_overpass.js: `stop` that applies to the route, `level_crossing`, `calming` bumps/humps/tables/cushions, `one_lane_bridge`) into note events (`type: 'mark'`, codes STOP, RAIL, HUMP, BRIDGE) on the planned route (`t.marks`, cockpit.js attachMarks from whenScan). They are read with the pace notes (spirited, as corners), shown on the strip and pinned on the map (`.pin.mark`). A stop sign's call distance includes braking to a stop (`apexMpsOf` 0). Overpass answers off the plan's critical path, so with no marks yet it asks again for this route alone, up to three times (4, 8, 12 s). e2e "road marks: a stop sign and a railway crossing".
- Next: marks for a route rebuilt during a drive (whenScan skips live), and a tulip glyph per kind on the strip (today the hazard plate with the code).

# CALL SHEET
## 2026-11-13 (road marks): called like corners, not in cruise or Quiet (claude/project-thread-h7xxmf)
A commute past ten stop signs should not hear ten calls, so marks follow the corners' rule: said when the notes are awake (spirited, Full), always on the strip. Give-way, signals, crossings and chicanes are left out (too many, or no surprise). Undo: drop `track.marks` from allEvents in cockpit.js.
