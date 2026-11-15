# STATE

## 2026-11-14 Share a place from its card (claude/project-thread-5sbga7)
- Done: the place card (a tapped place, or a dropped pin) has Share. It opens the share sheet with a vettadrive.app link, `/#place=39.15500_-84.61500_<name as base64url>` (web/place_link.js). That link opens the same card on the same spot, with its name, its hours and its photo, in the app (universal link) or on the website. The map stays on the place, with Recenter to come back to you. The card says "Sent to you" with how far it is. A malformed link says so and opens nothing. A long or non-Latin name is cut to fit the app's 200-character link value; the place is never cut.
- iOS and the Worker: ApexNavApp.swift linkKeys gains "place", and a #place= fragment is passed on as ?place=, as #road= is. backend/src/hosts.ts AASA lists `{ "/": "/", "#": "place=*" }`. docs/APP_REVIEW.md has a row.
- Tests: tests/test_place_link.py (round trip in the app's characters, a long name cut to fit, malformed links, the app and the AASA take it). backend/test/hosts.test.ts. A new e2e flow, "a place someone sent", opens a link, checks the card, presses Share and reads the link back, then tries a broken link.
- Needs a TestFlight build for the app side: until then the link opens the website.

# CALL SHEET

## 2026-11-14 a shared place rides in the URL fragment
- What: `#place=` rather than `?place=`, and a token in [A-Za-z0-9._-] rather than JSON.
- Why: a fragment never reaches the server, so the Worker never logs where people meet (the same as #road=). The app's link filter only passes those characters.
- Undo: remove the Share button (index.html pinShareBtn) and its handler. Old links then still open their card.
