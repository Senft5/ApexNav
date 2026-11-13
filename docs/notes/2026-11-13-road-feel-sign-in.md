# STATE

## 2026-11-13 Road feel signed out: a way to sign in (free roamer B)
- Walkthrough of Garage, Settings on a phone, signed out: Road feel's page said "Off. Sign in to share road feel." with nothing to tap, and its row in the Settings list said nothing (every other row says its value).
- Done: a Sign in key under that line (web/index.html #ambientSignIn, shown by cockpit.js paintAmbient only when signed out) closes Settings and opens People, where signing in is, as every other "Sign in to …" does. The row reads Off from it (its data-summary also names the key). New e2e flow "Road feel signed out"; tests/test_garage_settings.py updated.
- Also walked: Privacy zones, Crash check, Reminder, Your data, Spots, Map motion, About. They read cleanly.
- Next: keep walking on a phone (People with a friend's profile).

# CALL SHEET

## 2026-11-13 Sign in key on Road feel (free roamer B)
- What: signed out, Road feel's page has a Sign in key, and its Settings row says Off.
- Why: a line telling you to sign in with no way to was a dead end; the owner's rule that every place features meet be intuitive.
- Undo: remove #ambientSignIn from web/index.html (and from its data-summary), its two lines in cockpit.js paintAmbient, and the e2e flow.
