# STATE
## Session 2026-11-15 (scenic byways): designated scenic roads count as scenic in Fun's own search (claude/project-thread-39xbx9)
- Done:
  - tools/graph_etl/osm_graph.py reads OSM's route=road relations. bywayLevel is ported from web/route_ctx/osm_overpass.js: 2 for a National Scenic Byway or All-American Road, 1 for another scenic byway or a way's own scenic=yes, 0 for none.
  - The level goes into a new tile road channel, `byway` (tools/graph_etl/tiles.py CHANNELS and web/graph_tiles.js, added at the end, so older readers skip it).
  - web/graph_router.js objectiveOf counts a byway edge at least BYWAY_S scenery: 0.75 for a scenic byway, 0.9 for a national one.
  - The app's ranking already gave byways a bonus (route_engine.js byway, 0.4 points a km), but only to candidates the router found. Until now the router's search never sought them.
- Why: tools/famous_roads.js, 2026-11-15. The Talimena and the Blue Ridge Parkway sweep more than they wind, so they have fewer corner points a km than the roads beside them. Fun took US 59 and US 270 off the Talimena (0.47 of the route on it, against 0.67 for the best candidate), and US 221 off the Parkway. Their scenery from land cover was no higher than the other roads' (0.54 against 0.56).
- Takes effect with the next graph build: the monthly run on 2026-12-01, or a manual graph-us run. Tiles built before it have no byway channel, so nothing changes on them.
- Next: after that build, rerun tools/famous_roads.js (parkway, talimena, skyline, sun, beartooth, bigsur) and check that state byways don't pull Fun off better roads. If they do, lower BYWAY_S[1].

# CALL SHEET
## 2026-11-15 (scenic byways): a byway's designation is a scenery floor in the search, not a measurement
The tiles' scenery channel is unchanged: it stays what land cover and terrain say. Only the router's objective lifts a byway edge's scenery, to 0.75 or 0.9 when it is lower. Designation is the road authorities' and riders' own judgment of the view, which land cover misses on ridge roads. At Fun's weights 0.9 is worth about 0.07 goodness, and a curvier road beside it still wins when its extra corners outweigh that. Undo: set BYWAY_S in web/graph_router.js K to [null, null, null], or drop the channel read.
