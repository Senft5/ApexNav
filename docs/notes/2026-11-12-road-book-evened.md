# STATE
## Session 2026-11-12 (deepest analysis, PR 24): the road book says which corners evened out since a road practice began (claude/project-thread-gd7nre)
- `core/driver_profile.py` `road_book(drives, ref, since)` and its port: with `since`, each corner has `since_n` /
  `since_low` (its passes since, an undated drive counting before) and the book `evened`: the corners that span
  UNEVEN_LEVELS overall but whose passes since (EVEN_MIN = 2 or more) are all within it of the cleanest.
- `web/driver_profile.js` `roadEvenedLine`: "Evened out since you began practicing here: corners 4 and 9, every pass
  there since close to your cleanest." `web/analysis.html` shows it in the road book's head when the practice keeps to
  that road; the roadBook job takes `since`.
- Tests: tests/test_best_corners.py (since, evened, parity, words); the four-drive road e2e flow reads the job with since.
- Next: Your driving's Practicing box on a road practice could say the same count ("2 of its 3 least even corners have
  evened out").

# CALL SHEET
## 2026-11-12 (deepest analysis 24): "evened out" = 2+ passes since the practice, all within 15 levels of the cleanest (claude/project-thread-gd7nre)
The same 15 levels that make a corner uneven, so a corner leaves that list by the rule that put it there. Two passes, so
one lucky run is not called a change. Undo: drop `since` from the roadBook job call in showBook (web/analysis.html).
