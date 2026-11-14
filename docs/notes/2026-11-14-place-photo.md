# STATE

## 2026-11-14 a place's card leads with a street photo of it (claude/project-thread-5sbga7)
- Done: a tap on a place on the map, or a dropped pin, now tops its card with a street-level photo of that spot, as Apple and Google Maps lead their place cards with one. The photo comes from Mapillary (web/place_photo.js): the one taken within 70 m of the place with the camera pointing at it (within 40 degrees), not a panorama, nearer and newer winning. It shows only once it has loaded. Under it, the taker, Mapillary, the year and CC BY-SA, linking to the photo's page. No photo facing the place, no token or no signal means no picture.
- The token is the owner's free Mapillary client token from GET /api/ctx/keys, kept in memory only. The picture loads from *.fbcdn.net, which is now in the CSP's img-src (tools/csp.py). docs/APP_REVIEW.md has a 5.1.2 row, and privacy.html says it under "A place you tap on the map". licenses.html credits place photos.
- Found on the way: route_ctx/ctx_util.js loadKeys() is never called, so route context's Mapillary traffic signs only run on a phone where someone typed a token by hand. Left alone here because calling it would change route ranking. It belongs to the routing thread.
- Tests: tests/test_place_photo.py (facing only, near but not on top, no panoramas, nearer and newer win, credit text, a small query square). The e2e "places on the map" flow checks the card leads with the facing photo, full width above the name, with its credit.

# CALL SHEET

## 2026-11-14 place photos from Mapillary, with Meta's image CDN allowed
- What: the place card asks graph.mapillary.com for the photos in a ~140 m square round the tapped point and loads the chosen one from *.fbcdn.net.
- Why: a photo is the first thing every big maps app's place card shows. Mapillary is free, has street coverage nearly everywhere we drive, and we already hold its token for route context. The cost is one more third party (Meta's CDN), which sees the tapped spot and the IP address, the same exposure as the Overpass lookup.
- Undo: drop the ApexPlacePhoto.lookup call in cockpit.js showPin (and https://*.fbcdn.net from tools/csp.py, then run it).
