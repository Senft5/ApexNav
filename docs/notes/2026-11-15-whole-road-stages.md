# STATE
## Session 2026-11-15 (whole-road stages): a mountain road is one stage, not pieces (claude/project-thread-39xbx9)
- Done: web/graph_router.js explore. A chain now keeps going along its own road through cornerless edges (a tunnel, a straight), up to STAGE_GAP_M (4 km) of them in a row. It also follows the same road on under another name (same class, nearly straight on) and a same-named hairpin at a junction. After that, joinStages joins chains that meet end to end across up to STAGE_JOIN_M (6 km) of plain road. Loop legs along a stage are capped at LOOP_ALONG_N (10) points.
- Result (Best roads nearby, live tiles): Million Dollar Highway 33 km (was 4 km pieces), Cherohala Skyway 41 (26), Blue Ridge Parkway 43 (16), Angeles Crest 39 (24), Colorado 103 36 (11), Vanocker Canyon 27 (4). Loop survey: better in Asheville, Cincinnati, Lexington, Athens, LA, Moab, Monterey and Robbinsville (retraced 0.34 to 0.03). Worse in Sturgis (7.5 km of gravel on a connector, was 2.3), Golden (0.596 to 0.561) and the best of Austin and Roanoke.
- Next: Ouray loops still cross 4x4 passes (44 to 72 km unpaved) with unpaved avoided. No paved loop under about 350 km exists there, so they should say so (or offer the Million Dollar Highway out and back) instead.

# CALL SHEET
## 2026-11-15 (whole-road stages): join a road's pieces into one stage
A rider names a road, not its 4 km pieces, and loops built from pieces kept dropping the famous road for county lanes. Loops in Sturgis and Golden came out a little worse in the survey. That trade is taken for Best roads nearby, where whole roads are the point. Undo: drop joinStages and set STAGE_GAP_M to 0 in web/graph_router.js.
