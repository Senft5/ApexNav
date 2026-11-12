# STATE

## Session 2026-11-12 (CarPlay places by name): the car's route preview names the cafés and fuel along it (claude/project-thread-me97iw)

The car's route preview now names the cafés and fuel stations along the picked route ("Café: Bean There Coffee · Fuel: Shell, Speedway +2"), from the same places the phone's route card lists (web/scenic.js along). The page sends a new `along` message (web/carplay.js `alongMessage`, full and short lines) after every route it sends the car and when the places come in (cockpit.js `carAlong`); ApexCarPlay.swift puts it on the picked route choice's additional information, longest variant first, the detail alone last. Unnamed places are only counted. Tests: tests/test_carplay.py, e2e "CarPlay feed". Next: the same places as named plates on the car's map.

# CALL SHEET

## 2026-11-12 (CarPlay places by name): the names ride on the route preview's info line, not a list template (claude/project-thread-me97iw)

What: the names ride on the picked route choice's additional information line in CarPlay's trip preview, not a separate list or map plates. Why: it is where a driver looks before Drive, needs no new template or control (navigation-app template rules), and falls back to the detail alone if the car has no room. Undo: drop `case "along"` in CarPlay/ApexCarPlay.swift (the preview goes back to the detail alone); the page's message is harmless without it.
