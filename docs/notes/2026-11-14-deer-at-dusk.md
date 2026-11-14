# STATE

## A mapped deer crossing is called in cruise from dusk to dawn (2026-11-14)
- `web/road_marks.js cruiseWorthy(mark, sunAltRad)`: a mapped animal crossing counts as noteworthy in cruise when the
  sun is under 6° up where the car is (`cockpit.js noteworthyInCruise`, `sunAltNow`: ApexSun once a minute and per
  track). By day it waits for the notes like the other marks; unknown sun is daylight.
- Tests: `tests/test_road_marks.py`; e2e "a mapped deer crossing at dusk / at noon".
- Next: keep roaming.

# CALL SHEET

## Deer calls in cruise only from dusk to dawn (2026-11-14)
- What: an easy-paced drive hears "Deer crossing" at a mapped sign only when the sun is under 6° (Quiet notes too, as
  cameras and severe bumps are).
- Why: deer move at dusk and in the dark, when a driver at an easy pace isn't braced for one; by day the call would be
  chatter on every rural sign.
- Undo: drop the `ApexRoadMarks.cruiseWorthy` term from `noteworthyInCruise` in `cockpit.js`.
