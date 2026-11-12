# STATE

## 2026-11-12 drive page: three keys and a More menu
- Done: the drive page's six action keys (two rows) are now one row: Replay, Drive it again and a ⋯ More menu holding Compare, Send the road, Share card and Mark a stage (four keys wrapped in wider fonts; the page already compares with your best here in its Corners section). The menu closes on a tap outside or Escape. The tags footnote ("Tags and notes stay on this phone. Filter the Log by them.") is gone; the line now only shows save results and hides when empty.
- Tests: e2e "your roads (panel D-1…" checks the three keys share a row, the four hide until More opens, and a tap outside closes it.
- Next: keep sweeping the shell, Garage, Where to?, Log and Your driving for leftover footnotes and second rows (Nate's no-walls-of-text rule).

# CALL SHEET

## 2026-11-12 drive page actions behind ⋯
- What: Compare, Send the road, Share card and Mark a stage moved into a ⋯ More menu on the drive page; the tags privacy footnote removed (the note box placeholder still says it stays on this phone).
- Why: Nate's TestFlight direction: cluttered, ban walls of text; a social app shows its main actions and puts the rest behind ⋯.
- Undo: move the four buttons back out of `.dv-more` in web/analysis.html and restore the `#dvTagsNote` text.
