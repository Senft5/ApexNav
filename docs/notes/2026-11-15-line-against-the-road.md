# STATE

## 2026-11-15 · Your line against the road's own shape
- Done: `core/drive_analysis.py road_turn_offset_m` and its port `web/apex_core.js roadTurnOffsetM`: the centre of your turning (a_lat / v^2 from the motion sensors, weighted over the corner) less the centre of the road's (the curvature of the map's road under you), in metres; < 0 your turning came first. `web/road_line.js` puts a stored drive on the road of our own graph tiles (each bin near a corner projected onto the nearest road, keeping to the road it was on; `graph_router.js` now exports `edgesNear`). `web/analysis_client.js coachOf(..., road)` does it for a drive's page, its coaching sentence and its corner traces (the worker loads road_line.js and the graph scripts only then; cached per drive).
- The early-apex note now also needs the line itself early: `road_off_m <= -15`. No road known (no tile, a bin 20 m from any road): no claim about the line.
- On Nate's 13 drives: his turning is centred a median 1.8 m before the road's (middle half -5.4 to +1.9 m), so no early-apex habit. The speed-based notes went 13 → 2; both left are corners where the line is 17 and 28 m early on the map. Single tightest points repeat to only ~20 m between passes of one corner on a phone; centres to ~10 m, which is why centres are used.
- Matching costs ~0.35 s a drive in node (13 drives, 4.5 s); in the analysis worker, once per drive while jobs keep asking.
- Next: `driver_profile.js` Patient apex / line still reads the slowest point; move its "early" onto road_off_m where the road is known. The cockpit's spoken road memory (road_memory.js) coaches without the road, so it no longer says "an early apex" (it says nothing about the line).

# CALL SHEET

## 2026-11-15 · An early apex is a line, so it needs the line measured
- What: the early-apex tip requires `road_off_m <= -15` (the turning's centre 15 m before the road's) on top of the speed and motion-sensor conditions; without a road it is not given.
- Why: the tip tells you to turn in later, a claim about your line, but it was decided from speed (slowest before the tightest point). Against the road, 11 of 13 such corners had Nate's turning within 10 m of the road's. A validated measurement error, not a softer score: corners whose line is early are still told.
- Undo: drop the road_off_m condition in `_tip` / its JS port.
