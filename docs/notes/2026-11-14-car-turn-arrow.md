# STATE

## 2026-11-14 The turn arrow on the CarPlay map too (claude/project-thread-5sbga7)
- Done: the next turn's arrow from the phone's drive map (#831) is now drawn on the car's map as well. That covers the native MapLibre map (ApexCarMap.swift), web/carmap.html when it's used instead, and the Dashboard and cluster maps. The page sends `{ kind: 'arrow', shaft, head }` (web/carplay.js arrowMessage) when the turn changes, and empty lists when there's none, and End clears it. It's sized in metres for the car's street zoom (70 m before, 45 m past, a head 32 m wide).
- Tests: tests/test_carplay.py checks the message (lat first, the shaft on the route, empty lists for none) and that every car screen handles it. e2e "the turn arrow and route overview" checks the car is sent the arrow once and then an empty one past the turn. "the sight-line speed" checks web/carmap.js draws it and clears it. Full pytest passes, as do the CarPlay flows and "turn by turn in road order". The Swift compiles only in CI (build-ipa), so check it on the next TestFlight build with CarPlay.

# CALL SHEET

## 2026-11-14 Car arrow in metres, colours from the car's palette
- What: CAR_ARROW in cockpit.js, the car-arrow* layers in ApexCarMap.swift and carmap.js, and a "car-arrow" case in ApexCar.receive.
- Why: the car's camera zooms less than the phone's, so a fixed metre size is simpler than resending at every zoom. Its paper is the palette's `bg` and its edge is the route's ink, as on the phone.
- Undo: stop sending it (remove the carArrow call in paintTurnArrow). Both car maps then draw nothing.
