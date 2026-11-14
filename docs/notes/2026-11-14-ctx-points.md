# STATE
## Session 2026-11-14 (route context points): fuel stations, schools and places of worship from our weekly build (claude/roam-c-ctx-points)
- Before this, a plan asked public Overpass for every 0.25° tile's fuel stations (route_ctx/car.js, fuel-stop spacing) and its schools and places of worship (route_ctx/events.js, school-run and church traffic). Overpass refused or timed out on most service checks since 2026-11-12, so these often showed nothing. Fuel was never waited for, so the first plan in a new area had no stations at all.
- tools/osm_ctx/region.py now writes `osm/v2/points/<bi>_<bj>.json` = {fuel, schools, worship} as [[lat, lon]] (5 decimals) for every covered cell. osm-ctx.yml filters `nw/amenity=fuel,school,place_of_worship`, and upload_r2.sh uploads them before index.json.
- `GET /api/ctx/points?cells=a_b,...` (up to 40, osm_relay.ts pointCells) returns {cells: {id: {...} | null}}, where null means not covered. Cell files are cached 10 minutes per isolate.
- The phone (ctx_util.js `builtPoints`, through the app's apiGet) asks ours first. Only the tiles it doesn't cover go to Overpass. car.js waits up to 3 s for ours, so a plan inside the region has its stations at once. events.js caches our cells as it caches Overpass's.
- Privacy page and APP_REVIEW route-context row updated.
- Next: lit roads, tunnels and cycle routes (route_ctx/driver.js) are the last per-plan Overpass provider. They need geometry, so per-cell files are bigger.

# CALL SHEET
## 2026-11-14 (route context points): per-cell files, not one region file (claude/roam-c-ctx-points)
About 30,000 points over the region would be a large download for every phone. A plan touches only a few 0.25° cells, so per-cell files are fetched in one batched request. Undo: remove the `builtPoints` calls in car.js and events.js, and the phone asks Overpass as before.
