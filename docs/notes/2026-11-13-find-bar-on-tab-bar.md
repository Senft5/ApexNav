# STATE

## 2026-11-13 Where to?'s Find a loop sits on the tab bar (claude/project-thread-5sbga7)
- Done: the other half of Nate's TestFlight "evil cluttered gap" note (2026-11-12). With little in the sheet (signed out, no planning rows yet), Find a loop stopped right under the loop dial and left an empty band below it, and the bar also padded itself for the home indicator although the tab bar under the sheet already clears it. Now the section fills the sheet, a flexible spacer before the bar takes what's left, and the bar keeps only its own 10 px. When the rows overflow (the bar is sticky then) every row sits where it did before, to the pixel: measured at 390x844, 375x667 and 844x390.
- Tests: pytest; e2e "screen by screen", "plan flow", "Where to", "safe areas", "Dynamic Type", "keyboard", "loop", "landscape".
- Next: keep sweeping the shell.

# CALL SHEET

## 2026-11-13 the plan's search section is a flex column (portrait)
- What: index.html, outside phone landscape: .plan-body stretches its rows, .plan-search-section is a flex column with an ::after spacer (order 1) before .find-bar (order 2), the chips lose their 4 px bottom margin (flex margins don't collapse), and the bar's bottom padding drops the safe-area inset.
- Why: no dead band under the main key; the tab bar handles the home indicator (the sheet is hidden while driving or replaying, the bar while typing).
- Undo: delete that @media block.

## 2026-11-13 the sight-tag e2e check reads the plate and the cell together
- What: e2e "the sight-line speed rides under the position arrow" reads .sight-tag and #cluster in one page.evaluate, and gives them up to 2 s to agree.
- Why: CI on this PR failed it with "SIGHT15" against a cell that had moved on. The app paints both in the same frame from the same held value (cockpit.js render, sightHold); the test's two separate textContent calls could straddle a step of the held value. Not reproducible locally (3 of 3 passed before the change).
- Undo: go back to the two page.textContent calls.
