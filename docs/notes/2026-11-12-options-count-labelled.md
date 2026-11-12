# STATE

## 2026-11-12 the Options chip says what its number counts (claude/project-thread-5sbga7)
- Done: Where to?'s and the route card's Options chip reads "Options · 5 on" (was "Options · 5"), per the UI guide's "every number labelled". Seen in Nate's TestFlight screenshot of 2026-11-12 16:39. VoiceOver still names each option.
- Tests: tests/test_plan_options.py; e2e "stamp", "screen by screen", "plan flow (d)".
- Next: keep sweeping the shell.

# CALL SHEET

## 2026-11-12 "Options · N on"
- What: ApexPlanOptions.chipLabel adds " on".
- Why: a bare number on a chip doesn't say what it counts; two letters do, and the chip still fits on one line.
- Undo: drop " on" in web/plan_options.js chipLabel and the four test strings.
