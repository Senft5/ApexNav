# STATE

## Session 2026-11-14 (dot route ahead): early word on a crash or closure on the route ahead (claude/project-thread-me97iw)
- Driving a planned route, a DOT crash or one-way closure that the route drives through, your way (the event's heading within 70 degrees of the route's), 1 to 20 km ahead, is offered once with Go round on the phone and the car: "Crash on your route in 4.1 mi." Slow traffic there is said once. Before this they were only called 600 m out, too late on a highway. web/road_events.js `onRouteAhead`, cockpit.js `dotAheadTick`.
- Go round adds the point to the session's own avoids (`avoidPoints`), so the public router excludes it as well as our own.
- Next: TestFlight check near a real INDOT event.

# CALL SHEET

## 2026-11-14 (dot route ahead): only crashes and one-way closures get Go round; slow traffic is just said (claude/project-thread-me97iw)
- Why: a crash or a shut carriageway means stopping; slow traffic is already timed by Apple's traffic check (web/traffic.js), which finds detours itself. Lane closures and roadwork are too common to offer each.
- Undo: drop the `dotAheadTick(me)` call in feedReported.
