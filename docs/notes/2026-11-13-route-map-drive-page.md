# STATE
## Session 2026-11-13 (roam-c route-map-drive-page): a drive's page map opens offline over a saved route's map (claude/roam-c-route-map-drive-page)
- Done: the map kept along a saved route (#591) records the route's box; drive_basemap.js `covered` counts it for a
  drive that stayed inside that box (padded by the corridor), so with no signal a drive along a saved route gets its map
  on the drive page instead of the "unavailable offline" panel. Discs round a point work as before.
- Tests: tests/test_drive_basemap.py (inside, leaving it, a bad box); the route-map e2e checks the box.
- Next: a box is coarse; a drive that wanders off the corridor inside it draws blank tiles there.
