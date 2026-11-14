# STATE

## 2026-11-14: The car's map works with no signal where the phone has the map saved
- Done: CarPlay's native map (MapLibre Native, CarPlay/ApexCarMap.swift) couldn't read the map areas and route maps the phone saved for offline. Those live in the page's IndexedDB, so with no signal the car screen went blank even where the phone had the map. New `CarPlay/ApexCarOffline.swift` keeps a MapLibre offline pack for each saved area, built from `web/offline_tiles.js packOf`: a disc area's box, or a route's corridor as z13 squares (the kept line walked every 500 m), z8-14. The page sends the whole list on every change to the areas list, on Delete offline data, and at launch (`cmd: "offlinePacks"`). The shell adds new packs, resumes unfinished ones, replaces a pack when its area is updated (a new `at`), and removes packs for deleted areas. It only does this on a phone that has been connected to a car, and the first connection catches up on every area saved before. Tests: tests/test_offline_tiles.py (`packOf`: the corridor is covered, an old record falls back to its box; the wiring). Swift is compiled by CI only, so the first TestFlight build is the real check.
- Next: on the next TestFlight build, save an area, connect CarPlay with signal, then turn on airplane mode and check that the car map still draws there. The packs' size isn't shown in Your data yet.

# CALL SHEET

## 2026-11-14: The car's offline packs only on a phone that has met a car, on any network
- What: the packs are kept only once CarPlay has connected to this phone, and they download on whatever network the phone has then.
- Why: they fetch the same tiles a second time (MapLibre Native has its own store), so a phone that never meets CarPlay shouldn't pay for them. Waiting for Wi-Fi would leave the car map blank on the very drive a route was saved for.
- Undo: guard `reconcile()` with a Wi-Fi check (NWPathMonitor `isExpensive`), or drop the `carConnected()` call in ApexCarPlay.swift to stop keeping packs at all.
