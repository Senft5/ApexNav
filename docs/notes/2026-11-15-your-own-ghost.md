# STATE

## 2026-11-15 · Your own best as a ghost (IDEAS D-04, the ghost on the map's Next)
- Done: on any saved stage you've driven before, your quickest pass is a ghost to drive against, offline and signed in or not: the bar shows "+1.2 s vs your best", a dashed marker with no initial sits where you were at this moment of that pass, and the co-driver says how it stands half way and at the finish ("Esses done. 1.4 seconds down on your best."). A friend's shared run on the same stage still comes first.
- `web/ghost_duel.js bestOwn` picks the pass (quickest with whole splits on a road like today's: dry takes dry or unknown, wet only wet, ice only ice); the analysis worker's `ownGhosts` job reads it at Start (and again when the road turns wet), its splits every 25 m, so the marker goes at your own pace down the straights too (it never leaves the phone).
- A run against your own best is not kept as a duel result (no "Challenge back" key on the drive page).
- Next: the drive page's corner-by-corner split table against your own best pass of a stage (cornerSplits already does it for a friend's run).

# CALL SHEET

## 2026-11-15 · Your own ghost takes the stage bar from the technique delta
- What: on a stage you've driven before, the bar shows the time gap to your own best (the ghost bar) instead of the technique points delta; the points result is still said and shown at the finish.
- Why: one bar at a time (the owner: no clutter), and the owner wants time gaps live on public roads (2026-11-14). Before this the ghost bar only showed for a friend's run.
- Undo: drop `friends.concat(mine)` back to `friends` in cockpit.js startGhostWatch (the stage bar shows again).
