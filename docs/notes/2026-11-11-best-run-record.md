# STATE
## Session 2026-11-11 (roam-a best run record): Best run this month (claude/project-thread-h7xxmf, off origin/main)

- IDEAS D-30, part two. web/recording.js `runOf(Core, d)` (repair + scorable corners, as `scoreOf`) and summaries carry
  `run: { corners, len_m }` (null: none of 5+; absent: flow.js not loaded). SUMMARY_VERSION 2 (rebuilt once).
- flow.js now loads before recording.js in index.html (deferred, ~2 KB), analysis.html, analysis_worker.js and
  break_worker.js. drive_view.js uses `runOf` too. analysis.html renderRecords: "Best run this month: corners in a row,
  smooth and settled, over X" (CSP hash regenerated).
- Tests: tests/test_flow.py (+2: summary and wiring); e2e "Your records…" seeds runs (an old month's never counts).
- Next: the end card's line for the run, when a drive just had one.

# CALL SHEET
## 2026-11-11 (roam-a best run record): "Best run this month" in Your records (claude/project-thread-h7xxmf)

Your records in the Log gain a row: this month's best run of clean corners in a row, with its drive, length and day. Each
drive's summary now keeps its best run (recording.js `runOf`, judged on the same rows and corners as the Score, so the
drive page and the record agree). Calls: the summary version goes to 2, so every saved drive is summarised again once
from its own rows the next time the Log opens (a one-off, in the worker); a drive whose run can't be known never counts.
Undo: remove the `run` row in analysis.html renderRecords (and the `run` field in recording.js summarize).
