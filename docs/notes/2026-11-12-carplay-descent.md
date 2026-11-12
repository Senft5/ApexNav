# STATE

## Session 2026-11-12 (CarPlay descent): the car's route preview says a long descent on the way (claude/project-thread-me97iw)
- web/brake_heat.js `descentShort` ("Long descent: 3.7 mi at 8%", "+N" for more) rides in the `along` message as `descent`; cockpit.js `carAlong` now also sends once the terrain is in (`paintClimb`). ApexCarPlay.swift adds it to the picked route's info variants, longest first, down to the detail alone.
- Tests: tests/test_brake_heat.py, tests/test_carplay.py; e2e "CarPlay feed".
- Next: nothing queued on the route preview; CarPlay's Loops list rows still repeat one detail line each.
