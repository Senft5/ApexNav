# STATE

## Session 2026-11-12 (declutter, end card): two lines under the score at most (claude/project-thread-5sbga7)

- Nate (04:05Z): "Every intersection and interaction between features should be clean." Four features each add a line
  under the end card's score (Practice D-27, a month's best run D-30, the road's passes, what the phone felt), and a
  drive could show all four plus the coaching line. `endLinesCap()` in cockpit.js now keeps two, in that order of
  priority; the rest are in the Log.
- Next: the drive page's two rows of keys.

# CALL SHEET

## 2026-11-12 (declutter, end card): at most two feature lines under the score (claude/project-thread-5sbga7)

The order is practice, run, road, feel: what you asked for, then what you earned, then the rest. A new end-card line
belongs in that list (cockpit.js endLinesCap). Undo: revert this PR.
