# STATE
## Session 2026-11-12 (roam-c offline-first-launch): a first launch with no signal still draws our layers (claude/roam-c-offline-paper)
- Cause of "in a free drive with no tiles the map shows no position arrow or trail": on a phone that has never kept the base
  map's style (offline_tiles.js keeps it as it arrives), the style fails, the map never loads, and none of our layers (route,
  ribbon, corners, hazards) were ever added. The arrow itself is a DOM marker and did show.
- web/cockpit.js: when the style itself fails before the first load, the map takes an empty style (our layers on the paper);
  `online` with a style that fetches, and no drive on, reloads (the planned route is kept by restorePlanned).
- e2e "the main map: with no signal" checks our layers load on the paper. "along the route by name" now feeds a fix at
  the route's start in its drive: it raced the stamps' arrival and passed only while the map never loaded.
- Next: the reload on signal has no e2e of its own (it needs a style fetch to succeed after an offline start).

# CALL SHEET
## 2026-11-12 (offline-first-launch): no base map on a first launch offline: our layers on plain paper (claude/roam-c-offline-paper)
A phone opened for the first time with no signal used to get a map that never loaded: no route line, no trail, no corners,
for the whole session. Now it loads an empty map (the paper colour) so everything of ours draws, and reloads by itself
once signal is back if no drive is on. Undo: drop the paperOnly block after the `online` listener in cockpit.js.
