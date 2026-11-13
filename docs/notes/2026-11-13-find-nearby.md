# STATE

## 2026-11-13 Find nearby in Where to? (claude/project-thread-5sbga7)
- Done: Where to? has three keys under its shortcuts, Gas (Chargers for an electric car), Coffee and Food, as Apple Maps and Google Maps do. A key puts its word in the field, and the list is the nearest of that kind by name with how far, from the map's own tiles (stages.js poisAll, the 'poi' layer at z14): 3 km first, 8 km when that finds fewer than three. Typed words work the same ("gas", "gas station", "coffee near me", "restaurants nearby"), and Enter goes to the nearest. A typed category never falls back to a geocode of the word. An unnamed place says so, in the route Along list's words ("Café, no name on the map"). The listed places are pins on the map too, by name (an unnamed one by its stamp); a tap on one goes there. The sheet comes down to half for the list (`.plan.open.nearby`, as Apple's does) and the map fits the places above it; a farther place's pin waits while a nearer one's covers it. Kept tiles (offline areas, the recent map) answer with no signal. "Nearby" is your position when it is under two minutes old, else the middle of the map.
- Tests: tests/test_nearby.py (words, keys, grid, list order, one row per place, unnamed rows, empty line); e2e "find nearby" (keys, Coffee and its pins, "gas near me", food out of reach, Enter plans to the nearest).
- Next: the car's search could answer "gas" the same way (carplay.js), with the same rows.

# CALL SHEET

## 2026-11-13 Find nearby reads the map's tiles, not a search service
- What: web/nearby.js (pure) plus cockpit.js renderNearby; stages.js exports poisAll (every poi with its class).
- Why: it works offline wherever the map was seen, costs nothing per search, and names the same places the route's Along list and the car's Places do. Apple's search in the app may know more places, but it would answer differently on the website and offline.
- Undo: remove the #nearbyKeys row and the `cat` branch at the top of renderPlaces (and placesFor / goTyped's `near`).
