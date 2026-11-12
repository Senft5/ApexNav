# STATE

## 2026-11-12: drive page repeatability rows say each number once
- Done: in "How repeatable your corners are" each row's big number is the braking point's spread (now "±12 m"), and the line under it labels it once ("Braking point over 6 passes · speed ±2 mph"), adding the braking-marker advice only where it varies. The slowest point and turn-in spreads moved into the row's spoken label. The intro reads "Typical: braking point ±6 m · speed ±2 mph · 14 corners".
- Next: keep applying the UI/UX guide's analytics rules to the remaining driver analysis screens.

# CALL SHEET

## 2026-11-12: slowest point and turn-in spreads leave the visible repeatability row
- What: the visible row keeps the braking point (the number the advice acts on), passes and speed; slowest point and turn-in are in the aria-label only.
- Why: the guide's "no line that only repeats a number" and Nate's no-walls-of-text rule; the row used to repeat its own big number and list five spreads.
- Undo: restore the `slowest point` / `turn-in` parts of the `.note` span in `web/drive_view.js` (repeatability rows).
