# STATE
## Session 2026-11-12 (roam-a month's best, live): the co-driver says when you pass this month's best run (claude/project-thread-h7xxmf)

- IDEAS D-30, part five. web/flow_live.js: `monthBest(all, monthOf, key)` (the most corners in a run among this month's
  summaries; unknown dates and unjudged runs never count) and `watch.setBest(n)` (5 or more). Passing it says
  "Eleven clean in a row, your best this month." once a drive, in place of a milestone on the same corner.
- web/cockpit.js `noteFlow` reads the Log's summaries once after Start for the month's best. The flow lines now queue
  (two deep) instead of replacing each other, so the record line is not lost to "Ten clean in a row." a few corners
  later; the queue clears with the slot (Quiet notes, a 20 s expiry, each drive).
- Tests: tests/test_flow_live.py (+1); the live e2e seeds a run of 7 this month (and 40 in an old month) and hears
  five, "Eight clean in a row, your best this month.", ten, and nothing in Quiet notes.
- Next: car-friendly café picks (R-24's last part), or D-16's late-drive cues.

# CALL SHEET
## 2026-11-12 (roam-a month's best, live): passing the month's best run is said once (claude/project-thread-h7xxmf)

The co-driver now says when a run of clean corners passes this month's best in your Log ("Eleven clean in a row, your
best this month."), once a drive. Calls: a best under five is no record to speak of; the record line wins over a
milestone on the same corner; flow lines queue two deep so none is dropped for the next. Undo: drop the `setBest` read
in cockpit.js `noteFlow`.
