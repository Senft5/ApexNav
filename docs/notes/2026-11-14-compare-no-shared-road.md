# STATE

## 2026-11-14 Compare: two drives on different roads say so

- **Done:** comparing two drives that share no road drew "0.0 mi Shared road", "0 / 36", a gap chart holding only
  this drive's speed line, and a corner table of dashes. It now shows one line, "These two drives share no road. Pick a
  drive of the same road.", with the two pickers kept and the Road, Gap and Corner panels hidden.
  - New e2e flow "Compare two drives on different roads…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 No shared road counts as nothing to compare

- **What:** analysis_page.js `renderCompare` calls `none(true)` when `r.overlap_m` is 0, the same empty state as one drive
  or the same drive twice, with its own line. Any overlap at all still draws the comparison.
- **Why:** with no overlap there is no gap curve and no matched corner, so every panel was empty or dashes.
- **Undo:** remove the `if (!(r.overlap_m > 0))` line and the `apart` argument of `none`.
