# STATE
## Session 2026-11-12 (deepest analysis, PR 23): the end card names the practised road (claude/project-thread-gd7nre)
- `web/driver_profile.js` `practiceLine`: a per-road plan's line reads "Practice on Dry Ridge Rd · One steering arc: ...".
  A drive on another road still gives no line (#478).
- Tests: tests/test_practice_focus.py (the words); the four-drive road e2e flow checks the end card's practice line.
- Next: when a per-road practice has 3+ drives there, the road book could mark which of its uneven corners have evened out.
