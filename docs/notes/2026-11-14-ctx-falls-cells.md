# STATE
## Session 2026-11-14 (waterfalls and closures by cell): the lower 48's waterfalls and seasonal closures (claude/roam-c-ctx-falls-cells)
- Waterfalls (scenic.js) and conditional-access closures (conditional_closures.js) came from falls.json and closures.json, one file each for OH/KY/IN. The lower-48 build has no single file, and the phone shouldn't download the whole country's.
- tools/osm_ctx/region.py `with_lists` now also writes them into each cell's points file, as "falls" [[lat, lon, name]] and "closures" [[lat, lon, {tags}]]. Both workflows' builds do this.
- On the phone, cockpit.js `cellList` asks `/api/ctx/points?cells=` for the 0.25° cells round the route. Both lists share one request (scenic.js `cellsIn`, `cellsDoc`), and the answer is read by the existing fallsInRegion and inRegion. If a cell is missing or has no list, the phone uses the region file, then Overpass.
- APP_REVIEW (route context row) and privacy.html now say these go by cell ids.
- Next: once osm-ctx-us.yml has run, spot-check a planned route in the Smokies: "falls" in a cell's points file, and the route card's Along line.

# CALL SHEET
## 2026-11-14 (waterfalls and closures by cell): in the points files, not new files (claude/roam-c-ctx-falls-cells)
The points file is already asked for along every route, so this adds no request, no endpoint and no upload, and older app builds ignore the new keys. It costs a few hundred bytes per cell. Undo: drop the cellList calls in cockpit.js; the region file and Overpass work as before.
