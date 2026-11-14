# STATE

## 2026-11-14 A drive's elevation lane in your units

- **Done:** the elevation lane on a drive's page labelled its range in feet for everyone, metric drivers too, and a
  level road read "820-820 ft". It now uses your units ("250 m" or "820 ft"), an en dash between two heights, and one
  height when the road is flat.
  - New e2e flow "a drive's elevation lane gives its range in your units…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 One height on a flat road

- **What:** drive_view.js `elevSpan(lo, hi)` formats the lane's label from ApexUnits.
- **Why:** "820-820 ft" reads as a glitch, and feet for a metric driver is a plain bug.
- **Undo:** put back the inline `${Math.round(lo * 3.28084)}-${Math.round(hi * 3.28084)} ft`.
