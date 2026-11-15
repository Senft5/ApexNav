# STATE

## 2026-11-15 · Where a stage was lost, said at the finish
- Done: down on a ghost (a friend's run or your own best) at a stage's finish, the co-driver adds where most of it went: "Esses done. 1.4 seconds down on your best. Most of it late on." The stretch is the one between the ghost's corner cuts that cost most (0.3 s or more), from the live rows' own clock (`web/ghost_duel.js worstOf`, `worstSaid`).
- Your own ghost now carries corner-cut splits too (`corners`, from the analysis worker's `ownGhosts`), so the stretch is corner to corner; its 25 m splits still move the marker.
- Next: the same "where" on the drive bar's half-way line, or Nate's roughness calibration once he names roads.

# CALL SHEET

## 2026-11-15 · Where it went is said by place on the stage, never a corner number
- What: "early on", "in the middle", "late on" (by the stretch's middle, in thirds of the stage) or "in the run to the finish".
- Why: the ghost's cuts skip corners under 100 m apart, so "corner 3" would not be the road's third corner; the drive page names the corners exactly.
- Undo: drop `tail` from the finish line in cockpit.js feedGhost.
