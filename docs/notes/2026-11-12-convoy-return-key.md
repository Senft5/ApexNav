# STATE

## 2026-11-12 Convoy: Return joins with a code and starts a convoy, once (free roamer B)
- Walkthrough of the Convoy sheet: like People before #548, the Return key did nothing in the join code and convoy name fields, and a second tap while it worked sent a second request: for the code, another of its few tries before the ten-minute lockout; for Start, a second convoy (you may lead two).
- Done: Return in the join code joins; Return in the convoy name starts it; both keys, tapped or Return, act once at a time. e2e "convoy: a friend joins with the code…" presses Return twice and expects one try.
- Next: keep walking (Garage and Settings).

# CALL SHEET

## 2026-11-12 Convoy fields act on Return, once (free roamer B)
- What: convoy_ui.js `onReturn` and `once` helpers around Join with code and Start a convoy.
- Why: a phone keyboard's Go key that does nothing reads as broken, and the code endpoint is rate limited, so a double tap cost a try.
- Undo: in web/convoy_ui.js, call the original handlers directly and drop the two helpers.
