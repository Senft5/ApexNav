# STATE

## 2026-11-14 the Log's drive list shows each road's shape (claude/project-thread-5sbga7)
- Done: each row of the Log's drive list draws the drive's road, 48 pt, in the accent line with the start dot and the open finish (route_thumb.js), between the date stamp and the name. The summary keeps a `shape` (recording.js shapeOf: 32 evenly spaced known points to 5 places), SUMMARY_VERSION 3. A version-2 summary only gets its shape added from the drive's points, without being scored again, so the first Log after the update costs one read per drive, not a re-score.
- Also: with no scored drive yet, the Log's hero is the distance driven, big ("9.3 mi", "In 5 drives · no Score yet", "A Score needs a few clean corners."), not a big "-- /1000".
- Also: a drive's own page with no Score says why in the score's place ("No corners to score", "Too few clean corners to score"), as the end card does, instead of "-- /1000" over four empty bars.
- Tests: tests/test_drive_view.py (the unscored head), tests/test_summaries.py (32 points, start to finish, none under two known points); e2e "the Log list: each drive has its road's shape" (no Score yet: the miles as the hero; each row draws it, aria-hidden; an old summary gets its shape and keeps its score).
- Next: the same thumbnail on Your roads and Stages rows.

# CALL SHEET

## 2026-11-14 the road's shape rides in the summary, upgraded in place
- What: summarize() adds shape; summaries() lifts sv 2 rows to 3 by reading each drive once for its points (no Core needed, no score recomputed).
- Why: Strava and Apple Fitness let you find a workout by its map before you read it, and the Log only listed text. The summary already held the bbox, so 32 points (about 0.6 KB) is the cheapest way to draw every row without reading whole drives on each open.
- Undo: drop the ix-shape cell in analysis_page.js renderHistory; the shape field and the sv 2 to 3 upgrade can stay harmlessly.
