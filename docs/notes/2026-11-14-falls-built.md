# STATE
## Session 2026-11-14 (waterfalls built): the region's waterfalls come from our weekly build (claude/roam-c-falls-built)
- Waterfalls along a route (IDEAS R-24) were asked of public Overpass, which timed out or refused on nearly every check from 11-12, so routes showed none. osm-ctx.yml now also writes `osm/v2/falls.json` (tools/osm_ctx/falls.py: natural/waterway=waterfall, one per place, the 0.25° cells wholly inside the states' .poly); `GET /api/ctx/falls.json` serves it from R2 (404 before the first build); the phone asks it once a session and uses it for a route whose box lies in those cells (scenic.js fallsInRegion), Overpass otherwise.
- Next: after merge, run osm-ctx.yml on main and check the count in the run summary and `/api/ctx/falls.json`.

# CALL SHEET
## 2026-11-14 (waterfalls built): one file for the region, asked once a session (claude/roam-c-falls-built)
The phone fetches the whole region's list rather than a box, so the request says nothing about where the route goes. Public OSM data, no sign-in. Undo: drop the `fallsInRegion` branch in cockpit.js fallsNear (Overpass again).
