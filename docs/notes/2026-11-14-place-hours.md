# STATE

## 2026-11-14 a place's card says if it is open, with Call and Website (claude/project-thread-5sbga7)
- Done: a tap on a place on the map (café, fuel, restaurant...) now shows whether it is open now ("Open · until 9 PM", "Closed · opens tomorrow 7 AM", "Open 24 hours"), and Call and Website keys, as Apple and Google Maps' place cards do. The data is the place's own OpenStreetMap tags (opening_hours, phone, website), asked of Overpass by name within 60 m once the card is up (web/place_info.js). Hours OSM doesn't have, or writes in forms read() doesn't follow (months, sunrise, "+"), show nothing: unknown stays unknown. docs/APP_REVIEW.md has a 5.1.2 row for the lookup.
- Tests: tests/test_place_info.py (common opening_hours forms, past midnight, later rules, days off, holidays skipped, unknown forms; phone and website keys). The e2e "places on the map" flow checks the card's open line and Call/Website keys from a stubbed Overpass answer.
- Next: the same line on Where to? search results and on the Along-the-route list.

# CALL SHEET

## 2026-11-14 place hours from Overpass on tap, not from our server
- What: the phone asks the public Overpass servers for the tapped place's tags (cameras.js fetchFirst, 6 s).
- Why: no backend change and nothing stored; it is the same third party the app already asks for route context and cameras, and it sees only the tapped place.
- Undo: drop the ApexPlaceInfo.lookup call in cockpit.js showPin; the card goes back to name, kind and distance.
