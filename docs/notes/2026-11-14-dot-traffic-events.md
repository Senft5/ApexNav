# STATE

## Session 2026-11-14 (dot traffic events): the DOTs' closures, roadwork, slow traffic and crashes on the phone and car maps (claude/project-thread-me97iw)
- New Worker route `GET /api/traffic/v1/events.json` (backend/src/traffic.ts): Indiana DOT's CARS events (keyless, public domain), Kentucky's WZDx work zones (keyless) and, once the owner sets `ohgoApiKey` in CTX_KEYS, Ohio's OHGO incidents and construction, compacted to one short row each (kind, label, point, road, end, agency, a heading for one-way events) and cached 5 min at the edge. Truck-only restrictions, shoulder and rest-area closures and events not yet begun are left out. On 2026-11-14's live data that is 483 events, 70 KB.
- The phone (web/road_events.js) asks for the whole region every 5 min while planning or driving, signed in or not, never sending a position. What is near (closures and the like within 20 km; roadwork and lane closures within 3 km, so a city isn't a wall of cones) joins the drivers' reports with `official: true`: pins in the event's own word, the hazard plate with road and agency ("in 0.2 mi · IN 114 · INDOT"), the voice says "Lane closed ahead" (never "reported"), the car's hazard plates, and no "still there?" ask.
- Full closures (both ways) are routed round like a reported closure, signed out too, and the route card says "Passes a road closure" (was "a reported road closure").
- Not built: drawing an event's line (the feeds have them), Ohio until the key is set (OHGO's v1 response shape is from its docs, not checked against a live answer), slow-traffic flow (Apple's MKDirections monitor, web/traffic.js, already covers that on iOS).
- Next: check on Nate's phone near a real INDOT closure; then draw closure lines on the map.

# CALL SHEET

## 2026-11-14 (dot traffic events): official traffic from the DOTs' free feeds, no paid source (claude/project-thread-me97iw)
- Why: the coordinator asked for a free live traffic or incident source. INDOT and KYTC are keyless and free; OHGO is free with the key slot the owner already has on his list. TomTom's free tier needs a signup and has limits; nothing was signed up for.
- One-way closures and lane closures are shown but never routed round: a point can't tell the router which way is shut, and excluding both ways of an interstate would send drivers on a big detour for nothing.
- Undo: drop the `/api/traffic/v1/events.json` route (backend/src/index.ts) and the `loadRoadEvents` calls in cockpit.js; everything else then sees an empty list.
