# STATE

## A corner over your drives (2026-11-15)
- Done: tap a corner on a drive's page. Its overlay (against your best pass, or, where this drive is your best, the clip key) now ends with that corner over your drives here, oldest first: "Your passes here: Oct 30 5.1 s · Nov 3 4.8 s · this drive 4.6 s" (the last five). Each time is over exactly this drive's stretch of the corner, as the coach times it (aligned_time_s). Like with like, as the coach is: a wet drive against wet ones.
- How: `Core.coach` (`core/drive_analysis.py coach` and `web/apex_core.js coach`, parity-tested) now returns `times`, [j, s] for every counted other pass of each corner. `drive_view.js cornerPasses / cornerPassesLine` sort them by co.near's dates.
- Next: a road-level "quicker than your first in N of M corners" could come from the same times, if the line proves useful.

# CALL SHEET

## 2026-11-15 · A corner's history lives in its overlay, not on the card
- What: the passes-over-time line goes in the corner's tap-open overlay, not on every corner card.
- Why: the drive page's cards were cut back for walls of text (TestFlight 2026-11-12); a corner's history is for when you look at that corner.
- Undo: drop the passesLine calls in drive_view.js openOverlay / openClipOnly.
