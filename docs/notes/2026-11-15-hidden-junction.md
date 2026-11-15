# STATE

## "Hidden junction" where a side road joins out of sight (V-13, 2026-11-15)
- `web/route_ctx/osm_overpass.js`: a point `side_road` where a public road joins the route's road at a node of it (the
  same joins `side_roads_per_km` already counted; driveways are not).
- `web/road_marks.js hidden(t, i)`: a side road is hidden when, 80 m before it (about a stop from 55 mph with a second
  to react), the road you can see ahead (`t.sightM`, the bend and what's beside it) ends short of it. Only those become a
  mark, "Hidden junction" (strip code JUNC). Not at a stop sign (the stop is the call), not at the route's own turn
  (the direction is the call, `ApexDirections.atJunction`), never with unknown sight.
- Like the other marks: planned routes and the free drive's road ahead, the pace notes in Full notes, not in Quiet.
- Voice: `mark:junction` in all three packs (`voicebank.py --rebuild-checked --only`, Whisper heard "Hidden junction").
- Tests: `tests/test_road_marks.py` (hidden or not, driveway, stop sign, glyph), `tests/test_voice_coverage.py`; e2e
  "a hidden junction…" (passes, and fails with the mark off).
- Next: check on a real drive how often it speaks on a wooded back road (the sight there is the cautious 4 m beside the
  road where the land cover is unknown); raise `HIDDEN_M`'s bar if it nags.

# CALL SHEET

## Hidden junction: 80 m of sight, public roads only (2026-11-15)
- What: a side road is called only when you can't see it from 80 m out; driveways and service roads never.
- Why: a car pulling out of a lane you couldn't see is the back-road hazard the map can predict; every junction would be
  noise. 80 m is about a stop from 55 mph with a second to react.
- Undo: drop `side_road` from `marksOf`'s points in road_marks.js (the point in osm_overpass.js is harmless).
