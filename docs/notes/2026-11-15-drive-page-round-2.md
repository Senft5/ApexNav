# STATE

## 2026-11-15 Drive page round 2, from Nate's own drives
- Done: the Corners line names the drive it is measured from by its day, never its Score ("3.5 s slower than your other drive here (Yesterday, 10:58 PM)"; it said "your best drive here (668)" on a 737). Your records come in two groups, one unit each: Scores (out of 1000) and Feats (out of 100, and a run in corners); no more %. Where to find time says "Against your best passes, <day>" once over the list when one drive holds them all. A drive is named after its twistiest road (road_names.js driveRoad: the road it turned most on, 120° at least, else the road it drove longest, 300 m at least), live, recovered and imported; a route named only for where it went ("To 10069 Pebble Ridge Ln") gives way to the road. Rhythm's meaning on a tap came with round 1. Tests: tests/test_road_names.py, tests/test_drive_view.py, e2e "Your records: unknown dates".
- Next: drives already saved as "Drive 11/14/2026 9:35 PM" keep that name (the Log has no map tiles to read roads from); rename them the next time the map page opens them, as an import's stand-in name is. A routed drive could show its destination as a small line under the road.

# CALL SHEET

## 2026-11-15 The reference drive is named by its day
- What: "than your other drive here (day)" in place of "your best drive here (Score)". Why: the reference is the best-scoring other drive, which is not the quickest; a Score beside a time read as best = slower. Undo: drive_view.js the Corners line; analysis_client.js reference.when.

## 2026-11-15 Twistiest road names the drive
- What: the road turned most on (120° at least) names a drive, else the longest (300 m at least), with no "a third of the drive" rule. Why: drives that start on city streets were never named. Undo: road_names.js driveRoad (mainRoad is still there).
