# STATE

## Session 2026-11-13 (carplay speed limit): the car's map shows the posted speed limit (claude/project-thread-me97iw)
- Apple Maps and Waze show the limit on the car; Vetta matched it from OSM (the binnacle's LIMIT) and the car showed nothing. The page sends `limitMessage` (web/carplay.js) while a drive is live and the limit is known; the native car map (ApexCarLimitView) and web/carmap.html draw a road sign at the bottom left, past Apple's card: the US "SPEED LIMIT" sign, or the km/h red ring. Plates keep clear of it. Unknown: no sign. Never in the cluster (the car shows its own).
- Next: TestFlight on Nate's car; the next in-car gap (voice destination search or rerouting in the car).

# CALL SHEET

## 2026-11-13 (carplay speed limit): the sign sits bottom left, not beside the sight plate (claude/project-thread-me97iw)
- Why: panel round 2 (TH-2) kept the sight plate from ever reading as a limit sign; a real sign in the corner where Apple Maps puts it keeps the two apart, and the corner is clear of the arrow and the plates.
- Undo: `carLimit` in web/cockpit.js posts nothing (or drop `case "limit"` in ApexCarPlay.swift).
