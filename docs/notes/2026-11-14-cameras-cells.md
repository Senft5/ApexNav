# STATE
## Session 2026-11-14 (cameras by cell): Avoid cameras across the lower 48 (claude/roam-c-cameras-cells)
- Avoid cameras read our own list only inside OH/KY/IN (cameras.yml region.json). Everywhere else the phone asked Overpass, which mostly times out ("the camera server always says it's down").
- tools/osm_ctx/region.py `read_cams` writes plate readers and speed cameras into each cell's points file as "cams" [[lat, lon, "a" | "s"]], the same classification as cameras.py. region.filter gains `n/surveillance:type=ALPR n/highway=speed_camera`, so both OSM workflows build them.
- web/cameras.js `load`: kept tiles first, then region.json, then `/api/ctx/points?cells=` for the tiles left (40 a request, `pointsTiles`), then Overpass for whatever is still missing.
- APP_REVIEW (cameras row) and privacy.html updated.
- Next: after the next osm-ctx-us.yml run, plan a route with Avoid cameras in the Smokies or near Chicago and check that no Overpass request goes out.

# CALL SHEET
## 2026-11-14 (cameras by cell): cameras.yml stays (claude/roam-c-cameras-cells)
region.json still answers OH/KY/IN in one request with nothing about the route, so it stays first. The cells only cover the rest. Undo: pass `points: null` in cameras.js load, or drop the block.
