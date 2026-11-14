# STATE

## 2026-11-14 Conditions-aware analysis, step 1: each drive keeps its road surface
- Done: a drive now keeps the worst road surface seen on it as `d.surface` ('dry' | 'wet' | 'ice'), from two sources. One is the weather where you are, as before (wet_roads.js). The other is new: ODOT's road weather sensors within 8 km of you, the traffic feed's wet and icy sites (web/road_surface.js `sensorAt`), looked at every 30 s. A sensor's wet or icy road now also brings the notes earlier and is said once, as rain already did. Unknown is left out, never "dry". The drive page's note line says "Wet road" / "Icy road". The summary carries `surface`. Tests: tests/test_road_surface.py, e2e "a wet road from ODOT's sensor".
- Done (step 2, like with like): your best pass on a road (pass_coach.js build) is only ever a dry or unknown pass, never a wet one. On a wet or icy road (`setSurface`, from noteWet), the live coach gives no time gap and no "brake later". With full notes on, it says once: "Wet today. Your best here was dry." (or the icy line). The road memory's "Brake later here." is not said on a slick road either. The Log's corner comparisons (analysis_client.js coachOf, which feeds the corner table, Your best yet and the coach line) set a wet pass only against your other wet ones. Tests: tests/test_pass_coach.py, e2e "your best pass on a wet road".
- Next: a wet pass shown as such in "This road over time" (a Wet tag on its row and point), and a "fastest wet pass" beside the dry best once a road has two wet passes.

# CALL SHEET

## 2026-11-14 A wet or icy road counts only with the same; dry and unknown together
- What: `alike` keeps wet passes with wet ones, and dry or unknown passes together. Why: nearly every drive before today is unknown, and nearly all of those were dry. Treating unknown as unlike would empty every comparison. Undo: road_surface.js `alike`.

## 2026-11-14 On a wet road the coach drops time, keeps technique
- What: on a wet or icy road the live coach keeps its technique lines (smoother, cleaner brakes) and the stretch summary in points, but drops the time gap and "brake later". Why: on a wet road, chasing a dry pass's time or braking point is the wrong advice, while smoothness still applies. Undo: pass_coach.js `setSurface` (or stop calling it in cockpit.js feedCoach).
