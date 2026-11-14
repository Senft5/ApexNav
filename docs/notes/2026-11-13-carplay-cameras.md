# STATE

## Session 2026-11-13 (carplay cameras): the car's map shows the route's speed cameras (claude/project-thread-me97iw)
- Waze shows speed cameras on the car; Vetta found the planned route's speed cameras and plate readers (web/cameras.js, attachAlpr) and showed them only on the phone. `hazardsMessage` (web/carplay.js) now adds them after the reports as "Speed camera" / "Camera" plates (speed cameras first, 40 plates in all), under the phone's camera switch (toggles.lpr), sent with every route and when the cameras arrive. A car that connects again always gets the hazard list, even an empty one.
- Next: TestFlight on Nate's car.

# CALL SHEET

## 2026-11-13 (carplay cameras): cameras ride as hazard plates, not a new marker kind (claude/project-thread-me97iw)
- Why: the hazard plate already wins a crowded spot on both car maps and reads at a glance; no Swift change.
- Undo: pass no cameras to `hazardsMessage` in cockpit.js carHazards.
