# STATE

## 2026-11-13 Where to? leads with search, nearby and your places; the loop folds to one row (claude/project-thread-5sbga7)
- Done: in the open Where to? sheet the loop's dial (By time / By distance, the gauge) sits behind one row, "Loop from here 45 mi" with a chevron (`#loopRow`, `#loopBody`, cockpit.js openLoopDial). The row shows the length picked; a tap unfolds the dial; Find a loop still runs with the length shown. In a short landscape phone the closed sheet is just its search bar (`#planBody` hidden), so the body's top row never peeks under the home indicator.
- Done (same PR): a row of four square keys under the field, each a glyph over its word, as Apple Maps' Find Nearby: Best roads nearby (inked solid), then Gas (Chargers for an electric car), Coffee, Food (`.plan-keys`, `.rkey`, cockpit.js NEARBY_GLYPH). Options left the chip row and became the last row of one list, with the loop, Spots, Time attack and Roadbooks (`.plan-list`, `.plan-opt`): one rule, one 52 pt row each, no gaps. In landscape the list is the right column from the top; the keys, places and Find a loop are the left.
- Tests: e2e "a loop by time" (folded at open, the row names the length, a tap unfolds the dial); the safe-area flows (landscape, mini on its side) and TestFlight 2026-11-05 note 6 pass with the shorter sheet.
- Next: the first-run and main-navigation pass against Apple Maps (fewer screens, one clear hierarchy).

# CALL SHEET

## 2026-11-13 the loop's dial folds behind one row
- What: `.plan-loop` gets a `#loopRow` button (label, the length picked, a chevron, aria-expanded) over a hidden `#loopBody` holding loopBy and the gauge; landscape `.plan:not(.open) > #planBody { visibility: hidden }`.
- Why: the dial was the largest block in Where to?, so search, Gas / Coffee / Food and your places sat under a control most drives don't touch. Apple Maps' search sheet leads with search and places; the loop's options are one tap away and the row still says the length.
- Undo: drop the `#loopRow` button and the `hidden` on `#loopBody` in index.html, and openLoopDial in cockpit.js.

## 2026-11-13 Where to?'s shortcuts are one row of glyph keys; Options is a row of the list
- What: `.plan-keys` (Best roads nearby + the nearby keys, four across, 52 pt squares, radius 0, 1.75 px strokes per BRAND.md), `.plan-list` wrapping the loop row, Spots, Time attack, Roadbooks and `.plan-opt` (Options · n on).
- Why: two rows of boxed chips with different weights (Best roads nearby, Options · 1 on, then Gas / Coffee / Food) read as clutter; Apple Maps puts its category keys in one glyph row and settings out of the way. Options is a setting, not a destination, so it's a row.
- Undo: put `#planOptionsChip` back in `#planChips`, drop the `.rkey` class and glyphs, and unwrap `.plan-list`.

## 2026-11-14 the Log warms only when it can be fetched
- What: cockpit.js prewarmLog waits for `online` when the website (http/https) has no signal; the app's own files warm either way.
- Why: warmed with no signal, the Log frame was kept half-loaded (no ApexCore: CI e2e 4/4 on #700, "Cannot read properties of undefined (reading 'MPS_TO_MPH')"), so the first open of the Log was broken. e2e "the Log warms only when it can be fetched" fails without it.
- Undo: drop the navigator.onLine line in prewarmLog.

## 2026-11-14 the tab bar stays put on the Log
- What: analysis.html `.tabbar` gets the 8 pt under its keys that the map page's bar has (the deck's padding).
- Why: the Log's keys sat 8 pt lower, so the bar jumped each time the Log opened. e2e "the tab bar stays put" measures all four tabs.
- Undo: drop the `8px +` in the Log's tab bar padding.
