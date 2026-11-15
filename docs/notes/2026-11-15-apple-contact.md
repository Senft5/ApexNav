# STATE

## 2026-11-15 roam C: place cards get Apple's phone and website in the app
- A single tapped place whose OpenStreetMap tags lack a phone or website asks the shell (`placeContact`: MKLocalSearch for the name within about 400 m, the nearest same-named result within 150 m); `ApexPlaceInfo.withApple` fills only what OSM lacks. Hours stay OSM's (MapKit gives apps no hours). Lists (Find nearby, along the route) are unchanged: one search per tap only.
- Next: on the next TestFlight build, tap a chain restaurant OSM has no phone for: Call should appear after a moment.

# CALL SHEET

## 2026-11-15 roam C: Apple fills a place card's missing phone and website
- What: web/cockpit.js showPin asks `placeContact` after the OSM lookup when phone or website is missing; ApexNavApp.swift answers.
- Why: US businesses on OSM often have no phone or website; Apple's map has them, free, no key.
- Undo: drop the `askNative({cmd:'placeContact'...})` block in showPin.
