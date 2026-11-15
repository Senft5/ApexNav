# STATE

## Race your ideal run (2026-11-15)
- Done: Stage Runs has a "Race your ideal" button under the ideal-run line. It shows only where that line shows: 0.5 s or more under your best, from 2 runs or more. Tapped, your own ghost on that stage becomes your ideal run on your next drives: the bar reads "+1.2 s vs your ideal" and the co-driver says "... down on your ideal". A second tap ("Race your best instead") goes back to your best.
- How: `ghost_duel.js idealOf` now also returns the ideal as a ghost: `splits` (at your best's 25 m splits) and `corners` (at the cuts). Each point is the quickest pass's time over its stretch, counted from where the stretch began. `label(gap, who, self)` takes a name for self. The `analysis_client.js ownGhosts` job takes `ideal` (stage ids) and returns `{ ideal: true }` ghosts from your dry runs, or your best when the ideal is not 0.5 s under it, or the road is wet. `cockpit.js startGhostWatch` reads `apex.raceIdeal` (localStorage, stage ids) and names the ghost "your ideal".
- Next: a stage's Runs could mark which run each stretch of the ideal came from.

# CALL SHEET

## 2026-11-15 · The ideal is raced only when chosen, per stage
- What: your own ghost stays your best unless you tap Race your ideal on that stage; the choice is kept on the phone (apex.raceIdeal) and never sent.
- Why: a ghost that is always ahead is a different game from beating your best; it is the driver's call, one stage at a time, with no new setting elsewhere.
- Undo: drop the `ideal` branch in ownGhosts and the segRaceRow button.
