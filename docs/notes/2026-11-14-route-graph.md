# STATE

## 2026-11-14: A saved route keeps our road network along it
- Done: saving a route for offline now also keeps Vetta's own road-network tiles within 2 km of it (`web/graph_tiles.js prefetchAlong` / `tilesAlong`, the same IndexedDB keep as a saved area's `prefetchArea`), so a reroute with no signal on the way (`reroute` uses our router offline where its tiles are on the phone) has roads to route on. Before, only a saved area kept them; a saved route kept the map and terrain but not the network. The area record's `graphTiles` counts them. Only tiles our network covers are asked. Tests: tests/test_graph_tiles.py (a route's own tiles only; both sides of a tile edge), tests/test_offline_tiles.py.
- Next: none here.

# CALL SHEET

## 2026-11-14: 2 km either side, sampled every 500 m
- What: the network tiles kept for a saved route are those within 2 km of its line, sampled every 100 points (500 m).
- Why: tiles are 0.25° (about 25 km); 2 km covers a detour off the line at a tile edge without taking the route's whole bounding box (a diagonal route's box can be four times the tiles it uses).
- Undo: drop the `prefetchAlong` line in web/offline_tiles.js download.
