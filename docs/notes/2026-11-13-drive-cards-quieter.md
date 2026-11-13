# STATE

## 2026-11-13: a drive's corner cards stop repeating the tip
- Done: on a drive's Log page a corner card shows its tip only when it is news: the corner is in Where to find time, or the tip is a habit (no best pass to copy). The other cards keep their delta (+0.6 s). The ideal drive line counts its sample as every drive of those corners: "your best pass at each of 36 corners, from 4 drives" (was "over 1 drive": the drives the best passes came from).
- Next: the drive page's Most abrupt moments rows repeat one advice line three times.

# CALL SHEET

## 2026-11-13: corner-card tips only where they are news
- What: `web/drive_view.js` corner grid: `dv-tip` only for `co.top` corners, corners with no best pass, or habit tips (`vs_best === false`).
- Why: on a road driven four times, 36 cards each said "Your best pass was N mph quicker at the slowest point" (TestFlight 2026-11-12, "text walls").
- Undo: drop the `co.top.includes(k) || …` condition.
