# STATE

## Session 2026-11-15 (map layers and pins): layers left on stay on; hazard and DOT pins scale with zoom (claude/project-thread-me97iw)
- Nate (a real drive): "map layers sometimes reset when I reopen the app". The account answers before the lazy social scripts load, and `renderAccount` turned Friends off when friends_map.js wasn't loaded yet (saved off at the next save, so every reopen); Meets and Roadbooks stayed on but nothing loaded their scripts, so they never drew; a launch that read signed out saved Satellite off. Now a member's Friends, Meets and Roadbooks load the social scripts and draw; a signed-out launch draws none but keeps the choice; Satellite is only gated (applySatellite), never switched off by the account. e2e: "map layers: every layer left on is still on after the app is reopened".
- Nate: "road closures and such tags don't scale when you zoom out and show outside the area, so they block half the map". `ApexHazardReports.pinView` (tests/test_hazard_pins.py) places the hazard and DOT pins each move: only those in view; below z12.5 a small mark (`.hz-pin.hz-mini`, no words), closer in the tag; crashes and closures first, never one over another; at most 10 tags and 40 marks.
- Next: a tap on a mark could zoom to it; TestFlight check in Columbus at night with ODOT's ~500 events.

# CALL SHEET

## 2026-11-15 (map layers and pins): a signed-out launch keeps the social layers' switches on, drawing nothing (claude/project-thread-me97iw)
- Why: a token being renewed reads signed out for one launch; switching the layers off then lost the driver's choice for good. A switch on with nothing drawn while signed out is the smaller harm; tapping it asks to sign in as before.
- Undo: in renderAccount's member block, turn the toggles off in an `else` branch again.
