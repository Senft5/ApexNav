# STATE

## 2026-11-14 the arrival says which side of the road the destination is on (claude/project-thread-5sbga7)
- Done: on arrival, directions now say "Your destination is on the right" (or left) instead of "Arriving at your destination", as Apple and Google Maps do. The strip's last junction reads "Destination on the right", and its tulip draws the flag off to that side of the road. CarPlay's maneuver says the same, since it uses phrase(). The side comes from Valhalla's own arrival types (5 right, 6 left) when it planned the route. Otherwise directions.js arrivalSide() works it out from where the place asked for (request.to) lies against the route's last 25 m. Nothing is said when the place is straight ahead, within 6 m of the road, over 200 m from the route's end, or the route is a loop.
- Voice packs still play their recorded "Arriving at your destination." (nav:arrive). New side lines need tools/voicebank.py to render them, which belongs with the voice work. The phone's own voice, captions and CarPlay text say the side.
- Tests: tests/test_arrival_side.py (left, right, either heading; ahead, on the road and far say nothing; the words said and shown). Existing direction, turn-order, CarPlay and voice-line tests pass unchanged.

# CALL SHEET

## 2026-11-14 the destination's side from geometry when the router doesn't say
- What: cockpit.js markArrival() sets `side` on a route's arrival step once, from the requested destination against the last 25 m of the route.
- Why: our own router (Fun, Long way) gives a bare arrival. Knowing which side to look is the most useful thing in the last 100 m of a drive to somewhere new.
- Undo: drop the two markArrival(track) calls; directions.js then says and shows the plain arrival again.
