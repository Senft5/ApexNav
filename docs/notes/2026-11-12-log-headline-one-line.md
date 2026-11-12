# STATE

## 2026-11-12 the Log's top: one line each
- Done: the Log's headline under the score drops the minute ("Latest Vetta Score · Cherohala Skyway · Yesterday", not "…, 2:17 PM"), so it fits one line. The Your driving card says "Best: One braking 99 · Work on: Back to power 83" (was "Strongest:", which wrapped), and before enough corners: "9 of 30 clean corners to your first picture" (was two sentences).
- Tests: tests/test_driver_profile.py and the e2e card check expect "Best:" and the short line; screen by screen passes.
- Next: keep sweeping my areas (shell, Garage, Where to?, Log, drive page) for lines that wrap or explain.

# CALL SHEET

## 2026-11-12 Log headline and Your driving card shorter
- What: the hero line shows the day only; "Strongest:" became "Best:"; the few-corners line became one clause.
- Why: Nate's no-walls-of-text rule; both lines wrapped onto a second row on a phone.
- Undo: restore `dateLabel(latest)` in web/analysis.html's hero and the two strings in web/driver_profile.js cardLine (and their tests).
