# STATE

## Session 2026-11-14 (dot route ahead): early word on a crash or closure on the route ahead (claude/project-thread-me97iw)
- Driving a planned route, a DOT crash or one-way closure that the route drives through, your way (the event's heading within 70 degrees of the route's), 1 to 20 km ahead, is offered once with Go round on the phone and the car: "Crash on your route in 4.1 mi." Slow traffic there is said once. Before this they were only called 600 m out, too late on a highway. web/road_events.js `onRouteAhead`, cockpit.js `dotAheadTick`.
- Go round adds the point to the session's own avoids (`avoidPoints`), so the public router excludes it as well as our own.
- Ohio (OHGO), checked against its live answer with the owner's key 2026-11-14: incidents (crashes and repair closures, 16 at night) and construction (498), plus travel-delays and dangerous-slowdowns (both empty at night, parsed from OHGO's docs) as Slow traffic / Sudden slowdown / Traffic stopped. The key is read from `OHGO_API_KEY` (a secret of its own) or CTX_KEYS `ohgoApiKey`; `/api/ctx/keys` hands the route context the same one.
- Next: once the owner adds the secret, check `/api/traffic/v1/events.json` lists ODOT; TestFlight check near a real event.

# CALL SHEET

## 2026-11-14 (dot route ahead): only crashes and one-way closures get Go round; slow traffic is just said (claude/project-thread-me97iw)
- Why: a crash or a shut carriageway means stopping; slow traffic is already timed by Apple's traffic check (web/traffic.js), which finds detours itself. Lane closures and roadwork are too common to offer each.
- Undo: drop the `dotAheadTick(me)` call in feedReported.
