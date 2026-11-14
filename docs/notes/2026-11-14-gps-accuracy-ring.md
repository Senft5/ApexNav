# STATE

## 2026-11-14 GPS accuracy ring on the idle map (claude/project-thread-5sbga7)
- Done: on the idle map, a faint ring around your arrow is as wide as the fix's accuracy, as Apple and Google Maps draw it. A sharp fix (ring under the arrow) shows none. A fix with no accuracy shows none, since unknown stays unknown. It follows the arrow and the zoom, and goes in a drive or a replay. It works from the app's own fixes (accuracy_m) and the browser's.
- Tests: tests/test_gps_halo.py (metres per pixel, radius by accuracy and zoom, nothing for unknown). e2e "GPS accuracy" gives a 120 m fix, checks the ring's width and that it is neither tappable nor read aloud, then gives a 4 m fix and checks the ring goes.

# CALL SHEET

## 2026-11-14 The accuracy ring in ink, not red
- What: web/gps_halo.js gives the radius. cockpit.js puts a map-flat Marker (.gps-halo) under the puck. It is painted in the panel ink at 12 %, with a 40 % hairline edge.
- Why: in Vetta, red means act now. The ring is only "about here".
- Undo: drop the halo Marker and paintHalo in cockpit.js, or change the colours in index.html .gps-halo.
