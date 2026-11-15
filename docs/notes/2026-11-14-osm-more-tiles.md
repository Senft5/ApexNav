# STATE
## Session 2026-11-14 (OSM more tiles): a plan asks the relay for up to 36 tiles (claude/roam-c-osm-more-tiles)
- A plan asked for at most 12 OSM tiles (0.05°), most-used first, so a long fun route (a 100 km route crosses 30 or more) had its limits, signals, signs and guard rails on part of it only. The relay now answers built tiles in about 0.5 s each, in parallel (#813), so the relay path takes up to `RELAY_MAX_TILES` = 36; what it doesn't have goes to Overpass under the old cap of 12.
- Size, from the Cincinnati block (the densest): a median tile is 42 KB gzipped, 220 KB of JSON; 90th percentile 176 KB and 1 MB.
- Next: watch plan times in app health once the relay is in use on phones.

# CALL SHEET
## 2026-11-14 (OSM more tiles): 36 tiles a plan from the relay (claude/roam-c-osm-more-tiles)
Three times the old cap for three times the route covered; still at most a few MB a plan on rural roads. Undo: set RELAY_MAX_TILES back to 12 in web/route_ctx/osm_overpass.js.
