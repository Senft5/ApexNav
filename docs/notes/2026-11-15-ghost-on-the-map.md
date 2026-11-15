# STATE

## 2026-11-15 · The ghost on the map (IDEAS D-04)
- Done: on a stage a friend has driven, a hollow marker with their initial sits where they were at this moment of their run, moved every frame (cockpit.js `moveGhost`, phone only, never CarPlay). `web/ghost_duel.js qAt` (timeAt's inverse) and `pointAt` (a fraction along the stage's line by length); the tracker's `in` view carries `elapsed_s` and `ghostAt(elapsed_s)` places it. Gone off a stage and at the finish.
- Between two splits the ghost goes at that stretch's even pace, so the map shows no more than the splits already tell (corner to corner times, never a speed down a straight).
- Next: your own best pass as a ghost on any road you've driven before (pass_coach.js has each corner's fastest pass; a continuous track needs one reference drive over the stretch).

# CALL SHEET

## 2026-11-15 · The ghost moves at its splits' pace, not a made-up speed profile
- What: the marker is interpolated evenly in time between the friend's shared splits (their corners' apexes), its clock run on from the last row for at most 2 s.
- Why: the splits are all a friend shares (no top speeds); anything finer would be invented. Capping the run-on keeps a stopped car from watching the ghost drive off alone on a stale clock.
- Undo: drop `moveGhost()` from feedGhost in cockpit.js (the bar and the voice are unchanged).
