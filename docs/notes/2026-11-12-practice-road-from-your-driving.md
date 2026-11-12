# STATE
## Session 2026-11-12 (deepest analysis, PR 22): Your driving offers the practice on the road where it shows most (claude/project-thread-gd7nre)
- `web/driver_profile.js` `skillRoad(list, skill)`: skillRoadLine's road ({name, n, of}), now shared.
- `web/analysis.html`: under Work on (or a practice over every road), "It shows most on Dry Ridge Rd: ..." ends with
  "Practice it on Dry Ridge Rd alone", which saves the per-road plan (where: {road, name}). No offer once the practice
  keeps to a road.
- Tests: tests/test_best_corners.py (skillRoad); the four-drive road e2e flow presses the offer and checks the plan.
- Next: the end card on a drive on the practised road could name the road ("Practice on Dry Ridge Rd · ...").

# CALL SHEET
## 2026-11-12 (deepest analysis 22): "Practice it on <road> alone" on Your driving's road line (claude/project-thread-gd7nre)
The road line already names where the skill shows most, so the next step is to practice there. It is a link, not a
second big button, beside the existing "Practice it on my next drives". Pressing it starts a new plan from now, as every
plan start does. Undo: remove the drivingRoadGo block in renderDriving (web/analysis.html).
