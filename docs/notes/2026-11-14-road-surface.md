# STATE

## 2026-11-14 Conditions-aware analysis, step 1: each drive keeps its road surface
- Done: a drive now keeps the worst road surface seen on it as `d.surface` ('dry' | 'wet' | 'ice'), from two sources. One is the weather where you are, as before (wet_roads.js). The other is new: ODOT's road weather sensors within 8 km of you, the traffic feed's wet and icy sites (web/road_surface.js `sensorAt`), looked at every 30 s. A sensor's wet or icy road now also brings the notes earlier and is said once, as rain already did. Unknown is left out, never "dry". The drive page's note line says "Wet road" / "Icy road". The summary carries `surface`. Tests: tests/test_road_surface.py, e2e "a wet road from ODOT's sensor".
- Next (step 2): like with like. pass_coach.js build and coach() comparisons skip passes on a different surface (road_surface.js `alike`). With full notes on a wet or icy road, where your remembered best was dry, the co-driver says once: "Wet today. Your best here was dry." There is no time gap or "brake later" against a dry pass on a wet road.

# CALL SHEET

## 2026-11-14 A wet or icy road counts only with the same; dry and unknown together
- What: `alike` keeps wet passes with wet ones, and dry or unknown passes together. Why: nearly every drive before today is unknown, and nearly all of those were dry. Treating unknown as unlike would empty every comparison. Undo: road_surface.js `alike`.
