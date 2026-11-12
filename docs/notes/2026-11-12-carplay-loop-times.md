# STATE

## Session 2026-11-12 (CarPlay loops): the car's 1½ and 3 hour loops now plan (claude/project-thread-me97iw)
- Bug: CarPlay's Loops list offered 30 min to 3 hours (since fable-carplay-loops), but the page's `loop` handler took only 30, 60 and 120, so 1½ and 3 hours did nothing. cockpit.js now takes every `LOOP_MINUTES` time.
- Tests: tests/test_carplay.py (the handler takes the dial's times), e2e "CarPlay feed" (the car's 90 minute loop opens the plan; fails without the fix).
- Next: CarPlay offers the phone's Go round (police ahead) and Skip / Head home (late for home) keys as navigation alerts.
