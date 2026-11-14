# STATE

## Session 2026-11-13 (carplay rerouting): off the route the car says "Rerouting…" (claude/project-thread-me97iw)
- Off the route, the car's card kept the last turn with its distance frozen (the cursor holds still off route) while the car drove away from it; Apple Maps and Waze say "Rerouting" there. The page now sends `pausedMessage` (web/carplay.js) with the status line's own words (cockpit.js offRouteText) and the car shows CarPlay's paused trip (`session.pauseTrip`, `.rerouting` or `.proceedToRoute` for Off route / Wrong way / no signal). The new route's first maneuver, or the old one back on route, resumes it. The detour e2e flow checks the car gets one Rerouting and then guidance.
- Next: TestFlight on Nate's car (the paused card's look is CarPlay's own).

# CALL SHEET

## 2026-11-13 (carplay rerouting): CarPlay's own paused trip, not a made-up maneuver card (claude/project-thread-me97iw)
- Why: `pauseTrip(for: .rerouting)` is the system's rerouting card, the one Apple Maps shows, and it needs no symbol or distance we'd have to invent.
- Undo: drop `case "paused"` in CarPlay/ApexCarPlay.swift (the card then keeps the old turn as before).
