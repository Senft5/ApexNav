# STATE

## 2026-11-12 drive page: four keys and a More menu
- Done: the drive page's six action keys (two rows) are now one row: Replay, Drive it again, Compare and a ⋯ More menu holding Send the road, Share card and Mark a stage. The menu closes on a tap outside or Escape. The tags footnote ("Tags and notes stay on this phone. Filter the Log by them.") is gone; the line now only shows save results and hides when empty.
- Tests: e2e "your roads (panel D-1…" checks the four keys share a row, the three hide until More opens, and a tap outside closes it.
- Next: keep sweeping the shell, Garage, Where to?, Log and Your driving for leftover footnotes and second rows (Nate's no-walls-of-text rule).

# CALL SHEET

## 2026-11-12 drive page actions behind ⋯
- What: Send the road, Share card and Mark a stage moved into a ⋯ More menu on the drive page; the tags privacy footnote removed (the note box placeholder still says it stays on this phone).
- Why: Nate's TestFlight direction: cluttered, ban walls of text; a social app shows its main actions and puts the rest behind ⋯.
- Undo: move the three buttons back out of `.dv-more` in web/analysis.html and restore the `#dvTagsNote` text.
