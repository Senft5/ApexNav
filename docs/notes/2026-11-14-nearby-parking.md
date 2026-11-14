# STATE

## 2026-11-14 Find nearby has Parking (claude/project-thread-5sbga7)
- Done: Where to? now has a Parking key beside Gas, Coffee and Food (five keys across with Best roads nearby). Typing "parking", "car park" or "parking garage" gives the same list. It lists the nearest car parks by name from the map's own tiles (OpenMapTiles poi class parking, never bike stands), with the open-now line, photos and pins the other kinds have. An unnamed lot says "Parking lot". The car's Places heads with the same four kinds, so CarPlay gets Parking too. "park" alone still searches places, since a park is a place.
- Tests: tests/test_nearby.py (the keys, the words, car parks only, unnamed is "Parking lot", "park" and "Eden Park" are not parking). e2e "find nearby" checks the four keys; e2e "CarPlay feed" checks the car's four kinds.

# CALL SHEET

## 2026-11-14 Parking as a fourth nearby kind
- What: nearby.js CATS.parking and keys() returning four kinds. Where to?'s key grid goes from four columns to five.
- Why: a drive to somewhere new ends with "where do I leave the car". Apple Maps has the same key, and the map tiles already carry car parks, so nothing new is fetched.
- Undo: drop 'parking' from nearby.js keys() (and the grid back to four columns in index.html .plan-keys).
