# STATE

## 2026-11-14 Drive them all on a roadbook (free roamer B)
- Done: a roadbook with two or more roads has a "Drive them all" key. It plans one drive from where you are through its roads, nearest first, each from its nearer end, the next road from where the last one ends, and the card says "3 roads of its 4 from Smokies day out, nearest first: 84 mi". The route keeps shaping stops on the roads, so a reroute stays on them. It is routed the way Best roads nearby drives a stage (our router first, then the Quick level), never a guessed road.
- Code: `tour` in web/roadbooks.js, `driveBook` in web/cockpit.js.
- Tests: tests/test_roadbooks.py `test_drive_them_all_goes_nearest_first`; e2e "roadbooks: Drive them all" (fails on main).
- Next: Drive it on a single roadbook road could lead from where you are to its start too, as Drive it on a post does since #797.

# CALL SHEET

## 2026-11-14 Four roads at most, 150 km to the first, 80 km between (free roamer B)
- What: Drive them all takes at most four roads (the public router's ten stops), a first road within 150 km of you, each next within 80 km of the last one's end; roads out of reach are left out and the card says "of its N". With fewer than two in reach it says to drive them one at a time.
- Why: one drive, not a road trip planner; the stops cap keeps it on Valhalla's public server too.
- Undo: drop `driveBook` from the roadbooks mount in web/cockpit.js (the key goes with it).
