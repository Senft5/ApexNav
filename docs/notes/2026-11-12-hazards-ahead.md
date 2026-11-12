# STATE
## Session 2026-11-12 (roam-c hazards-ahead): reported hazards stay known in a dead zone on a planned route (claude/roam-c-hazards-ahead)
- Done: as a drive starts on a planned route (members, with signal), `askAhead` in cockpit.js asks `/api/hazards` for each
  0.1° cell the route runs through (`ApexPrivacyZones.routeCells`: at most 12, never the start's or end's cell, never a cell
  a privacy zone sits in, nothing within the private edge of either end) and keeps them 6 h. When the drive's own lookup
  fails, `keepAhead` uses that cell's kept reports, expired ones dropped (`ApexHazardReports.stillLive`).
- Tests: tests/test_hazards_ahead.py; e2e "reports ahead of a dead zone…" (fails without the fallback);
  test_position_beacon counts the new cell lookup. Privacy page and APP_REVIEW 5.1.2 say so.
- Next: a phone test in a real dead zone (owner, TestFlight).

# CALL SHEET
## 2026-11-12 (roam-c): reports along a planned route are asked ahead, by cell
- What: the drive start asks for the hazard cells along the planned route (same coarse cells as any lookup), so a dead zone
  still has the reports. Why: F-03 said "reported hazards are live only", and the hills where hazards matter are where signal
  drops. The ends' cells and privacy-zone cells are never asked, so where a trip starts and ends stays as private as before.
  Undo: drop the `askAhead(track)` line in enterDrive (the fallback then finds nothing kept).
