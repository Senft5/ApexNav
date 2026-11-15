# STATE
## Session 2026-11-15 (tile cache): a long trip's tiles stay decoded between asks (claude/project-thread-39xbx9)
- Done: web/graph_router.js host keeps K.TILE_CACHE (160) decoded tiles as a real least-recently-used cache (a hit moves to the back; an evicted tile leaves ready too). Cincinnati to Asheville at Fun decoded 152 tiles for 65 and took 10 s; now 106 and 7 s, and Long way after it decodes 7 instead of 24.
- Next: the graph-us rescore with the lower-48 context grid (osm_from=43629873458).

# CALL SHEET
## 2026-11-15 (tile cache): 160 decoded tiles, about 80 MB at most in the routing worker
A long trip's spine band and corridor together pass 100 tiles; 160 holds both for Fun then Long way. A phone's web view has well over that, and short trips never reach it. Undo: set K.TILE_CACHE back to 64 in web/graph_router.js.
