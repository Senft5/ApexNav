# STATE

## 2026-11-14 Your stages go into your roadbook (free roamer B)
- Done: your own roadbook's page has "Add one of your stages". It opens the Log's saved stages that aren't in the book yet as chips; a tap adds the stage under its name, its line as you marked it, without anything inside a privacy zone. Until now a road could only come from a planned route's Share.
- Code: `fromStage` in web/roadbooks.js (`fromTrack` takes the trim as a third argument; a stage trims nothing); `stages` passed from web/cockpit.js.
- Tests: tests/test_roadbooks.py `test_a_stage_goes_into_a_roadbook_as_marked_without_the_zones`; e2e "roadbooks: one of your stages goes into your roadbook" (fails on main). APP_REVIEW 1.2 roadbooks row says a road can be a saved stage.
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).

# CALL SHEET

## 2026-11-14 A stage keeps its ends (free roamer B)
- What: a stage goes into a roadbook from its first point to its last, while a planned route loses its first 400 m (and a loop its last 400 m).
- Why: a route starts where you were when you planned it, often home; a stage is a stretch of road you picked yourself. Privacy zones are still cut out of both.
- Undo: pass `TRIM_M` instead of `0` in `fromStage`.
