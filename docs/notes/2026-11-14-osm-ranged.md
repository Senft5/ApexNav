# STATE
## Session 2026-11-14 (OSM ranged bundles): a built tile is two small R2 reads (claude/roam-c-osm-ranged)
- v1 bundles were one gzip stream the relay read up to the asked line: 0.6 to 6.8 s for the first tile of a bundle on prod (a city bundle is 5 MB, 30 MB of text). v2 (`osm/v2/<bi>_<bj>.bin`) is a 4 KB JSON header of [offset, length] per tile, then each tile as its own gzip member; the relay reads the header (kept 10 min per isolate) and the one member.
- After merge: run osm-ctx.yml on main (v2 bundles), time a cold tile, then delete the 562 `osm/v1/` objects (nothing reads them).

# CALL SHEET
## 2026-11-14 (OSM ranged bundles): v2 replaces v1 outright (claude/roam-c-osm-ranged)
No dual-format relay: until the first v2 build lands (about 12 minutes after merge) the relay finds no index and does what it did before the build (Overpass, then the phone's own query). Undo: revert; the v1 objects stay in R2 until deleted.
