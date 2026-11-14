# STATE

## Session 2026-11-13 (carplay stops): add a café, fuel or charger stop from the car (claude/project-thread-me97iw)
- Apple Maps and Waze let the driver add a gas or coffee stop on the car screen mid-route; Vetta already knew the cafés, fuel stations and chargers along the route (the scenic list) but the car could only show them. While guiding a route, the map's bar has a Stops key; it lists those places ahead (at most 8, from 150 m on, by name and distance, `stopsMessage` in web/carplay.js) and a tap adds the place as a via at its spot on the route (`addViaAt`), as the phone's route stop does. Nothing ahead: "No stops ahead".
- Next: TestFlight on Nate's car; rerouting quality in the car.

# CALL SHEET

## 2026-11-13 (carplay stops): only the places already found along the route, not a search (claude/project-thread-me97iw)
- Why: the route already carries named cafés, fuel and chargers from map data; listing them needs no network or new query, and a pick is always on the route, so the detour is small. A free search for a stop belongs to Where to?.
- Undo: drop the Stops bar button in `driveStarted` (CarPlay/ApexCarPlay.swift).
