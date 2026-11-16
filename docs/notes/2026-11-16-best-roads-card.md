# STATE

## Best roads nearby: a card of roads, not a table (UI thread, 2026-11-16)
- The Best roads nearby sheet listed roads as a table under four column heads (Road, Good corners, Length, Drive there) with an underlined About on each. Each road is now a row in one card: the road's own shape drawn on an ink tile (its start dotted in the accent), its name, and one line under it ("3 good corners · 2.8 mi · 11 min away"). An ⓘ key opens About. The row still plans the road in one tap.
- The two Within keys lose the dial's tick marks, and the "3 good roads…" line is a quiet dim line instead of an accent-barred one.
- Next: offline and routing-error states, then the Place sheet.

# CALL SHEET

## Best roads nearby drops its column heads
- What: `showExplore` in `web/cockpit.js` builds `.nb-row` rows of `.nb-go` (an `svg.nb-shape`, plus `.nb-text` with the name and `.nb-sub`) and an `.nb-about` ⓘ key. The `.nb-head` and `.nb-cells` table are gone; the CSS is in `web/index.html`.
- Why: Nate (11-16): menus are "always just kind of a list of things". A table reads as a spreadsheet. Finding 7's rule still holds, because no number is ever bare: each carries its word ("good corners", "mi", "min away").
- Undo: revert this PR's `showExplore` hunk and the `.nb-*` CSS, and the plan flow (c) and About-a-road e2e checks.
