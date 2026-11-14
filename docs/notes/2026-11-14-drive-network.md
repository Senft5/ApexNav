# STATE
## Session 2026-11-14 (drive network): our road network along a planned route kept as the drive starts (claude/roam-c-drive-network)
- Done: a drive on a planned route keeps our routing tiles within 2 km of the whole route (graph_tiles.js `keepAlong`, bytes only, one tile at a time, kept tiles skipped), 5 s after the start and only with signal, own routing on and `apex.ownWarm` not '0'. A reroute in a dead zone 40 km on then still has roads; the 15 km warm round the driver didn't reach that far. Shared `keepTiles` with `keepArea`.
- Tested: tests/test_graph_tiles.py (keepAlong), e2e "reports ahead of a dead zone" waits for `apexDebug.keptAlong`.
- Next: none for this; watch storage on long routes (a 300 km route is roughly 10-20 tiles).

# CALL SHEET
## 2026-11-14 (drive network): the timer checks the route is still the current one, not that the drive is still on (claude/roam-c-drive-network)
The browser drive ends at once without location permission, so a driveActive check never ran the keep in e2e; a route still on screen is what matters. Undo: check `driveActive` in `keepNetworkAlong`'s timer in web/cockpit.js.
