# STATE

## Session 2026-11-12 (CarPlay places by name): the car's map labels the cafés and fuel along the route by name (claude/project-thread-me97iw)
- web/carplay.js alongMessage now also carries `places` (at most 30, `{at, kind, text}`: the name, or "Café" / "Fuel" when the map has none). ApexCarPlay.swift keeps them as `placePlates`; ApexCarMap.swift draws each as a quiet plate (a cup or a pump, then the name) and web/carmap.js does the same as its fallback (`car.places`).
- They are placed after hazards and corners, so a name never hides a corner; only those within 6 km of the car while driving, all of them in the preview.
- Tests: tests/test_carplay.py, e2e "the sight-line speed rides under the position arrow" (the car map part) and "CarPlay feed".
- Next: nothing open in this area; watch TestFlight for how the plates read on a real car screen.

# CALL SHEET

## 2026-11-12 (CarPlay places by name): café and fuel plates rank below corners on the car's map (claude/project-thread-me97iw)
A corner is something to slow for; a café is not. When plates overlap, the corner shows and the place waits until the map moves. Undo: move `places.filter(near)` ahead of the corners in ApexCarMap.swift placePlates and web/carmap.js placePlates.
