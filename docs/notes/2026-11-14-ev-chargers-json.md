# STATE
## Session 2026-11-14 (EV chargers on a plan): chargers read from the app's API at last (claude/roam-c-ev-chargers)
- web/route_ctx/car.js read the app's `apiGet` (cockpit.js routeCtxOpts) as a fetch Response (`r.ok`, `r.status`, `r.json()`), but it answers the parsed JSON or null. So in the app every `/api/chargers` answer was treated as missing: an electric car's plan always said its chargers couldn't be loaded, even with the NREL key set. The tests stubbed a Response, which is why nobody saw it.
- car.js now takes either shape. A Response with 503 still says "no-key". The app's getter can't tell no-key from down (both are null), so that case shows the general "couldn't load" note, which is still honest. tests/test_route_ctx_car.py covers JSON, Response and null.
- Next: whether NREL_API_KEY is set on the Worker is the owner's (docs/OWNER_TODO.md). Without it, chargers stay unknown.

# CALL SHEET
## 2026-11-14 (EV chargers): accept both answer shapes in car.js instead of changing the app's apiGet (claude/roam-c-ev-chargers)
Every other provider (osm_overpass.js relay, router_edges.js) already expects JSON from `apiGet`, so changing the getter would have broken them. Undo: revert the three lines in `stationsFor`.
