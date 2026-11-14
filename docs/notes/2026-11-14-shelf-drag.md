# STATE

## 2026-11-14 The Garage looks-shelf e2e check no longer flings (claude/project-thread-5sbga7)
- Done: e2e "the Garage on a phone" now turns the looks shelf with drag(), a touch that moves a frame at a time and holds still before it lifts. The old swipe() sent its moves back to back, which Chromium can read as a fling of any speed. On a loaded CI runner, that fling carried the shelf past the next look to the last one (scrollLeft 612 on #811 and #817), even with scroll-snap-stop. Released with no speed, the shelf settles on the card nearest the finger, so 260 px always lands on the next look and 260 px back lands on the first.
- Tests: the flow passed 5 runs locally, and 3 more with the CPU throttled 8x. The old gesture never failed locally, so the fix rests on the cause: the gesture no longer has a release speed.

# CALL SHEET

## 2026-11-14 A resting drag for the shelf, the app unchanged
- What: a drag(cdp, page, ...) helper beside swipe() in e2e/smoke.js, used for the shelf's two turns only.
- Why: the check is meant to show that a turn brings the next look and keeps the sheet open, not to test fling physics. The shelf already has scroll-snap-stop: always for real thumbs.
- Undo: put swipe() back in those two lines.
