# STATE

## Session 2026-11-12 (CarPlay offers): Go round, Skip and Head home on the car's screen (claude/project-thread-me97iw)
- A drive's one-key offers were phone-only toasts. cockpit.js `offerKey` now also posts web/carplay.js `offerMessage` ({kind:'offer', id, title, short, key, seconds}); ApexCarPlay.swift `showOffer` shows a navigation alert with that key and Not now. A car tap sends `{action:'offer', id}` and the page runs it once and drops the phone's key; a phone tap sends `offerDone` and the car's alert goes away.
- Used by the police report ahead (Go round) and the late-for-home offer (Skip a stage / Head home).
- Tests: tests/test_carplay.py, e2e "avoid police reports, driving" (now answered from the car).
- Next: the late-for-home offer has no e2e of its own firing in a drive.

# CALL SHEET

## 2026-11-12 (CarPlay offers): the car gets the phone's drive offers as navigation alerts (claude/project-thread-me97iw)
A navigation alert is the template's own way to ask a driver something while moving (the same as the hazard Still there / Gone), so it fits the navigation-app rules; the key is the phone's own word, at most 16 characters. Undo: drop `case "offer"` in CarPlay/ApexCarPlay.swift; the phone's toast is unchanged.
