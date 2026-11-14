# STATE

## 2026-11-14: Where to? searches the map kept on the phone with no signal
- Done: with no signal, typing in Where to? lists towns within about 25 km and places (cafés, fuel, shops: the map's poi layer) within about 4 km of you whose name holds every word typed, nearest first, from the map tiles kept on the phone (a saved area or route, or tiles the map showed lately; `ApexStages.places` / `poisAll` read them offline). Search (Enter) takes the nearest kept match when the map search can't be reached, instead of "Search is offline". A tile that isn't kept is just not searched; nothing leaves the phone. With no match it says "No signal, and no match on the map kept on this phone." Tests: tests/test_offline_place_search.py, e2e "Where to? with no signal…".
- Next: none here.

# CALL SHEET

## 2026-11-14: Offline search radius 25 km for towns, 4 km for places, 6 s cap
- What: the kept-map search looks at z11 place labels within 24 km and z14 poi labels within 4 km of your position (or the map centre), and gives up after 6 s.
- Why: a saved area is 25 km round; poi tiles are small (about 2 km), so a wider poi search reads hundreds of tiles; the cap keeps a weak signal (a tile not kept, asked of the network) from holding Search up.
- Undo: in web/cockpit.js drop `mapSuggest` and its two calls (renderPlaces' catch and resolvePlace's catch).
