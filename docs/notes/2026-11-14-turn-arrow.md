# STATE

## 2026-11-14 Turn arrow on the drive's map (claude/project-thread-5sbga7)
- Done: while a route is driven, its next turn has an arrow on the map, as Apple and Google Maps draw one. The arrow is the route's own line through the junction, from about 70 px before the turn to 40 px past it, with a head pointing the way the route leaves. It's drawn in the theme's paper inside the route's ink, so it stands out on the route line in day and night. It shows from 2 km out until the turn is taken, keeps its size on screen as the drive's camera zooms with speed, and goes off the route. An arrival has none (the destination has its pin).
- Tests: tests/test_turn_arrow.py covers the geometry: the shaft passes through the corner, the head points the way out and is square to it, a turn near the end is cut short, and there's no arrow for an arrival, a step off the track or a run too short. e2e "the turn arrow" drives a stubbed route: no arrow while it's only planned, the arrow is at the turn and rendered (shaft and head) before it, and it's gone once the turn is taken. The "turn by turn in road order", "route callouts" and startup budget flows pass.
- Done: a route overview key in a drive, where Recenter sits. A tap shows the rest of the route from where you are to the end, north up and flat. The drive camera glides back by itself after 10 s, and Recenter (which takes the key's place and counts down) brings it back at once. Only while a route is driven.
- Tests (overview): the same e2e flow taps the key and checks the end is in view, with the map flat, north up and not following, and Recenter in the key's place. A tap on Recenter brings the camera and the key back. The "returning driver", "fixed stage", "compass", "Dynamic Type" and "small things" flows pass.
- Next: the CarPlay map (carmap.js) could draw the same arrow.

# CALL SHEET

## 2026-11-14 The turn arrow's look and reach
- What: web/turn_arrow.js, a source and four layers (apex-turnarrow*) over the route in cockpit.js addApexLayers, and paintTurnArrow called from updateNotes with the voice's own next turn (turnProgress).
- Why: the banner says "300 ft, Left" but the map didn't show which junction. Sizes are in pixels (TURN_ARROW_PX) and rebuilt every quarter zoom step, because the drive's zoom runs 14.6 to 16.4 and an arrow in fixed metres would be a sliver at speed. It shows from 2 km out (TURN_ARROW_AHEAD_M), past the first voice call.
- Undo: remove the call to paintTurnArrow in updateNotes (the layers then stay empty), or drop turn_arrow.js and the four layers.

## 2026-11-14 Route overview: 10 s, then back by itself
- What: #overviewBtn and routeOverview in cockpit.js. scheduleResume and recenterLeft take a length (OVERVIEW_S = 10; a drag stays at 6).
- Why: Apple and Google Maps keep the overview until you tap Recenter. In a car built for spirited driving, the map going back to the road by itself is safer, and 10 s is enough to take in a route.
- Undo: remove the key and routeOverview, or raise OVERVIEW_S.
