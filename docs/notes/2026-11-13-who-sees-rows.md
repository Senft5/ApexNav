# STATE

## 2026-11-13: Who sees what, rows one line across, no car sentence
- Done: in People → Who sees what, each row's rule is now one straight line. The name cell was 1 px taller than the other cells (48 px line-height plus its border), so the centred cells sat out of line and every rule had a step. The grid now stretches each cell to the row's height. The sentence "A car is seen by friends and private crews, never a public crew." is gone, since the Car column already shows it. **Who sees each car** now sits right under the grid instead of below Home zones. The e2e People flow checks the row edge, that the sentence is gone, and where the link sits.
- Next: keep screenshotting the social sheets.

# CALL SHEET

## 2026-11-13: drop the car sentence from Who sees what
- What: web/who_sees.js: `.who-grid` `align-items: stretch`; the car note is replaced by the Who sees each car link under the grid.
- Why: Nate's no-walls-of-text rule; the Car column says it. The link belongs next to the column it changes.
- Undo: put the note back, move the link back after Home zones, and set `align-items: center`.
