# STATE

## 2026-11-14 Compare with lists only drives near this one

- **Done:** Log → Compare's "Compare with" listed every drive, so most picks were drives of other roads and drew only
  "These two drives share no road". It now lists only drives whose box overlaps this drive's, newest first. A drive with
  no box stays in the list, because an unknown box is not proof the drive was elsewhere. With no such drive, one line says
  "No other drive on this road yet", and the empty Compare with picker and Swap are hidden. This drive's picker stays.
  Swap and the drive page's Compare (its best other drive) still pick as before.
  - The e2e flow from #721 is now "Compare: Compare with lists only drives near this one…", with a third drive 100 km
    away. It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 Compare with filters by box overlap, not by shared road

- **What:** analysis_page.js `sameRoad(id)` keeps drives whose summary `bbox` meets A's, the same test as
  analysis_client.js `overlaps`, and `fillCompareWith` refills the list whenever This drive changes.
- **Why:** the real shared-road check runs in the worker per pair and is too slow for a list. Box overlap is free from the
  summaries, and it removes the drives that can't share road. Near drives that still share none get #721's line.
- **Undo:** list `drives` in `fillCompareWith` again and drop the `alone` line in `renderCompare`.
