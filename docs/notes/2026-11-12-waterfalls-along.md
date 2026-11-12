# STATE
## Session 2026-11-12 (roam-a waterfalls): waterfalls along a planned route (claude/project-thread-h7xxmf)

- IDEAS R-24. The map's tiles (OpenFreeMap, OpenMapTiles poi layer) carry no waterfalls (checked on the tiles around
  Looking Glass Falls: only its parking), so web/scenic.js `fallsQuery(s, w, n, e)` asks Overpass for natural=waterfall
  and waterway=waterfall (nodes and ways by centre) and `fallsFrom(json)` gives { kind: 'falls', name, lat, lon }.
  Within 400 m of the road they join the Along line after viewpoints ("1 viewpoint · 2 waterfalls · 1 café"), the
  list ("Waterfall"), and the map as FALLS stamps (blue), ranked after viewpoints when stamps would touch.
- web/cockpit.js `attachScenic` paints the tiles' places first, then repaints with the waterfalls when Overpass answers
  (`fallsNear`: the route's box, ≤ 1° across, every server raced via ApexCameras.fetchFirst; a failure adds none).
  With no tile places (offline) nothing is said, waterfalls or not: unknown fuel is not "no fuel".
- Tests: tests/test_scenic.py (+1); e2e "waterfalls along the route…".
- Next: car-friendly café picks (R-24's last part), or D-16's late-drive cues.

# CALL SHEET
## 2026-11-12 (roam-a waterfalls): waterfalls along the route from Overpass (claude/project-thread-h7xxmf)

Waterfalls near a planned route now show on the route card's Along line, in its list and as FALLS pins. Calls: they come
from Overpass, since the map's tiles have none. That sends the route's bounding box to a public Overpass server, as
seasonal closures and cameras outside our region already do (no account, no drive). Only within 400 m of the road (a
short walk from a pull-off). The tiles' places paint first, so a slow Overpass never holds the card. Undo: drop the
`fallsNear` call in cockpit.js `attachScenic`.
