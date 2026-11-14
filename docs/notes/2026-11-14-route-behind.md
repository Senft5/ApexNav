# STATE

## 2026-11-14 The route behind you fades in a drive (claude/project-thread-5sbga7)
- Done: while a route is driven, the part already driven is drawn faint (the route's ink at 30 %), as Apple and Google Maps draw it, so the line on the map is the way still to go. The turn arrow now shows only in a drive or a replay, and the arrow, the faded part and the overview key all clear when the drive ends.
- Tests: tests/test_route_reveal.py covers the gradient: faded before the car, the route's colour from it, #rgb and #rrggbb, and none for a named colour or no progress. e2e "the turn arrow and route overview" checks the gradient steps where the car is, and that after End the whole line is back with no overview key. Full pytest passes, along with the "startup budget", "route callouts", "doubles back", "fixed stage" and "route overview" flows.

# CALL SHEET

## 2026-11-14 Faded, not removed
- What: paintBehind in cockpit.js puts a line-gradient on apex-route and apex-route-casing (ApexReveal.behind), set once per 0.1 % of the route. Routes drawn by sector (DNA colours) are left as they are.
- Why: Apple removes the driven part and Google greys it. Faint keeps a doubled-back or looping route readable.
- Undo: remove the paintBehind call in updateNotes.
