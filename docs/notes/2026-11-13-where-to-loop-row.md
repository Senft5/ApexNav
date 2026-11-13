# STATE

## 2026-11-13 Where to? leads with search, nearby and your places; the loop folds to one row (claude/project-thread-5sbga7)
- Done: in the open Where to? sheet the loop's dial (By time / By distance, the gauge) sits behind one row, "Loop from here 45 mi" with a chevron (`#loopRow`, `#loopBody`, cockpit.js openLoopDial). The row shows the length picked; a tap unfolds the dial; Find a loop still runs with the length shown. In a short landscape phone the closed sheet is just its search bar (`#planBody` hidden), so the body's top row never peeks under the home indicator.
- Tests: e2e "a loop by time" (folded at open, the row names the length, a tap unfolds the dial); the safe-area flows (landscape, mini on its side) and TestFlight 2026-11-05 note 6 pass with the shorter sheet.
- Next: the first-run and main-navigation pass against Apple Maps (fewer screens, one clear hierarchy).

# CALL SHEET

## 2026-11-13 the loop's dial folds behind one row
- What: `.plan-loop` gets a `#loopRow` button (label, the length picked, a chevron, aria-expanded) over a hidden `#loopBody` holding loopBy and the gauge; landscape `.plan:not(.open) > #planBody { visibility: hidden }`.
- Why: the dial was the largest block in Where to?, so search, Gas / Coffee / Food and your places sat under a control most drives don't touch. Apple Maps' search sheet leads with search and places; the loop's options are one tap away and the row still says the length.
- Undo: drop the `#loopRow` button and the `hidden` on `#loopBody` in index.html, and openLoopDial in cockpit.js.
