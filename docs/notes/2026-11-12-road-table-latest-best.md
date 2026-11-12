# STATE

## 2026-11-12: a drive's road table says latest and best, not a two-drive trend
- Done: under "this road" on a drive's Log page, "Score up 68 points from the first to the latest drive on this road." becomes "Latest 680 · best 702 · 4 scored drives here".
- Next: keep applying the UI/UX guide's analytics rules (honest comparisons, sample sizes) to the remaining driver analysis screens.

# CALL SHEET

## 2026-11-12: no first-to-latest score change on the road table
- What: the footer row of `dvRoadTable` (`web/analysis_page.js`) gives the latest and best score and how many drives, instead of the change from the first drive to the latest.
- Why: the UI/UX guide 8.3; the change between two single drives reads as a trend it is not (the chart above already shows every drive).
- Undo: restore the `Score up/down N points` template and the `first`/`gain` constants.
